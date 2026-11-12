// Episode 证据基座（Cairn Evolve · P0）：把一次 run 的事件流折成可审计的 Episode。
//
// 这是**纯投影**：给定 events + 外部判据 ⇒ 给定 Episode；不读盘、不取时钟、不调模型。
// 口径（与既有模块同一份事实源）：
//  · 轮界取 `eventsForCurrentRun`（交付断言/信号/成本共同的取料口），worker 子流不替父会话表态；
//  · outcome 缺席 = unknown，不折成 success/failure；隐藏判据 > verify > 用户裁决；
//  · 成本按主面/worker 分列，usd 缺席 = 不可定价，不是 $0；
//  · 任务签名确定性（内容 token + 路径扩展 + 工具骨架），同输入同签名。
//
// 为什么不是事件型：Episode 是事件流的聚合投影，不是 agent 做的一件事。ADR 0005 的判别口诀
// 「这件事发生在日志里还是发生在 agent 身上」——Episode 是读侧算出来的，所以住投影层。

import { digestOf } from "./digest";
import type { AgentEvent } from "../../events";
import { deliveredPaths, eventsForCurrentRun } from "../delivery-guard";
import { assistantTurnsFromEvents, goalDriftFindings } from "../goal-drift";
import { isRecord } from "../../is-record";

export const EPISODE_VERSION = 1 as const;
export const EPISODE_POLICY_VERSION = "evolve-v1";

export type EpisodeTaskClass =
  | "edit" | "debug" | "refactor" | "test" | "explain" | "research" | "ops" | "ui" | "other";
export type EpisodeFinal = "success" | "failure" | "unknown";
export type EpisodeArm = "none" | "control" | "treatment" | "shadow";
export type EpisodeAssignmentSource = "meta" | "sidecar" | "absent" | "invalid";
export type EpisodeJudge = "pass" | "fail" | "unknown";
export type EpisodeUser = "accepted" | "rejected" | "unknown";
export type EpisodeOutcomeSource = "judge" | "verify" | "user_feedback" | "unmeasured";

export interface EpisodeAssignment {
  source: EpisodeAssignmentSource;
  experimentId: string | null;
  arm: EpisodeArm;
  propensity: number | null;
  policyVersion: string;
  injectedExperienceIds: string[];
  injectedChars: number;
}

export interface EpisodeRunRef {
  startEventId: number;
  endEventId: number;
  logPath: string;
  logSha256: string | null;
}

export interface EpisodeTask {
  signature: string;
  class: EpisodeTaskClass;
  intentExcerpt: string;
  tokens: string[];
}

export interface EpisodeAssembly {
  harnessRev: string | null;
  configDigest: string | null;
  model: string | null;
  provider: string | null;
  tier: string | null;
}

export interface EpisodeOutcomeRecord {
  verify: "green" | "red" | "none";
  judge: EpisodeJudge;
  user: EpisodeUser;
  final: EpisodeFinal;
}

export interface EpisodeCost {
  tokensIn: number;
  tokensOut: number;
  /** 主面（无 agent_id）与 worker 面分列；worker 不并进主面比值。 */
  mainTokens: number;
  workerTokens: number;
  requests: number;
  /** 缺席 = 不可定价，不是 $0。 */
  usd: number | null;
  /** 缺席 = 没有可比的起止时刻，不是 0ms。 */
  durationMs: number | null;
  toolCalls: number;
}

export interface EpisodeEvidence {
  verifyCauses: Record<string, number>;
  failedToolCalls: number;
  stuckSignals: string[];
  touchedPaths: string[];
  /** 主会话实际调过的工具名（去重排序）：shadow 的 on-tool 触发与任务签名共用这一列。 */
  toolNames: string[];
  /** 主会话当前轮的工具序列骨架（name + 参数键集，不带值）：P4 技能合成的最小原料。 */
  toolSequence: string[];
  /** run 中途注入过的经验 id（verify 红 / 卡死提醒）：与起点 assignment 的注入面分开记。
   *  旧 Episode 没有这一格 ⇒ undefined；观测账按两者并集记 trial。 */
  nudgedExperienceIds?: string[];
  diffDigest: string | null;
}

