// 项目预览运行时：把「点开预览」变成一条有状态、可解释、可收回的链路。
//
// 两种运行形态，对应模板清单里的受控 kind（命令是本文件写死的，绝不从项目文件里读命令）：
//   · static —— 进程内静态文件服务（零外部依赖；监听 127.0.0.1 的随机端口，天然无端口冲突）；
//   · vite   —— 子进程：首次 `pnpm install --ignore-scripts`（禁生命周期脚本），再 `pnpm exec vite`。
//
// 为什么 ignore-scripts：模板依赖（react/vite/esbuild/rollup）不需要 postinstall 就能工作
// （esbuild/rollup 的平台二进制走 optionalDependencies），而禁脚本把「装依赖」这一步里
// 第三方任意代码执行的窗口关掉。探针（outputs/.../probes）验证过这条路径能真的起服务。
//
// 状态机的用户价值：失败要能区分「项目里没有清单（spec）/ 依赖没装成（prepare）/ 服务没起来
// （start）/ 服务起来了但页面探不到（ready）」，每一类都给可执行的下一步——这是产品验收里
// 「每次失败都有原因类别和可执行下一步」的落点。所有状态经 onChange 推给桌面壳。
import { spawn } from "node:child_process";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { createServer as createNetServer } from "node:net";
import { basename, dirname, extname, join, normalize, resolve, sep } from "node:path";
import { diagnoseProjectDirectory, HTML_FILE_EXTENSIONS, readProjectManifest, type TemplateRunKind } from "./project-templates";

/* ---------- 静态文件服务（static 形态的全部实现） ---------- */

const MIME: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".jsx": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

export interface StaticServer {
  port: number;
  url: string;
  close: () => Promise<void>;
}

/**
 * 起一个只服务 root 之下的静态服务器。
 * 路径穿越（`..`、编码斜杠）在 resolve 后被前缀检查打回 403；目录请求回落到 index.html。
 */
export function serveStaticProject(root: string): Promise<StaticServer> {
  const base = resolve(root);
  return new Promise((resolvePromise, rejectPromise) => {
    const server: Server = createServer((req, res) => {
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
        res.end("405 Method Not Allowed");
        return;
      }
      let pathname: string;
      try {
        pathname = decodeURIComponent(new URL(req.url ?? "/", "http://127.0.0.1").pathname);
      } catch {
        res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
        res.end("400 Bad Request");
        return;
      }
      const rel = normalize(pathname).replace(/^[/\\]+/, "");
      let abs = resolve(base, rel);
      if (abs !== base && !abs.startsWith(base + sep)) {
        res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
        res.end("403 Forbidden");
        return;
      }
      try {
        if (statSync(abs).isDirectory()) abs = join(abs, "index.html");
      } catch {
        // 落到下面的 statSync 统一 404
      }
      let size: number;
      try {
        const st = statSync(abs);
        if (!st.isFile()) throw new Error("not a file");
        size = st.size;
      } catch {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end("404 Not Found");
        return;
      }
      res.writeHead(200, {
        "content-type": MIME[extname(abs).toLowerCase()] ?? "application/octet-stream",
        "content-length": String(size),
        // 预览必须永远看到当下这份文件：缓存会让「继续修改」看起来没生效。
        "cache-control": "no-store",
      });
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      createReadStream(abs).pipe(res);
    });
    server.on("error", rejectPromise);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr !== null ? addr.port : 0;
      resolvePromise({
        port,
        url: `http://127.0.0.1:${String(port)}/`,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => { done(); });
          }),
      });
    });
  });
}

/** 挑一个当前空闲的本地端口（vite 形态用；strictPort 保证它不会悄悄漂走）。 */
export function pickFreePort(): Promise<number> {
  return new Promise((resolvePromise, rejectPromise) => {
    const probe = createNetServer();
    probe.on("error", rejectPromise);
    probe.listen(0, "127.0.0.1", () => {
      const addr = probe.address();
      const port = typeof addr === "object" && addr !== null ? addr.port : 0;
      probe.close(() => { resolvePromise(port); });
    });
  });
}

/* ---------- 子进程抽象（判卷可注入） ---------- */

export interface PreviewChildExit {
  code: number | null;
  signal: NodeJS.Signals | null;
  /** spawn 本身失败（如 ENOENT）时的错误消息；正常退出为 undefined。 */
  error?: string;
}

