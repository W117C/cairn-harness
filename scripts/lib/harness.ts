// 渲染层验收共享工具（renderer-arch-check / a11y-check 共用）。
//
// 为什么单开一个 lib 而不是复用 scripts/panels-check.ts：panels-check 是另一道门的
// 判卷文件（冻结面），改它等于同时改判据与实现；本 lib 只**抄做法**不改它。
//
// 两条驱动路径：
//   A. Electron 模式（默认）：起真实交付壳（electron .）+ --remote-debugging-port，
//      连 CDP 的 page target。这是**真实交付面**，门禁默认走这条。
//   B. --static <dir> 模式：内置只读 HTTP 服务 + headless Chrome + CDP。
//      用途是**反向对照**——把已知有缺陷的样本目录喂进来，门必须判红。
//      用 HTTP 而非 file://：Chrome 按 CORS 拦截 file:// 下的 <script type="module">，
//      app.js 不会执行，测出来的是「只有静态标记」的假象（proto/cdp-probe.mjs 实测）。
//
// 本宿主一律 --no-sandbox：宿主拒载 Chromium 自带沙箱（见 panels-check.ts:163-172），
// 与应用自身的 Seatbelt 工具沙箱（src/main/sandbox.ts）是两回事。
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";

/** 首启会弹 §13 新手引导——不判它的门必须把自己扮成「已完成引导的返回用户」，
 *  否则浮层盖住每一次点击。做法放在共享 lib 里，是为了不让两个门各抄一份「怎么种 settings」
 *  （本仓反复出现的就是同族出口各抄一份，然后只改对一边）。
 *  落点用调用方自己的 profileDir：那里本来就由门负责删。 */
export async function seedSettingsFor(dir: string): Promise<string> {
  const path = join(dir, "settings.json");
  await writeFile(path, JSON.stringify({ onboarded: true }), "utf8");
  return path;
}

// ---------------------------------------------------------------- CDP

interface CdpMessage {
  id?: number;
  result?: Record<string, unknown>;
  error?: { message?: string };
}

/** 极简 CDP 客户端（page-level WebSocket）。抄自 panels-check.ts:95-139 的做法。 */
export class Cdp {
  private ws: WebSocket | null = null;
  private seq = 0;
  private pending = new Map<number, { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }>();

  /** 连到 http://127.0.0.1:<port> 上第一个 type=page 的 target。 */
  async connect(port: number): Promise<void> {
    const base = "http://127.0.0.1:" + String(port);
    const page = await waitFor(async () => {
      const targets = (await (await fetch(base + "/json/list")).json()) as { webSocketDebuggerUrl: string; type: string }[];
      return targets.find((t) => t.type === "page") ?? null;
    }, 25_000, 200);
    await this.connectWs(page.webSocketDebuggerUrl);
  }

  async connectWs(wsUrl: string): Promise<void> {
    this.ws = new WebSocket(wsUrl);
    await new Promise<void>((res, rej) => {
      this.ws!.onopen = () => res();
      this.ws!.onerror = (e) => rej(new Error("CDP WS 连接失败 " + String(e)));
      this.ws!.onmessage = (ev) => {
        const msg = JSON.parse(String(ev.data)) as CdpMessage;
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id)!;
          this.pending.delete(msg.id);
          if (msg.error) p.reject(new Error("CDP 错误: " + String(msg.error.message ?? JSON.stringify(msg.error))));
          else p.resolve(msg.result ?? {});
        }
      };
    });
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    return new Promise((res, rej) => {
      if (this.ws === null) {
        rej(new Error("CDP 未连接: " + method));
        return;
      }
      const id = ++this.seq;
      this.pending.set(id, { resolve: res, reject: rej });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          rej(new Error("CDP 超时: " + method));
        }
      }, 30_000);
    });
  }

  /** 求值并取回值；页面内抛错一律上抛（不静默成 null）。 */
  async eval<T>(expression: string): Promise<T> {
    const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if ("exceptionDetails" in r) throw new Error("CDP eval 异常: " + JSON.stringify(r).slice(0, 400));
    const res = r.result as { value?: T } | undefined;
    return (res?.value ?? null) as T;
  }

  close(): void {
    try {
      this.ws?.close();
    } catch {
      /* 已关闭 */
    }
  }
}

// ---------------------------------------------------------------- 等待 / 断言

