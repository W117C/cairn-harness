// M2e：hook 引擎（§9.5–9.6）。**10 个事件全部有生产者**（SessionStart / UserPromptSubmit / Pre+PostToolUse
// 与 Failure / PreCompact / Stop / SessionEnd / SubagentStart / SubagentStop）。PreCompact 的发点在
// `runCompaction` 自己身上（§9.5 表里的 manual/auto 两档、三条压缩路径的唯一必经点，不在各调用方各抄一份）。
// 剩一处口径没打满，是有意的：Stop 与 Subagent* 的 exit 2 语义是
// "要求再多跑一轮模型"——那要花真钱，未裁（任务 #32），所以这三条的回执只出声不拦、不改收束行为。
// 双形态：string = shell form（经 shell 执行），string[] = exec form（直接 spawn，不经 shell）。
// 退出码 0 成功 / 2 阻断（stderr 反馈）/ 其他非阻塞错误；stdout JSON 决策字段（CC 格式）；
// 输出 10k 上限、超限全文落盘；timeout 缺省 600s（UserPromptSubmit 降 30s）、到点 SIGKILL 强杀；
// 同事件多 handler 并行；跨层按 handler 身份去重；${user_config.*} 禁入 shell-form（装载已拒）。
// 环境变量：插件相关只给 PLUGIN_ROOT / PLUGIN_DATA / PROJECT_DIR（宿主密钥类变量显式剥离）。
// 四档传输（第 1000 / 1001 页）：command 走 spawn、http 走 POST（体与 stdin 同一份 payload JSON）、
// mcp_tool 走 McpManager.callTool（与模型可见调用同一张裁剪表）、prompt 走注入的模型面（出站前过 redactSecrets）。
// 四档折进**同一套**决策/回注/错误语义，只有措辞按传输区分（把 HTTP 503 说成「非零退出 503」、把请求中止说成
// 「SIGKILL 强杀」都是假话）；成功但有条件的事（剥过密钥、只回了一半）走 `notes`，同样进可见回执。
// agent 档仍未兑现：装载期按「未兑现」拒载并出声，不是运行时一行刷掉的警告。
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isShellFamily, staticRisk } from "../../permissions/risk";
import { redactSecrets } from "../../events/redact";
import { createChunkText } from "../../tools/output-ring";
import type { PermissionMode } from "../../permissions/modes";
import type { McpGrade } from "../../permissions/autonomy";
import { CC_TOOL_ALIAS } from "../../tools/base";
import { sanitizedEnv, spawnTracked } from "../../tools/process";
import type { HookEventName, HookHandlerDef, HookHandlerType, HttpHookHandler, LoadedHookDef, McpToolHookHandler, PromptHookHandler } from "./types";
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
 *  未给出的字段**整键缺席**——空串/null 会被钩子当成"有值但为空"，那是伪造输入。
 *  这一份同时是 command 档的 stdin 与 http 档的请求体：一份 payload 契约，两种传输。 */
export function hookPayloadJson(payload: HookPayload, cwd: string, sessionId?: string): Record<string, unknown> {
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
  return json;
}

export function hookStdinJson(payload: HookPayload, cwd: string, sessionId?: string): string {
  return JSON.stringify(hookPayloadJson(payload, cwd, sessionId));
}

/** http 档只接受 http(s)。`file:` / `data:` / `javascript:` 之类会把「发个钩子请求」变成一条
 *  新的本地读取通道——那不在钩子的职权里（command 档要读本地文件用的是 fs，早就在权限面与危险检测里）。 */
export function hookUrlAllowed(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return url.protocol === "http:" || url.protocol === "https:";
}

/** 尚未兑现的 handler 档（运行侧没有传输实现）：装载期就点名，而不是等运行时一行刷掉的警告。 */
const UNHONORED_HANDLER_TYPES: readonly HookHandlerType[] = ["agent"];

/** handler 形态与类型是否相称。返回拒载原因（`null` = 形态合法）。
 *  这是装载期的唯一判口——`discover.ts` 用它决定 `loaded`，运行时兜底复用它，两处不会漂。 */
