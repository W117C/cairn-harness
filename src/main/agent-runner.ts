// main 进程的 agent 接线：IPC "agent:run" 暴露的同一入口（handleAgentRun），不经 UI 也可直调（ipc:check）。
// 工具门：冻结的 runLoop 对 ask 一律拒绝（gate 非 allow 即 deny），因此 loop 固定走 auto 档，
// 真实门在本模块的工具包装里 —— 复用 src/permissions 的 checkPermission，语义与 M0 一致：
// read-only 拒副作用 / default 询问（UI 批准才执行）/ auto 放行；沙箱不可用时写工具强制逐条审批。
import { readFileSync, existsSync } from "node:fs";
import { rm, readdir, mkdir, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { AsyncLocalStorage } from "node:async_hooks";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runLoop } from "../agent/loop";
import { runCompaction } from "../agent/compaction";
import { buildMap } from "../agent/map/build";
import { computePrune } from "../agent/prune";
import {
  createGlmSessionProvider,
  createGlmSummarizer,
  gateToolSpecs,
  type SessionPluginTool,
  type SessionTransport,
} from "../agent/glm-session";
import { ClarifyGate, PlanGate } from "../agent/gates";
// M10 拆分：系统提示词面搬去 `src/agent/system-prompt.ts`。**这里既是本地消费、也再导出**——
// `export … from` 只对外可见、**不进本地作用域**（本次实测踩到：改完立刻 `Cannot find name 'BASE_SYSTEM'`，
// 而本文件下面还有两处在用）。所以写成"先 import 再 export"，两条都在。
import { BASE_SYSTEM, systemPromptFor } from "../agent/system-prompt";
import { classifyVerifyFailure, createVerifyHook, defaultExec, withVerifyCauseNote, type ExecFn } from "../agent/verify";
import { createActionFusion } from "../agent/action-fusion";
import { SolpiRuntime, privateSessionDirectory, removePrivateSessionData, observationRecallSpec, solpiEnabled, type SolpiFlags } from "../agent/solpi-runtime";
import { createUsageAttributor } from "../agent/usage-attribution";
import { affectedFilesOf, defaultImpactHook } from "../agent/impact/index.js";
import { createImpactQueryTool, impactQuerySpec } from "../tools/impact-query";
import { createDiagnoseTool, diagnoseSpec, diagnoseSurface } from "../tools/diagnose";
import { createWaitForAgentsTool } from "../tools/wait_for_agents";
import { createCancelAgentsTool } from "../tools/cancel_agents";
import { createRefineGoalTool } from "../tools/refine_goal";
import { webFetch } from "../tools/web_fetch";
import { loadSearchConfig, makeWebSearch, webSearchSpec } from "../tools/web-search";
import { run_shell } from "../tools/run_shell";
import type { AgentEvent, ClarifyAnswerMap, EventLog, GoalTurnOrigin } from "../events";
import { frozenJudgePathSet } from "../frozen";
import { createEventLog, replay } from "../events";
// goal 模式：判据与投影全在纯函数面（src/agent/goal.ts），这里只做「读事件流 → 问它 → 落流 → 起下一轮」。
import { GOAL_TURN_CAP_MAX, goalReminder, goalStopDecision, goalWindowSpend, parseGoalSpec, projectGoal, type GoalView } from "../agent/goal";
// 目标漂移读数（能力 4「长任务不遗忘」的真读数）：判据全在 src/agent/goal-drift.ts 那个纯模块里，
// 这里只做「读事件流 → 问它 → 印一行」。**不新增事件类型**——沿用本仓既有先例
// （goal 的两态就是靠 user_message.origin 承载的），新增一种事件会让重放契约多一个分支。
import { assistantTurnsFromEvents, goalDriftCell, goalDriftFindings } from "../agent/goal-drift";
// cost-per-progress 读数（M10 防降智横切）：此前 `cost-per-progress.ts` 全树零生产消费者，
// 只有单测在用——「每前进一份花多少钱」从没变成生产路径上的一个可见读数。这里接进会话收束点，
// 与 goal-drift 同口径：只印一行，不落事件流（落流要新增事件类型，破坏重放契约）。
import { costPerProgress } from "../agent/cost-per-progress";
// 自进化闭环：会话收束时从同一份事件流抽信号 → 翻成策略补丁 → 落 .agent/evolution.json；
// 下一轮装配时读回并注进 system prompt（让「上一轮的经验」真正回流到下一轮的决策，而不是只记笔记）。
import { runEvolution, evolutionPromptNote } from "../agent/evolution";
// 落流前的文本扫描表（`goal_stopped.reason` 已在表上）：异常原文是外部文本，而这条写入点不经
// loop 那份 redactEventForLog，扫它就得取这张现成的表，不在这里再抄一遍「哪个字段该擦」。
import { scanStreamEvent } from "../agent/worker-projection";
import { checkPermission, enterPlanRunScope, getPlanState, planGateBlocks, seedPendingPlanFromEvents, sideEffectDecisionTable, type PermissionMode } from "../permissions";
import {
  evaluate,
  isNetworkCommandCall,
  loadPermissionRules,
  newAutonomySession,
  type AskScope,
} from "../permissions";
import { globalPermissionsPath } from "../permissions/rules";
import { type ProviderKind } from "./settings";
import { setRunWorkspace } from "./runner-workspace";
import { createSession, pathOf, sessionExists, type SessionInfo } from "./sessions";
import { createMockProvider } from "../providers/mock";
import type { GlmToolSpec } from "../providers/glm";
import { toWorkerModel, type RegistryWorkerModel } from "../providers/registry";
import { validateThinkingEffort, type ThinkingEffort } from "../providers/capabilities";
import type { ModelOutput, Provider, ProviderToolSpec } from "../providers";
import { validateRunRequestEnvelope } from "./run-request";
import {
  MODEL_SHELL_TEST_ALIASES,
  mapSandboxTestCommand,
  mapSandboxTestCommandForWorkspace,
  SANDBOX_TEST_ALIASES,
  workspaceDeclaresVitest,
} from "./sandbox-test-command";
export {
  MODEL_SHELL_TEST_ALIASES,
  mapSandboxTestCommand,
  mapSandboxTestCommandForWorkspace,
  SANDBOX_TEST_ALIASES,
  workspaceDeclaresVitest,
};
import { formatAttachmentContext, validateRunAttachments, type ValidatedRunAttachment } from "./run-attachments";
import {
  assertProviderKeyConfigured,
  providerKindFromEnv,
  resolveMainModel,
  type MainModelSelection,
} from "./provider-runtime";
import { selectionProviderId } from "./provider-runtime";
import { TOOLS, type Tool, type ToolResult } from "../tools";
import { remember } from "../tools/remember";
import type { ToolName } from "../tools/base";
import { initMemoryHome, type TopicEntry } from "../agent/memory/store";
import { runSessionEndDistill } from "../agent/memory/distill";
export { initMemoryHome } from "../agent/memory/store"; // shell 启动时注入 userData/memory
import { AskGate } from "./ask-gate";
import type { AskOutcomePayload, AskPayload, RunRequest } from "./ipc-protocol";
import { checkSandbox, networkProfileFor, runInSandbox, type SandboxStatus } from "./sandbox";
import { resolveRoutingFlags, type RoutingFlagOverrides } from "./routing-flags";
import { PluginRuntime, trustFilePathOf, setCurrentPluginRuntime, currentPluginRuntime, expandPromptCommand, expandSkillInvocation, commandInvokeName, skillInvokeName } from "../agent/plugins";
// `TrustStore` 从**实现文件**取，不从 `../agent/plugins` 取：那边是 `export { … } from "./trust"`
// 的再导出（只对外可见、不进本地作用域，本文件上面 BASE_SYSTEM 那次搬迁踩过同一个坑）。
import { TrustStore } from "../agent/plugins/trust";
import { createVerifyTrustGate } from "./verify-trust-gate";
import type { VerifyTrustResolver } from "../agent/verify-trust";
import type { ScheduleSnapshot } from "./scheduler";
import { validateAutomation, isUnattendedTier } from "./automations";
import {
  Orchestrator,
  orchestratorForAgent,
  orchestratorForApproval,
  orchestratorForMerge,
  loadWorkerScript,
  scriptedWorkerModel,
  type OrchestratorOptions,
  type SpawnArgs,
  type WorkerModel,
} from "../agent/orchestrator";
import { recoveryParentMode, type RespawnArgs } from "../agent/recovery";
import {
  cleanOrphanWorktree,
  type WorktreeCleanupResult,
} from "../agent/worktree";
// ---- 拆分面（同 provider-key-inject 先例：实现搬去轻模块，本装配根按原路径继续导出）----
// settings/BYOK/license/更新面 → ./settings-handlers；会话列表与崩溃恢复 → ./session-handlers；
// 记忆快照与删除 → ./memory-handlers；「最近一次 run 的工作区」单一事实源 → ./runner-workspace。
import { setSettingsHostDeps, store } from "./settings-handlers";
import { getSessionsDir, requireSessionsDir } from "./session-handlers";
import {
  automationsScheduled, handleScheduleSnapshot, initScheduler, installAutomationTools,
  scheduleDataDir, schedulerEverStarted, setSchedulerRuntimeDeps, startScheduler, stopScheduler, updateScheduleCap,
} from "./scheduler-runtime";
import {
  emitGoalEvent, emitGoalStoppedOnThrow, goalNextTurn, setGoalHandlerDeps,
} from "./goal-handlers";
import {
  handleSidechatAsk, handleSidechatCreate, handleSidechatPromote, handleSidechatState, runSidechatDemo,
  setSidechatHandlerDeps,
} from "./sidechat-handlers";
import { compactSessionLog, firePreCompactHook, resolveSafeMode, runSecurityReportHook } from "./compact-and-report";
import { currentWorkspace, pluginRuntimeOpts, setPluginSnapshot, setStateHandlerDeps } from "./state-handlers";
import {
  denied, gatedTool, installPluginTools, pluginToolSpecsFromRuntime, sessionToolFace, setToolGateDeps,
} from "./tool-gates";
import {
  handleAgentDecide, handleCardAction, handleClarifySubmit, handlePlanDecide, handleRunCancel,
  setCardActionDeps,
} from "./card-action-handlers";

// settings 面不反向依赖本模块（避免装配根 ↔ 轻模块成环）：它需要本模块的两处按回调注入。
setSettingsHostDeps({
  resolveProviderKind: () => resolveProviderKind(),
  onScheduleCapChange: (cap) => updateScheduleCap(cap),
});

// M4a 调度器接线同理（实现住 ./scheduler-runtime）：它需要本模块的四处活状态，按回调注入。
// 一律传闭包而不是现值：`WORKSPACE` / `hooks` 都在本调用之后才声明，且会话与钩子要活读。
setSchedulerRuntimeDeps({
  defaultWorkspace: () => WORKSPACE,
  onEvent: (e) => hooks.onEvent?.(e),
  runSession: (workspace, args) =>
    handleAgentRun({ message: args.message, mode: args.mode }, { sessionId: args.sessionId, workspace, unattended: true, signal: args.signal }),
  currentSession: () => currentSession(),
});

// goal 面同理（实现住 ./goal-handlers）：事件推送与价键派生按回调注入，其余依赖它自己 import。
setGoalHandlerDeps({
  onEvent: (e) => hooks.onEvent?.(e),
  budgetPriceKeyOf: (selection) => budgetPriceKeyOf(selection),
});

// sidechat 面同理（实现住 ./sidechat-handlers）：事件推送 / 最近 run 日志 / 当前工作区三处活状态注入。
setSidechatHandlerDeps({
  onEvent: (e) => hooks.onEvent?.(e),
  lastLogPath: () => lastLogPath,
  currentWorkspace: () => currentWorkspace(),
});

// agent:state / 插件面板 / 工作区解析面同理（实现住 ./state-handlers）：装配根三处活状态注入。
setStateHandlerDeps({
  defaultWorkspace: () => WORKSPACE,
  sandboxState: () => sandboxState,
  lastLogPath: () => lastLogPath,
});

// 工具门同理（实现住 ./tool-gates）：只需要「当前会话」这一处活状态。
setToolGateDeps({ currentSession: () => currentSession() });

// 交互决议面同理（实现住 ./card-action-handlers）：三门 / 会话 emit / 编排器两路 / 取消信号注入。
setCardActionDeps({
  appAskGate: () => appAskGate,
  appClarifyGate: () => appClarifyGate,
  appPlanGate: () => appPlanGate,
  session: () => session,
  activeOrchestrator: () => activeOrchestrator,
  ensureSessionOrchestrator: () => ensureSessionOrchestrator(),
  interactiveRunAbort: () => interactiveRunAbort,
});

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WORKSPACE = join(ROOT, "fixtures", "todo-app");
const MOCK_FIXTURE = join(ROOT, "fixtures", "mock", "todo-fix.jsonl");
// M1b 三门演示通道：M1B_GATE_FLOW=1 时用 fixtures/gate/gate-flow.jsonl 驱动（clarify/plan 卡片真人交互）。
// env 门控缺省关闭，M0 事件流字节不变。
const GATE_FIXTURE = join(ROOT, "fixtures", "gate", "gate-flow.jsonl");
// M10 拆分：系统提示词面（`BASE_SYSTEM` / 按档取面）搬去 `src/agent/system-prompt.ts`
// ——那段是**零依赖的常量文本 + 一个纯函数**，却住在 2,771 行的本文件里，两道门为了取一段常量
// 得 import 整个 runner。**对外接口一行不变**：这里**再导出**（与 `gates.ts` 再导出 `assertion-health`
// 同一惯例），所以 `prompt-cost.ts` / `prompt-surface-check.ts` / 3 个判卷文件都无需改动。
// 搬迁是**逐字**的：8 条变异锚点钉在这份文本的字面量上，锚点的 `src:` 已同步改指新文件。
// （import 在文件头那一段；此处只补再导出——`export … from` 不进本地作用域，不能只写这一条。）
export { BASE_SYSTEM, systemPromptFor };
// M2g 任务 6：演示通道剧本外部化（fixtures/demo/**，带冻结 sha 于 scripts/frozen-demo-sha256.json；
// **独立**于判卷区 frozen-sha256.json）。缺省零行为不变；显式给路径的旧用法保留。
const DEMO_DIR = join(ROOT, "fixtures", "demo");
const LSP_DEMO_FIXTURE = join(DEMO_DIR, "lsp-demo.jsonl");
const SIDECHAT_DEMO_FIXTURE = join(DEMO_DIR, "sidechat-demo.jsonl");
interface Session {
  mode: PermissionMode;
  askGate: AskGate | null;
  sandbox: SandboxStatus | null;
  /** 当前会话事件管线（落盘 + onEvent 推送）：plan 决议等系统事件经它与 loop 事件同路（与 turn 解耦）。 */
  emit: ((e: AgentEvent) => Promise<void>) | null;
  /** M1c 自治等级会话状态：规则库 / scope 记忆 / 断路器（evaluate 的 session 入参）。 */
  autonomy: ReturnType<typeof newAutonomySession>;
  /** M1e：会话模式（sessionId 在场 = append 到既有会话，不 rm 日志；headless 脚本 = 旧行为）。 */
  sessionId?: string;
  actionFusion?: ReturnType<typeof createActionFusion>;
}
// 单窗口单任务：UI 串行发 run；ipc:check 亦串行。会话状态仅存活于一次 runAgent。
let session: Session | null = null;

// 三门通道（模块级，仿 appAskGate）：clarify 表单提交 / plan 批准决议
const appClarifyGate = new ClarifyGate();
const appPlanGate = new PlanGate();

