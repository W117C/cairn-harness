// M2e：hook 引擎（§9.5–9.6）。10 事件全接（SubagentStart/SubagentStop 事件源在 M3——本引擎支持
// 事件名，无源时静默不触发）；handler V1 只做 command（http/mcp_tool/prompt/agent 运行跳过 + 警告）。
// 双形态：string = shell form（经 shell 执行），string[] = exec form（直接 spawn，不经 shell）。
// 退出码 0 成功 / 2 阻断（stderr 反馈）/ 其他非阻塞错误；stdout JSON 决策字段（CC 格式）；
// 输出 10k 上限、超限全文落盘；timeout 缺省 600s（UserPromptSubmit 降 30s）、到点 SIGKILL 强杀；
// 同事件多 handler 并行；跨层按 (command+args) 去重；${user_config.*} 禁入 shell-form（装载已拒）。
// 环境变量：插件相关只给 PLUGIN_ROOT / PLUGIN_DATA / PROJECT_DIR（宿主密钥类变量显式剥离）。
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { staticRisk } from "../../permissions/risk";
import { spawnTracked } from "../../tools/process";
import type { HookEventName, LoadedHookDef } from "./types";

/** 输出上限（每流，字符）。 */
export const HOOK_OUTPUT_CAP = 10_000;
/** timeout 缺省（秒）。 */
export const HOOK_TIMEOUT_DEFAULT = 600;
export const HOOK_TIMEOUT_USER_PROMPT = 30;

export interface HookPayload {
  event: HookEventName;
  tool_name?: string;
  tool_args?: Record<string, unknown>;
  tool_response?: string;
  prompt?: string;
  trigger?: string;
}

export interface HookRunResult {
  /** 任何 handler 以 exit 2 或 deny 决策阻断。 */
  blocked: boolean;
  blockReason?: string;
  /** stdout JSON 决策合并：deny > ask > allow；缺省 undefined（未表态 → 走原有权限管线）。 */
  decision?: "allow" | "deny" | "ask";
  /** 上下文回注（SessionStart / UserPromptSubmit / PostToolUse 的 stdout 拼接）。 */
  additionalContext: string;
  /** 非阻塞错误（exit 其他 / 超时 / spawn 失败 / 静态危险拒跑）。 */
  errors: string[];
  /** 超 10k 的全文落盘路径。 */
  overflowFiles: string[];
  ran: number;
  skipped: number;
}

export interface HookExecOutcome {
  code: number | null;
  stdout: string;
  stderr: string;
  killed: boolean;
}

export type HookExecFn = (
  command: string,
  argv: string[],
  shell: boolean,
  env: Record<string, string>,
  cwd: string,
  timeoutSec: number,
) => Promise<HookExecOutcome>;

export interface HookEngineOptions {
  hooks: LoadedHookDef[];
  workspace: string;
  /** PLUGIN_DATA 根（每插件一个子目录）。 */
  pluginDataRoot: string;
  /** 超限输出落盘根（缺省 pluginDataRoot/overflow）。 */
  overflowDir?: string;
  /** 权限档（hook 命令过权限门：read-only 档拒绝有副作用的 hook 命令）。 */
  mode?: "read-only" | "default" | "auto";
  exec?: HookExecFn;
}

interface SanitizedEnv {
  base: Record<string, string>;
}

const ENV_ALLOW = ["PATH", "HOME", "LANG", "TMPDIR", "SHELL", "USER"];
const ENV_SECRET_RE = /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i;

/** 宿主 env 消毒：白名单基础集 + 剥离密钥类变量 + 三个插件变量。 */
export function hookEnv(opts: {
  pluginRoot: string;
  pluginData: string;
  workspace: string;
  extra?: Record<string, string>;
}): Record<string, string> {
  const base: Record<string, string> = {};
  for (const k of ENV_ALLOW) {
    const v = process.env[k];
    if (v !== undefined) base[k] = v;
  }
  // 纵深防御：白名单之外仍混入的密钥类变量不进 hook 子进程
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined || k in base) continue;
    if (!ENV_SECRET_RE.test(k)) continue;
    void v; // 显式丢弃（可读性：这一步是「剥离」不是「保留」）
  }
  const out: SanitizedEnv["base"] = {
    ...base,
    PLUGIN_ROOT: opts.pluginRoot,
    PLUGIN_DATA: opts.pluginData,
    PROJECT_DIR: opts.workspace,
    ...(opts.extra ?? {}),
  };
  return out;
}

function matcherHits(matcher: string | undefined, toolName: string | undefined): boolean {
  if (matcher === undefined) return true;
  if (toolName === undefined) return false;
  try {
    return new RegExp(matcher).test(toolName);
  } catch {
    return toolName === matcher; // 非法正则退化为精确匹配
  }
}

