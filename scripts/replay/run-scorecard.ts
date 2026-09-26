// 复跑面 · 登记项 `replay:run-scorecard`（判卷读数：每个 run 一行结果卡——这轮到底有没有把代码改到能跑）
//
// 这条面补的是能力 10 的空位：现役六个复跑面量的都是**分布**（ask 密度、gate 留痕、verify 归因、
// 时延、在途 worker…），没有一条回答「这一轮成功了吗」。所以评估一直没有 y 轴——想知道只能新做任务
// 花真钱跑，而**已经付过钱**的真实轨迹里的事件序列一直没人读结论。这条面把那份数据变成
// 逐 run 的终态 + 返工轮数：免费的 y 轴基线，也是「从失败轨迹中学习」的可计分母。
//
// 三条口径纪律（每条都有用例钉着，不是注释里的承诺）：
//  ⑴ 「算不算写过盘」复用 `mayHaveWrittenDisk`（唯一事实源）。自己抄一份两名字清单，
//     就会把「只经 shell 改代码」的 run 判成 no-write ⇒ 分母反过来骗人。
//  ⑵ 环境拍（`isEnvVerifyCause`）不记在模型账上：既不算 ended-red、也不算返工，
//     而且**不进成功率的分母**——这是 P1-3 归因落盘的消费面；它有没有挣到自己的钱，看这条。
//  ⑶ 主会话与 worker 子流分开算（worker 事件带 `agent_id`）：混在一起算，一个读数就同时代表两拨人。
//  三态守卫同 join-lapse：零语料 / 全是 no-write ⇒ 红着退出说「不可测」，不许读成「成功率 0」。
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentEvent } from "../../src/events";
import { isEnvVerifyCause } from "../../src/events";
import { mayHaveWrittenDisk } from "../../src/agent/write-face";
import { bucketsSpendUsd, priceForModel, type SpendBucket } from "../../src/agent/orchestrator-join";
import { readJsonl, scanCorpus, zeroCorpusProblem } from "./corpus";
import { armOfPath, groupPairs, magnitudeOfAb, parseArm, taskKey, abRowLine, repRowLine, signTestToken, type ArmOf } from "../lib/eval-arms";

export type RunOutcome =
  | "green-first-try"
  | "green-after-rework"
  | "ended-red"
  | "env-blocked"
  | "wrote-never-verified"
  | "no-write";

/** 封闭枚举：新增一档忘了进这里，用例即红（免得"未知终态"被静默归进某一档）。 */
export const RUN_OUTCOMES: readonly RunOutcome[] = [
  "green-first-try",
  "green-after-rework",
  "ended-red",
  "env-blocked",
  "wrote-never-verified",
  "no-write",
];

export interface RunScore {
  outcome: RunOutcome;
  /** 成功的、会改本工作区盘的工具结果数（`mayHaveWrittenDisk` 判）。 */
  writes: number;
  /** 验证拍总数（含环境拍）。 */
  beats: number;
  /** 记在模型账上的红拍（红且非环境归因）。 */
  codeRed: number;
  /** 环境红拍：不记模型账，单独报出。 */
  envRed: number;
  /** 被后续改动回应过的代码红拍数（「说它不行，它又改了一次」）。 */
  reworkRounds: number;
  /** 最后一条**能定终态**的拍（绿或代码红；环境拍不占位）。 */
  decisive: "green" | "code-red" | "none";
  /** 这一流的用量合计（token 轴；美元轴见 `costOf`）。**加性字段**：终态判定不读它，两轴互不污染。 */
  usage: UsageTotals;
}

/** 一条流的用量合计。
 *  口径全部来自 `UsageEvent` 的注释，不是我自己定的：
 *  · `inputTokens` 是**含缓存的总输入**，`cacheRead/Write` 是其中的分块 ⇒ 不许再加一遍；
 *  · 缓存分块**缺字段 = 那个 provider 没上报，不等于 0** ⇒ 缺报要单独计数报出来，
 *    否则「缓存命中率 0%」会被读成"这轮真的一次没命中"（规则 95：字段注释里的 null 是判据不是说明）。 */
export interface UsageTotals {
  usageEvents: number;
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheWrite: number;
  cacheReadUnreported: number;
  cacheWriteUnreported: number;
  /** 带着 `model` 的 usage 事件条数（能定价的前提）。语料里这条**实测为 0** ⇒ 美元轴不可测，见 `costOf`。 */
  modelAttributed: number;
  /** 逐条 usage 事件的定价输入，交给唯一的那把真钱尺（`bucketsSpendUsd`）。 */
  buckets: SpendBucket[];
}

