import type { AgentEvent, AgentPermissionMode, SecurityFinding } from "../events";
import type { AutonomySession, PermissionRule } from "../permissions";
import type { ArmKey } from "../routing/bandit";
import type { CompactionConfig, Summarizer } from "./compaction";
import type { FrozenStage, PluginAgentRoleDef } from "./sequencer";
import type { StuckConfig, StuckTurn } from "./stuck";
import type { VerifyHook } from "./verify";
import type { HookEngine } from "./plugins/hooks";
import type { WorkerModel } from "./worker-model";
import type { WorkerPrice } from "./orchestrator-join";

export interface SpawnArgs {
  task?: unknown;
  mode?: unknown;
  resources?: unknown;
  context?: unknown;
  stages?: unknown;
  depends_on?: unknown;
  model?: unknown;
  max_turns?: unknown;
  tier?: unknown;
  /** M5c supervise：{ maxStages?, forbidden? }（受限循环参数；goal=task，budget=会话成本闸）。 */
  supervise?: unknown;
}

/** pipeline stage 的原始形态（M3c；sequencer 解析冻结）。 */
export interface RawStageArgs {
  role?: unknown;
  task?: unknown;
  gate?: unknown;
}

/** sequencer 解析出的 stage 运行参数（代码注入 spawnStage；模型不可伪造角色面）。 */
export interface StageRoleResolution {
  mode: "read" | "write";
  roleDefinition?: string;
  maxTurns?: number;
  model?: string;
  /** M5b：环角色名（implement/review/test/plugin:agent-name）——routing_decision.stage 与路由选档的来源。 */
  role?: string;
  /** 插件角色工具面裁剪（frontmatter.tools）。 */
  allowedTools?: string[];
  disallowedTools?: string[];
  warnings?: string[];
}

export interface WorkerContext {
  files?: string[];
  decisions?: string[];
  constraints?: string[];
}

export interface WorkerHandle {
  agentId: string;
  spawnCallId: string;
  mode: "read" | "write";
  task: string;
  context: WorkerContext;
  maxTurns: number;
  tier: AgentPermissionMode;
  tierWarning?: string;
  model?: WorkerModel;
  /** 路由选中模型的真实上下文窗口（registry ctxWindow）。只有路由分支拿得到 spec 时才有值；
   *  注入模型（modelFor）与未开路由时缺省 ⇒ worker 预算退回硬编码基线（旧行为逐字不变）。 */
  modelCtxWindow?: number;
  /** W3② 价格标签：本 worker 真实会用的模型名 + 反查到的档位 id（反查不到只有名字）。
   *  `null` = 冻结剧本回放（`scriptedWorkerModel`），它不拨号也不付钱 ⇒ 钱的话一律不说，
   *  而不是报 $0（把不可知记成免费是本仓点名的假绿形状）。 */
  price?: WorkerPrice | null;
  controller: AbortController;
  autonomy: AutonomySession;
  /** M3b write mode：文件面/shell 面的自主会话（worktree 完全可写 §4.4.5 → auto；critical 仍强制审批；
   *  记忆面（主 checkout 共享区）仍用 autonomy（clampTier 档位）——两套会话各管各的可写面。 */
  toolAutonomy: AutonomySession;
  /** M3b write mode：写租约声明（spawn.resources 原样）。 */
  resources: string[];
  /** M3b write mode：worktree 主 checkout 根相对路径 + 分支名 + spawn 时 HEAD。 */
  worktree?: string;
  branch?: string;
  baseCommit?: string;
  /** M3b：edit_file 写前快照（内存态 per worker，不落盘第二事实源——只服务 findings 绝对行号换算，
   *  随 worker 生命周期释放；M2f 裁决 6 移交项）。键 = path，值 = 改前全文。 */
  snapshots: Map<string, string>;
  /** 写前快照导出的编辑锚点（old_string 首字符在改前文件的 1-based 行号，按编辑序）。 */
  editAnchors: Map<string, number[]>;
  /** M3b：worker diff 静态快筛结果缓存（gate 二次确认判定用）。 */
  lastFindings: SecurityFinding[];
  /** worker 自身事件（内存态，上下文组装源；与主流 JSONL 解耦——重放主流后投影一致）。 */
  events: AgentEvent[];
  usage: { inputTokens: number; outputTokens: number };
  toolStats: Record<string, number>;
  finished: boolean;
  /** M3b：终态事件（agent_result/diff/清理）全部落完才算 closed——write worker 的 finish 含
   *  git diff + 安全流水（秒级），activeCount/waitAll 必须等 closed，否则进程会在 finish 中途退出。 */
  closed: boolean;
  // ---- M3c：依赖链 / 卡死检测（内存态运行参数；状态事实源仍是事件流投影） ----
  /** 本 worker 依赖的前环 agent_id（depends_on 原样；后环 agent_spawned 已记录）。 */
  dependsOn: string[];
  /** 卡死态（waiting_input(reason=stuck) 在场）：触发后 worker 在下一事件 append 处暂停，resume 解除。 */
  stuckActive: boolean;
  /** M5b 步骤 9：bandit 选中的臂（仅 reason=bandit 的 worker 有值——回灌奖励用）。 */
  routeArm?: ArmKey;
  /** bandit 臂对应的模型 id（真钱代价折算用，pricing.costUsd）。 */
  routeModelId?: string;
  paused: boolean;
  pauseWaiters: (() => void)[];
  /** 卡死规则一/二的滑动窗口（action+observation 摘要）。 */
  stuckTurns: StuckTurn[];
  /** tool_call id → action 摘要（tool_result 到达时配对成 StuckTurn）。 */
  stuckCallActions: Map<string, string>;
  /** 静默计时器（每次子流事件刷新；silenceMs 超时 → stuck）。 */
  stuckTimer: ReturnType<typeof setTimeout> | null;
  lastActivityAt: number;
  /** B7（审查）：root abort 监听器引用——终态摘除用（once 监听不触发即永久驻留）。 */
  onRootAbort?: () => void;
  /** 角色定义（M3c：内置角色/插件角色进 system 首块；缺省无）。 */
  roleDefinition?: string;
  /** §9.5 Subagent* 的 matcher 字段 = agent 类型。值就是 spawn 时解析出的那个角色名——
   *  事件流里它叫 `stage`（routing_decision），钩子契约里它叫 `agent_type`（§9.5 表），同一个串两个名字，
   *  这里按契约侧命名。模型自己 spawn 的无名 worker ⇒ 缺省 ⇒ stdin JSON 整键不出现
   *  （拿空串伪造一个"类型"是伪造输入，比缺席更坏）。 */
  agentType?: string;
  /** §9.10：本次 runWorker 拿到的钩子视图（`workerHooks(mode)` 的产物）。
   *  Pre/PostToolUse 经 runLoop 用它，SubagentStart/SubagentStop 经 finish 用它——
   *  两条路必须同一个视图，否则同一个钩子在一边降过档、另一边没降。 */
  hooks?: HookEngine | null;
  /** M3c 插件角色工具面裁剪（frontmatter.tools 白名单；缺省 = 角色默认面）。 */
  allowedTools?: string[];
  /** M3c 插件角色 disallowedTools（从默认面剔除）。 */
  disallowedTools?: string[];
  /** 终态标记（finishInner 写入；依赖链终态裁决与 sequencer 同步点复用）。 */
  terminalStatus?: "done" | "failed" | "cancelled";
  lastResult?: Extract<AgentEvent, { type: "agent_result" }>;
}

