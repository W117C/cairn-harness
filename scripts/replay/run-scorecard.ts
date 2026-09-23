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
import { readJsonl, scanCorpus, zeroCorpusProblem } from "./corpus";

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
}

/** 逐档计数 + 显式分母。任何比值都带着它的分母字段，不让人拿一个百分比就外推。 */
export function aggregateScorecard(rows: readonly RunScore[]): ScorecardAggregate {
  const byOutcome = Object.fromEntries(RUN_OUTCOMES.map((o) => [o, 0])) as Record<RunOutcome, number>;
  for (const r of rows) byOutcome[r.outcome] += 1;
  const closedLoop = rows.filter((r) => r.outcome !== "no-write");
  const judgedRows = closedLoop.filter((r) => r.decisive !== "none");
  const green = judgedRows.filter((r) => r.decisive === "green").length;
  const reworks = closedLoop.map((r) => r.reworkRounds).sort((a, b) => a - b);
  return {
    rows: rows.length,
    byOutcome,
    closedLoopRuns: closedLoop.length,
    judged: judgedRows.length,
    green,
    greenRate: judgedRows.length === 0 ? null : green / judgedRows.length,
    unproven: byOutcome["wrote-never-verified"] + byOutcome["env-blocked"],
    medianRework: reworks.length === 0 ? null : reworks[Math.floor(reworks.length / 2)],
  };
}

export interface ScorecardVerdict {
  measurable: boolean;
  reason: string;
}

/** 「没语料」「没改过盘」与「改了但没成」必须长成三个不同的样子。 */
export function scorecardVerdict(rows: readonly RunScore[]): ScorecardVerdict {
  if (rows.length === 0) {
    return { measurable: false, reason: "语料里一条 run 流都没读到（不是成功率 0，是没有尺）" };
  }
  const closed = rows.filter((r) => r.outcome !== "no-write").length;
  if (closed === 0) {
    return {
      measurable: false,
      reason: `${String(rows.length)} 条流没有一条改过盘 ⇒ 闭环成功率无从谈起（读的是问答流，不是失败）`,
    };
  }
  const judged = rows.filter((r) => r.outcome !== "no-write" && r.decisive !== "none").length;
  if (judged === 0) {
    return {
      measurable: false,
      reason:
        `${String(closed)} 条改过盘的流里，没有一条留下能定终态的验证拍` +
        `（全在 wrote-never-verified / env-blocked）⇒ 只能报"证据缺席"，不能报成功率`,
    };
  }
  return { measurable: true, reason: "" };
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
  if (!v.measurable) {
    console.error("❌ 不可测：" + v.reason);
    process.exitCode = 1;
    return;
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
