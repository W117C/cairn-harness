// m0 CLI —— 这个 harness 的**唯一产品面**（core-only 迁移之后）。
//
// 定位：接线层，不是发明层。CLI 干的事只有四件：
//   ① 解析 argv（用法错误 exit 2，照 scripts/gym-run.ts:26 的 pick() 口径）
//   ② **搭应用壳**（§1）：initSettingsStore / initSessionsDir / initSandbox / setAppHooks，
//      然后走 `handleAgentRun` 这个装配入口，而不是内层 `runAgent`
//   ③ 把事件流渲染成人能读的 stdout（全仓没有第二份渲染器，这份是第一份）
//   ④ 退出时收干净子进程（接回 killAllTrackedChildren —— 它的天然调用方就是这里）
//
// ②是这一版补上的。此前 CLI 直接调 `runAgent`，绕过了 `handleAgentRun` 那一层，而那一层里装着
// goal 续跑循环、9 个 settings 开关、信封校验——绕过去的后果是 17 个导出入口零生产调用者，
// 外加三个最值钱的开关（routingBandit / maxBudgetUsd / impactAnalysis）默认全关且无处可翻。
// 「存在 ≠ 接线」不是比喻：那 17 个入口一直都在，只是没人搭那层壳。
//
// 刻意不做的事：不引新依赖、不加构建步骤、不碰 src/agent 与 src/tools。
// 目录名叫 deepseek harness，但 `src/` 里 "deepseek" 出现 0 次——DeepSeek 走
// OPENAI_BASE_URL 就通（见 README）。

import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { argsDigest, firstLine, forkPointOf, forkSessionName, formatReplay } from "./agent/fork-cli";
import {
  applyReverts,
  isWorkerDiffReceipt,
  parsePorcelainZ,
  parseSelection,
  reviewActionFor,
  reviewCandidates,
  revertPlan,
  type Selection,
} from "./agent/diff-review";
import { fileURLToPath } from "node:url";
import type { AskRequest } from "./main/ask-gate";
import {
  handleAgentDecide,
  handleAgentRun,
  handleCardAction,
  handleClarifySubmit,
  handleCompact,
  handleGoalSet,
  handlePlanDecide,
  handleRunCancel,
  initSandbox,
  serveScheduler,
  setAppHooks,
} from "./main/agent-runner";
import { initSessionsDir } from "./main/session-handlers";
import { initSettingsStore } from "./main/settings-handlers";
import { isValidSessionName, pathOf } from "./main/sessions";
import type { SandboxStatus } from "./main/sandbox";
import { providerKindFromEnv, resolveMainModel, type MainModelSelection } from "./main/provider-runtime";
import type { ProviderKind } from "./main/settings";
import { envKeyOf } from "./providers/env-keys";
import { killAllTrackedChildren } from "./tools/process";
import {
  forkSession,
  mergeAssistantDeltas,
  replay,
  type AgentEvent,
  type AssistantDeltaEvent,
  type ClarifyAnswerMap,
  type ClarifyQuestion,
  type PlanProposal,
  type ToolResultEvent,
} from "./events";
import { GATE_VERDICTS, type PermissionMode } from "./permissions";

/** 权限层的负向结果：门直接拦（未执行）、被问过但没批成、无人值守拒。 */
const BLOCKING_VERDICTS: ReadonlySet<string> = new Set(
  GATE_VERDICTS.filter((v) => v === "denied" || v === "rejected" || v === "timeout" || v === "unattended"),
);

/** 会话末的沉淀轮（`X-` 层）**不算**本轮任务的失败：它是收尾的记账，
 *  在管道/CI 里本来就会被合并审批拒掉（`[distill] 沉淀轮只允许 remember 工具`）。
 *  把它计进退出码，等于让每一次成功的无人值守 run 都返回 1。
 *  `X-` 前缀的语义（见 permissions/autonomy.ts 的 GATE_LAYERS 注）就是「判定发生在 evaluate 之外」，
 *  所以这里按前缀排除，而不是拿 X-distill 这**一个**名字硬编码。 */
function isSessionEndBookkeeping(e: ToolResultEvent): boolean {
  return e.gate?.layer.startsWith("X-") === true;
}

/** 门拒绝的留痕：`gate` 存在**且** verdict 是负向的，且不属于会话末记账。
 *  方案门那条挂起被拒不带 gate（`propose_plan.ts` 在 markPlanProposed 之后 await，
 *  返回值不走 gate 包装）⇒ 它由 `plan_approved{approved:false}` 单独计数。 */
function gateDenied(e: ToolResultEvent): boolean {
  if (isSessionEndBookkeeping(e)) return false;
  return e.gate !== undefined && BLOCKING_VERDICTS.has(e.gate.verdict);
}

/** 本轮退出码的判据（纯函数，可单测）。
 *
 *  为什么要把「门拒了」算成失败：README 把退出码 1 定义成「跑完了但有失败
 *  （工具失败 / 验证红 / provider 报错）」，而此前只有 `error` 事件与 verify 红会置 1——
 *  **写盘被门拒掉时退出码仍是 0**。2026-09-29 实测两例：`--mode default` 在管道里
 *  写盘被拒、工作区一个字节没动、退出码 0，终端台词还是「任务完成」；demo 通道里
 *  `read_file`/`run_shell` 都 ok=false，退出码同样 0。把它接进脚本或 CI，失败会被当成成功。
 *
 *  两个信号都来自**事件流**，不是猜模型有没有说「完成」：
 *  ① 门拒绝：`plan_proposed` 之后结算成 rejected（那一轮的写禁没解除），或 tool_result 带负向 gate；
 *  ② 真失败：`error` 事件 / verify 红 / 非记账类 tool_result ok=false。 */
export function runFailed(input: {
  errorEvents: number;
  verifyRed: boolean;
  gateBlocks: number;
  deniedPlans: number;
  plainToolFailures: number;
}): boolean {
  return input.errorEvents > 0
    || input.verifyRed
    || input.gateBlocks > 0
    || input.deniedPlans > 0
    || input.plainToolFailures > 0;
}

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

interface GoalSpec {
  objective: string;
  maxTurns?: number;
  maxUsd?: number;
}

