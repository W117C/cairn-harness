// LSP 框架（M2a 任务 5/6）：读 .agent/lsp.json（"lsp": false 或缺省 = 全局关闭）。
// 客户端用 vscode-languageserver-protocol 的 JSON-RPC 层（不手搓帧）；
// 懒启动、按 (root, serverID) 复用、in-flight 去重、失败进 broken 集合不再重试；
// read_file 命中源码时后台预热（prefetchLsp，尽力而为零阻塞）。
// 对外一律 1-based 行列，内部转 LSP 的 0-based。
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import { extname, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { killGroup, sanitizedEnv } from "./process.js";
import {
  createProtocolConnection,
  StreamMessageReader,
  StreamMessageWriter,
  DiagnosticSeverity,
  DefinitionRequest,
  DidChangeTextDocumentNotification,
  DidOpenTextDocumentNotification,
  InitializedNotification,
  InitializeRequest,
  PublishDiagnosticsNotification,
  ReferencesRequest,
  ShutdownRequest,
  ExitNotification,
  WorkspaceSymbolRequest,
  DocumentSymbolRequest,
  HoverRequest,
  ImplementationRequest,
  type Diagnostic,
  type DocumentSymbol,
  type Location,
  type SymbolInformation,
} from "vscode-languageserver-protocol/node";
import { resolveInWorkspace, truncationNotice, ToolError, type Tool, type ToolContext, type ToolResult } from "./base.js";

export interface LspServerConfig {
  command: string;
  args?: string[];
  extensions: string[];
  /** CC 的 initializationOptions：原样进 InitializeParams（§9.8 的字段映射，不是收下即丢的装饰）。 */
  initializationOptions?: Record<string, unknown>;
  /** §9.8 `diagnostics.enabled`：显式 false ⇒ 该 server 不参与写后诊断回流（六操作照旧可用）。
   *  缺省 undefined = 开（与 §9.8「diagnostics 默认 true」一致）。 */
  diagnosticsEnabled?: boolean;
}

export interface LspConfig {
  enabled: boolean;
  servers: Record<string, LspServerConfig>;
}

/**
 * 插件贡献的 LSP server（§9.8 承诺的三个激活面里此前缺的那第三条：`.lsp.json` 装载、面板计数，
 * 但运行时从不读它 ⇒ 面板报的数字在撒谎）。作用域按 workspace 分键，与 clients/broken 同一套模块级键。
 *
 * 两条不越权的口径：
 * ① **总开关仍是宿主的**——`.agent/lsp.json` 缺省或 `{"lsp": false}` 时这里登记了也不生效；
 *    插件只能往已经打开的面上加服务器，不能替用户把 LSP 打开（server.command = 任意可执行文件）。
 * ② **同扩展先注册者胜出**（CC first-registered-wins，防同一扩展起两个 server），
 *    且宿主文件里的同名 id 永远压过插件的。
 */
const pluginServers = new Map<string, Record<string, LspServerConfig>>();

const wsKey = (workspace: string): string => resolve(workspace);

/** 登记插件服务器；返回被拒的 id（同扩展已被占，或 id 撞了宿主的）。 */
export function registerPluginLspServers(workspace: string, servers: Record<string, LspServerConfig>): { accepted: string[]; refused: string[] } {
  const key = wsKey(workspace);
  const mine = pluginServers.get(key) ?? {};
  const taken = new Set<string>();
  for (const s of Object.values(mine)) for (const e of s.extensions) taken.add(e);
  const accepted: string[] = [];
  const refused: string[] = [];
  for (const [id, cfg] of Object.entries(servers)) {
    if (id in mine || cfg.extensions.some((e) => taken.has(e))) { refused.push(id); continue; }
    mine[id] = cfg;
    for (const e of cfg.extensions) taken.add(e);
    accepted.push(id);
  }
  if (accepted.length > 0) pluginServers.set(key, mine);
  return { accepted, refused };
}

/** 会话结束摘除（与 installPluginTools 的 injectedToolNames 同族：注册表不留跨会话残留）。 */
export function unregisterPluginLspServers(workspace: string, ids: readonly string[]): void {
  const key = wsKey(workspace);
  const mine = pluginServers.get(key);
  if (!mine) return;
  for (const id of ids) delete mine[id];
  if (Object.keys(mine).length === 0) pluginServers.delete(key);
}

/** 测试与面板用：当前登记的插件服务器 id 清单。 */
export function pluginLspServerIds(workspace: string): string[] {
  return Object.keys(pluginServers.get(wsKey(workspace)) ?? {});
}

/** 读 <workspace>/.agent/lsp.json：{"lsp": false}（或缺省无文件）= 全局关闭；
 *  {"lsp": {"<serverId>": {command, args?, extensions}}} = 启用。坏结构 fail loud。 */
export function loadLspConfig(workspace: string): LspConfig {
  const path = resolve(workspace, ".agent", "lsp.json");
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return { enabled: false, servers: {} };
  }
  let parsed: { lsp?: unknown };
  try {
    parsed = JSON.parse(raw) as { lsp?: unknown };
  } catch (err) {
    throw new ToolError("lsp: .agent/lsp.json 不是合法 JSON: " + (err instanceof Error ? err.message : String(err)));
  }
  if (parsed.lsp === false || parsed.lsp === undefined || parsed.lsp === null) {
    return { enabled: false, servers: {} };
  }
  if (typeof parsed.lsp !== "object" || Array.isArray(parsed.lsp)) {
    throw new ToolError('lsp: .agent/lsp.json 的 "lsp" 字段必须是对象或 false');
  }
  const servers: Record<string, LspServerConfig> = {};
  for (const [id, v] of Object.entries(parsed.lsp as Record<string, unknown>)) {
    const cfg = v as Partial<LspServerConfig>;
    if (typeof cfg !== "object" || cfg === null || typeof cfg.command !== "string" || !Array.isArray(cfg.extensions)) {
      throw new ToolError('lsp: 服务器 "' + id + '" 配置不合法（需要 command 与 extensions）');
    }
    servers[id] = {
      command: cfg.command, args: cfg.args ?? [], extensions: cfg.extensions,
      ...(cfg.initializationOptions !== undefined ? { initializationOptions: cfg.initializationOptions } : {}),
      ...(cfg.diagnosticsEnabled !== undefined ? { diagnosticsEnabled: cfg.diagnosticsEnabled } : {}),
    };
  }
  // 插件服务器：只在面上已开时并入（见 pluginServers 声明处口径 ①），同 id / 同扩展让位。
  for (const [id, cfg] of Object.entries(pluginServers.get(wsKey(workspace)) ?? {})) {
    if (id in servers) continue;
    const taken = new Set<string>(Object.values(servers).flatMap((s) => s.extensions));
    if (cfg.extensions.some((e) => taken.has(e))) continue;
    servers[id] = cfg;
  }
  return { enabled: true, servers };
}

