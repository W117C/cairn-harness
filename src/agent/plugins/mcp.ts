// M2e：MCP 适配器（§9.7）。唯一外部协议；官方 TS SDK（@modelcontextprotocol/sdk）；
// stdio + http/sse 两种传输；工具以 mcp__plugin_<plugin>_<server>__<tool> 进统一注册表、
// 走同一权限门、无特权。server 状态 = 事件流投影消费面（statuses() 供面板，无隐藏状态）。
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { withTimeout } from "../../net";
import type { McpGrade } from "../../permissions/autonomy";
import { expandUserConfig } from "./skills";
import type { McpServerConfig, McpServerStatus } from "./types";

/** §9.5：MCP 配置的展开上下文（插件根 / 项目根 / 用户给这个插件填的配置值）。 */
export interface McpExpandRoots {
  pluginRoot?: string;
  projectDir?: string;
  userConfig?: Record<string, string>;
  /** 敏感键：只进 env；command/args 里保留占位符（argv 可被 ps/崩溃报告读到）。 */
  userConfigSensitive?: readonly string[];
}

/** MCP 连接/列工具的默认总时长上限（根因 4）：server 挂起时不让 IPC promise 永久悬空。 */
export const DEFAULT_MCP_CONNECT_MS = 30_000;

/** 审查 S1-3：tools/call 同属「一次性请求」，旧实现无上限——server 进程死掉而 SDK 的
 *  pending 结算链被摘时，在途调用会永久悬空、拖死整个 agent loop。给一个宽松的总时长上限。 */
export const DEFAULT_MCP_CALL_MS = 120_000;

/** 外部 server 给的文本一律有界（agent-plan §工具规格：「每个工具具备输出上限 + 截断提示」）。
 *  MCP 面此前是两个例外，而且第二个更贵：`tools/list` 的描述进的是**每轮重送**的工具面
 *  （×工具数×轮数），一个话痨 server 能把整个会话的固定成本抬高一个数量级。 */
export const MCP_RESULT_CHAR_LIMIT = 32 * 1024;
export const MCP_DESCRIPTION_CHAR_LIMIT = 2 * 1024;
/** 提示行自己占位：留够位置，「≤ 上限」这句承诺才不被提示撑破。 */
const CAP_NOTE_RESERVE = 220;

/** 结果：头 + 尾都留（结论在哪端取决于 server 的写法），中间省略量如实报出。 */
export function capMcpResult(text: string, limit = MCP_RESULT_CHAR_LIMIT): string {
  if (text.length <= limit) return text;
  const keep = limit - CAP_NOTE_RESERVE;
  const head = Math.floor(keep * 0.6);
  const tail = keep - head;
  return text.slice(0, head)
    + "\n[truncated: MCP 结果 " + String(text.length) + " 字符超上限 " + String(limit)
    + "，省略中间 " + String(text.length - head - tail) + " 字符（首尾已保留）——要全文就收窄查询或让 server 分页]\n"
    + text.slice(text.length - tail);
}

/** 描述：只留头部，且截在完整行尾（工具说明的关键信息在前几行，尾部按轮重付不值）。 */
export function capMcpDescription(text: string, limit = MCP_DESCRIPTION_CHAR_LIMIT): string {
  if (text.length <= limit) return text;
  const lineEnd = text.lastIndexOf("\n", limit);
  const cut = lineEnd > Math.floor(limit * 0.5) ? lineEnd : limit;
  return text.slice(0, cut)
    + " …[truncated: 描述 " + String(text.length) + " 字符超 " + String(limit) + " 上限]";
}

/** server 自带的 JSON Schema 是工具面里通常最大的一块，而 agent-runner 明写「参数直接复用
 *  inputSchema 原文——不翻译、不裁剪」（避免两套 schema 漂移）。所以这里**只动字符串叶子与超深子树**：
 *  键名、type、required、enum 逐项保留 ⇒ 模型照样下得出正确参数，少付的是 server 塞进
 *  description/default 里的散文。结构与 JSON 合法性不破，是这条收窄的前提。 */
export const MCP_SCHEMA_LEAF_CHAR_LIMIT = 600;
export const MCP_SCHEMA_DEPTH_LIMIT = 6;

