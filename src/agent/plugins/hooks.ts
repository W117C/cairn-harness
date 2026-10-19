// M2e：hook 引擎（§9.5–9.6）。**10 个事件全部有生产者**（SessionStart / UserPromptSubmit / Pre+PostToolUse
// 与 Failure / PreCompact / Stop / SessionEnd / SubagentStart / SubagentStop）。PreCompact 的发点在
// `runCompaction` 自己身上（§9.5 表里的 manual/auto 两档、三条压缩路径的唯一必经点，不在各调用方各抄一份）。
// 剩一处口径没打满，是有意的：Stop 与 Subagent* 的 exit 2 语义是
// "要求再多跑一轮模型"——那要花真钱，未裁（任务 #32），所以这三条的回执只出声不拦、不改收束行为。
// 双形态：string = shell form（经 shell 执行），string[] = exec form（直接 spawn，不经 shell）。
// 退出码 0 成功 / 2 阻断（stderr 反馈）/ 其他非阻塞错误；stdout JSON 决策字段（CC 格式）；
// 输出 10k 上限、超限全文落盘；timeout 缺省 600s（UserPromptSubmit 降 30s）、到点 SIGKILL 强杀；
// 同事件多 handler 并行；跨层按 (command+args) 去重；${user_config.*} 禁入 shell-form（装载已拒）。
// 环境变量：插件相关只给 PLUGIN_ROOT / PLUGIN_DATA / PROJECT_DIR（宿主密钥类变量显式剥离）。
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isShellFamily, staticRisk } from "../../permissions/risk";
import { createChunkText } from "../../tools/output-ring";
import type { PermissionMode } from "../../permissions/modes";
import { CC_TOOL_ALIAS } from "../../tools/base";
import { sanitizedEnv, spawnTracked } from "../../tools/process";
import type { HookEventName, LoadedHookDef } from "./types";
import { expandUserConfig } from "./skills";

/** 输出上限（每流，字符）。 */
export const HOOK_OUTPUT_CAP = 10_000;
/** 同事件多 handler 的**聚合**预算：逐个各有 10k ≠ 总量有界（数量有界与体积有界是两件事）。 */
export const HOOK_CONTEXT_TOTAL_CHAR_LIMIT = 24_000;
/** 阻断理由进的是 tool_result 里的一行，不是一份报告。 */
export const HOOK_REASON_CHAR_LIMIT = 2_000;

/** 理由收窄：宁可短，也不能让一条 hook 理由吃掉整轮注入面。 */
function capHookReason(text: string): string {
  return text.length > HOOK_REASON_CHAR_LIMIT
    ? text.slice(0, HOOK_REASON_CHAR_LIMIT) + " …[hook 理由超 " + String(HOOK_REASON_CHAR_LIMIT) + " 字符，已截断]"
    : text;
}
/** timeout 缺省（秒）。 */
export const HOOK_TIMEOUT_DEFAULT = 600;
/** 上界与缺省同值：hook 是同步面，单个 handler 挂 10 分钟已经是极限；旧实现接受任意大数。 */
export const HOOK_TIMEOUT_MAX = 600;
export const HOOK_TIMEOUT_USER_PROMPT = 30;
/** 会话终止同样在关键路径上（窗口关闭 / 下一次 run 之前）：不给短帽的话，
 *  一个挂死的 SessionEnd 钩子能把「退出」拖到缺省 600s。 */
export const HOOK_TIMEOUT_SESSION_END = 30;

export interface HookPayload {
  event: HookEventName;
  tool_name?: string;
  tool_args?: Record<string, unknown>;
  tool_response?: string;
  /** 工具调用 id（CC 的 tool_use_id）：钩子要回指同一次调用时唯一的锚。 */
  tool_use_id?: string;
  prompt?: string;
  trigger?: string;
  /** worker 归因（§4.4）：主会话缺省 absent，不折成空串。 */
  agent_id?: string;
  /** SubagentStart/Stop 的 matcher 字段（§9.5 表：agent type）。 */
  agent_type?: string;
}

