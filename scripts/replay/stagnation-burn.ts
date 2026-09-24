// 复跑面 · 登记项 `replay:stagnation-burn`
// （判卷读数：真语料里「同一条验证结论连红、中间没改过盘」发生了没有，以及它和「修复额度耗尽」同不同流）
//
// 为什么要这一条读数：`src/agent/no-progress.ts` 里有一只 outcome-shaped 的停滞检测器
// （R1：同 signature 连红 + 中间零落盘 ⇒ 停滞），阈值、误伤负样本、门 `no-progress-check` 都有，
// 但它在 **src/ 里零消费者**——产品路径上一个都没接（本仓点名的「只有验收脚本在调」那一族）。
// 主 loop 今天对「同一结论再红一次」的判断是另一把更窄的尺：`digest === lastVerifyDigest`
// （只比**相邻**两拍的**逐字**摘要），命中时只换注入文案，**额度照旧扣**。
// ⇒ 要不要把 R1 接进主 loop，之前只能靠感觉。这条面给的是分母：语料里出现过几次停滞、
//   它有没有和「额度打满」落在同一条流上。
//
// 三条口径纪律：
//  ⑴ **不另造谓词**：停滞与否只问 `detectVerifyStagnation`（现成那一只，含 `wroteSinceLast`
//     与 `userSpokeSinceLast` 两道抑制）。本文件自己只回读字段：红拍数、以及 loop 自己盖在
//     `attempt` 上的账（绿拍与环境拍都不推进它，所以「推进了」就等于"这一拍记在模型修复额度上"）。
//  ⑵ 每流只报**第一段**停滞（那只谓词就是这么设计的），所以 `停滞流数` 是**下界**：
//     本面能证明「≥1 次」，不能证明「一共几次」。偏小方向写在这里，别拿它当总量引用。
//  ⑶ 「停滞」与「额度打满」只报**同流共现**，不报因果——顺序不在本面读数范围内。
//
// 三态守卫同 `run-scorecard`：零语料 / 自检失败 ⇒ 红着退出，不许读成「没有停滞」。
// 复跑：TERM=dumb node --import tsx scripts/replay/stagnation-burn.ts
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentEvent } from "../../src/events";
import { isEnvVerifyCause } from "../../src/events";
import { detectVerifyStagnation, verifyBeatsFromEvents, type VerifyBeat } from "../../src/agent/no-progress";
import { readJsonl, scanCorpus, zeroCorpusProblem } from "./corpus";
import { splitStreams } from "./run-scorecard";

export interface StreamStagnation {
  agentId: string;
  beats: number;
  redBeats: number;
  /** 红拍里由 `isEnvVerifyCause` 判成环境类的那些（这台机器跑不了验证，不是模型写错）。 */
  envRedBeats: number;
  /** **未归因**红拍：事件上根本没有 `cause` 字段。产品口径是"缺席按 code 算"（零行为），
   *  但对这把尺而言它意味着"看不见"——语料早于归因落盘时，把这一栏并进 code 会造出假结论。 */
  unattributedRedBeats: number;
  /** 红拍里**真被归因成代码**的那些（= redBeats − env − unattributed）。停滞压力只该对这一栏说话。 */
  codeRedBeats: number;
  /** 记进模型修复额度的红拍数（`attempt` 相对前一拍有推进的那些）。 */
  chargedRedBeats: number;
  /** 有没有出现「attempt 已达 maxAttempts」的红拍 = 修复额度打满。 */
  capped: boolean;
  stagnant: boolean;
  repeats: number;
  signature: string;
}