export async function waitFor<T>(probe: () => Promise<T | null>, timeoutMs: number, everyMs = 100): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const v = await probe();
      if (v !== null && v !== undefined && v !== false) return v as T;
    } catch {
      /* 未就绪 */
    }
    if (Date.now() > deadline) throw new Error("waitFor 超时（" + String(timeoutMs) + "ms）");
    await new Promise((r) => setTimeout(r, everyMs));
  }
}

export async function tryWait(probe: () => Promise<unknown>, timeoutMs: number): Promise<boolean> {
  try {
    await waitFor(probe, timeoutMs, 200);
    return true;
  } catch {
    return false;
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export interface Reporter {
  ok(cond: boolean, label: string): void;
  fail(label: string): void;
  readonly failures: number;
  readonly total: number;
}

/** 逐条打印 ✅/❌ 的判定器（口径与 panels-check 一致）。 */
export function makeReporter(): Reporter {
  let failures = 0;
  let total = 0;
  return {
    ok(cond: boolean, label: string): void {
      total++;
      console.log((cond ? "  ✅ " : "  ❌ ") + label);
      if (!cond) failures++;
    },
    fail(label: string): void {
      total++;
      failures++;
      console.log("  ❌ " + label);
    },
    get failures(): number {
      return failures;
    },
    get total(): number {
      return total;
    },
  };
}

// ---------------------------------------------------------------- 静态 HTTP 服务

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

export interface StaticServer {
  url: string;
  close(): Promise<void>;
}

/** 只读静态服务（仅本机回环），供 --static 模式驱动构建产物目录。 */
export async function serveStatic(dir: string, port: number): Promise<StaticServer> {
  const root = resolve(dir);
  const server: Server = createServer((req, res) => {
    const rel = decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/");
    const file = join(root, rel);
    if (!file.startsWith(root)) {
      res.writeHead(403).end("forbidden");
      return;
    }
    void readFile(file).then(
      (buf) => {
        res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
        res.end(buf);
      },
      () => {
        res.writeHead(404).end("not found");
      },
    );
  });
  await new Promise<void>((res) => server.listen(port, "127.0.0.1", res));
  return {
    url: "http://127.0.0.1:" + String(port) + "/",
    close: async (): Promise<void> => {
      await new Promise<void>((res) => server.close(() => res()));
    },
  };
}

// ---------------------------------------------------------------- 进程启动

export interface Launched {
  proc: ChildProcess;
  output(): string;
  kill(): Promise<void>;
}

async function killProc(p: ChildProcess): Promise<void> {
  if (p.exitCode !== null) return;
  p.kill("SIGKILL");
  await sleep(600);
}

/** headless Chrome + CDP（--static 模式）。profile 目录必须独立，避免与别的门/探针互踩。 */
export function launchChromeCdp(opts: { port: number; profileDir: string }): Launched {
  const bin = process.env.CHROME_BIN ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const chunks: string[] = [];
  const proc = spawn(
    bin,
    [
      "--headless=new",
      "--remote-debugging-port=" + String(opts.port),
      "--user-data-dir=" + opts.profileDir,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      "--no-sandbox",
      "--hide-scrollbars",
      "about:blank",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  proc.stdout?.on("data", (d: Buffer) => chunks.push(String(d)));
  proc.stderr?.on("data", (d: Buffer) => chunks.push(String(d)));
  return { proc, output: () => chunks.join(""), kill: () => killProc(proc) };
}

/** 真实交付壳：electron . + --remote-debugging-port（默认模式）。 */
export function launchElectronCdp(opts: { port: number; env?: NodeJS.ProcessEnv }): Launched {
  const rel =
    process.platform === "darwin"
      ? ["Electron.app", "Contents", "MacOS", "Electron"]
      : process.platform === "win32"
        ? ["electron.exe"]
        : ["electron"];
  const bin = join(process.cwd(), "node_modules", "electron", "dist", ...rel);
  const chunks: string[] = [];
  const proc = spawn(bin, [".", "--no-sandbox", "--remote-debugging-port=" + String(opts.port)], {
    env: { ...process.env, ...(opts.env ?? {}) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stdout?.on("data", (d: Buffer) => chunks.push(String(d)));
  proc.stderr?.on("data", (d: Buffer) => chunks.push(String(d)));
  return { proc, output: () => chunks.join(""), kill: () => killProc(proc) };
}

/** CDP 端口可达性探针（fail-visible 判定的第一道关）。 */
export async function cdpUp(port: number): Promise<boolean> {
  return await tryWait(async () => {
    try {
      const r = await fetch("http://127.0.0.1:" + String(port) + "/json/version");
      return r.ok ? true : null;
    } catch {
      return null;
    }
  }, 30_000);
}

/**
 * 启动失败归因（把「起不来」从一句无信息量的红，变成可操作的诊断）。
 * 命中已知形态才返回提示，否则返回 null——不猜、不编。
 */
export function diagnoseBoot(output: string): string | null {
  if (output.includes("does not provide an export named")) {
    return (
      "宿主 Electron 的 ESM 加载器无法解析 `import { … } from \"electron\"`（最小复现：任意 ESM 主进程 app 均报同一错，" +
      "`electron --version` 还会打印 Node 版本）→ 交付壳在本宿主**根本起不来**，与产品代码无关。" +
      "变通：给本门加 `--static out/renderer`，改为驱动构建产物（headless Chrome + CDP）。"
    );
  }
  if (output.includes("sandbox initialization failed")) {
    return "Chromium 沙箱初始化失败——本宿主拒载自带沙箱，应以 --no-sandbox 启动（本 lib 已默认加）。";
  }
  return null;
}

// ---------------------------------------------------------------- 参数

export interface CliArgs {
  /** null = Electron 模式；非 null = 把该目录当静态站点驱动。 */
  staticDir: string | null;
  /** 显式要求走 Electron 交付壳（--electron / --require-electron）。 */
  forceElectron: boolean;
  port: number;
  htmlPath: string;
  /** 参数冲突等致命错误；非 null 时调用方应打印并退出 2（fail-visible，不猜）。 */
  error: string | null;
}

/** 默认判卷目标：构建产物目录（`build` 在 GATES 里排在本族门之前，产物必已就绪）。 */
export const DEFAULT_STATIC_DIR = "out/renderer";

/**
 * 解析 `--static <dir>` / `--electron` / `--require-electron` / `--port <n>` / `--html <file>`。
 *
 * 取舍（裁决 1，2026-09-17）：**默认走 `--static <构建产物>`**，不走 Electron。
 * 理由：本宿主 Electron 交付壳根本起不来（`import { BrowserWindow } from "electron"`
 * 在本宿主 ESM loader 下解析到 npm wrapper 而失败，`Electron --version` 打印的是
 * Node v24.20.0 而非 44.2.0——已归档于 BLOCKED.md:432）。断言集在两支下**完全相同**，
 * 只有启动机制不同；而构建产物正是**发货物**。让默认路径永久红只会训练人忽略门禁。
 * Electron 路径**保留**为显式 opt-in，供能起 Electron 的宿主 / CI 强制走严格路径。
 *
 * 刻意**不做**「先试 Electron、超时再降级」的自动探测：那会给每次跑白加约 25s
 * 超时等待，且降级时机不确定；显式传参才是确定性的。
 */
export function parseArgs(argv: string[], defaultPort: number): CliArgs {
  let staticDir: string | null = null;
  let staticGiven = false;
  let forceElectron = false;
  let port = Number(process.env.CDP_PORT ?? defaultPort);
  let htmlPath = "index.html";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--static") {
      staticDir = argv[i + 1] ?? null;
      staticGiven = true;
      i++;
    } else if (a === "--electron" || a === "--require-electron") {
      forceElectron = true;
    } else if (a === "--port") {
      port = Number(argv[i + 1] ?? port);
      i++;
    } else if (a === "--html") {
      htmlPath = argv[i + 1] ?? htmlPath;
      i++;
    }
  }
  if (forceElectron && staticGiven) {
    return {
      staticDir,
      forceElectron,
      port,
      htmlPath,
      error: "--static 与 --electron 互斥：一次只能选一种驱动（--static <dir> 走构建产物；--electron 走真实交付壳）",
    };
  }
  if (!forceElectron && !staticGiven) staticDir = DEFAULT_STATIC_DIR;
  return { staticDir, forceElectron, port, htmlPath, error: null };
}

/** 打印判卷目标（fail-visible：别让人误以为测的是 Electron 壳）。 */
export function printTarget(args: CliArgs): void {
  if (args.staticDir !== null) {
    console.log("  ℹ️  测试目标：构建产物 " + args.staticDir + "（Electron 交付壳在本宿主起不来，见 BLOCKED.md:432）");
  } else {
    console.log("  ℹ️  测试目标：Electron 真实交付壳（--electron 显式指定）");
  }
}
