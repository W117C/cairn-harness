// P3 离线评测：laya 在**中文工具描述**上的判据质量（2026-10-04）。
//
// 跑的是 laya 官方多语言 checkpoint 导出的 laya-ts 产物（encoder.onnx + head.onnx），
// 走的是 laya-ts 的真实加载路径（onnxruntime-node），不是自己拼的前向。
//
// 四个读数，各有各的口径，**不许混读**：
//  ① **top-1 准确率**：给的候选集里挑对没有。基线 = 多数类基线（永远猜同一个工具）。
//     官方自陈 base 检查点零样本 0.362/0.352 低于多数类 0.461 ⇒ 若这里也低于基线，
//     它对「选哪把工具」这件事**零信息**，再怎么调温度/描述都没用。
//  ② **ECE**（期望校准误差）：模型说 0.8 的那些题，实际对了多少。分桶后加权。
//     ECE 低但准确率也低 = 它很确定地错 ⇒ 比「不确定地错」更危险，因为门会放行。
//  ③ **漏裁**：本仓要的是「该留的工具必须留」。choice 形态没有「裁剪」这个动作，
//     所以这里量两件**结构性的**事，二者都可能导致正确工具根本进不了决策：
//       · head 预算（cfg.head_max_len = 256）不够 ⇒ 选项被压到没有独立 token span
//         （`usage.options.tool.distinct < total`）；
//       · state 被 max_len（1024）截断（`usage.truncated` / `state_tokens_dropped`）。
//  ④ **漏掉的正确工具**：top-1 之外，正确答案排第几 / 有没有被压没。
//
// **一条纪律**：③ 与 ④ 必须分开读。「压没了」和「压进了但排第二」是两种失败，
// 前者是本仓能靠加预算/缩短描述治的，后者只能靠换模型治。混起来就会得出
// 「描述要更短」这种只对一半失败成立的结论。
//
// 复跑：cd /tmp/laya-eval && node eval.mts   （依赖与构建步骤见 outputs/ 下的回执）
import { Agent } from "laya-ts";
import type { ChoiceAnswer, SystemOneResult, SystemUsage } from "laya-ts";
import { readFileSync } from "node:fs";

const MODEL_DIR = "/tmp/laya-onnx-ml";

// ── 本仓 22 把缺省工具的真实描述（节选自 src/tools/base.ts 与 agent-runner 的规格面）
//    这里手抄是为了让评测可离线跑；口径上它与 `sessionToolSpecs({mode:"default"})` 同源，
//    差异只在长度（这里取短版，因为 head_max_len 会因描述变长而更早裁剪）。
const TOOL_DESCRIPTIONS: Record<string, string> = {
  read_file: "读取文件内容，返回文本；大文件只读前缀并明说截断",
  write_file: "把整份内容写进文件（覆盖已有内容）",
  edit_file: "按 old_string/new_string 精确替换文件里的一段；改前自动存快照",
  apply_patch: "按 unified diff 打补丁到文件",
  run_shell: "在 shell 里执行一条命令；能改盘，但改动无法归因到具体文件",
  grep: "在文件里按正则搜匹配行，返回命中的行号与行内容",
  glob: "按 glob 模式列出匹配的文件路径",
  lsp: "问语言服务器：跳转定义、查引用、取诊断",
  clarify: "向用户提问以消除歧义；会中断本轮",
  propose_plan: "提交一份实施方案等待审批",
  verify: "跑验收命令并回报成败与输出",
  refine_goal: "根据新信息改写本轮目标",
  remember: "把结论沉淀进记忆文件",
  spawn_agent: "派一个子代理去跑子任务",
  wait_for_agents: "等待已派出的子代理收敛",
  cancel_agents: "撤销已派出的子代理",
  web_fetch: "抓一个 URL 的内容",
  automation_create: "创建一个定时任务",
  automation_update: "改一个已存在的定时任务",
  automation_delete: "删掉一个定时任务",
  automation_run_now: "立刻跑一次某定时任务",
  automation_list: "列出所有定时任务",
};