function pickServerForFile(cfg: LspConfig, absPath: string): string | null {
  const ext = extname(absPath);
  for (const [id, s] of Object.entries(cfg.servers)) {
    if (s.extensions.includes(ext)) return id;
  }
  return null;
}

function clientKey(root: string, serverId: string): string {
  return resolve(root) + "\u241F" + serverId;
}

export function isLspBroken(root: string, serverId: string): boolean {
  return broken.has(clientKey(root, serverId));
}

// ---- 客户端生命周期：按 (root, serverID) 复用；失败进 broken 不再重试 ----

const clients = new Map<string, Promise<LspClient>>();
const broken = new Set<string>();

export class LspClient {
  readonly pid: number;
  readonly key: string;
  private conn: ReturnType<typeof createProtocolConnection>;
  private child: ChildProcess;
  private root: string;
  /** uri → { version, text }：didOpen/didChange 状态（openFile 幂等推送）。 */
  private openDocs = new Map<string, { version: number; text: string }>();
  /** 诊断最新值 + 全局版本号（waitForDiagnostics 靠版本号免竞态）。 */
  private latestDiags = new Map<string, Diagnostic[]>();
  private revCounter = 0;
  private diagWaiters: { uri: string; minRev: number; resolve: (d: Diagnostic[]) => void; timer: ReturnType<typeof setTimeout> }[] = [];
  private inflight = new Map<string, { promise: Promise<unknown>; reject: (e: Error) => void }>();

