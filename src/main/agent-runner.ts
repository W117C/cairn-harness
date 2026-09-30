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
import { runCompaction, createMockSummarizer, compactionCardPayload, type Summarizer } from "../agent/compaction";
import { buildMap } from "../agent/map/build";
import { computePrune } from "../agent/prune";
import {
  createGlmSessionProvider,
  createGlmSummarizer,
  gateToolSpecs,
  sessionToolSpecs,
  type SessionPluginTool,
  type SessionTransport,
} from "../agent/glm-session";
import { ClarifyGate, PlanGate } from "../agent/gates";
import { applyModeLineEdits } from "../agent/prompt-surface";
import { annotateExecCause, classifyVerifyFailure, createVerifyHook, defaultExec, withVerifyCauseNote, type ExecFn } from "../agent/verify";
import { createActionFusion } from "../agent/action-fusion";
import { SolpiRuntime, privateSessionDirectory, removePrivateSessionData, observationRecallSpec, solpiEnabled, type SolpiFlags } from "../agent/solpi-runtime";
import { createUsageAttributor } from "../agent/usage-attribution";
import { affectedFilesOf, defaultImpactHook } from "../agent/impact/index.js";
import { createImpactQueryTool, impactQuerySpec } from "../tools/impact-query";
import { createWaitForAgentsTool } from "../tools/wait_for_agents";
import { createCancelAgentsTool } from "../tools/cancel_agents";
import { createRefineGoalTool } from "../tools/refine_goal";
import { webFetch } from "../tools/web_fetch";
import { AUTOMATION_TOOL_NAMES } from "../agent/automation-surface";
import { run_shell } from "../tools/run_shell";
import type { AgentEvent, ClarifyAnswerMap, EventLog, GoalTurnOrigin } from "../events";
import { frozenJudgePathSet } from "../frozen";
import { createEventLog, replay } from "../events";
// goal 模式：判据与投影全在纯函数面（src/agent/goal.ts），这里只做「读事件流 → 问它 → 落流 → 起下一轮」。
import { GOAL_TURN_CAP_MAX, goalReminder, goalStopDecision, goalWindowSpend, parseGoalSpec, projectGoal } from "../agent/goal";
import { checkPermission, enterPlanRunScope, getPlanState, planGateBlocks, sideEffectDecisionTable, type PermissionMode } from "../permissions";
import {
  evaluate,
  isNetworkCommandCall,
  loadPermissionRules,
  newAutonomySession,
  noteCriticalDenial,
  noteCriticalResolved,
  noteManualDecision,
  noteScopeApproval,
  downgradeSuggestion,
  scopeKey,
  gateBase,
  type AskScope,
  type GateMeta,
  type PermissionRule,
  type ToolResultWithAudit,
} from "../permissions";
import { globalPermissionsPath, savePermissionRules } from "../permissions/rules";
import { type ProviderKind } from "./settings";
import { getLastWorkspace, setRunWorkspace } from "./runner-workspace";
import { createSession, pathOf, readSessionEvents, sessionExists, createSidechatSession, listSidechatSessions, readSidechatEvents, sidechatDir, sidechatEventsPath, type SessionInfo } from "./sessions";
import { createMockProvider } from "../providers/mock";
import type { GlmToolSpec } from "../providers/glm";
import { toWorkerModel, type RegistryWorkerModel } from "../providers/registry";
import { validateThinkingEffort } from "../providers/capabilities";
import type { ModelOutput, Provider, ProviderToolSpec } from "../providers";
import { validateRunRequestEnvelope } from "./run-request";
import { formatAttachmentContext, validateRunAttachments, type ValidatedRunAttachment } from "./run-attachments";
import {
  assertProviderKeyConfigured,
  providerKindFromEnv,
  resolveMainModel,
  type MainModelSelection,
} from "./provider-runtime";
import { TOOLS, type Tool, type ToolResult } from "../tools";
import { remember } from "../tools/remember";
import type { ToolName } from "../tools/base";
import { initMemoryHome, type TopicEntry } from "../agent/memory/store";
import { runSessionEndDistill } from "../agent/memory/distill";
export { initMemoryHome } from "../agent/memory/store"; // shell 启动时注入 userData/memory
import type { MemorySnapshot } from "./ipc-protocol";
import { AskGate } from "./ask-gate";
import type { LicenseState } from "./license";
import type { AskOutcomePayload, AskPayload, RunRequest, SidechatPanelSnapshot } from "./ipc-protocol";
import { annotateNetworkDenial, buildSandboxProfile, checkSandbox, networkProfileFor, runInSandbox, type SandboxStatus } from "./sandbox";
import { PluginRuntime, setCurrentPluginRuntime, currentPluginRuntime, expandPromptCommand, expandSkillInvocation, commandInvokeName, skillInvokeName, type PluginPanelSnapshot } from "../agent/plugins";
import type { HookEngine } from "../agent/plugins/hooks";
import type { McpToolInfo } from "../agent/plugins/mcp";
import { normalizeHistoryFilter, Scheduler, type ScheduleSnapshot, type TriggerExecutor } from "./scheduler";
import { validateAutomation, isUnattendedTier } from "./automations";
import {
  runSidechatTurn,
  promoteToMain,
  scriptedSidechatModel,
  type SidechatModel,
} from "../agent/sidechat";
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
import { buildSecurityReport } from "../agent/security/scan";
import {
  listWorktreeDirs,
  orphanWorktrees,
  cleanOrphanWorktree,
  type WorktreeCleanupResult,
} from "../agent/worktree";
// ---- 拆分面（同 provider-key-inject 先例：实现搬去轻模块，本装配根按原路径继续导出）----
// settings/BYOK/license/更新面 → ./settings-handlers；会话列表与崩溃恢复 → ./session-handlers；
// 记忆快照与删除 → ./memory-handlers；「最近一次 run 的工作区」单一事实源 → ./runner-workspace。
import { getAppVersion, handleLicenseStatus, handleProviderKeyStatus, setSettingsHostDeps, store } from "./settings-handlers";
import { getSessionsDir, requireSessionsDir } from "./session-handlers";
import { memorySnapshot } from "./memory-handlers";

// settings 面不反向依赖本模块（避免装配根 ↔ 轻模块成环）：它需要本模块的两处按回调注入。
setSettingsHostDeps({
  resolveProviderKind: () => resolveProviderKind(),
  onScheduleCapChange: (cap) => updateScheduleCap(cap),
});


const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WORKSPACE = join(ROOT, "fixtures", "todo-app");
const MOCK_FIXTURE = join(ROOT, "fixtures", "mock", "todo-fix.jsonl");
// M1b 三门演示通道：M1B_GATE_FLOW=1 时用 fixtures/gate/gate-flow.jsonl 驱动（clarify/plan 卡片真人交互）。
// env 门控缺省关闭，M0 事件流字节不变。
const GATE_FIXTURE = join(ROOT, "fixtures", "gate", "gate-flow.jsonl");
/** 主会话系统提示词（模块级 = 可被单测锁住：提示词纪律此前从未有测，删掉任何一条都不会红）。
 *  每条纪律都对应一个真实返工面，不是套话：3) 补丁优先（整份重抄会漏抄，write_file 现已会报
 *  +A −R 行并提示），4) 先红后绿（「证明代码真的能跑」的正面），6) 明确「新增用例 ≠ 改判卷文件」
 *  以免与 4) 互斥成模型两难。字节也计入工具面成本（每轮重送的静态段）。 */
export const BASE_SYSTEM = [
  "你是 M0 桌面编程 agent：在指定工作区内读代码、改代码、跑测试、交付结果。",
  "纪律：",
  "1) 任务有歧义先调用 clarify 提问（1–4 问），不要猜；",
  "2) 写/改文件前先 propose_plan 提交方案并等批准（未批准的写操作会被权限层拒绝）；",
  "3) 改已有文件用 edit_file 打补丁，write_file 只用于新建文件（整份重抄既费 output 又容易漏抄未改的行）；",
  "4) 修 bug 先写一条能复现它的测试并跑到红，再改代码到绿；没有红过的复现就不要宣称已修复；",
  "5) 修改完成后调用 verify 跑测试；verify 通过后用一句话收尾；",
  "6) 只改任务需要的文件；既有测试与判卷文件不得改写（第 4 条是**新增**用例，不是改判卷面）。",
  // 编排段刻意**不编号**：纪律 1–6 的编号连续性由 base-system-discipline 钉着（断号会让模型以为
  // 后面的约束可省），而这条是"何时用子代理"的条件段，不是每条任务都走的动作序列。
  // 成本如实记：+115 字符 / +269 字节，每轮重送（静态段），W3 的预算裁决就在这 269 字节上。
  "编排（派子代理时）：能各自独立验收才拆，单一改动别拆；任务书必须自包含——目标 / 涉及文件 / 验收口径，worker 看不到本会话历史；派完先调 wait_for_agents 收队，未拿到回执不得转述 worker 的结论。",
  "机制边界（撞墙时读报错原因调整策略，不要原样重试）：",
  "- 子代理不能再 spawn 子代理（深度恒 1），spawn 并发有上限；write worker 的合并/提交唯一出口是用户侧 git 面板；",
  "- deny 规则与 critical 风险的强制审批不可绕过；会话成本超限会拒绝新 spawn；长时间无进展会被暂停等待恢复指令；",
  "- 权限被拒 → 换合规路径或先提交方案；测试失败 → 按失败信息修复后重跑 verify。",
].join("\n");

/** read-only 档的工具面只有 8 把（现读：clarify glob grep lsp propose_plan read_file refine_goal verify），
 *  而纪律 3 与「编排」段是按**能写文件、能派子代理**那张面写的 ⇒ 对它是不可达承诺
 *  （第 174 页那道门登记的 3 条存量豁免就落在这两行上，任务 #16 把它们清掉）。
 *  这里**只改那一档需要改的行**：其余行与 `BASE_SYSTEM` 是同一份源文本（不是抄两份，规则 205），
 *  而纪律编号 1–6 在两档都保持连续（断号会让模型以为后面的约束可省，`base-system-discipline` 钉着）。 */
const READ_ONLY_LINE_REPLACEMENTS: readonly { prefix: string; text: string }[] = [
  { prefix: "3) ", text: "3) 本档不装配写文件与跑命令的工具：要把改动落到盘上，就在收尾时写清「哪个文件、哪几行、改成什么」，由用户在可写档执行，不要声称已改；" },
];
/** 整行删掉的条件段：它存在的前提是「本档能派子代理」，read-only 不满足那个前提。 */
const READ_ONLY_LINE_DROPS: readonly string[] = ["编排（派子代理时）"];

/** 生产装配点用的系统提示词：按档取面。非 read-only 逐字返回 `BASE_SYSTEM`（等价性由判卷钉，不是注释）。 */
export function systemPromptFor(mode: PermissionMode | undefined): string {
  if (mode !== "read-only") return BASE_SYSTEM;
  return applyModeLineEdits(String(BASE_SYSTEM), { replacements: READ_ONLY_LINE_REPLACEMENTS, drops: READ_ONLY_LINE_DROPS }).text;
}
// M2g 任务 6：演示通道剧本外部化（fixtures/demo/**，带冻结 sha 于 scripts/frozen-demo-sha256.json；
// **独立**于判卷区 frozen-sha256.json）。缺省零行为不变；显式给路径的旧用法保留。
const DEMO_DIR = join(ROOT, "fixtures", "demo");
const LSP_DEMO_FIXTURE = join(DEMO_DIR, "lsp-demo.jsonl");
const SIDECHAT_DEMO_FIXTURE = join(DEMO_DIR, "sidechat-demo.jsonl");
// 坑三：Seatbelt 下 pnpm 起不来（依赖检查失败）。冻结剧本里的 run_shell 命令是 "pnpm test"（sha 不可改），
// 沙箱内映射为坑三实测可用的直连命令；TMPDIR 由 runInSandbox 指到工作区内 .tmp。
const VITEST_DIRECT =
  'node "' + join(ROOT, "node_modules", "vitest", "vitest.mjs") + '" run --pool=threads';