/** 一条流（主会话或某个 worker 子流）的读数：只做计数与字段回读，判定全交给现成谓词。 */
export function scanStream(agentId: string, events: readonly AgentEvent[]): StreamStagnation {
  const beats = verifyBeatsFromEvents(events as unknown as readonly Record<string, unknown>[]);
  const reds = beats.filter((b) => !b.ok);
  let prev = 0;
  let charged = 0;
  let capped = false;
  for (const b of reds) {
    if (b.attempt > prev) {
      charged += 1;
      prev = b.attempt;
    }
    if (b.attempt >= b.maxAttempts) capped = true;
  }
  // **cause 分栏（这一栏才是本面的决定性读数）**：R1 只看「同结论连红 + 中间零落盘」，
  // 它不看这一拍是谁的账。直接把它接到主 loop，就会对着一台跑不了验证的机器说"你卡住了"——
  // 而环境红不占额度、不该驱动任何"换路子"的压力（judgment-layer 的第一顺位）。
  const asRec = events as unknown as readonly Record<string, unknown>[];
  /** 三态：环境 / 代码（真被归因成 code）/ 未归因（字段缺席）。把"缺席"并进 code 是产品的记账口径，
   *  不是本面的读数口径——那份合并会让"语料根本没记 cause"读成"停滞全在代码红上"（本轮实踩）。 */
  const causeOf = (b: VerifyBeat): { kind: "env" | "code" | "unattributed" } => {
    const e = asRec[b.index] as { results?: { ok?: boolean; cause?: string }[] } | undefined;
    const firstFailed = (e?.results ?? []).find((r) => r.ok === false);
    if (firstFailed?.cause === undefined) return { kind: "unattributed" };
    return { kind: isEnvVerifyCause(firstFailed.cause as never) ? "env" : "code" };
  };
  const kinds = reds.map(causeOf);
  const envReds = kinds.filter((k) => k.kind === "env").length;
  const unattrReds = kinds.filter((k) => k.kind === "unattributed").length;
  const codeReds = reds.length - envReds - unattrReds;
  const v = detectVerifyStagnation(beats, 2);
  return {
    agentId,
    beats: beats.length,
    redBeats: reds.length,
    envRedBeats: envReds,
    unattributedRedBeats: unattrReds,
    codeRedBeats: codeReds,
    chargedRedBeats: charged,
    capped,
    stagnant: v.stagnant,
    repeats: v.stagnant ? v.repeats : 0,
    signature: v.stagnant ? v.signature.slice(0, 90) : "",
  };
}

export interface StagnationVerdict {
  measurable: boolean;
  reason: string;
  /** 该不该把 R1 接进主 loop 的裁决行（判据写死在这里，不靠读表的人自己判断）。 */
  decision: string;
}

export function stagnationVerdict(rows: readonly StreamStagnation[], files: number): StagnationVerdict {
  if (files === 0 || rows.length === 0) {
    return { measurable: false, reason: "语料里一条流都没读到 ⇒ 这不是「没有停滞」，是没有尺", decision: "不判" };
  }
  const withRed = rows.filter((r) => r.redBeats > 0);
  if (withRed.length === 0) {
    return {
      measurable: false,
      reason: `${String(rows.length)} 条流里没有一条红拍 ⇒ 停滞判据无从成立（读的是问答/一次绿跑，不是「没卡死」）`,
      decision: "不判",
    };
  }
  const stagnant = withRed.filter((r) => r.stagnant);
  // 决定性的一刀在 cause 上：R1 不看这一拍是谁的账。停滞若只落在环境红上，
  // 接进主 loop 等于对着一台跑不了验证的机器说"你卡住了"——那是误伤，不是换路压力。
  const stgCode = stagnant.filter((r) => r.codeRedBeats > 0);
  const stgUnattr = stagnant.filter((r) => r.codeRedBeats === 0 && r.unattributedRedBeats > 0);
  const stgEnvOnly = stagnant.filter((r) => r.codeRedBeats === 0 && r.unattributedRedBeats === 0);
  const decision = stagnant.length === 0
    ? `空载：${String(withRed.length)} 条有红拍的流里 0 条出现停滞 ⇒ 接主 loop 今天量不到，` +
      "只署名并指出复现器（fixtures/no-progress 的真实录制），不动内核"
    : stgCode.length > 0
      ? `该接：${String(stgCode.length)} 条流在**已归因的代码红**上出现停滞` +
        `（其中 ${String(stgCode.filter((r) => r.capped).length)} 条同流额度打满）⇒ ` +
        "主 loop 该问现成那一只谓词，而不是只比相邻两拍的逐字摘要；接入时环境拍必须另走抑制"
      : stgUnattr.length > 0
        ? `量不到：${String(stgUnattr.length)} 条停滞流上的红拍**没有 cause 字段**` +
          `（语料早于归因落盘；全语料未归因红拍 ${String(rows.reduce((a, r) => a + r.unattributedRedBeats, 0))} 个）⇒ ` +
          "既不能读成「停滞都来自代码红」，也不能读成「来自环境」。先拿到跑过新码的语料（e2e / mock 即免费）再判"
        : `先别接：语料里 ${String(stgEnvOnly.length)} 条停滞**全部落在已归因的环境红上** ⇒ ` +
          "直接接到主 loop 会把「这台机器跑不了验证」说成「你卡住了」。前置是先给 R1 加 cause 抑制，再重跑本面";
  return { measurable: true, reason: "", decision };
}

