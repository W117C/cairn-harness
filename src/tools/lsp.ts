// LSP 框架（M2a 任务 5/6）：读 .agent/lsp.json（"lsp": false 或缺省 = 全局关闭）。
// 客户端用 vscode-languageserver-protocol 的 JSON-RPC 层（不手搓帧）；
// 懒启动、按 (root, serverID) 复用、in-flight 去重、失败进 broken 集合不再重试；
// read_file 命中源码时后台预热（prefetchLsp，尽力而为零阻塞）。
// 对外一律 1-based 行列，内部转 LSP 的 0-based。
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { statSync as stat } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { extname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { killGroup, sanitizedEnv } from "./process.js";
import { TrustStore, type TrustState } from "../agent/plugins/trust";
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
import { assertRealContainment, resolveInWorkspace, ToolError, type Tool, type ToolContext, type ToolResult } from "./base.js";
import { byteCapNotice } from "./cap-notice.js";
import { headWithinBytes } from "./output-ring.js";

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

/* ---- #58 第二半（2026-10-05）：`.agent/lsp.json` 的 command 进**内容指纹信任门** ----
 * 上一笔（`fb76517e`）把 lsp 抬成 high 风险并包了 gatedTool，堵的是「模型自己动手改那份配置」与
 * 「每一次 lsp 调用都出卡」。**克隆即携带那条路它堵不住**：模型根本不用动手，配置跟着 clone 一起到，
 * 而任何一次 lsp 调用就按它起进程（现读 `startClient` 里 `spawn(server.command, …)` 之前零信任判定）。
 * 这与 S3 的 verify 信任闸**同源**（见 `src/agent/verify.ts` 的 `createVerifyHook` 信任闸那段），口径刻意一致。
 *
 * 为什么是「指纹信任门」而不是「再抬一次风险等级」：
 * · 风险等级管的是「这次调用要不要问人」，而 lsp 在只读档就要用（`tests/write-face.test.ts`
 *   钉着「lsp 不算改盘」那条裁决，`fb76517e` 特意没有推翻它）——把只读档的 LSP 削掉不是修法。
 * · `server.command` 的真实危险是**仓库内容决定宿主执行什么**，而内容指纹绑的正是这个内容面。
 *   复用插件那只门（`TrustStore`）＝不为 lsp 造第二套信任语义。
 *
 * 口径四条：
 * ① 键＝`<lsp.json 绝对路径>@<内容指纹>`——**按文件内容**而不是按 workspace 目录：
 *    同一份 lsp.json 改了 command 就是新内容 ⇒ 重新出卡（这正是要拦的那件事）。
 * ② 未记录 ⇒ pending ⇒ 拒绝起进程并点名（fail-closed；未授权不在自动面里执行）。
 * ③ 指纹取不到（文件读不到／超单文件帽）⇒ 按 pending 处理，**不静默放行**。
 * ④ **调用方断言**：自己拥有该仓库的调用方（判卷／gym／基准，跑的都是仓内 fixture）经
 *    `setLspTrustedRepos` 显式声明——那是**调用方的断言，不是缺省**，与 `trustedRepo` 同一口径。
 *    它不是例外分支（那等于开后门），而是与 ①② 同一层级的第三个信任来源。
 */

/** lsp 信任条目的键。与插件门同一套 `<abs>@<fp>` 形状，但**存在各自的文件里**——
 * lsp 的信任不该顺带授予插件，反之亦然（两面是两个执行面）。导出供判卷核对条目形状。 */
export const lspTrustKey = (absConfig: string, fp: string): string => absConfig + "@" + fp;

/** 宿主可注入的信任存储（缺省＝工作区内的 `.agent/lsp-trust.json`，与插件那份同目录、不同文件）。 */
let lspTrustFile: string | null = null;

/** 调用方断言的「这个工作区我拥有」集合（按解析后的 workspace 键）。 */
const lspTrustedRepos = new Set<string>();

/** 宿主装配时指定 lsp 信任文件；不调就用缺省。 */
export function setLspTrustFile(file: string | null): void {
  lspTrustFile = file;
}

/** 调用方断言：这个工作区由我拥有，其 `.agent/lsp.json` 的 command 可直接执行（与 `trustedRepo` 同一口径）。
 * 判卷与基准用它；**产品路径不调它**——产品路径要么经用户授权（`decideLspConfigTrust`），要么被拦。 */
export function setLspTrustedRepos(paths: Iterable<string>): void {
  lspTrustedRepos.clear();
  for (const p of paths) lspTrustedRepos.add(resolve(p));
}

const defaultLspTrustFile = (root: string): string => join(root, ".agent", "lsp-trust.json");

/** 单文件内容指纹（截到 32 位，与插件门同形）。读不到或超单文件帽 ⇒ 空串（＝取不到，调用方按 fail-closed 处理）。 */
const lspContentFingerprint = (absConfig: string): string => {
  let raw: string;
  let size: number;
  try {
    raw = readFileSync(absConfig, "utf8");
    size = stat(absConfig).size;
  } catch {
    return "";
  }
  if (size > 512 * 1024) return ""; // 与插件门 FP_MAX_FILE_BYTES 同帽：撑过帽的内容不进指纹
  return createHash("sha256").update(raw).digest("hex").slice(0, 32);
};

/** 这份 lsp.json 的信任状态。**取不到指纹一律 pending**（fail-closed）。 */
export async function lspConfigTrustState(root: string): Promise<{ state: TrustState; fp: string; absConfig: string }> {
  const absConfig = resolve(root, ".agent", "lsp.json");
  const fp = lspContentFingerprint(absConfig);
  if (fp === "") return { state: "pending", fp: "", absConfig };
  const store = new TrustStore(lspTrustFile ?? defaultLspTrustFile(root));
  return { state: await store.status(absConfig, fp), fp, absConfig };
}

/** 授权决议（宿主在用户批准后调用）。**只有这里能写信任条目**——工具面自己不许自我授权。
 * 取不到指纹就不写（fail-closed：下回仍出卡，而不是留下一个绑不住内容的宽授权）。 */
export async function decideLspConfigTrust(root: string, trusted: boolean): Promise<void> {
  const t = await lspConfigTrustState(root);
  if (t.fp === "") return;
  const store = new TrustStore(lspTrustFile ?? defaultLspTrustFile(root));
  await store.decide(t.absConfig, trusted, t.fp);
}

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
  // #58 第二半：起进程**之前**先过内容指纹信任门。放在 `getLspClient` 而不是 `startClient` 内部，
  // 是因为它是唯一的起进程入口，而这里能拿到 `serverId` 出点名的话术。
  // fail-closed：pending（首次见到这份配置／内容变了）与 declined 都**不起进程**。
  // 两个不参与本门的面（各自有主，刻意不是"顺带放行"）：
  //  · 插件贡献的服务器——它们的激活权归插件那只门（口径 ① 已写明总开关归宿主）；
  //  · 调用方断言拥有的工作区（`setLspTrustedRepos`）——判卷／基准跑的是仓内 fixture。
  if (pluginServers.get(wsKey(root))?.[serverId] === undefined && !lspTrustedRepos.has(wsKey(root))) {
    const trust = await lspConfigTrustState(root);
    if (trust.state !== "trusted") {
      throw new ToolError(
        "lsp: 已跳过——服务器 \"" + serverId + "\" 的命令来自工作区 .agent/lsp.json，属仓库自带内容，"
        + "未经授权不在自动面里执行（授权后按内容指纹记住，改了内容会重新问）。"
        + "要验的话，二选一：① 自己在会话里批准这份配置；② 告诉我要用哪条命令，我把它作为宿主配置接进来。",
      );
    }
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

/** 证据缺席说明行（写成功之后的静态诊断没跑成时说一句话）。 */
function lspAbsentNote(root: string, absPath: string, serverId: string, why: string): string {
  return "\n<diagnostics-unavailable file=\"" + toRel(root, absPath) + "\">"
    + "这一轮**没有静态诊断证据**（服务器 \"" + serverId + "\"" + (why === "" ? "" : "：" + why) + "）"
    + "——上面没列错误 ≠ 没有错误；要静态结论请跑类型检查/lint，或重启会话让语言服务器重来一次"
    + "。</diagnostics-unavailable>";
}

/** 为什么这次没验成：能归类的说人话，归不了类才回原文（压掉换行 + 截断）。
 *  不把 Error.message 全量透给模型——那是协议内部文本，对修代码没用，还白烧 token。
 *  分支按**实测**结果写，不照抄 errno：2026-09-20 探针测得"命令不存在"时 vscode-jsonrpc
 *  抛的是 "Pending response rejected since connection got disposed"，字符串里根本没有 ENOENT。 */
const LSP_REASON_LIMIT = 120;
function lspFailureReason(err: unknown): string {
  const m = (err instanceof Error ? err.message : String(err)).replace(/\s+/g, " ").trim();
  if (m.includes("broken")) return "启动失败已标记不可用（broken），本会话不再重试";
  if (m.includes("超时")) return "等待语言服务器 publishDiagnostics 超时";
  if (m.includes("connection got disposed") || m.includes("Pending response")) {
    return "语言服务器进程已退出或无响应（命令不存在、崩溃或协议不兼容）";
  }
  return m.slice(0, LSP_REASON_LIMIT);
}

/** 成功写盘后收集诊断；返回附加到工具输出尾部的文本块。
 *  三种情形必须分得开（旧写法把后两种之一折成空串 = 把「没验成」当成「验了且干净」）：
 *  ① 验了、无 error ⇒ 空串（零行为零 token，既有判卷行锁着这条）；
 *  ② 这一路压根没配 LSP（无 config / 无匹配扩展 / §9.8 显式关诊断）⇒ 也空串：
 *     那是本仓既有基线，每次写入注一行「没有 LSP」是纯噪声；
 *  ③ **配了也试着验了，但没验成**（服务器已标 broken / 起不来 / 等诊断超时 / 协议错）
 *     ⇒ 说话：明说缺席与原因短语。沉默在这里是被读成绿灯的，而写代码的人拿不到任何提示。
 *  任何情形都不抛、不阻断写入（写已成功不得回滚）。 */
export async function collectDiagnostics(root: string, absPath: string, timeoutMs = DIAG_TIMEOUT_MS): Promise<string> {
  let serverId = "";
  try {
    const cfg = loadLspConfig(root);
    if (!cfg.enabled) return "";
    const picked = pickServerForFile(cfg, absPath);
    if (!picked) return "";
    serverId = picked;
    if (cfg.servers[picked]?.diagnosticsEnabled === false) return ""; // §9.8 显式关诊断 ⇒ 不回流（六操作照旧）
    // broken 是运行时事实（本会话内起不来/崩过）：先问它，省掉一次注定失败的 spawn 等待
    if (isLspBroken(root, picked)) {
      return lspAbsentNote(root, absPath, picked, "已标记不可用（broken），本会话不再重试");
    }
    const client = await getLspClient(root, cfg, picked);
    const uri = pathToFileURL(absPath).href;
    const text = await readFile(absPath, "utf8");
    const minRev = client.currentRev();
    await client.openFile(absPath, text);
    const diags = await client.waitForDiagnostics(uri, minRev, timeoutMs);
    const errors = diags.filter((d) => d.severity === DiagnosticSeverity.Error).slice(0, MAX_DIAGNOSTICS);
    if (errors.length === 0) return "";
    const lines = errors.map((d) => "ERROR [" + String(d.range.start.line + 1) + ":" + String(d.range.start.character + 1) + "] " + d.message);
    return "\n<diagnostics file=\"" + toRel(root, absPath) + "\">\n" + lines.join("\n") + "\n</diagnostics>";
  } catch (err) {
    return lspAbsentNote(root, absPath, serverId === "" ? "unknown" : serverId, lspFailureReason(err));
  }
}

/** 预热开关（评审 S1）：**默认关**。理由要说足——`read_file` 是连只读档都放行的工具，而它这一脚
 *  经 `getLspClient` → `startClient` → `spawn(工作区 .agent/lsp.json 里写的 command)`：
 *  「读一个文件」会在零提示下执行**仓库带来的可执行文件**。关掉之后，LSP 只在显式调用 `lsp` 工具时启动
 *  （那一侧的档位判定见 `src/permissions/autonomy.ts` 的写向表）。要恢复这层便利＝显式设
 *  `CAIRN_LSP_PREFETCH=1`，这是宿主的决定，不是工作区配置文件能自己决定的。 */
export const LSP_PREFETCH_ENV = "CAIRN_LSP_PREFETCH";

export function lspPrefetchEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env[LSP_PREFETCH_ENV] === "1";
}

/** 预热的去向（返回它不是为了好看：判卷要能在**不 mock spawn** 的情况下断「这一脚没发出去」）。 */
export type LspPrefetchOutcome = "skipped-prefetch-off" | "skipped-no-config" | "skipped-no-server" | "started";

/** read 命中源码文件时的后台预热：懒启动对应 server（尽力而为，静默失败，且默认不启动）。 */
export function prefetchLsp(root: string, absPath: string, enabled = lspPrefetchEnabled()): LspPrefetchOutcome {
  if (!enabled) return "skipped-prefetch-off";
  let cfg: ReturnType<typeof loadLspConfig>;
  try {
    cfg = loadLspConfig(root);
  } catch {
    return "skipped-no-config"; // 配置坏不阻塞 read（旧实现同样吞掉）
  }
  if (!cfg.enabled) return "skipped-no-config";
  const serverId = pickServerForFile(cfg, absPath);
  if (!serverId) return "skipped-no-server";
  void getLspClient(root, cfg, serverId).catch(() => {});
  return "started";
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
 *  **按字节量**（#52）：提示那句承诺的是 32KB，而原先量 `text.length`（字符），两者在中文结果集上分开：
 *  tools-check 的中文符号名样本实测旧实现交 53998 字节却自称 32KB 上限；纯中文正文更可达 ~9 万字节
 *  （30720 字符 < 32768 ⇒ 连截断都不触发）。ASCII 场景 1 字符 = 1 字节，截断位逐字不变。 */
export const LSP_OUTPUT_LIMIT_BYTES = 32 * 1024;
export function capLspOutput(text: string): string {
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes <= LSP_OUTPUT_LIMIT_BYTES) return text;
  // 缝合处按码位回退交给 `headWithinBytes`：按字节裸切会留下半个多字节序列（→ 第 68 页 #54）。
  const cut = headWithinBytes(text, LSP_OUTPUT_LIMIT_BYTES);
  // 省略量必须报出来（#57，与第 66 页 `countCapNotice` 同一条纪律）：只说"超上限已截断"的模型
  // 无从判断自己是看全了还是漏了一大段，最常见的反应是原样重跑同一条宽查询。
  // 下一步给的是 lsp 自己够得着的动作（它没有 offset/limit 分页），不是别支的命令形状。
  return cut + "\n" + byteCapNotice(32, bytes - Buffer.byteLength(cut, "utf8"), "用 grep 定位符号名，或 read_file 分批读那份文件");
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
    // 词法闸之外还要判软链归属：openFile/hover 原样吃绝对路径，语言服务器读到什么就回什么——
    // 界外软链经此直接把界外文件内容带回来（与 read_file 同一形状的漏）。
    await assertRealContainment(ctx.workspace, abs, "lsp");
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
