// m0 CLI —— 这个 harness 的**唯一产品面**（core-only 迁移之后）。
//
// 定位：接线层，不是发明层。`runAgent` 是自包含的（自己装工具表、自己解析 provider、
// 自己落事件），CLI 的职责只有四件：
//   ① 解析 argv（用法错误 exit 2，照 scripts/gym-run.ts:26 的 pick() 口径）
//   ② 把缺省调成**fail-closed**：权限档 default（不是 auto）、ask 走交互门、沙箱自检
//   ③ 把事件流渲染成人能读的 stdout（全仓没有第二份渲染器，这份是第一份）
//   ④ 退出时收干净子进程（接回 killAllTrackedChildren —— 它的天然调用方就是这里）
//
// 刻意不做的事：不引新依赖、不加构建步骤、不碰 src/agent 与 src/tools。
// 目录名叫 deepseek harness，但 `src/` 里 "deepseek" 出现 0 次——DeepSeek 走
// OPENAI_BASE_URL 就通（见 README）。

import { createInterface } from "node:readline";
import { mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AskGate, type AskRequest } from "./main/ask-gate";
import { runAgent } from "./main/agent-runner";
import { checkSandbox, type SandboxStatus } from "./main/sandbox";
import { providerKindFromEnv, resolveMainModel, type MainModelSelection } from "./main/provider-runtime";
import { envKeyOf } from "./providers/env-keys";
import { killAllTrackedChildren } from "./tools/process";
import type { AgentEvent } from "./events";
import type { PermissionMode } from "./permissions";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const PERMISSION_MODES: readonly PermissionMode[] = ["read-only", "default", "guided", "auto"];

// ---- 退出码（照 scripts/gym-run.ts：2 = 用法错，1 = 跑了但没成，0 = 成）----
const EXIT_OK = 0;
const EXIT_FAILED = 1;
const EXIT_USAGE = 2;

class UsageError extends Error {}
/** 配置错（缺 key 之类）：同样 exit 2，但**不**打「用法」行——那行会把这题引到 argv 上去，
 *  而用户该去配的是环境变量。 */
class ConfigError extends Error {}

const argv = process.argv.slice(2);

/** flag 给了却没带值 = 用法错误。照 gym-run 的 pick()：静默按缺省跑会让打错的 flag 假装生效。 */
function pick(flag: string): string | null {
  const i = argv.indexOf(flag);
  if (i < 0) return null;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith("--")) {
    throw new UsageError(`${flag} 需要一个值（收到：${v === undefined ? "缺省" : v}）`);
  }
  return v;
}

interface Options {
  workspace: string;
  message: string;
  mode: PermissionMode;
  provider: MainModelSelection;
  logPath: string;
  unattended: boolean;
  autoVerify: boolean;
}

function parseArgs(): Options | "help" {
  if (argv.includes("--help") || argv.includes("-h")) return "help";

  const modeRaw = pick("--mode") ?? "default";
  if (!PERMISSION_MODES.includes(modeRaw as PermissionMode)) {
    throw new UsageError(`未知 --mode：${modeRaw}（允许 ${PERMISSION_MODES.join(" / ")}）`);
  }
  const mode = modeRaw as PermissionMode;

  // 位置参数：**一个 = 任务描述**（工作区取 cwd），**两个 = 工作区 + 任务描述**。
  // flag 的值不算位置参数（`--mode` 的 "auto" 不是工作区）——按「前一个 token 是取值型 flag」剔除。
  const VALUE_FLAGS = ["--mode", "--provider", "--workspace", "--message", "--log"];
  const positional = argv.filter((a, i) => !a.startsWith("--") && !VALUE_FLAGS.includes(argv[i - 1] ?? ""));
  if (positional.length > 2) {
    throw new UsageError(`位置参数最多两个（工作区 + 任务描述），收到 ${String(positional.length)} 个：${positional.join(" / ")}`);
  }
  const flagWorkspace = pick("--workspace");
  if (flagWorkspace !== null && positional.length === 2) {
    throw new UsageError("--workspace 与位置参数重复给工作区，二者只能取一");
  }
  const workspaceArg = flagWorkspace ?? (positional.length === 2 ? positional[0]! : process.cwd());
  const message = pick("--message") ?? (positional.length === 2 ? positional[1] : positional[0]);
  if (message === undefined || message === "") {
    throw new UsageError("需要一个任务描述：m0 <任务>（或 --message <任务>）");
  }

  // provider：M0A_PROVIDER 显式覆盖优先，其次 settings，最后按已配置的 key 推断。
  // 推断顺序写死在这里而不是「挑第一个有的」——否则加一个 provider 就静默改默认。
  const selection = resolveProviderSelection(pick("--provider") ?? undefined);

  const unattended = argv.includes("--unattended");
  const logPath = resolve(workspaceArg, pick("--log") ?? join(".agent", "sessions", `cli-${String(Date.now())}.jsonl`));

  return {
    workspace: resolve(ROOT, workspaceArg),
    message,
    mode,
    provider: selection,
    logPath,
    unattended,
    autoVerify: argv.includes("--auto-verify"),
  };
}