export function usageOfStream(events: readonly AgentEvent[]): UsageTotals {
  const t: UsageTotals = {
    usageEvents: 0, inputTokens: 0, outputTokens: 0,
    cacheRead: 0, cacheWrite: 0,
    cacheReadUnreported: 0, cacheWriteUnreported: 0,
    modelAttributed: 0, buckets: [],
  };
  for (const e of events) {
    if (e.type !== "usage") continue;
    t.usageEvents += 1;
    t.inputTokens += Math.max(0, e.inputTokens);
    t.outputTokens += Math.max(0, e.outputTokens);
    if (typeof e.cacheReadInputTokens === "number") t.cacheRead += Math.max(0, e.cacheReadInputTokens);
    else t.cacheReadUnreported += 1;
    if (typeof e.cacheWriteInputTokens === "number") t.cacheWrite += Math.max(0, e.cacheWriteInputTokens);
    else t.cacheWriteUnreported += 1;
    const model = (e as { model?: unknown }).model;
    if (typeof model === "string" && model !== "") {
      t.modelAttributed += 1;
      t.buckets.push({ usage: { inputTokens: e.inputTokens, outputTokens: e.outputTokens }, price: priceForModel(model) });
    } else {
      // 没有 model 就没法查价表：交一个 `price: null` 的桶给真钱尺，
      // 由它按「真实但算不出」计进 unpricedTokens——**不在这里折成 $0**。
      t.buckets.push({ usage: { inputTokens: e.inputTokens, outputTokens: e.outputTokens }, price: null });
    }
  }
  return t;
}

/** 钱轴"不可测"的三种成因。**修法各不同**（补语料 / 写侧补 model 归因 / 补价表档位），
 *  所以必须是字段：以前只有 `reason` 一句话区分，判卷面就只能去 `toContain` 那半句——
 *  而「model」「语料」这种词在本仓有几十处副本，改了另一处断言照样绿（第 92 页量的那格）。 */
export type CostCause = "" | "no-usage" | "no-attribution" | "unpriced-bucket";

export interface CostReading {
  /** false ⇒ `usd` 一定是 null，且 `cause` 必须说清缺哪一面（`reason` 给人看，`cause` 给判据用）。 */
  measurable: boolean;
  usd: number | null;
  /** 未定价 token 数（真实存在但算不出价的那部分）。 */
  unpricedTokens: number;
  cause: CostCause;
  reason: string;
}

/** 美元轴。**有 usage 事件却一条都定不了价 ⇒ null，不是 0**——
 *  本仓点名的假绿形状："不可知记成免费"。这条守卫的用例是负控：166 条无 model 的 usage 必须读出"不可测"。 */
export function costOf(totals: readonly UsageTotals[]): CostReading {
  const usageEvents = totals.reduce((n, t) => n + t.usageEvents, 0);
  const attributed = totals.reduce((n, t) => n + t.modelAttributed, 0);
  const buckets = totals.flatMap((t) => t.buckets);
  if (usageEvents === 0) {
    return { measurable: false, usd: null, unpricedTokens: 0, cause: "no-usage", reason: "语料里一条 usage 事件都没有 ⇒ 没有钱轴（不是没花钱）" };
  }
  if (attributed === 0) {
    // 未定价的 token 量从**合计字段**取，而不是再把桶加一遍：桶是按 usage 一条一个建出来的，
    // 但调用方完全可能只给出合计数（比如从旧快照重建）——两种来源都得读出同一个"这些钱花过、算不出"。
    const tokens = totals.reduce((n, t) => n + t.inputTokens + t.outputTokens, 0);
    return {
      measurable: false, usd: null, unpricedTokens: tokens, cause: "no-attribution",
      reason: `${String(usageEvents)} 条 usage 事件里没有一条带 model 归因 ⇒ 查不到价表键（价表的键是档位 id，模型名必须先经 priceForModel 反查）。` +
        `写侧补齐归因之前，$/成功任务只能报不可测；token 轴仍可读。`,
    };
  }
  const spent = bucketsSpendUsd(buckets);
  if (spent === null) {
    return { measurable: false, usd: null, unpricedTokens: buckets.length, cause: "unpriced-bucket", reason: "全部桶都算不出价（未注册档位或价表漂移）⇒ 不折成 $0" };
  }
  return {
    measurable: true, usd: spent.usd, unpricedTokens: spent.unpricedTokens, cause: "",
    reason: attributed < usageEvents ? `只有 ${String(attributed)}/${String(usageEvents)} 条能定价 ⇒ 这是**下界**，不是实付` : "",
  };
}

