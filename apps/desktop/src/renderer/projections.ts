// 投影纯函数（spec §3.4：UI 状态 = AgentEvent[] 的纯投影）的**门面**。
//
// 真身在 derived/：那层只吃事件流、只吐视图数据——不读时钟、不取随机、不做 IO、不留模块级可变态
// （契约见 src/renderer/LAYERING.md 的 I3）。本文件**只做逐名转发**，不改任何名字与签名：
// 调用点与判卷一律仍从 "./projections" 取，导出面一字未动。
//
// 为什么留门面而不是让调用点改口：投影是渲染层最被依赖的一面（15 个渲染模块 + 17 个判卷文件），
// 改口 = 一次纯搬家的改动里混进几十处无关 diff ⇒ 判卷红时说不清是"搬错了"还是"改错了"。
// 门面把"搬家"与"改口"解耦：真身换地方，外部一个字符都不用改。
export {
  elapsedSecondsFor,
  isMainSessionTerminalEvent,
  isWorkerSubflowEvent,
  mergeSessionSnapshot,
  popoutEventBelongsTo,
  roundOfEvent,
  userTextOfRound,
  userVisibleText,
} from "./derived/session";
export type { StreamRow } from "./derived/stream";
export { projectStream } from "./derived/stream";
export {
  countRunSteps,
  countToolSteps,
  deriveRunPhase,
  formatRevertNotice,
  hasAssistantTextThisRun,
  pendingClarifyOf,
  pendingPlanOf,
  runPhaseLabel,
} from "./derived/run";
export type { RunPhase } from "./derived/run";
export { usageAggregate, usageSummary } from "./derived/usage";
export type { UsageSummary } from "./derived/usage";
export { roundTimeline, timelineItems } from "./derived/timeline";
export type { TimelineItem } from "./derived/timeline";
export {
  deliveryTrail,
  restoredPathsOf,
  turnChanges,
  turnDelivery,
} from "./derived/trail";
export type {
  DeliveryTrailItem,
  TurnDelivery,
  TurnVerificationEvidence,
  TurnVerificationStatus,
} from "./derived/trail";
// relativeTime 用 `new Date(tsMs)`：从**显式时间戳**构造日期（不读当前时钟），但派生层
// I3 的静态扫描按 token 禁 `new Date` ⇒ 它不进 derived/，住在渲染层顶层的本文件里，
// 由门面转发。判据唯一处：relative-time.ts（另一个同名函数在 memory-view.ts，参数序不同）。
export { relativeTime } from "./relative-time";