interface Options {
  workspace: string;
  /** 空串只在 `--compact` / `--replay` 下出现（那两条路不跑目标轮）。 */
  message: string;
  compact: boolean;
  /** `--replay <会话>`：只读日志打决策链后退出（不跑模型）。 */
  replayId: string | null;
  /** `--fork <会话> --from <轮次>`：保留前 N 轮、新任务作为第 N+1 轮跑在**新会话**上。 */
  fork: { source: string; round: number } | null;
  mode: PermissionMode;
  /** provider 相关的三个原始 flag（解析推迟到 main() 的 replay 分支之后，见那里注释）。 */
  providerFlag: string | null;
  modelFlag: string | null;
  ctxWindowFlag: string | null;
  /** 会话 id。`handleGoalSet` / `refine_goal` / `--compact` 都按它定位日志，缺了就没法接那三个入口。 */
  sessionId: string;
  /** 这一轮**是不是**一条会话。`--log` 那条路不是（它只写一个文件，且落跑前照旧 rm）。 */
  wireSession: boolean;
  /** 缺省 = `pathOf(<ws>/.agent/sessions, sessionId)`；`--log` 给了就换成那个自定义路径。 */
  logPath: string;
  goal: GoalSpec | null;
  unattended: boolean;
  autoVerify: boolean;
  /** M4 路线图：`--serve` 常驻调度模式（调度器真入口；不跑单次会话）。 */
  serve: boolean;
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
  const VALUE_FLAGS = [
    "--mode", "--provider", "--model", "--ctx-window", "--workspace", "--message", "--log",
    "--session", "--goal", "--max-turns", "--max-usd", "--replay", "--fork", "--from",
  ];
  const positional = argv.filter((a, i) => !a.startsWith("--") && !VALUE_FLAGS.includes(argv[i - 1] ?? ""));
  if (positional.length > 2) {
    throw new UsageError(`位置参数最多两个（工作区 + 任务描述），收到 ${String(positional.length)} 个：${positional.join(" / ")}`);
  }
  const flagWorkspace = pick("--workspace");
  if (flagWorkspace !== null && positional.length === 2) {
    throw new UsageError("--workspace 与位置参数重复给工作区，二者只能取一");
  }
  const workspaceArg = flagWorkspace ?? (positional.length === 2 ? positional[0]! : process.cwd());
  const compact = argv.includes("--compact");
  const message = pick("--message") ?? (positional.length === 2 ? positional[1] : positional[0]);
  // `--replay` 也免给任务（它只读日志）——但复用它自己的 pick 会让「--replay 缺值」在这里
  // 先撞成一句含混的用法错；用 argv.includes 放行、把缺值留给下面那处 pick 去点名。
  if ((message === undefined || message === "") && !compact && !argv.includes("--replay")) {
    throw new UsageError("需要一个任务描述：m0 <任务>（或 --message <任务>；只有 --compact / --replay 不用给）");
  }

  // provider 的三个原始 flag **只收不解析**：解析推迟到 main() 里 replay 分支之后。
  // 为什么不能在这里解析（2026-10-01 实测）：`--replay` 是纯只读回放、根本不碰 provider，
  // 而解析会在没配 key 的机器上直接 ConfigError ⇒ 「看一条已有会话的决策链」被一把它不需要的
  // 钥匙拦下（正是本仓点名的「读路径被无关闸门挡住」形状）。`--compact` 与目标轮仍需主模型：
  // 它们不走 replay 分支，解析照旧发生在起跑之前。
  const providerFlag = pick("--provider");
  const modelFlag = pick("--model");
  const ctxWindowFlag = pick("--ctx-window");

  const unattended = argv.includes("--unattended");
  const workspace = resolve(ROOT, workspaceArg);
  const flagLog = pick("--log");
  const flagSession = pick("--session");
  if (flagSession !== null && !isValidSessionName(flagSession)) {
    throw new UsageError(`--session 非法会话名：${flagSession}（不得含 / \\ . 或控制字符，≤80）`);
  }
  const goal = parseGoal();
  if (goal !== null && compact) {
    throw new UsageError("--compact 压缩的是一条已有会话（只调摘要器，不跑目标轮），挂不上 --goal");
  }
  if (compact && flagSession === null) {
    // 压缩一条刚编出来的会话 id 一定报「会话不存在」——那不是运行失败，是 argv 少给了东西。
    throw new UsageError("--compact 要指一条已有会话：加 --session <id>");
  }
  // ---- M8：--replay / --fork 的用法闸（两扇新门前置校验；都只读日志，不猜）----
  const replayId = pick("--replay");
  if (replayId !== null) {
    const conflicts: [string, boolean][] = [
      ["--fork", pick("--fork") !== null],
      ["--compact", compact],
      ["--log", flagLog !== null],
      ["--session", flagSession !== null],
      ["--goal", goal !== null],
    ];
    for (const [flag, on] of conflicts) {
      if (on) throw new UsageError(`--replay 只读日志、不跑模型：与 ${flag} 不能同时给`);
    }
    if (!isValidSessionName(replayId)) {
      throw new UsageError(`--replay 非法会话名：${replayId}（不得含 / \\ . 或控制字符，≤80）`);
    }
    if (message !== undefined && message !== "") {
      throw new UsageError("--replay 只读日志、不跑模型：不用给任务描述");
    }
  }
  const forkSource = pick("--fork");
  const forkRoundRaw = pick("--from");
  if (forkSource !== null && forkRoundRaw === null) {
    throw new UsageError("--fork 要与 --from <轮次> 一起给：保留前几轮、从第几轮起换路");
  }
  if (forkRoundRaw !== null && forkSource === null) {
    throw new UsageError("--from 只在 --fork 下有意义：加上 --fork <会话>");
  }
  if (forkSource !== null) {
    if (!isValidSessionName(forkSource)) {
      throw new UsageError(`--fork 非法会话名：${forkSource}（不得含 / \\ . 或控制字符，≤80）`);
    }
    if (flagSession !== null) throw new UsageError("--fork 自带会话来源，与 --session 重复");
    if (flagLog !== null) throw new UsageError("--fork 落新会话（<ws>/.agent/sessions/），与 --log 不能同时给");
    if (compact) throw new UsageError("--fork 跑一轮新任务，与只压缩的 --compact 不能同时给");
  }
  const forkRound = forkRoundRaw === null ? null : Number(forkRoundRaw);
  if (forkRound !== null && (!Number.isInteger(forkRound) || forkRound < 1)) {
    throw new UsageError(`--from 要正整数轮次，收到：${forkRoundRaw ?? ""}`);
  }
  if (flagLog !== null && flagSession !== null) {
    throw new UsageError("--log 与 --session 重复给日志位置：--session 自己就决定落在哪");
  }
  if (flagLog !== null && goal !== null) {
    // goal_set 由 handleGoalSet 写进 <sessions>/<id>.jsonl，而 --log 让 run 写到别处去 ⇒
    // 两份日志分叉，续跑判据读的是没有 goal 的那份。宁可拒，不给一个「设了但不生效」的目标。
    throw new UsageError("--log 与 --goal 不能同时给：目标只能挂在会话上（去掉 --log，日志落在 <ws>/.agent/sessions/）");
  }

  // ---- M4 路线图：--serve 常驻调度（调度器真入口；二选一取常驻而非 goal 内 cron，
  // 理由与代价在台账 258 页：Scheduler 本就是常驻语义——tick 60s/补跑 7 天/并发闸，
  // goal 轮内塞 cron 会把 wall-clock 语义塞进模型驱动的节拍里）----
  const serve = argv.includes("--serve");
  if (serve) {
    const conflicts: [string, boolean][] = [
      ["--goal", goal !== null],
      ["--session", flagSession !== null],
      ["--compact", compact],
      ["--replay", replayId !== null],
      ["--fork", forkSource !== null],
      ["--message", (message ?? "") !== ""],
      ["--log", flagLog !== null],
    ];
    const hit = conflicts.filter(([, bad]) => bad).map(([f]) => f);
    if (hit.length > 0) {
      throw new UsageError(`--serve 是常驻调度模式（不跑单次会话），与 ${hit.join(" / ")} 互斥`);
    }
  }

  // 会话 id 一次就定死：--session 续跑既有会话，缺省新开一条 `cli-<ts>`（与从前默认日志名一致）。
  // 一律走会话模式而不是「裸 runAgent + 一个 logPath」——那样 goal / compact / refine_goal 三个入口
  // 全都没有落脚点，而 `runAgent` 收到 sessionId 时也就不再 rm 日志（既有会话不能被抹掉）。
  // 唯一的例外是 `--log`：它明确是「这一轮只写这个文件」，此时不传 sessionId，让 runAgent 照旧
  // 先 rm 再写（沿用「重跑同一个 --log 路径就是重开一轮」这个从前的语义），代价是这条 run 不是会话。
  const sessionId = flagSession ?? `cli-${String(Date.now())}`;
  const logPath = flagLog !== null
    ? resolve(workspace, flagLog)
    : pathOf(join(workspace, ".agent", "sessions"), sessionId);