export interface PreviewChild {
  pid: number | null;
  kill: (signal?: NodeJS.Signals) => void;
  onExit: (cb: (info: PreviewChildExit) => void) => void;
  /** stderr 末尾若干行（失败文案用；不含环境变量，绝不落 key）。 */
  tail: () => string;
}

export type PreviewChildRunner = (cmd: string, args: string[], opts: { cwd: string }) => PreviewChild;

const TAIL_LIMIT = 2_048;

const defaultRun: PreviewChildRunner = (cmd, args, opts) => {
  const child = spawn(cmd, args, {
    cwd: opts.cwd,
    // POSIX 独立进程组：停预览时整组回收（vite 会拉起 esbuild 等子进程）。
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
  });
  let tail = "";
  const append = (chunk: Buffer): void => {
    tail = (tail + chunk.toString("utf8")).slice(-TAIL_LIMIT);
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  const exitCbs: ((info: PreviewChildExit) => void)[] = [];
  let reported = false;
  const report = (info: PreviewChildExit): void => {
    if (reported) return;
    reported = true;
    for (const cb of exitCbs) cb(info);
  };
  child.on("error", (err) => { report({ code: null, signal: null, error: err.message }); });
  child.on("exit", (code, signal) => { report({ code, signal }); });
  return {
    pid: child.pid ?? null,
    kill: (signal = "SIGTERM") => {
      try {
        if (child.pid !== undefined && process.platform !== "win32") process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        // 已经退出（ESRCH）——停预览是幂等动作，不把"已经没了"报成失败。
      }
    },
    onExit: (cb) => { exitCbs.push(cb); },
    tail: () => tail.trim().split("\n").slice(-4).join("\n"),
  };
};

/* ---------- 状态机 ---------- */

export type PreviewStatus = "idle" | "preparing" | "starting" | "ready" | "failed" | "stopped";
export type PreviewFailureStage = "spec" | "prepare" | "start" | "ready";

/** 认得「直接预览一个 HTML 文件」的扩展名。
 *
 *  为什么要这一支（2026-10-15 桌面端会话读数）：agent 交付了一个单文件 HTML
 *  （仓库根的 pelican-bicycle.html），点「打开预览」得到的是 spec 阶段失败
 *  「这个文件夹不是 Cairn 模板项目（缺 .cairn/project.json）」+「去用模板新建一个」。
 *  对一个**已经写完的单文件交付物**，那句建议是错的方向——用户要的是"看一眼我写的东西"。
 *  而静态服务本来就能serve任意文件，缺的只是入口认这条路。 */
const DIRECT_HTML_EXTENSIONS: ReadonlySet<string> = HTML_FILE_EXTENSIONS;

/** 传进来的是不是一个可直接预览的 HTML 文件（不是目录、也不是别的文件类型）。 */
export function isDirectHtmlFile(p: string): boolean {
  try {
    if (!statSync(p).isFile()) return false;
  } catch {
    return false;
  }
  return DIRECT_HTML_EXTENSIONS.has(extname(p).toLowerCase());
}

export interface PreviewSnapshot {
  projectPath: string;
  status: PreviewStatus;
  /** ready 时必有。 */
  url?: string;
  port?: number;
  kind?: TemplateRunKind;
  /** 进行中状态的用户可读阶段说明。 */
  detail?: string;
  /** failed 时才有的原因类别与可执行下一步。 */
  stage?: PreviewFailureStage;
  message?: string;
  hint?: string;
  /** stopped 的来路：user = 用户停的；exit = 应用退出回收。 */
  reason?: "user" | "exit";
}

export interface PreviewRuntimeDeps {
  run?: PreviewChildRunner;
  serveStatic?: (root: string) => Promise<StaticServer>;
  probe?: (url: string) => Promise<boolean>;
  pickPort?: () => Promise<number>;
  sleep?: (ms: number) => Promise<void>;
  prepareTimeoutMs?: number;
  readyTimeoutMs?: number;
  probeIntervalMs?: number;
}

interface Entry {
  root: string;
  snapshot: PreviewSnapshot;
  cleanup: (() => Promise<void>) | null;
  child: PreviewChild | null;
  inflight: Promise<PreviewSnapshot> | null;
  cancelled: boolean;
}

async function httpProbe(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(2_000) });
    const ok = res.ok;
    await res.body?.cancel().catch(() => undefined);
    return ok;
  } catch {
    return false;
  }
}

const defaultSleep = (ms: number): Promise<void> => new Promise((done) => { setTimeout(done, ms); });

export class PreviewRuntime {
  private readonly entries = new Map<string, Entry>();
  private readonly deps: Required<PreviewRuntimeDeps>;