/** 服务器级懒加载的默认上限：一次 run 最多激活几台 server / 几把工具。
 *  超限由 `mcp_activate` 显式拒绝并说清当前占用——不静默丢工具，也不让一台 80 工具
 *  server 把 24k 固定面一口气撑爆。 */
export const MCP_ACTIVE_SERVER_LIMIT = 2;
export const MCP_ACTIVE_TOOL_LIMIT = 20;
/** 目录里单条工具描述的上限（目录本身不该再制造一份大上下文）。 */
export const MCP_CATALOG_DESC_CHAR_LIMIT = 300;

function capSchemaLeaf(text: string): string {
  if (text.length <= MCP_SCHEMA_LEAF_CHAR_LIMIT) return text;
  const lineEnd = text.lastIndexOf("\n", MCP_SCHEMA_LEAF_CHAR_LIMIT);
  const cut = lineEnd > Math.floor(MCP_SCHEMA_LEAF_CHAR_LIMIT * 0.5) ? lineEnd : MCP_SCHEMA_LEAF_CHAR_LIMIT;
  return text.slice(0, cut) + " …[参数说明截断]";
}

function capSchemaNode(v: unknown, depth: number, tally: { clamped: number }): unknown {
  if (typeof v === "string") {
    const out = capSchemaLeaf(v);
    if (out !== v) tally.clamped++;
    return out;
  }
  if (typeof v !== "object" || v === null) return v;
  if (depth >= MCP_SCHEMA_DEPTH_LIMIT) {
    tally.clamped++;
    return { type: "object", description: "[嵌套超 " + String(MCP_SCHEMA_DEPTH_LIMIT) + " 层，已省略]" };
  }
  if (Array.isArray(v)) return v.map((x) => capSchemaNode(x, depth + 1, tally));
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = capSchemaNode(x, depth + 1, tally);
  return out;
}

/** 返回收窄后的 schema 与被收窄的处数（>0 时要让模型知道「看到的是节选」）。 */
export function capMcpSchema(schema: Record<string, unknown>): { schema: Record<string, unknown>; clamped: number } {
  const tally = { clamped: 0 };
  return { schema: capSchemaNode(schema, 0, tally) as Record<string, unknown>, clamped: tally.clamped };
}

/** MCP 工具 scoped 名（§9.3）：mcp__plugin_<plugin>_<server>__<tool>。 */
export function scopedToolName(plugin: string, server: string, tool: string): string {
  return "mcp__plugin_" + plugin + "_" + server + "__" + tool;
}

/** 从 scoped 名反解（bare 名永不命中 matcher 的依据面）。 */
export function parseScopedToolName(name: string): { plugin: string; server: string; tool: string } | null {
  const m = name.match(/^mcp__plugin_(.+)_(.+)__(.+)$/);
  if (!m) return null;
  return { plugin: m[1]!, server: m[2]!, tool: m[3]! };
}

export interface McpToolInfo {
  /** bare 名（server 侧原名）。 */
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** scoped 注册名。 */
  scopedName: string;
  /** §11.7.2「MCP 工具」那一行的分级输入（server 自带注解）。不收没有消费者的字段。 */
  grade: McpGrade;
}

/** 服务器级懒加载的目录项（模型先看到 server，再决定是否激活）。 */
export interface McpServerSummary {
  /** `plugin/server`，跨插件唯一。 */
  key: string;
  plugin: string;
  server: string;
  toolCount: number;
  /** 整台 server 或其中至少一把工具处于 active。 */
  active: boolean;
  /** server = 整台激活；tools = 只激活了子集；none = 未激活。 */
  activeMode: "server" | "tools" | "none";
  /** 实际进入模型面的工具数（整台激活时 = toolCount）。 */
  activeToolCount: number;
}

/** `mcp_list` 返回的单条工具摘要（不包含 schema）。 */
export interface McpToolSummary {
  name: string;
  scopedName: string;
  description: string;
  /** 该工具此刻是否已激活（整台或其 scoped 名在按工具集里）。 */
  active: boolean;
}

/** 跨插件唯一的 server key：插件名与 server 名都可能重复，用 `/` 拼成稳定键。 */
export function mcpServerKey(plugin: string, server: string): string {
  return plugin + "/" + server;
}

