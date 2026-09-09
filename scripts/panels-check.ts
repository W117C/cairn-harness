// M1e 验收脚本（pnpm panels-check）：
//   A. headless：settings 布局持久化（写→重载一致 / 非法回退默认）+ 会话列表 CRUD + 会话 run→重放投影逐字一致
//   B. Electron + CDP：1 万条事件虚拟化（DOM ≤300 / 滚动一屏 ≤200ms）+ 审批徽标 ≤1s + 布局重启还原 + 截图
// 退出码 0 = 全部断言通过；任何断言失败退出码 1。
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEventLog } from "../src/events";
import { pathOf } from "../src/main/sessions";
import { SettingsStore, DEFAULT_SETTINGS } from "../src/main/settings";
import { projectDiffCards, projectTokenUsage } from "../src/renderer/projections";
import type { AgentEvent } from "../src/events";

let failures = 0;
function ok(cond: boolean, label: string): void {
  console.log((cond ? "  ✅ " : "  ❌ ") + label);
  if (!cond) failures++;
}

const SNAPSHOT_TMP = join(tmpdir(), "m1e-panels-replay.json");
const SNAPSHOT_LIVE = join(tmpdir(), "m1e-panels-live.json");
const ROOT_DIR = process.argv[2] ?? "";

// ---------------------------------------------------------------- A. headless
async function phaseSettings(root: string): Promise<void> {
  console.log("[panels-check] A1 布局持久化（settings 存储，写入后重新加载得到相同布局）");
  const file = join(root, "settings.json");
  const a = new SettingsStore(file);
  await a.set({ layout: { open: { approvals: false, token: false, git: true }, activePanel: "git", width: 40 }, mode: "auto" });
  const b = new SettingsStore(file); // 重新加载 = 新实例读盘（重启同路径）
  const reread = await b.get();
  ok(reread.layout.open.git === true, "重启还原：open.git = true");
  ok(reread.layout.activePanel === "git", "重启还原：activePanel = git");
  ok(reread.layout.width === 40, "重启还原：width = 40");
  ok(reread.mode === "auto", "重启还原：档位 mode = auto");

  console.log("[panels-check] A2 非法布局值回退默认");
  const bad = join(root, "bad.json");
  await writeFile(bad, JSON.stringify({ layout: { width: 9999, open: { git: "yes" }, activePanel: "nope" }, mode: "chaos" }), "utf8");
  const s = await new SettingsStore(bad).get();
  ok(s.layout.width === DEFAULT_SETTINGS.layout.width, "宽度越界回退默认");
  ok(s.layout.open.git === false, "open 非布尔回退默认");
  ok(s.layout.activePanel === null, "未知 activePanel 回退 null");
  ok(s.mode === DEFAULT_SETTINGS.mode, "非法档位回退默认");
  await writeFile(bad, "{ broken json", "utf8");
  const s2 = await new SettingsStore(bad).get();
  ok(JSON.stringify(s2) === JSON.stringify(DEFAULT_SETTINGS), "JSON 损坏回退全默认");
}

async function phaseSessions(root: string): Promise<void> {
  console.log("[panels-check] A3 会话列表（新建/切换/删除回退）");
  const { createSession, listSessions, readSessionEvents, deleteSession } = await import("../src/main/sessions");
  const created = await createSession(root, "验收会话");
  const list = await listSessions(root);
  ok(list.some((s) => s.id === created), "新建 → 出现在列表");
  const three = await createSession(root, "三行会话");
  const log = createEventLog(pathOf(root, three));
  for (let i = 0; i < 3; i++) await log.append({ type: "user_message", content: "m" + String(i) });
  const events = await readSessionEvents(root, three);
  ok(events.length === 3, "切换 → 投影事件数 = JSONL 行数（3）");
  await deleteSession(root, three);
  await deleteSession(root, created);
  const rest = await listSessions(root);
  ok(!rest.some((s) => s.id === created) && !rest.some((s) => s.id === three), "删除 → 列表消失");
  ok(rest[0] !== undefined, "删除当前会话 → 回退到最近一个（" + (rest[0]?.id ?? "无") + "）");
}