  constructor(child: ChildProcess, conn: ReturnType<typeof createProtocolConnection>, root: string, key: string) {
    this.child = child;
    this.conn = conn;
    this.root = root;
    this.key = key;
    this.pid = child.pid ?? 0;
    this.conn.onNotification(PublishDiagnosticsNotification.type, (params) => {
      this.revCounter++;
      this.latestDiags.set(params.uri, params.diagnostics ?? []);
      const fired = this.diagWaiters.filter((w) => w.uri === params.uri);
      this.diagWaiters = this.diagWaiters.filter((w) => w.uri !== params.uri);
      for (const w of fired) {
        clearTimeout(w.timer);
        w.resolve(this.latestDiags.get(params.uri) ?? []);
      }
    });
    const fail = (reason: string) => {
      if (!broken.has(this.key)) broken.add(this.key);
      clients.delete(this.key);
      const err = new Error(reason);
      for (const entry of this.inflight.values()) entry.reject(err);
      this.inflight.clear();
      // 连接先于进程尸体关闭：jsonrpc 不得再向已销毁的 stdin 写（ERR_STREAM_DESTROYED）
      try {
        this.conn.dispose();
      } catch {
        /* 尽力而为 */
      }
    };
    this.child.on("error", (err) => fail("lsp: server 进程错误: " + err.message));
    this.child.on("exit", (code) => fail("lsp: server 进程退出（code=" + String(code) + "）"));
  }

  /** 全局诊断版本号（每次 publish 递增；等待方用它判断是否有新推送）。 */
  currentRev(): number {
    return this.revCounter;
  }

  /** didOpen / didChange（幂等：内容没变不重发）。 */
  async openFile(absPath: string, text?: string): Promise<void> {
    const uri = pathToFileURL(absPath).href;
    const content = text ?? readFileSync(absPath, "utf8");
    const known = this.openDocs.get(uri);
    if (!known) {
      const languageId = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(extname(absPath)) ? "typescript" : "plaintext";
      this.openDocs.set(uri, { version: 1, text: content });
      await this.conn.sendNotification(DidOpenTextDocumentNotification.type, {
        textDocument: { uri, languageId, version: 1, text: content },
      });
    } else if (known.text !== content) {
      const version = known.version + 1;
      this.openDocs.set(uri, { version, text: content });
      await this.conn.sendNotification(DidChangeTextDocumentNotification.type, {
        textDocument: { uri, version },
        contentChanges: [{ text: content }],
      });
    }
  }

  /** 请求（in-flight 去重：同一 method+params 的并发请求共享一个 Promise），带超时。 */
  request<R>(method: string, params: unknown, timeoutMs = 8000): Promise<R> {
    const key = method + "\u241F" + JSON.stringify(params);
    const existing = this.inflight.get(key);
    if (existing) return existing.promise as Promise<R>;
    let rejectRef: (e: Error) => void = () => {};
    const p = new Promise<R>((resolvePromise, rejectPromise) => {
      rejectRef = rejectPromise;
      const timer = setTimeout(() => {
        this.inflight.delete(key);
        rejectPromise(new Error("lsp: 请求 " + method + " 超时（" + String(timeoutMs) + "ms）"));
      }, timeoutMs);
      this.conn
        .sendRequest(method, params)
        .then((r) => {
          clearTimeout(timer);
          this.inflight.delete(key);
          resolvePromise(r as R);
        })
        .catch((err: unknown) => {
          clearTimeout(timer);
          this.inflight.delete(key);
          rejectPromise(err instanceof Error ? err : new Error(String(err)));
        });
    });
    this.inflight.set(key, { promise: p, reject: rejectRef });
    return p;
  }