// ---- M3a 编排内核（§4.4）：会话级编排器（worker 生命周期长于父 turn——审批解耦的前提）----
// activeOrchestrator 在 runAgent 收束后**不清空**：worker 的审批应答/取消路由须在父 turn 结束后
// 仍可达（§4.4.3 最大前车之鉴）；跨编排器路由走 orchestratorForAgent / orchestratorForApproval。
let activeOrchestrator: Orchestrator | null = null;

// P3（审查）：交互 run 取消入口——控制器挂模块面，IPC agent:run-cancel 触达；信号沿 runLoop
// 轮界/门等待/长驻工具透传（loop.ts）。unattended run 不经此通道（其取消归超时闸/门控）。
let interactiveRunAbort: AbortController | null = null;

// ---- H3（审查 D-2 立项落地）：RunScope —— run 级会话态随异步链传播 ----
// 旧实现 session/activeOrchestrator 是模块级单例，「后到 run 覆写在途 run」：并发的定时 unattended
// run 会（a）把交互 run 在途工具的审批路由抢到 unattendedAskGate（自动拒绝）、（b）结束时把
// session 置 null 使交互 run 的后续工具全部 fail-closed 假死。AsyncLocalStorage 让每个 runAgent
// 调用的整条异步链（loop await / 门等待 / 工具执行）都读到自己的 scope，工具闭包零签名改动。
// 交互面全局（session/activeOrchestrator）语义不变：只由交互 run 写入、UI decide/state 投影/
// 产后审批路由照旧；unattended run 不再触碰全局。已知边界（显式备案）：插件运行时（M2e 全局
// runtime + TOOLS 注入面）与 appClarify/appPlan 共享门仍是共享面——v1 隔离面 = D-2 验收所限定的
// 审批路由与权限态投影。
interface RunScope {
  session: Session;
  orchestrator: Orchestrator | null;
}
const runScopeALS = new AsyncLocalStorage<RunScope>();
/** 工具闭包取「当前 run」的会话态：run 内 = scope（并发隔离）；run 外遗留路径 = 交互面全局（行为不变）。 */
function currentSession(): Session | null {
  return runScopeALS.getStore()?.session ?? session;
}
/** 工具闭包取「当前 run」的编排器：语义同上。 */
function currentOrchestrator(): Orchestrator | null {
  return runScopeALS.getStore()?.orchestrator ?? activeOrchestrator;
}

/** run 起一次模型选择：把「env 覆盖 + 设置盘 + 逐请求指定」三输入喂给唯一那把纯函数 `resolveMainModel`。
 *  此前这段式子在两个入口各抄一份、闸的价键另抄第三份（只读设置盘字段），三份里最窄的那份决定了
 *  用户看到的「花了多少」⇒ 收成一处，拨号与折钱不可能再各说各话。 */
export function resolveRunModel(
  settings: { provider: ProviderKind; model: string },
  requestModel?: string,
): MainModelSelection {
  return resolveMainModel({
    forcedKind: providerKindFromEnv(process.env.M0A_PROVIDER),
    configuredKind: settings.provider,
    settingsModel: settings.model,
    legacyEnvModel: process.env.CAIRN_MODEL,
    ...(requestModel !== undefined ? { requestModel } : {}),
  });
}

/** 美元闸的价键 = **这一跳真拨的那个模型**，不是设置盘上那个字段。
 *  为什么（2026-09-27 实测，见 outputs/cost-price-key-2026-09-27/）：`settings.model` 出厂留空是
 *  文档化缺省（「留空 = 由 provider 层取缺省」），per-run 又能指定别的档位 ⇒ 读盘上字段会让闸
 *  ①在缺省配置下算不出价（整闸惰掉：用户买的保险没生效）、②按错档折（指定强档时只读到实付的
 *  1/4，指定便宜档时读到 10 倍 ⇒ 任务被假「预算耗尽」掐掉）。同一个 run 里「估多少」与「花多少」
 *  必须同一个数。demo 通道不拨号不付钱 ⇒ 空串 = 价不可知，由闸出声，绝不折成 $0。 */
export function budgetPriceKeyOf(selection: MainModelSelection): string {
  return selection.kind === "demo" ? "" : selection.spec.model;
}

/** 这一轮主会话走的是**预录剧本**吗？是 ⇒ 返回那份剧本的路径；否 ⇒ null。
 *  这五行 env 判定原先只活在 `createProvider` 里，而"这笔用量是不是真钱"要问的是同一件事
 *  ⇒ 抄第二份迟早漂（第十三族）。现在装配与归因都吃这一个式子。
 *  顺序即语义：越靠前的通道越优先（`M3A_MAIN_SCRIPT` 指的是显式文件路径，故要 resolve）。 */
export function scriptedMainModelPath(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.M3A_MAIN_SCRIPT) return resolve(env.M3A_MAIN_SCRIPT);
  if (env.M3A_AGENTS_DEMO === "1") return join(ROOT, "fixtures", "agents", "main-demo.jsonl");
  if (env.M1B_GATE_FLOW === "1") return GATE_FIXTURE;
  if (env.M1C_AUTONOMY_SCRIPT) return env.M1C_AUTONOMY_SCRIPT;
  if (env.M2A_LSP_DEMO) return env.M2A_LSP_DEMO === "1" ? LSP_DEMO_FIXTURE : env.M2A_LSP_DEMO;
  return null;
}

/** 这一轮主会话的 usage 归因键：真拨号 ⇒ 与美元闸同一个档位名；剧本 / demo ⇒ 空串（不可定价，由消费方出声）。
 *  单独成函数是因为**装配与归因必须答同一个问题**（`createProvider` 依它选传输通道，盖章器依它决定盖不盖）；
 *  抄第二份迟早漂（第十三族），且写成一行内联赋值就没有判卷能进到这个决策点里。 */
export function mainUsageModelOf(selection: MainModelSelection): string {
  return scriptedMainModelPath() === null ? budgetPriceKeyOf(selection) : "";
}

/** M3c 编排器扩展接线（agentRoleFor / workerSummarizer / budget）：runAgent 与会话重派共用同一口径。
 *  - agentRoleFor：插件 agent 角色解析（stages[].role = "plugin-name:agent-name"，§9.6/§9.11-4）；
 *  - workerSummarizer：worker 压缩摘要器（§7.5 同一 runCompaction 链；GLM 暗卷需 CAIRN_API_KEY）；
 *  - budget：会话成本闸（§4.4.8 maxBudgetUsd；0 = off 零行为）。
 *  第三参收成一张对象：S3 信任闸那两个面（调用方断言 + 生产问人）必须**一起**递到 worker 那条接缝，
 *  分成两个位置参数就会有人只递一个（本仓「同一谓词两份副本」那一族）。 */
async function orchestratorExtras(
  sandbox: SandboxStatus | null = null,
  runModel?: MainModelSelection,
  trust: { trustedRepo: boolean; verifyTrust: VerifyTrustResolver | null } = { trustedRepo: false, verifyTrust: null },
  over: RoutingFlagOverrides = {},
): Promise<
  Pick<OrchestratorOptions, "agentRoleFor" | "workerSummarizer" | "budget" | "routing" | "banditStatePath" | "promptCache" | "impactAnalysis" | "workerVerify" | "workerHooks">
> {
  const s = await store().get();
  // M5b 路由开关的取值面：runtime override（CLI `--bandit/--cascade` 一族）优先，缺席回落到 settings。
  // 合并只在 `resolveRoutingFlags` 一处（纯函数、可单测）——判卷喂它就是喂生产路径本身。
  const routing = resolveRoutingFlags(over, s);
  return {
    agentRoleFor: (invoke: string) => currentPluginRuntime()?.findAgentRole(invoke) ?? null,
    // §9.10「worker 继承主会话插件启用集」：worker 的工具调用过同一套钩子，视图按 worker 档降权限。
    // 闭包取 currentPluginRuntime()（本函数在装载前就被展开，装载完成后才真正被调）。
    workerHooks: (mode: "read" | "write") => currentPluginRuntime()?.hooks.forWorkerMode(mode) ?? null,
    ...(process.env.CAIRN_API_KEY ? { workerSummarizer: createGlmSummarizer() } : {}),
    // 会话成本底线（§4.4.8）：maxUsd = 0 ⇒ 整闸不接（缺省零行为）。单价留给价表兜底，
    // 所以这里必须把**当前真拨的那个模型**一起递下去——只递 maxUsd 会让闸在最常见配置下估不出价，
    // 而递设置盘字段会在「留空」与「per-run 指定档位」两种合法配置下和实付分叉（`budgetPriceKeyOf`）。
    ...(s.maxBudgetUsd > 0 ? { budget: { maxUsd: s.maxBudgetUsd, pricePerMTok: s.budgetPricePerMTok, priceModel: budgetPriceKeyOf(runModel ?? resolveRunModel(s)) } } : {}),
    // M7 影响面读端与主会话同一个设置位（worker 能在动手前问「谁在调用它」）。
    ...(s.impactAnalysis ? { impactAnalysis: true } : {}),
    // W4a：worker 的收束闸**复用同一个设置位**（`autoVerify`）——不新增开关、不改 UI 文案
    // （那行字面就是「写过盘但没自测时，收尾前补跑一遍检查」，worker 合并前正是这一刻）。
    // exec 走沙箱版：worker 的 verify 命令同样来自目标仓库的 .agent/config.json（外部输入）。
    // 缺省（设置关）= 整段不接线，worker 的 runLoop 与今日逐字同形。
    // S3 信任闸（2026-10-05 接线）：worker 拿的是**同一个 resolver**，但 resolver 的键第一维是
    // `repoDir`——write worker 跑在自己的 worktree 里（`orchestrator.ts:1853` 递的就是那个目录），
    // 于是父会话批过的那条批准**顶不掉 worker 的那一问**（谁的执行体谁被问）。
    // 本笔刻意**不**给 worker 加继承通道：仓里没有「worker 沿用父决议」的现成口径（worker 的审批走
    // 编排器的 approval_requested 事件面，不是 appAskGate），要接那条得另开一笔。
    ...(s.autoVerify
      ? {
          workerVerify: (repoDir: string) => createVerifyHook(repoDir, {
            exec: verifyExec(sandbox),
            trustedRepo: trust.trustedRepo,
            ...(trust.verifyTrust ? { trustResolver: trust.verifyTrust } : {}),
          }),
        }
      : {}),
    // M5b 步骤 9：routingBandit 开关同时开启路由与学习状态持久化（bandit 蕴含 routing——
    // 无路由则无档位决策可学）。状态文件在 .agent/ 系统区（同 permissions.json 口径）。
    // 值 = `over.routingBandit ?? s.routingBandit`（CLI 的 `--bandit/--no-bandit` 从这里翻；本键缺席即按 settings）。
    ...(routing.routingBandit
      ? { routing: true, banditStatePath: join(ROOT, ".agent", "routing-bandit.json") }
      : {}),
    // M5b 步骤 10（任务 #45）：级联蕴含 routing——阶梯起点取「路由当时落到哪一档」、升档靠 pin 换模型，
    // 没有路由这两件事都不存在（单开级联就会退化成花两遍钱跑同一个模型）。与 routingBandit 蕴含
    // routing 同形。缺省 false ⇒ 这一整段不接线，sequencer 每环照旧只跑一次。
    // 值 = `over.routingCascade ?? s.routingCascade`（CLI 的 `--cascade/--no-cascade` 从这里翻）。
    ...(routing.routingCascade ? { routing: true, cascadeUpgrade: true } : {}),
    // A1 写侧断点：只有路由合成真实 provider 档位时才落到 wire（当前唯一有语义的是 Anthropic）。
    // 缺省即开（用户裁决 2026-09-19），所以这里**不打 warn**——routingBandit 缺省关，
    // 一条 warn 会变成每次 run 都刷的噪声；「没路由 ⇒ 没断点」写进 settings 的字段注释里。
    ...(s.promptCache ? { promptCache: true } : {}),
  };
}

/** worker 的 shell 出口：沙箱可用时走 `runInSandbox`，不可用/未接线时落回裸执行。
 *
 *  口径与主会话 run_shell 那道门（:461）逐条对齐：那里是 `s.sandbox !== null && s.sandbox.available`
 *  才进沙箱，否则原样落回 `original.run`——worker 这边不做更严的判断，否则非 macOS 宿主上
 *  worker 一条命令都发不出去。
 *  缺省断网：主会话那条路的 `networkProfileFor` 要审批上下文，worker 门里没有这条通道，
 *  于是按 profile 缺省（无 network 规则 ⇒ 闭箱全断）取 deny。worker 要联网只能回主会话发。
 *
 *  导出是为了让「装不装」这个决定本身可判：守卫原文钉在源文本上钉不住**可用态那条路是不是真的通**
 *  （实测：把可用态整条路改成 `return undefined`、守卫一字不动，那 7 条判卷全绿——而那正是本仓
 *  反复栽的形状，worker 悄悄退回 Seatbelt 之外）。断网那一格仍留源文本：证它要真起一次 Seatbelt。 */
export function workerShellRunnerFor(sandbox: SandboxStatus | null): OrchestratorOptions["workerShell"] {
  if (sandbox === null || !sandbox.available) return undefined;
  return async (command, ctx) => {
    const mapped = mapSandboxTestCommandForWorkspace(command, ctx.workspace);
    return runInSandbox(mapped, { cwd: ctx.workspace, network: "deny" });
  };
}

/** **唯一的编排器构造口**：两处调用者（runAgent 现场 / 崩溃恢复兜底）只递各自不同的那几件
 *  （logPath / workspace / 父档位 / emit / 沙箱 / 已加载的规则库 + 可选注入模型），
 *  其余口径全在这里，结构上没法再各写一份。
 *
 *  为什么收成一处（2026-09-24 实测）：P0-2 当年给 runAgent 那处补上 `rules` / `sandboxAvailable`
 *  （注释原话：「否则项目级 deny/ask 规则对 worker 全表失效」），兜底那处**没跟着改**；
 *  而它当时谁都到不了，所以缺件不可见。本会话把崩溃恢复修到可达之后，那处差异立刻变成
 *  「重派出来的 worker 不带项目规则、也不知道沙箱可用性」跑。⇒ 同族出口副本：两处构造迟早漂。
 *  判据：`tests/orchestrator-construction-sites.test.ts`（AST 数构造点 = 1 且本口被调 2 次）。 */
async function buildSessionOrchestrator(a: {
  logPath: string;
  workspace: string;
  parentMode: OrchestratorOptions["parentMode"];
  emit: OrchestratorOptions["emit"];
  sandbox: SandboxStatus | null;
  rules: ReturnType<typeof loadPermissionRules>;
  modelFor?: OrchestratorOptions["modelFor"];
  /** 本 run 已解析的模型选择（逐请求指定的档位在这里）；缺省 = 按 env + 设置盘现算（同一把纯函数）。 */
  runModel?: MainModelSelection;
  /** S3 信任闸（调用方断言那一层）：true = 这个仓的命令由**调用方**担保（判卷/脚本/自有靶子），
   *  不经信任表也不发审批卡。缺省 false。 */
  trustedRepo?: boolean;
  /** S3 信任闸的生产接线（本场 run 的「查表 + 首问」组合口）。null = 没有可问的门
   *  （恢复路径 / 非交互装配）⇒ worker 那条 verify 保持 fail-closed 拒绝，与今日逐字同形。
   *  注意它**不是**「父会话批过就给 worker 免问」的通道：键的第一维是 worker 自己的 repoDir。 */
  verifyTrust?: VerifyTrustResolver | null;
  /** M5b 路由开关 runtime override（CLI `--bandit/--cascade` 一族）。缺席 = 用 settings
   *  （恢复路径走的就是缺席那支，与今日逐字同形）。 */
  routing?: RoutingFlagOverrides;
}): Promise<Orchestrator> {
  const s = await store().get();
  const workerShell = workerShellRunnerFor(a.sandbox);
  return new Orchestrator({
    logPath: a.logPath,
    workspace: a.workspace,
    parentMode: a.parentMode,
    emit: a.emit,
    rules: a.rules,
    sandboxAvailable: a.sandbox ? a.sandbox.available : null,
    ...(workerShell ? { workerShell } : {}),
    safeMode: await resolveSafeMode(), // M3b §11.6：off 不跑 / report 只标 / gate 红标 + 二次确认
    // B1 语义合并闸：影响面开启时，spawn 的写租约判定多问一层「波及集相交」——
    // 两个 worker 各改各的文件（glob 不相交）但改动波及同一批调用点，合并时同样会打架。
    ...(s.impactAnalysis ? { semanticLease: (globs: string[]) => affectedFilesOf(a.workspace, globs) } : {}),
    ...(await orchestratorExtras(a.sandbox, a.runModel, { trustedRepo: a.trustedRepo ?? false, verifyTrust: a.verifyTrust ?? null }, a.routing ?? {})), // M3c：插件角色 / worker 压缩摘要器 / 成本闸 / W4a worker 收束闸
    ...(a.modelFor ? { modelFor: a.modelFor } : {}),
  });
}

