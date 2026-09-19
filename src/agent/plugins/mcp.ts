// M2e：MCP 适配器（§9.7）。唯一外部协议；官方 TS SDK（@modelcontextprotocol/sdk）；
// stdio + http/sse 两种传输；工具以 mcp__plugin_<plugin>_<server>__<tool> 进统一注册表、
// 走同一权限门、无特权。server 状态 = 事件流投影消费面（statuses() 供面板，无隐藏状态）。
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { withTimeout } from "../../net";
import type { McpServerConfig, McpServerStatus } from "./types";

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

/** MCP 工具 scoped 名（§9.3）：mcp__plugin_<plugin>_<server>__<tool>。 */
export function scopedToolName(plugin: string, server: string, tool: string): string {
  return "mcp__plugin_" + plugin + "_" + server + "__" + tool;
}

/** 从 scoped 名反解（bare 名永不命中 matcher 的依据面）。 */
export function parseScopedToolName(name: string): { plugin: string; server: string; tool: string } | null {
  const m = /^mcp__plugin_(.+)_(.+)__(.+)$/.exec(name);
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

/** ${PLUGIN_ROOT} / ${PROJECT_DIR} 展开（CC .mcp.json 同款；stdio 无 shell，展开在本层做）。 */
export function expandMcpConfig(cfg: McpServerConfig, roots: { pluginRoot?: string; projectDir?: string }): McpServerConfig {
  const sub = (s: string): string =>
    s
      .replace(/\$\{PLUGIN_ROOT\}/g, roots.pluginRoot ?? "")
      .replace(/\$\{PROJECT_DIR\}/g, roots.projectDir ?? "");
  const out: McpServerConfig = { ...cfg };
  if (typeof out.command === "string") out.command = sub(out.command);
  if (Array.isArray(out.args)) out.args = out.args.map((a) => (typeof a === "string" ? sub(a) : a));
  if (out.env) {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(out.env)) env[k] = typeof v === "string" ? sub(v) : v;
    out.env = env;
  }
  return out;
}

export class McpManager {
  private connections = new Map<string, Connection>();
  private factory: McpClientFactory;
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

  /** 连接一个 server 并拉取 tools/list（scoped 名在此处定型；${PLUGIN_ROOT} 展开在此层做）。 */
  async connect(plugin: string, server: string, cfg: McpServerConfig, roots?: { pluginRoot?: string; projectDir?: string }): Promise<McpConnectResult> {
    const k = this.key(plugin, server);
    if (this.connections.has(k)) {
      const c = this.connections.get(k)!;
      return c.error ? { ok: false, tools: [], error: c.error } : { ok: true, tools: c.tools };
    }
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
      const tools: McpToolInfo[] = (listed.tools ?? []).map((t) => ({
        name: t.name,
        description: typeof t.description === "string" ? capMcpDescription(t.description) : "",
        inputSchema: (t.inputSchema ?? {}) as Record<string, unknown>,
        scopedName: scopedToolName(plugin, server, t.name),
      }));
      const conn: Connection = { plugin, server, client, transport, tools };
      this.connections.set(k, conn);
      // E5（审查 P2）：订阅 transport onclose——server 进程崩溃后 statuses() 不再报
      // connected 僵尸态（fail-visible 转为 failed；重连入口留位，本轮不自动重连）。
      // 审查 S1-3：必须**链式**而非覆盖——SDK 的 client.connect() 已在 transport.onclose
      // 上装了自己的包装（protocol.js:220-224 → _onclose() 把 ConnectionClosed 结算给全部
      // 在途 responseHandlers）。直接赋值会把那半条链摘掉：server 崩溃时在途 tools/call
      // 永不 settle，agent loop 卡死在工具调用上（旧行为是 reject 后 fail-visible）。
      const prevOnClose = transport.onclose;
      transport.onclose = (): void => {
        prevOnClose?.(); // 先让 SDK 结算在途请求，再记本层失败态
        const cur = this.connections.get(k);
        if (cur && !cur.error) {
          this.connections.set(k, { ...cur, client: undefined as unknown as Client, error: "MCP server 连接已断开（onclose）" });
        }
      };
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
  async callTool(plugin: string, server: string, tool: string, args: Record<string, unknown>): Promise<{ ok: boolean; output: string }> {
    const conn = this.connections.get(this.key(plugin, server));
    if (!conn || conn.error || !conn.client) return { ok: false, output: "MCP server 未连接: " + plugin + "/" + server };
    try {
      const res = await withTimeout(
        conn.client.callTool({ name: tool, arguments: args }),
        this.callTimeoutMs,
        `MCP tools/call ${plugin}/${server}/${tool}`,
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
      return { ok: false, output: "MCP tools/call 失败: " + (err instanceof Error ? err.message : String(err)) };
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

  async disconnectAll(): Promise<void> {
    for (const c of this.connections.values()) {
      try {
        await c.client?.close();
      } catch {
        /* 关闭失败不影响退出路径 */
      }
      await this.killStdioLeftover(c.transport);
    }
    this.connections.clear();
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