/** 沙箱里要改写成直连 vitest 的命令写法。原先三处消费者各抄一行字面量（worker 与验证门是全表，
 *  模型那条 `run_shell` 只认 `pnpm test`）——同族副本还分两种宽度，两边都零观察者（第 141 页复认针脚歧义时看见）。
 *  收成一份之后，宽度差落成**两个具名名单**：少的那一条是「要不要代替模型改写它自己下的命令」这个裁决，不是漂。 */
export const SANDBOX_TEST_ALIASES: readonly string[] = ["pnpm test", "pnpm run test"];
/** 模型自己下的 `run_shell` 只改这一条惯用法（冻结剧本用的那个），其余逐字不动。 */
export const MODEL_SHELL_TEST_ALIASES: readonly string[] = ["pnpm test"];

export function mapSandboxTestCommand(command: string, aliases: readonly string[] = SANDBOX_TEST_ALIASES): string {
  return aliases.includes(command.trim()) ? VITEST_DIRECT : command;
}

/** 该工作区的测试面是不是真跑 vitest（按**它自己声明的 test 脚本**判）。
 *
 *  为什么需要这只判据（2026-09-29 实测，一次真模型闭环）：
 *  `mapSandboxTestCommand` 把 `pnpm test` **无条件**改写成指向本仓 vitest 的直连命令。
 *  这条改写是为 `fixtures/todo-app` 写的（坑三：Seatbelt 下 pnpm 起不来，而那个靶子的
 *  test 脚本正是 `vitest run …`），但它是全局生效的 ⇒ **任何**非 vitest 项目的验证拍都被换掉：
 *  实测靶子 `cart-demo`（`node --test tests/*.test.js`）的 `pnpm test` 被换成 vitest，
 *  vitest 对着 node:test 文件报 "No test suite found" ⇒ **项目自己 3/3 全过、harness 的 verify 报红**。
 *  模型无法归因（事件里的 command 报的是原始命令），最后只能停下来问用户——
 *  「执行-验证-修正」闭环里最贵的一种失败：假红。
 *
 *  判据为什么是「读它自己的 test 脚本」而不是「看 node_modules 里有没有 vitest」：
 *  真实靶子 `fixtures/todo-app` 自己**没有** node_modules（依赖从仓库根解析），
 *  按「装没装」判会把该改的那一个判成不该改；而重写的意图正是「绕开 pnpm、用仓库根那份 vitest」。
 *  test 脚本里写的是哪个 runner，才是这个项目要对谁跑的**声明**。
 *  读不到 package.json / 解析不出 test 脚本 ⇒ **不改写**（保守那一边；「猜它大概是 vitest」
 *  正是上面那个假红的成因）。 */
const vitestScriptCache = new Map<string, boolean>();
export function workspaceDeclaresVitest(workspace: string): boolean {
  const hit = vitestScriptCache.get(workspace);
  if (hit !== undefined) return hit;
  let declares = false;
  try {
    const pkg = JSON.parse(readFileSync(join(workspace, "package.json"), "utf8")) as { scripts?: Record<string, unknown> };
    const test = pkg.scripts?.["test"];
    declares = typeof test === "string" && test.includes("vitest");
  } catch {
    declares = false; // 没有 package.json / 读不到 / 坏 JSON 一律不改写
  }
  vitestScriptCache.set(workspace, declares);
  return declares;
}

/** 带工作区判据的映射：只有该工作区自己申报用 vitest 时才改写，否则逐字不动。
 *  `workspace` 缺席 = 调用方没有工作区上下文（单测/旧调用）⇒ 保持旧语义（照改），
 *  这样这条缝的既有判卷不用为了新判据整体重写。 */
export function mapSandboxTestCommandForWorkspace(
  command: string,
  workspace: string | undefined,
  aliases: readonly string[] = SANDBOX_TEST_ALIASES,
): string {
  if (workspace !== undefined && !workspaceDeclaresVitest(workspace)) return command;
  return mapSandboxTestCommand(command, aliases);
}

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
// M2e：最近一次 run 的插件面板快照（纯投影的留档，供 run 间隙的 agent:state 查询）。
let lastPluginSnapshot: PluginPanelSnapshot | null = null;

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
    legacyEnvModel: process.env.M0_MODEL,
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
 *  - workerSummarizer：worker 压缩摘要器（§7.5 同一 runCompaction 链；GLM 暗卷需 M0_API_KEY）；
 *  - budget：会话成本闸（§4.4.8 maxBudgetUsd；0 = off 零行为）。 */
async function orchestratorExtras(sandbox: SandboxStatus | null = null, runModel?: MainModelSelection): Promise<
  Pick<OrchestratorOptions, "agentRoleFor" | "workerSummarizer" | "budget" | "routing" | "banditStatePath" | "promptCache" | "impactAnalysis" | "workerVerify" | "workerHooks">