/** 注解收窄：只留"有没有标"+"只读/破坏性"两个布尔，其余（title / openWorld / idempotent）
 *  目前没有消费者 ⇒ 不收，免得又长成一个"字段收下即丢"的陈列面。
 *  server 给的不是布尔时按"没标"处理（不拿 junk 当放行凭据）。 */
export function mcpGradeOf(raw: unknown): McpGrade {
  if (raw === null || typeof raw !== "object") return { annotated: false };
  const a = raw as Record<string, unknown>;
  return {
    annotated: true,
    ...(typeof a.readOnlyHint === "boolean" ? { readOnly: a.readOnlyHint } : {}),
    ...(typeof a.destructiveHint === "boolean" ? { destructive: a.destructiveHint } : {}),
  };
}

interface Connection {
  plugin: string;
  server: string;
  client: Client;
  transport: Transport;
  tools: McpToolInfo[];
  error?: string;
}

export interface McpConnectResult {
  ok: boolean;
  tools: McpToolInfo[];
  error?: string;
}

/** SDK 客户端工厂（测试可注入替身）。 */
export type McpClientFactory = (
  cfg: McpServerConfig,
  plugin: string,
  server: string,
) => Promise<{ client: Client; transport: Transport }>;

function defaultClientFactory(cfg: McpServerConfig): Promise<{ client: Transport extends never ? never : Client; transport: Transport }> {
  const clientInfo = { name: "dsh-agent", version: "0.1.0" };
  const client = new Client(clientInfo);
  let transport: Transport;
  const type = cfg.type ?? (cfg.command ? "stdio" : cfg.url ? "http" : "stdio");
  if (type === "stdio") {
    if (typeof cfg.command !== "string" || cfg.command === "") {
      return Promise.reject(new Error("stdio server 缺少 command"));
    }
    transport = new StdioClientTransport({
      command: cfg.command,
      ...(cfg.args ? { args: cfg.args } : {}),
      ...(cfg.env ? { env: cfg.env } : {}),
    });
  } else if (type === "sse") {
    if (typeof cfg.url !== "string") return Promise.reject(new Error("sse server 缺少 url"));
    transport = new SSEClientTransport(new URL(cfg.url), cfg.headers ? { requestInit: { headers: cfg.headers } } : undefined);
  } else {
    if (typeof cfg.url !== "string") return Promise.reject(new Error("http server 缺少 url"));
    transport = new StreamableHTTPClientTransport(new URL(cfg.url), cfg.headers ? { requestInit: { headers: cfg.headers } } : undefined);
  }
  return Promise.resolve({ client, transport } as { client: Client; transport: Transport });
}

/** ${PLUGIN_ROOT} / ${PROJECT_DIR} / ${user_config.*} 展开（CC .mcp.json 同款；stdio 无 shell，展开在本层做）。
 *  覆盖面 = command / args / env / url / headers：远程 server 的 API key 就写在 headers 里
 *  （§9.11 两个实仓样本都是 http 型），只展开前三项等于那两类插件永远连不上。
 *  roots.pluginRoot/projectDir 缺省时按空串替换（沿用旧行为）；user_config 的键**缺值即原样留着**
 *  ——拿空串顶位会让 server 拿着空 token 去请求，报回来的 401 和配置毫无关系。 */
export function expandMcpConfig(cfg: McpServerConfig, roots: McpExpandRoots): McpServerConfig {
  const userConfig = roots.userConfig ?? {};
  const sensitive = new Set(roots.userConfigSensitive ?? []);
  const argvConfig = Object.fromEntries(Object.entries(userConfig).filter(([k]) => !sensitive.has(k)));
  const sub = (s: string, values: Record<string, string> = userConfig): string =>
    expandUserConfig(
      s
        .replace(/\$\{PLUGIN_ROOT\}/g, roots.pluginRoot ?? "")
        .replace(/\$\{PROJECT_DIR\}/g, roots.projectDir ?? ""),
      values,
    );
  const out: McpServerConfig = { ...cfg };
  // 敏感值只允许经 env 下发；argv 里引用敏感键的模板原样保留占位符，由插件改走 env。
  if (typeof out.command === "string") out.command = sub(out.command, argvConfig);
  if (Array.isArray(out.args)) out.args = out.args.map((a) => (typeof a === "string" ? sub(a, argvConfig) : a));
  if (out.env) {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(out.env)) env[k] = typeof v === "string" ? sub(v) : v;
    out.env = env;
  }
  const strMap = <T extends object | undefined>(m: T): T => {
    if (!m) return m;
    const out2: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(m)) out2[k] = typeof v === "string" ? sub(v) : v;
    return out2 as T;
  };
  if (typeof out.url === "string") out.url = sub(out.url);
  out.headers = strMap(out.headers);
  return out;
}