/** 一条流（主会话或单个 worker 子流）的结果卡。纯函数，不做 IO。 */
export function scoreStream(events: readonly AgentEvent[]): RunScore {
  const calls = new Map<string, { name: string; args: Record<string, unknown> }>();
  const writeAt: number[] = [];
  const beatAt: { i: number; ok: boolean; env: boolean }[] = [];
  events.forEach((e, i) => {
    if (e.type === "tool_call") {
      calls.set(e.id, { name: e.name, args: (e.args ?? {}) as Record<string, unknown> });
      return;
    }
    if (e.type === "tool_result") {
      const c = calls.get(e.callId);
      if (e.ok && c !== undefined && mayHaveWrittenDisk(c.name, c.args)) writeAt.push(i);
      return;
    }
    if (e.type === "verify_result") {
      const env = !e.ok && isEnvVerifyCause(e.cause);
      beatAt.push({ i, ok: e.ok, env });
    }
  });

  const codeRedBeats = beatAt.filter((b) => !b.ok && !b.env);
  const lastWrite = writeAt.length > 0 ? writeAt[writeAt.length - 1] : -1;
  const reworkRounds = codeRedBeats.filter((b) => lastWrite > b.i).length;
  const decisiveBeat = [...beatAt].reverse().find((b) => b.ok || !b.env);
  const decisive: RunScore["decisive"] = decisiveBeat === undefined ? "none" : decisiveBeat.ok ? "green" : "code-red";

  let outcome: RunOutcome;
  if (writeAt.length === 0) outcome = "no-write";
  else if (beatAt.length === 0) outcome = "wrote-never-verified";
  else if (decisive === "none") outcome = "env-blocked";
  else if (decisive === "code-red") outcome = "ended-red";
  else outcome = reworkRounds === 0 ? "green-first-try" : "green-after-rework";

  return {
    outcome,
    writes: writeAt.length,
    beats: beatAt.length,
    codeRed: codeRedBeats.length,
    envRed: beatAt.filter((b) => b.env).length,
    reworkRounds,
    decisive,
    usage: usageOfStream(events),
  };
}

export interface StreamRow {
  agentId: string;
  events: AgentEvent[];
}

/** 主会话流与 worker 子流分开：带 `agent_id` 的按 id 归组，不带的算主会话。 */
export function splitStreams(events: readonly AgentEvent[]): { main: AgentEvent[]; workers: StreamRow[] } {
  const main: AgentEvent[] = [];
  const byId = new Map<string, AgentEvent[]>();
  for (const e of events) {
    const id = (e as { agent_id?: string }).agent_id;
    if (typeof id === "string" && id !== "") {
      const arr = byId.get(id);
      if (arr === undefined) byId.set(id, [e]);
      else arr.push(e);
    } else main.push(e);
  }
  return { main, workers: [...byId.entries()].map(([agentId, ev]) => ({ agentId, events: ev })) };
}

/** 「臂 × 任务」的一格：一个文件＝一次 run（它的主会话与 worker 子流合起来算这一格）。 */
export interface ArmCell {
  arm: ArmOf;
  task: string;
  file: string;
  judged: number;
  green: number;
  tokens: number;
}

/** 逐文件压成格子。臂由**路径**决定（目录名＝实验条件），任务键由文件名决定 ⇒ 两条臂跑同一个任务才能对着看。 */
export function armCells(perFile: readonly { file: string; scored: readonly { agentId: string; score: RunScore }[] }[]): ArmCell[] {
  return perFile.map((p) => {
    const scores = p.scored.map((s) => s.score);
    const judgedRows = scores.filter((s) => s.outcome !== "no-write" && s.decisive !== "none");
    return {
      arm: parseArm(armOfPath(p.file)),
      task: taskKey(p.file),
      file: p.file,
      judged: judgedRows.length,
      green: judgedRows.filter((s) => s.decisive === "green").length,
      tokens: scores.reduce((n, s) => n + s.usage.inputTokens + s.usage.outputTokens, 0),
    };
  });
}