function resolveProviderSelection(flagProvider: string | undefined): MainModelSelection {
  const forced = providerKindFromEnv(flagProvider ?? process.env.M0A_PROVIDER);
  if (forced === "demo") return { kind: "demo" };
  if (forced === undefined) {
    // 没显式给：谁配了 key 就用谁。一个都没配 ⇒ **报错退出，不落 demo**。
    // 落 demo 等于拿一段预录剧本冒充真跑：用户看到「跑完了」，实际什么都没发生。
    // demo 必须显式 `--provider demo`（它是个演示档，不是缺 key 时的兜底）。
    for (const kind of ["glm", "openai", "anthropic", "gemini"] as const) {
      const envName = envKeyOf(kind);
      if (envName !== null && (process.env[envName] ?? "").trim() !== "") {
        return resolveMainModel({ forcedKind: kind, configuredKind: kind, settingsModel: "" });
      }
    }
    const names = (["glm", "openai", "anthropic", "gemini"] as const)
      .map((k) => envKeyOf(k))
      .filter((n): n is string => n !== null)
      .join(" / ");
    throw new ConfigError(
      `没有配置任何 provider 的 API key（查过：${names}）。\n` +
      "  设一个再跑，例如：export M0_API_KEY=<你的 key>\n" +
      "  DeepSeek 走 OpenAI 兼容通道：export OPENAI_BASE_URL=https://api.deepseek.com/v1\n" +
      "  只想看演示（预录剧本，不调真模型）：加 --provider demo",
    );
  }
  return resolveMainModel({ forcedKind: forced, configuredKind: forced, settingsModel: "" });
}

// ---- 事件 → stdout 渲染器（全仓第一份；worker-report 是判决逻辑不是渲染器）----

const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";
const color = process.stdout.isTTY === true && process.env.NO_COLOR === undefined;

/** 单行摘要：把多行 tool 输出压到首行 + 长度，长输出整块刷屏反而看不见发生了什么。 */
function firstLine(text: string, max = 100): string {
  const line = text.split("\n").find((l) => l.trim() !== "") ?? "";
  return line.length > max ? line.slice(0, max) + "…" : line;
}

function paint(code: string, text: string): string {
  return color ? code + text + RESET : text;
}

/** args 摘要：write_file 那种大 payload 只报键名与路径，不把正文刷到终端。 */
function argsDigest(args: Record<string, unknown>): string {
  const path = args.path ?? args.file_path;
  if (typeof path === "string") return path;
  if (typeof args.command === "string") return firstLine(args.command);
  const keys = Object.keys(args);
  return keys.length === 0 ? "" : `（${keys.join(", ")}）`;
}