> {
  const s = await store().get();
  return {
    agentRoleFor: (invoke: string) => currentPluginRuntime()?.findAgentRole(invoke) ?? null,
    // §9.10「worker 继承主会话插件启用集」：worker 的工具调用过同一套钩子，视图按 worker 档降权限。
    // 闭包取 currentPluginRuntime()（本函数在装载前就被展开，装载完成后才真正被调）。
    workerHooks: (mode: "read" | "write") => currentPluginRuntime()?.hooks.forWorkerMode(mode) ?? null,
    ...(process.env.M0_API_KEY ? { workerSummarizer: createGlmSummarizer() } : {}),
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
    ...(s.autoVerify
      ? { workerVerify: (repoDir: string) => createVerifyHook(repoDir, { exec: verifyExec(sandbox) }) }
      : {}),
    // M5b 步骤 9：routingBandit 开关同时开启路由与学习状态持久化（bandit 蕴含 routing——
    // 无路由则无档位决策可学）。状态文件在 .agent/ 系统区（同 permissions.json 口径）。
    ...(s.routingBandit
      ? { routing: true, banditStatePath: join(ROOT, ".agent", "routing-bandit.json") }
      : {}),
    // M5b 步骤 10（任务 #45）：级联蕴含 routing——阶梯起点取「路由当时落到哪一档」、升档靠 pin 换模型，
    // 没有路由这两件事都不存在（单开级联就会退化成花两遍钱跑同一个模型）。与 routingBandit 蕴含
    // routing 同形。缺省 false ⇒ 这一整段不接线，sequencer 每环照旧只跑一次。
    ...(s.routingCascade ? { routing: true, cascadeUpgrade: true } : {}),
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
    return await runInSandbox(mapped, { cwd: ctx.workspace, network: "deny" });
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
    ...(await orchestratorExtras(a.sandbox, a.runModel)), // M3c：插件角色 / worker 压缩摘要器 / 成本闸 / W4a worker 收束闸
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

function denied(name: ToolName | string, mode: PermissionMode, why: string, gate?: GateMeta): ToolResult {
  return {
    ok: false,
    output: "[permission denied] " + name + " 在 " + mode + " 档下被门拒绝（" + why + "）",
    ...(gate ? { gate } : {}),
  } as ToolResultWithAudit;
}

/** §9.3 权限联动的**解释面**：某条已激活 skill 申报过 `allowed-tools` 里的这个工具，
 *  但按原话的收紧点（放行不得越过当前权限档位），这条申报**不给免批**。
 *  为什么不悄悄生效算了？——那正是「装载即陈列」的反面教材：字段收下了却不兑现，
 *  而这里连"不兑现"都要说清楚是谁申报的、为什么没放行（能力 8：可解释）。
 *  ⚠️ 反过来把它折成规则库的一条 allow 才是错的：规则库 allow 能顶掉档位的逐次审批，
 *  等于插件作者替用户扩权。两个门共用这一份实现。 */
export function withSkillAllowNote(tool: string, reason: string): string {
  const invo = currentPluginRuntime()?.skillAllowNote(tool) ?? null;
  return invo === null ? reason
    : reason + "（" + invo + " 的 allowed-tools 申报过 " + tool + "，但申报不放行：当前档位仍需确认）";
}

/** `web_fetch` 在这个字面量联合里而不在 `TOOL_NAMES` 里：静态注册表冻结为 9 工具
 *  （`tools-check.ts` 判据），M2a 起的运行时注入先例不碰它。`name as ToolName` 与
 *  `staticRisk` 里 `(tool as string) === "web_fetch"` 是同一处类型缝的两面。 */
type GatedName = "write_file" | "edit_file" | "run_shell" | "web_fetch";

function gatedTool(name: GatedName, original: Tool, beforeExecute?: () => Promise<ToolResult | null>): Tool {
  return {
    name,
    async run(args, ctx) {
      const s = currentSession();
      if (!s) return denied(name, "default", "工具门未接线（fail-closed）");
      // 方案门不再每次刷进 session 入参：权限会话里那份是**活委托**（permissions/plan-state），
      // worker 与主会话读同一份——上一版只在这三处主会话路径刷新镜像，worker 那条路从不刷 ⇒ 先批后写可绕。
      // M1e 设置页「产出代码安全模式」最小语义（§11.6）：gate = 写向工具在管线之前强制审批
      //（setSettings 转发 M1E_SAFE_MODE；src/permissions 冻结，最小接线在本模块）
      if (process.env.M1E_SAFE_MODE === "gate") {
        if (!s.askGate) return denied(name, s.autonomy.mode, "安全模式 gate 非交互（fail-closed）");
        const gateR = await s.askGate.request(name, args, { reason: "安全模式 gate：写工具强制审批", risk: "none", signal: ctx.signal });
        if (gateR.outcome !== "approved") return denied(name, s.autonomy.mode, "安全模式 gate 未批准");
      }
      const d = evaluate(name as ToolName, args, s.autonomy);
      const aMode = s.autonomy.mode;
      if (d.verdict === "deny") return denied(name, aMode, d.reason, { ...gateBase(d, aMode), verdict: "denied" });
      // 人工批准时人选的 scope（ask 分支才会赋值）——留痕要能回答「是谁放行的、放到哪一档」。
      let manualScope: AskScope | undefined;
      // 网络放行的取用面：只有「问过且批了」的网络命令才走 allow 支。
      // §11.4 红线：任何档位下「网络全开」都不是免批条件 ⇒ auto 档的 L4-pass 与无人值守都拿不到，
      // 判据挂在 verdict === "ask" → approved 这一条真实发生过的人工决议上，不挂在分类器上。
      const wantsNetwork = isNetworkCommandCall(name as ToolName, args);
      let humanApproved = false;
      if (d.verdict === "ask") {
        if (!s.askGate) return denied(name, aMode, "非交互模式（fail-closed）：" + d.reason, { ...gateBase(d, aMode), verdict: "unattended" });
        const r = await s.askGate.request(name, args, {
          // 网络命令的批准现在真的放行出网（此前批了也没用——OS 层从没写过 network 规则），
          // 所以把这层后果写进卡片理由：批准必须是知情的。
          reason: withSkillAllowNote(name, d.reason) + (wantsNetwork ? "｜批准 = 本次命令放行网络出网（一次性，不记忆）" : ""),
          risk: d.risk,
          riskReasons: d.riskReasons,
          // 审查待确认第 4 条（任务 4.3）：门侧早已支持 ctx.signal（D12），但调用侧没传 =>
          // run 取消后审批卡驻留到 60s 超时才收，会话/worker 在中间一直挂着。接上运行信号：
          // 取消即按拒绝收束（pending 同步出表，notifyOutcome 记 user）。gatedTool 与
          // gatedMcpTool 两处同形，一并接线。
          signal: ctx.signal,
        });
        if (r.outcome !== "approved") {
          if (d.risk === "critical") {
            noteCriticalDenial(s.autonomy);
            const tip = downgradeSuggestion(s.autonomy);
            if (tip) console.warn("[permissions] " + tip);
          }
          return denied(name, aMode, r.reason === "unattended" ? "无人值守 fail-closed：审批请求自动拒绝" : "未获批准",
            { ...gateBase(d, aMode), verdict: r.reason === "unattended" ? "unattended" : r.reason === "timeout" ? "timeout" : "rejected" });
        }
        // scope 回写（§10.4）：网络类命令强制 once（出网审计，scope 不放行）
        const effScope: AskScope = wantsNetwork ? "once" : r.scope;
        manualScope = effScope;
        // 人工批准已成立 ⇒ 这一条命令这一次执行可以走网络放行支（一次性，不写规则库、不入 scope）。
        // 「asked」由 d.verdict 现算，不另存状态——网络 profile 的三条条件里只有这一条是事件性的。
        humanApproved = true;
        if (effScope === "session_kind") {
          (s.autonomy.sessionScopes as Set<string>).add(scopeKey(name as ToolName, args));
        } else if (effScope === "always") {
          await persistAlwaysRule(ctx.workspace, name as ToolName, args);
        }
        if (d.risk === "critical") noteCriticalResolved(s.autonomy);
        noteManualDecision(s.autonomy);
      } else if (d.auto?.source === "session_scope") {
        noteScopeApproval(s.autonomy); // 断路器计数（连续 scope 自动放行）
      }
      // 判定留痕：能走到这里只有两种可能——本来就不用问（auto-approved）或问过且批了（approved）。
      // 沙箱那两条 return 原先连 auto 审计都带不出去（同一条命令走不走沙箱留痕不一样），一并补上。
      const gateMeta: GateMeta = d.verdict === "ask"
        ? { ...gateBase(d, aMode), verdict: "approved", ...(manualScope !== undefined ? { scope: manualScope } : {}) }
        : { ...gateBase(d, aMode), verdict: "auto-approved" };
      const withGate = (r: ToolResult): ToolResult => ({ ...r, gate: gateMeta } as ToolResultWithAudit);
      // Internal fusion callback, never a model argument: revalidate after approval (which may wait).
      if (beforeExecute) {
        const blocked = await beforeExecute();
        if (blocked) return blocked;
      }
      if (name === "run_shell" && s.sandbox !== null && s.sandbox.available) {
        const command = typeof args.command === "string" ? args.command : "";
        const mapped = mapSandboxTestCommandForWorkspace(command, ctx.workspace, MODEL_SHELL_TEST_ALIASES);
        // 缺省 deny：profile 里不写任何 network 规则 ⇒ 闭箱即全断网（sandbox:check ④ 钉着）。
        // allow 支的取用条件全部住在 networkProfileFor（网络放行永不免批）。
        const network = networkProfileFor({ wantsNetwork, asked: d.verdict === "ask", approved: humanApproved });
        if (beforeExecute) {
          // runInSandbox has no cancellation input. Reuse its profile, but launch via the existing
          // run_shell process-group/cancellation path; approval above evaluated the original lint.
          const tmp = join(await realpath(ctx.workspace), ".tmp");
          await mkdir(tmp, { recursive: true });
          if (ctx.signal?.aborted) return { ok: false, output: "cancelled before sandbox lint" };
          const quote = (s: string): string => "'" + s.replace(/'/g, "'\\''") + "'";
          const command = `TMPDIR=${quote(tmp)} exec /usr/bin/sandbox-exec -p ${quote(buildSandboxProfile(ctx.workspace, { network }))} bash -c ${quote(mapped)}`;
          // 这条出口经 run_shell 工具而非 runInSandbox，故同一判据的提示在这里补（两处共用一只函数）。
          return withGate(annotateNetworkDenial(await original.run({ command }, ctx), network));
        }
        const sand = await runInSandbox(mapped, { cwd: ctx.workspace, network });
        // 上面那条注释说的是「经 run_shell 的那条出口」；这一条不经，故同一只归因函数在这里补
        // （verify 不走这条路，所以不会与它那句「测试脚本未被执行」叠两层）。
        return withGate(annotateExecCause(sand, { timedOut: sand.timedOut === true, exitCode: sand.exitCode ?? null }));
      }
      let result = await original.run(args, ctx);
      if (name !== "run_shell" && result.ok && s.actionFusion) {
        result = await s.actionFusion(result, args.path, ctx);
      }
      // 判定留痕进 tool_result（loop 透传并由 autoOf 派生 auto，零新事件类型）
      return withGate(result);
    },
  };
}

/** M2e：MCP 工具统一注册表入口——与写工具同一条 evaluate 权限管线（无特权，§9.7）。 */
function gatedMcpTool(name: string, info: McpToolInfo & { plugin: string; server: string }, rt: PluginRuntime): Tool {
  return {
    name,
    async run(args, ctx) {
      const s = currentSession();
      if (!s) return denied(name, "default", "工具门未接线（fail-closed）");
      const d = evaluate(name as ToolName, args, s.autonomy, info.grade); // MCP scoped 名进同一管线（规则/风险/档位全生效）
      const aMode = s.autonomy.mode;
      if (d.verdict === "deny") return denied(name, aMode, d.reason, { ...gateBase(d, aMode), verdict: "denied" });
      let manualScope: AskScope | undefined;
      if (d.verdict === "ask") {
        if (!s.askGate) return denied(name, aMode, "非交互模式（fail-closed）：" + d.reason, { ...gateBase(d, aMode), verdict: "unattended" });
        const r = await s.askGate.request(name, args, {
          reason: withSkillAllowNote(name, d.reason),
          risk: d.risk,
          riskReasons: d.riskReasons,
          // 审查待确认第 4 条（任务 4.3）：门侧早已支持 ctx.signal（D12），但调用侧没传 =>
          // run 取消后审批卡驻留到 60s 超时才收，会话/worker 在中间一直挂着。接上运行信号：
          // 取消即按拒绝收束（pending 同步出表，notifyOutcome 记 user）。gatedTool 与
          // gatedMcpTool 两处同形，一并接线。
          signal: ctx.signal,
        });
        if (r.outcome !== "approved") return denied(name, aMode, "未获批准",
          { ...gateBase(d, aMode), verdict: r.reason === "unattended" ? "unattended" : r.reason === "timeout" ? "timeout" : "rejected" });
        manualScope = r.scope;
        noteManualDecision(s.autonomy);
      } else if (d.auto?.source === "session_scope") {
        noteScopeApproval(s.autonomy);
      }
      void ctx;
      // MCP 出口原先把 d.auto 丢了：读了它做断路器计数，却不往结果上挂（§11.7.5 的审计在这条路上
      // 一直是空的）。留痕统一走 gate，auto 由 loop 从 gate 派生。
      const gateMeta: GateMeta = d.verdict === "ask"
        ? { ...gateBase(d, aMode), verdict: "approved", ...(manualScope !== undefined ? { scope: manualScope } : {}) }
        : { ...gateBase(d, aMode), verdict: "auto-approved" };
      const res = await rt.mcp.callTool(info.plugin, info.server, info.name, args);
      return { ok: res.ok, output: res.output, gate: gateMeta } as ToolResultWithAudit;
    },
  };
}

/** M2e：把插件面装进统一注册表——skill 工具 + 各 MCP 工具（scoped 名）；返回注入名清单（会话结束摘除）。 */
function installPluginTools(rt: PluginRuntime): string[] {
  const injected: string[] = [];
  const table = TOOLS as unknown as Record<string, Tool>;
  if (rt.skills().length > 0) {
    table["skill"] = {
      name: "skill",
      async run(args) {
        const name = typeof args.name === "string" ? args.name : "";
        if (name.trim() === "") return { ok: false, output: "skill: name 参数必填（/plugin:name 或 /name）" };
        // §9.3 参数通道：模型传进来的 args 原文交给替换器（$ARGUMENTS / $1 / $name）。
        // 缺省空串而不是"不传"——正文里的 $ARGUMENTS 在无参数时按 CC 语义替换成空，
        // 留裸变量给模型只会让它以为要自己填。
        return rt.triggerSkill(name, typeof args.args === "string" ? args.args : "");
      },
    };
    injected.push("skill");
  }
  for (const [scoped, info] of rt.mcpTools) {
    table[scoped] = gatedMcpTool(scoped, info, rt);
    injected.push(scoped);
  }
  return injected;
}

/** 运行时注入工具的**模型可见规格**（与 installPluginTools 的可执行面一一对应）：
 *  skill（有受信 skill 时）与 MCP scoped 工具。MCP 参数直接复用 server 的 inputSchema 原文，
 *  不翻译不裁剪——两套 schema 各写一份正是「模型看到的工具 ≠ 能执行的工具」的根因。 */
export interface PluginToolSource {
  skills(): readonly unknown[];
  mcpTools: Map<string, McpToolInfo & { plugin: string; server: string }>;
}

/** §9.3 的工具面：一次算出「模型可见规格 + 摘除说明 + 活闸谓词」三件，同源同刻。
 *  规格面与活闸必须一份谓词：两处各判一份就是「模型看到的工具 ≠ 能执行的工具」的镜像缺陷
 *  （这边是能看到却被拒）。纯算、不出声——告警由调用点在 run 起点喊一次，逐请求重算时不该反复刷屏。
 *  导出是为了让这条接线有判据：provider 那条分支要真 key 才走得到，接线本身不能因此永远没证据。 */
export function sessionToolFace(
  rt: { skillDenial(tool: string): string | null } | null,
  opts: { mode: RunOptions["mode"]; pluginTools?: readonly SessionPluginTool[]; automationTools?: boolean },
): { tools: GlmToolSpec[]; note: string; skipped: string[]; removed: { name: string; by: string }[]; skillDenial: ((tool: string) => string | null) | undefined } {
  const skillDenial = rt ? (tool: string): string | null => rt.skillDenial(tool) : undefined;
  const face = sessionToolSpecs({
    mode: opts.mode,
    pluginTools: opts.pluginTools ?? [],
    ...(skillDenial ? { skillDenial } : {}),
  });
  /* 定时五件：**规格面与执行面一起摘**，判据是同一个 `automationTools`。
   *
   *  为什么必须两面都摘（只摘一头都会比现状更糟，两头都是本仓点名的失败形状）：
   *  · 只摘实现不摘规格：`gateToolSpecs`（glm-session.ts:360）无条件 `push(automationToolSpecs())`，
   *    于是模型看得见、只吃得到 `unknown tool: automation_create`——比现状那句
   *    「调度器未初始化（fail-closed）」更难懂，还白烧一轮。
   *  · 只摘规格不摘实现：反过来，模型看得见工具却永远建不成功，正是「存在 ≠ 接线」本身。
   *  现状（两面都在、但没有调度器）反而不算坏：五件各自 fail-closed 说清楚在拒什么，
   *  唯一白烧的一轮是 `automation_create`（审批在 `needScheduler()` 之前）。
   *  摘掉之后一次性进程上模型连看都看不见它们 ⇒ 那轮也不用烧。 */
  const specs =
    opts.automationTools === false
      ? face.specs.filter((s) => !AUTOMATION_TOOL_NAMES.includes(s.function.name))
      : face.specs;
  return { tools: specs, note: face.note, skipped: face.skipped, removed: face.removed, skillDenial };
}

export function pluginToolSpecsFromRuntime(rt: PluginToolSource | null): SessionPluginTool[] {
  if (!rt) return [];
  const out: SessionPluginTool[] = [];
  if (rt.skills().length > 0) {
    out.push({
      name: "skill",
      description:
        "触发已加载的插件 skill（调用名见系统提示的 skill 路由表：/plugin:name 或 /name）；" +
        "返回该 skill 的全文指令，按指令继续执行",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "skill 调用名（/plugin:name 或 /name）" },
          // 规格面与执行面同源：installPluginTools 读的就是 args.args，两处必须一起有
          //（只在一处加 = 模型看不见参数面，或看得见却传不进替换器）。
          args: { type: "string", description: "传给 skill 的参数原文（正文里的 $ARGUMENTS / $1 / $name 按此替换；无参数可省略）" },
        },
        required: ["name"],
      },
    });
  }
  for (const [scoped, info] of rt.mcpTools) {
    // grade 随规格一起带出：档位对 MCP 的白名单在 sessionToolSpecs 那一处统一生效（同 isWriteCall 谓词），
    // 这里不再按 mode 各判一份——两处各判就是「模型看到的」与「门会拒的」重新分家的地方。
    out.push({ name: scoped, description: info.description, parameters: info.inputSchema, grade: info.grade });
  }
  return out;
}