export interface ScorecardAggregate {
  /** 所有流（主会话 + worker）的条数。 */
  rows: number;
  byOutcome: Record<RunOutcome, number>;
  /** 写过盘的流（= 闭环能力真正的分母）。 */
  closedLoopRuns: number;
  /** 有可定终态的拍、能算成功率的流（环境拍与从未验证的流都不在其中）。 */
  judged: number;
  green: number;
  /** green / judged；judged=0 时为 null（不是 0）。 */
  greenRate: number | null;
  /** 写过盘但拿不出终态证据的流：wrote-never-verified + env-blocked。 */
  unproven: number;
  /** 中位返工轮数（只算写过盘的流）；无样本为 null。 */
  medianRework: number | null;
  /** token 轴。**分母与成功率完全同一套**（同一条面算两个轴，避免两把尺各算各的分母）。 */
  usageEvents: number;
  tokensJudged: number;
  tokensPerJudged: number | null;
  /** 「最省 token」的真正读数：每**一次成功**花多少 token。green=0 时为 null（不是 0）。 */
  tokensPerGreen: number | null;
  /** 缓存分块缺报的 usage 条数：缺报≠命中 0（规则 95）。 */
  cacheUnreported: number;
  /** 美元轴；不可测时 `usd=null` 并带原因，绝不折成 $0。 */
  cost: CostReading;
}

/** 逐档计数 + 显式分母。任何比值都带着它的分母字段，不让人拿一个百分比就外推。 */
export function aggregateScorecard(rows: readonly RunScore[]): ScorecardAggregate {
  const byOutcome = Object.fromEntries(RUN_OUTCOMES.map((o) => [o, 0])) as Record<RunOutcome, number>;
  for (const r of rows) byOutcome[r.outcome] += 1;
  const closedLoop = rows.filter((r) => r.outcome !== "no-write");
  const judgedRows = closedLoop.filter((r) => r.decisive !== "none");
  const green = judgedRows.filter((r) => r.decisive === "green").length;
  const reworks = closedLoop.map((r) => r.reworkRounds).sort((a, b) => a - b);
  /** token 轴只在**与成功率同一分母**上算：问答流（no-write）、拿不出终态证据的流都不在其中，
   *  否则"每次成功花多少 token"会与被悄悄扩大的分母一起变小。 */
  const greenRows = judgedRows.filter((r) => r.decisive === "green");
  const sumTokens = (rs: readonly RunScore[]): number =>
    rs.reduce((n, r) => n + r.usage.inputTokens + r.usage.outputTokens, 0);
  const tokensJudged = sumTokens(judgedRows);
  const usageOf = (rs: readonly RunScore[]): UsageTotals =>
    rs.reduce<UsageTotals>((acc, r) => ({
      usageEvents: acc.usageEvents + r.usage.usageEvents,
      inputTokens: acc.inputTokens + r.usage.inputTokens,
      outputTokens: acc.outputTokens + r.usage.outputTokens,
      cacheRead: acc.cacheRead + r.usage.cacheRead,
      cacheWrite: acc.cacheWrite + r.usage.cacheWrite,
      cacheReadUnreported: acc.cacheReadUnreported + r.usage.cacheReadUnreported,
      cacheWriteUnreported: acc.cacheWriteUnreported + r.usage.cacheWriteUnreported,
      modelAttributed: acc.modelAttributed + r.usage.modelAttributed,
      buckets: [...acc.buckets, ...r.usage.buckets],
    }), {
      usageEvents: 0, inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0,
      cacheReadUnreported: 0, cacheWriteUnreported: 0, modelAttributed: 0, buckets: [],
    });
  // 一次汇总，多处引用（各调一次会把"同一读数抄三遍"这种漂移留在自己代码里）。
  const allUsage = usageOf(rows);
  return {
    rows: rows.length,
    byOutcome,
    closedLoopRuns: closedLoop.length,
    judged: judgedRows.length,
    green,
    greenRate: judgedRows.length === 0 ? null : green / judgedRows.length,
    unproven: byOutcome["wrote-never-verified"] + byOutcome["env-blocked"],
    medianRework: reworks.length === 0 ? null : reworks[Math.floor(reworks.length / 2)],
    usageEvents: allUsage.usageEvents,
    tokensJudged,
    tokensPerJudged: judgedRows.length === 0 ? null : Math.round(tokensJudged / judgedRows.length),
    tokensPerGreen: greenRows.length === 0 ? null : Math.round(sumTokens(greenRows) / greenRows.length),
    cacheUnreported: allUsage.cacheReadUnreported + allUsage.cacheWriteUnreported,
    // 钱轴按**全部流**汇总（不只 judged）：钱花在没成功的 run 上更要报出来。
    cost: costOf(rows.map((r) => r.usage)),
  };
}