/** 每次跑都注入的自检（规则 74）：合成对照，一条必须被抓、一条必须不被抓、字段回读必须有手。
 *  少了它，「0 条停滞」完全兼容「尺是瞎的」。 */
export function selfCheck(): string[] {
  const problems: string[] = [];
  const red = (attempt: number, cause?: string, maxAttempts = 3): Record<string, unknown> => ({
    type: "verify_result", callId: "v" + String(attempt), ok: false, attempt, maxAttempts,
    results: [{ command: "pnpm test", ok: false, ...(cause === undefined ? {} : { cause }), output: "FAIL src/a.test.ts: expected 1 to be 2" }],
  });
  const call = (name: string): Record<string, unknown> => ({ type: "tool_call", id: "w1", name, args: {} });
  const write = (): Record<string, unknown> => ({ type: "tool_result", callId: "w1", name: "write_file", ok: true, output: "written" });
  const asEvents = (rows: readonly Record<string, unknown>[]): AgentEvent[] => rows as unknown as AgentEvent[];
  // ① 红→红且中间零落盘 ⇒ 必须判停滞
  const stuck = [red(1), red(2)];
  if (!scanStream("(stuck)", asEvents(stuck)).stagnant) {
    problems.push("自检 ①「红-红无落盘」没判成停滞（尺是瞎的，下面的读数不作数）");
  }
  // ② 红→改盘→红 ⇒ 那是换路子试，不许判停滞（误伤一次 = 把模型的正当修法叫停）
  const moving = [red(1), call("write_file"), write(), red(2)];
  if (scanStream("(moving)", asEvents(moving)).stagnant) {
    problems.push("自检 ②「红-写-红」被判成停滞 ⇒ 会误伤正常修法");
  }
  // ③ 额度账的回读要有手：两拍 attempt 1→2 ⇒ 记进额度的红拍 = 2
  const s = scanStream("(stuck)", asEvents(stuck));
  if (s.redBeats !== 2 || s.chargedRedBeats !== 2) {
    problems.push("自检 ③ attempt 回读失真（红拍 " + String(s.redBeats) + " / 记账 " + String(s.chargedRedBeats) + "，应为 2/2）");
  }
  // ④ 触顶那一栏也要有手：attempt 打到 maxAttempts ⇒ capped
  if (!scanStream("(capped)", asEvents([red(1), red(2), red(3)])).capped) {
    problems.push("自检 ④ 额度打满没被读出（capped 恒假 ⇒ 共现那一栏永远空）");
  }
  // ⑤ cause 分栏必须有分辨力：环境红两拍（无落盘）也会被判停滞，但 codeRedBeats 要等于 0
  const envStuck = scanStream("(env)", asEvents([red(1, "pkg-manager"), red(2, "pkg-manager")]));
  if (!envStuck.stagnant || envStuck.codeRedBeats !== 0 || envStuck.envRedBeats !== 2) {
    problems.push("自检 ⑤ 环境红停滞分不出来（env=" + String(envStuck.envRedBeats) +
      " code=" + String(envStuck.codeRedBeats) + "，应为 2/0）⇒ 裁决会把机器故障说成模型卡死");
  }
  // ⑥ 反向那一侧：**已归因成 code** 的红拍不许被并进环境或未归因（否则"该接"那一支永远不会真）
  const stuckCode = [red(1, "code"), red(2, "code")];
  const codeStuck = scanStream("(code)", asEvents(stuckCode));
  if (codeStuck.codeRedBeats !== 2 || codeStuck.envRedBeats !== 0 || codeStuck.unattributedRedBeats !== 0) {
    problems.push("自检 ⑥ 已归因代码红被分错栏（code=" + String(codeStuck.codeRedBeats) + "，应为 2）");
  }
  // ⑦ 第三态：cause 字段缺席 = **未归因**，既不算环境也不算代码（本轮实踩：老语料全在这一栏，
  //    并进 code 会让尺把"数据缺失"读成"停滞都来自代码红"，进而给出错误的"该接"裁决）
  const unattr = scanStream("(unattr)", asEvents(stuck));
  if (unattr.unattributedRedBeats !== 2 || unattr.codeRedBeats !== 0) {
    problems.push("自检 ⑦ 未归因红拍没分出来（unattributed=" + String(unattr.unattributedRedBeats) +
      " code=" + String(unattr.codeRedBeats) + "，应为 2/0）");
  }
  // ⑧ 裁决本身：同样一条停滞，红拍未归因 ⇒ 必须说"量不到"；已归因代码红 ⇒ 必须说"该接"。
  //    两格只差 cause 字段在不在——这就是本面看得见的那条分歧。
  const vUnattr = stagnationVerdict([unattr], 1).decision;
  const vCode = stagnationVerdict([codeStuck], 1).decision;
  if (!vUnattr.startsWith("量不到")) problems.push("自检 ⑧ 未归因那一格没落到「量不到」，读到的裁决是：" + vUnattr.slice(0, 40));
  if (!vCode.startsWith("该接")) problems.push("自检 ⑧b 已归因代码红的停滞没落到「该接」，读到的裁决是：" + vCode.slice(0, 40));
  return problems;
}

