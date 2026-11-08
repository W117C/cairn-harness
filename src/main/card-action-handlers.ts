// 交互决议面（M3a §10.3 的 card_action 回写协议 + agent:decide / clarify / plan / run-cancel）——
// 拆分面（同 provider-key-inject 先例）：实现从 agent-runner.ts 搬来本轻模块，装配根按原路径继续导出。
// 审批解耦（§4.4.3）：父 turn 结束后仍可应答——落流与路由走编排器绑定管线，不依赖活动 session。
// 本模块不反向依赖装配根：它需要七处活状态（三门 / 会话 emit / 编排器两路 / 取消信号），按回调注入。
import { isEventRef } from "../events";
import type { AgentEvent, ClarifyAnswerMap, EventRef } from "../events";
import { ClarifyGate, PlanGate } from "../agent/gates";
import { Orchestrator, orchestratorForAgent, orchestratorForApproval, orchestratorForMerge, ownedWorktreeAgentIds } from "../agent/orchestrator";
import type { RespawnArgs } from "../agent/recovery";
import { cleanOrphanWorktree, type WorktreeCleanupResult } from "../agent/worktree";
import type { AskScope } from "../permissions";
import type { AskGate } from "./ask-gate";
import { currentWorkspace } from "./state-handlers";

export interface CardActionDeps {
  /** 交互审批门（agent:decide 的落点）。 */
  appAskGate: () => AskGate;
  /** 澄清表单门 / 方案门（各自的 wait 侧仍住装配根，这里只用提交/决议面）。 */
  appClarifyGate: () => ClarifyGate;
  appPlanGate: () => PlanGate;
  /** 当前会话（只需要 emit 一位；无会话 = null ⇒ 决议不落流）。 */
  session: () => { emit: ((e: AgentEvent) => Promise<void>) | null } | null;
  /** 会话级编排器（card_action 的兜底路由）。 */
  activeOrchestrator: () => Orchestrator | null;
  /** 兜底建编排器（只给 respawn 那一支用）。 */
  ensureSessionOrchestrator: () => Promise<Orchestrator | null>;
  /** 交互 run 的取消信号（无活动 run = null，fail-visible）。 */
  interactiveRunAbort: () => AbortController | null;
}

let deps: CardActionDeps | null = null;
/** 装配根启动时注入（可重入：判卷 `vi.resetModules` 重组时按新装配根重注）。 */
export function setCardActionDeps(d: CardActionDeps): void {
  deps = d;
}
function D(): CardActionDeps {
  if (!deps) throw new Error("card-action-handlers: 装配根未注入依赖（唯一入口 setCardActionDeps）");
  return deps;
}

/** IPC "agent:decide" 的处理函数（scope: once / session_kind / always，§10.4 审批卡回写）。 */
export function handleAgentDecide(askId: string, approved: boolean, scope?: AskScope): boolean {
  return D().appAskGate().decide(askId, approved, "user", scope ?? "once");
}

// ---- M3a：card_action 回写协议（§10.3）——审批应答与取消的唯一事件流入口 ----

export interface CardActionRequest {
  cardId: string;
  sourceEventId: number;
  cardType: string;
  action: string;
  payload?: Record<string, unknown>;
  scope?: AskScope;
  targetAgentId?: string;
  /** 卡片来源的真实引用（祖先行时给；旧调用不给 = 来源是当前会话自己的行）。 */
  eventRef?: EventRef;
}

/** card_action 处理：落流（card_action 事件）→ 路由（worker 审批决议 / agent 取消）。
 *  审批解耦（§4.4.3）：父 turn 结束后仍可应答——落流与路由走编排器绑定管线，不依赖活动 session。
 *  §11.7.6：worker scope=always 的 card_action 拒绝落流（先于写入检查，审批保持 pending 可再决议）。 */