export class McpManager {
  private connections = new Map<string, Connection>();
  /** 同一 (plugin, server) 的握手只跑一轮：并发 connect 共用这个 promise，不许各建一个 SDK client。 */
  private inflight = new Map<string, Promise<McpConnectResult>>();
  private closingKeys = new Map<string, Promise<void>>();
  /** 退出进行中：新连接直接拒绝（否则迟到的连接会在 disconnectAll 之后把服务复活）。 */
  private closing: Promise<void> | null = null;
  /** 每轮 disconnectAll 递增；握手跨过一轮退出就用代际对不上来识别。 */
  private generation = 0;
  private factory: McpClientFactory;
  /** server 崩溃时通知运行时摘掉它的工具（否则模型继续看到一组永远「未连接」的工具）。 */
  onServerDown?: (plugin: string, server: string) => void;
  private readonly connectTimeoutMs: number;
  private readonly callTimeoutMs: number;

  constructor(factory?: McpClientFactory, connectTimeoutMs: number = DEFAULT_MCP_CONNECT_MS, callTimeoutMs: number = DEFAULT_MCP_CALL_MS) {
    this.factory = factory ?? (async (cfg) => defaultClientFactory(cfg));
    this.connectTimeoutMs = connectTimeoutMs;
    this.callTimeoutMs = callTimeoutMs;
  }

  private key(plugin: string, server: string): string {
    return plugin + "::" + server;
  }

  /** 连接一个 server 并拉取 tools/list（scoped 名在此处定型；${PLUGIN_ROOT} 展开在此层做）。
   *  并发语义：同一 key 的并发调用共用一轮握手；退出期间的调用直接失败（不排队、不缓存）。 */
  async connect(plugin: string, server: string, cfg: McpServerConfig, roots?: McpExpandRoots): Promise<McpConnectResult> {
    const k = this.key(plugin, server);
    if (this.closing || this.closingKeys.has(k)) return { ok: false, tools: [], error: "MCP 连接正在关闭，暂不接受新连接" };
    const pending = this.inflight.get(k);
    if (pending) return pending;
    const existing = this.connections.get(k);
    if (existing) {
      // 失败态**允许重连**：旧实现对 error 条目直接返回缓存错误，server 崩一次后本会话永久不可用。
      if (!existing.error) return { ok: true, tools: existing.tools };
      this.connections.delete(k);
    }
    const generation = this.generation;
    const attempt = this.connectOnce(plugin, server, cfg, roots, k, generation).finally(() => {
      if (this.inflight.get(k) === attempt) this.inflight.delete(k);
    });
    this.inflight.set(k, attempt);
    return attempt;
  }

