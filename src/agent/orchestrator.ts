// M3a 编排内核（agent-plan §4.4.1/§4.4.2/§4.4.3/§4.4.4/§4.4.6/§4.4.8/§4.4.10）：
// spawn_agent 原语 + read mode worker + 审批与 turn 解耦 + 取消链 + usage 按 agent 归因。
// 纪律（§4.4.1）：并发上限 4（超限直接拒绝，不排队）；深度恒为 1——worker 工具表**构造时即不含**
// spawn_agent（非运行时报错）；worker 上下文 = task + context + 项目记忆注入，永不继承主对话。
// 事件纪律（§4.4.9 / 任务书裁决 1）：worker 事件落主会话 JSONL（子流：agent_* + 带 agent_id 的
// tool_call/tool_result/usage），agent_spawned 携 parent_event_id 建立血缘树；重放主流后投影一致。
import type { AgentEvent, HarnessHoldReason } from "../events";
import { replay } from "../events";
import type { ModelOutput, Provider } from "../providers";
import { glmDefaultModelName, type GlmMessage, type GlmToolSpec } from "../providers/glm";
import { envKeyOf } from "../providers/env-keys";
import { effectiveModelTable, resolveModel, toWorkerModel, type ModelTier } from "../providers/registry";
import { routeFor, TIER_ORDER as MODEL_TIER_ORDER } from "../routing/policy";
import type { ToolResult } from "../tools/base";
import { runLoop } from "./loop";
import { redactEventForLog } from "../events";
import { DELIVERY_GUARD_CALL_ID, EMPTY_RUN_DELIVERY } from "./delivery-guard";
import { projectContext, type ContextMessage } from "./context";
import {
  estimateContextTokens,
  calibrateFactor,
  runCompaction,
  shouldCompact,
  type CompactionConfig,
  type Summarizer,
} from "./compaction";
import {
  dependsOnCycle,
} from "./sequencer";
import { DEFAULT_STUCK_CONFIG, detectStuck, stuckActionOf, stuckObservationOf, type StuckConfig } from "./stuck";
import { unconsumedSpawnArgs } from "./spawn-surface";
import { respawnSpawnArgs, type RespawnArgs } from "./recovery";
import {
  createWorktree,
  removeWorktree,
  worktreeDiff,
  worktreePathFor,
} from "./worktree";
import {
  newAutonomySession,
  type AskScope,
  type RiskLevel,
} from "../permissions";
import { frozenJudgePathSet } from "../frozen";
// ---- 拆分面（本文件只留 Orchestrator 类本体 + worker 会话 provider/压缩）----
// 常量与纯函数按职责抽到同级轻模块（同 provider-key-inject 的先例：抽实现、原路径留公开面，
// importer 与变异锚点不必跟着改）。本地引用走 import，公开面由文件尾的 re-export 维持逐字不变。
import { ApprovalsChainsSupervise } from "./orchestrator-approvals";
import { BudgetCascadeBandit } from "./orchestrator-budget";
import { WorkerMergeReview } from "./worker-merge";
import { MAX_CONCURRENT_WORKERS, READ_MODE_MAX_TURNS, SPAWN_MODES, workerBudgetConfig, workerToolTable } from "./orchestrator-config";
import { workerToolSpecs } from "./worker-shell-tools";
import { clampTier, clipWorkerSummary, isPermissionMode, parseSpawnedAgentId, scanModelOutput, workerVerificationEvidence } from "./worker-report";
import { priceForModel, priceTagText, spentUsdFor, type JoinPayloadBody, type WorkerPrice } from "./orchestrator-join";
import { WorkerCancelled, defaultWorkerModel, isScriptedModel, usageNameOf, type WorkerModel } from "./worker-model";
import { type OrchestratorOptions, type PipelineChain, type SpawnArgs, type StageRoleResolution, type WorkerHandle } from "./orchestrator-types";
import { filterWorkerSpecs, filterWorkerTable, parseStringList, parseWorkerContext, withAgentId } from "./worker-projection";
import { globIntersects, semanticConflictsVia } from "./lease-conflicts";
import { findToolCallEventId } from "./call-id-index";
import { buildWorkerSystemMessages, lastAssistantText } from "./worker-prompt";
import { buildWorkerToolTable } from "./worker-tool-table";

// ---- 跨编排器路由（worker 与审批的生命周期长于父 turn）：agent_id / approval_id → 编排器 ----
const agentOwners = new Map<string, Orchestrator>();
const approvalOwners = new Map<string, Orchestrator>();
// M3b 合并控制塔路由：write worker 终态后仍需可达（批准合并发生在 done 之后）——
// 注册于 spawn(write)，注销于 worktree 收尾（merge/reject/failed/cancelled 四路清理完成时）。
const mergeOwners = new Map<string, Orchestrator>();

// M3b：agent_id 进程级全局计数——编排器逐 run 新建，若各自从 1 起数，同工作区跨 run 会撞
// worktree（.agents/wt-worker-1）与合并控制塔路由；全局唯一 id 是 worktree 生命周期的前提。
let globalAgentSeq = 0;

function nextAgentId(): string {
  return "worker-" + String(++globalAgentSeq);
}

export function orchestratorForAgent(agentId: string): Orchestrator | null {
  return agentOwners.get(agentId) ?? null;
}

export function orchestratorForApproval(approvalId: string): Orchestrator | null {
  return approvalOwners.get(approvalId) ?? null;
}

/** 合并控制塔路由（§4.3：批准合并是唯一写主分支通道；路由面只给 card_action 协议，不给任何工具表）。 */
export function orchestratorForMerge(agentId: string): Orchestrator | null {
  return mergeOwners.get(agentId) ?? null;
}

// ---- 编排器 ----

export class Orchestrator {
  private seq = 0;
  private readonly workers = new Map<string, WorkerHandle>();
  private readonly pendingApprovals = new Map<
    string,
    { agentId: string; resolve: (r: { approved: boolean; scope: AskScope; note?: string }) => void; timer: ReturnType<typeof setTimeout>; cleanup?: () => void }
  >();
  readonly root = new AbortController();
  private readonly approvalTimeoutMs: number;
  private readonly raceDeadlineMs: number;
  private readonly safeMode: "off" | "report" | "gate";
  /** write worker diff 快照版本计数（评审闭环 v1→v2：同 agent 每次收敛出新 diff）；
   *  活引用注入 worker-merge.ts（本类 releaseWorkerMemory 仍与 w.events 同门槛回收它）。 */
  private readonly diffVersions = new Map<string, number>();
  // ---- M3c ----
  private readonly opts: OrchestratorOptions;
  private readonly stuckConf: StuckConfig;
  /** 三缝之一（budget / cascade / bandit）的状态基座：三个域的状态与逻辑整箱在 orchestrator-budget.ts，
   *  本类的同名方法全是薄委托；sessionUsage / mainUsage / workers 以**活引用**注入（见构造器）。 */
  private readonly bcb: BudgetCascadeBandit;
  /** 三缝之二（审批 / 链 sequencer / 终态等待）的状态基座：整箱在 orchestrator-approvals.ts，
   *  本类的同名方法全是薄委托；等待表 / 链表 / 依赖登记 / worker 表以**活引用**注入（见构造器）。 */
  private readonly acs: ApprovalsChainsSupervise;
  /** 三缝之三（worker 成果面：diff 快照 / 安全流水 / worktree 清理 / 合并控制塔 / 评审注入）的状态
   *  基座：整箱在 worker-merge.ts，本类的同名方法全是薄委托；worker 表 / 版本计数 / 路由表以
   *  **活引用或回调**注入（见构造器）。 */
  private readonly wmr: WorkerMergeReview;
  /** 会话累计 usage（emit 包装统计全部 usage 事件 = 主 loop + Σworker，§4.4.10 口径）。 */
  readonly sessionUsage = { inputTokens: 0, outputTokens: 0 };
  /** **只**统计无 `agent_id` 的 usage 事件（= 主会话自己那一跳）。
   *  成本闸要按桶分别计价：`sessionUsage` 里 worker 的 token 已经混在一起，按会话档一乘就错
   *  （见 `bucketsSpendUsd` 的实测理由）——所以另记一份"主会话那一段"，两边相加而不是各算各的总量。 */
  private readonly mainUsage = { inputTokens: 0, outputTokens: 0 };
  /** 依赖链：延迟 spawn 登记（前环未收敛；前环 done 事件驱动触发，无轮询调度器 §4.5）。 */
  /** 依赖链：延迟 spawn 登记（前环未收敛；前环 done 事件驱动触发，无轮询调度器 §4.5）。 */
  private readonly deferredSpawns = new Map<string, { callId: string; args: SpawnArgs; dependsOn: string[] }>();
  /** pipeline 链（callId → 链状态；stages 批准后冻结，重复请求 = 变更请求被拒）。 */
  private readonly chains = new Map<string, PipelineChain>();