interface Case {
  /** 任务描述（喂给模型的 state）。中文。 */
  state: string;
  /** 这一题的正确工具（= 本仓真实面里最该用的那把）。 */
  truth: string;
}

const CASES: Case[] = [
  { state: "src/math.js 里 clampSum 没有夹取，我先得看清它现在长什么样。", truth: "read_file" },
  { state: "tests/run.mjs 一共有 40 多个测试文件，我要找哪几个引用了 resolveTimeout。", truth: "grep" },
  { state: "仓库里哪些文件叫 *.spec.ts？我要先知道有哪些再决定读哪个。", truth: "glob" },
  { state: "resolveTimeout 只在 routes.js 第 42 行被调用，我要跳过去看实现。", truth: "lsp" },
  { state: "clampSum 的三行实现，我要把它换掉，其余不动。", truth: "edit_file" },
  { state: "tests.js 整个文件我要按新内容整体重写，它很小。", truth: "write_file" },
  { state: "我有一份现成的 diff，想直接打上去。", truth: "apply_patch" },
  { state: "跑一下 node tests/run.mjs 看看绿了没有。", truth: "run_shell" },
  { state: "改完了，我要确认这次修改确实通过了验收。", truth: "verify" },
  { state: "任务描述里「导出」到底指哪个字段？我不确定，先问清楚。", truth: "clarify" },
  { state: "这个修复要动三个文件，我想先把方案提出来等审批。", truth: "propose_plan" },
  { state: "这个结论以后每轮都要用，我要它进记忆。", truth: "remember" },
  { state: "把「每次导出超时都要复查」这条教训记下来。", truth: "remember" },
  { state: "我要把「搜日志里 500 的那行」这件事派给子代理去做。", truth: "spawn_agent" },
  { state: "子代理派出去了，我要等它跑完再看结果。", truth: "wait_for_agents" },
  { state: "子代理跑偏了，我要把它撤回来。", truth: "cancel_agents" },
  { state: "这个接口的官方文档在网上，我要读它。", truth: "web_fetch" },
  { state: "以后每天早上八点自动跑一次回归。", truth: "automation_create" },
  { state: "现在有哪些定时任务在跑？", truth: "automation_list" },
  { state: "那个定时任务的间隔改成两小时。", truth: "automation_update" },
  { state: "这个定时任务不要了。", truth: "automation_delete" },
  { state: "不用等时间点，现在立刻跑一次那个定时任务。", truth: "automation_run_now" },
];

/** 构造一道 choice 题：候选集里的每把工具 → 它的描述。 */
function question(candidates: string[], instructions: string) {
  const criteria: Record<string, string> = {};
  for (const c of candidates) criteria[c] = TOOL_DESCRIPTIONS[c] ?? c;
  return { type: "choice" as const, instructions, criteria };
}

const INSTR = "这一步该用哪把工具？只选一把。";

/** ECE：按预测置信度分 10 桶，算 |置信度 − 实际准确率| 的桶内加权平均。 */
function ece(samples: { conf: number; correct: boolean }[], bins = 10): { ece: number; perBin: string[] } {
  const buckets: { lo: number; hi: number; n: number; sumConf: number; nCorrect: number }[] = [];
  for (let i = 0; i < bins; i++) buckets.push({ lo: i / bins, hi: (i + 1) / bins, n: 0, sumConf: 0, nCorrect: 0 });
  for (const s of samples) {
    const idx = Math.min(bins - 1, Math.max(0, Math.floor(s.conf * bins)));
    const b = buckets[idx]!;
    b.n++; b.sumConf += s.conf; b.nCorrect += s.correct ? 1 : 0;
  }
  let total = 0;
  const perBin: string[] = [];
  for (const b of buckets) {
    if (b.n === 0) continue;
    const gap = Math.abs(b.sumConf / b.n - b.nCorrect / b.n);
    total += (b.n / samples.length) * gap;
    perBin.push(`[${b.lo.toFixed(1)}-${b.hi.toFixed(1)}) n=${b.n} 平均置信 ${(b.sumConf / b.n).toFixed(3)} 实际 ${(b.nCorrect / b.n).toFixed(3)}`);
  }
  return { ece: total, perBin };
}