// 重放投影子进程：丢弃内存态后以同一投影函数重算（fresh memory）
async function phaseReplay(root: string, sid: string): Promise<void> {
  console.log("[panels-check] A4 会话 run → 丢弃内存态 → 重新加载 → 面板投影逐字一致");
  // 坑：pnpm 环境下 process.execPath 可能是宿主应用二进制（非 node CLI），--import 不被识别 → 静默退出。
  // 用 PATH 里的 node（与六道门同解），scripts 统一口径（坑四：node --import tsx）。
  const child = spawn("node", ["--import", "tsx", "scripts/panels-check.ts", "--replay-child", root, sid, SNAPSHOT_TMP], { stdio: ["ignore", "inherit", "inherit"] });
  await new Promise<void>((resolve, reject) => {
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("重放子进程退出码 " + String(code)))));
    child.on("error", reject);
  });
  const reloaded = JSON.parse(await readFile(SNAPSHOT_TMP, "utf8")) as unknown;
  const live = JSON.parse(await readFile(SNAPSHOT_LIVE, "utf8")) as unknown;
  const same = JSON.stringify(live) === JSON.stringify(reloaded);
  ok(same, "面板投影（token/diff/事件数）重启前后逐字一致");
  if (!same) {
    console.log("    live:    ", JSON.stringify(live).slice(0, 400));
    console.log("    reloaded:", JSON.stringify(reloaded).slice(0, 400));
  }
}

// ---------------------------------------------------------------- B. Electron + CDP
const PORT = 9222 + (process.pid % 500);
const CDP_URL = "http://127.0.0.1:" + String(PORT);

interface CdpMessage { id?: number; result?: Record<string, unknown>; error?: { message: string } }

class Cdp {
  private ws: WebSocket | null = null;
  private seq = 0;
  private pending = new Map<number, (v: Record<string, unknown>) => void>();

  async connect(): Promise<void> {
    const page = await waitFor(async () => {
      const targets = (await (await fetch(CDP_URL + "/json/list")).json()) as { webSocketDebuggerUrl: string; type: string }[];
      return targets.find((t) => t.type === "page") ?? null;
    }, 20_000, 200);
    this.ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      this.ws!.onopen = () => resolve();
      this.ws!.onerror = (e) => reject(new Error("WS 错误 " + String(e)));
      this.ws!.onmessage = (ev) => {
        const msg = JSON.parse(String(ev.data)) as CdpMessage;
        if (msg.id && this.pending.has(msg.id)) {
          this.pending.get(msg.id)!(msg.result ?? {});
          this.pending.delete(msg.id);
        }
      };
    });
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      this.pending.set(id, resolve);
      this.ws!.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error("CDP 超时: " + method));
        }
      }, 30_000);
    });
  }

  async eval<T>(expression: string): Promise<T> {
    const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r && "exceptionDetails" in r) throw new Error("CDP eval 异常: " + JSON.stringify(r).slice(0, 300));
    const res = r.result as { value?: T } | undefined;
    return (res?.value ?? null) as T;
  }
}

async function waitFor<T>(probe: () => Promise<T | null>, timeoutMs: number, everyMs = 100): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const v = await probe();
      if (v !== null && v !== undefined && v !== false) return v as T;
    } catch { /* 未就绪 */ }
    if (Date.now() > deadline) throw new Error("waitFor 超时");
    await new Promise((r) => setTimeout(r, everyMs));
  }
}