/** 跨层去重键：(command+args) = 命令形态整体（shell 串或 exec argv）。 */
export function dedupKey(h: LoadedHookDef): string {
  return JSON.stringify(h.handler.command);
}

interface ParsedDecision {
  decision?: "allow" | "deny" | "ask";
  reason?: string;
}

/** stdout JSON 决策字段解析（CC 格式：hookSpecificOutput.permissionDecision；旧版 decision/reason）。 */
export function parseHookDecision(stdout: string): ParsedDecision {
  const t = stdout.trim();
  if (!t.startsWith("{")) return {};
  let json: unknown;
  try {
    json = JSON.parse(t);
  } catch {
    return {};
  }
  if (!json || typeof json !== "object") return {};
  const obj = json as Record<string, unknown>;
  const spec = obj.hookSpecificOutput as Record<string, unknown> | undefined;
  if (spec && typeof spec === "object") {
    const d = spec.permissionDecision;
    if (d === "allow" || d === "deny" || d === "ask") {
      return {
        decision: d,
        reason: typeof spec.permissionDecisionReason === "string" ? spec.permissionDecisionReason : undefined,
      };
    }
  }
  const legacy = obj.decision;
  if (legacy === "approve") return { decision: "allow", reason: typeof obj.reason === "string" ? obj.reason : undefined };
  if (legacy === "block") return { decision: "deny", reason: typeof obj.reason === "string" ? obj.reason : undefined };
  return {};
}

function defaultExec(): HookExecFn {
  return async (command, argv, shell, env, cwd, timeoutSec) => {
    return await new Promise<HookExecOutcome>((resolveP) => {
      let stdout = "";
      let stderr = "";
      let killed = false;
      let settled = false;
      const done = (code: number | null): void => {
        if (settled) return;
        settled = true;
        handle.dispose();
        resolveP({ code, stdout, stderr, killed });
      };
      // 进程组 + 超时强制收束：hook 命令是插件提供的 shell 串，孙进程持有 stdout 时
      // 'close' 永不触发会让 hook 永久挂起（P1-2）。env 已由 hookEnv 白名单消毒。
      // shell form：整串交给 /bin/sh；exec form：argv[0] 为可执行文件、其余为参数。
      const handle = spawnTracked(shell ? command : (argv[0] ?? ""), shell ? [] : argv.slice(1), {
        cwd,
        env,
        shell,
        timeoutMs: Math.max(1, timeoutSec) * 1000,
        onTimeout: () => {
          killed = true;
          done(null);
        },
      });
      handle.child.stdout?.on("data", (d: Buffer) => { stdout += d.toString("utf8"); });
      handle.child.stderr?.on("data", (d: Buffer) => { stderr += d.toString("utf8"); });
      handle.child.on("error", () => done(null));
      handle.child.on("close", (code) => done(code));
    });
  };
}

export class HookEngine {
  private opts: HookEngineOptions;
  private exec: HookExecFn;

  constructor(opts: HookEngineOptions) {
    this.opts = opts;
    this.exec = opts.exec ?? defaultExec();
  }

  /** 事件 → 匹配且去重后的 handler 列表（跨层按 (command+args) 去重）。 */
  handlersFor(event: HookEventName, payload: HookPayload): LoadedHookDef[] {
    const seen = new Set<string>();
    const out: LoadedHookDef[] = [];
    for (const h of this.opts.hooks) {
      if (h.event !== event || !h.loaded) continue;
      if (!matcherHits(h.matcher, payload.tool_name)) continue;
      const key = dedupKey(h);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(h);
    }
    return out;
  }

  /** 静态危险检测 + 权限门（hook 命令不是特权通道）。 */
  gateHook(h: LoadedHookDef): string | null {
    if (h.handler.type !== "command") {
      return null; // 非 command 类型不跑（由 run() 统一记 skipped 警告）
    }
    const command = typeof h.handler.command === "string" ? h.handler.command : h.handler.command.join(" ");
    if (this.opts.mode === "read-only") {
      // 只读档：hook 命令也不得有副作用面（静态通道任何命中都拒跑）
      const r = staticRisk("run_shell", { command });
      if (r.level !== "none") return "只读档拒绝有副作用 hook 命令（" + r.reason + "）";
    }
    const risk = staticRisk("run_shell", { command });
    if (risk.level === "high" || risk.level === "critical") {
      return "hook 命令静态危险检测命中（" + risk.reason + "）——拒跑";
    }
    return null;
  }