  private async connectOnce(
    plugin: string,
    server: string,
    cfg: McpServerConfig,
    roots: McpExpandRoots | undefined,
    k: string,
    generation: number,
  ): Promise<McpConnectResult> {
    const resolved = roots ? expandMcpConfig(cfg, roots) : cfg;
    let client: Client | undefined;
    let transport: Transport | undefined;
    try {
      const made = await this.factory(resolved, plugin, server);
      client = made.client;
      transport = made.transport;
      // 根因 4：连接与 tools/list 都是一次性请求，用总时长语义的超时——
      // server 挂起（不响应握手/不回 tools/list）时不再永久悬空。
      const label = `MCP server ${plugin}/${server}`;
      await withTimeout(client.connect(transport), this.connectTimeoutMs, label + " 连接");
      const listed = await withTimeout(client.listTools(), this.connectTimeoutMs, label + " tools/list");
      // 工具级裁剪在进注册表之前：被 include/exclude 排除的工具连名字都不该出现在模型面。
      const include = new Set(resolved.includeTools ?? []);
      const exclude = new Set(resolved.excludeTools ?? []);
      const kept = (listed.tools ?? []).filter((t) =>
        (include.size === 0 || include.has(t.name)) && !exclude.has(t.name));
      const tools: McpToolInfo[] = kept.map((t) => {
        // schema 与描述成对收窄：只压了 schema 却不告诉模型，模型会以为看到的就是全部参数说明。
        const capped = capMcpSchema((t.inputSchema ?? {}) as Record<string, unknown>);
        const desc = typeof t.description === "string" ? capMcpDescription(t.description) : "";
        return {
          name: t.name,
          description: capped.clamped > 0
            ? desc + "\n[参数说明已收窄 " + String(capped.clamped) + " 处，结构完整]"
            : desc,
          inputSchema: capped.schema,
          scopedName: scopedToolName(plugin, server, t.name),
          grade: mcpGradeOf((t as { annotations?: unknown }).annotations),
        };
      });
      // 握手期间退出已开始：这条连接属于被放弃的那一轮，关掉且**不入表**（否则退出后服务会复活）。
      if (generation !== this.generation || this.closingKeys.has(k)) {
        try {
          await client.close();
        } catch {
          /* 已断 */
        }
        await this.killStdioLeftover(transport);
        return { ok: false, tools: [], error: "MCP 连接在建立期间已关闭" };
      }
      const conn: Connection = { plugin, server, client, transport, tools };
      // E5（审查 P2）：订阅 transport onclose——server 进程崩溃后 statuses() 不再报
      // connected 僵尸态（fail-visible 转为 failed；重连入口留位，本轮不自动重连）。
      // 审查 S1-3：必须**链式**而非覆盖——SDK 的 client.connect() 已在 transport.onclose
      // 上装了自己的包装（protocol.js:220-224 → _onclose() 把 ConnectionClosed 结算给全部
      // 在途 responseHandlers）。直接赋值会把那半条链摘掉：server 崩溃时在途 tools/call
      // 永不 settle，agent loop 卡死在工具调用上（旧行为是 reject 后 fail-visible）。
      // 身份比对：上一轮的 onclose 迟到时，不得把这一轮重新接入的服务标成失败。
      const prevOnClose = transport.onclose;
      transport.onclose = (): void => {
        prevOnClose?.(); // 先让 SDK 结算在途请求，再记本层失败态
        const cur = this.connections.get(k);
        if (cur === conn && !cur.error) {
          this.connections.set(k, { ...cur, client: undefined as unknown as Client, error: "MCP server 连接已断开（onclose）" });
          try { this.onServerDown?.(plugin, server); } catch { /* 摘工具失败不改变失败态 */ }
        }
      };
      this.connections.set(k, conn);
      return { ok: true, tools };
    } catch (err) {
      // 超时/失败：底层连接可能仍挂着 → 先尽力关掉（含 stdio 收杀兜底），再记失败态（fail-visible，不留僵尸连接）。
      try {
        await client?.close();
      } catch {
        /* 已断 */
      }
      await this.killStdioLeftover(transport);
      const msg = err instanceof Error ? err.message : String(err);
      // 退出已经开始时不缓存失败态：statuses() 在 disconnectAll 之后必须是空的。
      if (generation !== this.generation || this.closingKeys.has(k)) return { ok: false, tools: [], error: msg };
      this.connections.set(k, {
        plugin, server,
        client: undefined as unknown as Client,
        transport: undefined as unknown as Transport,
        tools: [],
        error: msg,
      });
      return { ok: false, tools: [], error: msg };
    }
  }