  async notify(method: string, params: unknown): Promise<void> {
    await this.conn.sendNotification(method, params);
  }

  /** 等下一次该 uri 的诊断推送（自 minRev 起有新 publish 才返回）。 */
  waitForDiagnostics(uri: string, minRev: number, timeoutMs: number): Promise<Diagnostic[]> {
    if (this.revCounter > minRev) {
      const cur = this.latestDiags.get(uri);
      if (cur) return Promise.resolve(cur);
    }
    return new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        this.diagWaiters = this.diagWaiters.filter((w) => w.timer !== timer);
        rejectPromise(new Error("lsp: 等待诊断超时（" + String(timeoutMs) + "ms）"));
      }, timeoutMs);
      this.diagWaiters.push({ uri, minRev, resolve: resolvePromise, timer });
    });
  }

  async shutdown(): Promise<void> {
    try {
      await Promise.race([
        this.conn.sendRequest(ShutdownRequest.method, null),
        new Promise((_, rej) => setTimeout(() => rej(new Error("shutdown 超时")), 1000)),
      ]);
    } catch {
      /* 尽力而为 */
    }
    try {
      await this.conn.sendNotification(ExitNotification.method, null);
    } catch {
      /* 尽力而为 */
    }
    // 先停连接再杀进程：避免 writer 向已销毁的 stdin 写（ERR_STREAM_DESTROYED unhandled）
    try {
      this.conn.dispose();
    } catch {
      /* 尽力而为 */
    }
    // 杀整棵进程树：语言服务器常自己再派生子进程（tsserver 等），只杀直接子进程会留孤儿（P1-2）
    killGroup(this.child);
  }
}

export async function getLspClient(root: string, cfg: LspConfig, serverId: string): Promise<LspClient> {
  const key = clientKey(root, serverId);
  const server = cfg.servers[serverId];
  if (!server) throw new ToolError('lsp: 未配置服务器 "' + serverId + '"');
  if (broken.has(key)) {
    throw new ToolError('lsp: 服务器 "' + serverId + '" 启动失败已标记不可用（broken），不再重试');
  }
  if (!clients.has(key)) {
    const starting = startClient(root, server, key);
    clients.set(key, starting);
    starting.catch(() => {
      clients.delete(key);
      broken.add(key);
    });
  }
  return clients.get(key) as Promise<LspClient>;
}

async function startClient(root: string, server: LspServerConfig, key: string): Promise<LspClient> {
  // C6（审查）：`-` 开头的 flag 是语言服务器参数（--stdio/--node-ipc），不能被 resolve 成路径；
  // 相对路径参数仍按 root 解析。
  const args = (server.args ?? []).map((a) => (a.startsWith("-") ? a : resolve(root, a)));
  const child = spawn(server.command, args, {
    cwd: root,
    stdio: ["pipe", "pipe", "pipe"],
    // C5（审查 P1-8）：detached 建独立进程组——killGroup 的 process.kill(-pid) 才能收整棵
    // 进程树（tsserver 派生的孙进程）；旧实现只能杀直接子进程，孙进程成孤儿。
    detached: true,
    // env 消毒：server.command 来自 .agent/lsp.json（可被 write_file 改写），
    // 不消毒就等于把 BYOK key 交给一个可配置的任意可执行文件（P1-1）。
    env: sanitizedEnv(),
  });
  if (!child.stdout || !child.stdin) throw new ToolError("lsp: server 进程 stdio 不可用");
  // spawn 失败/进程退出时管道会销毁；jsonrpc 的写错误走 unhandled rejection，这里吞掉管道层错误
  //（生命周期错误已由 LspClient 的 fail 闭包统一处理，不丢语义）
  child.stdin.on("error", () => {});
  child.stdout.on("error", () => {});
  child.stderr?.on("error", () => {});
  const reader = new StreamMessageReader(child.stdout);
  const innerWriter = new StreamMessageWriter(child.stdin);
  // 进程死后 jsonrpc 的 write 会返回无消费者的 rejected Promise（ERR_STREAM_DESTROYED）→
  // unhandled rejection。生命周期语义由 LspClient.fail 统一处理；write 层吞掉即可。
  const writer = {
    write: (msg: unknown) => innerWriter.write(msg as never).catch(() => {}),
    end: () => innerWriter.end(),
    dispose: () => innerWriter.dispose(),
    onError: (l: () => void) => innerWriter.onError(l),
    onClose: (l: () => void) => innerWriter.onClose(l),
  };
  const conn = createProtocolConnection(reader, writer as unknown as StreamMessageWriter);
  const client = new LspClient(child, conn, root, key);
  conn.listen();
  // initialize 带超时（服务器起不来 = 失败进 broken，不悬挂）
  await Promise.race([
    (async () => {
      await conn.sendRequest(InitializeRequest.type, {
        processId: process.pid,
        rootUri: pathToFileURL(root).href,
        capabilities: {},
        // §9.8：CC 的 initializationOptions 一路带到 initialize——服务器靠它拿私有配置，
        // 收下不传等于配置白写一次（stub server 用它回显，判据就看这条）。
        initializationOptions: server.initializationOptions ?? {},
      });
      await conn.sendNotification(InitializedNotification.type, {});
    })(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('lsp: 服务器 "' + server.command + '" initialize 超时（启动失败）')), 8000),
    ),
  ]).catch((err) => {
    try {
      conn.dispose();
    } catch {
      /* 尽力而为 */
    }
    killGroup(child);
    throw err instanceof Error ? err : new Error(String(err));
  });
  return client;
}

