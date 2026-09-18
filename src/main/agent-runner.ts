// main 进程的 agent 接线：IPC "agent:run" 暴露的同一入口（handleAgentRun），不经 UI 也可直调（ipc:check）。
// 工具门：冻结的 runLoop 对 ask 一律拒绝（gate 非 allow 即 deny），因此 loop 固定走 auto 档，
// 真实门在本模块的工具包装里 —— 复用 src/permissions 的 checkPermission，语义与 M0 一致：
// read-only 拒副作用 / default 询问（UI 批准才执行）/ auto 放行；沙箱不可用时写工具强制逐条审批。
import { readFileSync } from "node:fs";
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
} from "../agent/glm-session";
import { ClarifyGate, PlanGate } from "../agent/gates";
import { createVerifyHook, defaultExec, type ExecFn } from "../agent/verify";
import { createActionFusion } from "../agent/action-fusion";
import { SolpiRuntime, privateSessionDirectory, removePrivateSessionData, observationRecallSpec, solpiEnabled, type SolpiFlags } from "../agent/solpi-runtime";
import { defaultImpactHook } from "../agent/impact/index.js";
import { run_shell } from "../tools/run_shell";
import type { AgentEvent, ClarifyAnswerMap, EventLog } from "../events";
import { createEventLog, replay } from "../events";
import { checkPermission, enterPlanRunScope, getPlanState, type PermissionMode } from "../permissions";
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
  type AskScope,
  type PermissionRule,
  type ToolResultWithAudit,
} from "../permissions";
import { globalPermissionsPath, savePermissionRules } from "../permissions/rules";
import { SettingsStore, type AppSettings, type ProviderKind } from "./settings";
import {
  createSession,
  deleteSession,
  listSessions,
  pathOf,
  readSessionEvents,
  renameSession,
  sessionExists,
  createSidechatSession,
  listSidechatSessions,
  readSidechatEvents,
  sidechatDir,
  sidechatEventsPath,
  type SessionInfo,
} from "./sessions";
import { createMockProvider } from "../providers/mock";
import { streamGlm } from "../providers/glm";
import type { ModelOutput, Provider } from "../providers";
import { TOOLS, type Tool, type ToolResult } from "../tools";
import { remember } from "../tools/remember";
import type { ToolName } from "../tools/base";
import {
  initMemoryHome,
  globalMemoryDir,
  listTopics,
  loadExternalRefState,
  projectMemoryDir,
  readTextOrNull,
  deleteTopic,
  type TopicEntry,
} from "../agent/memory/store";
import { runSessionEndDistill } from "../agent/memory/distill";
export { initMemoryHome } from "../agent/memory/store"; // shell 启动时注入 userData/memory
import { extractExternalRefs } from "../agent/memory/inject";
import type { MemoryLayerSnapshot, MemorySnapshot } from "./ipc-protocol";
import { AskGate } from "./ask-gate";
import type { AskOutcomePayload, AskPayload, RunRequest, SidechatPanelSnapshot } from "./ipc-protocol";
import { buildSandboxProfile, checkSandbox, runInSandbox, type SandboxStatus } from "./sandbox";
import { PluginRuntime, setCurrentPluginRuntime, currentPluginRuntime, type PluginPanelSnapshot } from "../agent/plugins";
import type { HookEngine } from "../agent/plugins/hooks";
import type { McpToolInfo } from "../agent/plugins/mcp";
import { Scheduler, type ScheduleSnapshot, type TriggerExecutor } from "./scheduler";
import { validateAutomation, isUnattendedTier } from "./automations";
import {
  deleteProviderKey,
  providerKeyStatus,
  putProviderKey,
} from "./provider-keys";
import { verifyLicenseFile, type LicenseState } from "./license";
import { checkUpdate, type UpdateCheckResult } from "./updater";
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
import { interruptedWorkers, respawnArgsFrom, type RespawnArgs } from "../agent/recovery";
import { buildSecurityReport } from "../agent/security/scan";
import {
  listWorktreeDirs,
  orphanWorktrees,
  cleanOrphanWorktree,
  type WorktreeCleanupResult,
} from "../agent/worktree";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WORKSPACE = join(ROOT, "fixtures", "todo-app");
const MOCK_FIXTURE = join(ROOT, "fixtures", "mock", "todo-fix.jsonl");
// M1b 三门演示通道：M1B_GATE_FLOW=1 时用 fixtures/gate/gate-flow.jsonl 驱动（clarify/plan 卡片真人交互）。
// env 门控缺省关闭，M0 事件流字节不变。
const GATE_FIXTURE = join(ROOT, "fixtures", "gate", "gate-flow.jsonl");
// M2g 任务 6：演示通道剧本外部化（fixtures/demo/**，带冻结 sha 于 scripts/frozen-demo-sha256.json；
// **独立**于判卷区 frozen-sha256.json）。缺省零行为不变；显式给路径的旧用法保留。
const DEMO_DIR = join(ROOT, "fixtures", "demo");
const LSP_DEMO_FIXTURE = join(DEMO_DIR, "lsp-demo.jsonl");
const SIDECHAT_DEMO_FIXTURE = join(DEMO_DIR, "sidechat-demo.jsonl");
// 坑三：Seatbelt 下 pnpm 起不来（依赖检查失败）。冻结剧本里的 run_shell 命令是 "pnpm test"（sha 不可改），
// 沙箱内映射为坑三实测可用的直连命令；TMPDIR 由 runInSandbox 指到工作区内 .tmp。
const VITEST_DIRECT =
  'node "' + join(ROOT, "node_modules", "vitest", "vitest.mjs") + '" run --pool=threads';

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
// M2d：最近一次 run 的工作区（记忆快照的项目层根；缺省 = 默认靶工作区）。
let lastWorkspace: string | null = null;
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

/** M3c 编排器扩展接线（agentRoleFor / workerSummarizer / budget）：runAgent 与会话重派共用同一口径。
 *  - agentRoleFor：插件 agent 角色解析（stages[].role = "plugin-name:agent-name"，§9.6/§9.11-4）；
 *  - workerSummarizer：worker 压缩摘要器（§7.5 同一 runCompaction 链；GLM 暗卷需 M0_API_KEY）；
 *  - budget：会话成本闸（§4.4.8 maxBudgetUsd；0 = off 零行为）。 */
