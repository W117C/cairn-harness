// 无进展检测（outcome-shaped）：跑的次数不是证据，**改了东西却没有前进**才是。
//
// 为什么不并进 `stuck.ts`：那两条既有规则量的是「同一个动作又做了一次」（action-shaped，
// OpenHands / Gemini CLI 的口径），本模块量的是「同一个结论又红了一次、而中间什么都没改」
// （outcome-shaped）。公开实现里我没有找到后者（见 outputs/stagnation-detection-2026-09-23/
// 00-读物与缺口.md §5），而本仓自己的录制里就有一条它该抓、既有三条都抓不住的跑。
//
// 分工写死在这里，免得长出一族同义出口：
// - action-shaped 判定（同 action+observation ×4 / 同 action+error ×3）**只住在 `stuck.ts`**；
// - 本模块只新增：验证停滞（R1）、A/B 往返抖动（R3），以及把三者合成一只干预阶梯的 `noProgressLadder`。
//
// 误报是这条能力的头号成本：外部两家 shipped 检测器都公布了阈值、**没有一家公布 precision**，
// 而真实用户投诉两头都有（一次重 grep 被判成环并 exit 1；一段每轮微变的 word-salad 反而没被判住）。
// ⇒ 本模块的每条规则都必须在 `fixtures/no-progress/`（真实录制 + 造出来的对照）上跑过，
//    门 `no-progress-check` 判的就是「正样本报且指名、负样本一条都不报」。

import { detectStuck, stuckActionOf, type StuckVerdict } from "./stuck";

/** 写类工具：只有这些成功过才算「中间真的改过东西」。
 *  名单从 `src/tools/` 的导出面抄一份不如从事件面判：这里只判"有没有落盘动作"，
 *  漏一个名字的后果是把"改过"误判成"没改"⇒ 会**少报**，不会误伤（宁可少报）。 */
const WRITE_TOOLS: ReadonlySet<string> = new Set(["write_file", "edit_file", "apply_patch", "delete_file", "move_file"]);

/** 一条 `verify_result` 的判读视图。 */
export interface VerifyBeat {
  index: number;
  attempt: number;
  maxAttempts: number;
  ok: boolean;
  /** 失败命令 + 归一化后的首条失败行（同一件事再红一次 ⇒ 两只 signature 相等）。 */
  signature: string;
  /** 指名用的原文片段（给模型/人看的证据，不参与相等判定）。 */
  named: string[];
  /** 上一次 verify 到现在有没有成功的写动作。R1 的头号抑制条件。 */
  wroteSinceLast: boolean;
}

/** 归一化：数字 / 长哈希串 / 空白抹平，让「同一个失败」能被认成同一件。
 *  **路径必须留着**：早期版本把路径也抹平，于是「a.test.ts 红了」与「修好后 b.test.ts 红了」
 *  成了同一个签名——那是把**前进**误判成**停滞**，正是这条判据最贵的错法（门里 NP5 钉住它）。
 *  也不许照 `stuckObservationOf` 截前 200 字符逐字比——本仓那条真实红跑两次 verify 的输出
 *  长度是 1,370 与 150（第二次只剩结论行），逐字前缀比较会漏掉它。 */
export function normalizeFailureLine(text: string): string {
  return text
    .replace(/\b0x[0-9a-f]{2,}\b/giu, "#")
    .replace(/\b[0-9a-f]{12,}\b/giu, "#")
    .replace(/\d+/gu, "N")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 160);
}

/** 一条 verify 的 signature：失败命令集合（排序，去掉顺序抖动）+ 每条的首个像错的行。 */
export function verifySignature(results: readonly { command?: string; ok?: boolean; output?: string }[]): { signature: string; named: string[] } {
  const failing = results.filter((r) => r.ok === false);
  const named: string[] = [];
  const keys: string[] = [];
  for (const r of failing) {
    const command = String(r.command ?? "?");
    const lines = String(r.output ?? "").split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
    // 首个"像错"的行优先；全无就取首行（空 results 也是一种确定的状态，不能算成"没发生"）
    const bad = lines.find((l) => /error|fail|exception|cannot|not found|refus|\brc=?[1-9]\b/iu.test(l)) ?? lines[0] ?? "";
    named.push(command + " → " + bad.slice(0, 160));
    keys.push(command + "#" + normalizeFailureLine(bad));
  }
  keys.sort();
  return { signature: keys.join("|"), named };
}