  constructor(deps: PreviewRuntimeDeps = {}, private readonly onChange?: (s: PreviewSnapshot) => void) {
    this.deps = {
      run: deps.run ?? defaultRun,
      serveStatic: deps.serveStatic ?? serveStaticProject,
      probe: deps.probe ?? httpProbe,
      pickPort: deps.pickPort ?? pickFreePort,
      sleep: deps.sleep ?? defaultSleep,
      prepareTimeoutMs: deps.prepareTimeoutMs ?? 300_000,
      readyTimeoutMs: deps.readyTimeoutMs ?? 60_000,
      probeIntervalMs: deps.probeIntervalMs ?? 250,
    };
  }

  status(projectPath: string): PreviewSnapshot {
    const root = resolve(projectPath);
    const entry = this.entries.get(root);
    return entry?.snapshot ?? { projectPath: root, status: "idle" };
  }

  list(): PreviewSnapshot[] {
    return [...this.entries.values()].map((e) => e.snapshot);
  }

  /** 起预览。同一项目重复调用复用进行中的那一次；已经在跑的会先停再起（拿到干净端口与进程）。 */
  start(projectPath: string): Promise<PreviewSnapshot> {
    const root = resolve(projectPath);
    const entry = this.entries.get(root);
    if (entry?.inflight !== undefined && entry.inflight !== null) return entry.inflight;
    const target: Entry = entry ?? { root, snapshot: { projectPath: root, status: "idle" }, cleanup: null, child: null, inflight: null, cancelled: false };
    target.cancelled = false;
    this.entries.set(root, target);
    const work = this.runStart(target);
    target.inflight = work.finally(() => { target.inflight = null; });
    return target.inflight;
  }