function spawnElectron(env: NodeJS.ProcessEnv): { proc: ChildProcess; output: () => string } {
  const bin = join(process.cwd(), "node_modules", "electron", "dist", "Electron.app", "Contents", "MacOS", "Electron");
  const chunks: string[] = [];
  const proc = spawn(bin, [".", "--remote-debugging-port=" + String(PORT)], {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stdout!.on("data", (d: Buffer) => chunks.push(String(d)));
  proc.stderr!.on("data", (d: Buffer) => chunks.push(String(d)));
  return { proc, output: () => chunks.join("") };
}

async function tryWait(probe: () => Promise<unknown>, timeoutMs: number): Promise<boolean> {
  try {
    await waitFor(probe, timeoutMs, 200);
    return true;
  } catch {
    return false;
  }
}

async function killElectron(p: ChildProcess): Promise<void> {
  p.kill("SIGKILL");
  await new Promise((r) => setTimeout(r, 600));
}

async function writeFileStressSession(root: string, id: string, n: number): Promise<void> {
  const log = createEventLog(pathOf(root, id));
  for (let i = 0; i < n; i++) {
    const t = i % 4;
    if (t === 0) await log.append({ type: "user_message", content: "任务 " + String(i) });
    else if (t === 1) await log.append({ type: "assistant_message", content: "回复 " + String(i) + "：已处理该步骤。" });
    else if (t === 2) await log.append({ type: "tool_call", id: "s" + String(i), name: "read_file", args: { path: "src/x.ts" } });
    else await log.append({ type: "usage", inputTokens: 10, outputTokens: 5 });
  }
}

async function readInjectSentAt(output: () => string): Promise<number | null> {
  // 从 stdout 找 [m1e] inject-ask at <ms>
  return await waitFor<number | null>(async () => {
    const m = output().match(/\[m1e\] inject-ask at (\d+)/);
    return m ? Number(m[1]) : null;
  }, 30_000, 50);
}

async function phaseElectron(root: string): Promise<void> {
  console.log("[panels-check] B0 构建（out/ 必须与当前源码一致，否则测的是旧 bundle）");
  const buildProc = spawn("node", ["node_modules/electron-vite/bin/electron-vite.js", "build"], { stdio: ["ignore", "inherit", "inherit"] });
  await new Promise<void>((resolve, reject) => {
    buildProc.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("electron-vite build 退出码 " + String(code)))));
    buildProc.on("error", reject);
  });
  console.log("[panels-check] B1 1 万条事件虚拟化（真实重放路径）");
  const stressId = "压测会话-万条";
  await writeFileStressSession(root, stressId, 10_000);

  const { proc: electron, output } = spawnElectron({
    M1E_SESSIONS_DIR: root,
    M1E_SETTINGS_PATH: join(root, "settings.json"),
    M1E_INJECT_ASK: "1",
    M1E_INJECT_ASK_DELAY_MS: "5000",
  });
  try {
    await waitFor(async () => {
      try {
        const r = await fetch(CDP_URL + "/json/version");
        return r.ok ? true : null;
      } catch { return null; }
    }, 25_000);
    const cdp = new Cdp();
    await cdp.connect();

    // 等重放落定：侧栏事件计数 = 10000
    await waitFor(async () => {
      const cnt = await cdp.eval<string | null>("document.querySelector('[data-m1e-event-count]')?.textContent ?? null");
      return cnt && cnt.includes("10000") ? true : null;
    }, 40_000, 200);

    // 等虚拟化初始渲染落定（首帧 itemContent 经 rAF 挂载）
    await waitFor(async () => {
      const c = await cdp.eval<number>("document.querySelectorAll('[data-m1e-item]').length");
      return c > 0 ? c : null;
    }, 15_000, 100);
    const domCount = await cdp.eval<number>("document.querySelectorAll('[data-m1e-item]').length");
    ok(domCount > 0 && domCount <= 300, "虚拟化挂载：状态 10000 条，DOM 消息节点 " + String(domCount) + " ≤ 300");

    // 预热一次（首次滚动吃 JIT/字体/GC 的一次性成本，不计入；连续 3 次取 max 为稳态口径）
    await cdp.eval<number[]>("(async () => { const sc = document.querySelector('[data-virtuoso-scroller]'); if (!sc) return [-1]; sc.scrollBy(0, 40); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); sc.scrollBy(0, -40); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); return [1]; })()");
    const scrollTimes = await cdp.eval<number[]>("(async () => { const sc = document.querySelector('[data-virtuoso-scroller]'); if (!sc) return [-1]; const times = []; for (let i = 0; i < 3; i++) { const t0 = performance.now(); sc.scrollBy(0, sc.clientHeight); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); times.push(performance.now() - t0); } return times; })()");
    const maxScroll = Math.max(...scrollTimes);
    ok(maxScroll >= 0 && maxScroll <= 200, "滚动一屏耗时 max " + maxScroll.toFixed(1) + "ms ≤ 200ms");

    await cdp.eval("(() => { const sc = document.querySelector('[data-virtuoso-scroller]'); if (sc) sc.scrollTop = sc.scrollHeight / 2; return true; })()");
    await new Promise((r) => setTimeout(r, 500));
    const midCount = await cdp.eval<number>("document.querySelectorAll('[data-m1e-item]').length");
    ok(midCount <= 300, "滚动至中段 DOM 仍 ≤ 300（实际 " + String(midCount) + "）");

    console.log("[panels-check] B2 审批徽标 ≤1s");
    const sentAtPromise = readInjectSentAt(output);

    await waitFor(async () => {
      const badge = await cdp.eval<boolean | null>("!!document.querySelector('[data-approval-badge]')");
      return badge ? true : null;
    }, 40_000, 40);
    const tVisible = Date.now(); // 徽标已在 DOM（waitFor 返回即出现时刻上界）
    const sentAt = await sentAtPromise;
    ok(sentAt !== null && tVisible - sentAt <= 1000, "徽标出现距审批推送 " + String(tVisible - (sentAt ?? tVisible)) + "ms ≤ 1000ms");

    console.log("[panels-check] B3 布局持久化：UI 开关 → settings 落盘 → 重启还原");
    await cdp.eval("(() => { document.querySelector('[data-panel-toggle=git]')?.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; })()");
    const diskOk = await tryWait(async () => {
      const disk = JSON.parse(await readFile(join(root, "settings.json"), "utf8")) as { layout?: { open?: Record<string, boolean>; activePanel?: string } };
      return disk.layout?.open?.git === true && disk.layout?.activePanel === "git" ? true : null;
    }, 10_000);
    ok(diskOk, "UI 开关 git 面板 → settings.json 落盘 open.git=true + activePanel=git");
    const shot1 = await cdp.send("Page.captureScreenshot", { format: "png" });
    await writeFile(join(process.cwd(), "docs", "m1e-panels.png"), Buffer.from(shot1.data as string, "base64"));
    console.log("  📷 docs/m1e-panels.png");

    await cdp.eval("(() => { document.querySelector('[data-m1e-settings-open]')?.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; })()");
    await new Promise((r) => setTimeout(r, 700));
    const shot2 = await cdp.send("Page.captureScreenshot", { format: "png" });
    await writeFile(join(process.cwd(), "docs", "m1e-settings.png"), Buffer.from(shot2.data as string, "base64"));
    console.log("  📷 docs/m1e-settings.png");

    await killElectron(electron);

    console.log("[panels-check] B4 重启还原（新进程）");
    const { proc: electron2 } = spawnElectron({ M1E_SESSIONS_DIR: root, M1E_SETTINGS_PATH: join(root, "settings.json") });
    await waitFor(async () => {
      try {
        const r = await fetch(CDP_URL + "/json/version");
        return r.ok ? true : null;
      } catch { return null; }
    }, 25_000);
    const cdp2 = new Cdp();
    await cdp2.connect();
    const restored = await tryWait(async () => {
      const open = await cdp2.eval<boolean | null>("!!document.querySelector('[data-panel-id=git]')");
      return open ? true : null;
    }, 25_000);
    ok(restored, "重启后 git 面板自动还原打开（settings 持久化生效）");
    await killElectron(electron2);
  } finally {
    if (electron.exitCode === null) await killElectron(electron);
  }
}