interface Row {
  truth: string;
  got: string;
  p: number;
  rankOfTruth: number;      // 1-based；候选集里根本没它 ⇒ 0
  correct: boolean;
  collapsed: boolean;       // 选项被 head 预算压掉独立 token span
  stateDropped: number;
  truncated: boolean;
}

async function run(label: string, agent: Agent, candidatesOf: (c: Case) => string[]) {
  // 上一版这里自己拼 `loadNodeBundle` + `createNodeProvider` + `new Agent`，错了两处：
  //   · `createNodeProvider` 收的是 **路径字符串**，我传了 bundle 对象 ⇒ ERR_INVALID_ARG_TYPE；
  //   · Agent 的 tokenizer 是 `bundle.tokenizerJson` 经 `tokenizerFromHF` 解析的，漏了就没法编码。
  // `Agent.load()`（laya-ts/src/agent.ts:868）就是官方做这三步的那条路，改用它，
  // 免得下次 laya 改了内部细节我又跟着坏一遍。
  const samples: { conf: number; correct: boolean }[] = [];
  const rows: Row[] = [];
  let errors = 0;

  for (const c of CASES) {
    const cands = candidatesOf(c);
    let res: SystemOneResult;
    try {
      res = await agent.predict({ text: c.state }, { tool: question(cands, INSTR) });
    } catch (e) {
      errors++;
      console.log(`  ⚠️ ${c.truth}: 推理抛错 ${String((e as Error).message).slice(0, 110)}`);
      continue;
    }
    const ans = res.answers["tool"] as ChoiceAnswer;
    const usage: SystemUsage = res.usage ?? {};
    const probs = ans.probabilities ?? {};
    const got = ans.choice;
    const conf = probs[got] ?? 0;
    const correct = got === c.truth;

    const order = Object.entries(probs).sort((a, b) => b[1]! - a[1]!);
    const rankIdx = order.findIndex(([k]) => k === c.truth);
    const optStats = usage.options?.["tool"];
    const collapsed = !!optStats && optStats.distinct < optStats.total;

    rows.push({
      truth: c.truth,
      got,
      p: conf,
      rankOfTruth: rankIdx < 0 ? 0 : rankIdx + 1,
      correct,
      collapsed,
      stateDropped: usage.state_tokens_dropped ?? 0,
      truncated: !!usage.truncated,
    });
    samples.push({ conf, correct: correct as boolean });
  }

  const n = samples.length;
  const acc = n === 0 ? null : samples.filter((s) => s.correct).length / n;
  // 多数类基线：永远猜样本里出现最多的那个 truth。
  const freq = new Map<string, number>();
  for (const c of CASES) freq.set(c.truth, (freq.get(c.truth) ?? 0) + 1);
  let majority = ""; let best = -1;
  for (const [k, v] of freq) if (v > best) { best = v; majority = k; }
  const base = CASES.length === 0 ? null : best / CASES.length;
  const { ece: e, perBin } = ece(samples);

  const missed = rows.filter((r) => !r.correct);
  const collapsedTruth = rows.filter((r) => !r.correct && r.rankOfTruth === 0);
  const rerankedTruth = rows.filter((r) => !r.correct && r.rankOfTruth > 0);
  const truncCases = rows.filter((r) => r.truncated || r.stateDropped > 0).length;
  const collapsedCases = rows.filter((r) => r.collapsed).length;

  console.log(`\n== ${label} ==`);
  console.log(`  题数 ${String(CASES.length)}｜推理失败 ${String(errors)}｜参与统计 ${String(n)}`);
  console.log(`  **top-1 准确率 = ${acc === null ? "null" : acc.toFixed(3)}**`);
  console.log(`  多数类基线     = ${base === null ? "null" : base.toFixed(3)}（永远猜 ${majority}）`);
  console.log(`  相对基线       = ${acc === null || base === null ? "null" : (acc - base >= 0 ? "+" : "") + (acc - base).toFixed(3)}`);
  console.log(`  **ECE = ${e.toFixed(3)}**（越低越准；低 ECE + 低准确率 = 自信地错，最危险）`);
  for (const l of perBin) console.log("    " + l);
  console.log(`  ── 漏裁（结构性，可能让正确工具根本进不了决策）──`);
  console.log(`  选项被压掉独立 span 的题数 = ${String(collapsedCases)}/${String(n)}`);
  console.log(`  state 被 max_len 截断的题数 = ${String(truncCases)}/${String(n)}`);
  console.log(`  ── 漏掉的正确工具（${String(missed.length)} 条，分两类）──`);
  console.log(`    A. 正确工具被压没（probs 里根本没有它）= ${String(collapsedTruth.length)} ⇒ 加 head 预算/缩短描述可能治`);
  for (const r of collapsedTruth) console.log(`       · ${r.truth} → 选了 ${r.got}（p=${r.p.toFixed(3)}）`);
  console.log(`    B. 正确工具还在但没排第一 = ${String(rerankedTruth.length)} ⇒ 只能换模型，调描述未必治`);
  for (const r of rerankedTruth) console.log(`       · ${r.truth} 排第 ${String(r.rankOfTruth)}，选了 ${r.got}（p=${r.p.toFixed(3)}）`);
  return { acc, base, ece: e, missed: missed.length, collapsedTruth: collapsedTruth.length, rerankedTruth: rerankedTruth.length, collapsedCases, truncCases, errors, n };
}