/** M3c 会话编排器兜底（崩溃恢复「重派」路径）：无 activeOrchestrator 时按**这条会话的现场**建一个，
 *  保证恢复卡的按钮真实可达。两处此前只在内存里，于是这个分支谁都到不了（实测读数见
 *  `tests/recovery-parent-mode.test.ts` 最后一格：重启后点重派得到「无可用事件管线」）：
 *  ① 日志出处原先只读 `lastLogPath`（只有 run 会写）⇒ 现在优先用设置盘里**已持久化**的
 *     `currentSession`（`handleSessionOpen` 落它就是为了重启还原），拿不到才退回 lastLogPath；
 *  ② 父档位原先读设置盘的 `mode`——那个键的语义是「**新对话**开始时使用的权限档」，拿它当一条
 *     已存在会话的父档，等于把一条 read-only 会话重派成 auto 帽子下的可写会话（§11.7.6 单调继承
 *     的三道闸一起被换松一档）⇒ 改由 `recoveryParentMode` 从事件流的权限留痕里读回来。 */
async function ensureSessionOrchestrator(): Promise<Orchestrator | null> {
  if (activeOrchestrator) return activeOrchestrator;
  const sessionId = (await store().get()).currentSession;
  const logPath = sessionId ? pathOf(requireSessionsDir(), sessionId) : lastLogPath;
  if (!logPath || !existsSync(logPath)) return null; // 宁可不建，也不给不存在的会话凭空开一条流
  const log = createEventLog(logPath);
  const workspace = await currentWorkspace();
  const orch = await buildSessionOrchestrator({
    logPath,
    workspace,
    parentMode: recoveryParentMode(await replay(logPath).catch(() => []), (await store().get()).mode),
    emit: async (e: AgentEvent) => {
      await log.append(e);
      hooks.onEvent?.(e);
    },
    sandbox: sandboxState,
    rules: loadPermissionRules(join(workspace, ".agent", "permissions.json"), globalPermissionsPath()),
  
  });
  activeOrchestrator = orch;
  return orch;
}

/** M3A_AGENTS_DEMO 演示通道：spawn 的 model 字段 → fixtures/agents/<name> 脚本模型。
 *  缓存**剧本**而非模型实例——每次 spawn 造新 scriptedWorkerModel（光标独立，同名多 spawn 各自跑全本）。
 *  slow- 前缀的剧本逐事件延迟（截图节奏：一 worker done、一 worker running）。 */
async function loadDemoWorkerModels(): Promise<(args: SpawnArgs) => WorkerModel | undefined> {
  const dir = join(ROOT, "fixtures", "agents");
  const scripts = new Map<string, Parameters<typeof scriptedWorkerModel>[0]>();
  const names = (await readdir(dir)).filter((f) => f.endsWith(".jsonl") && !f.startsWith("main-"));
  if (names.length === 0) throw new Error("M3A_AGENTS_DEMO：fixtures/agents 下没有 worker 剧本");
  for (const n of names) {
    scripts.set(n, await loadWorkerScript(join(dir, n)));
  }
  return (args: SpawnArgs) => {
    const name = typeof args.model === "string" ? args.model : "";
    const script = scripts.get(name);
    if (!script) return undefined; // 未知剧本名 → 上层 fail-closed 拒绝 spawn
    if (name.startsWith("slow-")) {
      const base = scriptedWorkerModel(script);
      return async function* (messages, tools) {
        for await (const out of base(messages, tools)) {
          await new Promise((r) => setTimeout(r, 700));
          yield out;
        }
      };
    }
    return scriptedWorkerModel(script);
  };
}

interface Hooks {
  onEvent?: (e: AgentEvent) => void;
  onAsk?: (p: AskPayload) => void;
  onAskOutcome?: (p: AskOutcomePayload) => void;
}
const hooks: Hooks = {};

/** electron 壳注入 UI 回调；ipc:check 不注入（事件走 onEvent 参数收集）。 */
export function setAppHooks(h: Hooks): void {
  Object.assign(hooks, h);
}




// 最近一次会话日志路径：/compact 缺省压缩对象（UI 单窗口单任务，与 session 同生命周期语义）。
let lastLogPath: string | null = null;


/** IPC "agent:compact"：手动 /compact 入口。
 *  ① 目标 = **用户当前打开的那条会话**：缺省落到 lastLogPath 会压到「本进程最后一次 run 的会话」，
 *     而那条可能早就切走了——压缩错对象，比不压缩更坏（用户以为省了，实际什么都没动）。
 *  ② emit = 落盘 + 推送同路（与 run 内那条演示通道 `pipeline` 一字同口径）。少了落盘：
 *     压缩卡当场看得见，下次 run 重放又是全文 ⇒ 花了一次摘要的钱换个零效果。
 *     compaction-check 走的是演示那条支，所以这条产品支红过也没人看见。 */
export async function handleCompact(
  over: { sessionId?: string } = {},
): Promise<{ ok: boolean; error?: string; cardPayload?: Record<string, unknown> }> {
  let logPath: string | null;
  if (over.sessionId !== undefined) {
    const dir = requireSessionsDir();
    if (!(await sessionExists(dir, over.sessionId))) return { ok: false, error: "会话不存在，未压缩" };
    logPath = pathOf(dir, over.sessionId);
  } else {
    logPath = lastLogPath;
  }
  if (!logPath) return { ok: false, error: "无会话日志（先跑一轮会话再 /compact）" };
  if (isSessionLogBusy(logPath)) return { ok: false, error: "该会话正在运行，先停止再压缩" };
  const log = createEventLog(logPath);
  const res = await compactSessionLog(
    logPath,
    async (e) => { await log.append(e); hooks.onEvent?.(e); },
    currentPluginRuntime()?.hooks,
  );
  return { ok: res.ok, error: res.error, cardPayload: res.cardPayload };
}

let installed = false;
/** 第一场 run 定的定时五件判据（`true` = 装）。**只读**：它唯一的用途是让后一场的异值当场拒，
 *  不参与任何装/摘决策——真装不装看 `installAppTools` 自己那次调用。 */
let installedAutomation = true;
/** 同上的两把：本轮有没有武装长任务目标 / 有没有开自动记忆（决定 refine_goal 与 remember 挂不挂）。 */
let installedGoal = true;
let installedMemory = true;
/** 同上第四把：子代理三件套挂不挂（固定开销里最大的一块，611 tok/轮）。 */
let installedSubagents = true;
/** M2d：remember 门语义（可测工厂）：方案门写禁 / 档位表判 deny·ask·allow。
 *  §8.1.4「remember 属写动作走权限门」；无权限 → ok:false 且不落盘。
 *  裁决读 `SIDE_EFFECT_DECISION` 那一列（`sideEffectDecisionTable()`）——旧写法是
 *  `if (mode === "read-only") … if (mode === "default") …`，**表外档位一路掉到底、直接落盘**，
 *  和 `checkPermission` 修掉的那个 fail-open 尾巴是同一族。 */
export function createGatedRemember(deps: {
  getMode(): PermissionMode;
  isPlanBlocked(): boolean;
  /** ask 裁决时的审批口；缺省 = 非交互 fail-closed 拒绝。 */
  getAsk(): ((args: Record<string, unknown>) => Promise<boolean>) | undefined;
}): Tool {
  return {
    name: "remember",
    async run(args, ctx) {
      if (deps.isPlanBlocked()) return denied("remember", deps.getMode(), "方案门：先批后写（当前没有已批准的方案）");
      const mode = deps.getMode();
      const decision = sideEffectDecisionTable()[mode] ?? "ask";
      if (decision === "deny") return denied("remember", mode, "只读档拒写向工具");
      if (decision === "ask") {
        const ask = deps.getAsk();
        if (!ask) return denied("remember", mode, "非交互模式（fail-closed）");
        if (!(await ask(args))) return denied("remember", mode, "未获批准");
      }
      return remember.run(args, ctx);
    },
  };
}
/** 一次性把 TOOLS 里的写工具换成带门 + 沙箱的包装（runLoop 直接读 TOOLS，无注入点）。
 *
 *  `automation: false` 摘掉 M4a 那五个定时任务工具。**为什么 CLI 要摘**：它们要 `initScheduler`
 *  才有意义（tick 60s / 补跑 7 天 / 并发闸 ≤2，全是长驻进程语义），而 CLI 是一次性进程——
 *  留着它们，模型看得见就会去建，然后每次都撞 `needScheduler()` 白烧一轮审批。
 *  **这一个参数只管执行面；规格面在 `sessionToolFace` 里由同一个 `automationTools` 字段管
 *  （`faceArgs` 同时喂两处）。两处必须一起翻**：只摘执行面的话模型照样看得见这五把工具、
 *  只吃得到 `unknown tool: automation_create`，比现状那句「调度器未初始化（fail-closed）」更难懂。
 *  调度器与 `Scheduler` 类本身不动（长驻服务时再接）。 */
export function installAppTools(opts: { automation?: boolean; omitTools?: readonly string[] } = {}): void {
  // 装/摘的粒度是**进程**（TOOLS 是全局表，守卫只让第一个调用赢），`automationTools` 的粒度是
  // **每场 run**（规格面 faceArgs 每场重算）。两者对不上时——第二场给出与第一场不同的值——
  // 规格面照新值重算、执行面不照做 ⇒ 模型看得见五件、只吃得到 `unknown tool`，正是本仓栽过
  // 多次的那个形状。所以「第一个 run 定终身」这条从散文契约改成硬拒：同值重复（goal 续跑
  // 一轮轮传同一个值）照旧空转，异值当场抛，在那场 run 出门之前就拒。
  const wantAutomation = opts.automation !== false;
  const omit = new Set(opts.omitTools ?? []);
  // automation 必须全程同值；其余可选工具按进程内并集补注入，规格面每场按本次 omit 收窄。
  //
  // 为什么值得为这点字节动结构（2026-09-30 实测读数，`pnpm prompt-cost`）：
  //   refine_goal      85 tok/轮  没武装目标时该工具**恒 fail-closed**（refine_goal.ts:36）
  //   remember        269 tok/轮  autoMemory 关掉后没有自动消费者
  //   ——固定开销共 2286 tok/轮，而它是**每一轮**都重送的静态段。
  // 「能力没开却一直挂着说明书」是纯浪费：模型读了它、还可能在没开的能力上白花一轮。
  const wantGoal = !omit.has("refine_goal");
  const wantMemory = !omit.has("remember");
  const wantSubagents = !omit.has("spawn_agent");
  if (installed) {
    if (wantAutomation !== installedAutomation) {
      throw new Error(
        "installAppTools: 同一进程里第二场 run 的能力开关与第一场不一致（第一场 定时" +
        (installedAutomation ? "装" : "不装") + "，这一场 定时" + (wantAutomation ? "装" : "不装") +
        "）。执行面 TOOLS 只装一次、规格面每场重算，异值会让模型看得见却调不到。",
      );
    }
    // 动态工具（goal/memory/subagents）只增不减，避免 serve 预装与首场 run 的现场状态不同时报错；
    // LSP 常驻基础 TOOLS 并受 gatedTool 保护，不需要补注入。
    const grew = (wantGoal && !installedGoal) || (wantMemory && !installedMemory) || (wantSubagents && !installedSubagents);
    installedGoal ||= wantGoal;
    installedMemory ||= wantMemory;
    installedSubagents ||= wantSubagents;
    if (grew) injectOmitFaceTools();
    return;
  }
  installed = true;
  installedAutomation = wantAutomation;
  installedGoal = wantGoal;
  installedMemory = wantMemory;
  installedSubagents = wantSubagents;
  injectOmitFaceTools();
  TOOLS.write_file = gatedTool("write_file", TOOLS.write_file);
  TOOLS.edit_file = gatedTool("edit_file", TOOLS.edit_file);
  // M2 补丁工具同罪同罚：它是批量形态的 edit（跨文件、一笔可覆盖多份），必须走同一道门。
  // 不包装 = 直连 TOOLS 的写工具 ⇒ 权限门对它整条缺席（只读档只剩规格面摘除这一层，
  // 模型一旦发出这个名字就会真落盘）——这正是 M7 审计点名的「新工具族静默绕过写禁」形状。
  TOOLS.apply_patch = gatedTool("apply_patch", TOOLS.apply_patch);
  TOOLS.run_shell = gatedTool("run_shell", TOOLS.run_shell);
  // #58：lsp 会 spawn 工作区配置里的命令（`.agent/lsp.json`，外部输入）——同 S3 那条形状。
  // 风险等级由 `src/permissions/risk.ts` 给（high），四档都出卡；不改盘，故不动 SIDE_EFFECT_TOOLS。
  TOOLS.lsp = gatedTool("lsp", TOOLS.lsp);
  // web_fetch：出网取内容。**走 gatedTool 而不是裸挂**——SSRF 判据在工具内，但"要不要问人"
  // 在权限层，两处都要有：`gatedTool` 负责四档出审批卡 + 非交互 fail-closed，并把 scope
  // 钉成 `once`（`wantsNetwork` 那一条，见 `isNetworkCommandCall` 的注释：没有它，
  // 一次"总是允许"就会把出网永久写成免批）。worker 面不给（worker 出网是无条件 deny）。
  (TOOLS as unknown as Record<string, Tool>).web_fetch = gatedTool("web_fetch", webFetch);
  if (opts.automation !== false) {
    // M4a：agent 工具五件（§12.2.5）——automation_create/update/delete/run_now/list。
    // 一切变更走审批卡（§10.4）；prompt 是持久化攻击面：4k 上限（校验拒）+ 审批卡全文展示（args 原样进审批卡）；
    // workspace-write 及以上档位 → 审批卡红字「将无人值守执行」（§12.2.5）；调度器未初始化 = fail-closed。
    installAutomationTools();
  }
}

/** omit 四旗的执行面注入（幂等，可随并集增长重入）：按 installed 旗补装缺的那几件。
 *  全部走 gated 闭包——补装不改变任何审批语义，只是让「某一场真需要的工具」真正在场。
 *  首装与后续并集增长共用这一个入口（两份注入代码迟早漂，见 omit 累积判据处的注释）。 */
