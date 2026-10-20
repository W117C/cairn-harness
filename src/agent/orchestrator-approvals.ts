// 三缝之二（orchestrator-approvals）：审批协议（租约相交 spawn / pipeline 整链 / supervise 受限循环 /
// worker 工具四路共用同一个等待内核）＋哑 sequencer 链 ＋ worker 终态等待（sequencer 同步点与收队）。
// 四路的共同纪律是「与 turn 解耦」：先登记等待、再 emit 请求，应答按 id 订阅（坑十六），超时 fail-closed。
// 2026-10-17 从 orchestrator.ts 抽出（同 orchestrator-budget 先例：搬整段实现、原路径留公开面）——
// Orchestrator 的对应方法保留为薄委托，类 API 与文件尾 barrel 逐字不变。
// 状态装箱：approvalSeq / terminalWaiters 是本缝独占（随域搬入）；pendingApprovals / chains /
// deferredSpawns / workers / 取消信号有非本缝读者（spawn 的 stages 冻结闸、finishInner、cancelAgent……）
// ⇒ 留 Orchestrator，以**活引用**注入；出圈动作（spawn / 合并 / 清理 / 成本闸 / 级联）全走回调，
// 不反向 import orchestrator.ts。
import { HARNESS_HOLD_PROSE_TOKEN, type AgentEvent } from "../events";
import type { AskScope, RiskLevel } from "../permissions";
import type { ModelTier } from "../providers/registry";
import { runCascade } from "../routing/cascade";
import type { ToolResult } from "../tools/base";
import { globIntersects } from "./lease-conflicts";
import { shapeJoinRows, spentUsdFor, type JoinInput, type JoinPayloadBody } from "./orchestrator-join";
import type { PipelineChain, SpawnArgs, StageRoleResolution, WorkerHandle } from "./orchestrator-types";
import { BUILTIN_ROLES, concatStageTask, parseStages, parseVerdict, resolvePluginRole, type PluginAgentRoleDef } from "./sequencer";
import { parseSuperviseContract } from "./supervise-contract";
import { decideSupervisor, ringVerdict, superviseApprovalDigest, type SupervisorAction } from "./supervisor";
import { chainTable, digestArgs, parseStringList } from "./worker-projection";

/** 审批等待表项（与 Orchestrator 里那张表的元素结构同形：resolve 由 waitForApproval 登记时挂上）。 */
interface PendingApproval {
  agentId: string;
  resolve: (r: { approved: boolean; scope: AskScope; note?: string }) => void;
  timer: ReturnType<typeof setTimeout>;
  /** 摘除 abort 监听器（normal/超时/取消三条出口都要调，否则 root.signal 上监听器累积）。 */
  cleanup?: () => void;
}

export interface ApprovalsChainsSuperviseDeps {
  /** 四域只用到这几个开关 + emit（结构性窄面，OrchestratorOptions 直接可赋）。 */
  opts: {
    emit: (e: AgentEvent) => Promise<void>;
    /** 会话成本上限（supervise 审批卡上的 budget 读数；构造期已归一为 null）。 */
    budget?: { maxUsd: number; pricePerMTok: number; priceModel?: string } | null;
    /** 插件/用户角色解析（"plugin-name:agent-name" 形态调它；未接钩子时恒不命中）。 */
    agentRoleFor?: (invoke: string) => PluginAgentRoleDef | null;
    cascadeUpgrade?: boolean;
    cascadeMaxUpgrades?: number;
  };
  /** 审批等待表（活引用：finishInner / cancelAgent 直接遍历它兜掉同 agent 的等待项）。 */
  pendingApprovals: Map<string, PendingApproval>;
  approvalTimeoutMs: number;
  /** 审批所有者路由（模块级 approvalOwners 表的写删；由 Orchestrator 闭包注入）。 */
  markOwner: (id: string) => void;
  dropOwner: (id: string) => void;
  /** pipeline 链表（活引用：spawn() 的 stages 冻结闸读它）。 */
  chains: Map<string, PipelineChain>;
  /** 依赖链登记（活引用：spawn() 写入，本域删除并触发）。 */
  deferredSpawns: Map<string, { callId: string; args: SpawnArgs; dependsOn: string[] }>;
  /** 活跃 worker 表（活引用；只读遍历）。 */
  workers: ReadonlyMap<string, WorkerHandle>;
  /** 主会话取消信号（活引用：环与环之间 / 延迟触发前 fail-closed 检查）。 */
  signal: AbortSignal;
  /** 写租约求交（实现在 orchestrator.ts：globIntersects × 活跃 write worker）。 */
  leaseConflicts: (resources: string[]) => { agentId: string; resource: string }[];
  /** sequencer 的逐环 spawn 入口（实现在 orchestrator.ts；不走模型 spawn 面，角色面由代码注入）。 */
  spawnStage: (args: SpawnArgs, ctx: { callId?: string; cascadeFrom?: ModelTier }, stageRole: StageRoleResolution) => Promise<ToolResult>;
  /** 模型 spawn 面（depends_on 延迟触发走它；实现在 orchestrator.ts）。 */
  spawn: (args: SpawnArgs, ctx: { callId?: string }) => Promise<ToolResult>;
  /** 本编排器已派 worker id 快照（收队缺省面：ids 为空 = 等全部）。 */
  workerIds: () => string[];
  /** 成本闸与级联（实现在 orchestrator-budget.ts，构造时注入活体）。 */
  budgetBlocked: () => boolean;
  rejectOnBudget: (callId?: string) => Promise<ToolResult>;
  cascadeReady: () => boolean;
  cascadePlanFor: (agentId: string, budgetLeft: number) => { from: ModelTier | undefined; ladder: { id: string; tier: ModelTier }[]; note: string };
  cleanupSuperseded: (agentId: string) => Promise<void>;
  /** worker 合并与 worktree 收尾（实现在 orchestrator.ts / worker-merge 缝）。 */
  mergeWorker: (agentId: string) => Promise<{ ok: boolean; error?: string }>;
  cleanupWrite: (w: WorkerHandle, why: "rejected") => Promise<void>;
}

/** 编排器实例序号（模块级）：让并发会话的审批 id 不撞号。 */
let APPROVAL_INSTANCE_SEQ = 0;

/** 本类只被 orchestrator.ts 使用（薄委托的宿主）；不导出到文件尾 barrel。 */
export class ApprovalsChainsSupervise {
  /** 审批 id 序号（三处协议共用：apr-<instance>-<n>-<agentId | supervise | pipeline>）。 */
  private approvalSeq = 0;
  /** 编排器实例前缀：旧 id = `apr-1-pipeline`，两个并发会话各发第一张卡时 id 完全相同，
   *  模块级 approvalOwners 后写覆盖先写 ⇒ 一张卡永远等不到决议、另一张批错会话。 */
  private readonly approvalTag = (++APPROVAL_INSTANCE_SEQ).toString(36);
  private nextApprovalId(suffix: string): string {
    return "apr-" + this.approvalTag + "-" + String(++this.approvalSeq) + "-" + suffix;
  }
  /** worker 终态等待（sequencer 逐环同步点；finishInner 解析）。 */
  private readonly terminalWaiters = new Map<string, Array<(r: { status: string; result: Extract<AgentEvent, { type: "agent_result" }> | null }) => void>>();

