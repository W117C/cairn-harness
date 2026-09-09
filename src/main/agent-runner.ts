// main 进程的 agent 接线：IPC "agent:run" 暴露的同一入口（handleAgentRun），不经 UI 也可直调（ipc:check）。
// 工具门：冻结的 runLoop 对 ask 一律拒绝（gate 非 allow 即 deny），因此 loop 固定走 auto 档，
// 真实门在本模块的工具包装里 —— 复用 src/permissions 的 checkPermission，语义与 M0 一致：
// read-only 拒副作用 / default 询问（UI 批准才执行）/ auto 放行；沙箱不可用时写工具强制逐条审批。
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runLoop } from "../agent/loop";
import type { AgentEvent } from "../events";
import { createEventLog, replay } from "../events";
import { checkPermission, type PermissionMode } from "../permissions";
import { createMockProvider } from "../providers/mock";
import { streamGlm } from "../providers/glm";
import type { Provider } from "../providers";
import { TOOLS, type Tool, type ToolResult } from "../tools";
import type { ToolName } from "../tools/base";
import { AskGate, type AskOutcome } from "./ask-gate";
import type { AskOutcomePayload, AskPayload, RunRequest } from "./ipc-protocol";
import { checkSandbox, runInSandbox, type SandboxStatus } from "./sandbox";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WORKSPACE = join(ROOT, "fixtures", "todo-app");
const MOCK_FIXTURE = join(ROOT, "fixtures", "mock", "todo-fix.jsonl");
// 坑三：Seatbelt 下 pnpm 起不来（依赖检查失败）。冻结剧本里的 run_shell 命令是 "pnpm test"（sha 不可改），
// 沙箱内映射为坑三实测可用的直连命令；TMPDIR 由 runInSandbox 指到工作区内 .tmp。
const VITEST_DIRECT =
  'node "' + join(ROOT, "node_modules", "vitest", "vitest.mjs") + '" run --pool=threads';

interface Session {
  mode: PermissionMode;
  askGate: AskGate | null;
  sandbox: SandboxStatus | null;
}
// 单窗口单任务：UI 串行发 run；ipc:check 亦串行。会话状态仅存活于一次 runAgent。
let session: Session | null = null;

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

function gatedTool(name: "write_file" | "run_shell", original: Tool): Tool {
  return {
    name,
    async run(args, ctx) {
      const s = session;
      if (!s) return denied(name, "default", "工具门未接线（fail-closed）");
      const decision = checkPermission(s.mode, name);
      if (decision === "deny") return denied(name, s.mode, "档位拒绝");
      // 沙箱不可用（降级）→ 写工具强制逐条审批，连 auto 档也不例外
      const sandboxOff = s.sandbox !== null && !s.sandbox.available;
      if (decision === "ask" || sandboxOff) {
        if (!s.askGate) return denied(name, s.mode, "非交互模式（fail-closed）");
        const outcome: AskOutcome = await s.askGate.request(name, args);
        if (outcome !== "approved") return denied(name, s.mode, "未获批准");
      }
      if (name === "run_shell" && s.sandbox !== null && s.sandbox.available) {
        const command = typeof args.command === "string" ? args.command : "";
        const mapped = command.trim() === "pnpm test" ? VITEST_DIRECT : command;
        return await runInSandbox(mapped, { cwd: ctx.workspace });
      }
      return await original.run(args, ctx);
    },
  };
}

let installed = false;
/** 一次性把 TOOLS 里的写工具换成带门 + 沙箱的包装（runLoop 直接读 TOOLS，无注入点）。 */
export function installAppTools(): void {
  if (installed) return;
  installed = true;
  TOOLS.write_file = gatedTool("write_file", TOOLS.write_file);
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
  onEvent?: (e: AgentEvent) => void;
  /** 缺省 = 非交互（ask 按 deny，fail-closed，与 M0 一致）。 */
  askGate?: AskGate;
  /** 缺省 = 不做沙箱包裹。 */
  sandbox?: SandboxStatus | null;
}

// M1a 真流式演示通道：M0A_PROVIDER=glm 时用真模型单轮流式（无 tools，纯文本；
// 事件按网络节奏逐条 pull，UI 逐字上屏）。缺省仍为 mock，M0 事件流字节不变。
// 完整 loop 接线（对话历史反馈 / 多轮工具调用）归 M1b。
function createProvider(userMessage: string): Provider {
  if (process.env.M0A_PROVIDER !== "glm") return createMockProvider(MOCK_FIXTURE);
  let gen: AsyncGenerator<AgentEvent> | null = null;
  return {
    async next() {
      if (!gen) gen = streamGlm([{ role: "user", content: userMessage }]);
      const { value } = await gen.next();
      return value ?? null;
    },
  };
}

/** 核心：mock（或演示通道）驱动跑一轮 loop；每条事件先落 JSONL 再回调。返回完整事件流。 */
export async function runAgent(opts: RunOptions): Promise<AgentEvent[]> {
  installAppTools();
  session = { mode: opts.mode, askGate: opts.askGate ?? null, sandbox: opts.sandbox ?? null };
  try {
    await rm(opts.logPath, { force: true });
    const log = createEventLog(opts.logPath);
    await runLoop({
      provider: createProvider(opts.message),
      events: {
        append: async (e) => {
          await log.append(e);
          opts.onEvent?.(e);
        },
      },
      workspace: opts.workspace,
      mode: "auto", // 冻结 loop 对 ask 一律拒绝；真实门在 gatedTool（复用 checkPermission）
      userMessage: opts.message,
    });
  } finally {
    session = null;
  }
  return await replay(opts.logPath);
}

export interface RunOverrides {
  workspace?: string;
  logPath?: string;
  onEvent?: (e: AgentEvent) => void;
}

/** IPC "agent:run" 的处理函数 —— main 暴露的同一入口，ipc:check 直调（不经 UI）。 */
export async function handleAgentRun(
  req: RunRequest,
  over: RunOverrides = {},
): Promise<{ ok: boolean; error?: string }> {
  try {
    await runAgent({
      workspace: over.workspace ?? WORKSPACE,
      message: req.message,
      mode: req.mode,
      logPath: over.logPath ?? join(tmpdir(), "m0b-agent-events.jsonl"),
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

/** IPC "agent:decide" 的处理函数。 */
export function handleAgentDecide(askId: string, approved: boolean): boolean {
  return appAskGate.decide(askId, approved);
}

/** IPC "agent:state" 的处理函数。 */
export function handleAgentState(): { sandbox: SandboxStatus } {
  return { sandbox: sandboxState };
}