function injectOmitFaceTools(): void {
  // M2d：remember 运行时注入（静态注册表 10 工具，tools-check 判据）
  // `autoMemory` 关掉时不挂：那条路上没有自动消费者，留着它等于每轮白付 269 tok 的说明书。
  // 代价说清楚——开了这个开关就**真的没有**手动记一笔的入口（重开 settings 即回来）。
  if (installedMemory) (TOOLS as unknown as Record<string, Tool>).remember = createGatedRemember({
    getMode: () => currentSession()?.autonomy.mode ?? "default",
    isPlanBlocked: () => planGateBlocks(getPlanState()),
    getAsk: () => {
      const s = currentSession();
      if (!s?.askGate) return undefined;
      return async (args: Record<string, unknown>) => {
        const r = await s.askGate!.request("remember", args, { reason: "记忆写入（默认档逐次审批）", risk: "low" });
        return r.outcome === "approved";
      };
    },
  });
  // M3a：spawn_agent 运行时注入（installAppTools 运行时注入先例；静态注册表 10 工具不动）。
  // 编排器未接线（headless 直调 loop）= fail-closed 拒绝。
  // 派生审批**由 orchestrator 按风险分级**出卡（写租约相交 / pipeline / supervise / merge 四处
  // approval_requested），此处不再叠一张 blanket 卡：实测那样会让 agents-check C 段 9 条全红
  // （default 档的只读调研 spawn 也被拦，worker 根本派不出来），且与 pipeline 的既有卡重复。
  //
  // `settings.subagentTools: false` 时整族不挂（省 611 tok/轮，固定开销里最大的一块）。
  // **规格面与执行面必须同进同退**（同一个 `omit` 名单驱动两处）：
  // 只摘执行面 = 模型看得见却只吃得到 `unknown tool`；只摘规格面 = 模型看不见却调得到。
  if (installedSubagents) {
    (TOOLS as unknown as Record<string, Tool>).spawn_agent = {
      name: "spawn_agent",
      async run(args, ctx) {
        const orch = currentOrchestrator();
        if (!orch) return { ok: false, output: "spawn_agent: 编排器未接线（fail-closed）" };
        return orch.spawn(args as SpawnArgs, { callId: ctx.callId });
      },
    };
    // W1a：收队工具（与 spawn_agent 同一注入面、同一「编排器未接线即 fail-closed」口径）。
    // 走 currentOrchestrator() 而不是直接读 activeOrchestrator：H3-P3 的 RunScope 并发隔离靠它，
    // 绕过去会让并发的 unattended run 抢到交互面的编排器（那是 D-2 立项专门修掉的洞）。
    (TOOLS as unknown as Record<string, Tool>).wait_for_agents = createWaitForAgentsTool(() => currentOrchestrator());
    // 动态调整的另一半：模型自己撤自己派出的 worker（同一注入面、同一 fail-closed 口径）。
    // 缺它时 join 文案里那句"可再取消"就是一扇不存在的门，而"派错了只能干等它跑完"是能力 4 的反面。
    (TOOLS as unknown as Record<string, Tool>).cancel_agents = createCancelAgentsTool(() => currentOrchestrator());
  }
  // 长任务锚点的模型侧「改措辞」：落的是与人同一条 goal_set（一份事实源），但带 set_by:"model"，
  // 而投影层不因此挪动窗口锚点/轮次帽 ⇒ 模型能把自己的目标写进每轮提醒，拿不到续跑额度（那两条归人）。
  // 本轮没武装目标时不挂：`createRefineGoalTool` 在 view === null 时**必然**返回
  // 「这个会话没有已武装的长任务目标」⇒ 挂着它只有成本没有能力（85 tok/轮 × 每轮）。
  if (installedGoal) {
    (TOOLS as unknown as Record<string, Tool>).refine_goal = createRefineGoalTool(async () => {
      const s = currentSession();
      if (!s?.sessionId) return null;
      const events = await replay(pathOf(requireSessionsDir(), s.sessionId)).catch(() => [] as AgentEvent[]);
      const view = projectGoal(events);
      if (!view) return null;
      return {
        objective: view.spec.objective, maxTurns: view.spec.maxTurns, maxUsd: view.spec.maxUsd,
        turn: view.turn, stopped: view.stopped,
      };
    });
  }
}

const appAskGate = new AskGate({
  notify: (req) => hooks.onAsk?.(req),
  notifyOutcome: (askId, outcome, reason) => hooks.onAskOutcome?.({ askId, outcome, reason }),
  // #96：`onAsk` 是可选注入（`setAppHooks` 只 `Object.assign`）。没注册时 `notify` 那一句会静默丢弃，
  // 而这一等只有 60s 看门狗会叫醒它——写向工具的回执挂在一张送不出去的书面上，整场 run 停在原地。
  // 判据取"当场读得到钩子"而不是"构造时读到过"：壳可以在第一场 run 之后才注册（也才取消注册）。
  hasAnswerer: () => hooks.onAsk !== undefined,
});

// ---- M4a：定时任务调度器接线（§12.2）——实现住 ./scheduler-runtime（拆分面先例），
// 本装配根只留 serve 常驻入口这一块拼装（装工具面 + 初始化 + 启动）；公开面在文件尾按原路径再导出。

/** serve 常驻入口（M4 路线图：调度器真落地——此前 initScheduler 全树零生产调用者，审计点名的那格）。
 *  装自动化工具面（automation 五件在常驻进程里才有意义）＋初始化＋启动调度器；
 *  触发执行器已在 initScheduler 内接 `makeScheduledExecutor`（触发 = 全新会话的真实代码路径）。
 *  停止交给 CLI 的 SIGINT 处理（返回的 stop 即 stopScheduler）。 */
export async function serveScheduler(opts: { workspace: string }): Promise<{ stop: () => void }> {
  // 预装执行面（scheduler-wiring ① / automation-mount ④ 钉住：跑过 serve 的进程两面必须齐全）。
  // omit 四旗在 installAppTools 里走**累积并集**（2026-10-06 桌面接管笔）：serveScheduler 先于
  // 一切 run 预装「全要」，此后任何一场 run 无论算出什么 omit 面，都只会是它的子集或触发补装
  // ——不会再像严判时代那样把桌面 / CLI --serve 进程的第一场 run 一律炸掉
  // （CAIRN_SMOKE 实测红：第一场 记忆装 / 这一场 记忆不装）。
  initScheduler({
    dataDir: scheduleDataDir(opts.workspace),
    sessionsDir: join(opts.workspace, ".agent", "sessions"),
    workspace: opts.workspace,
  });
  installAppTools({ automation: await installTimeAutomationFace(opts.workspace, undefined) });
  await startScheduler();
  return { stop: stopScheduler };
}


let sandboxState: SandboxStatus = { available: false, reason: "尚未自检" };

/** 自检沙箱（app 启动时 / 检查脚本入口调用）。**返回自检结果**：调用方（CLI）要把「不可用」
 *  明写给用户看，而重复调一次 `checkSandbox` 就是多 spawn 一个进程——自检只有一份事实。 */
export async function initSandbox(): Promise<SandboxStatus> {
  sandboxState = await checkSandbox();
  return sandboxState;
}

/** M7 影响面：写工具成功后回注跨文件波及（护栏能力）。缺省由 `DEFAULT_SETTINGS.impactAnalysis`
 *  决定（用户裁决 2026-09-27 翻成**开**）；直接调 `runAgent` 而不给这个键时按关处理
 *  ——`runAgent` 是内层入口，生产调用者（`handleAgentRun`）总是显式把 settings 的值传下来。 */
export interface ImpactOptions {
  impactAnalysis?: boolean;
}

export interface RunOptions extends SolpiFlags, ImpactOptions {
  /** 能力 5 收束闸：写过盘但模型没自调 verify 时，收束前补一拍验证并把红字落进事件流。
   *  缺省**开**（同族是 `impactAnalysis` / `promptCache`）；一拍 = 真跑一遍 lint/test。 */
  autoVerify?: boolean;
  /** M5b 路由开关 runtime override（CLI `--bandit/--cascade` 一族；同 actionFusion / autoVerify
   *  口径：settings 开闸另议）。字段缺席 = 用 `RunOverrides` 里同名的两枚分别覆盖，最终由
   *  `resolveRoutingFlags` 与 settings 合。缺省缺席 ⇒ 与这两枚旗标存在前逐字同形。 */
  routing?: RoutingFlagOverrides;
  /** 能力 5 的返修那一环（拍红 → 再要一轮去修 → 重验一次，上限一次）。
   *  **只从 settings 取，不留 override 槽**：`handleAgentRun` 的两个产品调用者从不传它，
   *  留 `over.X ??` 就是给一条永远走不到的左半边钉锚点（同 `impactAnalysis` 那一族的做法）。 */
  autoVerifyRepair?: boolean;
  /** S3 信任闸（调用方断言那一层）：true = **这个调用方**担保这批命令，不经信任表也不发审批卡。
   *  **缺省 false**——verify 命令 100% 来自仓库自带文件（.agent/config.json / package.json /
   *  Makefile 探测），而那条执行路径上没有权限判定。自建 fixture / 自有仓库的调用方（判卷、
   *  gate-check、基准）显式传 true。
   *  2026-10-05 起 false **不再是终态**：生产路径改走「按 (repoDir, verify 面内容) 查那把现成的
   *  信任表，查不到就经审批卡问人，批准才跑并登记」（装配点在 runAgent 里，判卷
   *  `tests/verify-trust-fingerprint.test.ts`）。IPC 白名单里没有这个键、也不该有：
   *  它不是一个「用户可以从界面打开的开关」，而是一次一问的决议。 */
  trustedRepo?: boolean;
  workspace: string;
  message: string;
  mode: PermissionMode;
  logPath: string;
  /** Resolved once by handleAgentRun; direct callers may omit and get the settings/env selection. */
  modelSelection?: MainModelSelection;
  /** Canonical in-workspace references; contents are never copied into RunRequest or preload. */
  attachments?: ValidatedRunAttachment[];
  /** M1e：会话模式 —— 日志 append 到既有会话（不 rm）。缺省 false（旧行为：fresh 日志）。 */
  sessionId?: string;
  onEvent?: (e: AgentEvent) => void;
  /** 缺省 = 非交互（ask 按 deny，fail-closed，与 M0 一致）。 */
  askGate?: AskGate;
  /** 缺省 = 不做沙箱包裹。 */
  sandbox?: SandboxStatus | null;
  /** M4a 无人值守（§12.2.4）：会话尾自动沉淀跳过（审批必被拒 = 纯噪音）；审批门由调用方给 unattended 门。 */
  unattended?: boolean;
  /** plan 模式（用户武装）：true ⇒ 本轮无论模型是否自愿提交方案，未获批即写禁。
   *  缺省 false = 逐字同武装前。只有用户侧（RunRequest / settings）能置位，模型无入口。 */
  planRequired?: boolean;
  /** 这一段会话有没有武装长任务目标（`--goal` / RunRequest.objective / goal 续跑轮）。
   *  只用于一件事：没武装时把 `refine_goal` 从模型可见面摘掉——那个工具在无目标时
   *  **恒 fail-closed**（refine_goal.ts），挂着它每轮白付 85 tok 的说明书。 */
  goalArmed?: boolean;
  /** goal 模式的自动续跑轮：在场 = 这条 user_message 由 harness 代发，origin 落流可审计。
   *  缺省不进 origin 字段 ⇒ 事件字节与从前逐字相同。 */
  goalTurn?: GoalTurnOrigin;
  /** M4a 超时闸一：取消信号（loop 轮界收束，§4.4.8 AbortController 同族）。 */
  signal?: AbortSignal;
  /** C1: opt-in main-run write/edit + configured lint; never forwarded to workers. */
  actionFusion?: boolean;
  /** 装不装 M4a 那五个 `automation_*` 定时任务工具。**执行面是进程级的**（`installAppTools`
   *  只让第一个调用赢），所以同一进程里各场 run 必须给同一个值；给成异值会在
   *  `installAppTools` 当场抛，而不是让规格面（这槽每场重算）与执行面悄悄分家。
   *  缺省（不传）= 由 `installTimeAutomationFace` 按**盘上事实**判：本工作区有任务清单、或本进程
   *  起过调度器 ⇒ 装，否则摘（省实测 2,482 字符/轮）。`runAgent` 会把判据写回本槽再喂两面，
   *  所以调用方看到的与两面吃的是同一个值。一次性进程显式传 false（优先级高于盘上事实）。 */
  automationTools?: boolean;
}

/** Explicit non-empty M0A_PROVIDER wins; empty means settings. Unknown env values fail visibly. */
export async function resolveProviderKind(): Promise<ProviderKind> {
  return providerKindFromEnv(process.env.M0A_PROVIDER) ?? (await store().get()).provider;
}

// Main-session wrapper + non-session transport share one selected registry model.
// Explicit fixture env paths still win, preserving frozen demo/e2e bytes.
function createProvider(
  _userMessage: string,
  systemPrefix: string | undefined,
  selection: MainModelSelection,
  sessionOptions?: Pick<RunOptions, "logPath" | "workspace" | "attachments"> & {
    emit: (event: AgentEvent) => Promise<void>;
    plugins?: NonNullable<Parameters<typeof createGlmSessionProvider>[1]>["plugins"];
    requestFace: () => { tools: GlmToolSpec[]; note: string };
    solpi?: SolpiRuntime;
    promptCache?: boolean;
    /** 思考档位（§S8）：一路带到适配器的请求体里。缺省 / "off" ⇒ 请求体里不出现这个字段。 */
    thinking?: ThinkingEffort;
    onPreCompact?: (trigger: "manual" | "auto") => Promise<void>;
    /** 本 provider 每次请求末尾追加的临时 user 消息（不进日志）：会话末沉淀轮送指令用。 */
    ephemeralUserTurn?: string;
  },
): Provider {
  const scripted = scriptedMainModelPath();
  if (scripted !== null) return createMockProvider(scripted);
  if (selection.kind === "demo") return createMockProvider(MOCK_FIXTURE);

  // 取 provider id 必须走 selectionProviderId：`kind` 在自定义家那一支上是标签 "custom"，
  // 不是家名。直接传 kind 会让自定义 provider 在最后一米被误判成「未登记 env 映射」。
  assertProviderKeyConfigured(selectionProviderId(selection));
  const modelTransport: RegistryWorkerModel = toWorkerModel(selection.spec, {
    promptCache: sessionOptions?.promptCache === true,
    // "off" 等于没给：适配器只在拿到真实档位时才往请求体里加字段（逐字旧行为的边界就在这里）
    ...(sessionOptions?.thinking !== undefined && sessionOptions.thinking !== "off"
      ? { reasoningEffort: sessionOptions.thinking }
      : {}),
  });
  // createGlmSessionProvider predates native adapters and exposes a GLM-shaped transport slot.
  // This adapter forwards cancellation + OpenAI/GLM metering while binding the already-resolved spec.
  const transport: SessionTransport = (messages, options, tools, call) => modelTransport(messages, tools ?? [], {
    call,
    ...(options?.stream !== undefined ? { stream: options.stream } : {}),
    ...(options?.metering ? { metering: options.metering } : {}),
  });
  const label = selection.spec.provider;

  if (sessionOptions) {
    const attachmentContext = formatAttachmentContext(sessionOptions.attachments ?? [], sessionOptions.workspace);
    return createGlmSessionProvider(sessionOptions.logPath, {
      system: systemPrefix,
      workspace: sessionOptions.workspace,
      requestFace: sessionOptions.requestFace,
      compaction: {
        ...(sessionOptions.onPreCompact ? { onPreCompact: sessionOptions.onPreCompact } : {}),
      },
      emit: sessionOptions.emit,
      plugins: sessionOptions.plugins,
      solpi: sessionOptions.solpi,
      // Preserve the pre-CX main-session GLM default compaction budget. An explicit request/settings
      // model opts into the registry window; other providers always use their registry spec.
      ...(selectionProviderId(selection) !== "glm" || selection.modelExplicit ? { model: selection.spec.model } : {}),
      // 自由档位的名字查表恒为 undefined ⇒ 窗口必须由 spec 递进预算，否则 `--ctx-window` 只改到一半
      // （toWorkerModel 会丢掉 ctxWindow，只有这一条真的落到 inputLimit 上）。
      ...(selection.modelExplicit ? { ctxWindow: selection.spec.ctxWindow } : {}),
      transport,
      transportLabel: label,
      ...(sessionOptions.ephemeralUserTurn !== undefined ? { ephemeralUserTurn: sessionOptions.ephemeralUserTurn } : {}),
      ...(attachmentContext ? { attachmentContext } : {}),
    });
  }

  return {
    stream(messages, _tools: ProviderToolSpec[] | undefined, call) {
      const rememberTool = gateToolSpecs().filter((spec) => spec.function.name === "remember");
      return transport(messages, {}, rememberTool, call);
    },
  };
}