/** 测试收尾：关掉全部客户端进程并清缓存（含 broken，测试自行重建场景）。
 *  插件服务器也一并清——它按 workspace 分键且跨用例复用 tmp 目录时会串场景。 */
export async function closeAllLspClients(): Promise<void> {
  const all = [...clients.values()];
  clients.clear();
  broken.clear();
  pluginServers.clear();
  for (const p of all) {
    try {
      const c = await p;
      await c.shutdown();
    } catch {
      /* 启动失败的客户端无需关闭 */
    }
  }
}

// ---- 诊断回流（任务 6）：edit/write 成功后等诊断，只取 ERROR 级、每文件 ≤20 条 ----

const DIAG_TIMEOUT_MS = 2000;
const MAX_DIAGNOSTICS = 20;

function toRel(root: string, absPath: string): string {
  return relative(resolve(root), resolve(absPath)).split(sep).join("/");
}

/** 成功写盘后收集诊断；返回附加到工具输出尾部的文本块（无诊断 = 空串，零行为变化）。
 *  尽力而为：无配置 / 无服务器 / 超时 / 进程失败一律返回空串，不阻塞工具输出。 */
export async function collectDiagnostics(root: string, absPath: string, timeoutMs = DIAG_TIMEOUT_MS): Promise<string> {
  try {
    const cfg = loadLspConfig(root);
    if (!cfg.enabled) return "";
    const serverId = pickServerForFile(cfg, absPath);
    if (!serverId) return "";
    if (cfg.servers[serverId]?.diagnosticsEnabled === false) return ""; // §9.8 显式关诊断 ⇒ 不回流（六操作照旧）
    const client = await getLspClient(root, cfg, serverId);
    const uri = pathToFileURL(absPath).href;
    const text = await readFile(absPath, "utf8");
    const minRev = client.currentRev();
    await client.openFile(absPath, text);
    const diags = await client.waitForDiagnostics(uri, minRev, timeoutMs);
    const errors = diags.filter((d) => d.severity === DiagnosticSeverity.Error).slice(0, MAX_DIAGNOSTICS);
    if (errors.length === 0) return "";
    const lines = errors.map((d) => "ERROR [" + String(d.range.start.line + 1) + ":" + String(d.range.start.character + 1) + "] " + d.message);
    return "\n<diagnostics file=\"" + toRel(root, absPath) + "\">\n" + lines.join("\n") + "\n</diagnostics>";
  } catch {
    return "";
  }
}