/** §9.5 的字段名翻译：我们内部叫 tool_args，CC 的钩子读的是 tool_input。
 *  未给出的字段**整键缺席**——空串/null 会被钩子当成"有值但为空"，那是伪造输入。 */
export function hookStdinJson(payload: HookPayload, cwd: string, sessionId?: string): string {
  const json: Record<string, unknown> = { hook_event_name: payload.event, cwd };
  if (sessionId !== undefined) json.session_id = sessionId;
  if (payload.tool_name !== undefined) json.tool_name = payload.tool_name;
  if (payload.tool_args !== undefined) json.tool_input = payload.tool_args;
  if (payload.tool_use_id !== undefined) json.tool_use_id = payload.tool_use_id;
  if (payload.tool_response !== undefined) json.tool_response = payload.tool_response;
  if (payload.prompt !== undefined) json.prompt = payload.prompt;
  if (payload.trigger !== undefined) json.trigger = payload.trigger;
  if (payload.agent_id !== undefined) json.agent_id = payload.agent_id;
  if (payload.agent_type !== undefined) json.agent_type = payload.agent_type;
  return JSON.stringify(json);
}

/** matcher 该配 payload 的哪个字段——§9.5 表逐事件规定，全用 tool_name 会让
 *  SessionStart("startup") / PreCompact("manual") / Subagent*(agent type) 三类 matcher
 *  只能靠缺省命中（写了具体值的钩子静默永不触发）。 */
export function matcherFieldOf(event: HookEventName, payload: HookPayload): string | undefined {
  switch (event) {
    case "PreToolUse":
    case "PostToolUse":
    case "PostToolUseFailure":
      return payload.tool_name;
    case "SessionStart":
    case "PreCompact":
    case "SessionEnd": // §9.5 表：SessionEnd 的 matcher 字段 = 结束原因
      return payload.trigger;
    case "SubagentStart":
    case "SubagentStop":
      return payload.agent_type;
    default:
      return undefined; // Stop / UserPromptSubmit：表里 matcher 为"—"（无匹配字段）
  }
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
  /** 因聚合预算被**整块**省略的 handler（插件名）：不谎称看过，也不截半句冒充全文。 */
  droppedContextHandlers: string[];
  ran: number;
  skipped: number;
}

export interface HookExecOutcome {
  code: number | null;
  stdout: string;
  stderr: string;
  killed: boolean;
  /** 起不来进程的原因（ENOENT / EACCES…）。与 code:null 配对——没有它，"起都没起来"
   *  与"起来了但退出码为空"在错误里长得一模一样。 */
  error?: string;
}

export type HookExecFn = (
  command: string,
  argv: string[],
  shell: boolean,
  env: Record<string, string>,
  cwd: string,
  timeoutSec: number,
  /** §9.5 的 stdin JSON：CC 的 command hook 全靠它知道"这次拦的是哪个文件"。
   *  实现方**必须**写完后 `end()`——不 end 就等于让 `cat`/`jq` 这类读 stdin 的钩子
   *  一直等到超时（缺省 600s）才被强杀，一次工具调用挂成十分钟。 */
  stdin: string,
) => Promise<HookExecOutcome>;

export interface HookEngineOptions {
  hooks: LoadedHookDef[];
  workspace: string;
  /** PLUGIN_DATA 根（每插件一个子目录）。 */
  pluginDataRoot: string;
  /** 超限输出落盘根（缺省 pluginDataRoot/overflow）。 */
  overflowDir?: string;
  /** 权限档（hook 命令过权限门：read-only 档拒绝有副作用的 hook 命令）。
   *  类型取自 `permissions/modes`——这里曾自己抄一份三值 union，加一档时 tsc 才叫得醒。 */
  mode?: PermissionMode;
  /** 会话标识，进 stdin JSON 的 session_id（§9.5）。缺席时整字段不进 JSON——不伪造。 */
  sessionId?: string;
  exec?: HookExecFn;
  /** §9.5 userConfig 取值面（按插件给）。缺席 = 不展开、不设 PLUGIN_OPTION_*（零行为，旧调用方逐字不变）。
   *  由 PluginRuntime 注入：值来自明文配置 + safeStorage，敏感位只进子进程 env。 */
  userConfigValues?: (plugin: string) => Record<string, string>;
  /** 敏感键名：**只进 env（PLUGIN_OPTION_*），不进 argv**。argv 在进程表/崩溃报告/审计里可读，
   *  `["--token","<secret>"]` 等于把 safeStorage 的目标作废。 */
  userConfigSensitive?: (plugin: string) => readonly string[];
}