// verify 执行器：沙箱可用时命令走 Seatbelt（坑三：pnpm 映射为直连 vitest），否则直跑。
// `run` 可注入：这条链上「超时传没传、命令映射对不对、事件里报的是哪条命令」三件事都只有
// 换掉真 spawn 才测得到（沙箱不可用的宿主上分支 A 根本跑不起来）；缺省仍是 runInSandbox。
export function verifyExec(sandbox: SandboxStatus | null, run: typeof runInSandbox = runInSandbox): ExecFn {
  if (!sandbox?.available) return defaultExec;
  return async (command, cwd, timeoutMs) => {
    const mapped = mapSandboxTestCommandForWorkspace(command, cwd);
    // 超时同样要穿过去：沙箱是发货缺省路径，这里不接就等于语言探测的 300s 白给。
    const res = await run(mapped, { cwd, ...(timeoutMs ? { timeoutMs } : {}) });
    // 归因不能只长在非沙箱那一支：沙箱是发货缺省路径，少这一半就等于"环境红只在降级时才不冤枉模型"。
    const cause = classifyVerifyFailure({ timedOut: res.timedOut === true, exitCode: res.exitCode ?? null, output: res.output });
    return {
      command,
      ok: res.ok,
      output: res.ok ? res.output : withVerifyCauseNote(res.output, cause),
      ...(res.ok ? {} : { cause }),
      exitCode: res.exitCode ?? null,
    };
  };
}

/** 核心：mock（或演示通道）驱动跑一轮 loop；每条事件先落 JSONL 再回调。返回完整事件流。
 *  M1b：接线三门 —— clarify/plan 通道（挂起等人）+ verify 反射循环钩子。 */
const liveRunPaths = new Set<string>();
const deletingSessionPaths = new Set<string>();
/** 「这条会话日志正被占用」的唯一判据：run 起时的互斥、手动压缩时的让路，两处读同一个式子。 */
export function isSessionLogBusy(logPath: string): boolean {
  return liveRunPaths.has(resolve(logPath)) || deletingSessionPaths.has(resolve(logPath));
}

/** 该工作区有没有配 LSP（`.agent/lsp.json` 里有真配置）。
 *  读不到 / 坏 JSON / 显式 false 一律 false = 不挂那把工具——
 *  这与 `loadLspConfig` 自己的 fail-closed 方向一致（关着时工具必然抛），
 *  坏 JSON 也不在这里抛：那是工具调用时的错，不该让整轮 run 起不来。 */
function lspConfigured(workspace: string): boolean {
  try {
    const raw = readFileSync(join(workspace, ".agent", "lsp.json"), "utf8");
    const parsed = JSON.parse(raw) as { lsp?: unknown };
    return parsed.lsp !== undefined && parsed.lsp !== null && parsed.lsp !== false;
  } catch {
    return false;
  }
}

/** 该工作区有没有配搜索端点（`.agent/config.json` 的 `search.endpoint` 且含 {query}）。
 *  判据与工具本体同源（`loadSearchConfig`）；坏 JSON 按「没配」处理——口径同 lspConfigured。 */
function searchConfigured(workspace: string): boolean {
  try {
    return loadSearchConfig(workspace) !== null;
  } catch {
    return false;
  }
}


/** 上面那条的累积闸门：一旦判真就永不回退（缺省假 = 还没出现过任何"用得上"的证据）。 */
let automationArmedOnce = false;

/** 定时五件挂不挂的**进程级**判据（与 `installTimeAutoMemory` 同一纪律：执行面只装一次，
 *  所以喂给它的值必须第一场就是定稿；异值由 `installAppTools` 的守卫当场拒，不给分家留缝）。
 *
 *  四条读数按优先级：
 *   1. 执行面已定终身 ⇒ 跟它（一场不许翻面——`false→true` 会让模型看得见却调不到，
 *      `true→false` 会让模型调得到却看不见，两边都是本仓点名的形状）；
 *   2. 调用方明说一次性进程（CLI 的 `automationTools: false`）⇒ 摘，且盘上事实不许顶翻它
 *      （tests/cli-surface.test.ts 钉的那格）；
 *   3. 本进程起过调度器（单调）⇒ 挂；
 *   4. 盘上有任务清单 ⇒ 挂。
 *  第 3/4 条走 `automationArmedOnce` 的**只累积**闸门：还没装执行面的那几场里任何一场判真，
 *  就永久留真（与 `omittedForever` 那条"只累积不回退"的口径同形）。 */
export async function installTimeAutomationFace(workspace: string, explicit: boolean | undefined): Promise<boolean> {
  if (installed) return installedAutomation;
  if (explicit === false) return false;
  if (schedulerEverStarted()) automationArmedOnce = true;
  if (!automationArmedOnce && await automationsScheduled(workspace)) automationArmedOnce = true;
  // await 之后重读一次：并发的另一场可能就在这中间把执行面装了（那时规格面只能跟它）
  return installed ? installedAutomation : automationArmedOnce;
}

/** 进程级「自动记忆」判据：**首次读到的值定终身**，之后不再重读。
 *
 *  为什么必须缓存（2026-09-30 实测踩到）：settings 能在同一进程里变（`setSettings` 是 IPC/测试
 *  的正常用法），而执行面 `TOOLS` 只装一次。不缓存的话第二场 run 按新值算出一个不同的 omit 名单，
 *  装/摘守卫当场抛——`tests/main-run-routing.test.ts` 与 `tests/session-tools.test.ts` 五条
 *  正是这么红的（第一场记忆关、第二场记忆开）。那就是守卫在正确工作：**它拦住的是一次真实的
 *  「两面要分家」**，只是分家的原因在我这边（按 per-run 状态去算进程级的量）。
 *  口径与 settings 自己的读法一致：缺省 true（见 settings.ts 的 `autoMemory: true`）。 */
let memoizedAutoMemory: boolean | null = null;
async function installTimeAutoMemory(): Promise<boolean> {
  if (memoizedAutoMemory === null) {
    memoizedAutoMemory = await store().get().then((s) => s.autoMemory).catch(() => true);
  }
  return memoizedAutoMemory;
}

/** 子代理三件套的进程级判据：同 autoMemory 的口径（首次读到的值定终身）。
 *  为什么也要缓存：它同样来自能在同一进程里变的 settings，而执行面只装一次——
 *  不缓存就会撞上装/摘守卫（那守卫拦的是真问题，见上一个函数的注释）。缺省 true。 */
let memoizedSubagents: boolean | null = null;
async function installTimeSubagents(): Promise<boolean> {
  if (memoizedSubagents === null) {
    memoizedSubagents = await store().get().then((s) => s.subagentTools).catch(() => true);
  }
  return memoizedSubagents;
}

/** 进程级「哪些可选工具真的用不着」：**只累积、不回退**。
 *  某一场需要某把工具 ⇒ 它永久留在名单外（不再摘）；
 *  只有从来没有哪一场需要，才真的摘掉。这样执行面第一次装出来的那份就永远是最终形态，
 *  后续每场的规格面 ⊆ 执行面，不会出现「模型看得见却调不到」。 */