async function orchestratorExtras(): Promise<
  Pick<OrchestratorOptions, "agentRoleFor" | "workerSummarizer" | "budget" | "routing" | "banditStatePath">
> {
  const s = await store().get();
  return {
    agentRoleFor: (invoke: string) => currentPluginRuntime()?.findAgentRole(invoke) ?? null,
    ...(process.env.M0_API_KEY ? { workerSummarizer: createGlmSummarizer() } : {}),
    ...(s.maxBudgetUsd > 0 ? { budget: { maxUsd: s.maxBudgetUsd, pricePerMTok: s.budgetPricePerMTok } } : {}),
    // M5b 步骤 9：routingBandit 开关同时开启路由与学习状态持久化（bandit 蕴含 routing——
    // 无路由则无档位决策可学）。状态文件在 .agent/ 系统区（同 permissions.json 口径）。
    ...(s.routingBandit
      ? { routing: true, banditStatePath: join(ROOT, ".agent", "routing-bandit.json") }
      : {}),
  };
}

/** M3c 会话编排器兜底（崩溃恢复「重派」路径）：run 间隙无 activeOrchestrator 时按会话现状建一个
 *  （同 logPath/workspace/档位；emit = 落盘 + UI 推送同路），保证恢复卡按钮真实可达。 */