export interface EpisodeRecord {
  v: typeof EPISODE_VERSION;
  id: string;
  ts: number;
  workspace: string;
  sessionId: string;
  run: EpisodeRunRef;
  task: EpisodeTask;
  assembly: EpisodeAssembly;
  outcome: EpisodeOutcomeRecord;
  cost: EpisodeCost;
  evidence: EpisodeEvidence;
  assignment: EpisodeAssignment;
}

export interface ProjectEpisodeInput {
  events: readonly AgentEvent[];
  workspace: string;
  sessionId: string;
  logPath: string;
  logSha256?: string | null;
  /** 观测时刻（epoch ms）；必填，避免投影层偷用本机时钟。 */
  observedAt: number;
  startedAt?: number | null;
  endedAt?: number | null;
  assembly?: Partial<EpisodeAssembly>;
  judge?: EpisodeJudge | null;
  user?: EpisodeUser | null;
  /** 显式分配（运行时 sidecar 或实验编排）；缺省 = 从 session_meta.evolve 读，再缺省 absent。 */
  assignment?: EpisodeAssignment;
}

const TASK_CLASS_RULES: readonly { class: EpisodeTaskClass; re: RegExp }[] = [
  { class: "debug", re: /(修|报错|错误|失败|排查|定位|bug|error|fail(?:ed|ure)?|fix|debug|regression|crash)/iu },
  { class: "test", re: /(测试|单元测试|test|vitest|jest|coverage|断言)/iu },
  { class: "refactor", re: /(重构|refactor|rename|extract|重命名)/iu },
  { class: "ui", re: /(界面|样式|侧栏|css|组件|ui|ux|布局|design|render)/iu },
  { class: "research", re: /(研究|调研|论文|竞品|选型|search|research|compare)/iu },
  { class: "ops", re: /(部署|构建|ci|gate|脚本|终端|deploy|build|release)/iu },
  { class: "explain", re: /(解释|为什么|怎么理解|explain|why|what is)/iu },
];

const STOPWORDS: ReadonlySet<string> = new Set([
  "the", "and", "for", "with", "this", "that", "from", "into", "are", "was", "were", "has", "have",
  "you", "your", "our", "its", "not", "but", "can", "will", "would", "should", "could", "about",
  "我", "你", "他", "她", "它", "的", "了", "和", "与", "并", "请", "帮", "把", "在", "是", "要",
  "就", "也", "都", "一个", "一下", "然后", "需要",
]);

/** 任务分类：规则先于模型；无法归类时 edit（有内容）/ other（空）。 */
export function classifyTask(content: string): EpisodeTaskClass {
  const text = content.trim();
  if (text.length === 0) return "other";
  for (const rule of TASK_CLASS_RULES) {
    if (rule.re.test(text)) return rule.class;
  }
  return "edit";
}

/** 任务 token：小写、去重、去停用词、有界；保留首次出现顺序供检索。 */
export function taskTokens(content: string): string[] {
  const raw = content.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of raw) {
    if (token.length < 2 || STOPWORDS.has(token) || seen.has(token)) continue;
    seen.add(token);
    out.push(token);
    if (out.length >= 24) break;
  }
  return out;
}

/** 任务签名：token + 改动路径扩展 + 工具骨架；同输入同输出，不含具体参数值。 */
export function taskSignature(
  tokens: readonly string[],
  touchedPaths: readonly string[],
  toolNames: readonly string[],
): string {
  const exts = [...new Set(touchedPaths.map(extensionOf).filter((e) => e !== ""))].sort();
  return digestOf(JSON.stringify({
    tokens: [...tokens].slice(0, 12).sort(),
    exts,
    tools: [...toolNames],
  }));
}