/** read 命中源码文件时的后台预热：懒启动对应 server（尽力而为，静默失败）。 */
export function prefetchLsp(root: string, absPath: string): void {
  try {
    const cfg = loadLspConfig(root);
    if (!cfg.enabled) return;
    const serverId = pickServerForFile(cfg, absPath);
    if (!serverId) return;
    void getLspClient(root, cfg, serverId).catch(() => {});
  } catch {
    /* 配置坏不阻塞 read */
  }
}

// ---- lsp 工具：单工具六操作，对外 1-based 行列 ----

const OPERATIONS = ["definition", "references", "hover", "documentSymbol", "workspaceSymbol", "implementation"] as const;
type LspOperation = (typeof OPERATIONS)[number];

const SYMBOL_KIND_NAMES: Record<number, string> = {
  1: "File", 2: "Module", 3: "Namespace", 4: "Package", 5: "Class", 6: "Method", 7: "Property",
  8: "Field", 9: "Constructor", 10: "Enum", 11: "Interface", 12: "Function", 13: "Variable",
  14: "Constant", 15: "String", 16: "Number", 17: "Boolean", 18: "Array", 23: "Struct", 25: "TypeParameter",
};

function filePathFromUri(uri: string): string {
  return uri.startsWith("file://") ? decodeURIComponent(uri.slice("file://".length)) : uri;
}

function formatLocation(root: string, loc: Location): string {
  const rel = toRel(root, filePathFromUri(loc.uri));
  return rel + ":" + String(loc.range.start.line + 1) + ":" + String(loc.range.start.character + 1);
}

function normalizeLocations(result: unknown): Location[] {
  if (!result) return [];
  if (Array.isArray(result)) {
    const out: Location[] = [];
    for (const item of result) {
      const o = item as Record<string, unknown>;
      if (o && typeof o === "object" && "targetUri" in o) {
        out.push({
          uri: o.targetUri as string,
          range: (o.targetSelectionRange ?? o.targetRange) as Location["range"],
        });
      } else {
        out.push(item as Location);
      }
    }
    return out;
  }
  const o = result as Record<string, unknown>;
  if (o && typeof o === "object" && "uri" in o) return [result as Location];
  if (o && typeof o === "object" && "targetUri" in o) {
    return [{ uri: o.targetUri as string, range: (o.targetSelectionRange ?? o.targetRange) as Location["range"] }];
  }
  return [];
}

function hoverText(contents: unknown): string {
  if (typeof contents === "string") return contents;
  if (Array.isArray(contents)) return contents.map(hoverText).filter(Boolean).join("\n");
  if (contents && typeof contents === "object") {
    const c = contents as { value?: unknown };
    if (typeof c.value === "string") return c.value;
  }
  return "";
}

function symbolLines(root: string, symbols: (DocumentSymbol | SymbolInformation)[], depth = 0): string[] {
  const out: string[] = [];
  for (const s of symbols) {
    const kindName = SYMBOL_KIND_NAMES[s.kind] ?? "Symbol";
    if ("location" in s && s.location) {
      const si = s as SymbolInformation;
      out.push("  ".repeat(depth) + si.name + " " + kindName + " " + formatLocation(root, si.location));
    } else {
      const ds = s as DocumentSymbol;
      out.push(
        "  ".repeat(depth) + ds.name + " " + kindName +
        " :" + String(ds.selectionRange.start.line + 1) + ":" + String(ds.selectionRange.start.character + 1),
      );
      if (ds.children?.length) out.push(...symbolLines(root, ds.children, depth + 1));
    }
  }
  return out;
}

interface LspToolArgs {
  operation?: unknown;
  path?: unknown;
  line?: unknown;
  column?: unknown;
  symbol?: unknown;
}

function requirePos(v: unknown, label: string, fallback: number): number {
  if (typeof v === "number" && Number.isInteger(v) && v >= 1) return v;
  return fallback;
}

/** M2g：lsp 输出上限（§14 M2「每个工具具备输出上限/截断提示/相对路径三项」）。
 *  与 run_shell 同口径 32KB；超限截断并附统一截断提示（truncationNotice）。 */