  return {
    workspace,
    message: message ?? "",
    compact,
    replayId,
    fork: forkSource !== null ? { source: forkSource, round: forkRound as number } : null,
    mode,
    providerFlag,
    modelFlag,
    ctxWindowFlag,
    sessionId,
    wireSession: flagLog === null,
    logPath,
    goal,
    unattended,
    autoVerify: argv.includes("--auto-verify"),
    serve: argv.includes("--serve"),
  };
}

function parseGoal(): GoalSpec | null {
  const objective = pick("--goal");
  if (objective === null) {
    // 闸值单独给 = 用户以为自己设了上限，其实目标根本没设。静默忽略是把上限当免费。
    for (const flag of ["--max-turns", "--max-usd"]) {
      if (argv.includes(flag)) throw new UsageError(`${flag} 需要一个 --goal 才能落在什么上`);
    }
    return null;
  }
  const maxTurns = pick("--max-turns");
  const maxUsd = pick("--max-usd");
  return {
    objective,
    ...(maxTurns !== null ? { maxTurns: positiveInt("--max-turns", maxTurns) } : {}),
    ...(maxUsd !== null ? { maxUsd: positiveNumber("--max-usd", maxUsd) } : {}),
  };
}

function positiveInt(flag: string, raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new UsageError(`${flag} 要正整数，收到：${raw}`);
  return n;
}

function positiveNumber(flag: string, raw: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new UsageError(`${flag} 要正数，收到：${raw}`);
  return n;
}