  constructor(opts: OrchestratorOptions) {
    this.approvalTimeoutMs = opts.approvalTimeoutMs ?? 120_000;
    this.raceDeadlineMs = opts.raceDeadlineMs ?? 120_000;
    this.safeMode = opts.safeMode ?? "report";
    this.stuckConf = { ...DEFAULT_STUCK_CONFIG, ...(opts.stuckConfig ?? {}) };
    const rawEmit = opts.emit;
    this.opts = {
      ...opts,
      emit: async (e: AgentEvent) => {
        if (e.type === "usage") {
          this.sessionUsage.inputTokens += e.inputTokens;
          this.sessionUsage.outputTokens += e.outputTokens;
          // 带 agent_id 的是 worker 子流（各自有档位，按 handle 上的真价单独成桶）
          if (e.agent_id === undefined) {
            this.mainUsage.inputTokens += e.inputTokens;
            this.mainUsage.outputTokens += e.outputTokens;
          }
        }
        await rawEmit(e);
      },
    };
    // A 簇状态基座：三份**活引用**（上面的 emit 包装照旧在原地累加 usage）+ 窄 opts 面 + 收尾回调。
    // 不用 `...opts` 整包转：结构列写出来，模块加了新依赖（或这里漏转一个开关）当场编译不过。
    this.bcb = new BudgetCascadeBandit({
      budget: opts.budget ?? null,
      sessionUsage: this.sessionUsage,
      mainUsage: this.mainUsage,
      workers: this.workers,
      opts: {
        emit: this.opts.emit,
        routing: this.opts.routing,
        cascadeUpgrade: this.opts.cascadeUpgrade,
        cascadeMaxUpgrades: this.opts.cascadeMaxUpgrades,
        banditStatePath: this.opts.banditStatePath,
      },
      cleanupWrite: (w, why) => this.wmr.cleanupWrite(w, why),
    });
    // B 簇状态基座：四个域（审批等待 / 链 / supervise / 收队）整箱在 orchestrator-approvals.ts。
    // 活引用照 A 簇纪律只收引用不拷贝；出圈动作走回调，不反向 import 本文件。
    this.acs = new ApprovalsChainsSupervise({
      opts: {
        emit: this.opts.emit,
        budget: this.opts.budget,
        agentRoleFor: this.opts.agentRoleFor,
        cascadeUpgrade: this.opts.cascadeUpgrade,
        cascadeMaxUpgrades: this.opts.cascadeMaxUpgrades,
      },
      pendingApprovals: this.pendingApprovals,
      approvalTimeoutMs: this.approvalTimeoutMs,
      markOwner: (id) => approvalOwners.set(id, this),
      dropOwner: (id) => approvalOwners.delete(id),
      chains: this.chains,
      deferredSpawns: this.deferredSpawns,
      workers: this.workers,
      signal: this.root.signal,
      leaseConflicts: (resources) => this.leaseConflicts(resources),
      spawnStage: (args, ctx, stageRole) => this.spawnStage(args, ctx, stageRole),
      spawn: (args, ctx) => this.spawn(args, ctx),
      workerIds: () => this.workerIds(),
      budgetBlocked: () => this.bcb.budgetBlocked(),
      rejectOnBudget: (callId) => this.bcb.rejectOnBudget(callId),
      cascadeReady: () => this.bcb.cascadeReady(),
      cascadePlanFor: (agentId, budgetLeft) => this.bcb.cascadePlanFor(agentId, budgetLeft),
      cleanupSuperseded: (agentId) => this.bcb.cleanupSuperseded(agentId),
      mergeWorker: (agentId) => this.mergeWorker(agentId),
      cleanupWrite: (w, why) => this.wmr.cleanupWrite(w, why),
    });
    // C 缝状态基座：diff 快照 / 安全流水 / worktree 清理 / 合并控制塔 / 评审注入整箱在 worker-merge.ts。
    // 活引用照 A/B 簇纪律只收引用不拷贝；mergeOwners / agentOwners 路由表走回调，不反向 import 本文件。
    this.wmr = new WorkerMergeReview({
      opts: { emit: this.opts.emit, workspace: this.opts.workspace },
      safeMode: this.safeMode,
      workers: this.workers,
      diffVersions: this.diffVersions,
      hasMergeOwner: (agentId) => mergeOwners.has(agentId),
      dropMergeOwner: (agentId) => mergeOwners.delete(agentId),
      registerMergeOwner: (agentId) => mergeOwners.set(agentId, this),
      markAgentOwner: (agentId) => agentOwners.set(agentId, this),
      runWorker: (w) => this.runWorker(w),
      releaseWorkerMemory: (w) => this.releaseWorkerMemory(w),
    });
  }

  // ---- M3c 成本闸（§4.4.8 BYOK 成本底线）：整箱实现在 orchestrator-budget.ts，以下为薄委托 ----

  budgetEstimateUsd(): number {
    return this.bcb.budgetEstimateUsd();
  }

  budgetBlocked(): boolean {
    return this.bcb.budgetBlocked();
  }

  /** 活跃 worker 数（running / waiting_approval / waiting_input 计入并发上限；
   *  M3b：finish 进行中（未 closed）也计入——waitAll 等到终态事件全部落完）。 */
  activeCount(): number {
    let n = 0;
    for (const w of this.workers.values()) if (!w.finished || !w.closed) n++;
    return n;
  }

  workerIds(): string[] {
    return [...this.workers.keys()];
  }

  /** 收队工具的短路判据：一个 worker 都没有就别建等待项（零行为，省一次模型可见的空 payload）。 */
  hasWorkers(): boolean {
    return this.workers.size > 0;
  }

  statusOf(agentId: string): AgentEvent | null {
    return null; // 状态一律由事件流投影（§3.1），编排器不设第二事实源
  }

  /** 协议事件落流口（card_action 等与 turn 解耦的写入走编排器绑定的主管线——
   *  父 turn 结束后 session.emit 已不可达，worker 审批应答仍须可落流，§4.4.3）。 */
  async appendProtocol(e: AgentEvent): Promise<void> {
    await this.opts.emit(e);
  }

  /** 主 checkout 根（M3b：remember 重定向 + worktree 路径推导的工具表包装需要）。 */
  get mainWorkspace(): string {
    return this.opts.workspace;
  }

  /** 产出代码安全模式（M3b §11.6；面板/路由侧读同一口径）。 */
  get securityMode(): "off" | "report" | "gate" {
    return this.safeMode;
  }

  /** spawn_agent 工具体（loop 经 TOOLS 注入调用；验收脚本可携 ctx.callId 直调）。
   *  M3c：pipeline mode = 哑 sequencer（一个审批授权全链，零 LLM 展开）；depends_on 事件驱动依赖链。 */
  async spawn(args: SpawnArgs, ctx: { callId?: string }): Promise<ToolResult> {
    const mode = typeof args.mode === "string" ? args.mode : "";
    if (!SPAWN_MODES.includes(mode)) {
      // 取值清单取自事实源：写死 "read|write|pipeline" 时 supervise 早已在册，
      // 打错档名的模型会被告知「supervise 不是档位」——一道纠错消息自己制造第二次错。
      return { ok: false, output: "spawn_agent: mode 必须是 " + SPAWN_MODES.join("|") };
    }
    // 逐型参数面（第 40 页）：这一档不读、或压根不存在的键**不许静默丢**——
    // 真轨迹里模型带 stages 申报了一条三阶段门控计划，计划整支蒸发而回执无一句话。
    // 拒在审批与派活之前：不花钱、不打扰人、不留下"我申报了但没人知道"的第三条事实源。
    const surfaceError = unconsumedSpawnArgs(mode, args).message();
    if (surfaceError !== null) return { ok: false, output: surfaceError };
    const task = typeof args.task === "string" ? args.task.trim() : "";
    if (mode !== "pipeline" && task === "") {
      return { ok: false, output: "spawn_agent: task 参数必填（worker 上下文唯一来源，自包含任务书）" };
    }
    // stages 冻结闸（§4.4.7）：同 callId 的 pipeline 已批准运行 → 再次请求 = 变更请求，拒绝并落流
    if (mode === "pipeline" && ctx.callId !== undefined && this.chains.has(ctx.callId)) {
      // 落流事件与返回体都挂 ctx.callId（第 242 页裁决采纳并列语义）：两条 tool_result 同 id，
      // mergeToolResultsById 会并成一条且正文不丢——比旧的派生 id（必然走孤儿降级＋前言）少一截噪声。
      await this.opts.emit({
        type: "tool_result",
        callId: ctx.callId,
        ok: false,
        output: "[sequencer] stages 变更请求被拒（批准后冻结，§4.4.7；该链仍在按原 stages 运行）",
      } as AgentEvent).catch(() => {});
      return { ok: false, output: "spawn_agent: 该 pipeline 已批准运行（stages 批准后冻结，变更请求被拒 §4.4.7）" };
    }
    // ---- depends_on 校验与延迟登记（§4.5/§2.1；pipeline 亦然——整链延迟到前环收敛）----
    const dependsOn = parseStringList(args.depends_on);
    if (dependsOn.length > 0) {
      const v = this.validateDependsOn(dependsOn);
      if (!v.ok) return { ok: false, ...(v.hold === undefined ? {} : { hold: v.hold }), output: "spawn_agent: " + v.why };
      if (v.waiting.length > 0) {
        // 前环未收敛：登记延迟 spawn（事件驱动——前环 done 触发真正 spawn，无轮询调度器）
        if (ctx.callId === undefined || ctx.callId === "") {
          return { ok: false, output: "spawn_agent: depends_on 依赖未收敛且无 callId（无法事件驱动触发）" };
        }
        this.deferredSpawns.set(ctx.callId, { callId: ctx.callId, args, dependsOn });
        return { ok: true, output: JSON.stringify({ deferred: true, depends_on: dependsOn, waiting_on: v.waiting }) };
      }
    }
    // 会话成本闸（§4.4.8）：超限拒绝新 spawn（含 sequencer 后环）；主 loop 不受闸（V1 口径：闸管编排扩张）
    if (this.budgetBlocked()) {
      return await this.rejectOnBudget(ctx.callId);
    }
    if (mode === "pipeline") {
      return await this.spawnPipeline(args, ctx);
    }
    if (mode === "supervise") {
      return await this.spawnSupervise(args, ctx);
    }
    // 模型点名的角色：走与 sequencer **同一份**解析（不另起一条"读角色"的路径 ⇒ 两处口径会漂）。
    // 未注册就出声拒并说明缺省行为，而不是静默按默认面跑（那等于把申报的角色面吞掉）。
    const roleArg = typeof args.role === "string" ? args.role.trim() : "";
    if (roleArg !== "") {
      const resolved = this.resolveStageRole(roleArg);
      if ("error" in resolved) {
        return { ok: false, output: "spawn_agent: 角色不可用：" + resolved.error + "（不传 role 即默认实现面）" };
      }
      return await this.spawnInternal(args, ctx, task, { ...resolved, role: roleArg });
    }
    return await this.spawnInternal(args, ctx, task);
  }

  /** sequencer 的逐环 spawn 入口（不经过模型 spawn 面——stage_role 由代码注入，模型不可伪造角色面）。 */
  private async spawnStage(args: SpawnArgs, ctx: { callId?: string; cascadeFrom?: ModelTier }, stageRole: StageRoleResolution): Promise<ToolResult> {
    return await this.spawnInternal(args, ctx, typeof args.task === "string" ? args.task.trim() : "", stageRole);
  }

  /** M3c 崩溃恢复「重派」（§4.4.9）：全新 agent_id 按原 spawn 参数重新 spawn（V1 无 transcript resume）。
   *  整包转发展开，不逐字段列写：那份清单本身就是缺陷形状——`role` 落地时若只补映射端、
   *  这里漏转一手，重派会**静默换一张角色面**（工具剔除面与提示词都变了），而卡上写的还是「按原参数」。
   *  `RespawnArgs` 里没有 `depends_on`（依赖链已断），所以展开不会把不该带上的参数带进来。 */
  async respawn(args: RespawnArgs, ctx: { callId?: string } = {}): Promise<ToolResult> {
    // 只转 spawn_agent 真正接受的顶层参数（见 respawnSpawnArgs 的注释：旧实现对真实 worker 必拒）。
    return await this.spawn(respawnSpawnArgs(args), ctx);
  }