/** 「不可测」的三种成因，修法各不同：`no-streams`＝语料/面没取到东西（没有尺）；
 *  `no-writes`＝读的是问答流（换面或换任务）；`no-decisive-beat`＝写过盘但没留终态证据（等 run 跑完）。
 *  判据要问"为什么不可测"，所以它是字段；`reason` 给人看。 */
export type VerdictCause = "" | "no-streams" | "no-writes" | "no-decisive-beat";

export interface ScorecardVerdict {
  measurable: boolean;
  cause: VerdictCause;
  reason: string;
}

/** 「没语料」「没改过盘」与「改了但没成」必须长成三个不同的样子。 */
export function scorecardVerdict(rows: readonly RunScore[]): ScorecardVerdict {
  if (rows.length === 0) {
    return { measurable: false, cause: "no-streams", reason: "语料里一条 run 流都没读到（不是成功率 0，是没有尺）" };
  }
  const closed = rows.filter((r) => r.outcome !== "no-write").length;
  if (closed === 0) {
    return {
      measurable: false,
      cause: "no-writes",
      reason: `${String(rows.length)} 条流没有一条改过盘 ⇒ 闭环成功率无从谈起（读的是问答流，不是失败）`,
    };
  }
  const judged = rows.filter((r) => r.outcome !== "no-write" && r.decisive !== "none").length;
  if (judged === 0) {
    return {
      measurable: false,
      cause: "no-decisive-beat",
      reason:
        `${String(closed)} 条改过盘的流里，没有一条留下能定终态的验证拍` +
        `（全在 wrote-never-verified / env-blocked）⇒ 只能报"证据缺席"，不能报成功率`,
    };
  }
  return { measurable: true, cause: "", reason: "" };
}

