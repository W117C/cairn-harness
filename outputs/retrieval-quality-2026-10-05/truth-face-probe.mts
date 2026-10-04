/** 第 361 页 · 取数探针（只读、零建图、零花费）：检索尺的**真值面**今天有没有观测者。
 *
 *  立案：`scripts/probe-locate-recall.ts` 是本仓唯一量「问题 → 该落的那个文件是否进了首轮注入」的尺
 *  （现读记录 14/16，PROGRESS 第 336 页）。它有两个自检位（正哨兵 L-POS、负控 L-NEG），
 *  但**真值数据本身**（`fixtures/locate/dsh-questions.json`）全仓零判卷：
 *  既没人核每条 `truth[].file` 在不在仓库清单里，也没人核那两条自检位的形状。
 *  ⇒ 「把尺哄绿」与「真值腐烂」两种动作都不惊动任何门。
 *
 *  本探针只做一件事：**量现读**，给「该不该加那一格」提供分母（本仓规矩：先量现读才写帽）。
 *  不 import 检索实现（那一格要复用被度量方的取料，是尺的事，不是探针的事）。
 *
 *  跑法（仓库根）：node --import tsx outputs/retrieval-quality-2026-10-05/truth-face-probe.mts
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const ROOT = process.cwd();

/** 取 HEAD 那份，不取工作树：本仓多会话在飞，工作树内容不是要入库的那份（同 why-miss.mjs 的口径）。 */
const atHead = (rel: string): string | null => {
  const r = spawnSync("git", ["show", `HEAD:${rel}`], { cwd: ROOT, encoding: "utf8" });
  return r.status === 0 ? r.stdout : null;
};
const tracked = new Set(
  (spawnSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).stdout ?? "")
    .split("\n")
    .filter((p) => p !== ""),
);

type Q = { id: string; shape: string; question: string; truth: { file: string; evidence: string }[] };
const spec = JSON.parse(atHead("fixtures/locate/dsh-questions.json") ?? "{}") as { questions: Q[] };
const rows = spec.questions ?? [];

console.log(`真值集＝HEAD 那份 fixtures/locate/dsh-questions.json｜题数=${String(rows.length)}`);
console.log(`仓库清单＝git ls-files（${String(tracked.size)} 条跟踪路径）`);
console.log("");

// ⑴ 每条 truth 的存在性：真值文件被改名/删除 ⇒ 那一题永久 MISS，而探针退 0 以外的判卷一条都不红。
const ghosts: string[] = [];
for (const q of rows) {
  for (const t of q.truth ?? []) {
    // 负控**期望不存在**，它进 ghost 是合规的，单独一格，不许与真值题混数。
    if (q.shape === "control") continue;
    if (!tracked.has(t.file)) ghosts.push(`${q.id} → ${t.file}`);
  }
}
console.log(`⑴ 真值文件不在跟踪清单里的（负控除外）＝${String(ghosts.length)} 条${ghosts.length ? "：" + ghosts.join("、") : ""}`);

// ⑵ 负控那条必须**不**存在——它存在了负控就恒不响（命中定义太松那一格失去观测者）。
const controls = rows.filter((q) => q.shape === "control");
const badControls = controls.filter((q) => (q.truth ?? []).some((t) => tracked.has(t.file)));
console.log(`⑵ 负控条数＝${String(controls.length)}（期望恰 1）｜其中 truth 竟然存在的＝${String(badControls.length)} 条${badControls.length ? "：" + badControls.map((q) => q.id).join("、") : ""}`);

// ⑶ 正哨兵必须**在**清单里且是**一条真实存在的文件**——否则「哨兵 MISS＝图里真没有它」这句会说谎。
const sentinels = rows.filter((q) => q.shape === "sentinel");
const deadSentinels = sentinels.filter((q) => !(q.truth ?? []).some((t) => tracked.has(t.file)));
console.log(`⑶ 正哨兵条数＝${String(sentinels.length)}（期望恰 1）｜其中 truth 不在清单里的＝${String(deadSentinels.length)} 条${deadSentinels.length ? "：" + deadSentinels.map((q) => q.id).join("、") : ""}`);

// ⑷ 去重与题型分布：分母只准说清一次。两条题指向同一个真值文件＝「14/16」里有一题是免费的。
const byFile = new Map<string, string[]>();
for (const q of rows) {
  const f = (q.truth ?? [])[0]?.file;
  if (typeof f !== "string") continue;
  byFile.set(f, [...(byFile.get(f) ?? []), q.id]);
}
const dupes = [...byFile.entries()].filter(([, ids]) => ids.length > 1);
const shapes: Record<string, number> = {};
for (const q of rows) shapes[q.shape] = (shapes[q.shape] ?? 0) + 1;
console.log(`⑷ 题型分布＝${JSON.stringify(shapes)}｜去重后真值文件＝${String(byFile.size)} 个｜重复指向＝${String(dupes.length)} 组${dupes.length ? "：" + dupes.map(([f, ids]) => `${f}(${ids.join("+")})`).join("、") : ""}`);

// ⑸ 这 14 道题的题面**词面长度**分布（问句太短 ⇒ 词面通道拿不到稀有词，那一题实际只在考排名）。
const shortQ = rows.filter((q) => Array.from(String(q.question ?? "")).length < 20);
console.log(`⑸ 问句短于 20 码点的题＝${String(shortQ.length)}/${String(rows.length)}${shortQ.length ? "：" + shortQ.map((q) => q.id).join("、") : ""}`);

console.log("");
console.log("读数用途：这一格是「检索尺的真值面有没有观测者」的分母。上面五个数今天全部落在——");
console.log("  ⑴ 0 条（真值还没腐烂）**是因为还没腐烂，不是因为有人守着**。");
console.log("  ⑷ 的重复指向若 >0，命中率分子里就有一题是同一格的第二次计分。");
