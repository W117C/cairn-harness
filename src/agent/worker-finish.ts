// worker 终态收束（done/failed/cancelled）与资源回收。
//
// 从 orchestrator.ts 拆出：本箱只通过窄注入面访问会话级状态，不反向依赖编排器。
// `orchestrator.ts` 仍保留 `finish` / `releaseWorkerMemory` 薄委托，公开面与判卷锚点不变。
import type { AgentEvent } from "../events";
import { WorkerMergeReview } from "./worker-merge";
import { worktreeDiff, worktreePathFor } from "./worktree";
import { clipWorkerSummary, scanModelOutput, workerVerificationEvidence } from "./worker-report";
import { lastAssistantText } from "./worker-prompt";
import { spentUsdFor } from "./orchestrator-join";
import { workerThreadFields, type WorkerHandle } from "./orchestrator-types";

type TerminalStatus = "done" | "failed" | "cancelled";
type AgentResultEvent = Extract<AgentEvent, { type: "agent_result" }>;

export interface WorkerFinishDeps {
  emit: (e: AgentEvent) => Promise<void>;
  workspace: string;
  rootSignal: AbortSignal;
  safeMode: "off" | "report" | "gate";
  pendingApprovals: Map<string, {
    agentId: string;
    resolve: (r: { approved: boolean; scope: "once"; note?: string }) => void;
    timer: ReturnType<typeof setTimeout>;
    cleanup?: () => void;
  }>;
  diffVersions: Map<string, number>;
  wmr: WorkerMergeReview;
  rewardBandit: (w: WorkerHandle, status: TerminalStatus) => Promise<void>;
  subagentHook: (w: WorkerHandle, event: "SubagentStart" | "SubagentStop") => Promise<string>;
  resolveTerminalWaiters: (agentId: string, status: TerminalStatus, result: AgentResultEvent | null) => void;
  resolveDependents: (agentId: string, status: TerminalStatus) => void;
  notifyIdleIfIdle: () => void;
  dropAgentOwner: (agentId: string) => void;
  dropApprovalOwner: (id: string) => void;
  hasMergeOwner: (agentId: string) => boolean;
}

export class WorkerFinish {
  private readonly deps: WorkerFinishDeps;
  private readonly opts: { emit: (e: AgentEvent) => Promise<void>; workspace: string };
  private readonly safeMode: "off" | "report" | "gate";
  private readonly root: { signal: AbortSignal };
  private readonly pendingApprovals: WorkerFinishDeps["pendingApprovals"];
  private readonly diffVersions: Map<string, number>;
  private readonly wmr: WorkerMergeReview;

  constructor(deps: WorkerFinishDeps) {
    this.deps = deps;
    this.opts = { emit: deps.emit, workspace: deps.workspace };
    this.safeMode = deps.safeMode;
    this.root = { signal: deps.rootSignal };
    this.pendingApprovals = deps.pendingApprovals;
    this.diffVersions = deps.diffVersions;
    this.wmr = deps.wmr;
  }

  private dropAgentOwner(agentId: string): void { this.deps.dropAgentOwner(agentId); }
  private dropApprovalOwner(id: string): void { this.deps.dropApprovalOwner(id); }
  private hasMergeOwner(agentId: string): boolean { return this.deps.hasMergeOwner(agentId); }
  private notifyIdleIfIdle(): void { this.deps.notifyIdleIfIdle(); }
  private async rewardBandit(w: WorkerHandle, status: TerminalStatus): Promise<void> { await this.deps.rewardBandit(w, status); }
  private async subagentHook(w: WorkerHandle, event: "SubagentStart" | "SubagentStop"): Promise<string> {
    return await this.deps.subagentHook(w, event);
  }
  private resolveTerminalWaiters(agentId: string, status: TerminalStatus, result: AgentResultEvent | null): void {
    this.deps.resolveTerminalWaiters(agentId, status, result);
  }
  private resolveDependents(agentId: string, status: TerminalStatus): void {
    this.deps.resolveDependents(agentId, status);
  }