function extensionOf(path: string): string {
  const base = path.split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot < 0 ? "" : base.slice(dot + 1).toLowerCase();
}

function isWorkerEvent(event: AgentEvent): boolean {
  return typeof (event as { agent_id?: unknown }).agent_id === "string";
}

function isSteeringMessage(event: AgentEvent): boolean {
  return event.type === "user_message" && event.origin?.kind === "steering";
}

function noneAssignment(source: EpisodeAssignmentSource): EpisodeAssignment {
  return {
    source,
    experimentId: null,
    arm: "none",
    propensity: null,
    policyVersion: EPISODE_POLICY_VERSION,
    injectedExperienceIds: [],
    injectedChars: 0,
  };
}

function parseAssignment(value: unknown): Omit<EpisodeAssignment, "source"> | null {
  if (!isRecord(value)) return null;
  const experimentId = value.experimentId;
  if (experimentId !== null && typeof experimentId !== "string") return null;
  const arm = value.arm;
  if (arm !== "none" && arm !== "control" && arm !== "treatment" && arm !== "shadow") return null;
  const propensity = value.propensity;
  if (propensity !== null
    && (typeof propensity !== "number" || !Number.isFinite(propensity) || propensity < 0 || propensity > 1)) {
    return null;
  }
  const policyVersion = value.policyVersion;
  if (typeof policyVersion !== "string" || policyVersion.length === 0) return null;
  const ids = value.injectedExperienceIds;
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string")) return null;
  const chars = value.injectedChars;
  if (typeof chars !== "number" || !Number.isInteger(chars) || chars < 0) return null;
  return { experimentId, arm, propensity, policyVersion, injectedExperienceIds: [...ids], injectedChars: chars };
}

/** 会话装配身份里的实验分配；缺席 = 本场不在实验中（不是对照组），坏形状 fail-closed 为 none。 */
export function assignmentFromEvents(events: readonly AgentEvent[]): EpisodeAssignment {
  for (const event of events) {
    if (event.type !== "session_meta") continue;
    const raw = (event as { evolve?: unknown }).evolve;
    if (raw === undefined) continue;
    const parsed = parseAssignment(raw);
    return parsed === null ? noneAssignment("invalid") : { ...parsed, source: "meta" };
  }
  return noneAssignment("absent");
}

function lastMainModel(events: readonly AgentEvent[]): string | null {
  let model: string | null = null;
  for (const event of events) {
    if (event.type !== "usage" || event.agent_id !== undefined) continue;
    if (typeof event.model === "string" && event.model.length > 0) model = event.model;
  }
  return model;
}

function stuckSignalsOf(events: readonly AgentEvent[]): string[] {
  const out = new Set<string>();

  let prevShape: string | null = null;
  let shapeRun = 0;
  for (const event of events) {
    if (event.type !== "tool_call") continue;
    const shape = event.name + "(" + Object.keys(event.args).sort().join(",") + ")";
    if (shape === prevShape) shapeRun += 1;
    else { prevShape = shape; shapeRun = 1; }
    if (shapeRun >= 2) out.add("repeat-action");
  }

  let prevCause: string | null = null;
  let causeRun = 0;
  for (const event of events) {
    if (event.type !== "verify_result") continue;
    if (event.ok) { prevCause = null; causeRun = 0; continue; }
    const cause = event.cause ?? "unknown";
    if (cause === prevCause) causeRun += 1;
    else { prevCause = cause; causeRun = 1; }
    if (causeRun >= 3) out.add("verify-cause-streak:" + cause);
  }

  if (goalDriftFindings(assistantTurnsFromEvents(events)).length > 0) out.add("goal-drift");
  return [...out].sort();
}

/** 把一次 run 折成 Episode。纯函数；不读盘、不取时钟、不调模型。 */
/** 结局优先级：判卷 > 验证 > 用户信号 > 未知。**唯一实现**——后加的用户反馈覆盖层
 *  必须复用同一条优先级，否则「同一场 run」在录制时与回读时给出两种结局。 */