function main(): void {
  const scan = scanCorpus();
  const empty = zeroCorpusProblem(scan);
  if (empty !== null) {
    console.error("⚠️ stagnation-burn 读数无意义：" + empty);
    process.exitCode = 1;
    return;
  }
  const problems = selfCheck();
  for (const p of problems) console.error("❌ 自检失败：" + p);
  const rows: StreamStagnation[] = [];
  for (const f of scan.files) {
    const { main: mainEvents, workers } = splitStreams(readJsonl(f) as AgentEvent[]);
    rows.push(scanStream("(main)", mainEvents));
    for (const w of workers) rows.push(scanStream(w.agentId, w.events));
  }
  const v = stagnationVerdict(rows, scan.files.length);
  const withRed = rows.filter((r) => r.redBeats > 0);
  const stagnant = rows.filter((r) => r.stagnant);
  console.log(
    "stagnation-burn：文件 " + String(scan.files.length) + " · 流 " + String(rows.length) +
      "（有红拍 " + String(withRed.length) + " · 停滞 " + String(stagnant.length) +
      " · 停滞且同流额度打满 " + String(stagnant.filter((r) => r.capped).length) + "）",
  );
  console.log(
    "  红拍合计 " + String(withRed.reduce((a, r) => a + r.redBeats, 0)) +
      "（已归因代码 " + String(withRed.reduce((a, r) => a + r.codeRedBeats, 0)) +
      " / 环境 " + String(withRed.reduce((a, r) => a + r.envRedBeats, 0)) +
      " / **未归因（无 cause 字段）** " + String(rows.reduce((a, r) => a + r.unattributedRedBeats, 0)) + "）" +
      " · 记进额度的红拍 " + String(withRed.reduce((a, r) => a + r.chargedRedBeats, 0)) +
      " · 触顶流 " + String(rows.filter((r) => r.capped).length),
  );
  for (const r of stagnant.slice(0, 8)) {
    console.log("  · " + r.agentId.padEnd(10) + " 连红 " + String(r.repeats) + " 次 · 额度打满 " +
      (r.capped ? "是" : "否") + " · 代码/环境/未归因红拍 " +
      String(r.codeRedBeats) + "/" + String(r.envRedBeats) + "/" + String(r.unattributedRedBeats) +
      " · signature: " + r.signature);
  }
  if (v.measurable) console.log("  裁决：" + v.decision);
  else console.error("❌ 不可测：" + v.reason);
  if (problems.length > 0 || !v.measurable) process.exitCode = 1;
}

// 只有被直接执行时才跑（被 import 时一个字节都不许多做——规则 110）。
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