/** 从事件流抽出 verify 节拍（含"两次之间有没有写"）。纯函数：同样的事件必给同样的读数。 */
export function verifyBeatsFromEvents(events: readonly Record<string, unknown>[]): VerifyBeat[] {
  const nameByCall = new Map<string, string>();
  for (const e of events) if (e["type"] === "tool_call") nameByCall.set(String(e["id"] ?? ""), String(e["name"] ?? "?"));
  const beats: VerifyBeat[] = [];
  let wroteSinceLast = false;
  let attempt = 0;
  let maxAttempts = 3;
  events.forEach((e, i) => {
    if (e["type"] === "tool_result") {
      const name = nameByCall.get(String(e["callId"] ?? "")) ?? "";
      if (WRITE_TOOLS.has(name) && e["ok"] !== false) wroteSinceLast = true;
      return;
    }
    if (e["type"] !== "verify_result") return;
    attempt = Number(e["attempt"] ?? attempt + 1);
    maxAttempts = Number(e["maxAttempts"] ?? maxAttempts);
    const results = Array.isArray(e["results"]) ? (e["results"] as { command?: string; ok?: boolean; output?: string }[]) : [];
    const { signature, named } = verifySignature(results);
    beats.push({
      index: i,
      attempt,
      maxAttempts,
      ok: e["ok"] !== false,
      signature: e["ok"] === false ? signature : "ok",
      named,
      wroteSinceLast,
    });
    wroteSinceLast = false;
  });
  return beats;
}

/** R1 验证停滞：连续 ≥minRepeats 次红 verify、失败 signature 全同、且**每次之间都没有成功的写**。
 *  中间有写 = 在换路子试（那是既有 verify 上限该管的事，不是停滞）⇒ 不报。
 *  这一条之所以能既准又没人做过：它要的是"结论没变"而不是"动作没变"。 */
export function detectVerifyStagnation(beats: readonly VerifyBeat[], minRepeats = 2):
  { stagnant: true; repeats: number; signature: string; evidence: string } | { stagnant: false } {
  // 必须在**完整序列**上走：把绿的先 filter 掉，「红-绿-红」就会读成连续两次红——
  // 那等于把"中间曾经绿过一次"这件事实抹掉（本仓测例当场抓住的 bug）。
  let run = 0;
  let lastRed: VerifyBeat | null = null;
  for (const cur of beats) {
    if (cur.ok) { run = 0; lastRed = null; continue; }
    const sameKey = lastRed !== null && cur.signature !== "" && cur.signature === lastRed.signature;
    run = sameKey && !cur.wroteSinceLast ? run + 1 : 1;
    lastRed = cur;
    if (run >= minRepeats) {
      return {
        stagnant: true,
        repeats: run,
        signature: cur.signature,
        evidence: `同一条验证结论连红 ${String(run)} 次且中间没有任何写入：` + cur.named.join("；").slice(0, 400),
      };
    }
  }
  return { stagnant: false };
}

/** R3 A/B 往返抖动：(action, observation) 交替 ≥minCycles 个来回（A B A B ⇒ 2 拍算 1 个来回）。
 *  要的是**成对**交替：单看 action 交替会误伤二分查找（合法地来回读不同位置）。
 *  本仓既有实现里根本没有这一族（外部 OpenHands 有 alternating ≥6 cycles 的规则）。 */
export function detectAlternatingThrash(turns: readonly { action: string; observation: string }[], minCycles = 3):
  { thrashing: true; cycles: number; evidence: string } | { thrashing: false } {
  let cycles = 0;
  for (let i = 2; i < turns.length; i++) {
    const a = turns[i - 2]!, b = turns[i - 1]!, c = turns[i]!;
    const alt = a.action === c.action && a.observation === c.observation && a.action !== b.action;
    cycles = alt ? cycles + 1 : 0;
    if (cycles + 1 >= minCycles) {
      return {
        thrashing: true,
        cycles: cycles + 1,
        evidence: `同一对动作往返 ${String(cycles + 1)} 个来回且观察也回到原值：${a.action.slice(0, 120)} ⇄ ${b.action.slice(0, 120)}`,
      };
    }
  }
  return { thrashing: false };
}