export function finalOutcomeOf(
  judge: EpisodeJudge,
  verify: EpisodeOutcomeRecord["verify"],
  user: EpisodeUser,
): EpisodeFinal {
  if (judge === "pass") return "success";
  if (judge === "fail") return "failure";
  if (verify === "green") return "success";
  if (verify === "red") return "failure";
  if (user === "accepted") return "success";
  if (user === "rejected") return "failure";
  return "unknown";
}

/** 结局归因来源：与 `finalOutcomeOf` 严格同一条优先级（judge > verify > user_feedback > unmeasured）。
 *  用于汇总与报告面把「这批结局到底是谁判的、有多少是未测的」显式拆开，不把不同证据强度的信号混成一团。 */
export function outcomeSourceOf(
  outcome: Pick<EpisodeOutcomeRecord, "judge" | "verify" | "user">,
): EpisodeOutcomeSource {
  if (outcome.judge === "pass" || outcome.judge === "fail") return "judge";
  if (outcome.verify === "green" || outcome.verify === "red") return "verify";
  if (outcome.user === "accepted" || outcome.user === "rejected") return "user_feedback";
  return "unmeasured";
}

export function projectEpisode(input: ProjectEpisodeInput): EpisodeRecord {
  // 当前轮（含 worker）负责成本/事件边界；主面（去 worker）负责任务/结局/证据。
  const withWorkers = eventsForCurrentRun(input.events, { includeWorkers: true });
  const main = eventsForCurrentRun(input.events);
  const startIndex = withWorkers.length === 0 ? Math.max(0, input.events.length - 1) : input.events.indexOf(withWorkers[0]!);
  const startEventId = withWorkers.length === 0 ? 0 : startIndex + 1;
  const endEventId = withWorkers.length === 0 ? 0 : startIndex + withWorkers.length;

  const userMessage = main.find(
    (event): event is Extract<AgentEvent, { type: "user_message" }> => event.type === "user_message" && !isSteeringMessage(event),
  );
  const content = userMessage?.content ?? "";
  const tokens = taskTokens(content);
  const touchedPaths = [...deliveredPaths(main)].sort();
  const toolNames = main.filter((event) => event.type === "tool_call").map((event) => event.name);
  const toolSequence = main
    .filter((event): event is Extract<AgentEvent, { type: "tool_call" }> => event.type === "tool_call")
    .map((event) => event.name + "(" + Object.keys(event.args).sort().join(",") + ")");

  const verifyResults = main.filter(
    (event): event is Extract<AgentEvent, { type: "verify_result" }> => event.type === "verify_result",
  );
  const lastVerify = verifyResults[verifyResults.length - 1];
  const verify: EpisodeOutcomeRecord["verify"] =
    lastVerify === undefined ? "none" : lastVerify.ok ? "green" : "red";
  const judge: EpisodeJudge = input.judge ?? "unknown";
  const user: EpisodeUser = input.user ?? "unknown";
  const final: EpisodeFinal = finalOutcomeOf(judge, verify, user);

  const verifyCauses: Record<string, number> = {};
  for (const result of verifyResults) {
    if (result.ok) continue;
    const cause = result.cause ?? "unknown";
    verifyCauses[cause] = (verifyCauses[cause] ?? 0) + 1;
  }

  let tokensIn = 0;
  let tokensOut = 0;
  let mainTokens = 0;
  let workerTokens = 0;
  let requests = 0;
  for (const event of withWorkers) {
    if (event.type !== "usage") continue;
    requests += 1;
    tokensIn += event.inputTokens;
    tokensOut += event.outputTokens;
    const total = event.inputTokens + event.outputTokens;
    if (event.agent_id === undefined) mainTokens += total;
    else workerTokens += total;
  }

  const assemblyInput = input.assembly ?? {};
  const model = assemblyInput.model === undefined ? lastMainModel(main) : assemblyInput.model;
  const provider = assemblyInput.provider ?? null;
  const tier = assemblyInput.tier ?? null;
  const configDigest = assemblyInput.configDigest === undefined
    ? (model === null && provider === null && tier === null ? null : digestOf(JSON.stringify({ model, provider, tier })))
    : assemblyInput.configDigest;

  const startedAt = input.startedAt;
  const endedAt = input.endedAt;
  const durationMs = typeof startedAt === "number" && Number.isFinite(startedAt)
    && typeof endedAt === "number" && Number.isFinite(endedAt) && endedAt >= startedAt
    ? endedAt - startedAt
    : null;

  return {
    v: EPISODE_VERSION,
    id: "ep_" + digestOf(
      [input.workspace, input.sessionId, String(startEventId), String(endEventId), input.logSha256 ?? ""].join("\0"),
    ),
    ts: input.observedAt,
    workspace: input.workspace,
    sessionId: input.sessionId,
    run: {
      startEventId,
      endEventId,
      logPath: input.logPath,
      logSha256: input.logSha256 ?? null,
    },
    task: {
      signature: taskSignature(tokens, touchedPaths, toolNames),
      class: classifyTask(content),
      intentExcerpt: content.replace(/\s+/gu, " ").trim().slice(0, 400),
      tokens,
    },
    assembly: {
      harnessRev: assemblyInput.harnessRev ?? null,
      configDigest,
      model,
      provider,
      tier,
    },
    outcome: { verify, judge, user, final },
    cost: {
      tokensIn,
      tokensOut,
      mainTokens,
      workerTokens,
      requests,
      usd: null,
      durationMs,
      toolCalls: toolNames.length,
    },
    evidence: {
      verifyCauses,
      failedToolCalls: main.filter((event) => event.type === "tool_result" && !event.ok).length,
      stuckSignals: stuckSignalsOf(main),
      touchedPaths,
      toolNames: [...new Set(toolNames)].sort(),
      toolSequence,
      nudgedExperienceIds: [...new Set(main.flatMap((event) =>
        event.type === "tool_result" && event.nudgeExperienceIds !== undefined ? event.nudgeExperienceIds : []))].sort(),
      diffDigest: null,
    },
    assignment: input.assignment ?? assignmentFromEvents(input.events),
  };
}