export async function handleCardAction(req: CardActionRequest): Promise<{ ok: boolean; error?: string; injected?: boolean }> {
  // P3（审查）：边界形状校验（先于落流）——req=null/缺必备字段时旧实现直接 TypeError 或把垃圾
  // payload 写进会话 JSONL 审计面。路由级失败（未知 agent 等）仍照常落流（审计语义：动作已发生）。
  if (
    typeof req?.cardId !== "string" || req.cardId === "" ||
    typeof req.sourceEventId !== "number" || !Number.isInteger(req.sourceEventId) ||
    typeof req.cardType !== "string" || req.cardType === "" ||
    typeof req.action !== "string" || req.action === ""
  ) {
    return { ok: false, error: "card-action: req 非法（需 cardId/sourceEventId(int)/cardType/action 均为非空合法值）" };
  }
  if (req.eventRef !== undefined && !isEventRef(req.eventRef)) {
    return { ok: false, error: "card-action: eventRef 形状非法" };
  }
  if (req.scope === "always" && req.targetAgentId) {
    return {
      ok: false,
      error: "worker 永不写 always：scope=always 仅主会话可发（§11.7.6），该 card_action 拒绝落流",
    };
  }
  const approvalId =
    req.cardType === "approval"
      ? typeof req.payload?.approval_id === "string"
        ? req.payload.approval_id
        : req.cardId
      : null;
  const orch =
    (req.targetAgentId ? orchestratorForAgent(req.targetAgentId) : null) ??
    (req.targetAgentId ? orchestratorForMerge(req.targetAgentId) : null) ?? // M3b：write worker 终态后 emit 仍须经控制塔路由（合并/评论发生在 done 之后）
    (approvalId ? orchestratorForApproval(approvalId) : null) ??
    D().activeOrchestrator() ??
    // 崩溃恢复重派**只在这一支**允许兜底建编排器：重启后内存里的 session/activeOrchestrator 都归零，
    // 少了这一跳，下面那句 emit 守卫会先一步把「重派」挡在「无可用事件管线」上——恢复卡的按钮
    // 恰好在它唯一要用的场景里点不动。其余动作（审批/取消/合并）仍照旧：路由不到就是路由不到，
    // 不替一个已经不在的 worker 现场凭空建一个编排器。
    (req.action === "respawn" && req.cardType === "agent_result" ? await D().ensureSessionOrchestrator() : null);
  const emit = D().session()?.emit ?? (orch ? (e: AgentEvent) => orch.appendProtocol(e) : null);
  if (!emit) return { ok: false, error: "无可用事件管线（fail-closed）" };
  const event: AgentEvent = {
    type: "card_action",
    card_id: req.cardId,
    source_event_id: req.sourceEventId,
    card_type: req.cardType,
    action: req.action,
    ...(req.payload ? { payload: req.payload } : {}),
    ...(req.scope ? { scope: req.scope } : {}),
    ...(req.targetAgentId ? { target_agent_id: req.targetAgentId } : {}),
    ...(req.eventRef !== undefined ? { source_event_ref: req.eventRef } : {}),
  };
  await emit(event);
  // ---- M3b：合并控制塔 + 评审闭环（diff 卡动作经同一 card_action 协议；合并唯一出口 = git 面板，§4.3）----
  if (req.action === "merge" && req.targetAgentId && (req.cardType === "diff" || req.cardType === "merge_tower")) {
    const owner = orchestratorForMerge(req.targetAgentId);
    if (!owner) return { ok: false, error: "该 agent 无合并控制塔归属（未知或 worktree 已收尾）: " + req.targetAgentId };
    return owner.mergeWorker(req.targetAgentId, { force: req.payload?.force === true });
  }
  if (req.action === "reject" && req.targetAgentId && (req.cardType === "diff" || req.cardType === "merge_tower")) {
    const owner = orchestratorForMerge(req.targetAgentId);
    if (!owner) return { ok: false, error: "该 agent 无合并控制塔归属（未知或 worktree 已收尾）: " + req.targetAgentId };
    return owner.rejectWorker(req.targetAgentId, { keepBranch: req.payload?.keep_branch === true });
  }
  if (req.action === "comment" && req.targetAgentId && req.cardType === "diff") {
    const owner = orchestratorForAgent(req.targetAgentId) ?? orchestratorForMerge(req.targetAgentId);
    if (!owner) return { ok: false, error: "该 agent 无归属编排器: " + req.targetAgentId };
    const path = typeof req.payload?.path === "string" ? req.payload.path : "";
    const line = typeof req.payload?.line === "number" ? req.payload.line : Number(req.payload?.line);
    const body = typeof req.payload?.body === "string" ? req.payload.body : "";
    if (path === "" || !Number.isInteger(line) || (line as number) < 1 || body.trim() === "") {
      return { ok: false, error: "comment 需要 payload{path, line>=1, body 非空}" };
    }
    // diff_comment 落流（§3.4 新事件）→ 定向 user_message 注入 worker 子流（评审闭环；评论回传不挂 turn）
    await emit({ type: "diff_comment", agent_id: req.targetAgentId, path, line: line as number, body, ts: Date.now(), ...(req.eventRef !== undefined ? { source_ref: req.eventRef } : {}) } as AgentEvent);
    const r = await owner.injectComment(req.targetAgentId, path, line as number, body);
    /* injected:false 是真事实，不是失败：worker 取消中 / 已终态且 worktree 已收尾 ⇒ 评论只落流、
       没有进它的子流。这一面曾经被吞成 {ok:true}——界面就只剩「已送进子流」可说，等于把没送达说成送达。 */
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, injected: r.injected, ...(r.injected || !r.error ? {} : { error: r.error }) };
  }
  if (req.action === "clean" && req.cardType === "orphan") {
    const name = typeof req.payload?.name === "string" ? req.payload.name : "";
    if (name === "" || !/^[A-Za-z0-9_-]+$/.test(name)) return { ok: false, error: "orphan clean 需要 payload{name（wt- 后的 agent_id）}" };
    const ws = await currentWorkspace();
    const r: WorktreeCleanupResult = await cleanOrphanWorktree(ws, name, { ownedAgentIds: new Set(ownedWorktreeAgentIds()) });
    return r.removed ? { ok: true } : { ok: false, error: "孤儿 worktree 清理失败：" + (r.error ?? "未知") };
  }
  // ---- M3c 卡死出口一（§4.4.8）：「继续」= card_action(resume) 清除 stuck 态（worker 恢复运行）----
  if (req.action === "resume" && req.targetAgentId) {
    const owner = orchestratorForAgent(req.targetAgentId);
    if (!owner) return { ok: false, error: "该 agent 无归属编排器（未知或已终态）" };
    const okResume = owner.resumeAgent(req.targetAgentId);
    return okResume ? { ok: true } : { ok: false, error: "agent 无卡死态: " + req.targetAgentId };
  }
  // ---- M3c 崩溃恢复出口（§4.4.9）：恢复卡「重派」= 全新 agent_id 按原 spawn 参数再 spawn ----
  if (req.action === "respawn" && req.cardType === "agent_result") {
    const r = req.payload?.respawn as RespawnArgs | undefined;
    if (!r || typeof r.task !== "string" || r.task.trim() === "" || (r.mode !== "read" && r.mode !== "write")) {
      return { ok: false, error: "respawn 需要 payload.respawn（恢复卡原 spawn 参数：mode/task 必填）" };
    }
    const orch = D().activeOrchestrator() ?? (await D().ensureSessionOrchestrator());
    if (!orch) return { ok: false, error: "无可用会话日志（重派需要会话上下文；fail-closed）" };
    const rr = await orch.respawn(r, { callId: "respawn-" + String(Date.now()) });
    return rr.ok ? { ok: true } : { ok: false, error: rr.output };
  }
  if (approvalId !== null) {
    const owner = orchestratorForApproval(approvalId);
    if (!owner) return { ok: false, error: "审批发起编排器已不可达（fail-closed）" };
    const r = owner.decideWorkerApproval(approvalId, req.action === "approve", req.scope ?? "once");
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  }
  if (req.action === "cancel" && req.targetAgentId) {
    const owner = orchestratorForAgent(req.targetAgentId);
    if (!owner) return { ok: false, error: "该 agent 无归属编排器（未知）" };
    const okCancel = owner.cancelAgent(req.targetAgentId);
    return okCancel ? { ok: true } : { ok: false, error: "agent 不存在或已终态: " + req.targetAgentId };
  }
  return { ok: true };
}