export function renderEvent(e: AgentEvent): string | null {
  switch (e.type) {
    case "assistant_message":
      return e.content === "" ? null : paint(BOLD, e.content);
    case "tool_call":
      return paint(DIM, `  ⚙ ${e.name} ${argsDigest(e.args)}`);
    case "tool_result": {
      const head = e.ok ? paint(GREEN, "  ✓") : paint(RED, "  ✗");
      const gate = e.gate === undefined ? "" : paint(DIM, ` [${e.gate.verdict}]`);
      return `${head}${gate} ${firstLine(e.output)}`;
    }
    case "verify_result":
      return e.ok
        ? paint(GREEN, `  ✓ 验证通过（第 ${String(e.attempt)}/${String(e.maxAttempts)} 次）`)
        : paint(RED, `  ✗ 验证失败（第 ${String(e.attempt)}/${String(e.maxAttempts)} 次）`);
    case "security_report":
      return paint(YELLOW, `  ⚑ 安全报告：${String((e as { bySeverity?: Record<string, number> }).bySeverity?.high ?? 0)} 项高危`);
    case "error":
      return paint(RED, `  ✗ 第 ${String(e.step ?? 0)} 轮出错：${e.message}`);
    case "turn_truncated":
      return paint(YELLOW, "  ⚠ 本轮输出被截断");
    case "usage":
      return paint(DIM, `  · tokens in=${String(e.inputTokens)} out=${String(e.outputTokens)}`);
    default:
      return null; // 其余事件类型不进 stdout（它们在 JSONL 里，需要时 replay）
  }
}

// AskGate.notify 是**同步**回调，不能 await；这里把问题打出去、把读行挂起，
// 拿到答案再 decide()——AskGate.decide() 本来就是为「外部结算」准备的。
//
// 两条不能省的守卫：
//  ① 没人能答（非 TTY / 管道 / CI）时上层已把门设成 unattended，当场拒，不等 60s 超时。
//  ② rl.question 在 rl 已 close 时**抛异常**（Node 的 readline 不返回错误码，直接 throw）。
//     这个 throw 会从 notify 一路冒到工具执行里，被 loop 记成「工具失败：readline was closed」
//     ——一次没人应答的审批，伪装成模型写盘失败。必须吞掉并转成拒绝。
//     （`rl.closed` 运行时存在但不在 @types/node 的 Interface 上，所以自己跟踪。）
function promptForApproval(
  rl: ReturnType<typeof createInterface>,
  isClosed: () => boolean,
  gate: AskGate,
  req: AskRequest,
): void {
  const risk = req.risk === undefined ? "" : ` 风险=${req.risk}`;
  const why = req.riskReasons === undefined || req.riskReasons.length === 0 ? "" : `\n  理由：${req.riskReasons.join("；")}`;
  try {
    rl.question(
      `\n${color ? YELLOW : ""}批准？${color ? RESET : ""} ${req.tool} ${argsDigest(req.args)}${risk}${why}\n` +
      `  [y] 批准一次  [a] 本会话内同类批准  [n] 拒绝  > `,
      (answer) => {
        const a = answer.trim().toLowerCase();
        const scope = a === "a" || a === "all" ? "session_kind" : "once";
        gate.decide(req.askId, a !== "n" && a !== "no", "user", scope);
        if (!isClosed()) rl.prompt();
      },
    );
  } catch {
    process.stderr.write(paint(YELLOW, `[m0] 拒绝 ${req.tool}：stdin 已关闭，交互审批不可用\n`));
    gate.decide(req.askId, false, "user", "once");
  }
}

// ---- 主流程 ----

function printHelp(): void {
  process.stdout.write(`m0 —— 可重放的 agent harness（core-only）

用法：
  m0 <任务描述>                  在当前工作区跑一轮
  m0 --workspace <目录> <任务>   在指定工作区跑一轮

选项：
  --mode <档>          read-only | default | guided | auto（默认 default = 逐次审批）
  --provider <哪家>    glm | openai | anthropic | gemini | demo（默认：按已配置的 key 推断）
  --log <路径>         事件日志落盘位置（默认 <ws>/.agent/sessions/cli-<ts>.jsonl）
  --unattended         无人值守：一切审批 fail-closed 拒绝（不给交互门）
  --auto-verify        收束前补一拍验证（模型没自调 verify 时）
  -h, --help           本帮助

退出码：0 成功 / 1 跑完但失败 / 2 用法错

provider 的 key 从环境变量读（见 README）。缺 key 会明确报错退出，不会静默换一家。
`);
}