export function hookShapeRejection(handler: HookHandlerDef): string | null {
  switch (handler.type) {
    case "command": {
      const c = handler.command;
      const ok = (typeof c === "string" && c.trim() !== "") || (Array.isArray(c) && c.length > 0 && c.every((a) => typeof a === "string"));
      return ok ? null : "command 档的 command 不是非空命令串或非空 argv";
    }
    case "http": {
      const url = handler.url;
      if (typeof url !== "string" || url.trim() === "") return "http 档缺 url（请求无处可发）";
      // 模板未展开前也可能不可解析（`${user_config.base}/hook`）：带占位符的 URL 放到执行期校验展开结果。
      if (url.includes("${")) return null;
      return hookUrlAllowed(url) ? null : "http 档的 url 协议不是 http(s)（只放行 http/https）：" + url.slice(0, 200);
    }
    case "mcp_tool":
      if (typeof handler.server !== "string" || handler.server.trim() === "") return "mcp_tool 档缺 server（不知道打哪台）";
      if (typeof handler.tool !== "string" || handler.tool.trim() === "") return "mcp_tool 档缺 tool（不知道打哪个工具）";
      return null;
    case "prompt":
      return typeof handler.prompt === "string" && handler.prompt.trim() !== ""
        ? null
        : "prompt 档缺 prompt（没有指令的模型调用不知道该判什么）";
    case "agent":
      return UNHONORED_HANDLER_TYPES.includes(handler.type)
        ? handler.type + " 档尚未兑现（装载即拒；运行侧没有这条 handler 的传输实现）"
        : "未知 handler 类型 " + String((handler as { type?: unknown }).type);
    default:
      return "未知 handler 类型 " + String((handler as { type?: unknown }).type);
  }
}

/** `${path}` 按 payload 对象展开（点分路径）。整串就是一个占位符时保留原类型（数组/对象/数字不强行 stringify）；
 *  嵌在长串里时按字符串拼接。取不到的路径原样保留，由调用方判定并出声——绝不静默送字面量。 */
export function expandHookTemplate(value: unknown, source: Record<string, unknown>): { value: unknown; missing: string[] } {
  const missing: string[] = [];
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      const whole = /^\$\{([A-Za-z0-9_.-]+)\}$/.exec(v);
      if (whole !== null) {
        const found = lookupPath(source, whole[1]);
        if (found.missing) missing.push(whole[1]);
        return found.value;
      }
      return v.replace(/\$\{([A-Za-z0-9_.-]+)\}/g, (all, path: string) => {
        const found = lookupPath(source, path);
        if (found.missing) { missing.push(path); return all; }
        return typeof found.value === "string" ? found.value : JSON.stringify(found.value) ?? "";
      });
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === "object") {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, item]) => [k, walk(item)]));
    }
    return v;
  };
  return { value: walk(value), missing };
}

