// 派生层·运行面（纯投影）：事件流 → 相位/门/步数等运行读数。
// I3 契约：只吃 AgentEvent[]，只吐值；不读时钟、不取随机、不做 IO、不留模块级可变态。
import type { AgentEvent } from "../../../../../src/main/ipc-protocol";
import type { ClarifyQuestion, PlanProposal } from "../../../../../src/events";
import { isWorkerSubflowEvent } from "./session";

export type RunPhase = "idle" | "thinking" | "tool" | "ask" | "clarify" | "plan";

/** 尾扫判据（v2 语义钉死）：pending 三参任一 true ⇒ 对应门相位，ask 优先级最高；
 * 否则从尾向头扫——未决 tool_call（其后无同 id 的 tool_result）⇒ "tool"；
 * 晚于最后 tool_result 的 assistant_delta ⇒ "thinking"（扫描途中已见 result 的 delta 一律跳过，
 * 那些是「早于最后 tool_result」的 delta，判据不成立）；error 在尾部 ⇒ "idle"（error 行自呈现，不再判忙）。
 * pendingClarify/pendingPlan 带缺省 false：M1 的两参调用式（App.tsx 与 M1 存量用例）保持可编译，
 * 任务书 Interfaces 的四参调用式逐字可用。
 */
export function deriveRunPhase(
  events: readonly AgentEvent[],
  pendingAsk: boolean,
  pendingClarify: boolean = false,
  pendingPlan: boolean = false,
): RunPhase {
  if (pendingAsk) return "ask";
  if (pendingClarify) return "clarify";
  if (pendingPlan) return "plan";
  const seenResults = new Set<string>(); // 尾扫途中已见的 result callId（都晚于当前扫描位）
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    // M3-4 裁定：worker 子流不进相位判据——未决 worker tool_call 不亮「tool」，worker
    // tool_result 也不占用 seenResults（否则它会把「delta 晚于最后 result = thinking」的判据吃掉）。
    if (isWorkerSubflowEvent(e)) continue;
    if (e.type === "tool_result") { seenResults.add(e.callId); continue; }
    if (e.type === "tool_call" && !seenResults.has(e.id)) return "tool";
    if (e.type === "assistant_delta" && seenResults.size === 0) return "thinking";
    if (e.type === "error") return "idle";
  }
  return "idle";
}

/** 本轮（最后一条主会话 user_message 之后）是否已有模型正文。
 *  用途：状态条不能把「正文已经开始/已经输出完、run 还在收尾」继续叫「思考中」。
 *  worker 子流正文不算（父会话唯一接收物是 agent_result）。 */
export function hasAssistantTextThisRun(events: readonly AgentEvent[]): boolean {
  let start = 0;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (isWorkerSubflowEvent(e)) continue;
    if (e.type === "user_message") { start = i; break; }
  }
  for (let i = start; i < events.length; i++) {
    const e = events[i]!;
    if (isWorkerSubflowEvent(e)) continue;
    if (e.type === "assistant_message" && e.content.trim() !== "") return true;
    if (e.type === "assistant_delta" && e.text.trim() !== "") return true;
  }
  return false;
}

/** 状态条那一格的文案（纯函数，好判卷；2026-10-20 从 App.tsx 搬出来）。
 *
 *  口径（逐条，顺序即优先级）：
 *  ① 已停止 ⇒ "已停止"；
 *  ② 三道门在场 ⇒ "等待审批" / "等待澄清" / "等待方案"；
 *  ③ **工具在跑 ⇒ "执行工具"**（这一条排在"收尾中"**之前**——2026-10-20 独立评审追出的 MEDIUM-HIGH：
 *     旧实现先判 `finishing`，而 `finishing` 的第二个条件 `answerQuiet`（正文停了 >1.5s）
 *     **恰好就是"工具在跑"的形状**（模型吐完字就调工具，然后等着它跑完）
 *     ⇒ 任何超过 1.5s 的构建/测试都被报成"收尾中"，而 agent 还在干活。
 *     那条注释自己写着「读错比不读更坏」——报错的相位比不报更坏）；
 *  ④ 正文停了而 run 还在 ⇒ "收尾中"（Stop hook / 安全报告 / 记忆沉淀那几样）；
 *  ⑤ 有正文 ⇒ "生成中"；还没有 ⇒ "思考中"；
 *  ⑥ run 还在但没有正文 ⇒ "思考中"；都不在 ⇒ "就绪"。
 */
