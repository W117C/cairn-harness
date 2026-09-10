// main 进程的 agent 接线：IPC "agent:run" 暴露的同一入口（handleAgentRun），不经 UI 也可直调（ipc:check）。
// 工具门：冻结的 runLoop 对 ask 一律拒绝（gate 非 allow 即 deny），因此 loop 固定走 auto 档，
// 真实门在本模块的工具包装里 —— 复用 src/permissions 的 checkPermission，语义与 M0 一致：
// read-only 拒副作用 / default 询问（UI 批准才执行）/ auto 放行；沙箱不可用时写工具强制逐条审批。
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runLoop } from "../agent/loop";
import { runCompaction, createMockSummarizer, compactionCardPayload } from "../agent/compaction";
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
  type SessionInfo,
} from "./sessions";
import { createMockProvider } from "../providers/mock";
import { streamGlm } from "../providers/glm";
import type { ModelOutput, Provider } from "../providers";
import { TOOLS, type Tool, type ToolResult } from "../tools";
import type { ToolName } from "../tools/base";
import { AskGate } from "./ask-gate";
import type { AskOutcomePayload, AskPayload, RunRequest } from "./ipc-protocol";
import { checkSandbox, runInSandbox, type SandboxStatus } from "./sandbox";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WORKSPACE = join(ROOT, "fixtures", "todo-app");
const MOCK_FIXTURE = join(ROOT, "fixtures", "mock", "todo-fix.jsonl");
// M1b 三门演示通道：M1B_GATE_FLOW=1 时用 fixtures/gate/gate-flow.jsonl 驱动（clarify/plan 卡片真人交互）。
// env 门控缺省关闭，M0 事件流字节不变。
const GATE_FIXTURE = join(ROOT, "fixtures", "gate", "gate-flow.jsonl");
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

function denied(name: ToolName, mode: PermissionMode, why: string): ToolResult {
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
): Promise<{ ok: boolean; error?: string; event?: AgentEvent; cardPayload?: Record<string, unknown> }> {
  const events = await replay(logPath);
  if (events.length === 0) return { ok: false, error: "会话为空，无可压缩" };
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

// 最近一次会话日志路径：/compact 缺省压缩对象（UI 单窗口单任务，与 session 同生命周期语义）。
let lastLogPath: string | null = null;

/** IPC "agent:compact" 的处理函数：手动 /compact 入口（preload 暴露待追认，见 BLOCKED.md）。 */
export async function handleCompact(
  over: { logPath?: string } = {},
): Promise<{ ok: boolean; error?: string; cardPayload?: Record<string, unknown> }> {
  const logPath = over.logPath ?? lastLogPath;
  if (!logPath) return { ok: false, error: "无会话日志（先跑一轮会话再 /compact）" };
  const res = await compactSessionLog(logPath, async (e) => Promise.resolve(hooks.onEvent?.(e)));
  return { ok: res.ok, error: res.error, cardPayload: res.cardPayload };
}

let installed = false;
/** 一次性把 TOOLS 里的写工具换成带门 + 沙箱的包装（runLoop 直接读 TOOLS，无注入点）。 */
export function installAppTools(): void {
  if (installed) return;
  installed = true;
  TOOLS.write_file = gatedTool("write_file", TOOLS.write_file);
  TOOLS.edit_file = gatedTool("edit_file", TOOLS.edit_file);
  TOOLS.run_shell = gatedTool("run_shell", TOOLS.run_shell);
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
function createProvider(userMessage: string): Provider {
  // M1c 明卷通道：M1C_AUTONOMY_SCRIPT 指向冻结剧本（autonomy-check 三条路径复用同一接线）。
  const autonomyScript = process.env.M1C_AUTONOMY_SCRIPT;
  if (process.env.M1B_GATE_FLOW === "1") return createMockProvider(GATE_FIXTURE);
  if (autonomyScript) return createMockProvider(autonomyScript);
  // M2a 截图通道：M2A_LSP_DEMO 指向演示剧本（write_file → 真实诊断回流管线），缺省零行为
  if (process.env.M2A_LSP_DEMO) return createMockProvider(process.env.M2A_LSP_DEMO);
  if (process.env.M0A_PROVIDER !== "glm") return createMockProvider(MOCK_FIXTURE);
  let gen: AsyncIterable<ModelOutput> | null = null;
  return {
    stream() {
      if (!gen) gen = streamGlm([{ role: "user", content: userMessage }]);
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
    await runLoop({
      provider: createProvider(opts.message),
      events: { append: pipeline },
      workspace: opts.workspace,
      mode: "auto", // 冻结 loop 对 ask 一律拒绝；真实门在 gatedTool（复用 checkPermission）
      userMessage: opts.message,
      clarify: appClarifyGate,
      plan: appPlanGate,
      verify: createVerifyHook(opts.workspace, { exec: verifyExec(opts.sandbox ?? null) }),
    });
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
  } finally {
    session = null;
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
      workspace: over.workspace ?? WORKSPACE,
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

/** IPC "agent:state" 的处理函数。 */
export function handleAgentState(): { sandbox: SandboxStatus } {
  return { sandbox: sandboxState };
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