async function ensureSessionOrchestrator(): Promise<Orchestrator | null> {
  if (activeOrchestrator) return activeOrchestrator;
  const logPath = lastLogPath;
  if (!logPath) return null;
  const log = createEventLog(logPath);
  const orch = new Orchestrator({
    logPath,
    workspace: lastWorkspace ?? WORKSPACE,
    parentMode: (await store().get()).mode,
    emit: async (e: AgentEvent) => {
      await log.append(e);
      hooks.onEvent?.(e);
    },
    safeMode: await resolveSafeMode(),
    ...(await orchestratorExtras()),
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

function denied(name: ToolName | string, mode: PermissionMode, why: string): ToolResult {
  return { ok: false, output: "[permission denied] " + name + " 在 " + mode + " 档下被门拒绝（" + why + "）" };
}

function gatedTool(name: "write_file" | "edit_file" | "run_shell", original: Tool, beforeExecute?: () => Promise<ToolResult | null>): Tool {
  return {
    name,
    async run(args, ctx) {
      const s = currentSession();
      if (!s) return denied(name, "default", "工具门未接线（fail-closed）");
      // M1c：四层评估管线（deny 规则 → ask 规则 → 档位 → 风险）；方案门状态每次刷新进 session 入参
      const ps = getPlanState();
      s.autonomy.planBlocked = ps.proposed && !ps.approved;
      // M1e 设置页「产出代码安全模式」最小语义（§11.6）：gate = 写向工具在管线之前强制审批
      //（setSettings 转发 M1E_SAFE_MODE；src/permissions 冻结，最小接线在本模块）
      if (process.env.M1E_SAFE_MODE === "gate") {
        if (!s.askGate) return denied(name, s.autonomy.mode, "安全模式 gate 非交互（fail-closed）");
        const gateR = await s.askGate.request(name, args, { reason: "安全模式 gate：写工具强制审批", risk: "none", signal: ctx.signal });
        if (gateR.outcome !== "approved") return denied(name, s.autonomy.mode, "安全模式 gate 未批准");
      }
      const d = evaluate(name, args, s.autonomy);
      if (d.verdict === "deny") return denied(name, s.autonomy.mode, d.reason);
      if (d.verdict === "ask") {
        if (!s.askGate) return denied(name, s.autonomy.mode, "非交互模式（fail-closed）");
        const r = await s.askGate.request(name, args, {
          reason: d.reason,
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
          return denied(name, s.autonomy.mode, r.reason === "unattended" ? "无人值守 fail-closed：审批请求自动拒绝" : "未获批准");
        }
        // scope 回写（§10.4）：网络类命令强制 once（出网审计，scope 不放行）
        const effScope: AskScope = isNetworkCommandCall(name, args) ? "once" : r.scope;
        if (effScope === "session_kind") {
          (s.autonomy.sessionScopes as Set<string>).add(scopeKey(name, args));
        } else if (effScope === "always") {
          await persistAlwaysRule(ctx.workspace, name, args);
        }
        if (d.risk === "critical") noteCriticalResolved(s.autonomy);
        noteManualDecision(s.autonomy);
      } else if (d.auto?.source === "session_scope") {
        noteScopeApproval(s.autonomy); // 断路器计数（连续 scope 自动放行）
      }
      // Internal fusion callback, never a model argument: revalidate after approval (which may wait).
      if (beforeExecute) {
        const blocked = await beforeExecute();
        if (blocked) return blocked;
      }
      if (name === "run_shell" && s.sandbox !== null && s.sandbox.available) {
        const command = typeof args.command === "string" ? args.command : "";
        const mapped = command.trim() === "pnpm test" ? VITEST_DIRECT : command;
        if (beforeExecute) {
          // runInSandbox has no cancellation input. Reuse its profile, but launch via the existing
          // run_shell process-group/cancellation path; approval above evaluated the original lint.
          const tmp = join(await realpath(ctx.workspace), ".tmp");
          await mkdir(tmp, { recursive: true });
          if (ctx.signal?.aborted) return { ok: false, output: "cancelled before sandbox lint" };
          const quote = (s: string): string => "'" + s.replace(/'/g, "'\\''") + "'";
          const command = `TMPDIR=${quote(tmp)} exec /usr/bin/sandbox-exec -p ${quote(buildSandboxProfile(ctx.workspace))} bash -c ${quote(mapped)}`;
          return await original.run({ command }, ctx);
        }
        return await runInSandbox(mapped, { cwd: ctx.workspace });
      }
      let result = await original.run(args, ctx);
      if (name !== "run_shell" && result.ok && s.actionFusion) {
        result = await s.actionFusion(result, args.path, ctx);
      }
      // 自动放行审计（§11.7.5）：{source, rule_id} 进 tool_result 元数据（loop 透传，零新事件类型）
      const audit = d.verdict === "approve" ? d.auto : undefined;
      return (audit ? { ...result, auto: audit } : result) as ToolResultWithAudit;
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
      const ps = getPlanState();
      s.autonomy.planBlocked = ps.proposed && !ps.approved;
      const d = evaluate(name as ToolName, args, s.autonomy); // MCP scoped 名进同一管线（规则/风险/档位全生效）
      if (d.verdict === "deny") return denied(name, s.autonomy.mode, d.reason);
      if (d.verdict === "ask") {
        if (!s.askGate) return denied(name, s.autonomy.mode, "非交互模式（fail-closed）");
        const r = await s.askGate.request(name, args, {
          reason: d.reason,
          risk: d.risk,
          riskReasons: d.riskReasons,
          // 审查待确认第 4 条（任务 4.3）：门侧早已支持 ctx.signal（D12），但调用侧没传 =>
          // run 取消后审批卡驻留到 60s 超时才收，会话/worker 在中间一直挂着。接上运行信号：
          // 取消即按拒绝收束（pending 同步出表，notifyOutcome 记 user）。gatedTool 与
          // gatedMcpTool 两处同形，一并接线。
          signal: ctx.signal,
        });
        if (r.outcome !== "approved") return denied(name, s.autonomy.mode, "未获批准");
        noteManualDecision(s.autonomy);
      } else if (d.auto?.source === "session_scope") {
        noteScopeApproval(s.autonomy);
      }
      void ctx;
      const res = await rt.mcp.callTool(info.plugin, info.server, info.name, args);
      return { ok: res.ok, output: res.output };
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
        return rt.triggerSkill(name);
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
        properties: { name: { type: "string", description: "skill 调用名（/plugin:name 或 /name）" } },
        required: ["name"],
      },
    });
  }
  for (const [scoped, info] of rt.mcpTools) {
    out.push({ name: scoped, description: info.description, parameters: info.inputSchema });
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

/** 对一份会话日志执行手动压缩（trigger=manual, reason=user_request）。
 *  emit = 会话管线（落盘+推送同路，M1b 坑十八口径）；缺省直接落盘（headless/脚本）。 */
export async function compactSessionLog(
  logPath: string,
  emit?: (e: AgentEvent) => Promise<void>,
  hooks?: HookEngine,
): Promise<{ ok: boolean; error?: string; event?: AgentEvent; cardPayload?: Record<string, unknown> }> {
  const events = await replay(logPath);
  if (events.length === 0) return { ok: false, error: "会话为空，无可压缩" };
  // M2e：PreCompact hook（压缩前触发；失败只告警不阻断压缩）
  if (hooks) {
    try {
      await hooks.run("PreCompact", { event: "PreCompact", trigger: "compact" });
    } catch (err) {
      console.warn("[hooks] PreCompact 失败:", err instanceof Error ? err.message : String(err));
    }
  }
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

/** IPC "agent:compact" 的处理函数：手动 /compact 入口（preload 暴露待追认，见 BLOCKED.md）。 */
export async function handleCompact(
  over: { logPath?: string } = {},
): Promise<{ ok: boolean; error?: string; cardPayload?: Record<string, unknown> }> {
  const logPath = over.logPath ?? lastLogPath;
  if (!logPath) return { ok: false, error: "无会话日志（先跑一轮会话再 /compact）" };
  const res = await compactSessionLog(logPath, async (e) => Promise.resolve(hooks.onEvent?.(e)), currentPluginRuntime()?.hooks);
  return { ok: res.ok, error: res.error, cardPayload: res.cardPayload };
}

let installed = false;
/** M2d：remember 门语义（可测工厂）：方案门写禁 / read-only 拒 / default 逐次审批 / auto 放行。
 *  §8.1.4「remember 属写动作走权限门」；无权限 → ok:false 且不落盘。 */
export function createGatedRemember(deps: {
  getMode(): PermissionMode;
  isPlanBlocked(): boolean;
  /** default 档的审批口；缺省 = 非交互 fail-closed 拒绝。 */
  getAsk(): ((args: Record<string, unknown>) => Promise<boolean>) | undefined;
}): Tool {
  return {
    name: "remember",
    async run(args, ctx) {
      if (deps.isPlanBlocked()) return denied("remember", deps.getMode(), "存在未批准 plan（方案门：先批后写）");
      const mode = deps.getMode();
      if (mode === "read-only") return denied("remember", mode, "只读档拒写向工具");
      if (mode === "default") {
        const ask = deps.getAsk();
        if (!ask) return denied("remember", mode, "非交互模式（fail-closed）");
        if (!(await ask(args))) return denied("remember", mode, "未获批准");
      }
      return await remember.run(args, ctx);
    },
  };
}
/** 一次性把 TOOLS 里的写工具换成带门 + 沙箱的包装（runLoop 直接读 TOOLS，无注入点）。 */
export function installAppTools(): void {
  if (installed) return;
  installed = true;
  TOOLS.write_file = gatedTool("write_file", TOOLS.write_file);
  TOOLS.edit_file = gatedTool("edit_file", TOOLS.edit_file);
  TOOLS.run_shell = gatedTool("run_shell", TOOLS.run_shell);
  // M2d：remember 运行时注入（静态注册表冻结为 9 工具，tools-check 判据）
  (TOOLS as unknown as Record<string, Tool>).remember = createGatedRemember({
    getMode: () => currentSession()?.autonomy.mode ?? "default",
    isPlanBlocked: () => {
      const ps = getPlanState();
      return ps.proposed && !ps.approved;
    },
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
  (TOOLS as unknown as Record<string, Tool>).spawn_agent = {
    name: "spawn_agent",
    async run(args, ctx) {
      const orch = currentOrchestrator();
      if (!orch) return { ok: false, output: "spawn_agent: 编排器未接线（fail-closed）" };
      return await orch.spawn(args as SpawnArgs, { callId: ctx.callId });
    },
  };
  // M4a：agent 工具五件（§12.2.5）——automation_create/update/delete/run_now/list。
  // 一切变更走审批卡（§10.4）；prompt 是持久化攻击面：4k 上限（校验拒）+ 审批卡全文展示（args 原样进审批卡）；
  // workspace-write 及以上档位 → 审批卡红字「将无人值守执行」（§12.2.5）；调度器未初始化 = fail-closed。
  installAutomationTools();
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
      if (sessionsDir && cur) await createEventLog(pathOf(sessionsDir, cur)).append(e);
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

export async function handleScheduleSnapshot(): Promise<ScheduleSnapshot> {
  if (!scheduler) return { tasks: [], history: [], running: 0, queued: 0, cap: scheduleCapCache, startupDone: false };
  return await scheduler.snapshot();
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

/** 自检沙箱（app 启动时 / 检查脚本入口调用）。 */
export async function initSandbox(): Promise<void> {
  sandboxState = await checkSandbox();
}

/** M7 影响面：写工具成功后回注跨文件波及（护栏能力，显式开启，默认关闭——与 actionFusion 同族）。 */
export interface ImpactOptions {
  impactAnalysis?: boolean;
}

export interface RunOptions extends SolpiFlags, ImpactOptions {
  workspace: string;
  message: string;
  mode: PermissionMode;
  logPath: string;
  /** M1e：会话模式 —— 日志 append 到既有会话（不 rm）。缺省 false（旧行为：fresh 日志）。 */
  sessionId?: string;
  onEvent?: (e: AgentEvent) => void;
  /** 缺省 = 非交互（ask 按 deny，fail-closed，与 M0 一致）。 */
  askGate?: AskGate;
  /** 缺省 = 不做沙箱包裹。 */
  sandbox?: SandboxStatus | null;
  /** M4a 无人值守（§12.2.4）：会话尾自动沉淀跳过（审批必被拒 = 纯噪音）；审批门由调用方给 unattended 门。 */
  unattended?: boolean;
  /** M4a 超时闸一：取消信号（loop 轮界收束，§4.4.8 AbortController 同族）。 */
  signal?: AbortSignal;
  /** C1: opt-in main-run write/edit + configured lint; never forwarded to workers. */
  actionFusion?: boolean;
}

/** 主对话 provider 档位解析：env 覆盖优先（既有 check/演示脚本依赖），否则读 settings。
 *  P-1 步骤 2：此前全仓无人写 M0A_PROVIDER ⇒ 打包后的主对话恒走冻结剧本；档位进 settings 后
 *  设置页/用户配置才真正可选中真实通道。 */
export async function resolveProviderKind(): Promise<ProviderKind> {
  const env = process.env.M0A_PROVIDER;
  if (env === "glm") return "glm";
  if (env === "demo" || env === "mock") return "demo";
  return (await store().get()).provider;
}

/** 真实通道缺 key 的显式失败（不静默回落 mock——静默回落会让用户以为在用真模型）。 */
function assertRealProviderReady(kind: ProviderKind): void {
  if (kind !== "glm") return;
  if (process.env.M0_API_KEY) return;
  throw new Error(
    "provider=glm 但未配置 API key（BYOK / M0_API_KEY 缺失）：真实模型通道不可用。" +
      "请先在设置页配置 key，或把 provider 切回 demo（冻结剧本，显式演示档）——不静默回落 mock。",
  );
}

// 主 GLM 会话按日志逐轮组装；显式演示通道和 demo 档保持兼容。
// 未传 sessionOptions 的分支仅供会话尾沉淀，消费调用方组装的消息。
function createProvider(userMessage: string, systemPrefix?: string, sessionOptions?: Pick<RunOptions, "logPath" | "workspace" | "mode"> & {
  emit: (event: AgentEvent) => Promise<void>;
  plugins?: NonNullable<Parameters<typeof createGlmSessionProvider>[1]>["plugins"];
  /** 运行时注入的插件/MCP 工具规格（与可执行面同源，见 sessionToolSpecs）。 */
  pluginTools?: readonly SessionPluginTool[];
  solpi?: SolpiRuntime;
}, kindOverride?: ProviderKind, modelOverride?: string): Provider {
  // M1c 明卷通道：M1C_AUTONOMY_SCRIPT 指向冻结剧本（autonomy-check 三条路径复用同一接线）。
  const autonomyScript = process.env.M1C_AUTONOMY_SCRIPT;
  // M3a 演示通道：M3A_MAIN_SCRIPT 指定主剧本（显式路径优先）；M3A_AGENTS_DEMO=1 → main-demo.jsonl
  //（spawn_agent 闭环演示）。worker 模型经 loadDemoWorkerModels 从 fixtures/agents 装载。
  if (process.env.M3A_MAIN_SCRIPT) return createMockProvider(resolve(process.env.M3A_MAIN_SCRIPT));
  if (process.env.M3A_AGENTS_DEMO === "1") return createMockProvider(join(ROOT, "fixtures", "agents", "main-demo.jsonl"));
  if (process.env.M1B_GATE_FLOW === "1") return createMockProvider(GATE_FIXTURE);
  if (autonomyScript) return createMockProvider(autonomyScript);
  // M2a 截图通道：M2A_LSP_DEMO 指向演示剧本（write_file → 真实诊断回流管线），缺省零行为。
  // M2g：M2A_LSP_DEMO=1 → 剧本取 fixtures/demo/lsp-demo.jsonl（显式路径仍可覆盖）。
  if (process.env.M2A_LSP_DEMO) {
    return createMockProvider(process.env.M2A_LSP_DEMO === "1" ? LSP_DEMO_FIXTURE : process.env.M2A_LSP_DEMO);
  }
  const kind = kindOverride ?? (process.env.M0A_PROVIDER === "glm" ? "glm" : "demo");
  if (kind !== "glm") return createMockProvider(MOCK_FIXTURE);
  assertRealProviderReady(kind);
  if (sessionOptions) {
    const { specs, skipped } = sessionToolSpecs({
      mode: sessionOptions.mode,
      pluginTools: sessionOptions.pluginTools ?? [],
    });
    if (skipped.length > 0) {
      // 同名冲突是配置问题，不静默丢：可见告警（基础工具优先，插件规格不进模型面）
      console.warn("[tools] 插件/MCP 工具名与基础工具同名，已跳过注入:", skipped.join(", "));
    }
    return createGlmSessionProvider(sessionOptions.logPath, {
      system: systemPrefix,
      workspace: sessionOptions.workspace,
      tools: specs,
      compaction: {},
      emit: sessionOptions.emit,
      plugins: sessionOptions.plugins,
      solpi: sessionOptions.solpi,
      ...(modelOverride ? { model: modelOverride } : {}),
    });
  }
  return {
    stream(messages, _tools, call) {
      return streamGlm(
        messages,
        modelOverride ? { model: modelOverride } : {},
        gateToolSpecs().filter((spec) => spec.function.name === "remember"),
        call,
      );
    },
  };
}

// verify 执行器：沙箱可用时命令走 Seatbelt（坑三：pnpm 映射为直连 vitest），否则直跑。
function verifyExec(sandbox: SandboxStatus | null): ExecFn {
  if (!sandbox?.available) return defaultExec;
  return async (command, cwd) => {
    const mapped = command.trim() === "pnpm test" || command.trim() === "pnpm run test" ? VITEST_DIRECT : command;
    const res = await runInSandbox(mapped, { cwd });
    return { command, ok: res.ok, output: res.output };
  };
}

/** 核心：mock（或演示通道）驱动跑一轮 loop；每条事件先落 JSONL 再回调。返回完整事件流。
 *  M1b：接线三门 —— clarify/plan 通道（挂起等人）+ verify 反射循环钩子。 */
const liveRunPaths = new Set<string>();
const sessionOrchestrators = new Map<string, Orchestrator>();
const deletingSessionPaths = new Set<string>();
export async function runAgent(opts: RunOptions): Promise<AgentEvent[]> {
  installAppTools();
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
    }),
  };
  if (interactive) session = sessionObj;
  const runAbort = new AbortController(); // P3（审查）：交互 run 取消入口（handleRunCancel 经 IPC 触达）
  const signal = opts.signal ? AbortSignal.any([opts.signal, runAbort.signal]) : runAbort.signal;
  if (interactive) interactiveRunAbort = runAbort;
  lastWorkspace = opts.workspace;
  const runScope: RunScope = { session: sessionObj, orchestrator: null };
  runScopeALS.enterWith(runScope); // 本 run 整条异步链（loop await / 门等待 / 工具执行）都在 scope 内
  enterPlanRunScope(); // P1（审查）：plan 门状态随 run 隔离——并发 run 互不污染（permissions ALS）
  // M2e：本 run 注入统一注册表的插件工具名（会话结束摘除，零残留）；声明在 try 外防 finally TDZ
  let injectedToolNames: string[] = [];
  if (liveRunPaths.has(resolve(opts.logPath)) || deletingSessionPaths.has(resolve(opts.logPath))) throw new Error("session already running or being deleted");
  liveRunPaths.add(resolve(opts.logPath));
  let log: EventLog | undefined;
  let solpi: SolpiRuntime | undefined;
  let parentFinished = false;
  let eventQueue: Promise<void> = Promise.resolve();
  try {
    // M1e 会话模式：sessionId 在场 = 会话列表里的既有会话，append（JSONL 即会话，重放无损）；
    // 无 sessionId = 旧行为（每轮新日志，e2e/ipc-check 等脚本路径字节不变）。
    if (!opts.sessionId) await rm(opts.logPath, { force: true });
    lastLogPath = opts.logPath; // /compact（handleCompact）缺省压缩对象
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
    const orchestrator = new Orchestrator({
      logPath: opts.logPath,
      workspace: opts.workspace,
      parentMode: opts.mode,
      emit: pipeline,
      // P0-2（审查）：父 run 的规则库与沙箱可用性必须传给编排器——worker 自主会话按父 run
      // 口径构造，否则项目级 deny/ask 规则对 worker 全表失效。
      rules,
      sandboxAvailable: opts.sandbox ? opts.sandbox.available : null,
      safeMode: await resolveSafeMode(), // M3b §11.6：off 不跑 / report 只标 / gate 红标 + 二次确认
      ...(await orchestratorExtras()), // M3c：插件角色 / worker 压缩摘要器 / 成本闸
      ...(demoModelFor ? { modelFor: demoModelFor } : {}),
    });
    runScope.orchestrator = orchestrator;
    sessionOrchestrators.set(resolve(opts.logPath), orchestrator);
    if (interactive) activeOrchestrator = orchestrator; // H3 D-2：unattended 不抢交互面的审批路由
    // M2e：插件运行时（会话启动静态扫描产加载清单，不新增事件类型）。
    // 零插件环境（无 .agent/plugins、无 M2E_USER_PLUGINS/M2E_LOOSE_SKILLS）= 空清单 = 零行为。
    let rt: PluginRuntime | null = null;
    try {
      rt = await PluginRuntime.load({ ...pluginRuntimeOpts(opts.workspace), mode: opts.mode });
      setCurrentPluginRuntime(rt);
      await rt.connectMcp(); // 仅受信插件；pending/declined 不连接（§9.8 信任门）
      injectedToolNames = installPluginTools(rt);
    } catch (err) {
      console.warn("[plugins] 运行时装载失败，零插件降级:", err instanceof Error ? err.message : String(err));
      rt = null;
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
        const ups = await rt.hooks.run("UserPromptSubmit", { event: "UserPromptSubmit", prompt: opts.message });
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
    // P-1 步骤 2：主对话 provider 档位与模型（settings 为准；M0A_PROVIDER / M0_MODEL env 仍是覆盖通道）。
    const providerKind = await resolveProviderKind();
    const settingsModel = (await store().get()).model;
    // H3-P4（编排提示词审查 §一）：生产主会话必须有基座系统提示词——此前只有插件路由 + hook 上下文，
    // 模型在撞墙前不知道墙存在（机制成本已付、收益只兑现一半），验收暗卷脚本反而比生产多了角色说明。
    const BASE_SYSTEM = [
      "你是 M0 桌面编程 agent：在指定工作区内读代码、改代码、跑测试、交付结果。",
      "纪律：",
      "1) 任务有歧义先调用 clarify 提问（1–4 问），不要猜；",
      "2) 写/改文件前先 propose_plan 提交方案并等批准（未批准的写操作会被权限层拒绝）；",
      "3) 修改完成后调用 verify 跑测试；verify 通过后用一句话收尾；",
      "4) 只改任务需要的文件，不改测试与判卷文件。",
      "机制边界（撞墙时读报错原因调整策略，不要原样重试）：",
      "- 子代理不能再 spawn 子代理（深度恒 1），spawn 并发有上限；write worker 的合并/提交唯一出口是用户侧 git 面板；",
      "- deny 规则与 critical 风险的强制审批不可绕过；会话成本超限会拒绝新 spawn；长时间无进展会被暂停等待恢复指令；",
      "- 权限被拒 → 换合规路径或先提交方案；测试失败 → 按失败信息修复后重跑 verify。",
    ].join("\n");
    const recall = solpi?.recallTool(async (args, recallSignal) => {
      const ps = getPlanState();
      sessionObj.autonomy.planBlocked = ps.proposed && !ps.approved;
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
    await runLoop({
      ...(impactHook ? { impact: impactHook } : {}),
      provider: createProvider(opts.message, BASE_SYSTEM, {
        ...opts, emit: pipeline, solpi,
        pluginTools: [...(recall ? [observationRecallSpec] : []), ...pluginToolSpecsFromRuntime(rt).filter(t => !recall || t.name !== "obs_recall")],
        ...(rt ? { plugins: {
          skillsRouting: skillsRouting ?? undefined,
          hookContext,
          deriveRemount: (events: AgentEvent[]) => rt.remountFromEvents(events).text,
        } } : {}),
      }, providerKind, settingsModel),
      events: { append: pipeline },
      ...(recall ? { tools: { ...TOOLS, obs_recall: recall } } : {}),
      workspace: opts.workspace,
      mode: "auto", // 冻结 loop 对 ask 一律拒绝；真实门在 gatedTool（复用 checkPermission）
      signal,
      userMessage: opts.message,
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
    // M2e：Stop（agent 收束）与 SessionEnd（会话收尾）——fire-and-forget，失败只告警。
    if (rt) {
      for (const evt of ["Stop", "SessionEnd"] as const) {
        try {
          await rt.hooks.run(evt, { event: evt, trigger: "run_complete" });
        } catch (err) {
          console.warn("[hooks] " + evt + " 失败:", err instanceof Error ? err.message : String(err));
        }
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
    if (process.env.M1D_COMPACTION_DEMO === "1") {
      const res = await compactSessionLog(opts.logPath, pipeline);
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
        provider: createProvider(opts.message, undefined, undefined, providerKind, settingsModel),
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
    if (rtNow) lastPluginSnapshot = rtNow.snapshot();
    await rtNow?.shutdown().catch(() => {});
    // M2e：会话结束摘除本 run 注入的插件工具（TOOLS 是模块级注册表，零残留）
    const table = TOOLS as unknown as Record<string, unknown>;
    for (const n of injectedToolNames) delete table[n];
    setCurrentPluginRuntime(null);
  }
  return await replay(opts.logPath);
}

export interface RunOverrides extends SolpiFlags, ImpactOptions {
  workspace?: string;
  logPath?: string;
  /** M1e：会话模式 —— run 追加到该会话（不 rm 日志），消息落该会话 JSONL。 */
  sessionId?: string;
  onEvent?: (e: AgentEvent) => void;
  /** M4a 无人值守：unattended 审批门（立即拒绝 fail-closed）+ 跳过会话尾沉淀。 */
  unattended?: boolean;
  /** M4a 超时闸一：取消信号（轮界收束）。 */
  signal?: AbortSignal;
  /** C1 runtime override; settings/IPC enablement is separate, default off. */
  actionFusion?: boolean;
  /** M7 影响面 runtime override（同 actionFusion 口径）。 */
  impactAnalysis?: boolean;
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
): Promise<{ ok: boolean; error?: string }> {
  try {
    // M1e 会话模式：sessionId 在场 → logPath = 会话 JSONL（append；不 rm）；
    // 旧行为（无 sessionId）= tmp 日志 + 每轮 rm（e2e/ipc-check 等脚本路径字节不变）。
    // P-1 步骤 3 补漏：请求体里的 sessionId 此前被静默忽略（只认 overrides）——IPC 层恰好同时传了两处
    // 才没暴露，直调方（脚本/测试/内部调用）传了 req.sessionId 却仍落临时日志。现取并集，语义一致。
    const sessionId = over.sessionId ?? req.sessionId;
    const sessionMode = sessionId !== undefined;
    const logPath = over.logPath ?? (sessionMode ? pathOf(requireSessionsDir(), sessionId) : join(tmpdir(), "m0b-agent-events.jsonl"));
    const workspace = resolveRunWorkspace(
      over.workspace,
      req.workspace,
      process.env.M0B_WORKSPACE,
      (await store().get()).workspace,
      WORKSPACE,
    );
    await runAgent({
      // M2e：M0B_WORKSPACE 工作区覆盖（M2B_MAP_WORKSPACE 同族演示通道，env 门控缺省零行为）——
      // 面板截图/演示指向带 .agent/plugins 的临时工作区，验收与生产路径不变。
      workspace,
      message: req.message,
      mode: req.mode,
      logPath,
      ...(sessionMode ? { sessionId } : {}),
      ...(over.unattended ? { unattended: true as const } : {}),
      ...(over.signal ? { signal: over.signal } : {}),
      actionFusion: over.actionFusion ?? (await store().get()).actionFusion,
      impactAnalysis: over.impactAnalysis ?? (await store().get()).impactAnalysis,
      requestMetering: over.requestMetering ?? (await store().get()).requestMetering,
      observationPack: over.observationPack ?? (await store().get()).observationPack,
      evidenceReceipts: over.evidenceReceipts ?? (await store().get()).evidenceReceipts,
      economicCompaction: over.economicCompaction ?? (await store().get()).economicCompaction,
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
    return { ok: true };
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
export async function handleCardAction(req: CardActionRequest): Promise<{ ok: boolean; error?: string }> {
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
    activeOrchestrator;
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
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  }
  if (req.action === "clean" && req.cardType === "orphan") {
    const name = typeof req.payload?.name === "string" ? req.payload.name : "";
    if (name === "" || !/^[A-Za-z0-9_-]+$/.test(name)) return { ok: false, error: "orphan clean 需要 payload{name（wt- 后的 agent_id）}" };
    const ws = lastWorkspace ?? WORKSPACE;
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

// ---- M2d：记忆快照（getState 透传）+ 记忆删除（仅用户；IPC 通道 main 侧就绪，preload 暴露见 BLOCKED 备案）----

async function memoryLayerSnapshot(dir: string, scanWorkspace: string | null): Promise<MemoryLayerSnapshot> {
  const state = await loadExternalRefState();
  const index = await readTextOrNull(dir + "/MEMORY.md");
  const topics: TopicEntry[] = await listTopics(dir);
  // 外部引用扫描：索引 + 全部 topic 正文 + （项目层）根三文件
  const texts: string[] = [];
  if (index) texts.push(index);
  for (const t of topics) {
    const body = await readTextOrNull(dir + "/" + t.topic + ".md");
    if (body) texts.push(body);
  }
  if (scanWorkspace) {
    for (const f of ["ARCHITECTURE.md", "DECISIONS.md", "preferences.md"]) {
      const body = await readTextOrNull(scanWorkspace + "/.agent/" + f);
      if (body) texts.push(body);
    }
  }
  const found = new Set<string>();
  if (scanWorkspace) for (const t of texts) for (const r of extractExternalRefs(t, scanWorkspace)) found.add(r);
  return {
    path: dir,
    index,
    topics,
    pendingExternalRefs: [...found].filter((r) => !state.approved.includes(r) && !state.declined.includes(r)),
  };
}

async function memorySnapshot(): Promise<MemorySnapshot> {
  const ws = lastWorkspace;
  return {
    project: await memoryLayerSnapshot(ws ? projectMemoryDir(ws) : projectMemoryDir(process.cwd()), ws),
    global: await memoryLayerSnapshot(globalMemoryDir(), ws),
  };
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
    plugins = rt ? rt.snapshot() : (lastPluginSnapshot ?? undefined);
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
  return { sandbox: sandboxState, memory, plugins, sidechat, worktree, schedule, license, providerKeys, about: { version: appVersion } };
}

/** M3b 孤儿 worktree 扫描（纯投影面）：.agents/wt-* 目录 − 事件流有终态/收尾记录的 agent。 */
export async function scanOrphanWorktrees(workspace?: string): Promise<string[]> {
  const ws = workspace ?? lastWorkspace ?? WORKSPACE;
  const dirs = await listWorktreeDirs(ws);
  if (dirs.length === 0) return [];
  const events = lastLogPath ? await replay(lastLogPath).catch(() => []) : [];
  return orphanWorktrees(
    dirs,
    events.map((e) => e as { type: string; agent_id?: string; status?: string; callId?: string }),
  );
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
  const lite = await PluginRuntime.load(pluginRuntimeOpts(lastWorkspace ?? WORKSPACE));
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

/** IPC "agent:memory-delete"：用户经记忆面板显式删除（§8.1.7：删除仅用户，模型无删除权）。 */
export async function handleMemoryDelete(scope: "project" | "global", topic: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const dir = scope === "project" ? projectMemoryDir(lastWorkspace ?? process.cwd()) : globalMemoryDir();
    const ok = await deleteTopic(dir, topic);
    return ok ? { ok: true } : { ok: false, error: "topic 不存在: " + topic };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---- M1e：settings 存储 + 会话目录 + Provider 只读信息 ----
// settings 文件与会话目录由 shell（index.ts）按环境初始化：M1E_SETTINGS_PATH / M1E_SESSIONS_DIR
// （验收脚本注入临时目录；electron 壳缺省 userData）。store 惰性建（headless 脚本未初始化时用缺省值）。
let settingsStore: SettingsStore | null = null;

/** shell 启动时初始化 settings 存储（文件路径）。 */
export function initSettingsStore(filePath: string): void {
  settingsStore = new SettingsStore(filePath);
}

function store(): SettingsStore {
  if (!settingsStore) settingsStore = new SettingsStore("/tmp/m1e-default-settings.json");
  return settingsStore;
}

export async function getSettings(): Promise<AppSettings> {
  return await store().get();
}

export async function setSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const next = await store().set(patch);
  // 环境转发：gatedTool 读 M1E_SAFE_MODE（M1e 最小语义）；主题/档位由 renderer 持有并随 run 传回
  if (patch.safeMode !== undefined) {
    if (next.safeMode === "off") delete process.env.M1E_SAFE_MODE;
    else process.env.M1E_SAFE_MODE = next.safeMode;
  }
  // M4a：定时并发上限变更 → 调度器即时生效
  if (patch.scheduleConcurrencyCap !== undefined) updateScheduleCap(next.scheduleConcurrencyCap);
  return next;
}

/** Provider 只读展示（设置页）：与 run 同源（settings + env 覆盖），不读 key 不落日志。
 *  P-1 步骤 2：此前只认 M0A_PROVIDER env ⇒ 设置页永远显示 mock，与「用户其实选了真模型」脱节。 */
export async function providerInfo(): Promise<{ provider: string; model: string; kind: ProviderKind }> {
  const kind = await resolveProviderKind();
  if (kind === "glm") {
    const model = (await store().get()).model || process.env.M0_MODEL || "glm-5.2";
    return { provider: "GLM（OpenAI 兼容）", model, kind };
  }
  return { provider: "demo（冻结剧本，非真实模型）", model: "mock-script", kind };
}

// ---- M4b：BYOK key（safeStorage）+ license V1 + 更新检查（§2.1/§2.2/§2.3）----
// 装配由 electron 壳（index.ts）注入；headless（未装配）= fail-closed / inactive / unconfigured 显式态。

// injectStoredProviderKey 已抽到 ./provider-key-inject（轻模块——本文件依赖链含 MCP SDK/LSP，
// 单测/启动注入不应被迫导入整条重链）；此处再导出，index.ts 与既有调用方接口不变。
export { injectStoredProviderKey } from "./provider-key-inject";

export async function handleProviderKeySet(provider: string, key: string): Promise<{ ok: boolean; error?: string }> {
  return await putProviderKey(provider, key);
}

export async function handleProviderKeyDelete(provider: string): Promise<{ ok: boolean; error?: string }> {
  return await deleteProviderKey(provider);
}

/** 状态面（设置页徽标 + env 并存提示；不含 key 值）。 */
export async function handleProviderKeyStatus(): Promise<{ available: boolean; stored: string[]; envActive: boolean }> {
  const st = await providerKeyStatus();
  return { ...st, envActive: !!process.env.M0_API_KEY };
}

let licenseFilePath: string | null = null;

/** shell 启动时初始化 license 文件路径（<appData>/license.json）。 */
export function initLicenseStore(filePath: string): void {
  licenseFilePath = filePath;
}

export async function handleLicenseStatus(): Promise<LicenseState> {
  if (!licenseFilePath) return { state: "inactive" };
  return await verifyLicenseFile(licenseFilePath);
}

let appVersion = "0.0.1";

/** shell 启动时注入当前版本（app.getVersion()；headless 缺省 package.json 版本）。 */
export function initUpdateContext(opts: { currentVersion: string }): void {
  appVersion = opts.currentVersion;
}

export async function handleUpdateCheck(): Promise<UpdateCheckResult> {
  const manifestUrl = (await store().get()).updateManifestUrl;
  return await checkUpdate({ manifestUrl, currentVersion: appVersion });
}

// ---- M1e：会话列表 IPC（会话目录由 index.ts 初始化；headless 脚本未初始化 → 未配置错误） ----
let sessionsDir: string | null = null;

/** shell 启动时初始化会话目录。 */
export function initSessionsDir(dir: string): void {
  sessionsDir = dir;
}

function requireSessionsDir(): string {
  if (!sessionsDir) throw new Error("会话目录未初始化（shell 未启动？）");
  return sessionsDir;
}

export async function handleSessionList(): Promise<SessionInfo[]> {
  return await listSessions(requireSessionsDir());
}

export async function handleSessionCreate(name?: string): Promise<{ id: string }> {
  return { id: await createSession(requireSessionsDir(), name) };
}

/** 切换会话：settings.currentSession 落盘（重启还原）；返回该会话全部事件（重放投影）。
 *  M3c 崩溃恢复（§4.4.9）：重开即扫描无终态 worker → 补发 failed(interrupted) + 恢复卡载荷
 *  （幂等：补发即有终态，重扫不再命中；V1 不做热恢复，重派 = 全新 agent_id）。 */
export async function handleSessionOpen(id: string): Promise<{ events: AgentEvent[] }> {
  const dir = requireSessionsDir();
  if (!(await sessionExists(dir, id))) throw new Error(`会话不存在: ${id}`);
  await store().set({ currentSession: id });
  const logPath = pathOf(dir, id);
  await applyCrashRecovery(logPath);
  return { events: await readSessionEvents(dir, id) };
}

/** M3c 崩溃恢复扫描 + 补发（§4.4.9）：无终态 worker → failed(interrupted) + 恢复卡（respawn 载荷）。
 *  纯投影层模拟口径（裁决 5）：headless 验收直接对本函数断言；UI 走 session:open 同路。 */
export async function applyCrashRecovery(logPath: string, emit?: (e: AgentEvent) => Promise<void>): Promise<string[]> {
  const events = await replay(logPath).catch(() => [] as AgentEvent[]);
  const interrupted = interruptedWorkers(events);
  if (interrupted.length === 0) return [];
  const out: string[] = [];
  const sink = emit ?? (async (e: AgentEvent) => { await createEventLog(logPath).append(e); });
  for (const iw of interrupted) {
    const respawn = respawnArgsFrom(iw.spawned);
    const ts = Date.now();
    await sink({ type: "agent_status", agent_id: iw.agentId, status: "failed", reason: "interrupted", ts } as AgentEvent);
    await sink({
      type: "agent_result",
      agent_id: iw.agentId,
      status: "failed",
      reason: "interrupted",
      summary:
        "[recovery] 崩溃恢复：该 worker 上次会话被中断（重启扫描无终态事件）。" +
        "可在恢复卡「重派」（全新 agent_id 按原 spawn 参数再 spawn，V1 无热恢复）或忽略。" +
        "write worker 的旧 worktree 走孤儿列表（可清理，不自动删）。",
      artifacts: {
        report: "[recovery] interrupted（无终态事件；重派参数见 artifacts.respawn）",
        respawn,
      },
      usage: { inputTokens: 0, outputTokens: 0 },
      tool_stats: {},
    } as AgentEvent);
    out.push(iw.agentId);
  }
  return out;
}

export async function handleSessionRename(oldId: string, newName: string): Promise<{ id: string }> {
  const dir = requireSessionsDir();
  const id = await renameSession(dir, oldId, newName);
  const cur = await store().get();
  if (cur.currentSession === oldId) await store().set({ currentSession: id });
  return { id };
}

/** 删除会话：若删的是当前会话 → 回退到最近一个（列表 mtime 降序首个）；无会话 → null。 */
export async function handleSessionDelete(id: string): Promise<{ currentSession: string | null }> {
  const dir = requireSessionsDir();
  await deleteSession(dir, id);
  const cur = await store().get();
  if (cur.currentSession !== id) return { currentSession: cur.currentSession };
  const rest = await listSessions(dir);
  const next = rest[0]?.id ?? null;
  await store().set({ currentSession: next });
  return { currentSession: next };
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
      workspace: lastWorkspace ?? WORKSPACE,
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
  const dir = sessionsDir;
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
        if (e.type === "user_message" && e.origin) {
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