/** IPC "agent:clarify" 的处理函数：澄清表单提交，值挂回原 tool_use id（与 turn 解耦）。 */
export function handleClarifySubmit(callId: string, answers: ClarifyAnswerMap): boolean {
  return D().appClarifyGate().submit(callId, answers);
}

/** IPC "agent:plan" 的处理函数：批准/拒绝当前 plan；决议走会话事件管线落盘并推送 UI（plan 卡状态）。 */
export async function handlePlanDecide(approved: boolean, callId?: string): Promise<boolean> {
  const pending = D().appPlanGate().pendingIds;
  const target = callId ?? pending[0];
  const ok = approved ? D().appPlanGate().approve(callId) : D().appPlanGate().reject(callId);
  if (!ok) return false; // P3（审查）：settle=false（陈旧/重复/未知 callId）不落事件——不造「已批准」假记录
  const s = D().session();
  if (s?.emit) {
    const event: AgentEvent = { type: "plan_approved", callId: target ?? "", approved };
    await s.emit(event);
  }
  return ok;
}

/** IPC "agent:run-cancel"（P3 审查）：取消当前交互 run——信号沿 runLoop 轮界/门等待/长驻工具透传；
 *  unattended run 不经此通道（取消归 runTimeout/门控）。无活动交互 run → fail-visible。 */
export function handleRunCancel(): { ok: boolean; error?: string } {
  const c = D().interactiveRunAbort();
  if (!c) return { ok: false, error: "无活动交互 run（取消不可达）" };
  c.abort();
  return { ok: true };
}