async function main(): Promise<number> {
  let opts: Options | "help";
  try {
    opts = parseArgs();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(paint(RED, `[m0] ${msg}\n`));
    if (err instanceof UsageError) {
      process.stderr.write("[m0] 用法：m0 <任务描述>（-h 看全部选项）\n");
    }
    return EXIT_USAGE;
  }
  if (opts === "help") {
    printHelp();
    return EXIT_OK;
  }

  // fail-closed 三件套：沙箱自检（不可用就明说，不假装有）、审批门（unattended 时立即拒）、
  // 权限档由 parseArgs 定在 default（auto 必须显式 --mode auto）。
  const sandbox: SandboxStatus = await checkSandbox();
  if (!sandbox.available) {
    process.stderr.write(paint(YELLOW, `[m0] 沙箱不可用（${sandbox.reason ?? "未自检通过"}）——run_shell 将不过 Seatbelt\n`));
  }

  await mkdir(dirname(opts.logPath), { recursive: true });
  await rm(opts.logPath, { force: true });

  // 交互面能不能真的接上人：stdin 不是 TTY（管道 / CI / 重定向）时没人能答审批。
  // 这时**门按 unattended 收束**（审批即刻拒绝），而不是挂一个永远等不到的 60s 超时。
  // 注意这只改门，不改 runAgent 的 unattended——后者还管会话尾沉淀，管道输出不该顺手关掉它。
  const interactive = process.stdin.isTTY === true;
  if (!opts.unattended && !interactive) {
    process.stderr.write(paint(YELLOW, "[m0] stdin 非交互（管道 / CI）——审批一律 fail-closed 拒绝；需要审批请在终端里跑，或显式 --mode auto\n"));
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let rlClosed = false;
  rl.on("close", () => { rlClosed = true; });
  const gate = new AskGate({
    unattended: opts.unattended || !interactive,
    ...(opts.unattended || !interactive ? {} : { notify: (req) => promptForApproval(rl, () => rlClosed, gate, req) }),
  });

  let failed = false;
  try {
    await runAgent({
      workspace: opts.workspace,
      message: opts.message,
      mode: opts.mode,
      logPath: opts.logPath,
      modelSelection: opts.provider,
      sandbox,
      // 只把**用户显式给的** --unattended 透给 runAgent：它还管着会话尾的沉淀跳过。
      // 「stdin 非 TTY」只该关掉审批门，不该顺手把沉淀也关了——那是另一件事。
      unattended: opts.unattended,
      autoVerify: opts.autoVerify,
      askGate: gate,
      onEvent: (e) => {
        const line = renderEvent(e);
        if (line !== null) process.stdout.write(line + "\n");
        if (e.type === "error") failed = true;
        if (e.type === "verify_result" && !e.ok) failed = true;
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(paint(RED, `[m0] 运行失败：${msg}\n`));
    return EXIT_FAILED;
  } finally {
    // 接回 killAllTrackedChildren：它零调用的原因是 Electron 入口被删，CLI 正是它的天然调用方。
    // 暴露面是**优雅退出**（SIGINT 带着活着的 bash 子树）；超时路径由 killGroup 覆盖。
    rl.close();
    killAllTrackedChildren();
  }

  process.stdout.write(paint(DIM, `\n事件日志：${opts.logPath}\n`));
  return failed ? EXIT_FAILED : EXIT_OK;
}

// Ctrl-C：门等待按拒绝收束（AskGate 收 signal），这里把进程退出码摆正。
process.on("SIGINT", () => {
  killAllTrackedChildren();
  process.exit(130);
});

process.exitCode = await main();