export const LSP_OUTPUT_LIMIT = 32 * 1024;
export function capLspOutput(text: string): string {
  if (text.length <= LSP_OUTPUT_LIMIT) return text;
  return text.slice(0, LSP_OUTPUT_LIMIT) + "\n" + truncationNotice(32);
}

export const lsp: Tool = {
  name: "lsp",
  async run(rawArgs, ctx: ToolContext): Promise<ToolResult> {
    const args = rawArgs as LspToolArgs;
    const operation = args.operation;
    if (typeof operation !== "string" || !OPERATIONS.includes(operation as LspOperation)) {
      throw new ToolError("lsp: operation 必须是 " + OPERATIONS.join(" / ") + " 之一");
    }
    const cfg = loadLspConfig(ctx.workspace);
    if (!cfg.enabled) {
      throw new ToolError('lsp: 未启用——工作区 .agent/lsp.json 缺少 "lsp" 配置（或显式 false = 全局关闭）');
    }

    if (operation === "workspaceSymbol") {
      const query = typeof args.symbol === "string" ? args.symbol : "";
      const serverId = Object.keys(cfg.servers)[0];
      if (!serverId) throw new ToolError("lsp: 未配置任何服务器");
      const client = await getLspClient(ctx.workspace, cfg, serverId);
      const symbols = await client.request<(DocumentSymbol | SymbolInformation)[] | null>(WorkspaceSymbolRequest.method, { query });
      const lines = (symbols ?? []).map((s) => {
        const kindName = SYMBOL_KIND_NAMES[s.kind] ?? "Symbol";
        return (s as SymbolInformation).name + " " + kindName + " " + formatLocation(ctx.workspace, (s as SymbolInformation).location);
      });
      return { ok: true, output: capLspOutput(lines.length ? lines.join("\n") : "无结果") };
    }

    // 其余五操作都需要文件 + 位置
    const rel = typeof args.path === "string" ? args.path : "";
    if (!rel) throw new ToolError("lsp: path 参数必须是非空字符串");
    const abs = resolveInWorkspace(ctx.workspace, rel, "lsp");
    const serverId = pickServerForFile(cfg, abs);
    if (!serverId) {
      throw new ToolError("lsp: 没有服务器处理扩展名 " + extname(abs) + "（检查 .agent/lsp.json 的 extensions）");
    }
    const client = await getLspClient(ctx.workspace, cfg, serverId);
    await client.openFile(abs);
    const line = requirePos(args.line, "line", 1);
    const column = requirePos(args.column, "column", 1);
    const position = { line: line - 1, character: column - 1 };
    const textDocument = { uri: pathToFileURL(abs).href };

    if (operation === "definition" || operation === "implementation") {
      const method = operation === "definition" ? DefinitionRequest.method : ImplementationRequest.method;
      const result = await client.request<unknown>(method, { textDocument, position });
      const locations = normalizeLocations(result);
      if (!locations.length) return { ok: true, output: "无结果" };
      return { ok: true, output: capLspOutput(locations.map((l) => formatLocation(ctx.workspace, l)).join("\n")) };
    }
    if (operation === "references") {
      const result = await client.request<Location[] | null>(ReferencesRequest.method, {
        textDocument,
        position,
        context: { includeDeclaration: false },
      });
      if (!result?.length) return { ok: true, output: "无结果" };
      return { ok: true, output: capLspOutput(result.map((l) => formatLocation(ctx.workspace, l)).join("\n")) };
    }
    if (operation === "hover") {
      const result = await client.request<{ contents: unknown } | null>(HoverRequest.method, { textDocument, position });
      const text = result ? hoverText(result.contents) : "";
      return { ok: true, output: capLspOutput(text || "无结果") };
    }
    // documentSymbol
    const symbols = await client.request<(DocumentSymbol | SymbolInformation)[] | null>(DocumentSymbolRequest.method, { textDocument });
    const lines = symbolLines(ctx.workspace, symbols ?? []);
    return { ok: true, output: capLspOutput(lines.length ? lines.join("\n") : "无结果") };
  },
};