  /** tools/call（bare 名回传 server 侧）。 */
  async callTool(plugin: string, server: string, tool: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<{ ok: boolean; output: string }> {
    const k = this.key(plugin, server);
    const conn = this.closing || this.closingKeys.has(k) ? undefined : this.connections.get(k);
    if (!conn || conn.error || !conn.client) return { ok: false, output: "MCP server 未连接: " + plugin + "/" + server };
    const label = `MCP tools/call ${plugin}/${server}/${tool}`;
    // 独立信号在请求结束时解除会话监听，避免稍后的取消再次通知已完成请求。
    const requestAbort = new AbortController();
    const cancel = (): void => requestAbort.abort(signal?.reason);
    const timeout = Number.isFinite(this.callTimeoutMs) && this.callTimeoutMs > 0 ? this.callTimeoutMs : undefined;
    try {
      signal?.throwIfAborted();
      signal?.addEventListener("abort", cancel, { once: true });
      const res = await withTimeout(
        conn.client.callTool({ name: tool, arguments: args }, undefined, { signal: requestAbort.signal, ...(timeout !== undefined ? { timeout } : {}) }),
        this.callTimeoutMs,
        label,
      );
      const parts: string[] = [];
      const content = res.content as unknown;
      if (Array.isArray(content)) {
        for (const item of content) {
          const c = item as { type?: string; text?: string };
          if (c && c.type === "text" && typeof c.text === "string") parts.push(c.text);
        }
      }
      const isError = (res as { isError?: boolean }).isError === true;
      return { ok: !isError, output: capMcpResult(parts.join("\n")) || "(空结果)" };
    } catch (err) {
      if (signal?.aborted) {
        const reason = signal.reason instanceof Error ? signal.reason.message : String(signal.reason);
        return { ok: false, output: "[cancelled] MCP tools/call 已取消: " + reason };
      }
      if (timeout !== undefined && err instanceof McpError && err.code === ErrorCode.RequestTimeout) {
        return { ok: false, output: `MCP tools/call 失败: ${label} 超时：${String(timeout)}ms 内未完成` };
      }
      return { ok: false, output: "MCP tools/call 失败: " + (err instanceof Error ? err.message : String(err)) };
    } finally {
      signal?.removeEventListener("abort", cancel);
    }
  }

  /** server 状态（事件流投影消费面：面板显示）。 */
  statuses(): McpServerStatus[] {
    return [...this.connections.values()].map((c) => ({
      plugin: c.plugin,
      server: c.server,
      state: c.error ? "failed" : "connected",
      tools: c.tools.map((t) => t.scopedName),
      ...(c.error ? { error: c.error } : {}),
    }));
  }

  /** 退出收束：并发调用共用同一轮关闭；进行中的握手被接管（代际递增，握手方自己收尾且不入表）。 */
  async disconnectAll(): Promise<void> {
    if (this.closing) return this.closing;
    const close = (async (): Promise<void> => {
      this.generation++;
      const keys = new Set([...this.connections.keys(), ...this.inflight.keys(), ...this.closingKeys.keys()]);
      await Promise.all([...keys].map((key) => this.disconnectKey(key)));
    })();
    this.closing = close;
    try {
      await close;
    } finally {
      if (this.closing === close) this.closing = null;
    }
  }

  /** 撤回信任只关闭该插件的连接；同一连接的局部关闭与全局退出共用收尾。 */
  async disconnectPlugin(plugin: string): Promise<void> {
    const prefix = plugin + "::";
    const keys = new Set([...this.connections.keys(), ...this.inflight.keys(), ...this.closingKeys.keys()]);
    await Promise.all([...keys].filter((key) => key.startsWith(prefix)).map((key) => this.disconnectKey(key)));
  }

  private async disconnectKey(key: string): Promise<void> {
    const existing = this.closingKeys.get(key);
    if (existing) return existing;
    const close = Promise.resolve().then(async () => {
      await this.inflight.get(key);
      const conn = this.connections.get(key);
      this.connections.delete(key);
      try {
        await conn?.client?.close();
      } catch {
        /* 已断 */
      }
      await this.killStdioLeftover(conn?.transport);
    });
    this.closingKeys.set(key, close);
    try {
      await close;
    } finally {
      if (this.closingKeys.get(key) === close) this.closingKeys.delete(key);
    }
  }

  /** D3/D5（审查 P2）：stdio server 收杀兜底——SDK close 对 stdio 子进程发 SIGTERM，但
   *  不保证整树收束（孙进程可成孤儿）。close 后若进程仍存活，直接 SIGKILL 该 pid
   *（StdioClientTransport 暴露 pid；非 stdio transport 无 pid，静默跳过）。 */
  private async killStdioLeftover(transport: Transport | undefined): Promise<void> {
    try {
      await transport?.close();
    } catch {
      /* 已断 */
    }
    const pid = (transport as { pid?: number } | undefined)?.pid;
    if (typeof pid !== "number" || !Number.isInteger(pid)) return;
    try {
      process.kill(pid, 0); // 存活探测
      process.kill(pid, "SIGKILL");
    } catch {
      /* 已退出 */
    }
  }
}