const omittedForever = new Set<string>();
function installTimeOmitTools(want: { goal: boolean; memory: boolean; lsp: boolean; subagents: boolean }): string[] {
  if (want.goal) omittedForever.delete("refine_goal");
  else omittedForever.add("refine_goal");
  if (want.memory) omittedForever.delete("remember");
  else omittedForever.add("remember");
  if (want.lsp) omittedForever.delete("lsp");
  else omittedForever.add("lsp");
  // 子代理三件套同进同退：任一在场就从 omitted 里删掉全部三个（判据以 spawn_agent 为代表，
  // 因为执行面那边读的就是它；`wantSubagents` 也是同一个谓词）。
  for (const n of ["spawn_agent", "wait_for_agents", "cancel_agents"]) {
    if (want.subagents) omittedForever.delete(n);
    else omittedForever.add(n);
  }
  return [...omittedForever];
}
export async function runAgent(opts: RunOptions): Promise<AgentEvent[]> {
  // 能力没开的可选工具：从模型可见面摘掉说明书（见 OPTIONAL_TOOL_NAMES）。
  // 判据取**这一场 run 的真实状态**，不是 settings 里的意图：
  //  · refine_goal 只在真武装了长任务目标时才有语义（否则该工具恒 fail-closed）；
  //  · remember 只在自动记忆开着时才有消费者。
  // 执行面是进程级的（installAppTools 只让第一个调用赢），所以这里算出来的值必须每场一致——
  // 异值由 installAppTools 的守卫当场拒，不给「模型看得见却调不到」留缝。
  const memoOn = await installTimeAutoMemory();
  // lsp 也按「这个工作区到底配没配」判：`.agent/lsp.json` 缺省 = 全局关闭，
  // 而关着时该工具**必然抛**「未启用」（lsp.ts:602）⇒ 挂在模型面上只有成本（186 tok/轮）。
  // 判据读的是**盘上配置**而不是「用户想不想用」——配了就自动回来，不需要额外开关。
  const lspOn = lspConfigured(opts.workspace);
  // **执行面只让第一个调用赢**，所以送进去的开关必须第一次就是定稿：
  // 后续几场若算出不同的值（工作区换了、设置改了、目标武装了），执行面保持不变而规格面按新值
  // 重算 ⇒ 模型看得见却调不到（本仓点名的失败形状）。所以执行面吃的是**累积**判据：
  // 只要这个进程里**任何一场**需要某把工具，它就留着；只有从来没有哪一场需要，才真的摘。
  // 定时五件同一条纪律：判据是**盘上事实 + 进程级单调**（见 installTimeAutomationFace），算完
  // 写回 `opts.automationTools` 这**一个**字段——下面那句（执行面）与 faceArgs（规格面）读的都是
  // 它，两面同源。写成第三把局部开关就会有人只翻一头（tests/automation-tool-surface.test.ts
  // 那支钉的正是"两面吃同一个字段"）。摘掉省的是实测 2,482 字符/轮（每轮固定面约 21.6%）。
  // 位置有讲究：放在 installTimeOmitTools/installAppTools **之前**——那两句之间不许插 await，
  // 否则并发两场首跑会在"算出 omit 名单"与"喂给执行面"之间让出事件循环（守卫会撞自己的车）。
  opts.automationTools = await installTimeAutomationFace(opts.workspace, opts.automationTools);
  // ⚠️ 极性（2026-10-06 接管笔翻正，P1 9e9323e6 落库时三参写反）：installTimeOmitTools 的 want
  // 语义是「这场**需要**它」（需要 ⇒ 从 omit 名单删除 ⇒ 执行面/规格面都挂）。P1 原稿
  // `goal: goalArmed !== true / memory: !memoOn / lsp: !lspOn` 传的是「该摘吗」，与函数语义相反，
  // 净效果 = autoMemory **开着**反而没有 remember（M2d 的手写记忆入口对缺省用户整条死路）、
  // 武装目标反而没有 refine_goal、配了 lsp 反而摘——恰好与上面三行注释各自相反。
  // 自洽（规格/执行同一份名单）所以判卷全绿、P1 的实测省幅也真发生了，只是省错了人群。
  // 翻正后由 installAppTools 的 omit 并集守卫兜面变化（automation 旗仍严判，见该处注释）。
  const omitTools = installTimeOmitTools({
    goal: opts.goalArmed === true,
    memory: memoOn,
    lsp: lspOn,
    subagents: await installTimeSubagents(),
  });
  installAppTools({ automation: opts.automationTools, ...(omitTools.length > 0 ? { omitTools } : {}) });
  // H2（A-2）：无人值守 run 的等人门上限——定时触发的 clarify/plan 挂起 60s 后 fail-closed。
  // 交互 run 不限时（等人语义不变，仅随取消信号收束）。
  const UNATTENDED_GATE_WAIT_MS = 60_000;
  // M1c：两层规则库加载（项目 <workspace>/.agent/permissions.json + 全局占位）；解析失败 fail loud 拒载
  const rules = loadPermissionRules(
    join(opts.workspace, ".agent", "permissions.json"),
    globalPermissionsPath(),
  );
  // H3（D-2 RunScope）：交互面全局只由交互 run 写入；unattended run 的会话态只活在 scope 里，
  // 结束时不再把全局 session 置 null（旧实现会话间相互覆写/假死布防的根源）。
  const interactive = opts.unattended !== true;
  const sessionObj: Session = {
    mode: opts.mode,
    askGate: opts.askGate ?? null,
    sandbox: opts.sandbox ?? null,
    emit: null,
    sessionId: opts.sessionId,
    ...(opts.actionFusion === true ? {
      actionFusion: createActionFusion((command, ctx, guard) =>
        gatedTool("run_shell", run_shell, guard).run({ command }, ctx)),
    } : {}),
    autonomy: newAutonomySession(opts.mode, {
      rules,
      sandboxAvailable: opts.sandbox ? opts.sandbox.available : null,
      // 判卷面硬闸：工作区自己声明的冻结表（没有这张表 ⇒ 空集 ⇒ 零行为）。
      // 锚点 `judge-frozen-wiring-dropped` 钉本行（摘掉 ⇒ tests/judge-frozen-gate.test.ts ⑨ 红，实测已杀）。
      frozenJudgePaths: frozenJudgePathSet(opts.workspace),
    }),
  };
  if (interactive) session = sessionObj;
  const runAbort = new AbortController(); // P3（审查）：交互 run 取消入口（handleRunCancel 经 IPC 触达）
  const signal = opts.signal ? AbortSignal.any([opts.signal, runAbort.signal]) : runAbort.signal;
  if (interactive) interactiveRunAbort = runAbort;
  setRunWorkspace(opts.workspace);
  const runScope: RunScope = { session: sessionObj, orchestrator: null };
  runScopeALS.enterWith(runScope); // 本 run 整条异步链（loop await / 门等待 / 工具执行）都在 scope 内
  // P1（审查）：plan 门状态随 run 隔离——并发 run 互不污染（permissions ALS）。
  // planRequired = 用户武装的 plan 模式：置位者只有 RunRequest/settings，模型侧无入口（否则又退回自愿）。
  enterPlanRunScope(opts.planRequired === true);
  // M2e：本 run 注入统一注册表的插件工具名（会话结束摘除，零残留）；声明在 try 外防 finally TDZ
  let injectedToolNames: string[] = [];
  if (isSessionLogBusy(opts.logPath)) throw new Error("session already running or being deleted");
  liveRunPaths.add(resolve(opts.logPath));
  let log: EventLog | undefined;
  let solpi: SolpiRuntime | undefined;
  let parentFinished = false;
  let eventQueue: Promise<void> = Promise.resolve();
  // 用量归因的唯一盖章点（见 usage-attribution.ts）。主会话那一档要等下面 modelSelection 解析出来才有值，
  // 所以这里给闭包不给快照；空串 = 「这一笔定不了价」（剧本 / demo 通道恒空，绝不拿档位名冒充真钱）。
  let mainUsageModel = "";
  const usageAttribution = createUsageAttributor(() => mainUsageModel);
  try {
    // M1e 会话模式：sessionId 在场 = 会话列表里的既有会话，append（JSONL 即会话，重放无损）；
    // 无 sessionId = 旧行为（每轮新日志，e2e/ipc-check 等脚本路径字节不变）。
    if (!opts.sessionId) await rm(opts.logPath, { force: true });
    // #84（plan 半）：方案门的「存在未批准方案」读**盘上事实**，不读内存布尔。
    // 旧形状：markPlanProposed() 只改 run 级 ALS，而本行上方那句 enterPlanRunScope 每条用户消息
    // 都从全 false 重武装 ⇒ propose_plan 给模型的回执「写禁保持（存在未批准 plan）」只在本轮为真，
    // 换个 turn 写面就敞开（不是"重启才丢"，是"下一条消息就丢"）。
    // 取料只在会话 run 上做：无 sessionId 那条通道盘上那份刚被 rm 掉，读了也是空（省一次空读盘）。
    if (opts.sessionId) seedPendingPlanFromEvents(await replay(opts.logPath).catch(() => [] as AgentEvent[]));
    lastLogPath = opts.logPath; // 无 sessionId 的调用（headless / 旧通道）才用它兜底压缩对象
    log = createEventLog(opts.logPath);
    if (solpiEnabled({ requestMetering: opts.requestMetering, observationPack: opts.observationPack,
      evidenceReceipts: opts.evidenceReceipts, economicCompaction: opts.economicCompaction })) {
      // Fresh headless logs do not exist yet. Open through the event API without a fake event.
      const { open } = await import("node:fs/promises");
      const file = await open(opts.logPath, "a", 0o600); await file.close();
      try { solpi = new SolpiRuntime(await privateSessionDirectory(opts.logPath, opts.workspace), opts); }
      catch (err) { console.warn("[solpi] private storage unavailable; optimizations disabled:", err instanceof Error ? err.message : String(err)); }
    }
    const pipeline = (e: AgentEvent): Promise<void> => {
      const task = eventQueue.then(async () => {
        usageAttribution.stamp(e); // 落盘前先盖：live 与盘必须是同一个对象（同 events 盖 ts 的口径）
        await log!.append(e);
        if (!parentFinished && !(e as { agent_id?: string }).agent_id && e.type === "verify_result") solpi?.meter?.recordVerification({ id: `${e.callId}:${e.attempt}`, ok: e.ok, elapsedMs: null }); // worker 子流不进父验证计量（同投影同口径）
        opts.onEvent?.(e);
        // Workers retain this pipeline after the parent turn. Its queue serializes
        // close with append; a late worker append reopens through createEventLog.
        if (parentFinished) await log!.close?.();
      });
      eventQueue = task.catch(() => {});
      return task;
    };
    sessionObj.emit = pipeline; // H3 D-2：写在 scope 的会话对象上（交互 run 的全局指向同一对象）
    // S3 信任闸的**生产接线**（2026-10-05；此前这两处装配点吃的是常量 `trustedRepo ?? false`，
    // 而生产入口没有任何地方能把它置真 ⇒ `surface()` 恒 false ⇒ 缺省开着的 autoVerify 从未真跑，
    // 48 份日志里 `verify_result{auto:true}` 0 条——「执行-验证-修正」断在第三环）。
    // 现在的形状：按 (repoDir, verify 面内容指纹) 查**那把现成的信任表**（与插件信任同一个
    // `TrustStore`、同一份文件，路径由 `trustFilePathOf` 单点算出，不在这里再抄一遍），
    // 查不到就经本场 run 的审批门（`appAskGate` 那条通道）发一张卡；批准才跑并把决定登记进表，
    // 拒／超时／取消／无人值守一律维持 fail-closed。门缺席（非交互）时连卡都不发。
    // 一场 run 一个实例 ⇒ 「同一面在一次 run 里只问一次」的去重与决议同生命周期（见 verify.ts 那只 Set）。
    const verifyTrust = createVerifyTrustGate({
      trustStore: new TrustStore(trustFilePathOf(pluginRuntimeOpts(opts.workspace))),
      askGate: sessionObj.askGate,
      ...(opts.unattended ? { unattended: true } : {}),
    });
    // M3a：会话级编排器（worker 子流落主流 JSONL；父 turn 收束后编排器存活，审批/取消路由不断）
    let demoModelFor: ((args: SpawnArgs) => WorkerModel | undefined) | undefined;
    if (process.env.M3A_AGENTS_DEMO === "1") demoModelFor = await loadDemoWorkerModels();
    const orchestrator = await buildSessionOrchestrator({
      logPath: opts.logPath,
      workspace: opts.workspace,
      parentMode: opts.mode,
      emit: pipeline,
      sandbox: opts.sandbox ?? null,
      rules,
      trustedRepo: opts.trustedRepo ?? false, // 调用方断言那一层（判卷/脚本）；问人这条路走 verifyTrust
      verifyTrust, // worker 那条 verify 路径同口径，但 worker 的键是自己的 worktree 目录 ⇒ 不继承父决议
      ...(demoModelFor ? { modelFor: demoModelFor } : {}),
      // 成本闸的价键跟着**这个 run 真拨的那一档**走（逐请求指定的模型只在调用手里，重派路径没有）。
      ...(opts.modelSelection ? { runModel: opts.modelSelection } : {}),
      // M5b：路由开关的 runtime override 透到 orchestratorExtras（CLI `--bandit/--cascade` 一族；
      // 缺省缺席 ⇒ orchestratorExtras 回落到 settings，与今日逐字同形）。
      ...(opts.routing ? { routing: opts.routing } : {}),
    });
    runScope.orchestrator = orchestrator;
    if (interactive) activeOrchestrator = orchestrator; // H3 D-2：unattended 不抢交互面的审批路由
    // M2e：插件运行时（会话启动静态扫描产加载清单，不新增事件类型）。
    // 零插件环境（无 .agent/plugins、无 M2E_USER_PLUGINS/M2E_LOOSE_SKILLS）= 空清单 = 零行为。
    let rt: PluginRuntime | null = null;
    try {
      rt = await PluginRuntime.load({ ...pluginRuntimeOpts(opts.workspace), mode: opts.mode, ...(opts.sessionId ? { sessionId: opts.sessionId } : {}) });
      setCurrentPluginRuntime(rt);
      await rt.connectMcp(); // 仅受信插件；pending/declined 不连接（§9.8 信任门）
      rt.activateLsp();       // §9.8 第三激活面：受信插件的 .lsp.json 进 LSP 运行时（同信任门）
      injectedToolNames = installPluginTools(rt);
    } catch (err) {
      console.warn("[plugins] 运行时装载失败，零插件降级:", err instanceof Error ? err.message : String(err));
      rt = null;
    }
    // §9.4 prompt 命令派发（`commands/*.md` → 渲染成用户消息进事件流）。命中即换正文，未命中逐字
    // 不变（零行为）。放在 UserPromptSubmit **之前** ⇒ 钩子与模型看到的是真正要出门的那段文本，
    // 而不是那串用户敲下的斜杠。refused 单列且出声：false 的语义是「不进 / 菜单」，不是「当没看见」。
    const expanded = expandPromptCommand(rt?.commands() ?? [], opts.message, (c) => rt?.substitutionFor(c) ?? {});
    if (expanded.refused !== null) {
      await pipeline({ type: "assistant_message", content: "[command 不可用户调用] " + expanded.refused + "（frontmatter user-invocable:false）" });
      return await replay(opts.logPath);
    }
    // §9.3 用户侧 skill 触发：命令没命中才轮到 skill（命令名是显式登记的，优先）。
    // 这一面也是 `disable-model-invocation` 的唯一入口——那个位拒的是「模型自己点」，
    // 而此前产品里根本没有用户触发面，于是它的实际效果变成「这个 skill 永远不可用」。
    const skillFace = expanded.invoked === null
      ? expandSkillInvocation(rt?.skills() ?? [], expanded.text, (s) => rt?.substitutionFor(s) ?? {})
      : { text: expanded.text, hit: null };
    const promptText = skillFace.text;
    // §9.3 权限联动（用户 face）：命令 / skill 被用户点名激活的那一刻登记它的工具面申报。
    // 模型 face 在 skill 工具内部走同一个 grantSkillScope 入口——两条 face 一份实现，不各抄一遍。
    const scopeHit = skillFace.hit;
    if (expanded.invoked !== null) {
      const cmd = (rt?.commands() ?? []).find((c) => commandInvokeName(c) === expanded.invoked);
      if (cmd) rt?.grantSkillScope(expanded.invoked, cmd.frontmatter);
    } else if (scopeHit !== null) {
      const sk = (rt?.skills() ?? []).find((s) => skillInvokeName(s) === scopeHit.invoke);
      if (sk) rt?.grantSkillScope(scopeHit.invoke, sk.frontmatter);
    }
    // M2e：SessionStart（上下文注入）→ UserPromptSubmit（阻断 / 上下文）；SubagentStart/SubagentStop
    // 事件源在 M3——引擎支持事件名但无源，静默不触发。
    let hookContext = "";
    if (rt) {
      try {
        const ss = await rt.hooks.run("SessionStart", { event: "SessionStart", trigger: "startup" });
        hookContext = ss.additionalContext;
      } catch (err) {
        console.warn("[hooks] SessionStart 失败:", err instanceof Error ? err.message : String(err));
      }
      try {
        const ups = await rt.hooks.run("UserPromptSubmit", { event: "UserPromptSubmit", prompt: promptText });
        if (ups.blocked) {
          await pipeline({ type: "assistant_message", content: "[hook blocked prompt] " + (ups.blockReason ?? "UserPromptSubmit hook 阻断") });
          return await replay(opts.logPath);
        }
        if (ups.additionalContext !== "") hookContext += (hookContext === "" ? "" : "\n") + ups.additionalContext;
      } catch (err) {
        console.warn("[hooks] UserPromptSubmit 失败:", err instanceof Error ? err.message : String(err));
      }
    }
    // #73 第二半（A 类）：把这一轮的任务文本递进去 ⇒ 超预算时先按相关性排，而不是按发现序整条丢。
    //  从前这里调了两次 `routingList()`（同一份清单算两遍，且第二遍的返回值可能与第一遍不同——
    //  清单本身是纯的，但"算两遍"是白付的钱），现在只算一次。
    const skillsRoutingText = rt ? rt.routingList(promptText).text : "";
    const skillsRouting = skillsRoutingText !== "" ? skillsRoutingText : null;
    // One resolved registry selection is reused by the main turn and session-end distillation.
    const providerSettings = await store().get();
    const modelSelection = opts.modelSelection ?? resolveRunModel(providerSettings);
    // 归因用的档位名与美元闸同源（同一个 budgetPriceKeyOf，见第 145 页）；剧本通道置空＝这笔不折钱。
    mainUsageModel = mainUsageModelOf(modelSelection);
    // H3-P4（编排提示词审查 §一）：生产主会话必须有基座系统提示词——此前只有插件路由 + hook 上下文，
    // 模型在撞墙前不知道墙存在（机制成本已付、收益只兑现一半），验收暗卷脚本反而比生产多了角色说明。
    // 系统提示词已提到模块级 BASE_SYSTEM（可被单测锁住）；这里只消费。
    const recall = solpi?.recallTool(async (args, recallSignal) => {
      const decision = evaluate("obs_recall" as ToolName, args, sessionObj.autonomy); // 运行时注入工具（同 remember/MCP 先例：不进静态键域，走同一权限管线）
      if (decision.verdict === "deny") return false;
      if (decision.verdict === "ask") {
        if (!sessionObj.askGate) return false;
        return (await sessionObj.askGate.request("obs_recall", args, { reason: decision.reason, risk: decision.risk, signal: recallSignal })).outcome === "approved";
      }
      return true;
    });
    // M7 影响面：开启时构造缺省钩子（磁盘缓存落应用数据目录，绝不写用户仓库）。
    //  钩子失败（grammar 缺失 / 大仓库超时）由 appendImpact 统一吞掉——写入结果不受影响。
    const impactHook = opts.impactAnalysis === true ? defaultImpactHook(opts.workspace) : undefined;
    // 影响面**读端**：同一个开关下才注入（关着 = 工具面一个字节都不付）。写后回注只解决
    // 「改完才知道波及谁」，这条让模型能在动手前问「谁在调用它」——能力 1 的事前一跳。
    const impactTool = opts.impactAnalysis === true ? createImpactQueryTool() : undefined;
    // M3 诊断工具：按「本工作区真有可诊断面」注入（口径同 lsp 的按盘上配置摘除）——没配命令时
    // 挂着它只有成本。执行器与 verify 同源（`verifyExec(sandbox)`）：沙箱可用走 Seatbelt，
    // 降级时同一条 defaultExec；**写向类**由 gatedTool 包装（只读档摘除/方案门/沙箱降级强制审批）。
    const diagnoseTool = (await diagnoseSurface(opts.workspace))
      ? createDiagnoseTool({ exec: verifyExec(opts.sandbox ?? null) })
      : undefined;
    // M3 检索工具：配了搜索端点才注入（口径同 lsp）。网络类 ⇒ gatedTool 包装 + staticRisk=high
    // （四档一律审批）+ isNetworkCommandCall 钉 once（一次"总是允许"不会把出网永久免批）。
    const searchTool = searchConfigured(opts.workspace) ? makeWebSearch() : undefined;
    // 自进化：上一轮的策略补丁注进 system prompt（让经验回流到决策，而非只记笔记）。
    // 零补丁时 renderPatches 返回空串 ⇒ 系统提示词逐字节不变（零行为回归面）。
    let evolutionNote = "";
    try {
      evolutionNote = await evolutionPromptNote(opts.workspace);
    } catch {
      evolutionNote = "";
    }
    const faceArgs = {
      mode: opts.mode,
      // 同一个字段喂给规格面（sessionToolFace）与执行面（installAppTools）——两面必须同时摘。
      automationTools: opts.automationTools,
      // 能力没开的可选工具：规格面摘说明书，执行面不注入实例。两处同源同一个数组。
      ...(omitTools.length > 0 ? { omitTools } : {}),
      pluginTools: [...(recall ? [observationRecallSpec] : []), ...(impactTool ? [impactQuerySpec] : []), ...(diagnoseTool ? [diagnoseSpec] : []), ...(searchTool ? [webSearchSpec] : []), ...pluginToolSpecsFromRuntime(rt).filter(t => !recall || t.name !== "obs_recall")],
    };
    // run 起点这份只管两件事：出声（同名冲突 / 摘了谁的哪把）+ 给 loop 一份稳定的活闸闭包。
    // 模型可见清单本身走 requestFace 逐请求重算 —— 模型在 run 中途点起的 skill，下一轮就不该再看见那把。
    const initialFace = sessionToolFace(rt, faceArgs);
    if (initialFace.skipped.length > 0) {
      // 同名冲突是配置问题，不静默丢：可见告警（基础工具优先，插件规格不进模型面）
      console.warn("[tools] 插件/MCP 工具名与基础工具同名，已跳过注入:", initialFace.skipped.join(", "));
    }
    if (initialFace.removed.length > 0) {
      // 规格面摘除：模型清单少了几把工具，操作者这边要看得见是谁摘的（同 skipped 的口径）
      console.warn("[skill] 规格面摘除（disallowed-tools）:", initialFace.removed.map((r) => r.name + "←" + r.by).join(", "));
    }
    await runLoop({
      ...(impactHook ? { impact: impactHook } : {}),
      ...(opts.autoVerify === true ? { autoVerify: true } : {}),
      // 返修那一环只在收束闸开着时才有意义（它接的是拍红之后的一步），所以不单独成一支形状：
      // 两个都开才传，避免"闸关着却许诺返修"这种读起来矛盾的配置。
      ...(opts.autoVerify === true && opts.autoVerifyRepair === true ? { autoVerifyRepair: true } : {}),
      stuckNudge: true, // 主会话（人直用那条）才有换路提示：worker 有看门、靶场按字节计量，见 LoopOptions
      provider: createProvider(promptText, systemPromptFor(opts.mode) + evolutionNote, modelSelection, {
        ...opts, emit: pipeline, solpi, promptCache: providerSettings.promptCache,
        requestFace: () => sessionToolFace(rt, faceArgs),
        // §9.5：自动/溢出压缩的 PreCompact 只有这一条生产者（provider 每会话一个，钩子引擎在 rt 上）
        ...(rt ? { onPreCompact: (trigger: "manual" | "auto") => firePreCompactHook(rt?.hooks, trigger) } : {}),
        ...(rt ? { plugins: {
          skillsRouting: skillsRouting ?? undefined,
          hookContext,
          deriveRemount: (events: AgentEvent[]) => rt.remountFromEvents(events).text,
        } } : {}),
      }),
      events: { append: pipeline },
      ...(recall || impactTool || diagnoseTool || searchTool
        ? { tools: { ...TOOLS, ...(recall ? { obs_recall: recall } : {}), ...(impactTool ? { impact_query: impactTool } : {}), ...(diagnoseTool ? { diagnose: gatedTool("diagnose", diagnoseTool) } : {}), ...(searchTool ? { web_search: gatedTool("web_search", searchTool) } : {}) } }
        : {}),
      workspace: opts.workspace,
      mode: "auto", // 冻结 loop 对 ask 一律拒绝；真实门在 gatedTool（复用 checkPermission）
      signal,
      userMessage: promptText,
      ...(skillFace.hit ? { userMessageSkill: skillFace.hit } : {}),
      ...(opts.goalTurn ? { userMessageOrigin: opts.goalTurn } : {}),
      // §9.3 disallowed-tools 的活闸：管本轮已经在飞的调用（下一轮的清单由 requestFace 自己收）。
      // 与规格面用的是**同一份**谓词——两处各写一个闭包等于给"两边口径不一致"留门。
      ...(initialFace.skillDenial ? { skillDenial: initialFace.skillDenial } : {}),
      clarify: {
        // H2（A-2）：等人门可收束——run 取消信号随门透传；无人值守 run 的 clarify/plan
        // 挂起 60s 后 fail-closed（不再悬到 runTimeoutMs 30min 才被超时闸收走）。
        wait: (id, o) =>
          appClarifyGate.wait(id, {
            ...o,
            signal,
            ...(opts.unattended ? { timeoutMs: UNATTENDED_GATE_WAIT_MS } : {}),
          }),
      },
      plan: {
        waitApproval: (id, o) =>
          appPlanGate.waitApproval(id, {
            ...o,
            signal,
            ...(opts.unattended ? { timeoutMs: UNATTENDED_GATE_WAIT_MS } : {}),
          }),
      },
      verify: createVerifyHook(opts.workspace, {
        exec: verifyExec(opts.sandbox ?? null),
        trustedRepo: opts.trustedRepo ?? false, // 调用方断言那一层优先；缺省 false 不等于「永远 false」——
        trustResolver: verifyTrust, // 生产那一半：查信任表，查不到经审批卡问人（S3，2026-10-05 接线）
      }),
      ...(rt ? { hooks: rt.hooks } : {}),
    });
    // M2e：Stop（一轮 agent 收束）——fire-and-forget，失败只告警。
    // exit 2 的「再多要一轮」语义未裁，所以回执整体丢弃（任务 #32）；SessionEnd 不在这儿，
    // 见 finally：会话终止含异常/中断路径，挂在 try 尾上就等于「崩了的会话没有收尾钩子」。
    if (rt) {
      try {
        await rt.hooks.run("Stop", { event: "Stop", trigger: "run_complete" });
      } catch (err) {
        console.warn("[hooks] Stop 失败:", err instanceof Error ? err.message : String(err));
      }
    }
    // M2f 安全 report：验证门收敛后 hook 触发（默认 report / off 不跑；不阻断主流程）
    {
      const safeMode = (await store().get()).safeMode;
      await runSecurityReportHook(opts.logPath, safeMode, pipeline);
    }
    // M2f sidechat 演示通道（env 门控，缺省零行为）：3 轮旁路问答 + 一次 /promote 上屏
    if (process.env.M2F_SIDECHAT_DEMO === "1") {
      await runSidechatDemo(opts.sessionId, opts.logPath, pipeline);
    }
    // M1d 演示通道：M1D_COMPACTION_DEMO=1 时每轮跑完对手动压缩走一遍真实链路
    //（compactSessionLog 同 handleCompact 共用代码，事件经会话管线上屏压缩卡）。缺省零行为。
    // 钩子引擎同 handleCompact 一路取 `rt.hooks`：不带 = 这条演示通道上的 PreCompact 永不触发，
    // 而它恰是 compaction-check 走的那条（带下去才能被门看见）。
    if (process.env.M1D_COMPACTION_DEMO === "1") {
      const res = await compactSessionLog(opts.logPath, pipeline, rt?.hooks);
      if (!res.ok) console.warn("[compaction] 演示通道压缩未发生:", res.error);
    }
    // M2b 演示通道：M2B_MAP_DEMO=1 时对本次事件流跑真实 buildMap + computePrune，
    // 结果以 tool_result 气泡上屏（renderer 零改动；M2A_LSP_DEMO 同族）。缺省零行为。
    // M2B_MAP_WORKSPACE 可指定地图扫描工作区（缺省本次 run 的工作区）。
    if (process.env.M2B_MAP_DEMO === "1") {
      try {
        const events2 = await replay(opts.logPath);
        const built = await buildMap({
          workspace: process.env.M2B_MAP_WORKSPACE ?? opts.workspace,
          maxInputTokens: 128_000,
          nowRound: 0,
        });
        const pruned = computePrune({ events: events2 });
        const body =
          "[符号地图] " +
          (built.ok && built.text
            ? `token=${String(built.tokens)} 文件=${String(built.parsed + built.fromTagsCache)}\n${built.text}`
            : "构建失败（静默降级为无地图）" + (built.error ? "：" + built.error : "")) +
        "\n\n[prune] " +
          (pruned.why === "saved"
            ? `裁剪 ${String(pruned.replacements.size)} 条旧工具结果，省 ${String(pruned.savedTokens)} token（原文可从附件目录回取）`
            : `未触发（${pruned.why}）`);
        await pipeline({ type: "tool_call", id: "m2b-map-demo", name: "read_file", args: { path: "(符号地图演示)" } });
        await pipeline({ type: "tool_result", callId: "m2b-map-demo", ok: true, output: body });
      } catch (err) {
        console.warn("[map] 演示通道失败:", err instanceof Error ? err.message : String(err));
      }
    }
    // M2d 双轨②：会话结束自动沉淀（设置页可关默认开；read-only 档不触发）。
    // 写入即事件：remember 的 tool_call/tool_result 照常落事件流；脚本型 provider 剧本耗尽后产出为空 = 判无。
    try {
      const autoMemory = (await store().get()).autoMemory;
      // 沉淀轮的 provider 要与主会话**用同一份前缀**（2026-09-30 实测的账）：
      // 旧写法只传 `(promptText, undefined, modelSelection)`，于是 provider 没有 system、
      // 没有 requestFace ⇒ 发出去的请求与主会话**在很靠前的地方就分叉**，
      // 前缀缓存一次也命中不了。实测读数：沉淀轮 input 4,417 tok、cacheRead **181**（几乎全价），
      // 占整场会话总输入的 7.4%——而它是每一场会话都要付一次的钱。
      // 传进同一份 sessionOptions 之后，system（BASE_SYSTEM）、工具面（requestFace）、
      // promptCache 开关三者与主会话逐字一致，前缀才可能命中。
      const outcome = await runSessionEndDistill({
        enabled: autoMemory && opts.mode !== "read-only" && opts.unattended !== true,
        logPath: opts.logPath,
        workspace: opts.workspace,
        // 指令走惰性构造口：distill 内部算好指令（含失败轨迹摘要）再建 provider，
        // 经 `ephemeralUserTurn` 送到**请求末尾**——既不落日志（否则下一轮当用户发言重放），
        // 又真能到达模型（真 provider 忽略传入的 messages，只认事件日志）。
        providerFor: (instruction) => createProvider(promptText, BASE_SYSTEM, modelSelection, {
          logPath: opts.logPath,
          workspace: opts.workspace,
          emit: pipeline,
          promptCache: providerSettings.promptCache,
          requestFace: () => sessionToolFace(rt, faceArgs),
          ephemeralUserTurn: instruction,
        }),
        // 脚本化通道（M0A_MOCK_DELTA 之外的暗卷路径）仍要一份 provider：它读 messages 入参，
        // 与 providerFor 二选一——`providerFor` 优先，这条只是不破坏既有脚本路径。
        provider: createProvider(promptText, BASE_SYSTEM, modelSelection, {
          logPath: opts.logPath,
          workspace: opts.workspace,
          emit: pipeline,
          promptCache: providerSettings.promptCache,
          requestFace: () => sessionToolFace(rt, faceArgs),
        }),
        signal,
        rememberTool: remember, // 合并审批即本轮权限门（未加门的工具本体）
        emit: pipeline,
        ...(opts.askGate
          ? {
              mergedApproval: async () => {
                const r = await opts.askGate!.request(
                  "remember",
                  { trigger: "session_end_distill" },
                  { reason: "会话结束自动沉淀（合并审批：批准=本轮全部记忆写入，拒绝=全部不写）", risk: "low", signal },
                );
                return r.outcome === "approved";
              },
            }
          : {}),
      });
      if (outcome.kind !== "disabled") console.log("[memory] 会话结束沉淀:", JSON.stringify(outcome));
    } catch (err) {
      console.warn("[memory] 沉淀轮失败:", err instanceof Error ? err.message : String(err));
    }
  } catch (err) {
    // 抛出去之前先把「这一场不会再自动续跑了」落进事件流：`runAgent` 原先只有 finally、没有 catch，
    // 而 goal 的停止理由一律由 runAgent **外面**的续跑判据（goalNextTurn）写——异常一冒头就跳过了它，
    // 于是芯片继续显示「续跑中」，而这条 run 已经死了（界面上报了一件没发生的事）。
    // 三条边界：① 只在真武装着、且还没停的目标上补（没设过目标 ⇒ 逐字零行为，已停 ⇒ 不落第二条洗掉原理由）；
    // ② 补记录自己失败也不许把原异常换掉——只出声，err 照旧往外抛，`handleAgentRun` 的既有收场路径不变；
    // ③ 下面 finally 的清理语义一个字节都不动。
    try { await emitGoalStoppedOnThrow(opts.logPath, opts.sessionId, err); }
    catch (inner) {
      console.warn("[goal] 异常收场的 goal_stopped 落盘失败（这一格的「不跑了」没上屏，不等于发生了）:",
        inner instanceof Error ? inner.message : String(inner));
    }
    throw err;
  } finally {
    parentFinished = true;
    // Same queue as retained orchestrator pipeline, so no close/write race.
    await eventQueue;
    await log?.close?.();
    if (solpi) {
      try { await solpi.finish(await replay(opts.logPath)); }
      catch (err) { console.warn("[solpi] report persistence failed:", err instanceof Error ? err.message : String(err)); }
    }
    liveRunPaths.delete(resolve(opts.logPath));
    if (interactive) session = null; // H3 D-2：unattended run 不清交互面全局（旧实现把在途交互 run 假死）
    if (interactive && interactiveRunAbort === runAbort) interactiveRunAbort = null; // P3（审查）：run 收束即摘取消句柄
    // 会话结束 = MCP server 子进程一并回收（stdio 流不挂事件循环）；快照留档供 run 间隙查询
    const rtNow = currentPluginRuntime();
    // §9.5 SessionEnd：SessionEnd 生产者**只有这一处**（原来挂在 try 尾的那次调用已并进来——
    // 两处同时存在等于每个会话终止跑两遍收尾钩子，而有副作用的钩子最恨被跑两遍）。
    // 位置有两件事必须成立：在 shutdown 之前（钩子还要用插件根目录 / MCP 子进程），
    // 且在 finally（崩了 / 被中断的会话同样要收尾）。结束原因今天只有真实取值 "exit"；
    // abort/compact 这类更细的分类与 Stop 的 exit 2 裁决一起补（任务 #32），此处不硬造枚举。
    if (rtNow) {
      try {
        const se = await rtNow.hooks.run("SessionEnd", { event: "SessionEnd", trigger: "exit" });
        // SessionEnd 的 stdout 不进任何上下文（没有人再读这一轮），所以红/阻断只能出声，
        // 不能像 PostToolUse 那样"回注"——那是这条事件唯一的可见通道。
        for (const msg of se.errors) console.warn("[hooks] SessionEnd:", msg);
        if (se.blocked) console.warn("[hooks] SessionEnd 返回阻断（该事件无阻断语义，已忽略）：" + (se.blockReason ?? ""));
      } catch (err) {
        console.warn("[hooks] SessionEnd 失败:", err instanceof Error ? err.message : String(err));
      }
    }
    if (rtNow) setPluginSnapshot(rtNow.snapshot());
    await rtNow?.shutdown().catch(() => {});
    // M2e：会话结束摘除本 run 注入的插件工具（TOOLS 是模块级注册表，零残留）
    const table = TOOLS as unknown as Record<string, unknown>;
    for (const n of injectedToolNames) delete table[n];
    setCurrentPluginRuntime(null);
  }
  // 目标漂移读数（能力 4「长任务不遗忘」的真读数，此前这个模块**零生产消费者**：
  // 只有 tests/goal-drift.test.ts 引用它，于是「长任务会不会改口」永远只有单测证据、没有运行证据）。
  //
  // 为什么印 stderr 而**不落事件流**：落流就得新增一种事件类型，而事件流是重放契约
  // （每条都要能 replay 往返，新增类型会让旧日志重放多一个分支）；而这条读数是
  // **事后观测**，不驱动任何决策、不影响这一轮的行为。真要让它可回放，正确做法是下一波
  // 把它并进既有的 `goal_stopped` 那类事件，而不是现在偷加一个类型。
  //
  // 取料口径与被判对象**同一份**（`assistantTurnsFromEvents` 从事件流重组），不另拼一套
  // ——「同一条判据各抄一份」是本仓最忌的一种腐坏。
  try {
    const drift = goalDriftFindings(assistantTurnsFromEvents(await replay(opts.logPath)));
    if (drift.length > 0) console.warn("[goal-drift] " + goalDriftCell(drift));
  } catch (err) {
    // 读数失败不许影响主流程（它只是观测），但也不许静默：这一格取不到就是「没量到」，
    // 静默会把「没量到」读成「没漂移」——本仓反复点名的同一族坑。
    console.warn("[goal-drift] 读数失败（这一格未检，不等于没有漂移）: " + (err instanceof Error ? err.message : String(err)));
  }
  // cost-per-progress：同 goal-drift 的纪律——观测读数，不落事件流，不影响主流程。
  try {
    const cpp = costPerProgress(await replay(opts.logPath));
    if (cpp.measurable && cpp.tokensPerBoundary !== null) {
      console.warn(
        "[cost-per-progress] 每 verified 边界约 " + cpp.tokensPerBoundary + " token" +
          "｜主面 " + cpp.mainTokens + " token" +
          "｜边界后死跑 " + cpp.spendAfterLastBoundary + " token" +
          (cpp.excludedWorkerTokens > 0 ? "（worker 开销 " + cpp.excludedWorkerTokens + " 已单列不入比值）" : ""),
      );
    } else {
      console.warn("[cost-per-progress] 本跑不可测（" + String(cpp.reason) + "）——不许折成 0 或 Infinity");
    }
  } catch (err) {
    console.warn("[cost-per-progress] 读数失败（这一格未检）: " + (err instanceof Error ? err.message : String(err)));
  }
  // 自进化闭环：抽信号 → 生补丁 → 落 .agent/evolution.json。失败不阻塞主流程。
  try {
    const events = await replay(opts.logPath);
    const evo = await runEvolution(events, opts.workspace, opts.sessionId ?? opts.logPath);
    if (evo.patches.length > 0) {
      console.warn("[evolution] 本跑产出 " + evo.patches.length + " 条策略补丁，已落 " + String(evo.persistedTo));
    }
  } catch (err) {
    console.warn("[evolution] 读数/落盘失败（不影响主流程）: " + (err instanceof Error ? err.message : String(err)));
  }
  return replay(opts.logPath);
}