function main(): void {
  const scan = scanCorpus();
  const empty = zeroCorpusProblem(scan);
  if (empty !== null) {
    console.error("⚠️ run-scorecard 读数无意义：" + empty);
    process.exitCode = 1;
    return;
  }
  const perFile = scan.files.map((f) => {
    const { main: mainEvents, workers } = splitStreams(readJsonl(f) as readonly AgentEvent[]);
    const streams: StreamRow[] = [{ agentId: "(main)", events: mainEvents }, ...workers];
    return { file: f, scored: streams.map((s) => ({ agentId: s.agentId, score: scoreStream(s.events) })) };
  });
  const flat = perFile.flatMap((p) => p.scored.map((s) => s.score));
  const v = scorecardVerdict(flat);
  const agg = aggregateScorecard(flat);
  console.log(
    "run-scorecard：文件 " + String(perFile.length) + " · 流 " + String(agg.rows) +
      "（写过盘 " + String(agg.closedLoopRuns) + "，能定终态 " + String(agg.judged) + "）",
  );
  for (const o of RUN_OUTCOMES) console.log("  " + o.padEnd(22) + " " + String(agg.byOutcome[o]));
  console.log(
    "  成功率 " + (agg.greenRate === null ? "不可测" : (agg.greenRate * 100).toFixed(0) + "%") +
      "（分母=能定终态的 " + String(agg.judged) + " 条）· 证据缺席 " + String(agg.unproven) +
      " · 返工中位 " + String(agg.medianRework ?? "—"),
  );
  // 准确率与代价**并列**报出：只报成功率就等于不报"这一轮花了多少"（本仓定死的报数口径）。
  console.log(
    "  token 轴：每条能定终态 " + String(agg.tokensPerJudged ?? "—") +
      " · 每**一次成功** " + String(agg.tokensPerGreen ?? "不可测（green=0）") +
      " · usage 事件 " + String(agg.usageEvents) + "（其中缓存分块缺报 " + String(agg.cacheUnreported) + " 条——缺报≠命中 0）",
  );
  console.log("  钱轴：" + (agg.cost.measurable
    ? "$" + String(agg.cost.usd) + (agg.cost.reason === "" ? "" : "（" + agg.cost.reason + "）")
    : "不可测 —— " + agg.cost.reason));
  if (!v.measurable) {
    console.error("❌ 不可测：" + v.reason);
    process.exitCode = 1;
    return;
  }
  // —— 分臂 + 配对。上面那两行是**池化**读数，而池子里有几条臂就得说几次：
  // 同一任务的两条臂（A/B）与同配置的多次重复，读法相反（前者看差值，后者看抖动是否复现）。
  const cells = armCells(perFile);
  const armAgg = new Map<string, { arm: ArmOf; files: number; judged: number; green: number; tokens: number }>();
  for (const c of cells) {
    const prev = armAgg.get(c.arm.arm) ?? { arm: c.arm, files: 0, judged: 0, green: 0, tokens: 0 };
    prev.files += 1;
    prev.judged += c.judged;
    prev.green += c.green;
    prev.tokens += c.tokens;
    armAgg.set(c.arm.arm, prev);
  }
  console.log("  —— 分臂（池化值跨 " + String(armAgg.size) + " 条臂 ⇒ 只能当上下界，不是某一臂的表现）");
  for (const a of [...armAgg.values()].sort((x, y) => x.arm.arm.localeCompare(y.arm.arm))) {
    console.log(
      "    " + a.arm.arm.padEnd(28) +
        " 文件=" + String(a.files).padStart(2) +
        " 能定终态=" + String(a.judged).padStart(2) +
        " 绿=" + String(a.green).padStart(2) +
        " 成功率=" + (a.judged === 0 ? "不可测" : ((a.green / a.judged) * 100).toFixed(0) + "%").padStart(4) +
        " token/成功=" + (a.green === 0 ? "—" : String(Math.round(a.tokens / a.green))) +
        " 族=" + a.arm.family + (a.arm.variant === null ? "（无变体后缀）" : ""),
    );
  }
  const pairs = groupPairs(cells);
  const abPairs = pairs.filter((g) => g.hasAb);
  const repPairs = pairs.filter((g) => !g.hasAb);
  const labelsOf = (g: (typeof pairs)[number]) => g.cells.map((c) =>
    (c.arm.variant ?? "rep" + String(c.arm.rep)) + "=" +
    (c.judged === 0 ? "不可判" : c.green > 0 ? "绿" : "红") + "/" + String(c.tokens) + "tk");
  console.log("  —— 配对的格子：A/B " + String(abPairs.length) + " 格 ｜ 同配置重复 " + String(repPairs.length) + " 格");
  const abMags = abPairs.map((g) => {
    const m = magnitudeOfAb(g);
    console.log(abRowLine(m, labelsOf(g)));
    return m;
  });
  for (const g of repPairs) console.log(repRowLine(magnitudeOfAb(g), labelsOf(g)));
  // 引用资格汇总：数字留在上面，但"能不能当结论用"由这一行说。
  const citable = abMags.filter((m) => m.verdict === "citable").length;
  const st = signTestToken(abMags);
  console.log(
    "  —— 幅度引用资格：可引用 " + String(citable) + "/" + String(abMags.length) + " 格" +
      "（底只认**本格同变体的重复**；借他格/他族的抖动不算 ⇒ 补底要花真钱，见 #18）",
  );
  console.log(
    "     token 轴符号：" + (st.tokenDirection === null
      ? "无从统计（可比格 " + String(st.pairs) + " · 同值 " + String(st.ties) + " · 证据缺席 " + String(st.skipped) + " ⇒ 0 分母不读成 0%）"
      : "「" + st.tokenDirection.sign + "」（以排序靠前的变体为参照）" +
        String(st.tokenDirection.agree) + "/" + String(st.pairs) + " 格同向" +
        " · 反向 " + String(st.tokenDirection.against) + " · 同值 " + String(st.ties) +
        " · 证据缺席 " + String(st.skipped) + " ⇒ 方向可报，倍率仍按上行判"),
  );
  if (abPairs.length === 0) {
    console.log("    （没有可配对的 A/B 格 ⇒ 策略差要等各臂把任务补齐；不许拿两条不同任务的臂算差值）");
  }
  for (const p of perFile) {
    const wrote = p.scored.filter((s) => s.score.outcome !== "no-write");
    if (wrote.length === 0) continue;
    console.log("  " + p.file.split("/").slice(-2).join("/"));
    for (const s of wrote) {
      console.log(
        `    ${s.agentId.padEnd(12)} ${s.score.outcome.padEnd(22)} 写=${String(s.score.writes)}` +
          ` 拍=${String(s.score.beats)} 代码红=${String(s.score.codeRed)} 环境红=${String(s.score.envRed)}` +
          ` 返工=${String(s.score.reworkRounds)}`,
      );
    }
  }
  process.exitCode = 0;
}

// 只在直接执行时跑读数：判卷要 import 纯函数，模块加载不得有副作用（也不该扫盘）。
const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