// ---- M3c pipeline 链状态（sequencer 只读呈现；stages 批准后冻结） ----

export interface PipelineChainStageState {
  index: number;
  role: string;
  task: string;
  agentId: string | null;
  status: "pending" | "running" | "done" | "failed";
  verdict?: "pass" | "fail" | "unspecified";
  reportPreview?: string;
}

export interface PipelineChain {
  /** 链 id = spawn 的 callId（整链一个审批；sequencer 状态只读呈现的锚点）。 */
  callId: string;
  /** 批准后冻结的 stages（parseStages 产物，Object.freeze）。 */
  stages: readonly FrozenStage[];
  /** 批准时冻结的角色解析产物（与 stages 同刻冻结：主 run 结束清空插件运行时后，
   *  后环 spawn 仍按批准时的角色面运行——插件角色/工具面/模型不随运行时生命周期漂移）。 */
  resolutions: readonly StageRoleResolution[];
  state: PipelineChainStageState[];
  status: "running" | "done" | "failed";
  reason?: string;
}

export interface OrchestratorOptions {
  /** 主会话 JSONL 路径（worker 子流落流目标）。 */
  logPath: string;
  workspace: string;
  /** 父会话权限档（单调继承基准）。 */
  parentMode: AgentPermissionMode;
  /** 主流事件管线（落盘 + onEvent 推送同路，M1b 坑十八口径）。 */
  emit: (e: AgentEvent) => Promise<void>;
  /** B1 语义合并闸：把「声明要写这批 glob」换算成「实际会波及哪些文件」（仓库相对路径）。
   *  缺省 undefined = 零行为（只有既有 glob 租约求交，spawn 流程与事件字节完全不变）。
   *  抛错 = 记 warn 并降级为「仅 glob 判定」——语义闸是额外探测器，不得把 spawn 炸掉。 */
  semanticLease?: (resources: string[]) => Promise<string[]>;
  /** worker 模型解析（演示/验收通道注入脚本模型）；缺省 = GLM 暗卷（需 M0_API_KEY）。 */
  modelFor?: (args: SpawnArgs) => WorkerModel | undefined;
  /** A1 写侧 prompt 缓存断点（路由分支合成的真实 provider 模型才吃）。
   *  目前只有 Anthropic 有语义（显式 cache_control 打在静态段：末个 tool + system 首块）；
   *  GLM/OpenAI 是自动前缀缓存、Gemini 需另建 cachedContent 资源 ⇒ 传了也是零行为。
   *  缺省 false = 请求体逐字不变。 */
  promptCache?: boolean;
  /** M7 影响面读端（与主会话 `settings.impactAnalysis` 同源开关）：开启时 worker 的工具面
   *  追加 `impact_query`（只读，查「谁在调用它」）。缺省 false = 规格面/执行面/白名单三处都不出现。
   *  刻意只接**读端**：写侧 per-edit 钩子要在每个 worker 的 worktree 冷启动重建整图，
   *  代价随 worker 数线性放大，而波及面真正有意义是在合并回主树那一刻。 */
  impactAnalysis?: boolean;
  /** M5b 模型路由（§m5-proposal 步骤 8）：启用时每次 spawn routeFor 决策 → 落 routing_decision →
   *  toWorkerModel(档位)。缺省 false = 零行为（modelFor / defaultWorkerModel 原路径逐字不变，零 routing_decision）。 */
  routing?: boolean;
  /** M5b 步骤 9：bandit 学习状态文件（routingBandit 开关开启；要求 routing=true——
   *  无路由则无档位决策可学）。状态在 .agent/ 系统区（同 permissions.json 口径）。
   *  学习是侧信道：回灌/持久化失败只记日志，不阻断 worker 终态流。 */
  banditStatePath?: string;
  /** worker 审批无响应超时（缺省 120s，超时按拒绝 fail-closed）。 */
  approvalTimeoutMs?: number;
  /** M5c 竞速收敛超时（缺省 120s；测试注入短值以验「超时必收杀候选」，不放宽生产语义）。 */
  raceDeadlineMs?: number;
  /** M3b 产出代码安全模式（§11.6 三档，缺省 report）：off 不跑 / report 只标 / gate critical|high 红标 + 二次确认。 */
  safeMode?: "off" | "report" | "gate";
  // ---- M3c ----
  /** 插件 agent 角色解析（stages[].role = "plugin:agent-name" → agents/*.md 定义；§9.6/§9.11-4）。
   *  缺省 null 解析失败 = 该环拒绝（fail-visible）。 */
  agentRoleFor?: (invoke: string) => PluginAgentRoleDef | null;
  /** worker 压缩摘要器（§7.5：与主会话同一 runCompaction 实现链；缺省 undefined = 只走 overflow 截断）。 */
  workerSummarizer?: Summarizer;
  /** worker 压缩参数覆盖（缺省 WORKER_COMPACTION_CONFIG；验收注入小 inputLimit 触发）。 */
  workerCompaction?: Partial<CompactionConfig>;
  /** 会话级成本闸（§4.4.8 maxBudgetUsd）：maxUsd/pricePerMTok 任一 ≤0 = 闸无效（缺省零行为）。 */
  budget?: { maxUsd: number; pricePerMTok: number };
  /** 卡死检测阈值（缺省 ORCHESTRATOR_STUCK_CONFIG；验收注入短阈值）。 */
  stuckConfig?: Partial<StuckConfig>;
  /** P0-2（审查）：父 run 已加载的权限规则库——worker 自主会话必须同口径构造，
   *  否则项目级 deny/ask 规则对 worker 全表失效（deny read_file 主会话拒、worker 放行）。 */
  rules?: PermissionRule[];
  /** P0-2（审查）：父 run 的沙箱自检结果（null = 未接线）——worker 沙箱降级送审通道同口径。 */
  sandboxAvailable?: boolean | null;
  /** W4a（spec §6:95）：write worker 的收束闸钩子工厂（入参 = 该 worker 的 worktree 目录）。
   *  **缺省 undefined = 零行为**（worker 的 runLoop 既不接 verify 也不补拍——今日现状）。
   *  开闸代价与读数见 outputs/auto-verify-readout-2026-09-20.md §2：单次实测百毫秒级起，
   *  随目标仓库套件时长线性放大（大仓一次 = 一次全量套件），且**零额外模型请求**。
   *  ⚠️ 前置已闭合：loop 的 allowedTools 硬闸现在排在 verify 系统门之前（锚点
   *  `verify-bypasses-tool-table`），故 worker 即使接了钩子也无法自调 verify（工具表里没有它），
   *  只有 harness 的自动拍会跑——这正是「给 worker 的是 autoVerify 证据拍，不是 manual verify 门」。
   *  它产出的证据由 W4b 的 `agent_result.artifacts.verified` 如实标注（含 stale/absent）。 */
  workerVerify?: (repoDir: string) => VerifyHook;
  /** §9.10「worker 继承主会话插件启用集」：worker 的 runLoop 拿同一个钩子引擎跑
   *  PreToolUse / PostToolUse / PostToolUseFailure。
   *  **缺省 undefined = 零行为**——那正是此前的状态：worker 有 write_file / edit_file / 可写 shell，
   *  而用户装的拦截钩子只挡得住主会话（与「表里没有 verify 却能执行 verify」同形状：门装了不锁）。
   *  工厂入参 = worker 档；视图的权限降档（read worker → 只读档）由 HookEngine.forWorkerMode 定，
   *  不在调用方各抄一份。零 hook 会话仍是一次字典查找后早退。 */
  workerHooks?: (mode: "read" | "write") => HookEngine | null;
}