interface SanitizedEnv {
  base: Record<string, string>;
}

// 宿主 env 白名单**只在 `tools/process.ts` 有一份**：这里原先自己抄了第二个 ENV_ALLOW，
// 且已经漂了——那份少 `TERM`（§11.2 点名的名单里有它），于是 hook 子进程里的颜色/tput 行为
// 与 run_shell 不一致。E11（审查 P3）另记：此处的剥离纪律 = 白名单本身，不再重复一遍密钥名正则。

/** §9.5 的取值通道：userConfig 键 → `PLUGIN_OPTION_<KEY>`（非字母数字下划线归一为 `_`、转大写）。
 *  敏感值只走这条路进子进程，不进任何模型可见文本。 */
export function pluginOptionEnv(values: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) {
    out["PLUGIN_OPTION_" + k.replace(/[^A-Za-z0-9_]/g, "_").toUpperCase()] = v;
  }
  return out;
}

/** 宿主 env 消毒：白名单基础集 + 剥离密钥类变量 + 三个插件变量。 */
export function hookEnv(opts: {
  pluginRoot: string;
  pluginData: string;
  workspace: string;
  extra?: Record<string, string>;
}): Record<string, string> {
  const base: Record<string, string> = {};
  for (const [k, v] of Object.entries(sanitizedEnv())) {
    if (v !== undefined) base[k] = v;
  }
  // E11（审查 P3）：旧实现此处有段"纵深防御剥离密钥变量"的循环，但循环体是 `void v`，
  // 零副作用（out 只 spread base）——死代码已删。真实的剥离纪律 = 白名单本身
  //（不在名单的一律不进 hook 子进程），而白名单的唯一事实源在 `tools/process.ts`。
  const out: SanitizedEnv["base"] = {
    ...base,
    PLUGIN_ROOT: opts.pluginRoot,
    PLUGIN_DATA: opts.pluginData,
    PROJECT_DIR: opts.workspace,
    ...(opts.extra ?? {}),
  };
  return out;
}

/** §9.5「matcher 语义照抄」：`*`/空/缺省 = 全配；纯 [字母数字 _ - 空格 , |] = 精确串列表；
 *  含其他字符 = JS 正则。
 *  旧实现只有「缺省 = 全配 + 一律 RegExp」两档，于是：`"*"` 走到 `new RegExp("*")` 抛错、
 *  回落成 `value === "*"` ⇒ CC hooks.json 里最常见的写法**永不命中**；而 `"Edit"` 这类
 *  纯精确名被当正则做**非锚定**子串匹配 ⇒ 顺手多命中 NotebookEdit / EditFile（钩子在用户
 *  没点名的工具上跑了，比不跑更坏）。 */