  async finishInner(w: WorkerHandle, status: "done" | "failed" | "cancelled", reason?: string): Promise<void> {
    if (w.finished) return;
    w.finished = true;
    w.closed = false;
    if (w.stuckTimer !== null) {
      clearTimeout(w.stuckTimer);
      w.stuckTimer = null;
    }
    const settlePendingApprovals = (terminal: "done" | "failed" | "cancelled"): void => {
      for (const [id, p] of this.pendingApprovals) {
        if (p.agentId === w.agentId) {
          clearTimeout(p.timer);
          p.cleanup?.();
          this.dropApprovalOwner(id);
          this.pendingApprovals.delete(id);
          p.resolve({ approved: false, scope: "once", note: "worker 已终态（" + terminal + "）" });
        }
      }
    };
    const ts = Date.now();
    if (status === "cancelled") {
      w.terminalStatus = status;
      settlePendingApprovals(status);
      if (w.mode === "write") await this.wmr.cleanupWrite(w, "cancelled");
      await this.opts.emit({
        type: "agent_status",
        agent_id: w.agentId,
        ...workerThreadFields(w),
        status: "cancelled",
        ...(reason ? { reason } : {}),
        ts,
      } as AgentEvent);
      await this.wmr.emitSyntheticResult(w, {
        ok: false,
        body: { agent_id: w.agentId, status: "cancelled", reason: reason ?? "用户取消" },
      });
      // M3c：sequencer 同步点 + 依赖链（cancelled 也是依赖失败——后环不静默跳过）
      w.terminalResolved = true; // 无 result 也要放行等待方：否则 sequencer 永挂（cancel 分支本就不发 agent_result）
      this.resolveTerminalWaiters(w.agentId, "cancelled", null);
      this.resolveDependents(w.agentId, "cancelled");
      this.dropAgentOwner(w.agentId);
      this.releaseWorkerMemory(w);
      return;
    }
    // #31（2026-11-06）：diff 读取失败不许被 `.catch(() => null)` 吞成「本次没改文件」。
    // 旧形状下 done 的 files_changed=[]、diff 收据一条不落，而 worktree 随后按 failed/cancel 之外的
    // 路径清不掉 ⇒ 用户既看不到改动、也拿不到合并塔入口。改为预读 + 失败改口 failed + 保留现场。
    let diff: { stat: string; patch: string; files: string[] } | null = null;
    let llmNote = "";
    let diffError: string | null = null;
    if (status === "done" && w.mode === "write" && w.worktree && w.baseCommit) {
      try {
        diff = await worktreeDiff(worktreePathFor(this.opts.workspace, w.agentId), w.baseCommit);
      } catch (err) {
        diffError = err instanceof Error ? err.message : String(err);
      }
      if (diffError === null && diff !== null) {
        if (this.safeMode !== "off") llmNote = await this.wmr.emitWorkerDiffSecurity(w, diff);
        await this.wmr.emitWorkerDiffSnapshot(w, diff, llmNote);
      }
    }
    if (diffError !== null) {
      const original = status;
      status = "failed";
      reason = "diff_read_failed: " + diffError;
      await this.opts.emit({
        type: "agent_message",
        agent_id: w.agentId,
        ...workerThreadFields(w),
        kind: "progress",
        text: "[orchestrator] worker 改动快照读取失败，已按 failed 收束并保留 worktree/分支/合并塔："
          + diffError,
      } as AgentEvent);
      console.warn("[orchestrator] " + w.agentId + " " + original + " → failed（diff_read_failed）: " + diffError);
    }
    w.terminalStatus = status;
    settlePendingApprovals(status);
    const report = lastAssistantText(w.events) ?? "";
    const scanned = scanModelOutput(report).text;
    const clipped = clipWorkerSummary(scanned);
    if (status === "done") {
      // ---- M3b write mode：done → diff 快照 + 安全 gate 流水（先于 agent_result，面板先有 diff）----
      await this.opts.emit({
        type: "agent_message",
        agent_id: w.agentId,
        ...workerThreadFields(w),
        kind: "report",
        text: clipped.text,
      } as AgentEvent);
      await this.opts.emit({
        type: "agent_status",
        agent_id: w.agentId,
        ...workerThreadFields(w),
        status: "done",
        ts,
      } as AgentEvent);
      const filesChanged = diff?.files ?? [];
      const diffRef = w.mode === "write" && w.worktree && w.baseCommit ? w.worktree + "@" + w.baseCommit : undefined;
      // W4b：只在本次真改过文件时标证据（没写代码就无所谓「跑过了」）。
      const evidence = filesChanged.length > 0 ? workerVerificationEvidence(w.events) : undefined;
      // W3②：钱与证据同桌——「这份交付花了多少、跑没跑过测试」两条都得是机器可读的。
      const spent = spentUsdFor(w.price, w.usage);
      const spentFields = spent ? { spent_usd: spent.usd, price_calibrated: spent.calibrated } : {};
      const doneResult: Extract<AgentEvent, { type: "agent_result" }> = {
        type: "agent_result",
        agent_id: w.agentId,
        ...workerThreadFields(w),
        status: "done",
        summary: clipped.text,
        ...(clipped.truncated ? { summary_truncated: true } : {}),
        artifacts: {
          report: clipped.text,
          ...(filesChanged.length > 0 ? { files_changed: filesChanged } : {}),
          ...(diffRef ? { diff_ref: diffRef } : {}),
          ...(evidence ? { verified: evidence } : {}),
          ...spentFields,
        },
        usage: { inputTokens: w.usage.inputTokens, outputTokens: w.usage.outputTokens },
        tool_stats: { ...w.toolStats },
      } as Extract<AgentEvent, { type: "agent_result" }>;
      await this.opts.emit(doneResult);
      // M3c：sequencer 同步点 + 依赖链（done 唤醒后环，事件驱动无轮询）
      w.lastResult = doneResult;
      w.terminalResolved = true;
      this.resolveTerminalWaiters(w.agentId, "done", doneResult);
      this.resolveDependents(w.agentId, "done");
      await this.wmr.emitSyntheticResult(w, {
        ok: true,
        body: {
          agent_id: w.agentId,
          status: "done",
          summary: clipped.text,
          ...(clipped.truncated ? { summary_truncated: true } : {}),
          artifacts: {
            report: clipped.text,
            ...(filesChanged.length > 0 ? { files_changed: filesChanged } : {}),
            ...(diffRef ? { diff_ref: diffRef } : {}),
            ...(evidence ? { verified: evidence } : {}),
            ...spentFields,
          },
          usage: { ...w.usage },
          tool_stats: { ...w.toolStats },
        },
      });
    } else {
      // diff 读取失败是 harness 侧取证故障，不是 worker 写坏了：worktree/分支/合并塔全保留，
      // 让用户仍能从合并控制塔手动处置（mergeWorker 只要求 terminalResolved）。
      if (w.mode === "write" && diffError === null) await this.wmr.cleanupWrite(w, "failed");
      // failed：错误永不冒充结果——status/reason 分型；max_turns 附 partial 报告（§4.4.8 闸门）
      await this.opts.emit({
        type: "agent_status",
        agent_id: w.agentId,
        ...workerThreadFields(w),
        status: "failed",
        reason,
        ts,
      } as AgentEvent);
      const failedSpent = spentUsdFor(w.price, w.usage);
      const failedResult: Extract<AgentEvent, { type: "agent_result" }> = {
        type: "agent_result",
        agent_id: w.agentId,
        ...workerThreadFields(w),
        status: "failed",
        ...(reason ? { reason } : {}),
        summary: clipped.text,
        ...(clipped.truncated ? { summary_truncated: true } : {}),
        // 失败的 worker 同样付过钱——「花了 $0.01 没拿到东西」正是判分工值不值的分子，缺席就等于免费失败。
        artifacts: {
          report: clipped.text,
          ...(failedSpent ? { spent_usd: failedSpent.usd, price_calibrated: failedSpent.calibrated } : {}),
        },
        usage: { inputTokens: w.usage.inputTokens, outputTokens: w.usage.outputTokens },
        tool_stats: { ...w.toolStats },
      } as Extract<AgentEvent, { type: "agent_result" }>;
      await this.opts.emit(failedResult);
      // M3c：sequencer 同步点 + 依赖链（failed → 后环 dependency_failed，不静默跳过）
      w.lastResult = failedResult;
      w.terminalResolved = true;
      this.resolveTerminalWaiters(w.agentId, "failed", failedResult);
      this.resolveDependents(w.agentId, "failed");
      await this.wmr.emitSyntheticResult(w, {
        ok: false,
        body: {
          agent_id: w.agentId,
          status: "failed",
          ...(reason ? { reason } : {}),
          summary: clipped.text,
          usage: { ...w.usage },
          tool_stats: { ...w.toolStats },
        },
      });
    }
    this.dropAgentOwner(w.agentId);
    this.releaseWorkerMemory(w);
  }

  /** B7（审查）：终态资源回收——root abort 监听器摘除（once 监听不触发即永久驻留，长会话单调增长）
   *  + 子流内存态裁剪（w.events 是 handle 的内存大头）。handle 本体保留：依赖链 terminalStatus 查询 /
   *  合并控制塔 / 评审重启都要读终态 handle（直接 workers.delete 会砍断这三条路由）。
   *  评审重启（injectComment：write 且合并决策未决）需要 w.events 作上下文——只在不可重启态
   *  （read worker，或 write 已过合并决策点）裁剪。幂等，可多处调用。 */
  releaseWorkerMemory(w: WorkerHandle): void {
    if (w.onRootAbort) {
      this.root.signal.removeEventListener("abort", w.onRootAbort);
      w.onRootAbort = undefined;
    }
    if (w.mode !== "write" || !this.hasMergeOwner(w.agentId)) {
      w.events.length = 0;
      this.diffVersions.delete(w.agentId);
    }
  }
}
