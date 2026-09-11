// main 进程的 agent 接线：IPC "agent:run" 暴露的同一入口（handleAgentRun），不经 UI 也可直调（ipc:check）。
// 工具门：冻结的 runLoop 对 ask 一律拒绝（gate 非 allow 即 deny），因此 loop 固定走 auto 档，
// 真实门在本模块的工具包装里 —— 复用 src/permissions 的 checkPermission，语义与 M0 一致：
// read-only 拒副作用 / default 询问（UI 批准才执行）/ auto 放行；沙箱不可用时写工具强制逐条审批。
import { readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runLoop } from "../agent/loop";
import { runCompaction, createMockSummarizer, compactionCardPayload, type Summarizer } from "../agent/compaction";
import { buildMap } from "../agent/map/build";
import { computePrune } from "../agent/prune";
import { createGlmSummarizer } from "../agent/glm-session";
import { ClarifyGate, PlanGate } from "../agent/gates";
import { createVerifyHook, defaultExec, type ExecFn } from "../agent/verify";
import type { AgentEvent, ClarifyAnswerMap, EventLog } from "../events";
import { createEventLog, replay } from "../events";
import { checkPermission, getPlanState, type PermissionMode } from "../permissions";
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
import { SettingsStore, type AppSettings } from "./settings";
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
import { checkSandbox, runInSandbox, type SandboxStatus } from "./sandbox";
import { PluginRuntime, setCurrentPluginRuntime, currentPluginRuntime, type PluginPanelSnapshot } from "../agent/plugins";
import type { HookEngine } from "../agent/plugins/hooks";
import type { McpToolInfo } from "../agent/plugins/mcp";
import {
  runSidechatTurn,
  promoteToMain,
  scriptedSidechatModel,
  type SidechatModel,
} from "../agent/sidechat";
import { buildSecurityReport } from "../agent/security/scan";

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

function gatedTool(name: "write_file" | "edit_file" | "run_shell", original: Tool): Tool {
  return {
    name,
    async run(args, ctx) {
      const s = session;
      if (!s) return denied(name, "default", "工具门未接线（fail-closed）");
      // M1c：四层评估管线（deny 规则 → ask 规则 → 档位 → 风险）；方案门状态每次刷新进 session 入参
      const ps = getPlanState();
      s.autonomy.planBlocked = ps.proposed && !ps.approved;
      // M1e 设置页「产出代码安全模式」最小语义（§11.6）：gate = 写向工具在管线之前强制审批
      //（setSettings 转发 M1E_SAFE_MODE；src/permissions 冻结，最小接线在本模块）
      if (process.env.M1E_SAFE_MODE === "gate") {
        if (!s.askGate) return denied(name, s.autonomy.mode, "安全模式 gate 非交互（fail-closed）");
        const gateR = await s.askGate.request(name, args, { reason: "安全模式 gate：写工具强制审批", risk: "none" });
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
        });
        if (r.outcome !== "approved") {
          if (d.risk === "critical") {
            noteCriticalDenial(s.autonomy);
            const tip = downgradeSuggestion(s.autonomy);
            if (tip) console.warn("[permissions] " + tip);
          }
          return denied(name, s.autonomy.mode, "未获批准");
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
      if (name === "run_shell" && s.sandbox !== null && s.sandbox.available) {
        const command = typeof args.command === "string" ? args.command : "";
        const mapped = command.trim() === "pnpm test" ? VITEST_DIRECT : command;
        return await runInSandbox(mapped, { cwd: ctx.workspace });
      }
      const result = await original.run(args, ctx);
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
      const s = session;
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
    getMode: () => session?.autonomy.mode ?? "default",
    isPlanBlocked: () => {
      const ps = getPlanState();
      return ps.proposed && !ps.approved;
    },
    getAsk: () => {
      const s = session;
      if (!s?.askGate) return undefined;
      return async (args: Record<string, unknown>) => {
        const r = await s.askGate!.request("remember", args, { reason: "记忆写入（默认档逐次审批）", risk: "low" });
        return r.outcome === "approved";
      };
    },
  });
}

const appAskGate = new AskGate({
  notify: (req) => hooks.onAsk?.(req),
  notifyOutcome: (askId, outcome, reason) => hooks.onAskOutcome?.({ askId, outcome, reason }),
});