  /** M5c Best-of-N 竞争编排（§m5-proposal 步骤 12）：N 个候选并行，judge 命中即早停取消其余。
   *  judge 可插拔（verify 全绿 > LLM judge > diff 规模最小，调用方注入——worker 侧 verify 是禁用的，
   *  判据来自候选产物而非 worker 自证）。N 硬上限 3（MAX_CONCURRENT_WORKERS=4，留 1 给审查环）。
   *  成本闸复用 budgetBlocked；早停复用既有 cancelAgent（不新造取消机制）。 */
  async spawnRace(
    task: string,
    n: number,
    judge: (r: Extract<AgentEvent, { type: "agent_result" }>) => boolean,
    ctx: { callId?: string } = {},
  ): Promise<ToolResult> {
    const k = Math.min(Math.max(n, 1), 3);
    if (this.budgetBlocked()) return await this.rejectOnBudget(ctx.callId);
    if (this.activeCount() + this.spawnReserve + k >= MAX_CONCURRENT_WORKERS) {
      return {
        ok: false,
        hold: "concurrency-limit",
        output: `spawn_agent(race): 并发预算不足（${String(k)} 候选 + 1 余量 > ${String(MAX_CONCURRENT_WORKERS)}），不排队`,
      };
    }
    const base = ctx.callId ?? "";
    const agentIds: string[] = [];
    for (let i = 0; i < k; i++) {
      const cid = base === "" ? "race-" + String(i) : base + "-c" + String(i);
      // context 传候选序号（candidate-i）：调用方 modelFor 可据此为每个候选注入不同剧本
      const r = await this.spawn({ mode: "read", task, context: "race-candidate-" + String(i) }, { callId: cid });
      if (!r.ok) {
        for (const id of agentIds) this.cancelAgent(id); // 半成品竞速：已派发候选全部取消
        return { ok: false, output: "spawn_agent(race): 候选 " + String(i) + " spawn 失败：" + r.output };
      }
      // 审查 S2-8：候选身份直接取 spawn 回执里的 agent_id（成功回执恒为 {agent_id,...}）。
      // 旧实现每轮全量 replay 日志找「新出现的 agent_spawned」：① 每次候选都重读整条事件流；
      // ② sequencer/respawn 等别的登记路径在同窗口落流时会错认（find 取到的可能是别人的
      //    worker）或漏认；③ replay 一旦失败被 catch 成 []，agentIds 静默为空 → 下面的
      //    「全收敛」判定立刻成立 → 返回失败而这 k 个 worker 已被派出且无人取消 = 失控。
      const id = parseSpawnedAgentId(r.output);
      if (id === undefined) {
        for (const done of agentIds) this.cancelAgent(done);
        return {
          ok: false,
          output: "spawn_agent(race): 候选 " + String(i) + " spawn 回执无 agent_id（fail-visible，不留无主 worker）：" + r.output,
        };
      }
      agentIds.push(id);
    }
    // 竞速：等 agent_result 到达，judge 命中即早停（取消其余候选，返回胜者）
    const deadline = Date.now() + this.raceDeadlineMs;
    const winners: Array<Extract<AgentEvent, { type: "agent_result" }>> = [];
    while (Date.now() < deadline) {
      if (this.root.signal.aborted) break; // 审查 S2-8：主会话已取消就不再空转竞速轮（旧实现最坏再等满 120s）
      const log = await replay(this.opts.logPath).catch(() => [] as AgentEvent[]);
      for (const id of agentIds) {
        const done = log.find(
          (e: AgentEvent): e is Extract<AgentEvent, { type: "agent_result" }> =>
            e.type === "agent_result" && e.agent_id === id && !winners.some((w) => w.agent_id === id),
        );
        if (done) {
          winners.push(done);
          if (judge(done)) {
            for (const other of agentIds) if (other !== id) this.cancelAgent(other); // 早停：取消其余
            return {
              ok: true,
              output: JSON.stringify({ race: true, picked: id, candidates: agentIds, early_stop: true }),
            };
          }
        }
      }
      if (agentIds.length > 0 && winners.length >= agentIds.length) break; // 全收敛且无 judge 命中
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    // 审查 S2-9：超时 / 全收敛无命中 / 主会话取消 —— 退出竞速前一律收杀未终态候选。
    // 旧实现直接 return 失败，被判负与未收敛的 worker 继续在后台跑（占并发预算、烧 token，
    // write 侧还留着 worktree），而调用方已经拿到失败结果。cancelAgent 对终态幂等。
    for (const id of agentIds) this.cancelAgent(id);
    return {
      ok: false,
      output: "spawn_agent(race): 无候选 judge 命中（N=" + String(k) + "，全收敛或超时；未终态候选已收杀）",
    };
  }

  /** depends_on 校验（共享）：存在性（跨会话拒绝）→ 环（DFS）→ 前环终态裁决。waiting = 尚未 done 的依赖。
   *  `hold` 只挂在第三支：前两支是模型把参数写错了（不存在／成环），第三支才是 harness 按住了这次扩张。 */
  private validateDependsOn(dependsOn: string[]): { ok: true; waiting: string[] } | { ok: false; why: string; hold?: HarnessHoldReason } {
    for (const dep of dependsOn) {
      if (!this.workers.has(dep)) {
        return { ok: false, why: "depends_on 引用不存在或不在本会话的 agent: " + dep + "（跨会话依赖拒绝）" };
      }
    }
    const edges = new Map<string, string[]>();
    for (const w of this.workers.values()) {
      if (w.dependsOn.length > 0) edges.set(w.agentId, w.dependsOn);
    }
    if (dependsOnCycle(dependsOn, edges)) {
      return { ok: false, why: "depends_on 成环（" + dependsOn.join("→") + "；依赖图不允许环 §2.1）" };
    }
    for (const dep of dependsOn) {
      const st = this.workers.get(dep)?.terminalStatus;
      if (st === "failed" || st === "cancelled") {
        return { ok: false, hold: "dependency-failed", why: "前环 " + dep + " " + st + " → 后环标记 failed（reason=dependency_failed，不静默跳过 §2.1）" };
      }
    }
    // 「等不等前环」看的是**取不取到它的产出**（terminalResolved），不是它有没有被判终态：
    // finished/terminalStatus 在收尾窗口开头就真，而窗口里前环的 report 还不存在——
    // 据「done」立刻起后环 = 后环拿到一份空报告还以为是上游结论（同一族的第二处 reader）。
    return { ok: true, waiting: dependsOn.filter((dep) => this.workers.get(dep)?.terminalResolved !== true) };
  }

  /** 成本闸拒绝（薄委托：落流与返回体、以及那两个读者面的说明全在 orchestrator-budget.ts）。 */
  private async rejectOnBudget(callId?: string): Promise<ToolResult> {
    return await this.bcb.rejectOnBudget(callId);
  }

  /** B4（审查）：并发上限 check-then-act 旁路面——判定与 workers.set 之间隔着审批/worktree/emit
   *  多个 await，triggerDeferredSpawn 与 sequencer 并发触发可同时过判定 → 突破上限。
   *  同步占位（spawnReserve），失败路径 finally 回滚；登记成功后由 activeCount 接管计数。 */
  private spawnReserve = 0;

  /** spawn 内核入口（模型面与 sequencer 逐环共用；stageRole 只由 sequencer 代码注入）。 */
  private async spawnInternal(args: SpawnArgs, ctx: { callId?: string; cascadeFrom?: ModelTier }, task: string, stageRole?: StageRoleResolution): Promise<ToolResult> {
    // H2（审查 B-3）：入口 fail-closed——主会话已取消时不再派发任何 worker
    //（addEventListener 对已 abort 的 signal 不会触发，靠入口检查补上取消窗口）。
    if (this.root.signal.aborted) {
      return { ok: false, hold: "cancelled", output: "spawn_agent: 主会话已取消（fail-closed，不再派发 worker）" };
    }
    if (this.activeCount() + this.spawnReserve >= MAX_CONCURRENT_WORKERS) {
      return {
        ok: false,
        hold: "concurrency-limit",
        output: `spawn_agent: 并发已达上限（${String(MAX_CONCURRENT_WORKERS)}），不排队——请等现有 worker 收敛或取消后再试`,
      };
    }
    this.spawnReserve++;
    try {
      return await this.spawnReserved(args, ctx, task, stageRole);
    } finally {
      this.spawnReserve--;
    }
  }

  /** spawn 预留段（占位后执行）。B2（审查）：read-only 父会话不允许派 write worker——
   *  worker 有效权限 ≤ 父（§11.7.6）：write worker 文件面/shell 面恒 auto，read-only 父放行
   *  等于把只读会话变成可写（permission_mode 记 read-only 实写 auto 的记录失真一并消除）。 */
  private async spawnReserved(args: SpawnArgs, ctx: { callId?: string; cascadeFrom?: ModelTier }, task: string, stageRole?: StageRoleResolution): Promise<ToolResult> {
    const mode = typeof args.mode === "string" ? args.mode : "";
    if (mode === "write" && this.opts.parentMode === "read-only") {
      return { ok: false, output: "spawn_agent: 父会话为 read-only 档，不允许派 write worker（worker 权限 ≤ 父会话，§11.7.6）" };
    }
    // ---- M3c depends_on 轻校验（sequencer 后环路径；与 spawn() 同语义，前环必已收敛）----
    const dependsOn = parseStringList(args.depends_on);
    if (dependsOn.length > 0) {
      const v = this.validateDependsOn(dependsOn);
      if (!v.ok) return { ok: false, ...(v.hold === undefined ? {} : { hold: v.hold }), output: "spawn_agent: " + v.why };
      if (v.waiting.length > 0 && ctx.callId !== undefined && ctx.callId !== "") {
        this.deferredSpawns.set(ctx.callId, { callId: ctx.callId, args, dependsOn });
        return { ok: true, output: JSON.stringify({ deferred: true, depends_on: dependsOn, waiting_on: v.waiting }) };
      }
    }
    if (this.budgetBlocked()) {
      return await this.rejectOnBudget(ctx.callId);
    }
    // ---- M5b 模型路由（§m5-proposal 步骤 8）：opts.routing 启用时决策先行，审计面 = routing_decision ----
    const routingEnabled = this.opts.routing === true;
    if (routingEnabled) {
      // SpawnArgs.model/tier 收窄校验（M5b）：非 string → fail-visible 拒绝，不新增字段、不改 raw 解析
      const badModel = args.model !== undefined && typeof args.model !== "string";
      const badTier = args.tier !== undefined && typeof args.tier !== "string";
      if (badModel || badTier) {
        return { ok: false, output: "spawn_agent: 路由入参收窄失败（args.model/args.tier 须为 string；fail-visible 拒绝，不静默透传）" };
      }
    }
    // 路由决策（纯函数）：pin（args.model 优先，其次模型档位名）> 档位表（按环角色）> 降级链。
    // 决策在模型实例化之前完成——先落 routing_decision 再调模型（崩溃后也能审计"当时选了谁"）。
    // M5b 步骤 9：bandit 启用时把学习上下文喂给 routeFor（Thompson Sampling 选档，reason=bandit）。
    // 状态懒加载——首次 spawn 才读盘；加载失败返回 null = 本次会话只走静态档位表（降级链不受影响）。
    const banditState = this.banditEnabled() ? await this.bandit() : null;
    const routeRaw = routingEnabled
      ? routeFor({
          pin:
            typeof args.model === "string" && args.model !== ""
              ? args.model
              : typeof args.tier === "string" && (MODEL_TIER_ORDER as readonly string[]).includes(args.tier)
                ? args.tier
                : undefined,
          stage: stageRole?.role,
          mode: mode as "read" | "write",
          table: effectiveModelTable(),
          ...(banditState !== null
            ? { bandit: { posteriors: banditState.posteriors, rngState: banditState.rngState } }
            : {}),
        })
      : null;
    // 级联升档就地改标签：pin 回答的是「谁来跑」，cascade-upgrade 回答的是「为什么再花一遍钱」——
    // 两个都是事实，但审计面上只有后者能追溯触发者。改在唯一的路由出口，调用方不必各抄一份。
    // 顺带一条既有语义：升级档一律显式 pin ⇒ reason 不会是 bandit ⇒ 不进学习臂记账（级联不是学习）。
    const routeDecision =
      ctx.cascadeFrom !== undefined && routeRaw !== null
        ? { ...routeRaw, reason: "cascade-upgrade" as const, from: ctx.cascadeFrom }
        : routeRaw;
    // 模型可用性 fail-closed。审查 S3-13 两处修正：
    // ① 注入模型（modelFor：checks 的脚本/mock、demo 面）优先于档位合成——旧实现路由分支
    //    直接吃 toWorkerModel(spec)，使注入的确定性模型在 routing=true 时被忽略。
    // ② 路由分支合成的是「真实 provider 模型的 spec」，旧条件 `!model && !CAIRN_API_KEY`
    //    在 routeDecision 非空时永不成立 → 无凭据也照派 worker，第一跳 401 才死
    //    （白烧一轮 + 占并发预算 + 留一条必败 worker 记录）。现在同样要求凭据。
    const routedSpec = !this.opts.modelFor && routeDecision ? resolveModel(effectiveModelTable(), routeDecision.picked) : null;
    const model = this.opts.modelFor
      ? this.opts.modelFor(args)
      : routedSpec
        ? toWorkerModel(routedSpec, this.opts.promptCache === true ? { promptCache: true } : {})
        : undefined;
    // 凭据按**选中的 provider** 判：旧实现硬编码 CAIRN_API_KEY ⇒ 只配 ANTHROPIC_API_KEY 时
    // 路由到 anthropic 档位会被判「无凭据」；反之只有 GLM key 时又放行一个必败 worker。
    const routedProviderId = routedSpec?.provider ?? "glm";
    const routedEnvName = envKeyOf(routedProviderId);
    const hasRoutedCredential = routedEnvName !== null && process.env[routedEnvName] !== undefined;
    if (!model && !hasRoutedCredential) {
      return { ok: false, output: `spawn_agent: 无可用模型（无 ${routedEnvName ?? "provider"} 凭据且未接 modelFor；fail-closed 不造必败 worker）` };
    }
    if (routeDecision && !this.opts.modelFor && !hasRoutedCredential) {
      return { ok: false, output: `spawn_agent: 路由路径需要 ${routedEnvName ?? "provider"} 凭据（无注入模型且无凭据；fail-closed 不造必败 worker）` };
    }
    // W3②「价格标签」：worker 的钱此前只喂 bandit（rewardBandit 里算完即丢），派工时模型看不到单价、
    // 收队时看不到花了多少、终态里也没有机器可读的花费。档位以路由决策为准；没路由时 worker 走
    // `defaultWorkerModel`（= streamGlm 的 CAIRN_MODEL ?? glm-5.2），按**真实模型名**反查档位表。
    // 冻结剧本（scriptedWorkerModel 自带 scripted 标）不拨号不付钱 ⇒ price=null：宁可说「价格未知」，
    // 也不拿 $0 冒充实付（把不可知记成免费是本仓点名的假绿形状）。
    let price: WorkerPrice | null = null;
    // 归因键与价格标签**同一个式子、同一个分支**：这笔 worker 花的钱要能在评估面按模型名反查回档位，
    // 事后另算一遍就等于两处尺（第 145 页 budgetPriceKeyOf 的同一课）。剧本通道两者都留空。
    let usageModel = "";
    if (!isScriptedModel(model)) {
      // 取值顺序即优先级：**模型自述的真名**（`toWorkerModel` 盖章，注入面可自带）> 路由解出的 spec > harness 缺省档。
      // 旧实现里没有第一档，而 `modelFor` 注入时 `routedSpec` 被强制成 null ⇒ 注入的模型无论拨谁都记成缺省那一档
      // （第 148 页点名的盲区）。只剩"注入且没自述名"这一格仍落缺省档，那是诚实的：注入方是缺省那一路的替身。
      usageModel = usageNameOf(model) || routedSpec?.model || glmDefaultModelName();
      price = priceForModel(usageModel, routeDecision?.picked);
    }
    const requested = isPermissionMode(args.tier) ? args.tier : this.opts.parentMode;
    const { mode: tier, clamped, warning } = clampTier(requested, this.opts.parentMode);
    const maxTurns =
      stageRole?.maxTurns !== undefined
        ? stageRole.maxTurns
        : typeof args.max_turns === "number" && Number.isInteger(args.max_turns) && args.max_turns >= 1 && args.max_turns <= 200
          ? args.max_turns
          : READ_MODE_MAX_TURNS;
    const resources = parseStringList(args.resources);

    // ---- M3b 写租约表（§4.4.5）：resources glob 与活跃 write worker 租约求交 ----
    // 相交 → 审批卡显式警告（可强行批准）——租约是合并冲突预测器，不是硬闸。
    const agentId = nextAgentId();
    if (mode === "write") {
      const conflicts = this.leaseConflicts(resources);
      // glob 没抓到才问语义层（省一次建图，也让既有事件流/审批文案在纯 glob 场景逐字不变）
      const semantic = conflicts.length === 0 ? await this.semanticLeaseConflicts(resources) : [];
      const all = [...conflicts, ...semantic];
      if (all.length > 0) {
        const detail = all.map((c) => c.resource + "（" + c.agentId + "）").join("、");
        const warningMsg = `写租约相交：${detail}——并行写可能产生合并冲突（租约是预测器不是硬闸，可强行批准）`
          + (semantic.length > 0 ? "；其中为**语义波及**相交（glob 不相交，但两侧改动波及同一批文件）" : "");
        const approved = await this.requestSpawnApproval(agentId, warningMsg, all);
        if (!approved) {
          return { ok: false, output: "spawn_agent: 未获批准（写租约相交未强行批准：" + detail + "）" };
        }
        await this.opts.emit({ type: "agent_message", agent_id: agentId, kind: "progress", text: "[lease] 租约相交但已强行批准：" + detail } as AgentEvent);
      }
    }

    // ---- M3b write mode：worktree 创建（spawn 批准语义 = 主会话发起 spawn 且租约/档位就绪）----
    let worktree: string | undefined;
    let branch: string | undefined;
    let baseCommit: string | undefined;
    let symlinkWarnings: string[] = [];
    if (mode === "write") {
      try {
        const created = await createWorktree(this.opts.workspace, agentId, task);
        worktree = created.worktree;
        branch = created.branch;
        baseCommit = created.baseCommit;
        symlinkWarnings = created.symlinkWarnings;
      } catch (err) {
        return { ok: false, output: "spawn_agent: worktree 创建失败（fail-visible，未造半成品 worker）：" + (err instanceof Error ? err.message : String(err)) };
      }
    }

    const parentEventId = ctx.callId ? await findToolCallEventId(this.opts.logPath, ctx.callId) : 0;
    const handle: WorkerHandle = {
      agentId,
      spawnCallId: ctx.callId ?? "",
      mode: mode as "read" | "write",
      task,
      context: parseWorkerContext(args.context),
      maxTurns,
      tier,
      ...(clamped ? { tierWarning: warning } : {}),
      ...(model ? { model } : {}),
      price,
      ...(routedSpec ? { modelCtxWindow: routedSpec.ctxWindow } : {}),
      controller: new AbortController(),
      // P0-2（审查）：worker 自主会话按父 run 口径构造（规则库 + 沙箱可用性）——空参构造使
      // 项目级 deny/ask 规则对 worker 全表失效、沙箱降级通道恒 NONE。
      // 判卷面硬闸按**父仓相对路径**判（worktree 与父仓同键集 ⇒ 同一批文件），worker 改判卷文件
      // 与主会话改判卷文件是同一件事，不该因为"它在 worktree 里"就少一道闸。
      autonomy: newAutonomySession(tier, {
        rules: this.opts.rules ?? [],
        sandboxAvailable: this.opts.sandboxAvailable ?? null,
        frozenJudgePaths: frozenJudgePathSet(this.opts.workspace),
      }),
      toolAutonomy: newAutonomySession(mode === "write" ? "auto" : tier, {
        rules: this.opts.rules ?? [],
        sandboxAvailable: this.opts.sandboxAvailable ?? null,
        frozenJudgePaths: frozenJudgePathSet(this.opts.workspace),
      }),
      resources,
      ...(worktree ? { worktree } : {}),
      ...(branch ? { branch } : {}),
      ...(baseCommit ? { baseCommit } : {}),
      snapshots: new Map(),
      editAnchors: new Map(),
      lastFindings: [],
      // M5b 步骤 9：仅 bandit 选出的 worker 记臂（非 bandit 路由不参与学习）
      ...(routeDecision && routeDecision.reason === "bandit"
        ? {
            routeArm: { stage: stageRole?.role ?? "default", tier: routeDecision.tier },
            routeModelId: routeDecision.picked,
          }
        : {}),
      // M5b 级联：任一路由理由都记「这一跑落在哪一档」——升级阶梯从观察到的档位往上取，
      // 拿不到档（未路由 / 注入模型）就等于没有阶梯，而不是从角色表再猜一份。
      ...(routeDecision ? { routeTier: routeDecision.tier, routePicked: routeDecision.picked } : {}),
      events: [],
      usage: { inputTokens: 0, outputTokens: 0 },
      toolStats: {},
      finished: false,
      terminalResolved: false,
      closed: false,
      dependsOn,
      stuckActive: false,
      paused: false,
      pauseWaiters: [],
      stuckTurns: [],
      stuckCallActions: new Map(),
      stuckTimer: null,
      lastActivityAt: Date.now(),
      ...(stageRole?.role !== undefined ? { agentType: stageRole.role } : {}),
      ...(stageRole?.roleDefinition !== undefined ? { roleDefinition: stageRole.roleDefinition } : {}),
      ...(stageRole?.allowedTools !== undefined ? { allowedTools: stageRole.allowedTools } : {}),
      ...(stageRole?.disallowedTools !== undefined ? { disallowedTools: stageRole.disallowedTools } : {}),
    };
    this.workers.set(agentId, handle);
    agentOwners.set(agentId, this);
    if (mode === "write") mergeOwners.set(agentId, this); // 合并控制塔路由（done 后仍可达）
    // 取消树：主会话（root）中止沿树全 abort（§4.4.2）；单 worker abort 只中止该 worker
    const onRootAbort = (): void => handle.controller.abort();
    handle.onRootAbort = onRootAbort; // B7（审查）：引用留 handle，终态摘除（root.signal 监听器不单调增长）
    this.root.signal.addEventListener("abort", onRootAbort, { once: true });
    // B3（审查）：注册后立即复查——判定与注册之间隔着审批/worktree/emit 多个 await，
    // root 已在窗口内中止时 addEventListener 对已 abort 的 signal 不再触发，必须显式补 abort。
    if (this.root.signal.aborted) handle.controller.abort();

    const spawned: AgentEvent = {
      type: "agent_spawned",
      agent_id: agentId,
      parent_event_id: parentEventId,
      mode: mode as "read" | "write",
      task,
      // 角色随事件落流：内存里的 `handle.agentType` 撑不过崩溃恢复（恢复只读得到流），
      // 而"这个 worker 当时按哪张角色面跑"是审计面该留的一条。缺席=没带角色，不替它编一个。
      ...(stageRole?.role !== undefined ? { role: stageRole.role } : {}),
      ...(resources.length > 0 ? { resources } : {}),
      ...(parseStringList(args.depends_on).length > 0 ? { depends_on: parseStringList(args.depends_on) } : {}),
      ...(worktree ? { worktree } : {}),
      ...(baseCommit ? { base_commit: baseCommit } : {}),
      ...(routeDecision ? { model: routeDecision.picked } : typeof args.model === "string" && args.model !== "" ? { model: args.model } : {}),
      ...(usageModel !== "" ? { usage_model: usageModel } : {}),
      max_turns: maxTurns,
      permission_mode: tier,
      ...(clamped ? { permission_mode_requested: requested } : {}),
      ...(clamped && warning ? { tier_warning: warning } : {}),
      ts: Date.now(),
    };
    try {
      // M5b：路由决策事件落流（候选/选择/理由，先于 agent_spawned 与任何模型输出——审计面，崩溃后可回放）。
      // 放同 try：emit 失败 = spawn 未成立，与 spawned 落流失败同语义（回滚 + fail-visible）。
      // 同时保证「routing_decision ↔ agent_spawned 一对一」——租约拒绝/worktree 失败不会留孤儿决策事件。
      if (routeDecision) {
        await this.opts.emit({
          type: "routing_decision",
          agent_id: agentId,
          ...(stageRole?.role !== undefined ? { stage: stageRole.role } : {}),
          candidates: routeDecision.candidates,
          picked: routeDecision.picked,
          reason: routeDecision.reason,
          ...(routeDecision.from !== undefined ? { from: routeDecision.from } : {}),
          ts: Date.now(),
        } as AgentEvent);
      }
      await this.opts.emit(spawned);
      await this.opts.emit({ type: "agent_status", agent_id: agentId, status: "running" } as AgentEvent);
    } catch (err) {
      // 落流失败 = spawn 未成立：write worker 的 worktree 必须回收（不留孤儿）
      if (mode === "write") await removeWorktree(this.opts.workspace, agentId, { branch }).catch(() => {});
      // 审查 S2-6：回滚必须同时把登记面摘干净。旧实现只回收 worktree——workers/agentOwners
      // 留下一个从未跑过的 phantom handle（activeCount 计得到它 → 并发预算被永久占用，
      // 4 个失败即把整会话的 spawn 面堵死）、root.signal 的 abort 监听器永久驻留（B7 正是
      // 为防这个），而调用方拿到失败结果、根本不知道有这个 agent_id。该 worker 无终态可查
      // （没有 agent_spawned，面板/依赖链/合并塔都路由不到），直接整体摘除。
      this.workers.delete(agentId);
      agentOwners.delete(agentId);
      mergeOwners.delete(agentId);
      this.releaseWorkerMemory(handle);
      handle.finished = true;
      handle.closed = true;
      handle.controller.abort();
      return { ok: false, output: "spawn_agent: 事件落流失败，已回滚：" + (err instanceof Error ? err.message : String(err)) };
    }
    for (const w2 of symlinkWarnings) {
      await this.opts.emit({ type: "agent_message", agent_id: agentId, kind: "progress", text: "[worktree] " + w2 } as AgentEvent);
    }
    // M3c 插件角色 frontmatter 警告（hooks/mcpServers/permissionMode 忽略 + 警告，§9.6）落 worker 子流
    for (const w3 of stageRole?.warnings ?? []) {
      await this.opts.emit({ type: "agent_message", agent_id: agentId, kind: "progress", text: "[role] " + w3 } as AgentEvent);
    }
    void this.runWorker(handle).catch(() => {}); // 失败隔离：worker 边界永不炸主 loop（双保险，runWorker 内已 catch-all）
    return {
      ok: true,
      output: JSON.stringify({
        agent_id: agentId,
        mode,
        max_turns: maxTurns,
        // W3②：派工时就把价格摆在模型面前（不报价 ⇒ 「要不要再拆一个 worker」只能凭感觉）
        price: priceTagText(price, this.workerSpentSoFarUsd()),
        // 「自己安排」要有分母：在途几个 / 上限几个。不报这两个数，模型只能撞到拒绝才知道有闸。
        in_flight: this.inFlightAgents().length,
        worker_cap: MAX_CONCURRENT_WORKERS,
        ...(worktree ? { worktree, base_commit: baseCommit } : {}),
      }),
    };
  }

  /** worker 花销累计（薄委托：这把尺与成本闸那把的区分在 orchestrator-budget.ts）。 */
  private workerSpentSoFarUsd(): number | null {
    return this.bcb.workerSpentSoFarUsd();
  }

  /** 写租约求交（纯查询）：与活跃 write worker（未终态）的 resources 做 glob 相交判定。 */
  leaseConflicts(resources: string[]): { agentId: string; resource: string }[] {
    const out: { agentId: string; resource: string }[] = [];
    if (resources.length === 0) return out;
    for (const w of this.workers.values()) {
      if (w.mode !== "write" || w.finished) continue;
      for (const mine of resources) {
        for (const theirs of w.resources) {
          if (globIntersects(mine, theirs)) out.push({ agentId: w.agentId, resource: mine + " × " + theirs });
        }
      }
    }
    return out;
  }

  /** B1 语义合并闸：glob 不相交 ≠ 不打架。两个 write worker 各改自己的文件，
   *  但改动的**波及集**（跨文件调用点所在文件）相交 ⇒ 合并时同样语义冲突。
   *  与 leaseConflicts 同形状返回，走同一张审批卡；未接钩子时恒为空（零行为）。 */
  async semanticLeaseConflicts(resources: string[]): Promise<{ agentId: string; resource: string }[]> {
    const active = [...this.workers.values()]
      .filter((w) => w.mode === "write" && !w.finished)
      .map((w) => ({ agentId: w.agentId, resources: w.resources }));
    return await semanticConflictsVia(this.opts.semanticLease, resources, active);
  }

  /** 薄委托：写租约相交的 spawn 审批（等待内核与四路协议整箱在 orchestrator-approvals.ts）。 */
  private async requestSpawnApproval(agentId: string, warning: string, conflicts: { agentId: string; resource: string }[]): Promise<boolean> {
    return await this.acs.requestSpawnApproval(agentId, warning, conflicts);
  }

  /** 取消单 worker（§4.4.2：只 abort 该 worker；cancelled = 终态，子流终止 + 合成 tool_result 标 cancelled）。 */
  cancelAgent(agentId: string): boolean {    const w = this.workers.get(agentId);
    if (!w || w.finished) return false;
    // 等待中的审批一并释放（取消优先于审批等待，否则 promise 悬挂）
    for (const [id, p] of this.pendingApprovals) {
      if (p.agentId === agentId) {
        clearTimeout(p.timer);
        p.cleanup?.();
        approvalOwners.delete(id);
        this.pendingApprovals.delete(id);
        p.resolve({ approved: false, scope: "once", note: "worker 已取消" });
      }
    }
    w.controller.abort();
    return true;
  }

  /** 仍在途（未终态）的 agent_id 清单。给模型面用：回执报"手上还有几个"，拒绝语报"哪些才是真的"。 */
  inFlightAgents(): string[] {
    const out: string[] = [];
    for (const w of this.workers.values()) if (!w.finished) out.push(w.agentId);
    return out;
  }

  /** 模型侧按 id 撤自己派出去的活（能力 4 的动态调整；与面板/IPC 的取消走**同一个** cancelAgent，
   *  另起一条"取消"的路 = 两处口径必漂）。分类三分支都报：把"已结束"混进"撤掉了"会让模型以为省下了额度。 */
  cancelAgents(ids: readonly string[]): { cancelled: string[]; terminal: string[]; unknown: string[] } {
    const cancelled: string[] = [];
    const terminal: string[] = [];
    const unknown: string[] = [];
    for (const id of ids) {
      const w = this.workers.get(id);
      if (!w) { unknown.push(id); continue; }
      if (w.finished) { terminal.push(id); continue; }
      if (this.cancelAgent(id)) cancelled.push(id);
      else terminal.push(id); // 竞争窗口：刚被查过又落定了，不谎报成"撤掉了"
    }
    return { cancelled, terminal, unknown };
  }

  /** 取消全树（主会话取消沿树全 abort，§4.4.2）。返回实际取消的 agent_id 清单。
   *  M3c：未触发的延迟后环一并撤销（落流可见，不静默）。 */
  cancelAll(): string[] {
    const cancelled: string[] = [];
    for (const w of this.workers.values()) {
      if (!w.finished && this.cancelAgent(w.agentId)) cancelled.push(w.agentId);
    }
    for (const [callId] of [...this.deferredSpawns]) {
      this.deferredSpawns.delete(callId);
      void this.opts.emit({
        type: "tool_result",
        callId,
        ok: false,
        hold: "cancelled",
        output: "[harness] 后环 spawn 撤销（主会话已取消）",
      } as AgentEvent).catch(() => {});
    }
    this.root.abort();
    return cancelled;
  }

  /** 薄委托：worker 审批决议（§11.7.6 的 always 拒绝在 orchestrator-approvals.ts）。 */
  decideWorkerApproval(id: string, approved: boolean, scope: AskScope): { ok: boolean; error?: string } {
    return this.acs.decideWorkerApproval(id, approved, scope);
  }

  /** 薄委托：待决议审批 id（审批等待表在 orchestrator-approvals.ts）。 */
  pendingApprovalIds(): string[] {
    return this.acs.pendingApprovalIds();
  }

  /** 薄委托：sequencer 状态只读快照（链状态整箱在 orchestrator-approvals.ts）。 */
  pipelineSnapshot(callId: string): PipelineChain | null {
    return this.acs.pipelineSnapshot(callId);
  }

  /** 薄委托：pipeline spawn（stages 解析冻结 → 整链一个审批 → 哑 sequencer，整支在 orchestrator-approvals.ts）。 */
  private async spawnPipeline(args: SpawnArgs, ctx: { callId?: string }): Promise<ToolResult> {
    return await this.acs.spawnPipeline(args, ctx);
  }

  /** 薄委托：M5c supervise 受限自适应循环（整支在 orchestrator-approvals.ts）。 */
  private async spawnSupervise(args: SpawnArgs, ctx: { callId?: string }): Promise<ToolResult> {
    return await this.acs.spawnSupervise(args, ctx);
  }

  /** 薄委托：级联前提（cascadeUpgrade × routing）整支在 orchestrator-budget.ts。 */
  private cascadeReady(): boolean {
    return this.bcb.cascadeReady();
  }

  /** 薄委托：升档决策面（同 provider 阶梯）整支在 orchestrator-budget.ts。 */
  private cascadePlanFor(agentId: string, budgetLeft: number): { from: ModelTier | undefined; ladder: { id: string; tier: ModelTier }[]; note: string } {
    return this.bcb.cascadePlanFor(agentId, budgetLeft);
  }

  /** 薄委托：被淘汰档的收尾（cleanupWrite）在 orchestrator-budget.ts。 */
  private async cleanupSuperseded(agentId: string): Promise<void> {
    await this.bcb.cleanupSuperseded(agentId);
  }

  /** 薄委托：stage 角色解析（内置 implement/review/test 与 plugin: 形态，整支在 orchestrator-approvals.ts）。 */
  private resolveStageRole(role: string): StageRoleResolution | { error: string } {
    return this.acs.resolveStageRole(role);
  }

  /** 薄委托：worker 终态后解析依赖链（唤醒后环 / 标记 dependency_failed，整支在 orchestrator-approvals.ts）。 */
  private resolveDependents(agentId: string, status: "done" | "failed" | "cancelled"): void {
    this.acs.resolveDependents(agentId, status);
  }

  /** 薄委托：放行 sequencer 同步点（等待表整箱在 orchestrator-approvals.ts）。 */
  private resolveTerminalWaiters(agentId: string, status: "done" | "failed" | "cancelled", result: Extract<AgentEvent, { type: "agent_result" }> | null): void {
    this.acs.resolveTerminalWaiters(agentId, status, result);
  }

  /** 薄委托：W1a 收队（等待与回执整形整箱在 orchestrator-approvals.ts）。 */
  async waitForAgents(ids: readonly string[], timeoutMs: number, signal?: AbortSignal): Promise<JoinPayloadBody> {
    return await this.acs.waitForAgents(ids, timeoutMs, signal);
  }

  // ---- M3c：卡死检测出口（§4.4.8：人决定继续/取消）----

  /** 卡死出口一：用户「继续」= card_action(resume) 清除 stuck 态（worker 在暂停点恢复）。 */
  resumeAgent(agentId: string): boolean {
    const w = this.workers.get(agentId);
    if (!w || !w.stuckActive) return false;
    w.stuckActive = false;
    w.paused = false;
    const waiters = [...w.pauseWaiters];
    w.pauseWaiters.length = 0;
    for (const fn of waiters) fn();
    this.armStuckSilence(w); // 重新武装静默计时
    void this.opts.emit({ type: "agent_status", agent_id: agentId, status: "running" } as AgentEvent).catch(() => {});
    return true;
  }

  /** 卡死暂停闸：stuck 态下在下一事件 append 处阻塞 worker loop（provider 拉取随之暂停）；resume/abort 解除。 */
  private async stuckGate(w: WorkerHandle): Promise<void> {
    if (!w.paused) return;
    await new Promise<void>((resolve) => {
      const cleanup = (): void => {
        const idx = w.pauseWaiters.indexOf(done);
        if (idx >= 0) w.pauseWaiters.splice(idx, 1);
        w.controller.signal.removeEventListener("abort", onAbort);
      };
      const onAbort = (): void => {
        cleanup();
        resolve();
      };
      const done = (): void => {
        cleanup();
        resolve();
      };
      w.pauseWaiters.push(done);
      w.controller.signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  /** 心跳 = 子流事件天然时间戳：每次事件刷新静默计时器（不造独立心跳事件，§4.4.8）。 */
  private armStuckSilence(w: WorkerHandle): void {
    if (w.stuckTimer !== null) clearTimeout(w.stuckTimer);
    w.lastActivityAt = Date.now();
    if (!(this.stuckConf.silenceMs > 0)) return;
    const t = setTimeout(() => {
      if (!w.finished && !w.stuckActive && !w.controller.signal.aborted) {
        void this.triggerStuck(w, "静默超过 " + String(Math.round(this.stuckConf.silenceMs / 1000)) + "s（子流无新事件）").catch(() => {});
      }
    }, this.stuckConf.silenceMs);
    t.unref?.(); // 计时器绝不拽住进程退出（验收脚本 waitAll 后进程必须能自然收束）
    w.stuckTimer = t;
  }

  private async triggerStuck(w: WorkerHandle, detail: string): Promise<void> {
    if (w.stuckActive || w.finished || w.controller.signal.aborted) return;
    w.stuckActive = true;
    w.paused = true;
    await this.opts.emit({ type: "agent_status", agent_id: w.agentId, status: "waiting_input", reason: "stuck" } as AgentEvent);
    await this.opts.emit({
      type: "agent_message",
      agent_id: w.agentId,
      kind: "progress",
      text: "[stuck] 疑似卡死：" + detail + "。人决定：继续（resume 清除卡死态）或取消（既有取消链）。worker 已在事件边界暂停。",
    } as AgentEvent);
  }

  /** 卡死判定（纯函数消费点）：tool_result 到达后跑检测器；命中 → waiting_input(stuck) + 提醒 + 暂停。 */
  private async evaluateStuck(w: WorkerHandle): Promise<void> {
    if (w.stuckActive || w.finished) return;
    const v = detectStuck(w.stuckTurns, this.stuckConf);
    if (!v.stuck) return;
    const detail =
      v.rule === "same_action_obs_x4"
        ? "同动作+同观察连续 " + String(v.repeats) + " 轮"
        : "同动作+报错连续 " + String(v.repeats) + " 轮";
    await this.triggerStuck(w, "rule=" + v.rule + "（" + detail + "）");
  }

  /** 卡死窗口记账：tool_call → action 摘要；tool_result → 配对成 StuckTurn（滑动窗口，内存帽）。 */
  private recordStuckTurn(w: WorkerHandle, e: AgentEvent): void {
    if (e.type === "tool_call") {
      w.stuckCallActions.set(e.id, stuckActionOf(e.name, e.args));
    } else if (e.type === "tool_result") {
      const action = w.stuckCallActions.get(e.callId);
      if (action !== undefined) {
        w.stuckTurns.push({ action, observation: stuckObservationOf(e.output), ok: e.ok });
        const cap = Math.max(this.stuckConf.windowSize, this.stuckConf.maxActionObsRepeats, this.stuckConf.maxActionErrorRepeats);
        while (w.stuckTurns.length > cap) w.stuckTurns.shift();
        w.stuckCallActions.delete(e.callId);
      }
    }
  }

  async waitAll(timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (this.activeCount() > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  // ---- 内部：worker 运行体 ----

  private async runWorker(w: WorkerHandle): Promise<void> {
    // §9.10：worker 与主会话共用同一套插件钩子（工厂按 worker 档给视图）。
    // 提到 try 外并挂到 handle 上：SubagentStop 从 finish() 那条漏斗发，那里拿不到本函数的局部量；
    // 两条 Subagent 事件与 Pre/PostToolUse 必须共用同一视图，否则同一个钩子一边降过档、另一边没降。
    const workerHooks = this.opts.workerHooks?.(w.mode) ?? null;
    w.hooks = workerHooks;
    try {
      // §9.5 SubagentStart：matcher 字段 = agent 类型；stdout 的 additionalContext 必须进 worker 的
      // system 块——只发事件不接回执，就是本面点过多次的「收下即丢」。
      const startContext = await this.subagentHook(w, "SubagentStart");
      const system = await buildWorkerSystemMessages(w, this.opts.workspace, startContext); // 记忆注入恒读主 checkout（裁决 2）
      // M3c：插件角色工具面裁剪（frontmatter.tools 白名单 − disallowedTools；裁剪后必须非空）
      // M7：影响面读端三处同源（规格 / 实例 / loop 白名单），开关关着时一处都不加 ⇒ 零行为。
      const impactOn = this.opts.impactAnalysis === true;
      const baseTable = buildWorkerToolTable(w, this, {
        impactAnalysis: impactOn,
        // 沙箱出口随 worker 一起下传：worker 的 shell 是独立于主会话那一道门的执行面。
        ...(this.opts.workerShell ? { shell: this.opts.workerShell } : {}),
      });
      const table = filterWorkerTable(w, baseTable);
      const specs = filterWorkerSpecs(w, workerToolSpecs(w.mode, { impactAnalysis: impactOn }));
      const provider = createWorkerProvider({
        readEvents: () => w.events,
        system,
        ...(w.model ? { model: w.model } : {}),
        tools: specs,
        signal: w.controller.signal,
        // M3c worker 压缩（§7.5）：同一 runCompaction 链路、参数独立（ratio 0.95）、keep_first=task+context
        //（worker 的 task/context 在 system 块永不被压缩——结构性 keep_first）。
        ...(this.opts.workerSummarizer || this.opts.workerCompaction
          ? {
              compaction: {
                agentId: w.agentId,
                config: workerBudgetConfig(w, this.opts.workerCompaction ?? {}),
                ...(this.opts.workerSummarizer ? { summarizer: this.opts.workerSummarizer } : {}),
                toolsSchemaChars: JSON.stringify(specs).length,
                onCompaction: async (ev: AgentEvent) => {
                  await this.opts.emit(ev);
                },
                onUsage: (u: { inputTokens: number; outputTokens: number }) => {
                  w.usage.inputTokens += u.inputTokens;
                  w.usage.outputTokens += u.outputTokens;
                },
              },
            }
          : {}),
      });
      // M3b write mode：runLoop 的 workspace = worktree（文件工具 cwd 锁定 + run_shell cwd 同源）——
      // worktree 对 worker 完全可写（§4.4.5）；read worker 维持主 workspace（只读面不变）。
      const loopWorkspace = w.mode === "write" && w.worktree ? worktreePathFor(this.opts.workspace, w.agentId) : this.opts.workspace;
      // W4a：write worker 的收束闸（缺省不接线 = 零行为）。钩子工厂拿 worktree 目录做 cwd，
      // 所以它验的是「即将被合并的那份代码」而不是主 checkout。
      const workerVerify = w.mode === "write" ? this.opts.workerVerify?.(loopWorkspace) : undefined;
      // B6（审查）：runLoop 前武装静默计时——旧实现只在收到子流事件时武装，worker 在首个模型
      // 调用挂起（无任何事件）时静默规则永不触发。缺省 silenceMs 10min，不改变正常路径。
      this.armStuckSilence(w);
      await runLoop({
        provider,
        events: { append: (e) => this.workerPipeline(w, e) },
        workspace: loopWorkspace,
        mode: w.mode === "write" ? "auto" : "read-only", // 权限层二次拦截（写 worker 的真实门在 gatedWorkerTool 管线）
        maxSteps: w.maxTurns,
        allowedTools: workerToolTable(w.mode, impactOn) as never, // 三重硬闸之二：loop 工具表白名单（与规格/实例同源）
        tools: table,
        signal: w.controller.signal,
        agentId: w.agentId,
        ...(workerHooks ? { hooks: workerHooks } : {}),
        ...(workerVerify ? { verify: workerVerify, autoVerify: true } : {}),
      });
      // loop 可以在取消后正常返回；终态看信号，不能只靠 catch 判断取消。
      if (w.controller.signal.aborted) {
        await this.finish(w, "cancelled");
        return;
      }
      // 零输出 worker 不得收成 done：runLoop 只在自己的子流落一条带 agent_id 的 delivery 红，
      // 父模型按 agent_id 过滤后只看到 status:done + 空 summary ——「什么都没做」被显示成成功。
      const emptyRun = w.events.some((e) =>
        e.type === "tool_result" && e.callId === DELIVERY_GUARD_CALL_ID && e.output === EMPTY_RUN_DELIVERY);
      if (emptyRun) {
        await this.finish(w, "failed", "empty_run: 上游模型未产出任何工具调用或正文");
        return;
      }
      await this.finish(w, "done");
    } catch (err) {
      if (err instanceof WorkerCancelled || w.controller.signal.aborted) {
        await this.finish(w, "cancelled");
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        const reason = msg.includes("maxSteps") || msg.includes("max_turns") ? "max_turns" : msg.slice(0, 300);
        await this.finish(w, "failed", reason);
      }
    }
  }

  /** worker 事件管线：卡死暂停闸 → 装饰 agent_id → 落主流（emit，文本先过输出扫描——密钥不进主转录）
   *  → 进 worker 内存态（上下文组装源，保持原始事件）。M3c：本管线也是卡死检测的心跳与判定点。 */
  private async workerPipeline(w: WorkerHandle, e: AgentEvent): Promise<void> {
    if (w.controller.signal.aborted) throw new WorkerCancelled();
    await this.stuckGate(w); // stuck 态：worker 在事件边界暂停（resume/取消解除）
    // 进内存态（原始事件，provider 投影用）
    w.events.push(e);
    this.armStuckSilence(w); // 心跳 = 子流事件天然时间戳（§4.4.8 不造独立心跳）
    this.recordStuckTurn(w, e);
    if (e.type === "usage") {
      w.usage.inputTokens += e.inputTokens;
      w.usage.outputTokens += e.outputTokens;
    } else if (e.type === "tool_call") {
      w.toolStats[e.name] = (w.toolStats[e.name] ?? 0) + 1;
    }
    // 落主流（带 agent_id 的子流；文本字段过 redactSecrets——子流也落 JSONL，密钥不外泄）。
    // 2026-10-19 重构：loop 交给消费者的是**原件**（见 loop.ts 的 redactEventForLog），
    // 所以脱敏在这一侧做；`w.events`（内存态）因此拿到的是**真内容** ——
    // 安全扫描面（collectChangeSet → scanChangeSet）要靠它认出密钥，脱敏后再扫就成了一道
    // 静默空转的闸（写进文件里的 AKIA… 在 report 里报 total=0）。
    const streamed = redactEventForLog(withAgentId(e, w.agentId));
    await this.opts.emit(streamed);
    // progress 消息（§4.4.8：agent_message{kind:progress}；面板子流最近事件的数据源之一）
    if (e.type === "assistant_message" && e.content.trim() !== "") {
      const scannedContent = streamed.type === "assistant_message" ? streamed.content : e.content;
      await this.opts.emit({
        type: "agent_message",
        agent_id: w.agentId,
        kind: "progress",
        text: scannedContent.slice(0, 500),
      } as AgentEvent);
    }
    // M3c 卡死判定：tool_result 到达后跑纯函数检测器（触发 → waiting_input(stuck) + 提醒 + 暂停）
    if (e.type === "tool_result") {
      await this.evaluateStuck(w);
      if (w.controller.signal.aborted) throw new WorkerCancelled();
    }
  }

  /** 终态收束（§4.4.4/§4.4.8）：done/failed 出 agent_result + 合成 tool_result；cancelled 出终止态 + tool_result。
   *  M3b write mode：done → diff 快照（vs base_commit）+ 安全 gate 流水 + artifacts（stat 摘要/diff_ref）；
   *  failed/cancelled → worktree 自动清理（四路清理之三/四路）。 */
  // ---- M5b 步骤 9：bandit 在线学习运行时（整箱在 orchestrator-budget.ts；下面为薄委托） ----
  private banditEnabled(): boolean {
    return this.bcb.banditEnabled();
  }

  /** 薄委托：bandit 状态懒加载在 orchestrator-budget.ts。 */
  private async bandit() {
    return await this.bcb.bandit();
  }

  /** 薄委托：奖励回灌（done × 客观证据 → reward）在 orchestrator-budget.ts。 */
  private async rewardBandit(w: WorkerHandle, status: "done" | "failed" | "cancelled"): Promise<void> {
    await this.bcb.rewardBandit(w, status);
  }

  /** §9.5 SubagentStart / SubagentStop 的唯一发送口（两条事件共用一个出口，免得同族策略各抄一份）。
   *  回执口径：additionalContext 照收（它不额外花模型轮次）；errors 出声；blocked **只标不拦**——
   *  exit 2 的语义是「要求再多跑一轮」，那是要用户付钱的裁决（任务 #32），裁前不改收束行为。
   *  SubagentStop 的 additionalContext 则无处可去：该 agent 已终态，没有下一个模型轮，丢弃是有意的。 */
  private async subagentHook(w: WorkerHandle, event: "SubagentStart" | "SubagentStop"): Promise<string> {
    const hooks = w.hooks;
    if (!hooks) return "";
    try {
      const r = await hooks.run(event, {
        event,
        agent_id: w.agentId,
        ...(w.agentType !== undefined ? { agent_type: w.agentType } : {}),
      });
      for (const msg of r.errors) console.warn("[hooks] " + event + ":", msg);
      if (r.blocked) console.warn("[hooks] " + event + " 返回阻断（exit 2 的「再多要一轮」未裁，已忽略）：" + (r.blockReason ?? ""));
      return r.additionalContext;
    } catch (err) {
      console.warn("[hooks] " + event + " 失败:", err instanceof Error ? err.message : String(err));
      return "";
    }
  }

  private async finish(w: WorkerHandle, status: "done" | "failed" | "cancelled", reason?: string): Promise<void> {
    try {
      await this.finishInner(w, status, reason);
      // M5b 步骤 9：终态事件已落流 → 回灌奖励（学习侧信道：best-effort，内部自吞错误，不阻断收束）
      await this.rewardBandit(w, status);
      // §9.5 SubagentStop：排在终态事件全部落流之后——审计型钩子要读得到这份产出。
      // 位置即「每 worker 恰好一次」：三条调用路（done/failed/cancelled）互斥，
      // 且 finishInner 有 w.finished 幂等闸兜住重入；w.closed 尚未置真，进程不会在钩子中途退出。
      await this.subagentHook(w, "SubagentStop");
    } catch (err) {
      // 收尾中途抛（emit 落盘失败 / 窗口已销毁 / diff 流水炸）⇒ lastResult 再也挂不上来。
      // 必须放行等待方与后环，否则这是一次**永挂**：finished 已真 → cancelAgent 拒绝、
      // finishInner 幂等闸短路，而 waitForAgentTerminal 没有超时。判它 failed（拿不出终态
      // 产出就是没过），并把错误照旧上抛给 runWorker 的 catch-all——不新增吞错误的路。
      if (!w.terminalResolved) {
        w.terminalResolved = true;
        // **终态要改口**（2026-10-19 独立评审追出的 HIGH）：`finishInner` 在发 done 之前就把
        // `w.terminalStatus = "done"` 盖上了；`emit(doneResult)` 一抛（磁盘满 / 事件形状非法），
        // 后面那几行（lastResult / terminalResolved / resolveTerminalWaiters）全被跳过 ⇒
        // ① 终态仍读成 "done" ⇒ 父会话拿到 `{"status":"done","summary":""}` ——
        //    **一句"成功但没有产出"的谎**（那正是 terminal-sync-window 那组判据要防的东西）；
        // ② 耐久日志里只有 agent_status:done、没有 agent_result ⇒ 重启后 interruptedWorkers
        //    看见终态就返回 [] ⇒ 永远补不上 failed(interrupted) ⇒ 僵尸 worker；
        // ③ `agentOwners` 与内存回收（下面两行）被跳过 ⇒ 路由表里永远留着这个 agent
        //    ⇒ 崩溃恢复的过滤器（`orchestratorForAgent(id) === null`）跳过它 ⇒ 救不回来。
        // 这里把三样都补齐：终态改口成 failed、路由表摘掉、内存回收照做。
        w.terminalStatus = "failed";
        w.lastResult = undefined; // 拿不出产出就是没有产出（不装一份空报告）
        this.resolveTerminalWaiters(w.agentId, "failed", null);
        this.resolveDependents(w.agentId, "failed");
        agentOwners.delete(w.agentId);
        this.releaseWorkerMemory(w);
        console.warn("[orchestrator] worker 收尾中途失败，按 failed 放行等待方：" + w.agentId + " "
          + (err instanceof Error ? err.message : String(err)));
      }
      throw err;
    } finally {
      w.closed = true;
    }
  }

  private async finishInner(w: WorkerHandle, status: "done" | "failed" | "cancelled", reason?: string): Promise<void> {
    if (w.finished) return;
    w.finished = true;
    w.closed = false;
    w.terminalStatus = status;
    if (w.stuckTimer !== null) {
      clearTimeout(w.stuckTimer);
      w.stuckTimer = null;
    }
    for (const [id, p] of this.pendingApprovals) {
      if (p.agentId === w.agentId) {
        clearTimeout(p.timer);
        p.cleanup?.();
        approvalOwners.delete(id);
        this.pendingApprovals.delete(id);
        p.resolve({ approved: false, scope: "once", note: "worker 已终态（" + status + "）" });
      }
    }
    const ts = Date.now();
    if (status === "cancelled") {
      if (w.mode === "write") await this.wmr.cleanupWrite(w, "cancelled");
      await this.opts.emit({ type: "agent_status", agent_id: w.agentId, status: "cancelled", ...(reason ? { reason } : {}), ts } as AgentEvent);
      await this.wmr.emitSyntheticResult(w, {
        ok: false,
        body: { agent_id: w.agentId, status: "cancelled", reason: reason ?? "用户取消" },
      });
      // M3c：sequencer 同步点 + 依赖链（cancelled 也是依赖失败——后环不静默跳过）
      w.terminalResolved = true; // 无 result 也要放行等待方：否则 sequencer 永挂（cancel 分支本就不发 agent_result）
      this.resolveTerminalWaiters(w.agentId, "cancelled", null);
      this.resolveDependents(w.agentId, "cancelled");
      agentOwners.delete(w.agentId);
      this.releaseWorkerMemory(w);
      return;
    }
    const report = lastAssistantText(w.events) ?? "";
    const scanned = scanModelOutput(report).text;
    const clipped = clipWorkerSummary(scanned);
    if (status === "done") {
      // ---- M3b write mode：done → diff 快照 + 安全 gate 流水（先于 agent_result，面板先有 diff）----
      let diff: { stat: string; patch: string; files: string[] } | null = null;
      let llmNote = "";
      if (w.mode === "write" && w.worktree && w.baseCommit) {
        diff = await worktreeDiff(worktreePathFor(this.opts.workspace, w.agentId), w.baseCommit).catch(() => null);
        if (diff !== null && this.safeMode !== "off") {
          llmNote = await this.wmr.emitWorkerDiffSecurity(w, diff);
        }
        if (diff !== null) await this.wmr.emitWorkerDiffSnapshot(w, diff, llmNote);
      }
      await this.opts.emit({ type: "agent_message", agent_id: w.agentId, kind: "report", text: clipped.text } as AgentEvent);
      await this.opts.emit({ type: "agent_status", agent_id: w.agentId, status: "done", ts } as AgentEvent);
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
      if (w.mode === "write") await this.wmr.cleanupWrite(w, "failed");
      // failed：错误永不冒充结果——status/reason 分型；max_turns 附 partial 报告（§4.4.8 闸门）
      await this.opts.emit({ type: "agent_status", agent_id: w.agentId, status: "failed", reason, ts } as AgentEvent);
      const failedSpent = spentUsdFor(w.price, w.usage);
      const failedResult: Extract<AgentEvent, { type: "agent_result" }> = {
        type: "agent_result",
        agent_id: w.agentId,
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
    agentOwners.delete(w.agentId);
    this.releaseWorkerMemory(w);
  }

  /** B7（审查）：终态资源回收——root abort 监听器摘除（once 监听不触发即永久驻留，长会话单调增长）
   *  + 子流内存态裁剪（w.events 是 handle 的内存大头）。handle 本体保留：依赖链 terminalStatus 查询 /
   *  合并控制塔 / 评审重启都要读终态 handle（直接 workers.delete 会砍断这三条路由）。
   *  评审重启（injectComment：write 且合并决策未决）需要 w.events 作上下文——只在不可重启态
   *  （read worker，或 write 已过合并决策点）裁剪。幂等，可多处调用。 */
  private releaseWorkerMemory(w: WorkerHandle): void {
    if (w.onRootAbort) {
      this.root.signal.removeEventListener("abort", w.onRootAbort);
      w.onRootAbort = undefined;
    }
    if (w.mode !== "write" || !mergeOwners.has(w.agentId)) {
      w.events.length = 0;
      // P2-8（审查）：diff 版本计数同批回收（diffVersions 以 agentId 为键、只增不减，见
      // worker-merge.ts 的 diffVersion）。**与 w.events 同门槛**：write worker 合并决策未决时可被
      // injectComment 评审重启（第二次 done → diff v2），该计数必须跨重启存活——否则 v2 会被重置回 v1。
      // 只在不可重启态（read worker / write 已过合并决策点）回收，泄漏被 cleanupWrite 兜底。
      this.diffVersions.delete(w.agentId);
    }
  }

  // ---- M3b 合并控制塔（§4.3/§4.4.5：合并唯一出口 = git 面板；本组方法只被 card_action 协议路由调用）----
  // 三枚薄委托，实现整箱在 worker-merge.ts。

  /** 薄委托：批准合并（唯一出口的登记校验 / gate 二次确认 / commit → merge --no-ff → 清理在 worker-merge.ts）。 */
  async mergeWorker(agentId: string, opts: { force?: boolean } = {}): Promise<{ ok: boolean; error?: string }> {
    return await this.wmr.mergeWorker(agentId, opts);
  }

  /** 薄委托：拒绝合并（worktree 清理 + keep_branch 语义在 worker-merge.ts）。 */
  async rejectWorker(agentId: string, opts: { keepBranch?: boolean } = {}): Promise<{ ok: boolean; error?: string }> {
    return await this.wmr.rejectWorker(agentId, opts);
  }

  /** 薄委托：评审闭环的行级评论注入（活跃 / 评审重启两态在 worker-merge.ts）。 */
  async injectComment(agentId: string, path: string, line: number, body: string): Promise<{ ok: boolean; injected: boolean; error?: string }> {
    return await this.wmr.injectComment(agentId, path, line, body);
  }

  /** 薄委托：worker 审批请求（§4.4.3 与 turn 解耦；四路共用的等待内核在 orchestrator-approvals.ts）。 */
  async requestWorkerApproval(
    w: WorkerHandle,
    tool: string,
    args: Record<string, unknown>,
    risk: RiskLevel,
    riskReasons: string[],
  ): Promise<{ approved: boolean; scope: AskScope; note?: string }> {
    return await this.acs.requestWorkerApproval(w, tool, args, risk, riskReasons);
  }
}

// ---- 模块级辅助（纯函数为主） ----

/** worker 会话型 provider：忽略 loop 传入 messages，每轮从 worker 内存态事件现拼上下文（sidechat 同构）。
 *  M3c：worker 压缩（§7.5）挂在每轮组装前——超阈值走同一 runCompaction 链路（零第二套摘要实现），
 *  compaction 事件进 worker 内存态（投影生效）+ 落主流（agent_id 归因）+ 摘要 usage 计入该 worker。 */
export interface WorkerCompactionRuntime {
  agentId: string;
  config: CompactionConfig;
  summarizer?: Summarizer;
  toolsSchemaChars: number;
  /** 压缩事件落流口（主流 emit；agent_id 已在事件上）。 */
  onCompaction: (e: AgentEvent) => Promise<void>;
  /** 摘要调用 usage 归因（§7.5 计入 usage(agent_id)，§4.4.10 不破例）。 */
  onUsage: (u: { inputTokens: number; outputTokens: number }) => void;
}

export function createWorkerProvider(opts: {
  readEvents: () => AgentEvent[];
  system: GlmMessage[];
  model?: WorkerModel;
  tools?: GlmToolSpec[];
  signal?: AbortSignal;
  /** M3c：worker 压缩运行时（缺省 undefined = 不压缩——既有路径字节不变）。 */
  compaction?: WorkerCompactionRuntime;
}): Provider {
  const tools = opts.tools ?? workerToolSpecs();
  return {
    stream(): AsyncIterable<ModelOutput> {
      return runOneRound();
    },
  };
  async function* runOneRound(): AsyncGenerator<ModelOutput> {
    if (opts.signal?.aborted) throw new WorkerCancelled();
    // B9（审查）：每轮只投影一次——压缩估算与消息组装共用同一投影，压缩真正发生时才重投影
    //（旧实现估算投影一次、组装再投影一次，O(n)×2/轮）。跨轮增量投影留位第三批：compaction
    // 追加会使既有投影整体失效（excludedIds/summary_offset 改写历史），增量折叠需显式失效语义。
    const events = opts.readEvents();
    const factor = calibrateFactor(events);
    let projected: ContextMessage[] = projectContext(events);
    if (opts.compaction) {
      const compacted = await maybeCompactWorkerEvents(opts.compaction, events, projected, factor, opts.system);
      if (compacted) {
        projected = projectContext(opts.readEvents());
      }
    }
    const msgs: GlmMessage[] = [...opts.system, ...(projected as GlmMessage[])];
    const model = opts.model ?? defaultWorkerModel;
    yield* model(msgs, tools);
    if (opts.signal?.aborted) throw new WorkerCancelled();
  }
}

/** worker 子流压缩（§7.5）：估算（system+工具 schema 全量计入）→ shouldCompact → runCompaction。
 *  成功：compaction 事件（agent_id 归因）进 worker 内存态 + 落主流；摘要 usage 追加 usage(agent_id) 事件。
 *  B9：投影由调用方传入（每轮一次）；返回是否发生了压缩（调用方据此重投影）。 */
async function maybeCompactWorkerEvents(
  c: WorkerCompactionRuntime,
  events: AgentEvent[],
  projected: ContextMessage[],
  factor: number,
  system: GlmMessage[],
): Promise<boolean> {
  const systemChars = system.reduce((n, m) => n + (m.content?.length ?? 0), 0);
  const estimate = estimateContextTokens(projected, { systemChars, toolSchemaChars: c.toolsSchemaChars }, factor);
  const decision = shouldCompact(estimate, c.config);
  if (!decision) return false;
  const outcome = await runCompaction({
    events,
    trigger: decision.trigger,
    reason: decision.reason,
    ...(decision.trigger !== "overflow" && c.summarizer ? { summarizer: c.summarizer } : {}),
    config: c.config,
  });
  if (!outcome.ok) return false; // 压缩失败不阻断 worker（下一轮重判；overflow 兜底仍在）
  // worker 内存态推入**不带 agent_id** 的压缩事件（worker 投影生效，keep_first=task+context 由
  // system 块结构性保障）；落主流时才加 agent_id 归因（主投影按 agent_id 跳过 worker 压缩事件，
  // 其 compressed_event_ids 是 worker 内存态序号，对主流照搬会错误摘除主事件——context.isWorkerCompaction）。
  events.push(outcome.event);
  await c.onCompaction({ ...outcome.event, agent_id: c.agentId } as AgentEvent);
  if (outcome.event.usage) {
    c.onUsage(outcome.event.usage);
    await c.onCompaction({
      type: "usage",
      inputTokens: outcome.event.usage.inputTokens,
      outputTokens: outcome.event.usage.outputTokens,
      agent_id: c.agentId,
    } as AgentEvent);
  }
  return true;
}

// ---- 公开面（拆分后不变）：以下符号的实现住在轻模块里，本文件按原路径继续导出 ----
export {
  MAX_CONCURRENT_WORKERS, MAX_PIPELINE_STAGES, ORCHESTRATOR_STUCK_CONFIG, READ_MODE_MAX_TURNS,
  SPAWN_MODES, SUMMARY_TOKEN_CAP, WORKER_COMPACTION_CONFIG, WORKER_FORBIDDEN_TOOLS, WORKER_TOOL_TABLE,
  WRITE_WORKER_FORBIDDEN_TOOLS, WRITE_WORKER_TOOL_TABLE, workerBudgetConfig,
} from "./orchestrator-config";
export {
  READONLY_GIT_SUBCOMMANDS, READONLY_SHELL_COMMANDS, interceptDestructiveGit, isReadOnlyShellCommand,
  shell_ro, shell_rw, workerToolSpecs,
} from "./worker-shell-tools";
export { clampTier, clipWorkerSummary, isPermissionMode, parseSpawnedAgentId, scanModelOutput } from "./worker-report";
export type { ClippedSummary } from "./worker-report";
export { WorkerCancelled, defaultWorkerModel, loadWorkerScript, scriptedWorkerModel } from "./worker-model";
export type { WorkerModel } from "./worker-model";
export type {
  OrchestratorOptions, PipelineChain, PipelineChainStageState, RawStageArgs, SpawnArgs,
  StageRoleResolution, WorkerContext, WorkerHandle,
} from "./orchestrator-types";
export {
  chainTable, digestArgs, filterWorkerSpecs, filterWorkerTable, parseStringList,
  parseWorkerContext, scanStreamEvent, withAgentId,
} from "./worker-projection";
export { globIntersects, semanticConflictsVia } from "./lease-conflicts";
export { findToolCallEventId } from "./call-id-index";
export { WORKER_SYSTEM, WORKER_WRITE_SYSTEM, buildWorkerSystemMessages, lastAssistantText } from "./worker-prompt";
export { buildWorkerToolTable } from "./worker-tool-table";