function lookupPath(source: Record<string, unknown>, path: string): { value: unknown; missing: boolean } {
  let cur: unknown = source;
  for (const seg of path.split(".")) {
    if (cur === null || typeof cur !== "object" || !(seg in (cur as Record<string, unknown>))) return { value: undefined, missing: true };
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur === undefined ? { value: undefined, missing: true } : { value: cur, missing: false };
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
  /** 回执措辞：command 说「退出码」，http 说「HTTP 状态」，mcp_tool 说「MCP 调用」，prompt 说「模型调用」。
   *  三档共用同一套折叠（决策/上下文/错误），但把 503 报成「非零退出 503」是假话。 */
  wording?: "http" | "mcp" | "model";
  /** 成功也要让读者看见的事（出站前剥了几处密钥形态、回文只写了一半）。
   *  这不是错误路径：钩子确实跑了、结论也确实可用，但"可用"是有条件的——把条件藏起来就等于谎称完整。 */
  notes?: string[];
}

/** http 档的传输面（POST + JSON 体；体积帽与超时帽在引擎里，不在这一层）。 */
export interface HookFetchResult {
  status: number;
  body: string;
}
export type HookFetchFn = (url: string, init: {
  method: "POST";
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
}) => Promise<HookFetchResult>;

/** mcp_tool 档的调用面：与模型可见的 MCP 工具走同一个 `McpManager.callTool`，
 *  因此 include/exclude 裁剪、超时、取消、失败态都是同一份纪律。 */
export type HookMcpCallFn = (plugin: string, server: string, tool: string, args: Record<string, unknown>) =>
  Promise<{ ok: boolean; output: string }>;

/** prompt 档的模型面：`(system, user, timeoutMs) → 文本`。由装配层注入（`createHookModelCall`），
 *  判卷注入替身 ⇒ 没有 key 也能量这条链，且绝不偷偷打真网络。 */
export interface HookModelResult {
  ok: boolean;
  text: string;
  /** provider 侧的"没写完"原文（`turn_truncated` 的 stop_reason）。缺席 = 写完。 */
  truncated?: string;
  error?: string;
}
export type HookModelCallFn = (system: string, user: string, timeoutMs: number) => Promise<HookModelResult>;

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
  /** http 档的传输面。缺省 = 真 fetch（带超时与体积帽）；判卷注入替身，不碰网络。 */
  fetch?: HookFetchFn;
  /** mcp_tool 档的调用面。缺省 = 不注入 ⇒ 这条 handler 如实失败（不是静默跳过）：
   *  运行时没有 MCP 通道时，"钩子跑了" 必须是假的。由 PluginRuntime 接到 McpManager.callTool。 */
  mcpCall?: HookMcpCallFn;
  /** 工具副作用标注（与模型可见面同一份 `McpGrade`）。只读档用它决定 mcp_tool 钩子跑不跑：
   *  标注 readOnly 且非 destructive 才放行——拿不到标注就拒，钩子不是绕过降档的后门。 */
  mcpToolGrade?: (plugin: string, server: string, tool: string) => McpGrade | undefined;
  /** prompt 档的模型面。缺省 = 不注入 ⇒ 这条 handler 在闸上如实拒（不占「跑了」的计数）：
   *  没有凭证/没有装配会话时，"模型判过了"必须是假的。由 PluginRuntime 接 `createHookModelCall`。 */
  modelCall?: HookModelCallFn;
  /** §9.5 userConfig 取值面（按插件给）。缺席 = 不展开、不设 PLUGIN_OPTION_*（零行为，旧调用方逐字不变）。
   *  值来自明文配置 + safeStorage，敏感位只进子进程 env / http 头，不进正文/事件流/日志。 */
  userConfigValues?: (plugin: string) => Record<string, string>;
  /** 敏感键名：**只进 env（PLUGIN_OPTION_*）与 http 头**，不进 argv，也不进任何回执文本。 */
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

/** 跨层去重键：按类型分域的「这条钩子的身份」。
 *  旧实现是 `JSON.stringify(h.handler.command)`——非 command 档没这个字段，键恒为 `undefined`，
 *  于是两条不同的 http / mcp_tool 钩子在 `seen` 里长得一模一样，第二条被**静默吞掉**。
 *  URL 用模板原文（展开后的值可能含密钥，身份不该把密钥抄进一张可能被日志读走的表）。 */
export function dedupKey(h: LoadedHookDef): string {
  const handler = h.handler;
  switch (handler.type) {
    case "http":
      return "http:" + handler.url;
    case "mcp_tool":
      return "mcp:" + handler.server + "/" + handler.tool + JSON.stringify(handler.args ?? null);
    case "prompt":
      // 身份 = 指令模板（展开后的值可能带密钥，不进这张可能被读走的表）。
      return "prompt:" + handler.prompt;
    case "command":
      return "command:" + JSON.stringify(handler.command);
    default:
      return "unsupported:" + String(handler.type);
  }
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

/** http 档的缺省传输：真 fetch，带超时（到点 AbortSignal 抛，落进非阻塞错误）与体积帽。
 *  体积帽按 4× 输出上限读——超限全文落盘那条纪律不能被一次 200MB 响应顶穿。 */
function defaultFetch(): HookFetchFn {
  return async (url, init) => {
    const res = await fetch(url, {
      method: init.method,
      headers: init.headers,
      body: init.body,
      signal: AbortSignal.timeout(init.timeoutMs),
    });
    return { status: res.status, body: (await res.text()).slice(0, HOOK_OUTPUT_CAP * 4) };
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
  private httpFetch: HookFetchFn | null;

  constructor(opts: HookEngineOptions) {
    this.opts = opts;
    this.exec = opts.exec ?? defaultExec();
    // 不注入 = 用真 fetch；显式传 null 语义不存在（可选参数缺省即缺省），判卷传替身走 opts.fetch。
    this.httpFetch = opts.fetch ?? defaultFetch();
  }

  /** worker 档视图（§9.10「worker 继承主会话插件启用集」的最小权限半边）：
   *  read worker 不得拿主会话的宽档去跑有副作用的钩子命令——权限档策略留在引擎这一处，
   *  不抄到调用方去（本仓点名的「同族出口策略副本」）。write worker 沿用原档。 */
  forWorkerMode(mode: "read" | "write"): HookEngine {
    return mode === "read" ? new HookEngine({ ...this.opts, mode: "read-only" }) : this;
  }

  /** prompt 档的模型面**晚绑定**：会话拨哪一档要等 provider 装配完才知道（`agent-runner` 里
   *  `modelSelection` 定下来之后、loop 起之前那一处），而 `PluginRuntime.load` 在那之前。
   *  只有这一处绑定点 ⇒ 旁路不会再自成一派取料口（第 1001 页那条缺陷的形状就是"装配前注入"）。
   *  没绑过 = `gateHook` 拒并出声；`forWorkerMode` 在绑定之后才建视图，worker 档自动跟上。 */
  bindModelCall(call: HookModelCallFn): void {
    this.opts.modelCall = call;
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

  /** 静态危险检测 + 权限门（hook 不论走哪档传输都不是特权通道）。 */
  gateHook(h: LoadedHookDef): string | null {
    // 形态兜底：装载期已按同一口径判过（discover.ts），执行面复用同一个纯函数，不留第二份规则。
    const shape = hookShapeRejection(h.handler);
    if (shape !== null) return shape;
    const handler = h.handler;
    if (handler.type === "http" && this.opts.mode === "read-only") {
      // 只读档连"往本机写文件"都拒，一条 POST 到别人家的请求同样是副作用——而且我们看不到对面做了什么。
      return "只读档拒绝 http hook（网络请求同样是副作用，插件 " + h.plugin + "）";
    }
    if (handler.type === "mcp_tool") {
      // 通道不在 = 跑不了：在闸上说清，别让一条永远不会响的钩子占着「跑了」的计数。
      if (!this.opts.mcpCall) return "运行时未注入 MCP 调用面（server " + handler.server + " 打不了）";
      if (this.opts.mode !== "read-only") return null;
      // 与模型可见面同一条纪律：只有**标注了 readOnly 且非 destructive** 的工具能在只读档跑。
      // 没标注/取不到标注 = 拒——钩子不是绕过降档的后门。
      const grade = this.opts.mcpToolGrade?.(h.plugin, handler.server, handler.tool);
      if (grade === undefined) return "只读档拒绝 mcp_tool hook（server " + handler.server + " 的工具 " + handler.tool + " 没有副作用标注）";
      if (grade.destructive === true) return "只读档拒绝 mcp_tool hook（工具 " + handler.tool + " 标注 destructive）";
      if (grade.readOnly !== true) return "只读档拒绝 mcp_tool hook（工具 " + handler.tool + " 未标注 readOnly）";
      return null;
    }
    if (handler.type === "prompt") {
      if (!this.opts.modelCall) return "运行时未注入模型调用面（prompt 钩子判不了）";
      return null;
    }
    if (handler.type !== "command") return null;
    const command = typeof handler.command === "string" ? handler.command : handler.command.join(" ");
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

  /** 单条 handler 的超时帽（秒）：四档传输共用——「按事件收口」这条规则不该只服务 shell。 */
  private timeoutSecFor(event: HookEventName, h: LoadedHookDef): number {
    const declared = h.handler.timeout;
    if (typeof declared === "number") return Math.min(Math.max(1, declared), HOOK_TIMEOUT_MAX);
    if (event === "UserPromptSubmit") return HOOK_TIMEOUT_USER_PROMPT;
    if (event === "SessionEnd") return HOOK_TIMEOUT_SESSION_END;
    return HOOK_TIMEOUT_DEFAULT;
  }

  /** 按 handler 类型选传输，结果一律折成 HookExecOutcome——决策、上下文回注、10k 帽、
   *  溢出落盘、错误回执因此只有一套语义（三档各写一遍必漂）。 */
  private async dispatch(h: LoadedHookDef, payload: HookPayload, timeoutSec: number): Promise<HookExecOutcome> {
    if (h.handler.type === "http") return await this.dispatchHttp(h, h.handler, payload, timeoutSec);
    if (h.handler.type === "mcp_tool") return await this.dispatchMcp(h, h.handler, payload, timeoutSec);
    if (h.handler.type === "prompt") return await this.dispatchPrompt(h, h.handler, payload, timeoutSec);
    return await this.dispatchCommand(h, payload, timeoutSec);
  }

  /** prompt 档：把**同一份 payload JSON** 交给模型判一次（与 stdin / http 体同源）。
   *  两条纪律是从别处抄来的现成规矩，不是这里新立的：
   *  ① 出站前过 `src/events/redact.ts` 那把唯一的密钥形态尺——命中 critical（私钥块一类）就**不出站**，
   *     只脱敏后照发等于把"这条钩子会外泄"变成常态；剥了几处必须让读者看见，否则他以为模型看到了原文。
   *  ② `turn_truncated` 那种"没写完"不许当完整结论（同 `createSessionSummarizer` 里那句
   *     「收下但不声张就等于没收」）。 */
  private async dispatchPrompt(h: LoadedHookDef, handler: PromptHookHandler, payload: HookPayload, timeoutSec: number): Promise<HookExecOutcome> {
    const call = this.opts.modelCall;
    if (!call) return { code: null, stdout: "", stderr: "", killed: false, wording: "model", error: "运行时未注入模型调用面" };
    const source = hookPayloadJson(payload, this.opts.workspace, this.opts.sessionId);
    const promptExpanded = expandHookTemplate(handler.prompt, source);
    if (promptExpanded.missing.length > 0) {
      return { code: null, stdout: "", stderr: "", killed: false, wording: "model", error: "prompt 里的 ${" + promptExpanded.missing[0] + "} 在本次 payload 里取不到（不把它当字面量发给模型）" };
    }
    const systemText = typeof promptExpanded.value === "string" ? promptExpanded.value : JSON.stringify(promptExpanded.value) ?? "";
    const userText = hookStdinJson(payload, this.opts.workspace, this.opts.sessionId);
    const sysScan = redactSecrets(systemText);
    const userScan = redactSecrets(userText);
    if (sysScan.blocked || userScan.blocked) {
      return { code: null, stdout: "", stderr: "", killed: false, wording: "model", error: "本次 payload 含 critical 密钥形态（私钥块一类）⇒ 不出站" };
    }
    const masked = sysScan.findings.length + userScan.findings.length;
    try {
      const res = await call(sysScan.text, userScan.text, Math.max(1, timeoutSec) * 1000);
      if (!res.ok) {
        return { code: 1, stdout: "", stderr: res.error ?? "", killed: false, wording: "model", error: (res.error ?? "模型调用失败").slice(0, 200) };
      }
      const notes: string[] = [];
      if (masked > 0) notes.push("prompt 钩子出站前剥了 " + String(masked) + " 处密钥形态（模型看到的不是原文）");
      if (res.truncated !== undefined) notes.push("模型未写完（stop_reason " + res.truncated + "）⇒ 下面这段是半份结论，别当完整判断用");
      return { code: 0, stdout: res.text, stderr: "", killed: false, wording: "model", ...(notes.length > 0 ? { notes } : {}) };
    } catch (err) {
      return { code: null, stdout: "", stderr: "", killed: false, wording: "model", error: "模型调用异常：" + (err instanceof Error ? err.message : String(err)).slice(0, 200) };
    }
  }

  private async dispatchCommand(h: LoadedHookDef, payload: HookPayload, timeoutSec: number): Promise<HookExecOutcome> {
    if (h.handler.type !== "command") return { code: null, stdout: "", stderr: "", killed: false, error: "handler 形态与 command 档不符" };
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
    const env = hookEnv({
      pluginRoot: this.pluginRootOf(h),
      pluginData: join(this.opts.pluginDataRoot, h.plugin),
      workspace: this.opts.workspace,
      // §9.5：hook 进程经 PLUGIN_OPTION_<KEY> 取 userConfig 值（含 sensitive——只进子进程 env，
      // 不进正文/事件流/日志）。宿主密钥类变量仍由 ENV_ALLOW 白名单拦在外面。
      extra: pluginOptionEnv(cfgValues),
    });
    return await this.exec(command, argv, shell, env, this.opts.workspace, timeoutSec,
      hookStdinJson(payload, this.opts.workspace, this.opts.sessionId));
  }

  /** http 档：POST 同一份 payload JSON（与 command 档的 stdin 逐字同源）。
   *  折叠口径：2xx ⇒ 体当 stdout（JSON 决策体同 command 生效，非 JSON 走上下文回注）；
   *  非 2xx / 异常 / 超时 ⇒ 非阻塞错误。SSRF 面没有新增——command 档本来就能 curl 任意地址，
   *  真正的闸是插件信任门；这里新增的是**协议**限制（file:/data: 拒），别把它当新通道。 */
  private async dispatchHttp(h: LoadedHookDef, handler: HttpHookHandler, payload: HookPayload, timeoutSec: number): Promise<HookExecOutcome> {
    if (!this.httpFetch) {
      return { code: null, stdout: "", stderr: "", killed: false, wording: "http", error: "运行时未注入 http 传输面" };
    }
    const cfgValues = this.opts.userConfigValues?.(h.plugin) ?? {};
    const url = expandUserConfig(handler.url, cfgValues);
    if (!hookUrlAllowed(url)) {
      // 展开后也要过一遍：模板本身合法不代表值合法（`${user_config.base}` 可以指向 file:）。
      return { code: null, stdout: "", stderr: "", killed: false, wording: "http", error: "url 协议不是 http(s)：" + handler.url.slice(0, 200) };
    }
    const headers: Record<string, string> = { "content-type": "application/json" };
    for (const [k, v] of Object.entries(handler.headers ?? {})) {
      headers[k.toLowerCase()] = expandUserConfig(v, cfgValues);
    }
    try {
      const res = await this.httpFetch(url, {
        method: "POST",
        headers,
        body: hookStdinJson(payload, this.opts.workspace, this.opts.sessionId),
        timeoutMs: Math.max(1, timeoutSec) * 1000,
      });
      const ok = res.status >= 200 && res.status < 300;
      return {
        code: ok ? 0 : res.status,
        stdout: ok ? res.body : "",
        stderr: ok ? "" : "HTTP " + String(res.status),
        killed: false,
        wording: "http",
        ...(ok ? {} : { error: "HTTP 状态 " + String(res.status) }),
      };
    } catch (err) {
      // AbortSignal.timeout 到点是 TimeoutError（部分运行时是 AbortError）：那就是「超时被中止」，
      // 不是「对面拒了」——把两者都说成"失败"，排查的人会去查网络而不是查钩子作者的 URL。
      const name = err instanceof Error ? err.name : "";
      const timedOut = name === "TimeoutError" || name === "AbortError";
      const detail = (err instanceof Error ? err.message : String(err)).slice(0, 200);
      // 回声模板而不是展开后的 URL：后者可能带着 Authorization 要用的那个敏感值。
      return timedOut
        ? { code: null, stdout: "", stderr: "", killed: true, wording: "http", error: "http 请求超时（url " + handler.url.slice(0, 200) + "）" }
        : { code: null, stdout: "", stderr: "", killed: false, wording: "http", error: "http 请求失败：" + detail + "（url " + handler.url.slice(0, 200) + "）" };
    }
  }

  /** mcp_tool 档：走 `McpManager.callTool` 这一个口子——连接态、include/exclude 裁剪、超时、
   *  取消都在同一处生效。args 的 `${path}` 按 payload 展开；取不到值 ⇒ 不跑并点名（不送字面量）。 */
  private async dispatchMcp(h: LoadedHookDef, handler: McpToolHookHandler, payload: HookPayload, timeoutSec: number): Promise<HookExecOutcome> {
    if (!this.opts.mcpCall) {
      return { code: null, stdout: "", stderr: "", killed: false, wording: "mcp", error: "运行时未注入 MCP 调用面（server " + handler.server + "）" };
    }
    const source = hookPayloadJson(payload, this.opts.workspace, this.opts.sessionId);
    const expanded = expandHookTemplate(handler.args ?? {}, source);
    if (expanded.missing.length > 0) {
      return { code: null, stdout: "", stderr: "", killed: false, wording: "mcp", error: "args 里的 ${" + expanded.missing[0] + "} 在本次 payload 里取不到（不把它当字面量发出去）" };
    }
    try {
      const res = await this.opts.mcpCall(h.plugin, handler.server, handler.tool, expanded.value as Record<string, unknown>);
      return {
        code: res.ok ? 0 : 1,
        stdout: res.ok ? res.output : "",
        stderr: res.ok ? "" : res.output,
        killed: false,
        wording: "mcp",
        ...(res.ok ? {} : { error: res.output.slice(0, 200) }),
      };
    } catch (err) {
      return { code: null, stdout: "", stderr: "", killed: false, wording: "mcp", error: "MCP 调用异常：" + (err instanceof Error ? err.message : String(err)).slice(0, 200) };
    }
  }

  /** 触发一轮 hook（同事件多 handler 并行，Promise.all）。 */
  async run(event: HookEventName, payload: HookPayload): Promise<HookRunResult> {
    const result: HookRunResult = { blocked: false, additionalContext: "", errors: [], overflowFiles: [], droppedContextHandlers: [], ran: 0, skipped: 0 };
    const handlers = this.handlersFor(event, payload);
    if (handlers.length === 0) return result; // 空注册表 = 零行为（既有门字节不变的根基）

    const plan: { h: LoadedHookDef; timeoutSec: number }[] = [];
    for (const h of handlers) {
      // 读不懂的 if 已经"照样跑"了，这里再留一条执行期回执：装载期警告会被面板刷掉，
      // 而这一次到底按什么语义跑的，得能在当场看见（不静默改语义）。
      if (h.if !== undefined && parseHookIf(h.if) === null) {
        result.errors.push("hook 的 if 语法读不懂（" + h.if + "）⇒ 本次按「总是跑」处理");
      }
      const denied = this.gateHook(h);
      if (denied) {
        result.skipped++;
        result.errors.push("hook 拒跑（插件 " + h.plugin + "）：" + denied);
        continue;
      }
      plan.push({ h, timeoutSec: this.timeoutSecFor(event, h) });
    }

    // 四档传输共用这一条并行轨：同事件多 handler 并行、每条自己限时、结果按同一套语义折叠。
    // 从前这里靠 `timeouts[i]` 与 `runnable` 两个平行数组按索引对齐——两套过滤条件今天恰好相同，
    // 但「两个数组必须永远同步 filter」是隐形契约，加一档传输就会错位（超时帽张冠李戴）。
    const outcomes = await Promise.all(plan.map(async ({ h, timeoutSec }) =>
      ({ h, out: await this.dispatch(h, payload, timeoutSec) })));

    for (const { h, out } of outcomes) {
      result.ran++;
      const stdout = out.stdout;
      const stderr = out.stderr;
      // 措辞跟着传输走：把 HTTP 503 报成「非零退出 503」是把两种失败说成一种（排查的人会去找不存在的退出码）。
      const transportLabel = out.wording === "http" ? "hook HTTP 请求"
        : out.wording === "mcp" ? "hook MCP 调用"
          : out.wording === "model" ? "hook 模型调用"
            : "hook";
      // 成功也要出声的事（剥过密钥形态 / 只回了一半）：藏在 stdout 里会被当上下文照发，
      // 单列进 errors 才是"这条钩子的结论有条件"的可见回执。
      for (const note of out.notes ?? []) result.errors.push(note + "（插件 " + h.plugin + "，" + event + "）");
      if (stdout.length > HOOK_OUTPUT_CAP) {
        const file = await this.persistOverflow(h, event, stdout);
        result.overflowFiles.push(file);
      }
      if (out.killed) {
        // 命令档是被 SIGKILL 强杀的；http/mcp 没有进程可杀，是请求被中止——两件事不能说成一件。
        const killWord = out.wording === undefined ? "强杀" : "中止";
        result.errors.push(transportLabel + " 超时被" + killWord + "（插件 " + h.plugin + "，" + event + "）");
        continue;
      }
      if (out.code === 2) {
        result.blocked = true;
        const reason = capHookReason(stderr).trim();
        result.blockReason = reason !== "" ? reason : "hook exit 2（插件 " + h.plugin + "）";
        continue;
      }
      if (out.code !== 0) {
        result.errors.push(out.wording === undefined
          ? "hook 非零退出 " + String(out.code) + "（插件 " + h.plugin + "，非阻塞）" +
            (out.error !== undefined && out.error !== "" ? "：起进程失败 " + out.error.slice(0, 200) : "")
          : transportLabel + " 未被受理（插件 " + h.plugin + "，" + event + "，非阻塞）" +
            (out.error !== undefined && out.error !== "" ? "：" + out.error.slice(0, 200) : ""));
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