  constructor(private readonly deps: ApprovalsChainsSuperviseDeps) {}

  /** 审批等待内核（三处审批协议共用：spawn / pipeline 整链 / worker 工具）。
   *  登记等待 → 超时 fail-closed → 所有者路由（approvalOwners 供 approval_resolved 反查编排器）。
   *  坑十六先例（M3b 复训）：调用方必须**先拿到本 promise、再 emit 请求**——事件驱动的决议方
   *  可能在 emit 的 await 解析前就到，先 emit 会丢掉决议。
   *  调用方只负责各自的 approval_requested / approval_resolved 载荷（三处字段不同）。 */
  private waitForApproval(id: string, agentId: string): Promise<{ approved: boolean; scope: AskScope; note?: string }> {
    return new Promise<{ approved: boolean; scope: AskScope; note?: string }>((resolve) => {
      const settle = (r: { approved: boolean; scope: AskScope; note?: string }): void => {
        clearTimeout(timer);
        this.deps.signal.removeEventListener("abort", onAbort);
        this.deps.pendingApprovals.delete(id);
        this.deps.dropOwner(id);
        resolve(r);
      };
      const onAbort = (): void => {
        settle({ approved: false, scope: "once", note: "主会话已取消（审批 fail-closed 拒绝）" });
      };
      const timer = setTimeout(() => {
        settle({ approved: false, scope: "once", note: "审批超时（fail-closed 拒绝）" });
      }, this.deps.approvalTimeoutMs);
      this.deps.pendingApprovals.set(id, { agentId, resolve: settle, timer, cleanup: () => this.deps.signal.removeEventListener("abort", onAbort) });
      this.deps.markOwner(id);
      // 主会话取消必须释放审批等待：旧实现只挂超时，取消后要等满 approvalTimeoutMs 才收束，
      // 期间 worker 仍在等一张永远不会被决议的卡。
      if (this.deps.signal.aborted) onAbort();
      else this.deps.signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  /** 租约相交的 spawn 审批（§4.4.3 与 turn 解耦：请求落流 + 等待订阅式应答；超时 fail-closed 拒绝）。 */
  async requestSpawnApproval(agentId: string, warning: string, conflicts: { agentId: string; resource: string }[]): Promise<boolean> {
    const id = this.nextApprovalId(agentId);
    const outcomePromise = this.waitForApproval(id, agentId);
    await this.deps.opts.emit({
      type: "approval_requested",
      id,
      agent_id: agentId,
      tool: "spawn_agent",
      args_digest: "resources 相交（" + conflicts.map((c) => c.resource).join("、").slice(0, 160) + "）",
      risk: "medium",
      risk_reasons: [warning],
    } as AgentEvent);
    const outcome = await outcomePromise;
    await this.deps.opts.emit({
      type: "approval_resolved",
      id,
      agent_id: agentId,
      decision: outcome.approved ? "approved" : "rejected",
      scope: "once",
      ...(outcome.approved ? {} : { reason: "写租约相交未获批准（fail-closed）" }),
    } as AgentEvent);
    return outcome.approved;
  }

  /** worker 审批决议（§4.4.3 与 turn 解耦：任何时刻可决议，不挂任何进行中的 turn）。
   *  scope=always 拒绝（§11.7.6：worker 永不写 always）——审批保持 pending，可再以 once/session_kind 决议。 */
  decideWorkerApproval(id: string, approved: boolean, scope: AskScope): { ok: boolean; error?: string } {
    const entry = this.deps.pendingApprovals.get(id);
    if (!entry) return { ok: false, error: "未知或已决议的审批 id: " + id };
    if (approved && scope === "always") {
      return { ok: false, error: "worker 永不写 always：scope=always 仅主会话可发（§11.7.6），本次批准被拒绝" };
    }
    clearTimeout(entry.timer);
    entry.cleanup?.();
    this.deps.pendingApprovals.delete(id);
    this.deps.dropOwner(id);
    entry.resolve({ approved, scope });
    return { ok: true };
  }

  pendingApprovalIds(): string[] {
    return [...this.deps.pendingApprovals.keys()];
  }

  /** sequencer 状态只读快照（验收断言面；不提供任何变更通道——stages 批准后冻结）。 */
  pipelineSnapshot(callId: string): PipelineChain | null {
    return this.deps.chains.get(callId) ?? null;
  }

  /** pipeline spawn：stages 解析冻结 → 整链一个审批（stages 全表 + 链内租约合并警告）→ 后台逐环 spawn。 */
  async spawnPipeline(args: SpawnArgs, ctx: { callId?: string }): Promise<ToolResult> {
    const parsed = parseStages(args.stages);
    if (!parsed.ok) return { ok: false, output: "spawn_agent(pipeline): " + parsed.why };
    const callId = ctx.callId ?? "";
    if (callId === "") {
      return { ok: false, output: "spawn_agent(pipeline): 缺 callId（无法挂回整链合成结果）" };
    }
    const stages = parsed.stages;
    // 角色解析在审批前完成并随链冻结（与 stages 同刻）：runChain 后环 spawn 不再依赖
    // currentPluginRuntime 的存活期——主 run 结束清空插件运行时后，链仍按批准时的角色面跑完。
    const resolutions: StageRoleResolution[] = [];
    for (let i = 0; i < stages.length; i++) {
      const resolved = this.resolveStageRole(stages[i]!.role);
      if ("error" in resolved) {
        return { ok: false, output: "spawn_agent(pipeline): stage " + String(i + 1) + " 角色解析失败：" + resolved.error };
      }
      resolutions.push({ ...resolved, role: stages[i]!.role }); // M5b：角色名随解析冻结，供路由选档/审计
    }
    // 整链一个审批（§2.2 裁决 2）：批准即授权全链；链内各环写租约在审批卡合并警告
    const chainResources = parseStringList(args.resources);
    const conflicts = this.deps.leaseConflicts(chainResources);
    const reasons = [
      "pipeline 整链一个审批：批准即授权全部 " + String(stages.length) + " 环（stages 批准后冻结，模型不可增删改）",
      "stages 全表: " + stages.map((s, i) => String(i + 1) + "." + s.role + "：" + s.task.slice(0, 40)).join(" → "),
      ...(conflicts.length > 0 ? ["链内写租约相交：" + conflicts.map((c) => c.resource).join("、") + "（合并冲突预测）"] : []),
    ];
    const approved = await this.requestChainApproval(callId, reasons);
    if (!approved) {
      return { ok: false, output: "spawn_agent(pipeline): 未获批准（整链一个审批，fail-closed）" };
    }
    const chain: PipelineChain = {
      callId,
      stages,
      resolutions,
      state: stages.map((s, i) => ({ index: i, role: s.role, task: s.task, agentId: null, status: "pending" as const })),
      // 写面随链冻结（与 stages 同刻）：逐环登记才谈得上约束，只印在卡上是警示不是租约。
      ...(chainResources.length > 0 ? { resources: [...chainResources] } : {}),
      status: "running",
    };
    this.deps.chains.set(callId, chain);
    await this.emitSequencerStatus(chain, "链已批准启动：" + String(stages.length) + " 环（" + stages.map((s) => s.role).join(" → ") + "）");
    void this.runChain(chain).catch(() => {}); // sequencer 边界永不炸主 loop
    return { ok: true, output: JSON.stringify({ pipeline: true, chain_id: callId, stages: stages.length, stage_roles: stages.map((s) => s.role) }) };
  }

  /** M5c supervise：受限自适应循环（§m5-proposal 步骤 11 / §5.1 双轨）。
   *  审批卡批准的是 { goal, budget, forbidden, maxStages }——与 pipeline 的 stages 全表**分开**（数据层双轨：
   *  渲染卡只渲染 args_digest/risk_reasons，放什么契约是编排器的职责，pipeline 冻结断言不受影响）。
   *  循环：spawn 环 worker → verdict → decideSupervisor → accept / retry / spawn / escalate / abort（有界）。
   *  V1 单角色 implement（write）自适应重试；畸形 report（verdict 缺失）→ escalate（fail-visible，不静默猜）。
   *  决策经 agent_message 落流（[supervisor] 审计轨迹，无需新事件类型）。 */
  async spawnSupervise(args: SpawnArgs, ctx: { callId?: string }): Promise<ToolResult> {
    const callId = ctx.callId ?? "";
    if (callId === "") {
      return { ok: false, output: "spawn_agent(supervise): 缺 callId（无法挂回受限循环结果）" };
    }
    const goal = typeof args.task === "string" ? args.task.trim() : "";
    if (goal === "") {
      return { ok: false, output: "spawn_agent(supervise): task（goal）必填" };
    }
    // 受限循环参数解析（契约面与规格面同源；fail-visible：非法/不可申报的键一律拒，不静默回落）
    const sup = parseSuperviseContract(args.supervise);
    if (sup.contract === null) {
      return { ok: false, output: "spawn_agent(supervise): " + (sup.error ?? "契约解析失败") };
    }
    const { maxStages, forbidden } = sup.contract;
    // 模型申报的写面（规格：resources）——真轨迹那次它写了 resources 而循环整支丢掉它。
    // 现在逐环登记：环活着的时候这条链占住声明的面，别的派活与它相交会在自己的审批卡上撞见点名。
    const ringResources = parseStringList(args.resources);
    const budget = this.deps.opts.budget?.maxUsd ?? 0;
    // 审批双轨：批准 {goal, budget, forbidden, maxStages}（§5.1：与 pipeline stages 全表分开）
    const approved = await this.requestSuperviseApproval(callId, { goal, budget, forbidden, maxStages });
    if (!approved) {
      return { ok: false, output: "spawn_agent(supervise): 未获批准（受限循环授权，fail-closed）" };
    }
    const roleResolved = this.resolveStageRole("implement");
    if ("error" in roleResolved) {
      return { ok: false, output: "spawn_agent(supervise): implement 角色解析失败：" + roleResolved.error };
    }
    const stageRole: StageRoleResolution = { ...roleResolved, role: "implement" };
    const repeats = new Map<string, number>();
    // M6：环 worktree 生命周期——write 环 worker done 后 worktree 留待合并，supervise 没有合并塔介入，
    // 循环出口必须显式收尾（accept 合并最终环 / 其余 reject），否则 worktree 泄漏污染 workspace。
    const ringAgentIds: string[] = [];
    const rejectRings = async (ids: string[]): Promise<void> => {
      for (const id of ids) await this.deps.cleanupSuperseded(id);
    };
    let lastAgentId = "";
    let lastFailure = "";
    let lastReport = "";
    let stageCount = 0;
    for (;;) {
      stageCount++;
      // H2（审查 B-3）：环与环之间检查取消（与 runChain 同纪律）
      if (this.deps.signal.aborted) {
        await rejectRings(ringAgentIds);
        return { ok: false, output: "spawn_agent(supervise): 主会话已取消，受限循环中止（fail-closed）" };
      }
      if (this.deps.budgetBlocked()) {
        await this.deps.rejectOnBudget(callId);
        await rejectRings(ringAgentIds);
        return { ok: false, output: "spawn_agent(supervise): 成本闸超限，受限循环中止" };
      }
      // 有界保险③：同 (role, task-hash) 出现次数（≥3 强制 escalate，防死循环）
      const taskHash = String(goal.length) + ":" + lastFailure.slice(0, 60);
      const key = "implement|" + taskHash;
      const repeatCount = (repeats.get(key) ?? 0) + 1;
      repeats.set(key, repeatCount);

      const stageCallId = callId + "-sup" + String(stageCount);
      const stageTask = stageCount === 1 ? goal : concatStageTask(goal, lastAgentId, lastReport);
      const r = await this.deps.spawnStage(
        {
          task: stageTask,
          mode: stageRole.mode,
          ...(ringResources.length > 0 && stageRole.mode === "write" ? { resources: ringResources } : {}), // 见上：申报过就真占（只读环不挂空租约）
          // P1（审查）：forbidden 进 WorkerContext.constraints（提示词层，buildWorkerSystemMessages 渲染
          // context.constraints）——旧实现塞字符串被 parseWorkerContext 丢弃，契约提示全程零落地。
          ...(forbidden.length > 0
            ? { context: { constraints: forbidden.map((f) => "supervise-forbidden（禁改面）：" + f) } }
            : {}),
        },
        { callId: stageCallId },
        stageRole,
      );
      if (!r.ok) {
        await rejectRings(ringAgentIds);
        return { ok: false, output: "spawn_agent(supervise): 环 " + String(stageCount) + " spawn 失败：" + r.output };
      }
      let agentId = "";
      try {
        agentId = (JSON.parse(r.output) as { agent_id?: string }).agent_id ?? "";
      } catch {
        agentId = "";
      }
      if (agentId === "") {
        await rejectRings(ringAgentIds);
        return { ok: false, output: "spawn_agent(supervise): 环 " + String(stageCount) + " spawn 应答异常（无 agent_id）" };
      }
      ringAgentIds.push(agentId);
      const term = await this.waitForAgentTerminal(agentId);
      if (term.result === null) {
        await rejectRings(ringAgentIds);
        return { ok: false, output: "spawn_agent(supervise): 环 " + String(stageCount) + " 终态 " + term.status + "（无结果）→ 受限循环中止" };
      }
      const report = term.result.artifacts.report ?? term.result.summary;
      // P1（审查）：forbidden 契约强制层——diff 触碰禁改面 = 本环失败（报告 verdict 不采信）。
      // 注入 fail 进既有决策机（retry/spawn/escalate/abort 有界：repeat 防死循环与 maxStages 照常兜底），
      // 不绕过 decideSupervisor；lastFailure 随注入文本点名被触碰面，下一环反馈可读。
      const changedFiles = term.result.artifacts?.files_changed ?? [];
      const violated = forbidden.filter((g) => changedFiles.some((f) => globIntersects(f, g)));
      // P1（审查）：失败环 diff 摘要喂回——已改文件清单随 report 进 lastReport（concatStageTask 拼
      // 进下一环任务书），下一环不再从零猜波及面。追加在尾部，不干扰 parseVerdict 的行首锚点。
      const diffNote = changedFiles.length > 0 ? "\n已改文件（worktree diff）：" + changedFiles.join("、") : "";
      const effectiveReport = (violated.length > 0
        ? "verdict: fail\nforbidden 违反：" + violated.join("、") + "（禁改面被触碰，报告 verdict 不采信）\n" + report
        : report) + diffNote;
      // 判据来源（`ringVerdict`）：有机器凭据 `artifacts.verified` 就只认凭据；凭据缺席才回落到
      // 报告里的 verdict 契约行（无 verify 面的仓库里散文是唯一读物——未闭的一半已立案）。
      // 旧实现只读散文 ⇒ supervise 恒 escalate（implement 任务书里没有 verdict 行可解析），
      // 反方向还留着一道洞：报告里自写一行 `verdict: pass` 就能换取自动合并。
      const verdict = ringVerdict({
        evidence: term.result.artifacts.verified,
        prose: parseVerdict(effectiveReport),
        forbiddenViolated: violated.length > 0,
      });
      const action: SupervisorAction = decideSupervisor({
        verdict,
        stageCount,
        maxStages,
        budgetBlocked: this.deps.budgetBlocked(),
        // 重复闸数的是"**同一件事反复失败**"（supervisor-check B2 那三格用的都是 verdict:"fail"）。
        // 这一环**通过了** ⇒ 没有可防的循环（这一环就是终点）⇒ 传 0。
        // 旧实现把上一环的失败计数原样递给这一环 ⇒ 连败三环之后的**第四环即使通过**也被 escalate：
        // 父会话拿到"已升级人工裁决"（一份"失败"的回执），而那一环明明做对了，它的 worktree
        // 被留着等人工合并 ⇒ **主干永远拿不到这次改动**（实测 end-to-end：主仓没有那个文件）。
        // 决策函数本身**逐字未动**（它的单元契约由 supervisor-check 的 A 段钉着）：
        // 改的是**这一环该递什么数**——通过了就没有"重复"可言。
        repeatCount: verdict === "pass" ? 0 : repeatCount,
        lastAgentId,
        lastFailure,
        nextRole: "implement",
      });
      // 决策审计轨迹落流（agent_message，无需新事件类型）
      const decisionText =
        action.kind === "retry" ? "retry " + action.agent_id + "：" + action.feedback.slice(0, 80)
        : action.kind === "spawn" ? "spawn " + action.role
        : action.kind === "escalate" ? "escalate：" + action.why
        : action.kind === "abort" ? "abort：" + action.why
        : "accept";
      await this.deps.opts.emit({
        type: "agent_message",
        agent_id: agentId,
        kind: "progress",
        text: "[supervisor] 环 " + String(stageCount) + "/" + String(maxStages) + "（" + term.status + "，判据=" + (verdict ?? "无判据") + "，凭据=" + (term.result.artifacts.verified ?? "无写盘") + "）→ " + decisionText,
      } as AgentEvent).catch(() => {});
      if (action.kind === "accept") {
        // 收尾：最终环有真实写改动（以 finishInner 的 worktreeDiff files_changed 为准——工具调用
        // 计数会把 shell_rw 改的文件漏成 0、把失败的 write_file 尝试误算成有改动）→ 合并落盘
        // （mergeWorker 自带清理）；无改动 → 直接清理。前序环一律 reject（supervise 不建合并塔）。
        const finalHandle = this.deps.workers.get(agentId);
        const hasChanges = (term.result.artifacts?.files_changed?.length ?? 0) > 0;
        let merged = false;
        if (hasChanges && finalHandle?.mode === "write" && finalHandle.worktree) {
          const m = await this.deps.mergeWorker(agentId);
          merged = m.ok;
          if (!m.ok) {
            // P1（审查）：合并失败保留最终环 worktree+分支——冲突路径刚承诺「在 worktree 内人工
            // 解决后重试合并」，gate 模式 force 二次确认也还活着；只 reject 前序环。
            await rejectRings(ringAgentIds.filter((id) => id !== agentId));
            return { ok: false, output: "spawn_agent(supervise): 最终环合并失败（worktree 已保留：冲突可在 git 面板人工解决/force 合并）：" + m.error };
          }
        } else if (finalHandle?.worktree) {
          await this.deps.cleanupWrite(finalHandle, "rejected");
        }
        await rejectRings(ringAgentIds.filter((id) => id !== agentId));
        return {
          ok: true,
          output: JSON.stringify({ supervise: true, chain_id: callId, stages: stageCount, status: "accepted", final_agent: agentId, merged }),
        };
      }
      // escalate / abort = 「交给人判」这两条出口：证据必须活着到人手边。旧实现在这里先 rejectRings
      // （含最终环）删掉 worktree 与分支，再回去问人——真语料里三份**改对了**的收队回执就是这样
      // 在升级前被销毁的（ga-strategy-2026-09-20 三次复跑，逐笔读到 `已清理（rejected）` 早于 escalate）。
      // 与既有的「合并失败保留最终环 worktree」同形：只 reject 前序环，最终环留着，
      // 现场由 `scanOrphanWorktrees` 在面板点名（泄漏有界且可见，不换取据销毁）。
      // 取消 / 成本闸两条出口仍全量 reject：那是用户与钱的显式信号，不是「请人来判这份交付」。
      if (action.kind === "escalate") {
        await rejectRings(ringAgentIds.filter((id) => id !== agentId));
        return { ok: false, output: "spawn_agent(supervise): 已升级人工裁决：" + action.why + this.ringScene(agentId) };
      }
      if (action.kind === "abort") {
        await rejectRings(ringAgentIds.filter((id) => id !== agentId));
        return { ok: false, output: "spawn_agent(supervise): " + action.why + this.ringScene(agentId) };
      }
      // retry / spawn → 续环：更新前环上下文（错误永不冒充结果；forbidden 注入的 fail 理由随行）
      lastAgentId = agentId;
      lastFailure = effectiveReport.slice(0, 300);
      lastReport = effectiveReport;
    }
  }

  /** supervise 整链审批（§5.1 双轨：批准 {goal, budget, forbidden, maxStages}；agent_id 缺省——链没有 worker 身份）。 */
  private async requestSuperviseApproval(
    callId: string,
    contract: { goal: string; budget: number; forbidden: string[]; maxStages: number },
  ): Promise<boolean> {
    const id = this.nextApprovalId("supervise");
    const outcomePromise = this.waitForApproval(id, "");
    const digest = superviseApprovalDigest(contract);
    await this.deps.opts.emit({
      type: "approval_requested",
      id,
      tool: "spawn_agent",
      args_digest: digest,
      risk: "medium",
      risk_reasons: [
        "supervise 受限循环授权（非 stages 全表，§5.1 双轨）：批准即授权 ≤" + String(contract.maxStages) + " 环自适应执行（实现→客观判据→失败重试/升级/中止）",
      ],
    } as AgentEvent);
    const outcome = await outcomePromise;
    await this.deps.opts.emit({
      type: "approval_resolved",
      id,
      decision: outcome.approved ? "approved" : "rejected",
      scope: "once",
      ...(outcome.approved ? {} : { reason: "supervise 受限循环未获批准（fail-closed）" }),
    } as AgentEvent);
    return outcome.approved;
  }

  /** 整链审批（§4.4.3 与 turn 解耦；agent_id 缺省——链没有 worker 身份，审批以 id 路由）。 */
  private async requestChainApproval(callId: string, reasons: string[]): Promise<boolean> {
    const id = this.nextApprovalId("pipeline");
    const outcomePromise = this.waitForApproval(id, ""); // 链没有 worker 身份，agentId 空串
    await this.deps.opts.emit({
      type: "approval_requested",
      id,
      tool: "spawn_agent",
      args_digest: "pipeline 整链审批（stages 批准后冻结）：" + reasons.slice(0, 2).join("；").slice(0, 180),
      risk: "medium",
      risk_reasons: reasons,
    } as AgentEvent);
    const outcome = await outcomePromise;
    await this.deps.opts.emit({
      type: "approval_resolved",
      id,
      decision: outcome.approved ? "approved" : "rejected",
      scope: "once",
      ...(outcome.approved ? {} : { reason: "pipeline 整链未获批准（fail-closed）" }),
    } as AgentEvent);
    return outcome.approved;
  }

  /** 哑 sequencer 主循环（sequencer 自身零 LLM）：逐环 spawn → 等终态 → 报告拼接 → verdict 标注 → 整链终态。
   *  唯一会「同一环再跑一遍」的是 cascadeUpgrade（且只由客观 verify 证据触发，整链预算见下）；
   *  缺省关 ⇒ 每环恰好一次 worker，与今日逐字同形。 */
  private async runChain(chain: PipelineChain): Promise<void> {
    let prevReport = "";
    let prevAgentId = "";
    // 级联预算挂在**链**上而不是挂在环上：N 环各享 maxUpgrades 会变成「一次批准悄悄买 2N 遍」。
    let cascadeLeft = this.deps.opts.cascadeUpgrade === true ? (this.deps.opts.cascadeMaxUpgrades ?? 2) : 0;
    // 批准时随链冻结的写面：每一环起手都带上它（否则登记表里链是空的，见 spawnPipeline）
    const ringResources = chain.resources ?? [];
    for (let i = 0; i < chain.stages.length; i++) {
      // H2（审查 B-3）：环与环之间检查取消——否则 cancelAll 后链停在两环之间，
      // 会 spawn 出一个永不被取消的 worker 并跑完（addEventListener 不追认已 abort）。
      if (this.deps.signal.aborted) {
        await this.failChain(chain, "stage " + String(i + 1) + " 未启动：主会话已取消（fail-closed，不再派发）");
        return;
      }
      const stage = chain.stages[i]!;
      const st = chain.state[i]!;
      const resolved = chain.resolutions[i]!; // 批准时冻结的角色解析（不依赖运行时存活期）
      const budgetBlock = this.deps.budgetBlocked();
      if (budgetBlock) {
        await this.failChain(chain, "成本闸：会话成本超限（maxBudgetUsd），stage " + String(i + 1) + " spawn 被拒");
        return;
      }
      await this.emitSequencerStatus(chain, "stage " + String(i + 1) + "/" + String(chain.stages.length) + "（" + stage.role + "）启动");
      st.status = "running";
      const stageCallId = chain.callId + "-s" + String(i + 1);
      // 前环 agent_result.report 由代码拼进后环 task（[harness] 标注；§4.4.7）
      const stageTask = i === 0 ? stage.task : concatStageTask(stage.task, prevAgentId, prevReport);
      const stageArgs: SpawnArgs = {
        task: stageTask,
        mode: resolved.mode,
        // 链级写租约逐环持有（任务 #16）：整链审批卡上那句「链内写租约相交」此前只是**印出来**，
        // 环登记的却是空租约 ⇒ `leaseConflicts()` 看不见正在写盘的链，后来者静默并发。
        // 只给真会写盘的环带：`leaseConflicts` 按 mode==="write" 取料，给只读环挂一份租约等于
        // 在事件里写一个不会生效的面——那正是本笔要修的"印了不占"的缩小版。
        ...(ringResources.length > 0 && resolved.mode === "write" ? { resources: ringResources } : {}),
        ...(i > 0 ? { depends_on: [prevAgentId] } : {}), // depends_on sugar：后环 depends_on 前环（§4.5 预置链）
        ...(resolved.maxTurns !== undefined ? { max_turns: resolved.maxTurns } : {}),
        ...(resolved.model !== undefined ? { model: resolved.model } : {}),
      };
      const r = await this.deps.spawnStage(stageArgs, { callId: stageCallId }, resolved);
      if (!r.ok) {
        await this.failChain(chain, "stage " + String(i + 1) + "（" + stage.role + "）spawn 失败：" + r.output);
        return;
      }
      let agentId = "";
      try {
        agentId = (JSON.parse(r.output) as { agent_id?: string }).agent_id ?? "";
      } catch {
        agentId = "";
      }
      if (agentId === "") {
        await this.failChain(chain, "stage " + String(i + 1) + " spawn 应答异常（无 agent_id）");
        return;
      }
      st.agentId = agentId;
      let term = await this.waitForAgentTerminal(agentId);
      // M5b 级联升级（#45）：判据只用**客观**那一半——worker 事件流里的 verify_result
      // （W4b 四态随 agent_result.artifacts.verified 带回）。只有 failed / stale 才升档：
      // 终态 failed/cancelled 属环境类失败，换一档重跑同一环境只会再花一遍钱；
      // absent 是没判据 ⇒ 不拿猜测换账单。模型自报的 verdict 不算判据（自己给自己打分）。
      type StageTerm = { status: string; result: Extract<AgentEvent, { type: "agent_result" }> | null };
      const evidenceOf = (t: StageTerm) => t.result?.artifacts.verified;
      const objectiveFail = (t: StageTerm): boolean =>
        evidenceOf(t) === "failed" || evidenceOf(t) === "stale";
      // 升上来的那一档必须自己交出绿证据才算过。算上 absent 就等于花真钱买回一份
      // 比触发时更弱的证据，还把环标成 done —— 正是本仓最忌的假绿形状。
      const converged = (t: StageTerm): boolean =>
        t.status === "done" && t.result !== null && evidenceOf(t) === "verified";
      // 决策面在 runChain 之外（cascadePlanFor）：§4.4.7「哑 sequencer」判据（agents-check N6c）
      // 要求这段源码里不出现档位表那一层——环只按客观判据决定「要不要再花一遍钱」，往哪档花是策略的事。
      const plan = objectiveFail(term) && this.deps.cascadeReady() ? this.deps.cascadePlanFor(agentId, cascadeLeft) : null;
      if (plan !== null) {
        const ladder = plan.ladder;
        if (ladder.length > 0) {
          await this.deps.opts.emit({
            type: "agent_message", agent_id: agentId, kind: "progress",
            text: "[cascade] stage " + String(i + 1) + "（" + stage.role + "，" + String(plan.from) + " 档）客观判据判它没过（"
              + evidenceOf(term) + "）→ 升档重跑：" + ladder.map((r) => r.tier).join("→"),
          } as AgentEvent);
          let supersededId = agentId;
          // 末次 rung 自报的失败细节：runCascade 的 decisions 只记档位不记原因，
          // 不接住的话「升档仍未拿到绿证据」这条红连"最后一档到底说了什么"都查不到。
          let lastRungNote = "";
          let paidReruns = 0; // **真起来的** worker 数（spawn 失败 / 应答异常的不算已付费）
          // 另一类失败（终态 failed / cancelled = 环境、配额、取消）之后不再往上爬：换一档重跑同一
          // 环境只会再花一遍钱得同一结果。这条对首环成立，对升上来的每一档同样成立——旧写法只管第一手观察。
          let stopClimb = "";
          const escalated = await runCascade({
            hasJudge: true, // 进到这里的前提就是拿到了 failed/stale —— 判据确实存在
            maxRungs: cascadeLeft,
            rungs: ladder.map((r, k) => ({
              id: r.id,
              tier: r.tier,
              run: async (): Promise<{ ok: boolean; output?: string }> => {
                if (this.deps.signal.aborted) { stopClimb = "主会话已取消：不再升档重跑"; return { ok: false, output: stopClimb }; }
                if (this.deps.budgetBlocked()) { stopClimb = "整链成本闸已触发：不再升档重跑"; return { ok: false, output: stopClimb }; }
                if (stopClimb !== "") return { ok: false, output: stopClimb };
                if (cascadeLeft <= 0) return { ok: false, output: "整链升级预算用尽：不再重跑" };
                cascadeLeft--;
                const rr = await this.deps.spawnStage(
                  { ...stageArgs, model: r.id },
                  { callId: stageCallId + "-up" + String(k + 1), cascadeFrom: k === 0 ? plan.from : ladder[k - 1]!.tier },
                  resolved,
                );
                if (!rr.ok) return { ok: false, output: "升级 spawn 失败：" + rr.output };
                let newId = "";
                try { newId = (JSON.parse(rr.output) as { agent_id?: string }).agent_id ?? ""; } catch { newId = ""; }
                if (newId === "") return { ok: false, output: "升级 spawn 应答异常（无 agent_id）" };
                paidReruns++;
                // 替代品已经在了，才回收被取代那一档的 worktree（顺序反过就会在升级失败时
                // 把唯一一份改动连同分支一起删掉，还留下一个 diff_ref 指向已删目录的报告）
                await this.deps.cleanupSuperseded(supersededId);
                supersededId = newId;
                agentId = newId;
                st.agentId = newId;
                term = await this.waitForAgentTerminal(newId);
                const ok = converged(term);
                lastRungNote = "第 " + String(k + 1) + " 档（" + newId + "，" + r.tier + "）"
                  + (ok ? "绿证据到手" : "终态 " + term.status + "（证据 " + (evidenceOf(term) ?? "absent") + "，result " + (term.result === null ? "无" : "有") + "）");
                if (!ok && term.status !== "done") stopClimb = lastRungNote + " ⇒ 属另一类失败，停止升档";
                return { ok, output: lastRungNote };
              },
            })),
          });
          if (!escalated.ok) {
            st.status = "failed";
            // runCascade 的 blockedNote 只说"为什么不再往上走"（预算/最高档），说的是**表**；
            // stopClimb 才是**因**（另一类失败 / 取消 / 成本闸）——两者都得上这条红。
            await this.failChain(chain, "stage " + String(i + 1) + "（" + stage.role + "）升档重跑 " + String(paidReruns)
              + " 次仍未拿到绿证据（末次证据 " + (evidenceOf(term) ?? "absent") + "）"
              + (escalated.blockedNote ? "：" + escalated.blockedNote : "")
              + (stopClimb !== "" ? "；" + stopClimb : lastRungNote !== "" ? "；" + lastRungNote : "")
              + " → 整链 failed（各环报告可见）");
            return;
          }
        } else {
          // 该升而升不动也要说出来（预算用尽 / 已在最高档 / 认不出这一跑选了谁）：
          // 静默什么都不做是最难查的省钱——链照旧红着，但没人知道闸为什么没跳。
          await this.deps.opts.emit({
            type: "agent_message", agent_id: agentId, kind: "progress",
            text: "[cascade] 客观判据判 stage " + String(i + 1) + " 没过（" + evidenceOf(term) + "），但无可升档位："
              + plan.note + " ⇒ 不升级",
          } as AgentEvent);
        }
      }
      if (term.status !== "done" || term.result === null) {
        st.status = "failed";
        await this.failChain(chain, "stage " + String(i + 1) + "（" + stage.role + "，" + agentId + "）终态 " + term.status + " → 整链 failed（各环报告可见）");
        return;
      }
      st.status = "done";
      const report = term.result.artifacts.report ?? term.result.summary;
      st.reportPreview = report.slice(0, 160);
      // gate 环 verdict 标注（V1 只标注不重跑，§4.4.7 范围收敛）
      if (stage.gate === true || BUILTIN_ROLES[stage.role]?.gate === true) {
        const verdict = parseVerdict(report);
        st.verdict = verdict;
        await this.deps.opts.emit({
          type: "agent_message",
          agent_id: agentId,
          kind: "progress",
          text: "[sequencer] gate verdict=" + verdict + "（标注落流；V1 不重跑，loopback 随压力测试后再定）",
        } as AgentEvent);
      }
      prevReport = report;
      prevAgentId = agentId;
    }
    chain.status = "done";
    await this.emitSequencerStatus(chain, "整链 done：\n" + chainTable(chain));
    await this.deps.opts.emit({
      type: "tool_result",
      callId: chain.callId,
      ok: true,
      output: "[harness] pipeline 整链 done（sequencer 零 LLM 展开）：\n" + chainTable(chain),
    } as AgentEvent);
  }

  /** 整链失败（任一环 failed → 整链 failed；各环报告可见）。 */
  private async failChain(chain: PipelineChain, reason: string): Promise<void> {
    chain.status = "failed";
    chain.reason = reason;
    for (const st of chain.state) {
      if (st.status === "pending" || st.status === "running") st.status = "failed";
    }
    await this.emitSequencerStatus(chain, "整链 failed：" + reason + "\n" + chainTable(chain));
    await this.deps.opts.emit({
      type: "tool_result",
      callId: chain.callId,
      ok: false,
      hold: "chain-failed",
      output: "[harness] pipeline 整链 failed（各环报告可见）：\n" + chainTable(chain) + "\n原因：" + reason,
    } as AgentEvent);
  }

  /** 「交给人判」那两条出口（escalate / abort）的现场说明：最终环的 worktree 与分支此刻被**刻意保留**，
   *  回执必须点名它落在哪儿——否则「保留了」这句话对模型和用户都不可执行（读到一个动词却没有地址）。 */
  private ringScene(agentId: string): string {
    const w = this.deps.workers.get(agentId);
    if (w === undefined || w.worktree === undefined) return "";
    const branch = w.branch;
    return "（现场已保留：worktree=" + w.worktree + "，分支=" + (branch === undefined ? "未建" : branch) + "，可在 git 面板人工合并或丢弃）";
  }

  /** sequencer 状态只读呈现（tool_result；§4.4.7「pipeline worker 的 tool_result 里 sequencer 状态只读呈现」）。 */
  private async emitSequencerStatus(chain: PipelineChain, text: string): Promise<void> {
    await this.deps.opts.emit({
      type: "tool_result",
      callId: "pipeline-" + chain.callId,
      ok: chain.status !== "failed",
      output: "[sequencer] （只读状态·模型不可改 §4.4.7）" + text,
    } as AgentEvent);
  }

  /** stage 角色解析：内置 implement/review/test；"plugin:agent-name" 形态走 agentRoleFor（§9.6）。 */
  resolveStageRole(role: string): StageRoleResolution | { error: string } {
    const builtin = BUILTIN_ROLES[role];
    if (builtin) {
      return { mode: builtin.mode, maxTurns: builtin.maxTurns, roleDefinition: builtin.roleDefinition };
    }
    if (role.includes(":")) {
      const def = this.deps.opts.agentRoleFor ? this.deps.opts.agentRoleFor(role) : null;
      if (!def) return { error: "agent 角色未注册: " + role + "（plugin-name:agent-name 或 user:agent-name；agentRoleFor 未命中）" };
      const mapped = resolvePluginRole(def);
      return {
        mode: mapped.mode,
        ...(mapped.maxTurns !== undefined ? { maxTurns: mapped.maxTurns } : {}),
        ...(mapped.model !== undefined ? { model: mapped.model } : {}),
        roleDefinition: mapped.roleDefinition,
        ...(mapped.tools !== undefined ? { allowedTools: mapped.tools } : {}),
        ...(mapped.disallowedTools !== undefined ? { disallowedTools: mapped.disallowedTools } : {}),
        warnings: mapped.warnings,
      };
    }
    return { error: "未知角色: " + role + "（内置 implement|review|test，或 plugin-name:agent-name / user:agent-name 形态）" };
  }

  /** worker 终态后解析依赖链：done → 唤醒等待的后环；failed/cancelled → 后环标记 dependency_failed（不静默跳过）。 */
  resolveDependents(agentId: string, status: "done" | "failed" | "cancelled"): void {
    for (const [callId, d] of [...this.deps.deferredSpawns]) {
      if (!d.dependsOn.includes(agentId)) continue;
      if (status !== "done") {
        this.deps.deferredSpawns.delete(callId);
        void this.deps.opts.emit({
          type: "tool_result",
          callId,
          ok: false,
          hold: "dependency-failed",
          output: "[harness] 后环 spawn 标记 failed（reason=dependency_failed）：前环 " + agentId + " " + status,
        } as AgentEvent).catch(() => {});
        continue;
      }
      if (d.dependsOn.every((dep) => this.deps.workers.get(dep)?.terminalStatus === "done")) {
        this.deps.deferredSpawns.delete(callId);
        void this.triggerDeferredSpawn(d).catch(() => {});
      }
    }
  }

  private async triggerDeferredSpawn(d: { callId: string; args: SpawnArgs; dependsOn: string[] }): Promise<void> {
    if (this.deps.signal.aborted) {
      await this.deps.opts.emit({
        type: "tool_result",
        callId: d.callId,
        ok: false,
        hold: "cancelled",
        output: "[harness] 后环 spawn 撤销（主会话已取消）",
      } as AgentEvent).catch(() => {});
      return;
    }
    const r = await this.deps.spawn(d.args, { callId: d.callId });
    if (!r.ok) {
      // 原因改读**结构列**。从前这一行是对 `r.output` 做 `includes("并发")`／`includes("[budget]")` 的散文嗅探：
      // 生产端拿自己的文案当判据，文案一改判读就静默换档（而「主会话已取消」那条嗅不出任何因，
      // 会被兜底成 dependency_failed——一个从来没被任何用例钉过的错格）。
      // 现在 `reason=` 记号由 `hold` 经 `HARNESS_HOLD_PROSE_TOKEN` 派生 ⇒ 结构面与散文面只有一个决策点。
      // 缺列时仍写从前那句兜底（`spawn()` 的参数校验类拒绝本就不是按住），但这一格从此是可数的：
      // 新增一条按住却不盖 `hold` 的出口，判卷面那条「五挡各有行为证人」会少一格而红。
      const reason = r.hold === undefined ? "dependency_failed" : HARNESS_HOLD_PROSE_TOKEN[r.hold];
      await this.deps.opts.emit({
        type: "tool_result",
        callId: d.callId,
        ok: false,
        ...(r.hold === undefined ? {} : { hold: r.hold }),
        output: "[harness] 后环 spawn 失败（reason=" + reason + "）：" + r.output,
      } as AgentEvent).catch(() => {});
    }
  }

  /** 等待指定 agent 终态（sequencer 逐环同步；finishInner 解析）。终态值已备好则立即返回。
   *  判据是 terminalResolved 而非 finished：finishInner 开头就置 finished=true，但 done 分支还要
   *  await git diff + 安全流水才挂 lastResult——落在窗口里读 finished 会返回「done + result 空」，
   *  sequencer 据此把绿证据环判成失败环（实测：级联因此白烧一档再误报整链 failed）。 */
  private waitForAgentTerminal(agentId: string): Promise<{ status: string; result: Extract<AgentEvent, { type: "agent_result" }> | null }> {
    const w = this.deps.workers.get(agentId);
    if (w && w.terminalResolved) {
      return Promise.resolve({ status: w.terminalStatus ?? "done", result: w.lastResult ?? null });
    }
    return new Promise((resolve) => {
      const list = this.terminalWaiters.get(agentId) ?? [];
      list.push(resolve);
      this.terminalWaiters.set(agentId, list);
    });
  }

  resolveTerminalWaiters(agentId: string, status: "done" | "failed" | "cancelled", result: Extract<AgentEvent, { type: "agent_result" }> | null): void {
    const list = this.terminalWaiters.get(agentId);
    if (!list) return;
    this.terminalWaiters.delete(agentId);
    for (const fn of list) fn({ status, result });
  }

  /** W1a 收队：等一批 worker 到终态。**不新增事件类型**——父模型看到的就是一条普通 tool_result。
   *  复用 sequencer 的同步点（`waitForAgentTerminal` 终态值备好即立即返回），因此对已收敛的 worker
   *  重复调用等价于「读一次快照」，这是 `wait_for_agents` 的取回通道能成立的前提。
   *  算不算「已收敛」看 terminalResolved 而非 finished：finished 在 finishInner 开头就真，
   *  之后还要 await git diff / 安全流水才挂 lastResult——窗口里报「done + 空报告」是把不可知记成已知。
   *  边界三条都是实测教训：
   *  ① 未知 id 必须先摘——`waitForAgentTerminal` 对不存在的 id 会把 resolve 推进等待表且永不触发；
   *  ② 超时不算失败（本仓对"等人门"的统一口径）：已收敛的照给，未收敛的点名进 timedOut；
   *  ③ abort 只结束这次等待，**不动任何 worker**——取消 worker 是 cancelAgent/cancelAll 的职责，
   *    收队方无权替用户决定杀谁（权限 ≤ 父会话的同一族理由）。 */
  async waitForAgents(ids: readonly string[], timeoutMs: number, signal?: AbortSignal): Promise<JoinPayloadBody> {
    const targets = ids.length > 0 ? [...ids] : this.deps.workerIds();
    if (targets.length === 0) return { rows: [], degraded: [], timedOut: [], cancelled: false };
    const known = targets.filter((id) => this.deps.workers.has(id));
    const unknown = targets.filter((id) => !this.deps.workers.has(id));
    const snapshot = (want: string[]): JoinInput[] => want.map((id) => {
      const w = this.deps.workers.get(id);
      if (!w) {
        return { agentId: id, status: "unknown" as const, task: "", report: "未派生过该 agent_id（问错了名字）", usage: { inputTokens: 0, outputTokens: 0 }, spent: null };
      }
      const status = !w.terminalResolved
        ? "running" as const
        : w.terminalStatus === "failed" ? "failed" as const
          : w.terminalStatus === "cancelled" ? "cancelled" as const
            : "done" as const;
      return { agentId: id, status, task: w.task, report: w.lastResult?.summary ?? "", usage: { ...w.usage }, spent: spentUsdFor(w.price, w.usage) };
    });

    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    const racers: Promise<"done" | "timeout" | "cancelled">[] = [
      Promise.all(known.map((id) => this.waitForAgentTerminal(id))).then(() => "done" as const),
      new Promise<"timeout">((resolve) => { timer = setTimeout(() => resolve("timeout"), timeoutMs); timer.unref?.(); }),
    ];
    if (signal) {
      racers.push(new Promise<"cancelled">((resolve) => {
        onAbort = () => resolve("cancelled");
        signal.addEventListener("abort", onAbort, { once: true });
      }));
    }
    const outcome = await Promise.race(racers);
    if (timer !== undefined) clearTimeout(timer);
    if (onAbort !== undefined && signal !== undefined) signal.removeEventListener("abort", onAbort);

    const settled = known.filter((id) => this.deps.workers.get(id)?.terminalResolved === true);
    const unsettled = known.filter((id) => !settled.includes(id));
    const shaped = shapeJoinRows([...snapshot(settled), ...snapshot(unsettled), ...snapshot(unknown)]);
    return {
      rows: shaped.rows,
      degraded: shaped.degraded,
      timedOut: outcome === "timeout" ? unsettled : [],
      cancelled: outcome === "cancelled",
    };
  }

  /** worker 审批请求（§4.4.3：请求落流 + 等待订阅 approval_resolved by id，不挂任何进行中的 turn）。
   *  编排器内部 API：模块内 gatedWorkerTool 使用，不进生产外部面。 */
  async requestWorkerApproval(
    w: WorkerHandle,
    tool: string,
    args: Record<string, unknown>,
    risk: RiskLevel,
    riskReasons: string[],
  ): Promise<{ approved: boolean; scope: AskScope; note?: string }> {
    const id = this.nextApprovalId(w.agentId);
    // 先登记等待、再 emit 请求（waitForApproval 内部同步登记；坑十六）
    const outcomePromise = this.waitForApproval(id, w.agentId);
    await this.deps.opts.emit({
      type: "approval_requested",
      id,
      agent_id: w.agentId,
      tool,
      args_digest: digestArgs(args),
      risk,
      ...(riskReasons.length > 0 ? { risk_reasons: riskReasons } : {}),
      ...(w.tierWarning ? { tier_warning: w.tierWarning } : {}),
    } as AgentEvent);
    await this.deps.opts.emit({ type: "agent_status", agent_id: w.agentId, status: "waiting_approval" } as AgentEvent);
    const outcome = await outcomePromise;
    await this.deps.opts.emit({
      type: "approval_resolved",
      id,
      agent_id: w.agentId,
      decision: outcome.approved ? "approved" : "rejected",
      scope: outcome.approved ? outcome.scope : "once",
      ...(outcome.note ? { reason: outcome.note } : {}),
    } as AgentEvent);
    if (outcome.approved) {
      await this.deps.opts.emit({ type: "agent_status", agent_id: w.agentId, status: "running" } as AgentEvent);
    }
    return outcome;
  }
}