/** always scope 批准落库为 allow 条目（项目规则库，原子写）；拒绝永不生成规则。 */
async function persistAlwaysRule(workspace: string, name: string, args: Record<string, unknown>): Promise<void> {
  const path = join(workspace, ".agent", "permissions.json");
  try {
    const existing = loadPermissionRules(path);
    const rule: PermissionRule =
      name === "run_shell" && typeof args.command === "string"
        ? { behavior: "allow", tool: name, pattern: args.command.trim(), scope: "always" }
        : { behavior: "allow", tool: name, scope: "always" };
    await savePermissionRules(path, [...existing, rule]);
  } catch (err) {
    // 落库失败不阻断本次已批准的执行，但必须可见（审计优先于静默）
    console.error("[permissions] always 规则落库失败:", err instanceof Error ? err.message : String(err));
  }
}


// ---- M1d：/compact 手动入口（压缩必出卡，走 BUILTIN_PROMPTS 内置模板）----
// 摘要器：M0_API_KEY 在场 → GLM 暗卷；缺 key 且 M1D_COMPACTION_DEMO=1 → 冻结 mock（演示通道，
// M1a M0A_MOCK_DELTA 同族先例）；否则 fail-closed 报错，绝不静默压缩。
// 演示通道同时收小 tail 预算（演示会话只有十几条事件，默认预算会把全部事件留在 tail 内无可压缩）。
const DEMO_SUMMARY = [
  "## Objective",
  "- 修复 fixtures/todo-app 中失败的测试（completedCount 未过滤 done 项），由 agent 按 mock 剧本完成。",
  "",
  "## Important Details",
  "- 事件流在 out 会话日志中；权限走 auto 档，写文件与跑测试均已批准。",
  "",
  "## Work State",
  "### Completed",
  "- read_file 读源码 → write_file 修复 completedCount 过滤 → run_shell 跑 vitest（3 passed）。",
  "",
  "### Active",
  "- 无。",
  "",
  "### Blocked",
  "- 无。",
  "",
  "## Next Move",
  "- 继续下一个任务即可；靶子已恢复全绿。",
  "",
  "## Relevant Files",
  "- fixtures/todo-app/src/todo.ts（写，修复点）",
  "- fixtures/todo-app/tests/todo.test.ts（读，判卷用例）",
].join("\n");

/** §9.5 PreCompact 的发出口径（手动压缩与会话自动/溢出压缩两条生产者共用这一处）。
 *  无钩子引擎 = 零行为；阻断只告警——§9.5 表里 PreCompact 没有阻断语义，
 *  把它当闸门用等于让插件悄悄关掉压缩链（那必须是一行的可见输出，不是静默）。 */
async function firePreCompactHook(hooks: HookEngine | undefined, trigger: "manual" | "auto"): Promise<void> {
  if (!hooks) return;
  const r = await hooks.run("PreCompact", { event: "PreCompact", trigger });
  for (const msg of r.errors) console.warn("[hooks] PreCompact:", msg);
  if (r.blocked) console.warn("[hooks] PreCompact 返回阻断（该事件无阻断语义，已忽略）：" + (r.blockReason ?? ""));
}

/** 对一份会话日志执行手动压缩（trigger=manual, reason=user_request）。
 *  emit = 会话管线（落盘+推送同路，M1b 坑十八口径）；缺省直接落盘（headless/脚本）。 */
export async function compactSessionLog(
  logPath: string,
  emit?: (e: AgentEvent) => Promise<void>,
  hooks?: HookEngine,
): Promise<{ ok: boolean; error?: string; event?: AgentEvent; cardPayload?: Record<string, unknown> }> {
  const events = await replay(logPath);
  if (events.length === 0) return { ok: false, error: "会话为空，无可压缩" };
  // §9.5 PreCompact 的生产端在 runCompaction 里（唯一）——这里只把「谁去跑钩子」递下去。
  // 原先是本函数自己 run 一次，而自动压缩档没人发 ⇒ `PreCompact(auto)` 的 matcher 永不命中；
  // 两处各发又会变成 SessionEnd 那种双生产者。trigger 取 §9.5 表里的枚举值 manual/auto。
  const demo = process.env.M1D_COMPACTION_DEMO === "1";
  const summarizer = process.env.M0_API_KEY
    ? createGlmSummarizer()
    : demo
      ? createMockSummarizer(DEMO_SUMMARY)
      : undefined;
  if (!summarizer) return { ok: false, error: "无 M0_API_KEY，手动压缩不可用（fail-closed，不静默压缩）" };
  const outcome = await runCompaction({
    events,
    trigger: "manual",
    reason: "user_request",
    summarizer,
    onPreCompact: (trigger) => firePreCompactHook(hooks, trigger),
    ...(demo ? { config: { tailMinTokens: 150, tailMaxTokens: 300 } } : {}),
  });
  if (!outcome.ok) return { ok: false, error: outcome.why };
  if (emit) await emit(outcome.event);
  else await createEventLog(logPath).append(outcome.event);
  return { ok: true, event: outcome.event, cardPayload: compactionCardPayload(outcome.event) };
}

// ---- M2f：产出代码安全 report 的触发点（验证门收敛后 hook；默认 report，off 不跑）----
// 只做静态快筛（零 token、本地）：从事件流写动作重建变更集 → findings → 一条 security_report 事件。
// 不阻断主流程（loop 已收束，报告只是事后审计事件）；无写动作 / 未收敛 / off → 零行为。
export function shouldRunSecurityReport(safeMode: string, events: AgentEvent[]): boolean {
  if (safeMode !== "report") return false;
  return events.some((e) => e.type === "verify_result" && e.ok);
}

/** 验证门收敛后的安全快筛 hook：产出报告事件（经 emit 落盘 + 上屏）。返回是否产出。 */
export async function runSecurityReportHook(
  logPath: string,
  safeMode: string,
  emit: (e: AgentEvent) => Promise<void>,
): Promise<boolean> {
  try {
    const events = await replay(logPath);
    if (!shouldRunSecurityReport(safeMode, events)) return false;
    const report = buildSecurityReport(events, { scannedAt: new Date().toISOString() });
    if (!report) return false;
    await emit(report);
    return true;
  } catch (err) {
    console.warn("[security] 快筛失败（不阻断主流程）:", err instanceof Error ? err.message : String(err));
    return false;
  }
}

// 最近一次会话日志路径：/compact 缺省压缩对象（UI 单窗口单任务，与 session 同生命周期语义）。
let lastLogPath: string | null = null;