// 五个"只从 settings 取"的开关刻意**不在 overrides 里**（见 `runAgent` 调用处那条注释）：
// 用 Omit 而不是留着不用，是为了让"新增一个 override 槽"必须显式写在这里——那时它就得上判据。
export interface RunOverrides
  extends Omit<SolpiFlags, "requestMetering" | "observationPack" | "evidenceReceipts" | "economicCompaction">,
    Omit<ImpactOptions, "impactAnalysis"> {
  workspace?: string;
  logPath?: string;
  /** M1e：会话模式 —— run 追加到该会话（不 rm 日志），消息落该会话 JSONL。 */
  sessionId?: string;
  onEvent?: (e: AgentEvent) => void;
  /** S3 信任闸：本 run 的工作区 verify 命令可否被自动补拍执行。**缺省即拒绝**——
   *  verify 命令 100% 来自仓库自带文件，而那条执行路径上没有权限判定。 */
  trustedRepo?: boolean;
  /** M4a 无人值守：unattended 审批门（立即拒绝 fail-closed）+ 跳过会话尾沉淀。 */
  unattended?: boolean;
  /** plan 模式 runtime override（同 actionFusion / autoVerify 口径）：缺省取 settings.planRequiredByDefault。 */
  planRequired?: boolean;
  /** M4a 超时闸一：取消信号（轮界收束）。 */
  signal?: AbortSignal;
  /** C1 runtime override; settings/IPC enablement is separate, default off. */
  actionFusion?: boolean;
  /** 能力 5 收束闸 runtime override（同 actionFusion 口径：settings 与 IPC 开闸另议）。 */
  autoVerify?: boolean;
  /** M5b 路由 bandit runtime override（同 actionFusion 口径：settings 与 IPC 开闸另议）。
   *  缺省 = 用 settings.routingBandit；CLI `--bandit` / `--no-bandit` 走这里。
   *  `routingBandit` 蕴含路由开启（本仓口径），故置真即等于给这条 run 开路由。 */
  routingBandit?: boolean;
  /** M5b 级联升档 runtime override（同 routingBandit 口径）。缺省 = 用 settings.routingCascade；
   *  CLI `--cascade` / `--no-cascade` 走这里。 */
  routingCascade?: boolean;
  /** 这一段会话有没有武装长任务目标（`--goal` / RunRequest.objective / goal 续跑轮）。
   *  只喂 `refine_goal` 的挂/摘判据（见 RunOptions.goalArmed）。 */
  goalArmed?: boolean;
  /** 已解析好的模型选择（CLI `--model` 自由档专用）。
   *
   *  为什么需要这个槽，而 `RunRequest.model` 不够：那一档的模型名**按定义不在 `DEFAULT_MODEL_TABLE` 里**
   *  （`provider-runtime.ts:112-115` 的注释——表是 bandit 代价项与预算折钱的依据），而
   *  `validateRunRequestEnvelope`（run-request.ts:48）只收已登记的 id。两边都对，所以自由档只能走这里。
   *  缺省 = 走 `resolveRunModel(settings, req.model)`，与本槽存在前逐字相同。 */
  modelSelection?: MainModelSelection;
  /** 装不装 `automation_*` 五件。**不是 settings 开关**——scheduler 初始化与 tick 是进程级的，
   *  settings 存一个「装不装工具」既管不住也没法表达（进程已起来了）。
   *  这一槽只翻「强制摘」那一头（一次性进程）；不传 = 交给 `installTimeAutomationFace`
   *  按盘上事实判（本工作区有没有任务清单 / 本进程起过调度器），见 `RunOptions.automationTools`。 */
  automationTools?: boolean;
  /** 这条 run 现场**没有人能应答**（stdin 非 TTY / 管道 / CI）。
   *
   *  为什么与 `unattended` 分成两个槽：那个槽还经 `runAgent` 关掉**会话尾沉淀**
   *  （`autoMemory`，见下 `enabled: … && opts.unattended !== true`），而「没人答审批」
   *  与「这是定时任务、不该沉淀」是两件事——CLI 侧刻意只关前者。
   *  但 goal 续跑**必须**看这一槽：门已经 fail-closed 拒了，写不了盘也验不出绿，
   *  而判据里「证据 failed」是 continue ⇒ 不看就是一路烧到轮次闸且没有一轮可能成功。
   *
   *  缺省 false = 有人在场。与 `unattended` 取或，两条任一成立都不续跑。 */
  noAnswerer?: boolean;
}