function matcherHits(matcher: string | undefined, value: string | undefined): boolean {
  if (matcher === undefined || matcher === "" || matcher === "*") return true;
  if (value === undefined) return false;
  if (/^[A-Za-z0-9_,|\- ]+$/.test(matcher)) {
    const names = matcher.split(/[ ,|]+/).filter((s) => s !== "");
    return names.length > 0 && names.includes(value);
  }
  try {
    return new RegExp(matcher).test(value);
  } catch {
    return value === matcher; // 非法正则退化为精确匹配
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
  return async (command, argv, shell, env, cwd, timeoutSec, stdin) => {
    return await new Promise<HookExecOutcome>((resolveP) => {
      // #55：逐块 `d.toString("utf8")` 会把跨块的多字节字符各变成一个 U+FFFD——hook 的 stdout 是
      // 要回注给模型的上下文（SessionStart / UserPromptSubmit / PostToolUse），不能让解码器改写字节。
      const stdoutText = createChunkText(HOOK_OUTPUT_CAP * 4);
      const stderrText = createChunkText(HOOK_OUTPUT_CAP * 4);
      let killed = false;
      let settled = false;
      let spawnError: string | undefined;
      const done = (code: number | null): void => {
        if (settled) return;
        settled = true;
        handle.dispose();
        resolveP({ code, stdout: stdoutText.text(), stderr: stderrText.text(), killed, error: spawnError });
      };
      // 进程组 + 超时强制收束：hook 命令是插件提供的 shell 串，孙进程持有 stdout 时
      // 'close' 永不触发会让 hook 永久挂起（P1-2）。env 已由 hookEnv 白名单消毒。
      // shell form：整串交给 /bin/sh；exec form：command = 可执行文件本体、argv = 它的参数。
      // ⚠️ 这里曾把 `argv[0]` 当可执行文件、把 argv.slice(1) 当参数——而调用方正相反地传
      // (command, argv)。两侧契约不一致 ⇒ 每条 exec form 钩子都在 spawn 第一个**参数**
      // （`["node","-e",…]` → spawn "-e"）→ ENOENT → 退出码 null。既有钩子单测一律注入
      // 替身 exec 且只看 command，真实 spawn 面从没人跑过，所以缺陷活到了今天。
      const handle = spawnTracked(command, shell ? [] : argv, {
        cwd,
        env,
        shell,
        timeoutMs: Math.max(1, timeoutSec) * 1000,
        onTimeout: () => {
          killed = true;
          done(null);
        },
      });
      handle.child.stdout?.on("data", (d: Buffer) => { stdoutText.push(d); });
      handle.child.stderr?.on("data", (d: Buffer) => { stderrText.push(d); });
      // 写完必 end：读 stdin 的钩子（`cat` / `jq -R`）在拿到 EOF 前永不退出，不 end 就是挂到
      // 超时被强杀。反过来不读 stdin 的钩子会先退出 ⇒ 写入侧 EPIPE 直接吞（退出码由 close 给）。
      handle.child.stdin?.on("error", () => {});
      handle.child.stdin?.write(stdin);
      handle.child.stdin?.end();
      // 起不来的原因必须留着：只报「退出码 null」等于把 ENOENT 报成一个不存在的退出码，
      // 排查的人看不到是谁没找到。
      handle.child.on("error", (err: Error) => { spawnError = err.message; done(null); });
      handle.child.on("close", (code) => done(code));
    });
  };
}

/** §9.5 的 `if`：权限规则语法 best-effort 过滤（CC 原话「硬闸必须走权限系统」——本字段只决定
 *  这条钩子跑不跑，不放宽任何权限）。形态 `Tool` 或 `Tool(<前缀>)`，前缀对该工具的**主参数**做
 *  前缀比较，与 PermissionRule.pattern 的「命令段前缀」同一口径——不另立第二套匹配语言。
 *  CC 的工具名（Bash/Write/…）作解析别名，与 §9.3 的 `${CLAUDE_*}` 别名同思路；
 *  别名表与 skill/command 的工具权限联动共用 src/tools/base 那一张（两处各抄一份就会
 *  「同一个别名在一处认、另一处不认」）。 */

/** 解析不了 → null（装载期出声；执行期按「跑」处理，见 hookIfMatches）。 */
export function parseHookIf(expr: string): { tool: string; prefix: string | null } | null {
  const m = expr.trim().match(/^([A-Za-z0-9_:.-]+)(?:\((.*)\))?$/);
  const rawTool = m?.[1];
  if (rawTool === undefined || rawTool === "") return null;
  const inner = m?.[2];
  if (inner === undefined) return { tool: rawTool, prefix: null };
  const prefix = inner.trim().replace(/\*+$/, "").trim().replace(/:$/, "").trim();
  return { tool: rawTool, prefix: prefix === "" ? null : prefix };
}

/** 主参数：shell 族取 command，其余取 path/file_path（取不到 = 前缀类 `if` 不匹配）。 */
function primaryArgOf(toolName: string, args: Record<string, unknown> | undefined): string | undefined {
  const command = typeof args?.command === "string" ? args.command : undefined;
  if (isShellFamily(toolName)) return command;
  for (const k of ["path", "file_path"]) {
    const v = args?.[k];
    if (typeof v === "string") return v;
  }
  return command;
}

export function hookIfMatches(expr: string | undefined, toolName: string | undefined,
  args: Record<string, unknown> | undefined): boolean {
  if (expr === undefined) return true;
  const parsed = parseHookIf(expr);
  // 读不懂的 `if` 一律**跑**：作者写这道闸是为了拦东西，静默不跑等于把守卫关掉（装载期已另出声）。
  if (parsed === null) return true;
  if (toolName === undefined) return false;
  const want = parsed.tool.toLowerCase();
  const got = toolName.toLowerCase();
  if ((CC_TOOL_ALIAS[want] ?? want) !== got && want !== got) return false;
  if (parsed.prefix === null) return true;
  const value = primaryArgOf(toolName, args);
  return value !== undefined && value.startsWith(parsed.prefix);
}

export class HookEngine {
  private opts: HookEngineOptions;
  private exec: HookExecFn;

  constructor(opts: HookEngineOptions) {
    this.opts = opts;
    this.exec = opts.exec ?? defaultExec();
  }

  /** worker 档视图（§9.10「worker 继承主会话插件启用集」的最小权限半边）：
   *  read worker 不得拿主会话的宽档去跑有副作用的钩子命令——权限档策略留在引擎这一处，
   *  不抄到调用方去（本仓点名的「同族出口策略副本」）。write worker 沿用原档。 */
  forWorkerMode(mode: "read" | "write"): HookEngine {
    return mode === "read" ? new HookEngine({ ...this.opts, mode: "read-only" }) : this;
  }

  /** 事件 → 匹配且去重后的 handler 列表（跨层按 (command+args) 去重）。 */
  handlersFor(event: HookEventName, payload: HookPayload): LoadedHookDef[] {
    const seen = new Set<string>();
    const out: LoadedHookDef[] = [];
    const value = matcherFieldOf(event, payload);
    for (const h of this.opts.hooks) {
      if (h.event !== event || !h.loaded) continue;
      if (!matcherHits(h.matcher, value)) continue;
      // §9.5 的 `if`（权限规则语法 best-effort）：收下不解析等于静默丢弃一条作者写来"只拦这种"的闸。
      if (!hookIfMatches(h.if, payload.tool_name, payload.tool_args)) continue;
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
    const result: HookRunResult = { blocked: false, additionalContext: "", errors: [], overflowFiles: [], droppedContextHandlers: [], ran: 0, skipped: 0 };
    const handlers = this.handlersFor(event, payload);
    if (handlers.length === 0) return result; // 空注册表 = 零行为（既有门字节不变的根基）

    const timeouts: number[] = [];
    for (const h of handlers) {
      // 读不懂的 if 已经"照样跑"了，这里再留一条执行期回执：装载期警告会被面板刷掉，
      // 而这一次到底按什么语义跑的，得能在当场看见（不静默改语义）。
      if (h.if !== undefined && parseHookIf(h.if) === null) {
        result.errors.push("hook 的 if 语法读不懂（" + h.if + "）⇒ 本次按「总是跑」处理");
      }
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
      timeouts.push(typeof h.handler.timeout === "number" ? Math.min(Math.max(1, h.handler.timeout), HOOK_TIMEOUT_MAX)
        : event === "UserPromptSubmit" ? HOOK_TIMEOUT_USER_PROMPT
          : event === "SessionEnd" ? HOOK_TIMEOUT_SESSION_END
            : HOOK_TIMEOUT_DEFAULT);
    }
    const runnable = handlers.filter((h) => h.handler.type === "command" && this.gateHook(h) === null);

    const outcomes = await Promise.all(runnable.map(async (h, i) => {
      const shell = typeof h.handler.command === "string";
      // §9.5：`${user_config.*}` 只进 exec form（shell form 在装载期就被拒载——那串会被 shell 再解析一次）。
      // 执行端展开而不是装载端展开：值来自 safeStorage，装载期（纯静态扫描）不该去碰密钥环。
      const cfgValues = this.opts.userConfigValues?.(h.plugin) ?? {};
      // argv 展开用过滤后的值：敏感键（safeStorage）只走 env，留在 argv 里会被 ps / 崩溃报告读走。
      // 引用敏感键的 argv 保留 `${user_config.<key>}` 字面量（插件应改走 PLUGIN_OPTION_*）。
      const sensitive = new Set(this.opts.userConfigSensitive?.(h.plugin) ?? []);
      const argvValues = Object.fromEntries(Object.entries(cfgValues).filter(([k]) => !sensitive.has(k)));
      const command = shell
        ? (h.handler.command as string)
        : expandUserConfig((h.handler.command as string[])[0] ?? "", argvValues);
      const argv = shell ? [] : (h.handler.command as string[]).slice(1).map((a) => expandUserConfig(a, argvValues));
      const pluginRoot = this.pluginRootOf(h);
      const env = hookEnv({
        pluginRoot,
        pluginData: join(this.opts.pluginDataRoot, h.plugin),
        workspace: this.opts.workspace,
        // §9.5：hook 进程经 PLUGIN_OPTION_<KEY> 取 userConfig 值（含 sensitive——只进子进程 env，
        // 不进正文/事件流/日志）。宿主密钥类变量仍由 ENV_ALLOW 白名单拦在外面。
        extra: pluginOptionEnv(cfgValues),
      });
      const out = await this.exec(command, argv, shell, env, this.opts.workspace, timeouts[i] ?? HOOK_TIMEOUT_DEFAULT,
        hookStdinJson(payload, this.opts.workspace, this.opts.sessionId));
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
        const reason = capHookReason(stderr).trim();
        result.blockReason = reason !== "" ? reason : "hook exit 2（插件 " + h.plugin + "）";
        continue;
      }
      if (out.code !== 0) {
        result.errors.push("hook 非零退出 " + String(out.code) + "（插件 " + h.plugin + "，非阻塞）" +
          (out.error !== undefined && out.error !== "" ? "：起进程失败 " + out.error.slice(0, 200) : ""));
        continue;
      }
      const parsed = parseHookDecision(stdout);
      if (parsed.decision) {
        result.decision = mergeDecision(result.decision, parsed.decision);
        if (parsed.reason && result.decision === "deny" && !result.blockReason) result.blockReason = capHookReason(parsed.reason);
        continue; // JSON 决策输出不进上下文
      }
      // 上下文事件：exit 0 的 stdout（非 JSON）回注（PostToolUseFailure 同样反馈给模型）
      if (event === "SessionStart" || event === "UserPromptSubmit" || event === "PostToolUse" || event === "PostToolUseFailure") {
        const text = stdout.length > HOOK_OUTPUT_CAP ? stdout.slice(0, HOOK_OUTPUT_CAP) : stdout;
        if (text.trim() !== "") {
          // 聚合预算：逐个 handler 各有 10k 上限，N 个拼起来仍可达 N×10k，而这串是要进
          // 每条 tool_result 尾部（loop）/每轮系统文本（agent-runner）的。超预算时**整块省略**
          // 后面的 handler（不截半句冒充全文），并把省了谁如实说出去。
          if (result.additionalContext.length + text.length > HOOK_CONTEXT_TOTAL_CHAR_LIMIT) {
            result.droppedContextHandlers.push(h.plugin);
            continue;
          }
          result.additionalContext += (result.additionalContext === "" ? "" : "\n") + text.trim();
        }
      }
    }
    if (result.droppedContextHandlers.length > 0) {
      result.additionalContext += "\n[hook 上下文预算 " + String(HOOK_CONTEXT_TOTAL_CHAR_LIMIT) +
        " 字符已满，整块省略 " + String(result.droppedContextHandlers.length) +
        " 个 handler 输出（插件 " + result.droppedContextHandlers.join("、") + "）]";
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