/** 干预阶梯：一次跑里最重该做到哪一步。
 *  外部实测的教训是**误伤有价**（一次重 grep 被判环 ⇒ 警告加 exit 1；loop-breaker 撤掉换来 ±1.4–7.8% 成功率），
 *  所以缺省**绝不主动终止**：终止权在既有的 verify 上限与 maxSteps 手上，本阶梯只出声。 */
export type NoProgressAction = "silent" | "note" | "directive" | "escalate";

export interface NoProgressVerdict {
  action: NoProgressAction;
  /** 报警必须能指名（省了谁/卡在哪一件），不接受"你好像卡住了"。 */
  evidence: string;
  rules: string[];
}

const RANK: Record<NoProgressAction, number> = { silent: 0, note: 1, directive: 2, escalate: 3 };

/** 把三只信号（`stuck.ts` 的 action-shaped + 本模块的 R1/R3）合成一只阶梯。
 *  分级是**按测量给的**，不是按直觉：R1 在真实语料上绿跑零误报 ⇒ 允许 escalate；
 *  R3 在真实语料上零触发（既没证明有用也没证明无害）⇒ 只到 note，等标分够再说。 */
export function noProgressLadder(signals: {
  stuck: StuckVerdict;
  stagnation: ReturnType<typeof detectVerifyStagnation>;
  thrash: ReturnType<typeof detectAlternatingThrash>;
}): NoProgressVerdict {
  const rules: string[] = [];
  let action: NoProgressAction = "silent";
  const evidence: string[] = [];
  const promote = (next: NoProgressAction, rule: string, why: string) => {
    rules.push(rule);
    if (why.length > 0) evidence.push(why);
    if (RANK[next] > RANK[action]) action = next;
  };
  if (signals.stuck.stuck) {
    // 换路指令：既有实现里 worker 走 waiting_input、主会话走 [repeat] 提示，都算 directive 级
    promote("directive", "stuck:" + signals.stuck.rule, `同一动作重复 ${String(signals.stuck.repeats)} 次（rule=${signals.stuck.rule}）`);
  }
  if (signals.stagnation.stagnant) {
    promote("escalate", "verify_stagnation", signals.stagnation.evidence);
  }
  if (signals.thrash.thrashing) {
    promote("note", "alternating_thrash", signals.thrash.evidence);
  }
  return { action, rules, evidence: evidence.join("｜") };
}

/** 语料表里一条样本的期望（门判的就是这张表本身没被改坏）。 */
export interface NoProgressCase {
  /** 事件文件名（住在 `fixtures/no-progress/`）。 */
  file: string;
  /** 该不该报（false = 这是一条**合法**的长跑，报了就是误报）。 */
  expect: "fire" | "silent";
  /** expect=fire 时，必须至少报出这条规则名（不锁死唯一规则：一条链可以同时命中多只）。 */
  rule?: string;
  note: string;
}

/** 跑一只样本：事件 → 三只信号 → 阶梯。门与单测共用这一只，判据不留两份。 */
export function judgeNoProgressEvents(events: readonly Record<string, unknown>[]): NoProgressVerdict & {
  beats: VerifyBeat[];
} {
  const beats = verifyBeatsFromEvents(events);
  const resultByCall = new Map<string, Record<string, unknown>>();
  for (const e of events) if (e["type"] === "tool_result") resultByCall.set(String(e["callId"] ?? ""), e);
  const calls = events.filter((e) => e["type"] === "tool_call");
  // 复用 shipped 的 action-shaped 判据（`stuck.ts`），不另抄一份同义出口
  const stuckTurns = calls.map((c) => {
    const r = resultByCall.get(String(c["id"] ?? ""));
    return {
      action: stuckActionOf(String(c["name"] ?? "?"), (c["args"] ?? {}) as Record<string, unknown>),
      observation: String(r?.["output"] ?? ""),
      ok: r?.["ok"] !== false,
    };
  });
  const turns = calls.map((c) => {
    const r = resultByCall.get(String(c["id"] ?? ""));
    return {
      action: String(c["name"] ?? "?") + " " + JSON.stringify(c["args"] ?? {}).slice(0, 200),
      observation: String(r?.["output"] ?? "").slice(0, 200),
    };
  });
  return {
    ...noProgressLadder({
      stuck: detectStuck(stuckTurns),
      stagnation: detectVerifyStagnation(beats),
      thrash: detectAlternatingThrash(turns),
    }),
    beats,
  };
}