const unattendedAskGate = new AskGate({ unattended: true });

/** 工作区解析链（P-1 步骤 3）：调用方 overrides > IPC 请求 > M0B_WORKSPACE 演示通道 > settings > 内置靶子。
 *  纯函数以便单测钉住优先级（此前只有前两条，UI 主对话恒落在 fixtures/todo-app）。 */
export function resolveRunWorkspace(
  override: string | undefined,
  request: string | undefined,
  envValue: string | undefined,
  settingsValue: string | null,
  fallback: string,
): string {
  if (override !== undefined) return override;
  if (request !== undefined && request.trim() !== "") return resolve(request);
  if (envValue !== undefined && envValue.trim() !== "") return resolve(envValue);
  // 三条来源统一走 resolve()：相对路径也锚到 cwd，别让「设置里填了相对路径」变成随调用方 cwd 漂的隐式行为
  if (settingsValue !== null && settingsValue.trim() !== "") return resolve(settingsValue);
  return fallback;
}

/** IPC "agent:run" 的处理函数 —— main 暴露的同一入口，ipc:check 直调（不经 UI）。
 *  M4a：定时触发同走本入口（headless、unattended 覆盖 + signal 透传），真实代码路径零分叉。 */
export async function handleAgentRun(
  req: RunRequest,
  over: RunOverrides = {},
): Promise<{ ok: boolean; error?: string; attachmentCount?: number }> {
  try {
    const validatedRequest = validateRunRequestEnvelope(req);
    if (!validatedRequest.ok) return { ok: false, error: validatedRequest.error };
    req = validatedRequest.value;

    const settings = await store().get();
    const sessionId = over.sessionId ?? req.sessionId;
    const sessionMode = sessionId !== undefined;
    const logPath = over.logPath ?? (sessionMode ? pathOf(requireSessionsDir(), sessionId) : join(tmpdir(), "m0b-agent-events.jsonl"));
    const workspace = resolveRunWorkspace(
      over.workspace,
      req.workspace,
      process.env.M0B_WORKSPACE,
      settings.workspace,
      WORKSPACE,
    );

    let attachments: ValidatedRunAttachment[] = [];
    if (req.attachments !== undefined) {
      const checked = await validateRunAttachments(req.attachments, workspace);
      if (!checked.ok) return { ok: false, error: `附件校验失败: ${checked.error}` };
      const external = checked.value.filter((attachment) => attachment.requiresExternalApproval);
      if (external.length > 0) {
        return {
          ok: false,
          error: "附件超出 workspace；approval-required（需显式外部引用审批）",
        };
      }
      attachments = checked.value;
    }

    const modelSelection = over.modelSelection ?? resolveRunModel(settings, req.model);
    if (modelSelection.kind === "demo") {
      if (req.thinking !== undefined && req.thinking !== "off") {
        return { ok: false, error: "demo provider 不支持 thinking；当前只允许 off" };
      }
    } else {
      validateThinkingEffort(modelSelection.spec, req.thinking);
    }
    const attachmentCount = attachments.length;
    // ---- goal 模式：一次 run 结束 ≠ 目标达成。续跑走同一入口、同一装配，判据全在 goal.ts ----
    // 轮次上限本由 spec 管（goalStopDecision）；这里的常数是"投影万一出 bug 也不会无限烧钱"的兜底闸。
    const hardCap = GOAL_TURN_CAP_MAX + 2;
    let message = req.message;
    let goalTurn: GoalTurnOrigin | undefined;
    for (let guard = 0; guard < hardCap; guard++) {
      await runAgent({
        // M2e：M0B_WORKSPACE 工作区覆盖（M2B_MAP_WORKSPACE 同族演示通道，env 门控缺省零行为）——
        // 面板截图/演示指向带 .agent/plugins 的临时工作区，验收与生产路径不变。
        workspace,
        // §S8：思考档位从请求一路带到请求体。以前它在这里被校验收下、然后就丢了
        //（协议有字段、能力表有闸、渲染层有占位行，只有适配器没接）—— 现在这一跳接上了。
        ...(req.thinking !== undefined ? { thinking: req.thinking } : {}),
        message,
        mode: req.mode,
        // plan 模式：settings 的默认档是唯一入口（composer 的即时开关随 goal 模式一起改，见 spec §3）。
        planRequired: over.planRequired ?? (await store().get()).planRequiredByDefault,
        ...(goalTurn ? { goalTurn } : {}),
        logPath,
        modelSelection,
        ...(over.automationTools === false ? { automationTools: false as const } : {}),
        ...(attachmentCount > 0 ? { attachments } : {}),
        ...(sessionMode ? { sessionId } : {}),
        ...(over.unattended ? { unattended: true as const } : {}),
        ...(over.signal ? { signal: over.signal } : {}),
        actionFusion: over.actionFusion ?? (await store().get()).actionFusion,
        autoVerify: over.autoVerify ?? (await store().get()).autoVerify,
        // M5b：路由开关的 runtime override 收成一处（CLI `--bandit/--cascade` 一族；缺省缺席 ⇒
        // 用 settings）。两枚都没给时这里不出现 ⇒ 与今日逐字同形。
        ...(over.routingBandit !== undefined || over.routingCascade !== undefined
          ? { routing: { routingBandit: over.routingBandit, routingCascade: over.routingCascade } }
          : {}),
        trustedRepo: over.trustedRepo ?? false, // S3：IPC 路径不置位 = 不走调用方断言，交给 runAgent 里的「查表 + 首问」（不是缺省即永远拒绝）
        // 这一段会话有没有武装长任务目标：CLI 在 `--goal` 时显式传（它在 run 之前就把
        // `goal_set` 写进日志了），goal 续跑轮由 `goalTurn` 在场推定。只喂 refine_goal 的挂/摘。
        goalArmed: over.goalArmed ?? goalTurn !== undefined,
        // 这几个键只从 settings 取，**不留 runtime override 槽**：`handleAgentRun` 的两个产品调用者
        // （IPC `agent:run` 只转发 sessionId/workspace；定时执行器只转发 unattended/signal）从不传它们，
        // 界面走的是盘上的持久开关。留着 `over.X ??` 只是看着对称——它给的是**永远不会被走到的左半边**，
        // 而这条缝的分辨力要靠 `scripts/lib/wiring-coverage.ts` 那条判据守（新增开关时必须同时有锚点）。
        // 键的**数目**故意不写在这段注释里：它每加一个开关就会失真一次。
        impactAnalysis: (await store().get()).impactAnalysis,
        requestMetering: (await store().get()).requestMetering,
        observationPack: (await store().get()).observationPack,
        evidenceReceipts: (await store().get()).evidenceReceipts,
        economicCompaction: (await store().get()).economicCompaction,
        autoVerifyRepair: (await store().get()).autoVerifyRepair,
        onEvent: (e) => {
          over.onEvent?.(e);
          // F1（审查 P1-14）：agent:event 是全局通道——事件载荷带 session_id，renderer 按当前
          // 会话过滤（定时/后台 run 的事件不再串进用户正看的会话）。仅标记 UI 推送面，
          // JSONL 落盘内容不变（pipeline 已 append 原事件）；无 sessionId 的旧脚本路径不带标记。
          hooks.onEvent?.(sessionId !== undefined ? ({ ...e, session_id: sessionId } as AgentEvent) : e);
        },
        // #96：`noAnswerer`（cli.ts 在非 TTY 那一路翻的槽）以前只喂 goal 续跑闸，这一行不认它
        // ⇒ 管道形状照样拿交互面那只门去"等人答"，而没有任何人会答：每条写向停 60s。
        // 两个槽现在同向（与下一行 goalNextTurn 的 `unattended || noAnswerer` 同一把判据）。
        askGate: over.unattended || over.noAnswerer === true ? unattendedAskGate : appAskGate,
        sandbox: sandboxState,
      });
      const next = await goalNextTurn({ logPath, sessionId, unattended: over.unattended === true || over.noAnswerer === true, aborted: () => over.signal?.aborted === true, runModel: modelSelection });
      if (next === null) return { ok: true, ...(attachmentCount > 0 ? { attachmentCount } : {}) };
      message = next.message;
      goalTurn = next.origin;
    }
    // 只有判据投影异常才可能走到这里。报错而不是静默收场：静默 = 用户以为还在跑。
    // 同时必须落 goal_stopped——硬上限这条路的「为什么不跑了」也得进事件流：只 return ok:false
    // 的话芯片仍显示「续跑中」（投影没停），界面上查不到任何理由（审查 C4 破的是本线自己的不变量）。
    const capReason = "goal 续跑触到硬上限 " + String(hardCap) + " 轮（高于任何允许的目标轮次上限）⇒ 判据投影异常，已强制停";
    const capView = projectGoal(await replay(logPath));
    if (capView !== null && capView.stopped === null) {
      await emitGoalEvent(logPath, sessionId, { type: "goal_stopped", reason: capReason, turn: capView.turn, evidence: capView.evidence });
    }
    return { ok: false, error: capReason };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}










// ---- 公开面（拆分后不变）：以下实现住在轻模块里，本文件按原路径继续导出 ----
export {
  handleAgentDecide, handleCardAction, handleClarifySubmit, handlePlanDecide, handleRunCancel,
  type CardActionRequest,
} from "./card-action-handlers";
export {
  pluginToolSpecsFromRuntime, sessionToolFace, withSkillAllowNote, type PluginToolSource,
} from "./tool-gates";
export {
  currentWorkspace, handleAgentState, handlePluginDecide, pluginRuntimeOpts, scanOrphanWorktrees,
} from "./state-handlers";
export {
  compactSessionLog, resolveSafeMode, runSecurityReportHook, shouldRunSecurityReport,
} from "./compact-and-report";
export {
  handleSidechatAsk, handleSidechatCreate, handleSidechatPromote, handleSidechatState,
} from "./sidechat-handlers";
export { handleGoalSet } from "./goal-handlers";
export {
  automationsScheduled, getScheduler, handleScheduleDelete, handleScheduleRunNow, handleScheduleSnapshot,
  handleScheduleUpsert, initScheduler, makeScheduledExecutor, scheduleDataDir, schedulerRunning,
  startScheduler, stopScheduler, updateScheduleCap,
} from "./scheduler-runtime";
export {
  getSettings, handleLicenseStatus, handleProviderKeyDelete, handleProviderKeySet, handleProviderKeyStatus,
  handleUpdateCheck, initLicenseStore, initSettingsStore, initUpdateContext, providerInfo, setSettings,
} from "./settings-handlers";
export { injectStoredProviderKey } from "./provider-key-inject";
export {
  applyCrashRecovery, handleSessionCreate, handleSessionDelete, handleSessionList, handleSessionOpen,
  handleSessionRename, initSessionsDir,
} from "./session-handlers";
export { handleMemoryDelete, memorySnapshot } from "./memory-handlers";