export function runPhaseLabel(input: {
  phase: RunPhase;
  stopped: boolean;
  running: boolean;
  /** 本轮已经有模型正文（`hasAssistantTextThisRun`）。 */
  hasAnswerText: boolean;
  /** 正文已停 >1.5s（App 的 `answerQuiet`）。 */
  answerQuiet: boolean;
}): string {
  if (input.stopped) return "已停止";
  if (input.phase === "ask") return "等待审批";
  if (input.phase === "clarify") return "等待澄清";
  if (input.phase === "plan") return "等待方案";
  // 工具在跑 ⇒ 不是收尾（见上：answerQuiet 与"工具在跑"同形）
  if (input.phase === "tool") return "执行工具";
  const finishing = input.running && input.hasAnswerText && (input.phase === "idle" || input.answerQuiet);
  if (finishing) return "收尾中";
  if (input.phase === "thinking") return input.hasAnswerText ? "生成中" : "思考中";
  if (input.running) return input.hasAnswerText ? "收尾中" : "思考中";
  return "就绪";
}

/** 最后一个 clarify_requested，且其后无同 callId 的 tool_result（澄清门的答复按原工具 id 挂回）。
 *  只看最后一个请求：其后已收口 ⇒ null（更早的未决请求不追溯，与门的串行语义一致）。 */
export function pendingClarifyOf(events: readonly AgentEvent[]): { callId: string; questions: ClarifyQuestion[] } | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.type !== "clarify_requested") continue;
    const closed = events.slice(i + 1).some((r) => r.type === "tool_result" && r.callId === e.callId);
    return closed ? null : { callId: e.callId, questions: e.questions };
  }
  return null;
}

/** 最后一个 plan_proposed，且其后无同 callId 的 plan_approved（批准与拒绝都算决议收口）。 */
export function pendingPlanOf(events: readonly AgentEvent[]): { callId: string; plan: PlanProposal } | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.type !== "plan_proposed") continue;
    const closed = events.slice(i + 1).some((r) => r.type === "plan_approved" && r.callId === e.callId);
    return closed ? null : { callId: e.callId, plan: e.plan };
  }
  return null;
}

/** 步数（状态条「N 轮 · M 步」的 M）：主会话 tool_call 计数（worker 子流不计，同 projectStream 口径）。 */
export function countToolSteps(events: readonly AgentEvent[]): number {  let steps = 0;
  for (const e of events) {
    if (e.type === "tool_call" && !isWorkerSubflowEvent(e)) steps += 1;
  }
  return steps;
}

/** 本轮步数（2026-10-18）：最后一个 user_message 之后的 tool_call 数——状态条要的是“这一轮做了几步”。
 *  不能直接拿 countToolSteps（那是整条会话的累计）。工头子流程不计（与累计口径同一谓词）。 */
export function countRunSteps(events: readonly AgentEvent[]): number {
  // 找不到 user_message 时返回 0，而不是把整条会话的历史步数冒充成本轮——状态条宁可空着。
  let start = events.length;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i]!.type === "user_message") { start = i + 1; break; }
  }
  let steps = 0;
  for (let i = start; i < events.length; i += 1) {
    const e = events[i]!;
    if (e.type === "tool_call" && !isWorkerSubflowEvent(e)) steps += 1;
  }
  return steps;
}

/** 文件级回滚（v2.16）的结果提示文案（纯函数，可判卷）：还原/删除两段计数恒在；
 *  manual（轮后又被改过、取不到原件——core 拒绝静默抹掉）与 failed（越界/快照缺失）有货才显，
 *  点名路径——「看不见的降级等于没降级」。 */
export function formatRevertNotice(
  round: number,
  r: { restored: string[]; deleted: string[]; manual: { path: string; why: string }[]; failed: { path: string; error: string }[] },
): string {
  const parts = [`第 ${String(round)} 轮文件回滚：还原 ${String(r.restored.length)} 个、删除 ${String(r.deleted.length)} 个`];
  if (r.manual.length > 0) parts.push(`需手动处理 ${String(r.manual.length)} 个（${r.manual.map((m) => m.path).join("、")}）`);
  if (r.failed.length > 0) parts.push(`失败 ${String(r.failed.length)} 个（${r.failed.map((f) => f.path).join("、")}）`);
  return parts.join("；");
}