  async stop(projectPath: string, reason: "user" | "exit" = "user"): Promise<PreviewSnapshot> {
    const root = resolve(projectPath);
    const entry = this.entries.get(root);
    if (entry === undefined) return { projectPath: root, status: "stopped", reason };
    entry.cancelled = true;
    if (entry.child !== null) {
      entry.child.kill("SIGTERM");
      entry.child = null;
    }
    if (entry.cleanup !== null) {
      const close = entry.cleanup;
      entry.cleanup = null;
      await close().catch(() => undefined);
    }
    this.emit(entry, { projectPath: root, status: "stopped", reason });
    return entry.snapshot;
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.entries.keys()].map((root) => this.stop(root, "exit")));
  }

  private emit(entry: Entry, snapshot: PreviewSnapshot): void {
    entry.snapshot = snapshot;
    this.onChange?.(snapshot);
  }

  private fail(entry: Entry, stage: PreviewFailureStage, message: string, hint: string): PreviewSnapshot {
    const snapshot: PreviewSnapshot = { projectPath: entry.root, status: "failed", stage, message, hint };
    this.emit(entry, snapshot);
    return snapshot;
  }

  private async runStart(entry: Entry): Promise<PreviewSnapshot> {
    const root = entry.root;
    // 单文件 HTML：不要求 .cairn/project.json——它serve的是**一个文件**，不是一个项目。
    // 复用同一条静态服务（serveStatic 已能按路径返回任意文件，且带 no-store），
    // 所以这里不新增第二条服务实现。
    if (isDirectHtmlFile(root)) {
      this.emit(entry, { projectPath: root, status: "starting", kind: "static", detail: "启动本地预览服务" });
      try {
        const server = await this.deps.serveStatic(dirname(root));
        if (entry.cancelled) {
          await server.close().catch(() => undefined);
          return this.emitStopped(entry);
        }
        entry.cleanup = server.close;
        // URL 指向**那个文件**，不是目录根：目录根下可能没有 index.html，
        // 那样用户看到的会是 404，而失败原因指向一个他根本没写的文件。
        const url = server.url.replace(/\/$/, "") + "/" + encodeURIComponent(basename(root));
        const snapshot: PreviewSnapshot = { projectPath: root, status: "ready", kind: "static", url, port: server.port };
        this.emit(entry, snapshot);
        return snapshot;
      } catch (err) {
        return this.fail(entry, "start", `预览服务启动失败：${err instanceof Error ? err.message : String(err)}`, "重试一次；仍失败就把文件路径发给我们排查。");
      }
    }
    if (!existsSync(root) || !statSync(root).isDirectory()) {
      return this.fail(entry, "spec", `项目目录不存在：${root}`, "在侧栏里重新添加这个项目，或从模板新建一个。");
    }
    const manifest = readProjectManifest(root);
    // 已有项目纳管入口（ADR 0004：先诊断，再工作）：没有清单的目录先过一遍诊断——
    //   · supported：按诊断出的受控形态直接接管运行（命令仍由本文件写死，也不写用户目录里的任何文件）；
    //   · needs-info / unsupported：spec 阶段失败，message 带逐条依据、hint 带可执行下一步。
    // 行为变更（相对「缺 .cairn/project.json 就拒」）：零依赖静态目录与受控 Vite 目录从「拒收」变成「直接可预览」。
    let kind: TemplateRunKind;
    if (manifest !== null) {
      kind = manifest.run.kind;
    } else {
      const diagnosis = diagnoseProjectDirectory(root);
      if (diagnosis.verdict !== "supported" || diagnosis.runKind === null) {
        return this.fail(
          entry,
          "spec",
          `${diagnosis.summary}——${diagnosis.reasons.join("；")}`,
          diagnosis.hint ?? "换个目录，或从模板新建一个项目。",
        );
      }
      kind = diagnosis.runKind;
    }
    // 已有在跑的预览（进程或静态服务）先收掉，拿到干净端口与进程；全新条目跳过这步，
    // 免得给渲染层推一次没有意义的 "stopped"。
    if (entry.child !== null || entry.cleanup !== null || entry.snapshot.status === "ready") {
      await this.stop(root, "user").catch(() => undefined);
    }
    entry.cancelled = false;
    if (kind === "static") {
      this.emit(entry, { projectPath: root, status: "starting", kind, detail: "启动本地预览服务" });
      try {
        const server = await this.deps.serveStatic(root);
        if (entry.cancelled) {
          await server.close().catch(() => undefined);
          return this.emitStopped(entry);
        }
        entry.cleanup = server.close;
        const snapshot: PreviewSnapshot = { projectPath: root, status: "ready", kind, url: server.url, port: server.port };
        this.emit(entry, snapshot);
        return snapshot;
      } catch (err) {
        return this.fail(entry, "start", `预览服务启动失败：${err instanceof Error ? err.message : String(err)}`, "重试一次；仍失败就把项目目录路径发给我们排查。");
      }
    }
    // vite：先装依赖（缺 node_modules 才算「没装成」），再起 dev server。
    const needsInstall = !existsSync(join(root, "node_modules"));
    if (needsInstall) {
      this.emit(entry, { projectPath: root, status: "preparing", kind, detail: "安装依赖（首次较慢，可能需要几分钟）" });
      const installed = await this.runPrepare(entry);
      if (installed !== null) return installed;
      if (entry.cancelled) return this.emitStopped(entry);
    }
    this.emit(entry, { projectPath: root, status: "starting", kind, detail: "启动开发服务器" });
    let port: number;
    try {
      port = await this.deps.pickPort();
    } catch (err) {
      return this.fail(entry, "start", `找不到可用端口：${err instanceof Error ? err.message : String(err)}`, "稍后重试；若持续失败，检查本机端口占用。");
    }
    if (entry.cancelled) return this.emitStopped(entry); // stop 落在 pickPort 窗口：不要起子进程
    const child = this.deps.run("pnpm", ["exec", "vite", "--port", String(port), "--strictPort", "--host", "127.0.0.1"], { cwd: root });
    entry.child = child;
    if (entry.cancelled) {
      // stop 与 spawn 同拍：stop 的清理没看见这个 child ⇒ 这里补杀，别让 dev server 在「已停止」后活着。
      child.kill("SIGTERM");
      entry.child = null;
      return this.emitStopped(entry);
    }
    const url = `http://127.0.0.1:${String(port)}/`;
    let exited: PreviewChildExit | null = null;
    let exitedEarly = false;
    child.onExit((info) => {
      exited = info;
      if (entry.child !== child) return; // 已被 stop/重启接管：这一次退出不是我该报的
      entry.child = null;
      if (entry.cancelled) return;
      exitedEarly = true;
      if (info.error !== undefined && /ENOENT|not found/i.test(info.error)) {
        this.fail(entry, "start", "找不到 pnpm（本机没有安装 Node 包管理器）", "安装 Node.js 后执行 corepack enable，或在终端确认 pnpm -v 可用；零依赖模板不需要这一步。");
        return;
      }
      const why = info.error !== undefined ? info.error : `退出码 ${info.code ?? "null"}${info.signal !== null ? `（信号 ${info.signal}）` : ""}`;
      const tail = child.tail();
      this.fail(entry, "start", `预览进程退出了（${why}）${tail !== "" ? `\n${tail}` : ""}`, "点「打开预览」重试；若反复退出，检查项目 package.json 与 Node/pnpm 安装。");
    });
    // 探活循环同时盯住子进程早退：真实子进程退出是宏任务，而循环里的 sleep 在测试注入下可能
    // 不产生事件循环间隙——只在结尾查 exitedEarly 会漏掉"退出发生在探活期间"这一类。
    const ready = await this.waitReady(url, () => exitedEarly || entry.cancelled);
    if (entry.cancelled) return this.emitStopped(entry);
    if (!ready) {
      child.kill("SIGTERM");
      if (entry.child === child) entry.child = null;
      // 进程早退已经给出更准确的原因（退出码/ENOENT），别被"就绪超时"盖掉。
      if (exitedEarly) return entry.snapshot;
      const tail = child.tail();
      const diag = exited as PreviewChildExit | null;
      const detail = diag !== null && diag.error !== undefined ? `（${diag.error}）` : tail !== "" ? `\n${tail}` : "";
      return this.fail(entry, "ready", `预览服务启动超时${detail}`, "确认本机装了 Node 与 pnpm（终端执行 node -v、pnpm -v），再点「打开预览」重试。");
    }
    const snapshot: PreviewSnapshot = { projectPath: root, status: "ready", kind, url, port };
    this.emit(entry, snapshot);
    return snapshot;
  }

  /** 装依赖。返回 non-null = 已经以失败收束（返回 null = 装成功继续）。 */
  private async runPrepare(entry: Entry): Promise<PreviewSnapshot | null> {
    const child = this.deps.run("pnpm", ["install", "--ignore-scripts", "--reporter=append-only"], { cwd: entry.root });
    entry.child = child;
    const exit = await new Promise<PreviewChildExit>((resolveExit) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill("SIGTERM");
        resolveExit({ code: null, signal: null, error: `安装超过 ${String(Math.round(this.deps.prepareTimeoutMs / 1_000))} 秒未完成（已停止）` });
      }, this.deps.prepareTimeoutMs);
      child.onExit((info) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolveExit(info);
      });
    });
    if (entry.child === child) entry.child = null;
    // stop 杀掉安装进程后，exit.code 非 0 是「用户停止」而不是「安装失败」：别把 stopped 覆盖成 failed。
    if (entry.cancelled) return this.emitStopped(entry);
    if (exit.error !== undefined && /ENOENT|not found/i.test(exit.error)) {
      return this.fail(entry, "prepare", "找不到 pnpm（本机没有安装 Node 包管理器）", "安装 Node.js 后执行 corepack enable，或在终端确认 pnpm -v 可用；零依赖模板不需要这一步。");
    }
    if (exit.code !== 0) {
      const tail = child.tail();
      const why = exit.error ?? `退出码 ${exit.code ?? "null"}${exit.signal !== null ? `（信号 ${exit.signal}）` : ""}`;
      return this.fail(entry, "prepare", `安装依赖失败（${why}）${tail !== "" ? `\n${tail}` : ""}`, "检查网络后重试；国内网络可先配好 npm 镜像。");
    }
    return null;
  }

  private async waitReady(url: string, abort?: () => boolean): Promise<boolean> {
    const attempts = Math.max(1, Math.ceil(this.deps.readyTimeoutMs / this.deps.probeIntervalMs));
    for (let i = 0; i < attempts; i += 1) {
      if (abort?.() === true) return false;
      if (await this.deps.probe(url)) return true;
      await this.deps.sleep(this.deps.probeIntervalMs);
    }
    return false;
  }

  private emitStopped(entry: Entry): PreviewSnapshot {
    const snapshot: PreviewSnapshot = { projectPath: entry.root, status: "stopped", reason: "user" };
    this.emit(entry, snapshot);
    return snapshot;
  }
}

/** 面向用户的一句话状态（渲染层唯一文案出口；与 PreviewSnapshot 同源，不各写一份）。 */
export function previewStatusText(s: PreviewSnapshot): string {
  switch (s.status) {
    case "idle":
      return "预览未启动";
    case "preparing":
      return s.detail ?? "准备中";
    case "starting":
      return s.detail ?? "启动中";
    case "ready":
      return `预览已就绪：${s.url ?? ""}`;
    case "failed":
      return `预览失败（${s.stage ?? "未知阶段"}）：${s.message ?? ""}`;
    case "stopped":
      return "预览已停止";
  }
}