function resolveProviderSelection(flagProvider: string | undefined, flagModel?: string, flagCtxWindow?: string): MainModelSelection {
  const explicitModel = flagModel ?? undefined;
  // --ctx-window 只对 --model 有意义：表内档位的窗口由 registry 说了算，用户申报反而是把它盖掉。
  // 不给 --model 却给了它 ⇒ 报错，不静默忽略——静默忽略等于让用户以为窗口已经按他说的算了（M-2 那一族）。
  const rawCtx = flagCtxWindow ?? undefined;
  if (rawCtx !== undefined && explicitModel === undefined) {
    throw new UsageError(`--ctx-window 只配合 --model 用（表内档位的窗口由档位表决定，不接受申报）：收到 --ctx-window ${rawCtx} 但没有 --model`);
  }
  // 窗口是 token 数 ⇒ 要正整数，不收小数（`positiveInt` 与 --max-turns 同一把尺）。
  const explicitCtxWindow = rawCtx === undefined ? undefined : positiveInt("--ctx-window", rawCtx);
  const forward = (kind: ProviderKind) => resolveMainModel({
    forcedKind: kind,
    configuredKind: kind,
    settingsModel: "",
    ...(explicitModel !== undefined ? { explicitModel } : {}),
    ...(explicitCtxWindow !== undefined ? { explicitCtxWindow } : {}),
  });
  const forced = providerKindFromEnv(flagProvider ?? process.env.M0A_PROVIDER);
  if (forced === "demo") {
    // demo 是预录剧本、不拨号。显式点名了模型却落到 demo = 静默把用户的意图换掉，
    // 与 resolveMainModel 里 requestModel 对 demo 的拒绝同一条纪律。
    if (explicitModel !== undefined) {
      throw new UsageError(`--model ${explicitModel} 与 --provider demo 不匹配（demo 不拨号、不选模型）`);
    }
    return { kind: "demo" };
  }
  if (forced === undefined) {
    // 没显式给：谁配了 key 就用谁。一个都没配 ⇒ **报错退出，不落 demo**。
    // 落 demo 等于拿一段预录剧本冒充真跑：用户看到「跑完了」，实际什么都没发生。
    // demo 必须显式 `--provider demo`（它是个演示档，不是缺 key 时的兜底）。
    for (const kind of ["glm", "openai", "anthropic", "gemini"] as const) {
      const envName = envKeyOf(kind);
      if (envName !== null && (process.env[envName] ?? "").trim() !== "") {
        return forward(kind);
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
  return forward(forced);
}

// ---- 事件 → stdout 渲染器（全仓第一份；worker-report 是判决逻辑不是渲染器）----

const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";
const color = process.stdout.isTTY === true && process.env.NO_COLOR === undefined;

function paint(code: string, text: string): string {
  return color ? code + text + RESET : text;
}

export function renderEvent(e: AgentEvent): string | null {
  switch (e.type) {
    case "assistant_message":
      return e.content === "" ? null : paint(BOLD, e.content);
    case "tool_call":
      return paint(DIM, `  ⚙ ${e.name} ${argsDigest(e.args)}`);
    case "tool_result": {
      // worker diff 借 tool_result 落地，output 是 `[diff] vN …## stat ## patch` **整块**。
      // 走首行压缩的话 patch 一行都不剩——看不见的 diff 等于没有审查面。
      // 判定：第 245 页起收据 callId 走 spawnCallId（回执合并语义），旧的 `diff-` 前缀只在
      // 兜底支成立 ⇒ 曾经的 `startsWith("diff-")` 在主干路径上**从来匹配不到**（2026-10-01
      // M8 增量实测）。现在用生产端有意埋的 `[diff] v` 标记（两侧同标记有棘轮钉着）。
      // patch 上游已截断在 32KB 且 redactSecrets 脱敏过，这里整块打是安全的。
      if (isWorkerDiffReceipt(e)) return e.output;
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
    // ---- worker 生命周期：用户看不见 worker，就等于没发生过多 agent 编排 ----
    case "agent_spawned":
      return paint(DIM, `  ◆ 派出 ${e.agent_id}（${e.mode} 档 ${e.permission_mode}）${firstLine(e.task)}`);
    case "agent_status": {
      const tone = e.status === "done" ? GREEN : e.status === "failed" || e.status === "cancelled" ? RED : DIM;
      return paint(tone, `  · ${e.agent_id} → ${e.status}${e.reason === undefined ? "" : `（${firstLine(e.reason, 80)}）`}`);
    }
    case "agent_message":
      // report 是 worker 交给父上下文的结论，值得整块；progress 是过程，压首行。
      return e.kind === "report"
        ? `\n${paint(BOLD, `[${e.agent_id}]`)} ${e.text}`
        : paint(DIM, `  [${e.agent_id}] ${firstLine(e.text)}`);
    case "agent_result": {
      const files = e.artifacts.files_changed ?? [];
      const cost = e.artifacts.spent_usd;
      const tail = [
        files.length > 0 ? `改 ${String(files.length)} 个文件` : "未改文件",
        e.artifacts.verified === undefined ? "" : `证据 ${e.artifacts.verified}`,
        cost === undefined ? "" : `$${cost.toFixed(4)}`,
      ].filter((s) => s !== "");
      const head = e.status === "done" ? paint(GREEN, "  ✓") : paint(RED, "  ✗");
      return `${head} ${e.agent_id} ${tail.join(" · ")}\n${paint(DIM, "    " + firstLine(e.summary, 160))}`;
    }
    case "impact_report": {
      const up = e.up.length;
      // 波及半径 0 是最该看见的那一档（「改这个文件没人调用」），别让它缩成一个空列表。
      const reach = up === 0 ? "无跨文件调用点" : `波及 ${String(up)} 处调用点`;
      return paint(DIM, `  ↔ ${e.file}：${reach}${e.truncated ? "（已截断）" : ""}`);
    }
    case "goal_set":
      return paint(DIM, `  ◎ 目标已设：${firstLine(e.objective)}（上限 ${String(e.max_turns)} 轮${e.max_usd > 0 ? ` / $${String(e.max_usd)}` : ""}）`);
    case "goal_stopped":
      return paint(YELLOW, `  ⏹ 目标停止（第 ${String(e.turn)} 轮，证据 ${e.evidence}）：${e.reason}`);
    default:
      return null; // 其余事件类型不进 stdout（它们在 JSONL 里，需要时 replay）
  }
}

// AskGate.notify 是**同步**回调，不能 await；这里把问题打出去、把读行挂起，
// 拿到答案再 decide()——decide 本来就是为「外部结算」准备的。
//
// 走 `handleAgentRun` 之后，那道门是 agent-runner 自己的 `appAskGate`（handleAgentRun 不收
// askGate 参数），所以决议入口也换成它导出的 `handleAgentDecide`——**同一块审批面**，
// 不在 CLI 另造一个 AskGate 实例（那样就是两扇门，模型问的那道和人能答的那道会分叉）。
//
// 三条不能省的守卫：
//  ① 没人能答（非 TTY / 管道 / CI）时当场拒，不等 60s 超时（见调用处 `unattended` 那段）。
//  ② rl.question 在 rl 已 close 时**抛异常**（Node 的 readline 不返回错误码，直接 throw）。
//     这个 throw 会从 notify 一路冒到工具执行里，被 loop 记成「工具失败：readline was closed」
//     ——一次没人应答的审批，伪装成模型写盘失败。必须吞掉并转成拒绝。
//     （`rl.closed` 运行时存在但不在 @types/node 的 Interface 上，所以自己跟踪。）
function promptForApproval(
  rl: ReturnType<typeof createInterface>,
  isClosed: () => boolean,
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
        handleAgentDecide(req.askId, a !== "n" && a !== "no", scope);
        if (!isClosed()) rl.prompt();
      },
    );
  } catch {
    process.stderr.write(paint(YELLOW, `[m0] 拒绝 ${req.tool}：stdin 已关闭，交互审批不可用\n`));
    handleAgentDecide(req.askId, false);
  }
}

// 方案门（propose_plan）是**唯一有强制力的门**，但它不走 AskGate：挂在 PlanGate 上，
// 决议入口是 agent-runner 导出的 handlePlanDecide。桌面层被删后没人调那个入口，
// 于是模型一提交方案，propose_plan 就卡在 `await waiting`（src/tools/propose_plan.ts:71）
// 永久悬挂——进程以「unsettled top-level await」退出，文件一个字节没动。
//
// 无人能答时**当场拒，不等那个 60s 看门狗**：看门狗只在 opts.unattended 时才接上
// （agent-runner.ts:1512），而 CLI 刻意不把「stdin 非 TTY」透成 unattended
// （见下面 unattended 那段——那是另一件事）。所以非交互时这扇门**无超时**，等就是挂死。
// 当场拒还能让模型拿到 tool_result「方案被拒绝：请修订后重新提交」，
// 于是这一轮是**可恢复**的失败，而不是整轮蒸发。
function decidePlan(approved: boolean, callId: string): void {
  // handlePlanDecide 是 async（决议要经会话管线落盘），调用点却都在同步回调里。
  // fire-and-forget 没问题——propose_plan 挂的是 waitApproval，decide 只是解挂它。
  // 但落盘那一 await 可能抛，而没人接的 promise 拒绝会直接打崩进程。
  handlePlanDecide(approved, callId).catch((err: unknown) => {
    process.stderr.write(paint(RED, `[m0] 方案决议落盘失败：${err instanceof Error ? err.message : String(err)}\n`));
  });
}

/** 方案门在 CLI 上该给出什么决议（纯函数，可单测）。
 *
 *  为什么把这一格抽成纯函数：缺陷原本埋在 `promptForPlan` 的分支里，而那个函数要真的起一次
 *  provider、模型真的提方案才走得到——离线判卷跑不到，于是它一直没被测过。
 *  抽出来之后判据可以逐格穷举；**装配**仍由真模型实测背书
 *  （2026-10-01：12 个 bug 的长任务靶子，修复前 0 次写／9 轮退出／12 个 bug 全废，
 *   修复后 12 次写／方案 1 次批准／12-12 全修 + verify 通过／35 秒）。
 *
 *  三档语义：
 *   · `auto` —— 命令行显式授权（README：auto 必须点名，不是缺省）⇒ 当场批准；
 *   · 交互终端 —— 问人（"ask"，调用方走 rl.question）；
 *   · 管道/CI 且非 auto —— fail-closed 拒绝（"reject"）。 */
export function planDecisionFor(input: { mode: PermissionMode; ask: boolean }): "approve" | "ask" | "reject" {
  if (input.mode === "auto") return "approve";
  return input.ask ? "ask" : "reject";
}

function promptForPlan(
  rl: ReturnType<typeof createInterface>,
  isClosed: () => boolean,
  plan: PlanProposal,
  callId: string,
  ask: boolean,
  mode: PermissionMode,
): void {
  const files = plan.files.map((f) => `    ${f.action}  ${f.path}  ${f.summary}`).join("\n");
  const header = `\n${color ? YELLOW : ""}方案待批${color ? RESET : ""}：${plan.goal}\n${files}\n`;
  const decision = planDecisionFor({ mode, ask });
  if (decision === "approve") {
    /* `--mode auto` 是用户在命令行上**显式给的**授权。既然整轮写操作都已获授权，
     *  方案门再按「没人能答 ⇒ 拒」收束就自相矛盾：模型提交方案 → 当场被拒 → 写禁不解除
     *  → 连读工具都进不去，最后什么都没做成。
     *  2026-09-29 实测：管道里 `--mode auto` 建一个 hello.txt，两次方案被自动拒、约 32k token 白烧，
     *  模型还反过来建议用户「去 git 面板点批准」——而 core-only 树里没有那个面板。
     *  2026-10-01 复现（12 个独立 bug 的长任务靶子）：auto 档下 **写操作 0 次**、9 轮退出、
     *  12 个 bug 一个都没修。这条不是"体验问题"，是**任务直接做不成**。
     *  批准时把「依据是命令行授权、不是有人看过了」印出来，免得把策略放行读成人工审阅。 */
    process.stderr.write(paint(YELLOW, `${header}  --mode auto：按命令行授权自动批准方案（无人审阅，写禁即解除）\n`));
    decidePlan(true, callId);
    return;
  }
  if (decision === "reject") {
    process.stderr.write(paint(YELLOW, `${header}  stdin 非交互（管道 / CI / --unattended）——按 fail-closed 拒绝，模型可修订后重新提交；全自动请显式 --mode auto\n`));
    decidePlan(false, callId);
    return;
  }
  try {
    rl.question(`${header}  [y] 批准  [n] 拒绝  > `, (answer) => {
      const a = answer.trim().toLowerCase();
      decidePlan(a !== "n" && a !== "no", callId);
      if (!isClosed()) rl.prompt();
    });
  } catch {
    // 与 promptForApproval 同一个坑：rl 已 close 时 question 直接 throw，
    // 不吞掉就会冒进工具执行，被 loop 记成「工具失败」——一次没人应答的方案审批，
    // 在日志里伪装成模型写盘失败。
    process.stderr.write(paint(YELLOW, "[m0] 拒绝方案：stdin 已关闭，交互审批不可用\n"));
    decidePlan(false, callId);
  }
}

// 澄清门（clarify）与方案门同一个坑：等的是 ClarifyGate.submit，而那个入口
// 同样只被删掉的桌面层调过。它排在方案门**前面**，所以只接方案门的话，
// 模型一发问就照样永久悬挂——那扇接好的门根本走不到。
//
// 两扇门的 fail-closed 形状**刻意不同**：
//   方案门 = 审批。有人能答就问，没人能答就拒（拒了写禁不解除，模型必须重提）。
//   澄清门 = 要信息。ClarifyGate 只有 submit 没有 reject，唯一的负向出口是 abort/超时，
//            而那个 signal 归 run 自己的 AbortController，CLI 拿不到。
//            硬凑「拒绝」只能去 abort 整轮，那是拿一个提问把整轮杀掉。
//   所以这里提交**空答案**={}：它不是批准，也不解除任何门（写禁只由 propose_plan 的
//   markPlanProposed 落下，全仓唯一生产调用者），只是如实告诉模型「没人答，自己拿主意」。
//   编造答案才是这里唯一真正危险的事，而空 map 恰好是最不编造的那一种。
function submitClarify(callId: string, answers: ClarifyAnswerMap): void {
  const ok = handleClarifySubmit(callId, answers);
  if (!ok) {
    process.stderr.write(paint(YELLOW, `[m0] 澄清 ${callId} 无人等待（run 已推进），提交丢弃\n`));
  }
}

/** 答卷解析：命中选项序号取该 label；多选吃逗号分隔的多个序号；其余一律当自由补充文本。
 *  空输入 = 这题不答（不进 map）——把「没答」和「答了空」分开，别替人编。 */
function parseClarifyAnswer(question: ClarifyQuestion, raw: string): string | string[] {
  const pick = (token: string): string | undefined => {
    const n = Number(token);
    const opts = question.options;
    if (!Number.isInteger(n) || n < 1 || !opts || n > opts.length) return undefined;
    return opts[n - 1]?.label;
  };
  const text = raw.trim();
  if (text === "") return "";
  if (question.multiSelect) {
    const labels = text.split(/[,，\s]+/).map(pick).filter((l): l is string => l !== undefined);
    return labels.length > 0 ? labels : text;
  }
  return pick(text) ?? text;
}

function promptForClarify(
  rl: ReturnType<typeof createInterface>,
  isClosed: () => boolean,
  questions: ClarifyQuestion[],
  callId: string,
  ask: boolean,
): void {
  const body = questions
    .map((q, i) => {
      const opts = (q.options ?? [])
        .map((o, j) => `      [${String(j + 1)}] ${o.label}${o.description === undefined ? "" : ` — ${o.description}`}`)
        .join("\n");
      return `    ${String(i + 1)}. ${q.question}${opts === "" ? "" : "\n" + opts}`;
    })
    .join("\n");
  const header = `\n${color ? YELLOW : ""}模型要澄清${color ? RESET : ""}：\n${body}\n`;
  if (!ask) {
    process.stderr.write(paint(YELLOW, `${header}  stdin 非交互（管道 / CI / --unattended）——提交空答案，模型须自行拿主意；写禁仍由方案门把关\n`));
    submitClarify(callId, {});
    return;
  }
  const pending = [...questions];
  const answers: ClarifyAnswerMap = {};
  const askNext = (): void => {
    const q = pending.shift();
    if (q === undefined) {
      submitClarify(callId, answers);
      return;
    }
    try {
      rl.question(`${header}  ${q.question}\n  > `, (answer) => {
        const parsed = parseClarifyAnswer(q, answer);
        if (parsed !== "") answers[q.question] = parsed;
        if (!isClosed()) askNext();
      });
    } catch {
      process.stderr.write(paint(YELLOW, "[m0] 澄清提交空答案：stdin 已关闭，交互提问不可用\n"));
      submitClarify(callId, answers);
    }
  };
  askNext();
}

/** 一行问答（promise 化的 rl.question；rl 已关时返回 null——与既有 prompt 同一条守卫口径）。 */
function askLine(rl: ReturnType<typeof createInterface>, isClosed: () => boolean, prompt: string): Promise<string | null> {
  return new Promise((settle) => {
    if (isClosed()) {
      settle(null);
      return;
    }
    try {
      rl.question(prompt, (answer) => settle(answer));
    } catch {
      settle(null);
    }
  });
}

/** M8 增量：跑完后的 worker diff **逐文件审阅**（只在交互 TTY 里弹——合并永远是人决定的事，
 *  无人值守里不自动发生）。三个决策落点都走既有协议：全要 → merge 卡；全拒 → reject 卡；
 *  子集 → 先把被拒文件在 worktree 里还原（`applyReverts`），再发 merge 卡（payload 记下两侧清单，
 *  进事件流审计）。**还原失败/需人工时不发卡**——绝不把用户明确拒绝的文件混进合并。
 *  合并不成/跳过时把现场（worktree、分支）与手工命令打出来：合并塔随本进程退出失效，
 *  这句话不说，"保留了"就只是一个动词。 */
async function reviewWorkerDiffs(
  rl: ReturnType<typeof createInterface>,
  isClosed: () => boolean,
  opts: Options,
): Promise<void> {
  const events = await replay(opts.logPath).catch(() => [] as AgentEvent[]);
  const cands = reviewCandidates(events);
  if (cands.length === 0) return;
  const tty = process.stdin.isTTY === true;
  for (const c of cands) {
    const st = spawnSync("git", ["-C", c.worktree, "status", "--porcelain", "-z"], { encoding: "utf8" });
    if (st.status !== 0) {
      process.stdout.write(paint(DIM, `\n[m0] worker ${c.agentId}：worktree 已不在（${c.worktree}）——跳过审阅\n`));
      continue;
    }
    const files = parsePorcelainZ(st.stdout ?? "");
    if (files.length === 0) continue;
    const manualHint = (): void => {
      const branch = spawnSync("git", ["-C", c.worktree, "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" }).stdout?.trim() ?? "?";
      process.stdout.write(
        paint(
          DIM,
          `  现场保留：worktree ${c.worktree}（未提交改动在里面）、分支 ${branch}；\n` +
            `  人工合并：git -C "${c.worktree}" add -A && git -C "${c.worktree}" commit -m "worker ${c.agentId}" && git merge --no-ff ${branch}\n`,
        ),
      );
    };
    if (!tty) {
      process.stdout.write(
        paint(YELLOW, `\n[m0] 有 1 份待合并的 worker diff（${c.agentId}，${String(files.length)} 个文件）——非交互不弹审阅（合并永远是人决定的事）。\n`),
      );
      manualHint();
      continue;
    }
    const ns = spawnSync("git", ["-C", c.worktree, "diff", "--numstat"], { encoding: "utf8" });
    const counts = new Map<string, string>();
    for (const line of (ns.stdout ?? "").split("\n")) {
      const [a, r, ...rest] = line.split("\t");
      const p = rest.join("\t");
      if (p !== "") counts.set(p, ` +${a ?? "?"} −${r ?? "?"}`);
    }
    process.stdout.write(`\n[m0] 待审阅：worker ${c.agentId}（${firstLine(c.task, 80)}）\n`);
    files.forEach((f, i) => {
      const label = f.code.includes("?") || f.code.startsWith("A") ? "新增" : f.code.includes("D") ? "删除" : "修改";
      const from = f.from !== undefined ? `（改名自 ${f.from}）` : "";
      process.stdout.write(paint(DIM, `  ${String(i + 1)}) ${label} ${f.path}${counts.get(f.path) ?? ""}${from}\n`));
    });
    let sel: Selection | null = null;
    for (let attempt = 0; attempt < 3 && sel === null; attempt += 1) {
      const answer = await askLine(
        rl,
        isClosed,
        "怎么处理？[a] 全部合并 / [r] 全部拒绝（worktree 删除，未提交改动一并消失）/ [1,3,…] 只合并这些（其余在 worktree 还原）/ 回车跳过 > ",
      );
      if (answer === null) return;
      const parsed = parseSelection(answer, files.length);
      if (parsed === null) {
        process.stdout.write(paint(DIM, `  跳过 ${c.agentId}：\n`));
        manualHint();
        break;
      }
      if ("error" in parsed) {
        process.stdout.write(paint(YELLOW, `  ${parsed.error}\n`));
        continue;
      }
      sel = parsed;
    }
    if (sel === null) continue;
    const rejectedPaths = sel.rejected.map((n) => files[n - 1]!.path);
    const acceptedPaths = sel.accepted.map((n) => files[n - 1]!.path);
    if (rejectedPaths.length > 0) {
      const r = applyReverts(c.worktree, revertPlan(files, rejectedPaths));
      for (const f of r.failed) process.stderr.write(paint(RED, `  [还原失败] ${f.path}：${f.error}\n`));
      for (const m of r.manual) process.stderr.write(paint(YELLOW, `  [需人工] ${m.path}：${m.why}\n`));
      if (r.failed.length > 0 || r.manual.length > 0) {
        process.stdout.write(paint(RED, `  未发合并卡：被拒文件没能全部还原（拒绝的绝不混进合并）。\n`));
        manualHint();
        continue;
      }
      process.stdout.write(paint(DIM, `  已还原被拒文件 ${String(r.done.length)} 个：${r.done.join("、")}\n`));
    }
    const action = reviewActionFor(sel);
    const res = await handleCardAction({
      cardId: "cli-review-" + c.agentId,
      sourceEventId: c.resultEventIndex,
      cardType: "diff",
      action,
      targetAgentId: c.agentId,
      payload: { via: "cli-review", accepted_files: acceptedPaths, rejected_files: rejectedPaths },
    });
    process.stdout.write(
      res.ok
        ? paint(GREEN, `  ✓ ${action === "merge" ? "已合并" : "已拒绝"} ${c.agentId}（accepted ${String(acceptedPaths.length)} / rejected ${String(rejectedPaths.length)}）\n`)
        : paint(RED, `  ✗ ${action} 失败：${res.error ?? "未知"}\n`),
    );
  }
}

// ---- 主流程 ----

function printHelp(): void {
  process.stdout.write(`m0 —— 可重放的 agent harness（core-only）

用法：
  m0 <任务描述>                  在当前工作区跑一轮
  m0 --workspace <目录> <任务>   在指定工作区跑一轮
  m0 --session <id> <任务>       接着已有会话跑（不抹掉之前的转录）
  m0 --session <id> --compact    手动压缩那条会话后退出
  m0 --fork <id> --from <n> <任务>  分叉：保留前 n 轮（含），新任务作为第 n+1 轮跑在**新会话** <id>-f<n> 上
  m0 --replay <id>               只读回放这条会话的决策链（不跑模型）

选项：
  --mode <档>          read-only | default | guided | auto（默认 default = 逐次审批）
  --provider <哪家>    glm | openai | anthropic | gemini | demo（默认：按已配置的 key 推断）
                       demo = 预录剧本：零凭据、不拨号，但与你给的任务无关
                       （固定演「读→写 src/todo.ts→跑测试」），台词「任务完成」也是剧本的一部分，
                       结论请看退出码。想量能力用 pnpm bench，别用 demo。
  --model <模型名>     自由档位：直接点名线上模型（如 stealth/space-bunny-alpha），不进档位表
  --ctx-window <n>     只配 --model：申报该模型的真实上下文窗口（token 数）。
                       缺省取档位表里最小的那个，对更小的模型是高估 ⇒ 撞远端 400。
                       指向小窗/网关模型时请显式给。
  --session <id>       接着这条会话跑（缺省新开一条 cli-<时间戳>）
  --fork <id>          分叉源会话（配合 --from）：原会话只读、新会话 <id>-f<n>，事件溯源本来就是这么设计的
  --from <n>           保留前 n 轮（含）再分叉；「轮」以 user_message 为界
  --replay <id>        回放决策链（每行一条事件、带 gate 判定与验证结果）后退出，不跑模型、不改日志
  --goal "<目标>"       给这条会话设目标：一轮收束后按判据自动续跑，不达标就再来一轮
  --serve               常驻调度模式：启动定时任务调度器（tick 60s，补跑 7 天），不跑单次会话
  --max-turns <n>      目标轮次上限（配 --goal）
  --max-usd <n>        目标花费上限 USD（配 --goal；表里查不到价的模型上这道闸会明写自己没生效）
  --compact            用摘要模型压缩 --session 那条会话后退出（需 M0_API_KEY：不配就 fail-closed 拒，不静默截断）
  --log <路径>         事件日志落盘位置（与 --goal / --session 互斥，见下）
  --unattended         无人值守：一切审批 fail-closed 拒绝（不给交互门）
  --auto-verify        收束前补一拍验证（模型没自调 verify 时）
  -h, --help           本帮助

退出码：0 成功 / 1 跑完但失败 / 2 用法错

provider 的 key 从环境变量读（见 README）。缺 key 会明确报错退出，不会静默换一家。
--log 把日志写到任意路径，代价是这条 run 不再是会话（目标挂不上去、既有会话也接不上），
所以它与 --goal / --session 互斥。
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

  // ---- M8：`--replay` 只读日志打决策链（不搭壳、不起沙箱、不跑模型）----
  if (opts.replayId !== null) {
    const path = pathOf(join(opts.workspace, ".agent", "sessions"), opts.replayId);
    let events: AgentEvent[];
    try {
      events = await replay(path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        process.stderr.write(paint(RED, `[m0] 会话不存在：${opts.replayId}（看了 ${path}）\n`));
        return EXIT_FAILED;
      }
      process.stderr.write(paint(RED, `[m0] 读日志失败：${err instanceof Error ? err.message : String(err)}\n`));
      return EXIT_FAILED;
    }
    process.stdout.write(formatReplay(events) + "\n");
    process.stdout.write(paint(DIM, `\n会话日志：${path}（${String(events.length)} 条事件）\n`));
    return EXIT_OK;
  }

  // provider 解析：M0A_PROVIDER 显式覆盖优先，其次 settings，最后按已配置的 key 推断。
  // 推断顺序写死在这里而不是「挑第一个有的」——否则加一个 provider 就静默改默认。
  // 门的位置也在这一行说话：**放在 replay 之后**（回放不碰 provider，没 key 也得能看日志）；
  // `--compact` 与目标轮要主模型，解析照旧发生在起跑前。ConfigError 同样 exit 2，但不打「用法」行。
  let provider: MainModelSelection;
  try {
    provider = resolveProviderSelection(opts.providerFlag ?? undefined, opts.modelFlag ?? undefined, opts.ctxWindowFlag ?? undefined);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(paint(RED, `[m0] ${msg}\n`));
    return EXIT_USAGE;
  }

  // ---- 应用壳（§1）：这三行是 CLI 从「直接调 runAgent」变成「走装配入口」的全部前提 ----
  // 顺序有讲究：settings 与 sessions 必须先于任何 handler（它们各自在未初始化时抛或回落
  // 到 /tmp 假档），沙箱自检的最后一份结果正好是 `handleAgentRun` 读的那份（只自检一次）。
  initSettingsStore(join(opts.workspace, ".agent", "settings.json"));
  initSessionsDir(join(opts.workspace, ".agent", "sessions"));
  const sandbox: SandboxStatus = await initSandbox();
  if (!sandbox.available) {
    process.stderr.write(paint(YELLOW, `[m0] 沙箱不可用（${sandbox.reason ?? "未自检通过"}）——run_shell 将不过 Seatbelt\n`));
  }

  // ---- M4 路线图：`--serve` 常驻调度（调度器真入口；第 258 页记录的二选一决策与理由）----
  // 放在应用壳之后：触发的会话（handleAgentRun）依赖 settings/sessions/沙箱这三样先就位。
  if (opts.serve) {
    const handle = await serveScheduler({ workspace: opts.workspace });
    process.stdout.write(paint(GREEN, `[m0] 调度器已启动（workspace ${opts.workspace}；tick 60s，补跑 7 天，并发闸 ≤2；Ctrl-C 退出）\n`));
    process.on("SIGINT", () => {
      handle.stop();
      process.stdout.write("\n[m0] 调度器已停止\n");
      process.exit(0);
    });
    await new Promise<never>(() => {}); // 常驻：调度器的 interval 持有事件循环，此处显式挂起
    return EXIT_OK; // 不可达
  }

  await mkdir(dirname(opts.logPath), { recursive: true });

  // ---- M8：`--fork` 的落点动作（读源日志 → 算分叉点 → 写新会话；源会话只读，字节不变）----
  if (opts.fork !== null) {
    const sessionsDir = join(opts.workspace, ".agent", "sessions");
    const srcPath = pathOf(sessionsDir, opts.fork.source);
    let srcEvents: AgentEvent[];
    try {
      srcEvents = await replay(srcPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        process.stderr.write(paint(RED, `[m0] 源会话不存在：${opts.fork.source}（看了 ${srcPath}）\n`));
        return EXIT_FAILED;
      }
      process.stderr.write(paint(RED, `[m0] 读源会话失败：${err instanceof Error ? err.message : String(err)}\n`));
      return EXIT_FAILED;
    }
    const point = forkPointOf(srcEvents, opts.fork.round);
    if ("error" in point) {
      process.stderr.write(paint(RED, `[m0] 分叉点非法：${point.error}\n`));
      return EXIT_USAGE;
    }
    const newId = forkSessionName(opts.fork.source, opts.fork.round);
    if (!isValidSessionName(newId)) {
      process.stderr.write(paint(RED, `[m0] 分叉出的会话名非法（多半过长）：${newId}\n`));
      return EXIT_USAGE;
    }
    const target = pathOf(sessionsDir, newId);
    if (existsSync(target)) {
      process.stderr.write(paint(RED, `[m0] 目标会话已存在：${newId}（换 --from 或先删掉它；**不覆盖**既有转录）\n`));
      return EXIT_USAGE;
    }
    // forkSession 写的一定是 `<dir>/events.jsonl`，而 CLI 的会话文件命名是 `<id>.jsonl`——
    // 先写 scrub 目录再 rename：两边各守各的命名纪律，也不给 sessions 目录留半成品。
    const scratch = join(sessionsDir, ".fork-" + newId);
    const made = await forkSession(srcPath, String(point.lastIncluded), scratch);
    await rename(made.eventsPath, target);
    await rm(scratch, { recursive: true, force: true });
    process.stderr.write(
      paint(
        DIM,
        `[m0] 已分叉：${opts.fork.source} 前 ${String(opts.fork.round)} 轮（共 ${String(point.totalRounds)} 轮）→ 新会话 ${newId}；原会话只读未动\n`,
      ),
    );
    opts = { ...opts, sessionId: newId, logPath: target };
  }

  // 交互面能不能真的接上人：stdin 不是 TTY（管道 / CI / 重定向）时没人能答审批。
  // 这时**门按 fail-closed 收束**（当场拒绝），而不是挂一个永远等不到的 60s 超时。
  // 注意这只改门，不改 run 的 unattended——后者还管着会话尾沉淀，管道输出不该顺手关掉它。
  const interactive = process.stdin.isTTY === true;
  const unattended = opts.unattended || !interactive;
  if (!opts.unattended && !interactive) {
    process.stderr.write(paint(YELLOW, "[m0] stdin 非交互（管道 / CI）——审批一律 fail-closed 拒绝；需要审批请在终端里跑，或显式 --mode auto\n"));
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let rlClosed = false;
  rl.on("close", () => { rlClosed = true; });

  // 事件流是唯一的事实出口：goal 事件（handleGoalSet 走 emitGoalEvent）、worker 事件、
  // diff 借道的那条 tool_result 全都从这里上来，所以渲染只接一次。
  // 退出码的五个计数器全从事件流取（判据是纯函数 runFailed）——不猜模型说了什么。
  const tally = { errorEvents: 0, verifyRed: false, gateBlocks: 0, deniedPlans: 0, plainToolFailures: 0 };
  const pendingPlanIds = new Set<string>();
  // 真实 provider 的一轮只发 assistant_delta，聚合的 assistant_message 是 mock/demo 通道才有的东西
  //（见 agent-runner 里那几处脚本化 emit）。renderEvent 只认后者 ⇒ 不在这里攒起来的话，
  // 用任何真实 provider 跑都是**终端上一个字都看不到**。按到达顺序攒，在第一个非 delta 边界事件
  // 与收尾时各冲一次。**刻意不去事件流里补发 assistant_message**：那会让同一轮同时存在 message 与
  // delta，而 context / compaction / prune 三处都按**文本量**计数 ⇒ 同一段话被计两遍，
  // 压缩与裁剪边界整体漂移。渲染层补，事件流零改动。
  const pendingText: AssistantDeltaEvent[] = [];
  const flushAssistantText = (): void => {
    if (pendingText.length === 0) return;
    const text = mergeAssistantDeltas(pendingText);
    pendingText.length = 0;
    if (text !== "") process.stdout.write(paint(BOLD, text) + "\n");
  };

  const onEvent = (e: AgentEvent): void => {
    if (e.type === "assistant_delta") {
      pendingText.push(e);
      return;
    }
    flushAssistantText();
    if (e.type === "plan_proposed") {
      // 记下这一次提交，等 plan_approved 结算——被拒的方案意味着写禁没解除，
      // 那一轮**没有真正开工**，退出码要认这个（见 runFailed）。
      pendingPlanIds.add(e.callId);
      // 门不等 renderEvent：它要的是一次决策，不是一行摘要。
      promptForPlan(rl, () => rlClosed, e.plan, e.callId, !unattended, opts.mode);
      return;
    }
    if (e.type === "plan_approved") {
      if (!e.approved && pendingPlanIds.delete(e.callId)) tally.deniedPlans += 1;
      return;
    }
    if (e.type === "clarify_requested") {
      promptForClarify(rl, () => rlClosed, e.questions, e.callId, !unattended);
      return;
    }
    const line = renderEvent(e);
    if (line !== null) process.stdout.write(line + "\n");
    if (e.type === "error") tally.errorEvents += 1;
    if (e.type === "verify_result" && !e.ok) tally.verifyRed = true;
    if (e.type === "tool_result") {
      if (gateDenied(e)) tally.gateBlocks += 1;
      // 会话末记账轮的失败不算本轮的（X- 层），其余 ok=false 一律算。
      else if (!e.ok && !isSessionEndBookkeeping(e)) tally.plainToolFailures += 1;
    }
  };

  setAppHooks({
    onEvent,
    // 没人能答时**当场结算**（同一个 tick 内 decide），不等 AskGate 那个 60s 定时器：管道里等 60s
    // 再拒，用户看到的就是「卡了一分钟然后失败」，而那不是任何人的真实体验。
    onAsk: (req) => {
      if (unattended) handleAgentDecide(req.askId, false);
      else promptForApproval(rl, () => rlClosed, req);
    },
  });

  // --compact 不跑目标轮，但**真的要调模型**（compactSessionLog 里的摘要器），所以它自己带
  // try：抛错要变成 exit 1 + 一行 stderr，不许把栈喷到用户脸上。
  if (opts.compact) {
    try {
      const r = await handleCompact({ sessionId: opts.sessionId });
      if (!r.ok) {
        process.stderr.write(paint(RED, `[m0] 压缩失败：${r.error ?? "未知原因"}\n`));
        return EXIT_FAILED;
      }
      process.stdout.write(paint(DIM, `已压缩会话 ${opts.sessionId}（${opts.logPath}）\n`));
      return EXIT_OK;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(paint(RED, `[m0] 压缩失败：${msg}\n`));
      return EXIT_FAILED;
    } finally {
      rl.close();
      killAllTrackedChildren();
    }
  }

  try {
    // --goal 必须**先于** handleAgentRun 写进同一份 JSONL：续跑判据是 run 收束时 projectGoal
    // 重放这条日志读出来的，run 里再设就晚一轮。
    if (opts.goal !== null) {
      const g = await handleGoalSet({
        sessionId: opts.sessionId,
        objective: opts.goal.objective,
        ...(opts.goal.maxTurns === undefined ? {} : { maxTurns: opts.goal.maxTurns }),
        ...(opts.goal.maxUsd === undefined ? {} : { maxUsd: opts.goal.maxUsd }),
      });
      if (!g.ok) {
        process.stderr.write(paint(RED, `[m0] 目标未设：${g.error ?? "未知原因"}\n`));
        return EXIT_USAGE;
      }
      for (const c of g.clamped ?? []) {
        process.stderr.write(paint(YELLOW, `[m0] 目标参数已收敛：${c}\n`));
      }
    }

    const r = await handleAgentRun(
      { message: opts.message, mode: opts.mode },
      {
        workspace: opts.workspace,
        logPath: opts.logPath,
        ...(opts.wireSession ? { sessionId: opts.sessionId } : {}),
        // **这里刻意不传 onEvent**。`handleAgentRun` 的事件有两个出口（agent-runner.ts:1808-1814）：
        // 每轮的 `over.onEvent`，与全局的 `hooks.onEvent`（`setAppHooks` 那一个）。它们本该是两个
        // 不同的消费者——前者是本次 run 的 IPC，后者是带 `session_id` 的全局通道，UI 靠它分流。
        // CLI 把同一个渲染函数接到两头 ⇒ **每一行打两遍**（2026-09-28 真机跑当场看见：
        // `⚙ read_file` / `✓ …` / `· tokens` / 整段正文全部成对出现，CLI 基本没法用）。
        // 只接 `hooks.onEvent` 那一头，因为它才是**全的**：goal 的 `goal_set`/`goal_stopped`
        // 走 `emitGoalEvent`，只调 `hooks.onEvent`（:1842）——而那正是「为什么不跑了」唯一
        // 让用户看得见的一格，少了它就又是一次两路不一致。
        // 只把用户显式给的 --unattended 透下去：它还管着会话尾沉淀（runAgent 的 autoMemory，
        // agent-runner.ts:1611），「stdin 非 TTY」不该顺手把那件也关了——那是另一件事。
        ...(opts.unattended ? { unattended: true as const } : {}),
        // 但「这场 run 没有人能应答」本身必须另透一路（noAnswerer）。goal 续跑闸只认
        // `over.unattended`（agent-runner.ts:1818），于是管道里 `m0 --goal …` 会一路自动续跑到
        // 轮次闸（≤25 轮 + 兜底 2）——而这条路上三扇门全 fail-closed 拒 ⇒ 写不了盘、验不出绿
        // ⇒ 没有任何一轮可能成功。叠上 `--model` 表外模型时 `--max-usd` 还因 `spentUsd === null`
        // 整道惰掉（goal.ts:116）⇒ 连美元顶都没有。这与 README「stdin 是管道不会自动续跑」
        // 直接矛盾，也正是 #53 那条裁决要防的形状。
        // 拆成两个槽就是为了不翻转上面那半：沉淀留开，只有续跑停。
        ...(!interactive ? { noAnswerer: true as const } : {}),
        ...(opts.autoVerify ? { autoVerify: true } : {}),
        // 武装了长任务目标 ⇒ 保留 refine_goal（它在无目标时恒 fail-closed，摘掉省 85 tok/轮）。
        ...(opts.goal !== null ? { goalArmed: true as const } : {}),
        // --model 自由档只能走这个槽：那一档的模型名按定义不在 DEFAULT_MODEL_TABLE 里，
        // 过不了 validateRunRequestEnvelope 的登记校验（run-request.ts:48）。
        modelSelection: provider,
        // 定时任务是长驻进程语义（tick 60s / 补跑 7 天 / 并发闸 ≤2），CLI 是一次性进程。
        // 装上那五个工具，模型看得见就会去建，然后每次都撞「调度器未初始化」白烧一轮审批。
        automationTools: false,
      },
    );
    if (!r.ok) {
      process.stderr.write(paint(RED, `[m0] 运行失败：${r.error ?? "未知原因"}\n`));
      tally.errorEvents += 1;
    }
    // M8 增量：跑完后的 worker diff 逐文件审阅（TTY 才弹；被 Ctrl-C 取消的轮次不弹）
    if (!cancelling) {
      try {
        await reviewWorkerDiffs(rl, () => rlClosed, opts);
      } catch (err) {
        process.stderr.write(paint(YELLOW, `[m0] diff 审阅出错（不影响已跑完的这一轮）：${err instanceof Error ? err.message : String(err)}\n`));
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(paint(RED, `[m0] 运行失败：${msg}\n`));
    return EXIT_FAILED;
  } finally {
    // 抛错退出时那一段已收到的正文照样该打出来——它正是判断「模型走到哪一步」的唯一线索。
    flushAssistantText();
    // 接回 killAllTrackedChildren：它零调用的原因是 Electron 入口被删，CLI 正是它的天然调用方。
    // 暴露面是**优雅退出**（SIGINT 带着活着的 bash 子树）；超时路径由 killGroup 覆盖。
    rl.close();
    killAllTrackedChildren();
  }

  process.stdout.write(paint(DIM, `\n事件日志：${opts.logPath}\n`));
  return runFailed(tally) ? EXIT_FAILED : EXIT_OK;
}

// Ctrl-C：先让 run 自己收束（handleRunCancel 触达 interactiveRunAbort ⇒ 轮界收束、门等待按拒结算、
// 落一条可审计的取消），再把子进程收干净。**不要**直接 process.exit(130)——那会把这一轮的
// 事件流截断在半路：转录里最后一条是 tool_call 而没有对应的 tool_result，重放时对不上账。
let cancelling = false;
process.on("SIGINT", () => {
  if (cancelling) {
    // 第二次 Ctrl-C：第一次已经请 run 收束了，它还在跑说明用户等不及。硬退是这时候唯一诚实的动作。
    killAllTrackedChildren();
    process.exit(130);
  }
  cancelling = true;
  const r = handleRunCancel();
  process.stderr.write(
    paint(YELLOW, r.ok ? "\n[m0] 已请求停止，等这一轮收束（再按一次 Ctrl-C 硬退）…\n" : `\n[m0] ${r.error ?? "无活动 run"}\n`),
  );
});

process.exitCode = await main();