/** M3b：产出代码安全模式解析（编排器与验收脚本共用口径）：显式 env 优先，缺省读设置页（默认 report）。 */
export async function resolveSafeMode(): Promise<"off" | "report" | "gate"> {
  const env = process.env.M1E_SAFE_MODE;
  if (env === "off" || env === "report" || env === "gate") return env;
  if (env !== undefined) delete process.env.M1E_SAFE_MODE; // 非法值清除（fail-visible 于下一次 get）
  const safeMode = (await store().get()).safeMode;
  return safeMode === "off" || safeMode === "gate" ? safeMode : "report";
}

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
      return await remember.run(args, ctx);
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
export function installAppTools(opts: { automation?: boolean } = {}): void {
  // 装/摘的粒度是**进程**（TOOLS 是全局表，守卫只让第一个调用赢），`automationTools` 的粒度是
  // **每场 run**（规格面 faceArgs 每场重算）。两者对不上时——第二场给出与第一场不同的值——
  // 规格面照新值重算、执行面不照做 ⇒ 模型看得见五件、只吃得到 `unknown tool`，正是本仓栽过
  // 多次的那个形状。所以「第一个 run 定终身」这条从散文契约改成硬拒：同值重复（goal 续跑
  // 一轮轮传同一个值）照旧空转，异值当场抛，在那场 run 出门之前就拒。
  const wantAutomation = opts.automation !== false;
  if (installed) {
    if (wantAutomation !== installedAutomation) {
      throw new Error(
        "installAppTools: 同一进程里第二场 run 的 automationTools 与第一场不一致（第一场 " +
        (installedAutomation ? "装" : "不装") + "定时五件，这一场 " + (wantAutomation ? "装" : "不装") +
        "）。执行面 TOOLS 只装一次、规格面每场重算，异值会让模型看得见却调不到。",
      );
    }
    return;
  }
  installed = true;
  installedAutomation = wantAutomation;
  TOOLS.write_file = gatedTool("write_file", TOOLS.write_file);
  TOOLS.edit_file = gatedTool("edit_file", TOOLS.edit_file);
  TOOLS.run_shell = gatedTool("run_shell", TOOLS.run_shell);
  // web_fetch：出网取内容。**走 gatedTool 而不是裸挂**——SSRF 判据在工具内，但"要不要问人"
  // 在权限层，两处都要有：`gatedTool` 负责四档出审批卡 + 非交互 fail-closed，并把 scope
  // 钉成 `once`（`wantsNetwork` 那一条，见 `isNetworkCommandCall` 的注释：没有它，
  // 一次"总是允许"就会把出网永久写成免批）。worker 面不给（worker 出网是无条件 deny）。
  (TOOLS as unknown as Record<string, Tool>).web_fetch = gatedTool("web_fetch", webFetch);
  // M2d：remember 运行时注入（静态注册表冻结为 9 工具，tools-check 判据）
  (TOOLS as unknown as Record<string, Tool>).remember = createGatedRemember({
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
  // M3a：spawn_agent 运行时注入（installAppTools 运行时注入先例；静态注册表 9 工具不动）。
  // 编排器未接线（headless 直调 loop）= fail-closed 拒绝。
  // 派生审批**由 orchestrator 按风险分级**出卡（写租约相交 / pipeline / supervise / merge 四处
  // approval_requested），此处不再叠一张 blanket 卡：实测那样会让 agents-check C 段 9 条全红
  // （default 档的只读调研 spawn 也被拦，worker 根本派不出来），且与 pipeline 的既有卡重复。
  (TOOLS as unknown as Record<string, Tool>).spawn_agent = {
    name: "spawn_agent",
    async run(args, ctx) {
      const orch = currentOrchestrator();
      if (!orch) return { ok: false, output: "spawn_agent: 编排器未接线（fail-closed）" };
      return await orch.spawn(args as SpawnArgs, { callId: ctx.callId });
    },
  };
  // W1a：收队工具（与 spawn_agent 同一注入面、同一「编排器未接线即 fail-closed」口径）。
  // 走 currentOrchestrator() 而不是直接读 activeOrchestrator：H3-P3 的 RunScope 并发隔离靠它，
  // 绕过去会让并发的 unattended run 抢到交互面的编排器（那是 D-2 立项专门修掉的洞）。
  (TOOLS as unknown as Record<string, Tool>).wait_for_agents = createWaitForAgentsTool(() => currentOrchestrator());
  // 动态调整的另一半：模型自己撤自己派出的 worker（同一注入面、同一 fail-closed 口径）。
  // 缺它时 join 文案里那句"可再取消"就是一扇不存在的门，而"派错了只能干等它跑完"是能力 4 的反面。
  (TOOLS as unknown as Record<string, Tool>).cancel_agents = createCancelAgentsTool(() => currentOrchestrator());
  // 长任务锚点的模型侧「改措辞」：落的是与人同一条 goal_set（一份事实源），但带 set_by:"model"，
  // 而投影层不因此挪动窗口锚点/轮次帽 ⇒ 模型能把自己的目标写进每轮提醒，拿不到续跑额度（那两条归人）。
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
  if (opts.automation !== false) {
    // M4a：agent 工具五件（§12.2.5）——automation_create/update/delete/run_now/list。
    // 一切变更走审批卡（§10.4）；prompt 是持久化攻击面：4k 上限（校验拒）+ 审批卡全文展示（args 原样进审批卡）；
    // workspace-write 及以上档位 → 审批卡红字「将无人值守执行」（§12.2.5）；调度器未初始化 = fail-closed。
    installAutomationTools();
  }
}

const appAskGate = new AskGate({
  notify: (req) => hooks.onAsk?.(req),
  notifyOutcome: (askId, outcome, reason) => hooks.onAskOutcome?.({ askId, outcome, reason }),
});

// ---- M4a：定时任务调度器接线（§12.2）——初始化 / IPC handlers / 触发执行器 ----
// 触发 = 全新会话走既有 createSession（调度器内）+ handleAgentRun（真实代码路径，unattended 覆盖）；
// 主时间线落流 = 当前会话 append（有则落）+ UI 推送；journal 始终留账（双轨之二）。
let scheduler: Scheduler | null = null;
let scheduleCapCache = 2;

/** shell / 验收脚本初始化调度器（幂等）。 */
export function initScheduler(opts: {
  dataDir: string;
  sessionsDir: string;
  workspace?: string;
  clock?: () => number;
  jitterMs?: () => number;
  cap?: number;
}): void {
  if (scheduler) return;
  if (opts.cap !== undefined) scheduleCapCache = opts.cap;
  const ws = opts.workspace ?? WORKSPACE;
  scheduler = new Scheduler({
    dataDir: opts.dataDir,
    sessionsDir: opts.sessionsDir,
    workspace: ws,
    // M4a 触发执行器（真缺陷修复，schedule-check F 段抓出）：makeScheduledExecutor 已导出但从未接线，
    // 生产路径每次触发都会落「调度器未接线执行器（fail-closed）」——触发 = 全新会话的真实代码路径由此接通。
    runSession: makeScheduledExecutor(ws),
    ...(opts.clock ? { clock: opts.clock } : {}),
    ...(opts.jitterMs ? { jitterMs: opts.jitterMs } : {}),
    getCap: () => scheduleCapCache,
    emitTimeline: async (e: AgentEvent) => {
      const cur = (await store().get()).currentSession;
      const sdir = getSessionsDir();
      if (sdir && cur) await createEventLog(pathOf(sdir, cur)).append(e);
      hooks.onEvent?.(e);
    },
  });
}

export function getScheduler(): Scheduler | null {
  return scheduler;
}

export async function startScheduler(): Promise<void> {
  // 并发上限从 settings 预热（getCap 为同步读缓存）
  try {
    const s = await store().get();
    scheduleCapCache = s.scheduleConcurrencyCap;
  } catch {
    /* 缺省 2 */
  }
  await scheduler?.start();
}

export function stopScheduler(): void {
  scheduler?.stop();
}

/** 设置页并发上限变更 → 调度器即时生效（setSettings 转发）。 */
export function updateScheduleCap(cap: number): void {
  if (Number.isInteger(cap) && cap >= 1 && cap <= 8) scheduleCapCache = cap;
}

/** 定时触发执行器（真实代码路径）：handleAgentRun + unattended 覆盖 + signal 透传。 */
export function makeScheduledExecutor(workspace: string): TriggerExecutor {
  return async ({ sessionId, message, mode, signal }) => {
    return await handleAgentRun({ message, mode }, { sessionId, workspace, unattended: true, signal });
  };
}

export async function handleScheduleSnapshot(rawFilter?: unknown): Promise<ScheduleSnapshot> {
  // 筛选值来自渲染层的下拉框（跨进程输入面）；合法性与归一都在 scheduler 那一处（防第二份谓词）
  if (!scheduler) return { tasks: [], history: [], running: 0, queued: 0, cap: scheduleCapCache, startupDone: false, tzNotes: {} };
  return await scheduler.snapshot(normalizeHistoryFilter(rawFilter));
}

export async function handleScheduleUpsert(raw: unknown, form = true): Promise<{ ok: boolean; error?: string }> {
  if (!scheduler) return { ok: false, error: "调度器未初始化（fail-closed）" };
  const r = await scheduler.upsert(raw, { form });
  return r.ok ? { ok: true } : { ok: false, error: r.errors.join("；") };
}

export async function handleScheduleDelete(id: string): Promise<{ ok: boolean; error?: string }> {
  if (!scheduler) return { ok: false, error: "调度器未初始化（fail-closed）" };
  return await scheduler.remove(id);
}

export async function handleScheduleRunNow(id: string): Promise<{ ok: boolean; error?: string }> {
  if (!scheduler) return { ok: false, error: "调度器未初始化（fail-closed）" };
  return await scheduler.runNow(id);
}

/** agent 工具五件的实现（§12.2.5）：validate 先行 → 审批卡（全文展示 + 红字判定）→ 落库。 */
function installAutomationTools(): void {
  const table = TOOLS as unknown as Record<string, Tool>;
  const schRef = () => scheduler;
  const approval = async (tool: string, args: Record<string, unknown>, redNote: boolean, signal?: AbortSignal): Promise<ToolResult | null> => {
    const s = currentSession();
    if (!s) return { ok: false, output: "[permission denied] " + tool + "（工具门未接线，fail-closed）" };
    if (!s.askGate) return { ok: false, output: "[permission denied] " + tool + "（非交互模式，fail-closed）" };
    const reason =
      "定时任务变更（审批卡全文展示）" +
      (redNote ? " ⚠ 将无人值守执行：触发时一切审批请求自动拒绝（fail-closed）" : "");
    // 审查 4.3 同口径：定时任务审批卡也接运行信号（取消即按拒绝收束，不留 60s 僵尸卡）
    const r = await s.askGate.request(tool, args, { reason, risk: "medium", signal });
    if (r.outcome !== "approved") {
      const why = r.reason === "unattended" ? "无人值守 fail-closed：审批请求自动拒绝" : "未获批准";
      return { ok: false, output: "[permission denied] " + tool + "（" + why + "）" };
    }
    return null;
  };
  const needScheduler = (): ToolResult | null =>
    schRef() ? null : { ok: false, output: "调度器未初始化（fail-closed）" };
  table["automation_create"] = {
    name: "automation_create",
    async run(args, ctx) { // 审查 4.3：接运行信号（审批卡随取消收束）
      const v = validateAutomation(args, { form: true });
      if (!v.ok) return { ok: false, output: "automation_create 参数无效：" + v.errors.join("；") };
      const denial = await approval("automation_create", args, isUnattendedTier(v.value.permissionTier), ctx.signal);
      if (denial) return denial;
      const ns = needScheduler();
      if (ns) return ns;
      const r = await schRef()!.upsert(args, { form: true });
      return r.ok
        ? { ok: true, output: "已创建定时任务 " + r.value.name + "（id=" + r.value.id + "，permissionTier=" + r.value.permissionTier + "，下次触发 " + (r.value.nextRunAt ?? "无") + "）" }
        : { ok: false, output: "automation_create 失败：" + r.errors.join("；") };
    },
  };
  table["automation_update"] = {
    name: "automation_update",
    async run(args, ctx) { // 审查 4.3：接运行信号（审批卡随取消收束）
      const ns0 = needScheduler();
      if (ns0) return ns0;
      const sch = schRef()!;
      const id = typeof args.id === "string" ? args.id : "";
      if (id === "") return { ok: false, output: "automation_update: id 必填" };
      const cur = sch.list().find((t) => t.id === id);
      if (!cur) return { ok: false, output: "automation_update: 任务不存在 " + id };
      const merged = { ...cur, ...args, id, createdAt: cur.createdAt, updatedAt: cur.updatedAt };
      const v = validateAutomation(merged, { form: true });
      if (!v.ok) return { ok: false, output: "automation_update 合并后无效：" + v.errors.join("；") };
      const denial = await approval("automation_update", { ...v.value }, isUnattendedTier(v.value.permissionTier), ctx.signal);
      if (denial) return denial;
      const r = await sch.upsert(v.value, { form: true });
      return r.ok
        ? { ok: true, output: "已更新定时任务 " + r.value.name + "（id=" + r.value.id + "）" }
        : { ok: false, output: "automation_update 失败：" + r.errors.join("；") };
    },
  };
  table["automation_delete"] = {
    name: "automation_delete",
    async run(args, ctx) { // 审查 4.3：接运行信号（审批卡随取消收束）
      const ns0 = needScheduler();
      if (ns0) return ns0;
      const sch = schRef()!;
      const id = typeof args.id === "string" ? args.id : "";
      if (id === "") return { ok: false, output: "automation_delete: id 必填" };
      const cur = sch.list().find((t) => t.id === id);
      const denial = await approval("automation_delete", { id, ...(cur ? { name: cur.name } : {}) }, false, ctx.signal);
      if (denial) return denial;
      const r = await sch.remove(id);
      return r.ok ? { ok: true, output: "已删除定时任务 " + id } : { ok: false, output: "automation_delete 失败：" + (r.error ?? "未知") };
    },
  };
  table["automation_run_now"] = {
    name: "automation_run_now",
    async run(args, ctx) { // 审查 4.3：接运行信号（审批卡随取消收束）
      const ns0 = needScheduler();
      if (ns0) return ns0;
      const id = typeof args.id === "string" ? args.id : "";
      if (id === "") return { ok: false, output: "automation_run_now: id 必填" };
      const denial = await approval("automation_run_now", { id }, false, ctx.signal);
      if (denial) return denial;
      const r = await schRef()!.runNow(id);
      return r.ok ? { ok: true, output: "已手动触发 " + id + "（走准入管线：去重/并发/重叠闸生效）" } : { ok: false, output: "automation_run_now：" + (r.error ?? "未知") };
    },
  };
  table["automation_list"] = {
    name: "automation_list",
    async run() {
      const ns0 = needScheduler();
      if (ns0) return ns0;
      const tasks = schRef()!.list().map((t) => ({
        id: t.id, name: t.name, kind: t.schedule.kind, timeZone: t.timeZone,
        permissionTier: t.permissionTier, catchUp: t.catchUp, enabled: t.enabled, nextRunAt: t.nextRunAt,
      }));
      return { ok: true, output: JSON.stringify(tasks, null, 2) };
    },
  };
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
  /** 能力 5 的返修那一环（拍红 → 再要一轮去修 → 重验一次，上限一次）。
   *  **只从 settings 取，不留 override 槽**：`handleAgentRun` 的两个产品调用者从不传它，
   *  留 `over.X ??` 就是给一条永远走不到的左半边钉锚点（同 `impactAnalysis` 那一族的做法）。 */
  autoVerifyRepair?: boolean;
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
   *  缺省 true = 装（长驻服务语义）。一次性进程传 false。 */
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
    onPreCompact?: (trigger: "manual" | "auto") => Promise<void>;
  },
): Provider {
  const scripted = scriptedMainModelPath();
  if (scripted !== null) return createMockProvider(scripted);
  if (selection.kind === "demo") return createMockProvider(MOCK_FIXTURE);

  assertProviderKeyConfigured(selection.kind);
  const modelTransport: RegistryWorkerModel = toWorkerModel(selection.spec, {
    promptCache: sessionOptions?.promptCache === true,
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
      ...(selection.kind !== "glm" || selection.modelExplicit ? { model: selection.spec.model } : {}),
      // 自由档位的名字查表恒为 undefined ⇒ 窗口必须由 spec 递进预算，否则 `--ctx-window` 只改到一半
      // （toWorkerModel 会丢掉 ctxWindow，只有这一条真的落到 inputLimit 上）。
      ...(selection.modelExplicit ? { ctxWindow: selection.spec.ctxWindow } : {}),
      transport,
      transportLabel: label,
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
export async function runAgent(opts: RunOptions): Promise<AgentEvent[]> {
  installAppTools({ automation: opts.automationTools });
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
      ...(demoModelFor ? { modelFor: demoModelFor } : {}),
      // 成本闸的价键跟着**这个 run 真拨的那一档**走（逐请求指定的模型只在调用手里，重派路径没有）。
      ...(opts.modelSelection ? { runModel: opts.modelSelection } : {}),
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
    const skillsRouting = rt && rt.routingList().text !== "" ? rt.routingList().text : null;
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
    const faceArgs = {
      mode: opts.mode,
      // 同一个字段喂给规格面（sessionToolFace）与执行面（installAppTools）——两面必须同时摘。
      automationTools: opts.automationTools,
      pluginTools: [...(recall ? [observationRecallSpec] : []), ...(impactTool ? [impactQuerySpec] : []), ...pluginToolSpecsFromRuntime(rt).filter(t => !recall || t.name !== "obs_recall")],
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
      provider: createProvider(promptText, systemPromptFor(opts.mode), modelSelection, {
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
      ...(recall || impactTool
        ? { tools: { ...TOOLS, ...(recall ? { obs_recall: recall } : {}), ...(impactTool ? { impact_query: impactTool } : {}) } }
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
      verify: createVerifyHook(opts.workspace, { exec: verifyExec(opts.sandbox ?? null) }),
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
      const outcome = await runSessionEndDistill({
        enabled: autoMemory && opts.mode !== "read-only" && opts.unattended !== true,
        logPath: opts.logPath,
        workspace: opts.workspace,
        provider: createProvider(promptText, undefined, modelSelection),
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
    if (rtNow) lastPluginSnapshot = rtNow.snapshot();
    await rtNow?.shutdown().catch(() => {});
    // M2e：会话结束摘除本 run 注入的插件工具（TOOLS 是模块级注册表，零残留）
    const table = TOOLS as unknown as Record<string, unknown>;
    for (const n of injectedToolNames) delete table[n];
    setCurrentPluginRuntime(null);
  }
  return await replay(opts.logPath);
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
  /** 已解析好的模型选择（CLI `--model` 自由档专用）。
   *
   *  为什么需要这个槽，而 `RunRequest.model` 不够：那一档的模型名**按定义不在 `DEFAULT_MODEL_TABLE` 里**
   *  （`provider-runtime.ts:112-115` 的注释——表是 bandit 代价项与预算折钱的依据），而
   *  `validateRunRequestEnvelope`（run-request.ts:48）只收已登记的 id。两边都对，所以自由档只能走这里。
   *  缺省 = 走 `resolveRunModel(settings, req.model)`，与本槽存在前逐字相同。 */
  modelSelection?: MainModelSelection;
  /** 装不装 `automation_*` 五件（长驻服务语义）。**不是 settings 开关**——scheduler 初始化与
   *  tick 是进程级的，settings 存一个「装不装工具」既管不住也没法表达（进程已起来了）。
   *  判据只有一个：调用方是不是长驻进程。缺省 true。 */
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
        askGate: over.unattended ? unattendedAskGate : appAskGate,
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

/** goal 事件的唯一出口：落流 + 推事件（带 session_id）。
 *  为什么必须有这个 helper：渲染层按 `e.session_id !== real.id` 把不可归因的事件丢掉，
 *  所以少了这个标记就是「JSONL 里有、live 界面上没有」——用户看不见"为什么不跑了"，
 *  而 replay 又看得见（两路不一致，正是本仓点名的形状）。三处 goal 写入点共用一份。 */
async function emitGoalEvent(logPath: string, sessionId: string | undefined, ev: AgentEvent): Promise<void> {
  await createEventLog(logPath).append(ev);
  hooks.onEvent?.(sessionId !== undefined ? ({ ...ev, session_id: sessionId } as AgentEvent) : ev);
}

/** goal 模式：一次 run 收束后问判据「还要不要再跑一轮」。返回 null = 不再续（没设目标 / 已停 / 被取消）。
 *  停止理由一律落 `goal_stopped` 上屏——「为什么不跑了」必须是用户看得见的事实。 */
async function goalNextTurn(args: {
  logPath: string;
  sessionId?: string;
  /** 无人值守（定时 / schedule 触发的 run）。goal 模式在这条路上被显式拒续，理由见下面的规则。 */
  unattended?: boolean;
  aborted: () => boolean;
  /** 本 run 的模型选择：美元闸的价键由它派生（与拨号同一个数，见 `budgetPriceKeyOf`）。 */
  runModel: MainModelSelection;
}): Promise<{ message: string; origin: GoalTurnOrigin } | null> {
  if (args.aborted()) return null; // 用户已经按停止：不再起新轮（取消是最高优先级，不是预算）
  const events = await replay(args.logPath);
  const view = projectGoal(events);
  if (view === null || view.stopped !== null) return null; // 没设目标 / 已停 ⇒ 逐字零行为
  // #53 的裁决：**无人值守 run 不自动续跑**。这不是保守，是这条路的产出面决定的——
  // unattended 的审批一律 fail-closed 拒（unattendedAskGate）⇒ 写向工具全被拒、verify 必然红，
  // 而判据里「证据 failed」是 **continue** ⇒ 定时任务会一路烧到轮次上限（≤25 轮），
  // 且没有任何一轮可能成功。goal 是「有人在场」的能力：停在这里，并把理由落到流上（芯片与转录都看得见）。
  if (args.unattended) {
    const reason =
      "无人值守 run 不自动续跑：这条路上审批一律 fail-closed 拒 ⇒ 写不了盘、验不出绿，续跑只会白烧钱；" +
      "goal 模式请在有人盯着的会话里用（同一个目标，交互 run 会照常续）";
    await emitGoalEvent(args.logPath, args.sessionId, {
      type: "goal_stopped",
      reason,
      turn: view.turn,
      evidence: view.evidence,
    });
    return null;
  }
  const model = budgetPriceKeyOf(args.runModel);
  // 花费读数交给纯函数（`goalWindowSpend`）：闸要的价键是 provider 模型名（glm-5.2）而价表的键是
  // 档位 id（glm-standard），反查只许有一处（orchestrator-join 的 priceForModel）——那一跳以前躺在这行，
  // 写错就恒 null、闸恒惰，而单测全绿（它们直接注入 spentUsd）。**名字本身**要取自本 run 真拨的那一档
  // （`budgetPriceKeyOf`）：读设置盘字段会在「model 留空」与「per-run 指定档位」下和实付分叉。
  // 表里没有 / 不可知 ⇒ 美元闸惰掉并在提醒块里明写，**绝不**按 $0 继续烧（「把不可知记成免费」）。
  // 计量窗口 = view.window（本目标之后那段），与证据/写盘同轴：设 $0.5 之前会话已花多少与这个闸无关。
  // **worker 那一段用回执里已入账的表价**，不再按会话那一档估：会话档与 worker 档在本仓价表里
  // 差到 40 倍，一乘就把闸与同一屏的回执弄成两个数（能力 39 修的是成本闸，这一支是同一族的第二支）。
  const { spentUsd, unbookedWorkers } = goalWindowSpend(view.window, model);
  const decision = goalStopDecision({
    turn: view.turn,
    spec: view.spec,
    spentUsd,
    evidence: view.evidence,
    wrote: view.wrote,
    truncated: view.truncated,
  });
  if (decision.kind === "done") return null;
  if (decision.kind === "stop") {
    const ev: AgentEvent = { type: "goal_stopped", reason: decision.reason, turn: view.turn, evidence: view.evidence };
    await emitGoalEvent(args.logPath, args.sessionId, ev);
    return null;
  }
  const turn = view.turn + 1;
  return {
    // hint 只有「上一轮被收走」那一支会给；默认那一子句（针对红字继续）在本轮没有红字时会指错方向。
    message: goalReminder(view.spec, turn, spentUsd, view.evidence, decision.hint, unbookedWorkers),
    origin: { kind: "goal", turn, max_turns: view.spec.maxTurns },
  };
}

/** IPC "agent:goal-set"：给某个会话设定/改设目标，或清除它（goal 模式的唯一写入面）。
 *  与在途 run 并发时只做一件事——追加一条 goal_set；续跑判据在 run 结束时才读它，所以中途改设
 *  会自然从下一轮生效（不改写在飞的 run，也不锁住输入框）。
 *  `clear` 不开新事件也不开通道：停 = 追加一条带理由的 `goal_stopped`，而「停过的目标不许被
 *  用户下一条消息复活」这条语义已经有锚点守着，清除于是天然复用终态面。 */
export async function handleGoalSet(req: {
  sessionId?: string;
  objective?: unknown;
  maxTurns?: unknown;
  maxUsd?: unknown;
  clear?: unknown;
}): Promise<{ ok: boolean; error?: string; clamped?: string[] }> {
  try {
    const dir = requireSessionsDir();
    const sessionId = req.sessionId ?? (await store().get()).currentSession;
    if (typeof sessionId !== "string" || sessionId === "") return { ok: false, error: "没有当前会话，目标无处可挂" };
    const logPath = pathOf(dir, sessionId);
    if (req.clear === true) {
      // 新建会话还没落过一行 ⇒ 读日志会 ENOENT。那是"没有目标"，不是文件错误；其余错误照常抛出可见。
      const events = await replay(logPath).catch((err: unknown) => {
        if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return [] as AgentEvent[];
        throw err;
      });
      const view = projectGoal(events);
      if (view === null) return { ok: false, error: "这个会话没有设过目标 ⇒ 无可清除（不补记空停止）" };
      if (view.stopped !== null) return { ok: true }; // 已停：幂等返回，不再落第二条停止
      const stopped: AgentEvent = {
        type: "goal_stopped",
        reason: "用户清除目标 ⇒ 不再自动续跑（还要接着跑就重新设一个目标）",
        turn: view.turn,
        evidence: view.evidence,
      };
      await emitGoalEvent(logPath, sessionId, stopped);
      return { ok: true };
    }
    const parsed = parseGoalSpec({ objective: req.objective, maxTurns: req.maxTurns, maxUsd: req.maxUsd });
    if (parsed.spec === null) return { ok: false, error: parsed.errors.join("；") };
    const ev: AgentEvent = {
      type: "goal_set",
      objective: parsed.spec.objective,
      max_turns: parsed.spec.maxTurns,
      max_usd: parsed.spec.maxUsd,
    };
    await emitGoalEvent(logPath, sessionId, ev);
    return { ok: true, ...(parsed.clamped.length > 0 ? { clamped: parsed.clamped } : {}) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** IPC "agent:decide" 的处理函数（scope: once / session_kind / always，§10.4 审批卡回写）。 */
export function handleAgentDecide(askId: string, approved: boolean, scope?: AskScope): boolean {
  return appAskGate.decide(askId, approved, "user", scope ?? "once");
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
    activeOrchestrator ??
    // 崩溃恢复重派**只在这一支**允许兜底建编排器：重启后内存里的 session/activeOrchestrator 都归零，
    // 少了这一跳，下面那句 emit 守卫会先一步把「重派」挡在「无可用事件管线」上——恢复卡的按钮
    // 恰好在它唯一要用的场景里点不动。其余动作（审批/取消/合并）仍照旧：路由不到就是路由不到，
    // 不替一个已经不在的 worker 现场凭空建一个编排器。
    (req.action === "respawn" && req.cardType === "agent_result" ? await ensureSessionOrchestrator() : null);
  const emit = session?.emit ?? (orch ? (e: AgentEvent) => orch.appendProtocol(e) : null);
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
  };
  await emit(event);
  // ---- M3b：合并控制塔 + 评审闭环（diff 卡动作经同一 card_action 协议；合并唯一出口 = git 面板，§4.3）----
  if (req.action === "merge" && req.targetAgentId && (req.cardType === "diff" || req.cardType === "merge_tower")) {
    const owner = orchestratorForMerge(req.targetAgentId);
    if (!owner) return { ok: false, error: "该 agent 无合并控制塔归属（未知或 worktree 已收尾）: " + req.targetAgentId };
    return await owner.mergeWorker(req.targetAgentId, { force: req.payload?.force === true });
  }
  if (req.action === "reject" && req.targetAgentId && (req.cardType === "diff" || req.cardType === "merge_tower")) {
    const owner = orchestratorForMerge(req.targetAgentId);
    if (!owner) return { ok: false, error: "该 agent 无合并控制塔归属（未知或 worktree 已收尾）: " + req.targetAgentId };
    return await owner.rejectWorker(req.targetAgentId, { keepBranch: req.payload?.keep_branch === true });
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
    await emit({ type: "diff_comment", agent_id: req.targetAgentId, path, line: line as number, body, ts: Date.now() } as AgentEvent);
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
    const r: WorktreeCleanupResult = await cleanOrphanWorktree(ws, name);
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
    const orch = activeOrchestrator ?? (await ensureSessionOrchestrator());
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
  return appClarifyGate.submit(callId, answers);
}

/** IPC "agent:plan" 的处理函数：批准/拒绝当前 plan；决议走会话事件管线落盘并推送 UI（plan 卡状态）。 */
export async function handlePlanDecide(approved: boolean, callId?: string): Promise<boolean> {
  const pending = appPlanGate.pendingIds;
  const target = callId ?? pending[0];
  const ok = approved ? appPlanGate.approve(callId) : appPlanGate.reject(callId);
  if (!ok) return false; // P3（审查）：settle=false（陈旧/重复/未知 callId）不落事件——不造「已批准」假记录
  const s = session;
  if (s?.emit) {
    const event: AgentEvent = { type: "plan_approved", callId: target ?? "", approved };
    await s.emit(event);
  }
  return ok;
}

/** IPC "agent:run-cancel"（P3 审查）：取消当前交互 run——信号沿 runLoop 轮界/门等待/长驻工具透传；
 *  unattended run 不经此通道（取消归 runTimeout/门控）。无活动交互 run → fail-visible。 */
export function handleRunCancel(): { ok: boolean; error?: string } {
  const c = interactiveRunAbort;
  if (!c) return { ok: false, error: "无活动交互 run（取消不可达）" };
  c.abort();
  return { ok: true };
}


/** IPC "agent:state" 的处理函数。 */
export async function handleAgentState(): Promise<{ sandbox: SandboxStatus; memory?: MemorySnapshot; plugins?: PluginPanelSnapshot; sidechat?: SidechatPanelSnapshot; worktree?: { orphans: string[] }; schedule?: ScheduleSnapshot; license?: LicenseState; providerKeys?: { available: boolean; stored: string[]; envActive: boolean }; about?: { version: string } }> {
  let memory: MemorySnapshot | undefined;
  try {
    memory = await memorySnapshot();
  } catch {
    memory = undefined; // 快照失败不阻塞 state（沙箱状态是主应答）
  }
  let plugins: PluginPanelSnapshot | undefined;
  try {
    const rt = currentPluginRuntime();
    plugins = rt ? rt.snapshot() : (lastPluginSnapshot ?? await pluginSnapshotLite());
  } catch {
    plugins = undefined;
  }
  let sidechat: SidechatPanelSnapshot | undefined;
  try {
    sidechat = await handleSidechatState();
  } catch {
    sidechat = undefined;
  }
  // M3b 孤儿 worktree 扫描（§4.4.9：启动/会话重开语义 = state 拉取时现算；只列不自动删）
  let worktree: { orphans: string[] } | undefined;
  try {
    worktree = { orphans: await scanOrphanWorktrees() };
  } catch {
    worktree = undefined;
  }
  // M4a schedule 面板快照（真缺陷修复，半托截图路径抓出：schedule 通道挂了 IPC handler 但从未进 state 应答，
  // 面板 getState().schedule 恒 undefined → 任务列表/运行历史永久为空）
  let schedule: ScheduleSnapshot | undefined;
  try {
    schedule = await handleScheduleSnapshot();
  } catch {
    schedule = undefined;
  }
  // M4b：license 状态（valid/expired/inactive/invalid；未激活 → renderer 引导横幅）与 provider key 状态面
  let license: LicenseState | undefined;
  try {
    license = await handleLicenseStatus();
  } catch {
    license = undefined;
  }
  let providerKeys: { available: boolean; stored: string[]; envActive: boolean } | undefined;
  try {
    providerKeys = await handleProviderKeyStatus();
  } catch {
    providerKeys = undefined;
  }
  return { sandbox: sandboxState, memory, plugins, sidechat, worktree, schedule, license, providerKeys, about: { version: getAppVersion() } };
}

/** M3b 孤儿 worktree 扫描（纯投影面）：.agents/wt-* 目录 − 事件流有终态/收尾记录的 agent。 */
export async function scanOrphanWorktrees(workspace?: string): Promise<string[]> {
  const ws = workspace ?? (await currentWorkspace());
  const dirs = await listWorktreeDirs(ws);
  if (dirs.length === 0) return [];
  const events = lastLogPath ? await replay(lastLogPath).catch(() => []) : [];
  return orphanWorktrees(
    dirs,
    events.map((e) => e as { type: string; agent_id?: string; status?: string; callId?: string }),
  );
}

/** 「此刻这个会话的工作区」的唯一答案：跑过就用最近一次 run 的，没跑过用**用户配置的**
 *  （settings.workspace），两者都没有才落到缺省靶子。
 *  此前有六处各写一份 `getLastWorkspace() ?? WORKSPACE`：一轮都没跑时，插件面板 / 信任决议 /
 *  孤儿 worktree 扫描 / sidechat 全都在扫 fixtures/todo-app，而不是用户真正打开的项目——
 *  面板上列出来的「已信任」可能根本是另一个仓的插件。 */
export async function currentWorkspace(): Promise<string> {
  const last = getLastWorkspace();
  if (last) return last;
  let conf: string | null = null;
  try {
    conf = (await store().get()).workspace;
  } catch {
    conf = null; // headless 脚本未装配 settings ⇒ 与旧行为一致（缺省工作区）
  }
  return conf ?? WORKSPACE;
}

/** M2e run 装配与 M2g 运行间隙决议共用的插件运行时配置（信任文件路径的单一事实源在 PluginRuntime.load）。 */
function pluginRuntimeOpts(workspace: string): Omit<Parameters<typeof PluginRuntime.load>[0], "mode"> {
  return {
    ...(process.env.M2E_USER_PLUGINS ? { userPluginsDir: process.env.M2E_USER_PLUGINS } : {}),
    projectPluginsDir: join(workspace, ".agent", "plugins"),
    ...(process.env.M2E_LOOSE_SKILLS ? { looseRoots: [process.env.M2E_LOOSE_SKILLS] } : {}),
    workspace,
    pluginDataRoot: process.env.M2E_PLUGIN_DATA ?? join(tmpdir(), "m2e-plugin-data"),
    ...(process.env.M2E_TRUST_FILE ? { trustFile: process.env.M2E_TRUST_FILE } : {}),
  };
}

/** 运行间隙的冷快照：还没有 runtime（本进程一轮都没跑过）时也照样发现一次并留档。
 *  少了这一条，插件面板对「装了但从未跑过」的会话永远是空的——而那恰恰是唯一需要看到
 *  「待信任」并授权的时刻（§9.8 未信任不激活：没有列表就没有授权口）。
 *  与 handlePluginDecide 的 lite 分支同款配置、同样是只读发现（不 connectMcp、不跑钩子之外的动作）。 */
async function pluginSnapshotLite(): Promise<PluginPanelSnapshot> {
  const lite = await PluginRuntime.load(pluginRuntimeOpts(await currentWorkspace()));
  try {
    lastPluginSnapshot = lite.snapshot();
    return lastPluginSnapshot;
  } finally {
    await lite.shutdown().catch(() => {});
  }
}

/** IPC "agent:plugin-decide"：信任卡决议（批准/拒绝）→ 决议持久化 + 同样本重新激活（M2e §9.8）。
 *  M2g 收口修复：运行间隙（runtime 已回收）点击不再静默 ok:false——按 run 同款配置做一次轻量
 *  发现 + 决议落信任文件（下次 load 生效），留档快照同步改写（面板徽标即时反映）。 */
export async function handlePluginDecide(pluginName: string, trusted: boolean): Promise<{ ok: boolean; snapshot?: PluginPanelSnapshot }> {
  const rt = currentPluginRuntime();
  if (rt) {
    const found = await rt.trustDecide(pluginName, trusted);
    if (!found) return { ok: false };
    await rt.connectMcp(); // 信任后同样本开始生效（MCP 补连；hook 引擎已在重建后的 runtime 内）
    return { ok: true, snapshot: rt.snapshot() };
  }
  const lite = await PluginRuntime.load(pluginRuntimeOpts(await currentWorkspace()));
  let decided = false;
  try {
    decided = await lite.trustDecide(pluginName, trusted);
  } finally {
    await lite.shutdown().catch(() => {});
  }
  if (!decided) return { ok: false };
  if (lastPluginSnapshot) {
    lastPluginSnapshot = {
      ...lastPluginSnapshot,
      plugins: lastPluginSnapshot.plugins.map((p) => (p.name === pluginName ? { ...p, trust: trusted ? "trusted" : "declined" } : p)),
      // 审查 S2-12（任务 4.6）：散装 skill 走同一出口后，留档快照也要同步改写——否则运行间隙
      // 批准一个 loose skill，面板徽标仍停在「待信任」（rt 在场时走 rt.snapshot() 不受影响）。
      looseSkills: lastPluginSnapshot.looseSkills.map((l) => (l.name === pluginName ? { ...l, trust: trusted ? "trusted" : "declined" } : l)),
    };
  }
  return { ok: true, snapshot: lastPluginSnapshot ?? undefined };
}





// ---- M2f：辅助对话（sidechat）IPC 面 ----
// 独立会话：own JSONL 文件组 + own loop + own 上下文；写向工具从工具表摘除（只读白名单硬闸）。
// 主会话零打扰：sidechat 只读主会话 JSONL，永不 append 它（唯一写主会话的路径是用户显式 /promote）。

/** M2F_SIDECHAT_DEMO 演示剧本（env 门控；缺省零行为）——截图/演示用，不进验收链。
 *  M2g：剧本外置为 fixtures/demo/sidechat-demo.jsonl（冻结 sha 在 scripts/frozen-demo-sha256.json）；
 *  读不到时回退这份内联常量并告警（fail-visible，不静默换剧本）。 */
const SIDECHAT_DEMO_INLINE = [
  {
    type: "assistant_message",
    content:
      "旁路只读调查（不改主会话）：我读了 src/agent/loop.ts 与 src/agent/context.ts。" +
      "结论：runLoop 的上下文来自 projectContext(seen) 投影，压缩只产出 compaction 事件、事件流零删改（loop.ts:67 / context.ts:46）。",
  },
] as Parameters<typeof scriptedSidechatModel>[0];

function sidechatDemoScript(): ReturnType<typeof scriptedSidechatModel> {
  let script: Parameters<typeof scriptedSidechatModel>[0] = SIDECHAT_DEMO_INLINE;
  try {
    const raw = readFileSync(SIDECHAT_DEMO_FIXTURE, "utf8");
    const parsed = raw
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "")
      .map((l) => JSON.parse(l) as Parameters<typeof scriptedSidechatModel>[0][number]);
    if (parsed.length > 0) script = parsed;
  } catch (err) {
    console.warn("[sidechat] 演示剧本读取失败，回退内联常量:", err instanceof Error ? err.message : String(err));
  }
  return scriptedSidechatModel(script);
}

/** 选模型：M0_API_KEY 在场 → GLM（createSidechatProvider 缺省）；演示通道 → 脚本；否则 fail-closed。 */
function resolveSidechatModel(explicit?: SidechatModel): { model?: SidechatModel; error?: string } {
  if (explicit) return { model: explicit };
  if (process.env.M0_API_KEY) return {}; // 缺省 = GLM 暗卷
  if (process.env.M2F_SIDECHAT_DEMO === "1") return { model: sidechatDemoScript() };
  return { error: "无 M0_API_KEY：sidechat 真实模型不可用（fail-closed，可注入脚本模型）" };
}

/** M2g §7.5：sidechat 自身历史压缩用的摘要器（与主会话**同一实现**，参数独立配置）。
 *  M0_API_KEY → GLM；演示通道 → 冻结 mock；都没有 → undefined（走既有 overflow 紧急截断）。 */
function resolveSidechatSummarizer(): ReturnType<typeof createGlmSummarizer> | undefined {
  if (process.env.M0_API_KEY) return createGlmSummarizer();
  if (process.env.M2F_SIDECHAT_DEMO === "1") {
    return createMockSummarizer("## Objective\n- 旁路会话自身历史压缩（演示通道，冻结摘要）。\n");
  }
  return undefined;
}

export async function handleSidechatCreate(parentSessionId: string, name?: string): Promise<{ id: string }> {
  return { id: await createSidechatSession(requireSessionsDir(), parentSessionId, name) };
}

/** 跑一轮 sidechat（own loop）。事件只落 sidechat 自己的 JSONL；主会话文件字节不变。 */
export async function handleSidechatAsk(
  sidechatId: string,
  message: string,
  over: { parentSessionId?: string; model?: SidechatModel; summarizer?: Summarizer; onEvent?: (e: AgentEvent) => void } = {},
): Promise<{ ok: boolean; error?: string; events?: AgentEvent[] }> {
  try {
    const dir = requireSessionsDir();
    const parentId = over.parentSessionId ?? (await store().get()).currentSession ?? "";
    const mainLogPath = parentId !== "" ? pathOf(dir, parentId) : (lastLogPath ?? "");
    const picked = resolveSidechatModel(over.model);
    if (picked.error) return { ok: false, error: picked.error };
    const events = await runSidechatTurn({
      sidechatDir: sidechatDir(dir, sidechatId),
      mainLogPath,
      workspace: await currentWorkspace(),
      message,
      ...(picked.model ? { model: picked.model } : {}),
      ...(over.summarizer ? { summarizer: over.summarizer } : { summarizer: resolveSidechatSummarizer() }),
      onEvent: (e) => over.onEvent?.(e),
    });
    return { ok: true, events };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** /promote：sidechat 结论 → 主会话一条 user_message（带 origin）；过输出扫描。 */
export async function handleSidechatPromote(req: {
  sidechatId: string;
  parentSessionId: string;
  sourceEventIds: number[];
  note?: string;
  content?: string;
}): Promise<{ ok: boolean; error?: string; event?: AgentEvent }> {
  try {
    const dir = requireSessionsDir();
    const mainLogPath = pathOf(dir, req.parentSessionId);
    const res = await promoteToMain({
      mainLogPath,
      sidechatLogPath: sidechatEventsPath(dir, req.sidechatId),
      sidechatId: req.sidechatId,
      sourceEventIds: req.sourceEventIds,
      ...(req.note !== undefined ? { note: req.note } : {}),
      ...(req.content !== undefined ? { content: req.content } : {}),
    });
    if (!res.ok) return { ok: false, error: res.error };
    // 上屏：主会话活流（renderer 渲染为 promote 卡）
    if (res.event) hooks.onEvent?.(res.event);
    return { ok: true, event: res.event };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** sidechat 面板快照（纯投影）：会话清单 + 各自最近消息 + 已提升记录（由主会话 origin 反向投影）。 */
export async function handleSidechatState(parentSessionId?: string): Promise<SidechatPanelSnapshot> {
  const dir = getSessionsDir();
  if (!dir) return { parentSessionId: null, sessions: [], promoted: [] };
  const parent = parentSessionId ?? (await store().get()).currentSession ?? null;
  const infos = await listSidechatSessions(dir, parent ?? undefined);
  const sessions = [] as SidechatPanelSnapshot["sessions"];
  for (const info of infos) {
    let events: AgentEvent[] = [];
    try {
      events = await readSidechatEvents(dir, info.id);
    } catch {
      events = [];
    }
    const messages: SidechatPanelSnapshot["sessions"][number]["messages"] = [];
    let usage = { inputTokens: 0, outputTokens: 0, usageCount: 0, compactionCount: 0 };
    events.forEach((e, i) => {
      if (e.type === "user_message") messages.push({ eventId: i + 1, role: "user", text: e.content });
      else if (e.type === "assistant_message") messages.push({ eventId: i + 1, role: "assistant", text: e.content });
      else if (e.type === "usage") {
        usage.inputTokens += e.inputTokens;
        usage.outputTokens += e.outputTokens;
        usage.usageCount++;
      } else if (e.type === "compaction") usage.compactionCount++;
    });
    sessions.push({ id: info.id, parentId: info.parentId, lines: info.lines, mtimeMs: info.mtimeMs, messages, usage });
  }
  // 已提升：主会话里带 origin 的 user_message（反向投影，零新增事件类型）
  const promoted: SidechatPanelSnapshot["promoted"] = [];
  if (parent) {
    try {
      const mainEvents = await readSessionEvents(dir, parent);
      mainEvents.forEach((e, i) => {
        // 只投影 sidechat 提升记录；goal 续跑轮不是"提升"，它的面在 goal 芯片里。
        if (e.type === "user_message" && e.origin?.kind === "sidechat") {
          promoted.push({
            eventId: i + 1,
            sessionId: e.origin.session_id,
            sourceEventIds: e.origin.source_event_ids,
            ...(e.origin.note !== undefined ? { note: e.origin.note } : {}),
          });
        }
      });
    } catch {
      /* 主会话不存在：无已提升记录 */
    }
  }
  return { parentSessionId: parent, sessions, promoted };
}

/** M2F_SIDECHAT_DEMO=1：主 run 收束后跑 3 轮 sidechat + 一次 promote（截图/演示通道，缺省零行为）。 */
async function runSidechatDemo(sessionId: string | undefined, parentLogPath: string, pipeline: (e: AgentEvent) => Promise<void>): Promise<void> {
  try {
    const dir = requireSessionsDir();
    const parentId = sessionId ?? (await store().get()).currentSession ?? "demo";
    const id = await createSidechatSession(dir, parentId, "旁路调查");
    const questions = [
      "主会话现在在改哪个文件？",
      "压缩之后上下文是怎么重组的？",
      "总结一句可提升的结论。",
    ];
    for (const q of questions) {
      await handleSidechatAsk(id, q, { parentSessionId: parentId, model: sidechatDemoScript() });
    }
    const events = await readSidechatEvents(dir, id);
    const lastAssistant = [...events.keys()].filter((i) => events[i].type === "assistant_message").pop();
    if (lastAssistant !== undefined) {
      const res = await promoteToMain({
        mainLogPath: parentLogPath,
        sidechatLogPath: sidechatEventsPath(dir, id),
        sidechatId: id,
        sourceEventIds: [lastAssistant + 1],
        note: "旁路结论提升（演示）",
      });
      if (res.ok && res.event) await pipeline(res.event);
    }
  } catch (err) {
    console.warn("[sidechat] 演示通道失败:", err instanceof Error ? err.message : String(err));
  }
}

// ---- 公开面（拆分后不变）：以下实现住在轻模块里，本文件按原路径继续导出 ----
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