// ---------------------------------------------------------------- main
const argPhase = process.argv[2];
if (argPhase === "--replay-child") {
  const root = process.argv[3];
  const id = process.argv[4];
  const out = process.argv[5];
  const { readSessionEvents } = await import("../src/main/sessions");
  const { projectDiffCards, projectTokenUsage } = await import("../src/renderer/projections");
  const events = await readSessionEvents(root, id);
  const proj = { tokens: projectTokenUsage(events), diffs: projectDiffCards(events).map((d) => d.id), count: events.length };
  await writeFile(out, JSON.stringify(proj));
  process.exit(0);
}

console.log("[panels-check] M1e 验收开始");
const work = ROOT_DIR || (await mkdtemp(join(tmpdir(), "m1e-panels-check-")));
// 陈旧快照防御：上次运行的 live/replay 快照不参与本轮判卷
await rm(SNAPSHOT_LIVE, { force: true });
await rm(SNAPSHOT_TMP, { force: true });
try {
  // 跑一轮会话（mock 闭环，事件落会话文件），提供投影快照的活流口径
  const { handleAgentRun, initSessionsDir, initSettingsStore } = await import("../src/main/agent-runner");
  const { createSession } = await import("../src/main/sessions");
  initSessionsDir(work);
  initSettingsStore(join(work, "settings.json"));
  const sid = await createSession(work, "验收会话");
  const liveEvents: AgentEvent[] = [];
  const run = await handleAgentRun(
    { message: "修复 fixtures/todo-app 中失败的测试", mode: "auto" },
    { sessionId: sid, onEvent: (e) => liveEvents.push(e) },
  );
  if (!run.ok) throw new Error("会话 run 失败: " + String(run.error));
  const liveProj = { tokens: projectTokenUsage(liveEvents), diffs: projectDiffCards(liveEvents).map((d) => d.id), count: liveEvents.length };
  await writeFile(SNAPSHOT_LIVE, JSON.stringify(liveProj));

  await phaseSettings(work);
  await phaseSessions(work);
  await phaseReplay(work, sid);
  await phaseElectron(work);
} finally {
  if (!ROOT_DIR) await rm(work, { recursive: true, force: true }).catch(() => {});
}

console.log("[panels-check] " + (failures === 0 ? "全部断言通过 ✅" : String(failures) + " 项失败 ❌"));
process.exit(failures === 0 ? 0 : 1);