const allNames = Object.keys(TOOL_DESCRIPTIONS);

const cfg = JSON.parse(readFileSync(MODEL_DIR + "/rl_agent_config.json", "utf8"));
console.log(`模型目录：${MODEL_DIR}`);
console.log(`cfg：encoder=${String(cfg.encoder)} max_len=${String(cfg.max_len)} head_max_len=${String(cfg.head_max_len)}`);

const agent = await Agent.load(MODEL_DIR, { localDir: MODEL_DIR });
console.log("模型已加载，开始推理（CPU，每题一次前向）。");

const smallOf = (c: Case) => {
  const i = allNames.indexOf(c.truth);
  const out = [c.truth];
  for (let k = 1; k < 6; k++) out.push(allNames[(i + k * 5) % allNames.length]!);
  return [...new Set(out)];
};

const small = await run("小候选集（每题 6 件，含正确件）", agent, smallOf);
const full = await run(`全量面（${String(allNames.length)} 件 = 本仓缺省面件数）`, agent, () => allNames);

console.log("\n== 汇总 ==");
for (const [nm, r] of [["小候选集", small], ["全量面  ", full]] as const) {
  console.log(`  ${nm}：n=${String(r.n)}｜acc ${r.acc === null ? "null" : r.acc.toFixed(3)}｜ECE ${r.ece.toFixed(3)}｜漏 ${String(r.missed)}（压没 ${String(r.collapsedTruth)}／排后 ${String(r.rerankedTruth)}）｜压 span ${String(r.collapsedCases)}｜截 state ${String(r.truncCases)}`);
}
if (small.acc !== null && small.base !== null) {
  console.log(`  ${small.acc >= small.base ? "✅" : "❌"} 小候选集${small.acc >= small.base ? "高于" : "**低于**"}多数类基线 ${small.base.toFixed(3)}`);
  console.log(`     官方自陈 base 检查点：0.362 / 0.352，均低于多数类基线 0.461。`);
}
console.log("\n判读纪律：acc 低于基线 ⇒ 它对「选哪把工具」零信息，后面几格都不用看了。");
console.log("          acc 过基线但压没占比高 ⇒ 瓶颈是 head 预算，不是模型能力。");
console.log("          acc 过基线且压没占比低 ⇒ 瓶颈是模型排序能力。");