/** 单条经验的观测账：注入了它、且那一场结局可测的次数。
 *  `lastUsedAt` 与结果无关——用了就是用了（recency 排序要的是最后一次注入，不是最后一次成功）。 */
export interface ExperienceObservationStat {
  trials: number;
  successes: number;
  failures: number;
  lastUsedAt: number;
}

/** 从 Episode 账折出观测账（纯函数）：同一条经验在同一场只记一次；
 *  结局未知的场次只更新 lastUsedAt，不进 trials（与「不可测 ≠ 0」同一道门）。
 *  读侧叠加用户反馈后的 Episode 进来，赞/踩会按既有 finalOutcomeOf 优先级反映到 success/failure。 */
export function observationalStatsOf(
  episodes: readonly EpisodeRecord[],
): Map<string, ExperienceObservationStat> {
  const out = new Map<string, ExperienceObservationStat>();
  for (const episode of episodes) {
    const ids = new Set([
      ...episode.assignment.injectedExperienceIds,
      ...(episode.evidence.nudgedExperienceIds ?? []),
    ]);
    if (ids.size === 0) continue;
    const measurable = episode.outcome.final !== "unknown";
    for (const id of ids) {
      const stat = out.get(id) ?? { trials: 0, successes: 0, failures: 0, lastUsedAt: episode.ts };
      if (measurable) {
        stat.trials += 1;
        if (episode.outcome.final === "success") stat.successes += 1;
        else stat.failures += 1;
      }
      stat.lastUsedAt = Math.max(stat.lastUsedAt, episode.ts);
      out.set(id, stat);
    }
  }
  return out;
}