let sandboxState: SandboxStatus = { available: false, reason: "尚未自检" };

/** 自检沙箱（app 启动时 / 检查脚本入口调用）。 */
export async function initSandbox(): Promise<void> {
  sandboxState = await checkSandbox();
}

export interface RunOptions {
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
}

// M1a 真流式演示通道：M0A_PROVIDER=glm 时用真模型单轮流式（无 tools，纯文本；
// 事件按网络节奏逐条 pull，UI 逐字上屏）。缺省仍为 mock，M0 事件流字节不变。
function createProvider(userMessage: string, systemPrefix?: string): Provider {
  // M1c 明卷通道：M1C_AUTONOMY_SCRIPT 指向冻结剧本（autonomy-check 三条路径复用同一接线）。
  const autonomyScript = process.env.M1C_AUTONOMY_SCRIPT;
  if (process.env.M1B_GATE_FLOW === "1") return createMockProvider(GATE_FIXTURE);
  if (autonomyScript) return createMockProvider(autonomyScript);
  // M2a 截图通道：M2A_LSP_DEMO 指向演示剧本（write_file → 真实诊断回流管线），缺省零行为。
  // M2g：M2A_LSP_DEMO=1 → 剧本取 fixtures/demo/lsp-demo.jsonl（显式路径仍可覆盖）。
  if (process.env.M2A_LSP_DEMO) {
    return createMockProvider(process.env.M2A_LSP_DEMO === "1" ? LSP_DEMO_FIXTURE : process.env.M2A_LSP_DEMO);
  }
  if (process.env.M0A_PROVIDER !== "glm") return createMockProvider(MOCK_FIXTURE);
  let gen: AsyncIterable<ModelOutput> | null = null;
  return {
    stream() {
      if (!gen) {
        // M2e：插件注入面（skill 路由清单 + hook 上下文）以 system 前缀进真实会话；空 = 字节不变
        const prefix = systemPrefix && systemPrefix.trim() !== ""
          ? [{ role: "system", content: systemPrefix } as const]
          : [];
        gen = streamGlm([...prefix, { role: "user", content: userMessage }]);
      }
      return gen;
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
export async function runAgent(opts: RunOptions): Promise<AgentEvent[]> {
  installAppTools();
  // M1c：两层规则库加载（项目 <workspace>/.agent/permissions.json + 全局占位）；解析失败 fail loud 拒载
  const rules = loadPermissionRules(
    join(opts.workspace, ".agent", "permissions.json"),
    globalPermissionsPath(),
  );
  session = {
    mode: opts.mode,
    askGate: opts.askGate ?? null,
    sandbox: opts.sandbox ?? null,
    emit: null,
    sessionId: opts.sessionId,
    autonomy: newAutonomySession(opts.mode, {
      rules,
      sandboxAvailable: opts.sandbox ? opts.sandbox.available : null,
    }),
  };
  lastWorkspace = opts.workspace;
  // M2e：本 run 注入统一注册表的插件工具名（会话结束摘除，零残留）；声明在 try 外防 finally TDZ
  let injectedToolNames: string[] = [];
  try {
    // M1e 会话模式：sessionId 在场 = 会话列表里的既有会话，append（JSONL 即会话，重放无损）；
    // 无 sessionId = 旧行为（每轮新日志，e2e/ipc-check 等脚本路径字节不变）。
    if (!opts.sessionId) await rm(opts.logPath, { force: true });
    lastLogPath = opts.logPath; // /compact（handleCompact）缺省压缩对象
    const log = createEventLog(opts.logPath);
    const pipeline = async (e: AgentEvent): Promise<void> => {
      await log.append(e);
      opts.onEvent?.(e);
    };
    session.emit = pipeline;
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
    const systemPrefix = [skillsRouting, hookContext !== "" ? hookContext : null].filter((s): s is string => s !== null).join("\n\n");
    await runLoop({
      provider: createProvider(opts.message, systemPrefix !== "" ? systemPrefix : undefined),
      events: { append: pipeline },
      workspace: opts.workspace,
      mode: "auto", // 冻结 loop 对 ask 一律拒绝；真实门在 gatedTool（复用 checkPermission）
      userMessage: opts.message,
      clarify: appClarifyGate,
      plan: appPlanGate,
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
        enabled: autoMemory && opts.mode !== "read-only",
        logPath: opts.logPath,
        workspace: opts.workspace,
        provider: createProvider(opts.message),
        rememberTool: remember, // 合并审批即本轮权限门（未加门的工具本体）
        emit: pipeline,
        ...(opts.askGate
          ? {
              mergedApproval: async () => {
                const r = await opts.askGate!.request(
                  "remember",
                  { trigger: "session_end_distill" },
                  { reason: "会话结束自动沉淀（合并审批：批准=本轮全部记忆写入，拒绝=全部不写）", risk: "low" },
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
    session = null;
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

export interface RunOverrides {
  workspace?: string;
  logPath?: string;
  /** M1e：会话模式 —— run 追加到该会话（不 rm 日志），消息落该会话 JSONL。 */
  sessionId?: string;
  onEvent?: (e: AgentEvent) => void;
}

/** IPC "agent:run" 的处理函数 —— main 暴露的同一入口，ipc:check 直调（不经 UI）。 */
export async function handleAgentRun(
  req: RunRequest,
  over: RunOverrides = {},
): Promise<{ ok: boolean; error?: string }> {
  try {
    // M1e 会话模式：sessionId 在场 → logPath = 会话 JSONL（append；不 rm）；
    // 旧行为（无 sessionId）= tmp 日志 + 每轮 rm（e2e/ipc-check 等脚本路径字节不变）。
    const sessionMode = over.sessionId !== undefined;
    const logPath = over.logPath ?? (sessionMode && over.sessionId ? pathOf(requireSessionsDir(), over.sessionId) : join(tmpdir(), "m0b-agent-events.jsonl"));
    await runAgent({
      // M2e：M0B_WORKSPACE 工作区覆盖（M2B_MAP_WORKSPACE 同族演示通道，env 门控缺省零行为）——
      // 面板截图/演示指向带 .agent/plugins 的临时工作区，验收与生产路径不变。
      workspace: over.workspace ?? (process.env.M0B_WORKSPACE ? resolve(process.env.M0B_WORKSPACE) : WORKSPACE),
      message: req.message,
      mode: req.mode,
      logPath,
      ...(sessionMode ? { sessionId: over.sessionId } : {}),
      onEvent: (e) => {
        over.onEvent?.(e);
        hooks.onEvent?.(e);
      },
      askGate: appAskGate,
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

/** IPC "agent:clarify" 的处理函数：澄清表单提交，值挂回原 tool_use id（与 turn 解耦）。 */
export function handleClarifySubmit(callId: string, answers: ClarifyAnswerMap): boolean {
  return appClarifyGate.submit(callId, answers);
}

/** IPC "agent:plan" 的处理函数：批准/拒绝当前 plan；决议走会话事件管线落盘并推送 UI（plan 卡状态）。 */
export async function handlePlanDecide(approved: boolean, callId?: string): Promise<boolean> {
  const pending = appPlanGate.pendingIds;
  const target = callId ?? pending[0];
  const ok = approved ? appPlanGate.approve(callId) : appPlanGate.reject(callId);
  const s = session;
  if (s?.emit) {
    const event: AgentEvent = { type: "plan_approved", callId: target ?? "", approved };
    await s.emit(event);
  }
  return ok;
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
export async function handleAgentState(): Promise<{ sandbox: SandboxStatus; memory?: MemorySnapshot; plugins?: PluginPanelSnapshot; sidechat?: SidechatPanelSnapshot }> {
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
  return { sandbox: sandboxState, memory, plugins, sidechat };
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
  return next;
}

/** Provider 只读展示（设置页）：当前 provider 与模型名，不读 key 不落日志。 */
export function providerInfo(): { provider: string; model: string } {
  if (process.env.M0A_PROVIDER === "glm") {
    return { provider: "GLM（OpenAI 兼容）", model: process.env.M0_MODEL ?? "glm-5.2" };
  }
  return { provider: "mock（冻结剧本）", model: "mock-script" };
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

/** 切换会话：settings.currentSession 落盘（重启还原）；返回该会话全部事件（重放投影）。 */
export async function handleSessionOpen(id: string): Promise<{ events: AgentEvent[] }> {
  const dir = requireSessionsDir();
  if (!(await sessionExists(dir, id))) throw new Error(`会话不存在: ${id}`);
  await store().set({ currentSession: id });
  return { events: await readSessionEvents(dir, id) };
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