  /** 触发一轮 hook（同事件多 handler 并行，Promise.all）。 */
  async run(event: HookEventName, payload: HookPayload): Promise<HookRunResult> {
    const result: HookRunResult = { blocked: false, additionalContext: "", errors: [], overflowFiles: [], ran: 0, skipped: 0 };
    const handlers = this.handlersFor(event, payload);
    if (handlers.length === 0) return result; // 空注册表 = 零行为（既有门字节不变的根基）

    const timeouts: number[] = [];
    for (const h of handlers) {
      if (h.handler.type !== "command") {
        result.skipped++;
        result.errors.push("handler 类型 " + h.handler.type + " 本轮不支持，跳过 + 警告（插件 " + h.plugin + "）");
        continue;
      }
      const denied = this.gateHook(h);
      if (denied) {
        result.skipped++;
        result.errors.push("hook 拒跑（插件 " + h.plugin + "）：" + denied);
        continue;
      }
      timeouts.push(typeof h.handler.timeout === "number" ? h.handler.timeout : event === "UserPromptSubmit" ? HOOK_TIMEOUT_USER_PROMPT : HOOK_TIMEOUT_DEFAULT);
    }
    const runnable = handlers.filter((h) => h.handler.type === "command" && this.gateHook(h) === null);

    const outcomes = await Promise.all(runnable.map(async (h, i) => {
      const shell = typeof h.handler.command === "string";
      const command = shell ? (h.handler.command as string) : (h.handler.command as string[])[0] ?? "";
      const argv = shell ? [] : (h.handler.command as string[]).slice(1);
      const pluginRoot = this.pluginRootOf(h);
      const env = hookEnv({
        pluginRoot,
        pluginData: join(this.opts.pluginDataRoot, h.plugin),
        workspace: this.opts.workspace,
      });
      const out = await this.exec(command, argv, shell, env, this.opts.workspace, timeouts[i] ?? HOOK_TIMEOUT_DEFAULT);
      return { h, out };
    }));

    for (const { h, out } of outcomes) {
      result.ran++;
      const stdout = out.stdout;
      const stderr = out.stderr;
      if (stdout.length > HOOK_OUTPUT_CAP) {
        const file = await this.persistOverflow(h, event, stdout);
        result.overflowFiles.push(file);
      }
      if (out.killed) {
        result.errors.push("hook 超时被强杀（插件 " + h.plugin + "，" + event + "）");
        continue;
      }
      if (out.code === 2) {
        result.blocked = true;
        const reason = (stderr.length > HOOK_OUTPUT_CAP ? stderr.slice(0, HOOK_OUTPUT_CAP) : stderr).trim();
        result.blockReason = reason !== "" ? reason : "hook exit 2（插件 " + h.plugin + "）";
        continue;
      }
      if (out.code !== 0) {
        result.errors.push("hook 非零退出 " + String(out.code) + "（插件 " + h.plugin + "，非阻塞）");
        continue;
      }
      const parsed = parseHookDecision(stdout);
      if (parsed.decision) {
        result.decision = mergeDecision(result.decision, parsed.decision);
        if (parsed.reason && result.decision === "deny" && !result.blockReason) result.blockReason = parsed.reason;
        continue; // JSON 决策输出不进上下文
      }
      // 上下文事件：exit 0 的 stdout（非 JSON）回注（PostToolUseFailure 同样反馈给模型）
      if (event === "SessionStart" || event === "UserPromptSubmit" || event === "PostToolUse" || event === "PostToolUseFailure") {
        const text = stdout.length > HOOK_OUTPUT_CAP ? stdout.slice(0, HOOK_OUTPUT_CAP) : stdout;
        if (text.trim() !== "") {
          result.additionalContext += (result.additionalContext === "" ? "" : "\n") + text.trim();
        }
      }
    }
    if (result.decision === "deny" && !result.blocked) {
      result.blocked = true;
      result.blockReason = result.blockReason ?? "hook 决策 deny";
    }
    return result;
  }

  private pluginRootOf(h: LoadedHookDef): string {
    return h.pluginRoot || this.opts.workspace;
  }

  private async persistOverflow(h: LoadedHookDef, event: HookEventName, full: string): Promise<string> {
    const dir = this.opts.overflowDir ?? join(this.opts.pluginDataRoot, "overflow");
    await mkdir(dir, { recursive: true });
    const file = join(dir, event + "-" + h.plugin + "-" + String(Date.now()) + ".txt");
    await writeFile(file, full, "utf8");
    return file;
  }
}

/** 决策合并（deny > ask > allow）。 */
export function mergeDecision(
  a: HookRunResult["decision"],
  b: NonNullable<HookRunResult["decision"]>,
): NonNullable<HookRunResult["decision"]> {
  const rank = { deny: 3, ask: 2, allow: 1 } as const;
  if (a === undefined) return b;
  return rank[a] >= rank[b] ? a : b;
}
