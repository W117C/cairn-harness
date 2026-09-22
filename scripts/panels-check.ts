// M1e 验收脚本（pnpm panels-check）：
//   A. headless：settings 布局持久化（写→重载一致 / 非法回退默认）+ 会话列表 CRUD + 会话 run→重放投影逐字一致
//   B. Electron + CDP：1 万条事件虚拟化（DOM ≤300 / 滚动一屏 ≤200ms）+ 审批徽标 ≤1s + 布局重启还原 + 会话重命名落盘 + 截图
// 退出码 0 = 全部断言通过；任何断言失败退出码 1。
import { spawn, type ChildProcess } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
  // H12（审查 P3）：Electron 二进制路径按平台分支（旧实现硬编码 macOS .app 布局，非 darwin 不可用）。
  const rel =
    process.platform === "darwin"
      ? join("Electron.app", "Contents", "MacOS", "Electron")
      : process.platform === "win32"
        ? "electron.exe"
        : "electron";
  const bin = join(process.cwd(), "node_modules", "electron", "dist", ...rel.split("/"));
  const chunks: string[] = [];
  // M2g 环境适配（fail-visible）：本宿主拒载 Chromium 自带沙箱（`sandbox initialization failed:
  // Operation not permitted`，GPU/network 子进程连锁崩溃），Electron 起不来 → B 相全部断言无从谈起。
  // 这是**宿主限制**而非产品沙箱：应用自身的 Seatbelt 工具沙箱是另一套（src/main/sandbox.ts），
  // 与本开关无关。此处仅给验收脚本的 Electron 进程加 --no-sandbox 让窗口真的起来，
  // 使 B 相断言从「真空通过」回到「真测到」。可用 --require-chromium-sandbox 关闭该适配。
  const chromiumSandbox = process.argv.includes("--require-chromium-sandbox");
  const extraArgs = chromiumSandbox ? [] : ["--no-sandbox"];
  if (!chromiumSandbox) {
    console.log("  ℹ️  宿主拒载 Chromium 沙箱 → Electron 以 --no-sandbox 启动（产品 Seatbelt 工具沙箱不受影响）");
  }
  const proc = spawn(bin, [".", ...extraArgs, "--remote-debugging-port=" + String(PORT)], {
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

/** tryWait 只回答「红没红」；等的是**值**（读回一屏快照、盘上行数、追到的那一行 JSON）时用这条。
 *  超时返回 null——调用方的断言因此能同时表达「没等到」与「等到了但不是它」。 */
async function settle<T>(read: () => Promise<T | null>, timeoutMs = 10_000): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await read();
    if (v !== null) return v;
    if (Date.now() > deadline) return null;
    await new Promise((r) => setTimeout(r, 60));
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
  // 从 stdout 找 [m1e] inject-ask at <ms>。
  // 超时返回 null（不抛）：注入标记缺失会让 B2 断言以 delay=-1 失败并给出诊断，
  // 但 B3/B4 仍需继续出 verdict——裸抛会杀掉整个 check 进程，把时序 flake 升级成
  // 「连后相都没跑」的信息黑洞（2026-09-18 实测三连跑：红/崩溃/绿）。
  try {
    return await waitFor<number | null>(async () => {
      const m = output().match(/\[m1e\] inject-ask at (\d+)/);
      return m ? Number(m[1]) : null;
    }, 30_000, 50);
  } catch {
    return null;
  }
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
  // B6 的靶子先落盘：列表按 mtime 降序、启动即自动开**最新**那条，B1 的万条断言指着它。
  // 靶子必须在起 Electron 之前写（列表只在启动时读一次盘），但绝不能比压测会话更新。
  const clarifyId = "澄清靶子";
  {
    const log = createEventLog(pathOf(root, clarifyId));
    await log.append({ type: "user_message", content: "把导出功能加上" });
    await log.append({
      type: "clarify_requested",
      callId: "m1e-clarify-1",
      questions: [
        { question: "导出成哪种格式？", header: "格式", options: [{ label: "CSV" }, { label: "JSON", description: "带嵌套结构" }] },
        { question: "要包含哪些行？", multiSelect: true, options: [{ label: "已完成" }, { label: "未完成" }] },
      ],
    });
  }
  await writeFileStressSession(root, stressId, 10_000);

  const { proc: electron, output } = spawnElectron({
    M1E_SESSIONS_DIR: root,
    M1E_SETTINGS_PATH: join(root, "settings.json"),
    M1E_INJECT_ASK: "1",
    M1E_INJECT_ASK_DELAY_MS: "5000",
  });
  try {
    const up = await tryWait(async () => {
      try {
        const r = await fetch(CDP_URL + "/json/version");
        return r.ok ? true : null;
      } catch { return null; }
    }, 25_000);
    if (!up) {
      // fail-visible：窗口没起来 = 本相**未验证**，不得静默算绿（M2g §1.4-1）
      ok(false, "B0 Electron 起不来 → B 相未验证（CDP 不可达，窗口从未启动）");
      console.log("    诊断（进程输出尾 8 行）：");
      for (const l of output().trim().split("\n").slice(-8)) console.log("      " + l);
      return;
    }
    const cdp = new Cdp();
    await cdp.connect();

    // 等重放落定 + 会话级真实统计（MAINT-06 第二批判据修正，BLOCKED.md 已裁决授权 2026-09-17）：
    // ① 废除「#eventCount 重放至 10000」断言——#eventCount 是 api.onEvent 实时运行计数器，
    //    历史重放不经该通道，拿它断言重放值属语义错配（假红源头）。节点与其「实时计数」
    //    语义保留不动（VIS-02），此处只退化为存在性 + 非负整数格式检查。
    // ② 会话级统计改以磁盘事实源为准：压测会话 JSONL 行数 = 10000，且侧栏真实 DOM
    //    出现该会话节点（listSessions → sessionItemHTML 渲染链路）。
    // 等重放**落定**：要求历史窗口读数「> 0 且连续两次相同」——只看 >0 会抓住半渲染帧，
    // 15s 预算在高负载宿主上也不够（实测约 1/5 概率把未落定的 0 当成真红，见
    // AGENTS.md 的 flake 记录）。**断言阈值一字不改**，只把测量时机推后到真落定；
    // 若重放真的起不来，tryWait 超时后 ok() 仍会带实测数字红（fail-visible 不变）。
    let prevCount = -1;
    await tryWait(async () => {
      const c = await cdp.eval<number>(`document.querySelectorAll('.stream-inner > .msg[data-history]').length`);
      if (c <= 0) { prevCount = -1; return null; }
      if (c !== prevCount) { prevCount = c; return null; }
      return c;
    }, 40_000);
    const domCount = await cdp.eval<number>(`document.querySelectorAll('.stream-inner > .msg[data-history]').length`);
    ok(domCount > 0 && domCount <= 300, "虚拟化挂载：状态 10000 条，DOM 消息节点 " + String(domCount) + " ∈ (0, 300)");

    // 打开会话必须落在末尾：这是 showHistory 的 scrollStream(true)（结构性重挂 = 强制跟随）
    // 唯一被量的地方。R1b B1 把重放收敛进单一渲染器后，这条路径由 buildUnit 产出，
    // 一旦 force 丢失，用户重开会话会停在顶部且门上一路无人发现。
    const landed = await cdp.eval<{ gap: number; h: number }>(`(() => {
      const sc = document.querySelector('.stream');
      if (!sc) return { gap: -1, h: 0 };
      return { gap: sc.scrollHeight - sc.scrollTop - sc.clientHeight, h: sc.scrollHeight };
    })()`);
    ok(landed.h > 0 && landed.gap >= 0 && landed.gap <= 1,
      "打开会话后视图落在末尾（距底 " + landed.gap.toFixed(1) + "px ≤ 1，scrollHeight " + String(landed.h) + "）");

    const stressLines = (await readFile(pathOf(root, stressId), "utf8")).trim().split("\n").length;
    ok(stressLines === 10_000, "会话级统计（磁盘事实源）：压测会话 JSONL 行数 = 10000（实测 " + String(stressLines) + "）");
    const sessSel = '.session[data-id="' + stressId + '"]';
    const sessInList = await cdp.eval<boolean>(`!!document.querySelector(${JSON.stringify(sessSel)})`);
    ok(sessInList === true, "侧栏真实 DOM 出现压测会话节点（.session[data-id] 渲染链路）");
    const eventCountEl = await cdp.eval<string | null>(`document.querySelector('#eventCount')?.textContent ?? null`);
    ok(eventCountEl !== null && /^\d+$/.test(eventCountEl), "#eventCount 实时计数节点存在且为非负整数（实测 " + String(eventCountEl) + "，不与历史重放值挂钩）");

    // 滚动耗时口径升级：先跳到中段，再向下连续 3 次整屏；**每次必须 scrollTop 位移 > 0**，
    // 消除「从底部 scrollBy 不动也计时」的恒真口径。阈值保持原 200ms 不变。
    const SCROLLER_SEL = ".stream";
    const scrollProbe = await cdp.eval<{ times: number[]; moved: boolean[]; top: number }>(`(async () => {
      const sc = document.querySelector(${JSON.stringify(SCROLLER_SEL)});
      if (!sc) return { times: [-1], moved: [false], top: -1 };
      sc.scrollTop = sc.scrollHeight / 2;
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const times = [], moved = [];
      for (let i = 0; i < 3; i++) {
        const before = sc.scrollTop;
        const t0 = performance.now();
        sc.scrollBy(0, sc.clientHeight);
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        times.push(performance.now() - t0);
        moved.push(sc.scrollTop > before);
      }
      return { times, moved, top: sc.scrollTop };
    })()`);
    const maxScroll = Math.max(...scrollProbe.times);
    // 净位移口径：序列的滚动位置必须真实前进（top 高于起点）。逐次单调会与窗口化的
    // 测高锚点回修冲突（draw 把 scrollTop 微调回 correctedTop，属预期行为）；
    // 「序列净位移 = 0」即滚动坏死，仍能红。
    const netMoved = scrollProbe.top > scrollProbe.times.length && scrollProbe.moved.some(Boolean);
    ok(netMoved && maxScroll >= 0 && maxScroll <= 200, "滚动一屏（含净位移断言）耗时 max " + maxScroll.toFixed(1) + "ms ≤ 200ms");
    ok(scrollProbe.top > 0, "滚动后 scrollTop 真实落位（实测 " + String(scrollProbe.top) + "）");
    const midCount = await cdp.eval<number>(`document.querySelectorAll('.stream-inner > .msg[data-history]').length`);
    ok(midCount > 0 && midCount <= 300, "滚动至中段 DOM 仍 ∈ (0, 300)（实际 " + String(midCount) + "）");

    console.log("[panels-check] B2 审批徽标 ≤1s（匹配 askId + 推送前开始观测）");
    const sentAtPromise = readInjectSentAt(output);
    // 观测器在连接后立即启动（早于 5s 注入延迟）；只认匹配 askId 的待审批弹层 #askPop
    // （hidden 已解除、data-ask-id 等于注入 id），不认已决审批记录卡——后者把前序等待
    // 一并计入耗时，是原 72s/90s 口径污染的来源。阈值保持原 1000ms 不变。
    const askId = "m1e-inject-ask";
    const observerStartedAt = Date.now();
    const askSel = '#askPop:not([hidden])[data-ask-id="' + askId + '"]';
    let firstSeen: number | null = null;
    await tryWait(async () => {
      const there = await cdp.eval<boolean>(`!!document.querySelector(${JSON.stringify(askSel)})`);
      if (there && firstSeen === null) firstSeen = Date.now();
      return there ? true : null;
    }, 40_000);
    const sentAt = await sentAtPromise;
    const delay = firstSeen !== null && sentAt !== null ? firstSeen - sentAt : -1;
    const observedBeforePush = firstSeen !== null && sentAt !== null && firstSeen < sentAt;
    ok(
      sentAt !== null && firstSeen !== null && !observedBeforePush && delay >= 0 && delay <= 1000,
      "审批弹层（askId=" + askId + "）首次可见距推送 " + String(delay) + "ms ≤ 1000ms（观测器先于推送启动：" + String(observerStartedAt <= (sentAt ?? Number.MAX_SAFE_INTEGER)) + "）"
    );

    console.log("[panels-check] B3 布局持久化：UI 开关 → settings 落盘 → 重启还原");
    // 改指（MAINT-06）：`[data-panel-toggle=git]`（React 面板开关，vanilla 0 命中）
    // → `#qcGit`（vanilla 抽屉里的 git 快捷卡，即真实的「打开该面板」动作）。
    // 注：快捷卡只在抽屉空态（`#drawerBody[data-empty]`）可见，而 B3 的前提正是「git 面板未打开」。
    await cdp.eval("(() => { document.querySelector('#qcGit')?.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; })()");
    const diskOk = await tryWait(async () => {
      const disk = JSON.parse(await readFile(join(root, "settings.json"), "utf8")) as { layout?: { open?: Record<string, boolean>; activePanel?: string } };
      return disk.layout?.open?.git === true && disk.layout?.activePanel === "git" ? true : null;
    }, 10_000);
    ok(diskOk, "UI 开关 git 面板 → settings.json 落盘 open.git=true + activePanel=git");

    console.log("[panels-check] B3b 主题：设置才是事实源，localStorage 只是首帧缓存");
    // localStorage 落在**真 userData 目录**（只有 settings/会话被 env 改指），所以先把原值存下来、
    // 本轮末尾（B4 之后）原样还回去——验收脚本不该在用户机器上留下自己造的色。
    const themeCacheBefore = await cdp.eval<string | null>("localStorage.getItem('forge-theme')");
    await cdp.eval("(() => { document.querySelector('[data-setting=\"theme\"] button[data-val=\"dark\"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; })()");
    const themeDisk = await tryWait(async () => {
      const disk = JSON.parse(await readFile(join(root, "settings.json"), "utf8")) as { theme?: string };
      return disk.theme === "dark" ? true : null;
    }, 10_000);
    ok(themeDisk, "点「深色」→ settings.json 落盘 theme=dark");
    const paintedNow = await cdp.eval<string>("document.documentElement.dataset.theme || ''");
    ok(paintedNow === "dark", "点完当场就换肤（实测 data-theme=" + JSON.stringify(paintedNow) + "）");
    // 判别性设计：把缓存**故意涂成 light**（与盘上的 dark 相反），下一相重启后屏幕必须跟着
    // settings 走。上一版实现这里会停在 light——因为水合只刷按钮、末尾又拿缓存盖回屏幕。
    await cdp.eval("localStorage.setItem('forge-theme','light'); 'ok'");
    const poisoned = await cdp.eval<string | null>("localStorage.getItem('forge-theme')");
    ok(poisoned === "light", "缓存已涂成与盘上相反的值，投毒成立（实测缓存=" + JSON.stringify(poisoned) + " 而 settings=dark）");
    // 截图是运行产物：默认不写盘（否则每次跑门禁都把工作树弄脏）。需要刷新交付截图时设 M1E_SCREENSHOT=1。
    if (process.env.M1E_SCREENSHOT) {
      const shot1 = await cdp.send("Page.captureScreenshot", { format: "png" });
      await writeFile(join(process.cwd(), "docs", "m1e-panels.png"), Buffer.from(shot1.data as string, "base64"));
      console.log("  📷 docs/m1e-panels.png");
    }

    // 改指：`#settingsOpen`（index.html:1465 的真实设置入口，app.js:521 已接线）
    await cdp.eval("(() => { document.querySelector('#settingsOpen')?.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; })()");
    await new Promise((r) => setTimeout(r, 700));
    if (process.env.M1E_SCREENSHOT) {
      const shot2 = await cdp.send("Page.captureScreenshot", { format: "png" });
      await writeFile(join(process.cwd(), "docs", "m1e-settings.png"), Buffer.from(shot2.data as string, "base64"));
      console.log("  📷 docs/m1e-settings.png");
    }

    await killElectron(electron);

    console.log("[panels-check] B4 重启还原（新进程）");
    // 记忆面板要跑在**非零**数据上才有分辨力：0==0 谁都能过。全局层指到临时目录，
    // 里面放两个 topic + 一个 MEMORY.md 索引（索引不算条目 ⇒ 顺带验排除规则）。项目层保持真实（多半为空）。
    const memHome = join(root, "mem-home");
    await mkdir(memHome, { recursive: true });
    await writeFile(join(memHome, "MEMORY.md"), "# 索引\n- [中文偏好](中文偏好.md) — 测试用\n", "utf8");
    await writeFile(join(memHome, "中文偏好.md"), "---\ntype: user\nmodified: 2026-09-21T02:00:00.000Z\n---\n用中文交流。\n", "utf8");
    await writeFile(join(memHome, "build-gates.md"), "---\ntype: project\nmodified: 2026-09-20T02:00:00.000Z\n---\n门禁清单即事实源。\n", "utf8");
    // B10 要判「装了插件但一轮都没跑过」时的授权闭环。两类样本：用户级（按作用域恒已信任）与
    // **项目级**（唯一会 pending 的作用域）。项目级要从 `<工作区>/.agent/plugins` 发现，而工作区
    // 一轮没跑时取自 settings.workspace ⇒ 造一个临时工作区 + 把 settings 指过去（settings 是
    // 增量打补丁，不覆盖：B4 的 git/theme 还原判据还靠它）。
    const projWs = join(root, "proj-ws");
    await mkdir(join(projWs, ".agent", "plugins"), { recursive: true });
    await cp(
      join(process.cwd(), "fixtures", "plugins", "project", "pipeline-crew"),
      join(projWs, ".agent", "plugins", "pipeline-crew"),
      { recursive: true },
    );
    const settingsPath = join(root, "settings.json");
    const settingsNow = JSON.parse((await readFile(settingsPath, "utf8").catch(() => "{}")) as string) as Record<string, unknown>;
    settingsNow.workspace = projWs;
    await writeFile(settingsPath, JSON.stringify(settingsNow), "utf8");
    const { proc: electron2, output: output2 } = spawnElectron({
      M1E_SESSIONS_DIR: root,
      M1E_SETTINGS_PATH: settingsPath,
      M2D_MEMORY_HOME: memHome,
      M2E_USER_PLUGINS: join(process.cwd(), "fixtures", "plugins", "user"),
      M2E_LOOSE_SKILLS: join(process.cwd(), "fixtures", "plugins", "loose"),
      M2E_TRUST_FILE: join(root, "plugin-trust.json"),
      M2E_PLUGIN_DATA: join(root, "plugin-data"),
      // B13 要碰 schedule-upsert：数据目录另指临时根，验收窗口既不读也不写用户自己的 automations.json
      M4A_DATA_DIR: join(root, "automations"),
    });
    const up2 = await tryWait(async () => {
      try {
        const r = await fetch(CDP_URL + "/json/version");
        return r.ok ? true : null;
      } catch { return null; }
    }, 25_000);
    if (!up2) {
      ok(false, "B4 重启进程起不来 → 未验证");
      console.log("    诊断（进程输出尾 8 行）：");
      for (const l of output2().trim().split("\n").slice(-8)) console.log("      " + l);
      await killElectron(electron2);
      return;
    }
    const cdp2 = new Cdp();
    await cdp2.connect();
    // 改指（MAINT-06）：`[data-panel-id=git]`（React 面板容器，vanilla 0 命中）
    // → `.side-page[data-view="git"]` 且**非 hidden**（＝重启后 git 面板不仅「开着」而且「处于激活态」，
    //    因为 B3 已把 activePanel 落盘为 "git"）。断言强于「元素存在」。
    const restored = await tryWait(async () => {
      const open = await cdp2.eval<boolean | null>("!!document.querySelector('.side-page[data-view=\"git\"]:not([hidden])')");
      return open ? true : null;
    }, 25_000);
    ok(restored, "重启后 git 面板自动还原打开且激活（settings 持久化生效）");
    // B3b 的判别面。第一版判错了，记在这儿免得下一次再踩：原打算在上一相把缓存涂成 light、
    // 指望重启后读到它——但 killElectron 用的是 SIGKILL，localStorage 是异步落盘的，
    // 投毒值根本没跨进程活下来（实测第二相看到的缓存是 "system"，屏幕自然 dark ⇒ 断言恒真）。
    // 现在把投毒塞进**新文档**：addScriptToEvaluateOnNewDocument 早于页面任何脚本执行，
    // 于是首帧一定看到写着 light 的缓存，而盘上 settings 是 dark ⇒ 只有"以 settings 为准"才画得对。
    await cdp2.send("Page.enable");
    await cdp2.send("Page.addScriptToEvaluateOnNewDocument", {
      source: "try{localStorage.setItem('forge-theme','light')}catch(e){}",
    });
    await cdp2.send("Page.reload");
    let seen = { painted: "", cache: "" };
    const healed = await tryWait(async () => {
      seen = {
        painted: await cdp2.eval<string>("document.documentElement.dataset.theme || ''"),
        cache: String(await cdp2.eval<string | null>("localStorage.getItem('forge-theme')") ?? ""),
      };
      return seen.painted === "dark" && seen.cache === "dark" ? true : null;
    }, 20_000);
    // 等状态不等事件：水合是异步的（getState 回来才刷），所以轮询到"成对成立"为止，
    // 失败时把最后读数打出来，不靠固定 sleep 蒙。
    ok(healed, "B3b 重载后：投毒的缓存=light 而屏幕跟 settings 走 dark，并把缓存覆回 dark（实测 data-theme=" + JSON.stringify(seen.painted) + " 缓存=" + JSON.stringify(seen.cache) + "）");
    const darkPressed = await cdp2.eval<string | null>(
      "document.querySelector('[data-setting=\"theme\"] button[data-val=\"dark\"]')?.getAttribute('aria-pressed') ?? null",
    );
    ok(darkPressed === "true", "设置面板按下的那颗＝屏幕用的那颗（深色 aria-pressed=" + String(darkPressed) + "）");
    await cdp2.eval(
      // 还原的是 B3b 之前存下的**原值**（本轮自己涂的假值拿去还原等于没还原）
      themeCacheBefore === null || themeCacheBefore === undefined
        ? "localStorage.removeItem('forge-theme'); 'ok'"
        : "localStorage.setItem('forge-theme', " + JSON.stringify(themeCacheBefore) + "); 'ok'",
    );

    // B5 会话重命名落到盘上。为什么值得真跑一跳：盘上「标题」就是 jsonl 文件名，
    // 主进程改名返回的是**新 id** ⇒ 这不是一行字符串赋值；而单测只能证到桥接段那个函数，
    // 「省略号 → 懒挂载菜单 → 输入框 → 回车」这条 DOM 链一改就断，且断了没人红（门 0 曾把这条桥记成孤儿）。
    const B5_NEW = "B5重命名落盘";
    const b5 = await cdp2.eval<string>(
      `(async () => {
        const row = document.querySelector('.session[data-id]');
        if (!row) return JSON.stringify({ step: "no-row" });
        const oldId = row.dataset.id;
        const trigger = row.querySelector('.sb-trigger');
        if (!trigger) return JSON.stringify({ step: "no-trigger", oldId });
        trigger.click();
        await new Promise(k => setTimeout(k, 150));
        const btn = document.querySelector('.sb-item.act-rename');
        if (!btn) return JSON.stringify({ step: "no-menu-btn", oldId });
        btn.click();
        const input = row.querySelector('.rename-input');
        if (!input) return JSON.stringify({ step: "no-input", oldId });
        input.value = ${JSON.stringify(B5_NEW)};
        input.dispatchEvent(new KeyboardEvent('keydown', { key: "Enter", bubbles: true }));
        return JSON.stringify({ step: "submitted", oldId });
      })()`,
    );
    const b5r = JSON.parse(String(b5 ?? "{}")) as { step?: string; oldId?: string };
    ok(b5r.step === "submitted" && !!b5r.oldId, "B5 重命名入口在真 DOM 里走得通（省略号→懒挂载菜单→输入→回车），实测 " + String(b5r.step));
    if (b5r.step === "submitted" && b5r.oldId) {
      const onDisk = async (): Promise<string[]> => (await readdir(root)).filter((f) => f.endsWith(".jsonl"));
      const landed = await tryWait(async () => ((await onDisk()).includes(B5_NEW + ".jsonl") ? true : null), 8_000);
      ok(landed, "B5 改名真的落到盘上（文件名即会话 id）");
      const left = await onDisk();
      ok(!left.includes(b5r.oldId + ".jsonl"), "B5 旧文件不残留（一个会话不该裂成两份），实测 " + left.join(","));
    }

    console.log("[panels-check] B6 澄清卡（模型在等人回答，界面必须有能答的地方）");
    // 点靶子会话那一行 = 走真 selectSession/showHistory 重放入口（不造第二条渲染路）
    const opened = await cdp2.eval<boolean>(
      `(() => { const r = document.querySelector('.session[data-id=' + JSON.stringify(${JSON.stringify(clarifyId)}) + ']'); if (!r) return false; r.click(); return true; })()`,
    );
    ok(opened, "B6 靶子会话在侧栏里可点（盘上事件进了列表）");
    const cardSel = '.card[data-clarify-call="m1e-clarify-1"]';
    const cardSeen = await tryWait(
      async () => ((await cdp2.eval<boolean>("!!document.querySelector(" + JSON.stringify(cardSel) + ")")) ? true : null),
      15_000,
    );
    ok(cardSeen, "B6 澄清卡在真窗口里挂起来了（不是通用记录卡上的一行「澄清提问」）");
    const card = await cdp2.eval<{ q: number; radio: number; check: number; acts: boolean; disabled: number; label: string } | null>(
      `(() => {
        const c = document.querySelector(${JSON.stringify(cardSel)});
        if (!c) return null;
        return {
          q: c.querySelectorAll('.plan-steps > li.todo').length,
          radio: c.querySelectorAll('input[type=radio]').length,
          check: c.querySelectorAll('input[type=checkbox]').length,
          acts: !!c.querySelector('.plan-acts'),
          disabled: c.querySelectorAll('input[disabled]').length,
          label: (c.querySelector('.card-head') || {}).textContent || '',
        };
      })()`,
    );
    const c6 = card ?? { q: 0, radio: 0, check: 0, acts: true, disabled: 0, label: "" };
    ok(c6.q === 2, "B6 两问原文都摊开（实测 " + String(c6.q) + " 问）");
    ok(c6.radio === 2 && c6.check === 2, "B6 单选走 radio、multiSelect 走 checkbox（实测 radio " + String(c6.radio) + " / checkbox " + String(c6.check) + "）");
    ok(/澄清提问/.test(c6.label) && /待回答/.test(c6.label), "B6 卡面写清这是在等人回答（实测 " + JSON.stringify(c6.label.trim().slice(0, 24)) + "）");
    // 重放只读不变量（与 plan 卡同口径）：提交按钮摘掉、所有输入 disabled —— 历史会话不该能改判据
    ok(!c6.acts && c6.disabled === 6, "B6 重放是只读的：提交面已摘、4 选项 + 2 补充框全部 disabled（实测 acts=" + String(c6.acts) + " disabled=" + String(c6.disabled) + "）");
    console.log("[panels-check] B7 goal 芯片的 live 投递（设完目标，芯片必须在**不刷新**的情况下自己变）");
    // 这条测的是「主进程真推出来的事件到底有没有进芯片」——只有真窗口给得起这个证据。
    // 覆盖面按负控定：空闲时提交 ⇒ onEvent 走 showHistory 整段重投那一支。删掉 renderEvent 镜像里的
    // syncGoalChip，本门实测**全绿**（负控做过），所以续跑期那一支由 tests/renderer-goal-chip-live.test.ts
    // 锁、并由变异锚点 goal-chip-live-tail-not-synced 反证。别把本门当成两支都过了。
    const b7Goal = "把 tests/ 失败用例修绿";
    await cdp2.eval(
      `(() => {
        const chip = document.querySelector('#goalChipLabel');
        if (!chip) return false;
        window.__b7 = { sent: 0, seen: 0, text: '' };
        const obs = new MutationObserver(() => {
          if (window.__b7.seen === 0 && /目标/.test(chip.textContent || '')) {
            window.__b7.seen = Date.now();
            window.__b7.text = (chip.textContent || '').trim();
          }
        });
        obs.observe(chip, { childList: true, characterData: true, subtree: true });
        document.querySelector('#ctxGoal')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return true;
      })()`,
    );
    const formReady = await tryWait(
      async () => ((await cdp2.eval<boolean>("!!document.querySelector('#goalObjective')")) ? true : null),
      8_000,
    );
    ok(formReady, "B7 点芯片开出的是 goal 面板（表单在，不是只弹一层空壳）");
    const b7Sent = await cdp2.eval<number>(
      `(() => {
        const ta = document.querySelector('#goalObjective');
        if (!ta) return -1;
        ta.value = ${JSON.stringify(b7Goal)};
        const turns = document.querySelector('#goalTurns');
        if (turns) turns.value = '8';
        window.__b7.sent = Date.now();
        document.querySelector('#goalPanel')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        return window.__b7.sent;
      })()`,
    );
    const b7Seen = { sent: 0, seen: 0, text: "" };
    const b7Poll = await tryWait(async () => {
      const st = await cdp2.eval<{ sent: number; seen: number; text: string } | null>("window.__b7 || null");
      if (st === null || st.seen === 0) return null;
      b7Seen.sent = st.sent;
      b7Seen.seen = st.seen;
      b7Seen.text = st.text;
      return true;
    }, 10_000);
    ok(b7Poll && b7Sent > 0, "B7 提交后芯片文本真的变了（live 推送 → 渲染层镜像 → syncGoalChip 这条链有人看见）");
    if (b7Poll && b7Sent > 0) {
      const delay = b7Seen.seen - b7Sent;
      ok(
        delay >= 0 && delay <= 1000,
        "B7 芯片首次变化距提交 " + String(delay) + "ms ≤ 1000ms（观测器先于提交装好：" + String(b7Sent > 0) + "）",
      );
      const label = await cdp2.eval<string>(
        `(() => { const c = document.querySelector('#ctxGoal'); return (c && c.getAttribute('aria-label')) || ''; })()`,
      );
      ok(
        label.includes(b7Goal) && /自动续跑中/.test(label) && /1\/8/.test(b7Seen.text),
        "B7 芯片说的是这条目标本身（实测 label=" + JSON.stringify(label.slice(0, 48)) + " 文本=" + JSON.stringify(b7Seen.text) + "）",
      );
      const onDisk = await tryWait(async () => {
        const raw = await readFile(join(root, clarifyId + ".jsonl"), "utf8");
        return raw.includes('"goal_set"') ? true : null;
      }, 8_000);
      ok(onDisk, "B7 同一条 goal_set 也落到会话 JSONL（live 与 replay 读的是同一份事实源）");
    }
    console.log("[panels-check] B8 压缩芯片：面板开得起、IPC 桥真走得通（**一次真钱都不花**）");
    // 分工：渲染层单测（tests/renderer-compact-chip.test.ts）证的是「按 submit → 传屏幕上这条 id」；
    // 这里补它证不到的两段——preload 真把 compact 挂上了 window.agent，且主进程按 sessionId 走到存在性守卫。
    // 绝不点真会话的「立即压缩」：那要发一次摘要调用（花真钱），且成败取决于宿主有没有 M0_API_KEY。
    // 「面板取自真实用量」必须有条 nonzero 的期望值才算分辨力：靶子会话盘上原本没有 usage，
    // 0 + 0 那种读数换成谁都能过 ⇒ 先往盘上追一条 usage，再走真 selectSession 重开，
    // 期望由本脚本自己逐行算（不读渲染层的变量）。
    const b8File = pathOf(root, clarifyId);
    await createEventLog(b8File).append({ type: "usage", inputTokens: 4211, outputTokens: 733 } as unknown as AgentEvent);
    let b8ExpIn = 0;
    let b8ExpOut = 0;
    for (const line of (await readFile(b8File, "utf8")).split("\n")) {
      if (line.trim() === "") continue;
      try {
        const e = JSON.parse(line) as { type?: string; inputTokens?: number; outputTokens?: number };
        if (e.type === "usage") { b8ExpIn += e.inputTokens ?? 0; b8ExpOut += e.outputTokens ?? 0; }
      } catch { /* 非 JSON 行不参与期望 */ }
    }
    const b8ClickSession = (id: string) =>
      cdp2.eval<boolean>(
        `(() => { const r = document.querySelector('.session[data-id=' + JSON.stringify(${JSON.stringify(id)}) + ']');` +
          ` if (!r) return false; r.click(); return true; })()`,
      );
    ok(await b8ClickSession("验收会话"), "B8 先切到另一条会话（重开才走得到 showHistory 的用量重算）");
    ok(await b8ClickSession(clarifyId), "B8 再切回靶子会话");
    // 等重放真落定再读面板：selectSession 是异步的（读盘 → showHistory），当场点芯片会读到切换前的 0
    const b8Replayed = await tryWait(
      async () =>
        (await cdp2.eval<boolean>(`!!document.querySelector('.card[data-clarify-call="m1e-clarify-1"]')`)) ? true : null,
      15_000,
    );
    ok(b8Replayed, "B8 切回后转录已重放（澄清卡在流里 ⇒ showHistory 已经跑过，用量读的是盘上这份）");
    await cdp2.eval(
      `(() => { const c = document.querySelector('#ctxCompact'); if (!c) return false;` +
        `  c.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; })()`,
    );
    const b8Opened = await tryWait(
      async () =>
        (await cdp2.eval<boolean>(`/立即压缩本会话/.test(document.querySelector('#compactPanelBody')?.innerHTML || '')`))
          ? true
          : null,
      8_000,
    );
    ok(b8Opened, "B8 点芯片开的是压缩面板（提交面在，不是只弹一层空壳）");
    const b8Body = await cdp2.eval<string>(`document.querySelector('#compactPanelBody')?.innerHTML || ''`);
    const b8Nums = /已累计 <b>(\d+) \+ (\d+)<\/b> token/.exec(b8Body);
    ok(
      b8Nums !== null && Number(b8Nums?.[1]) === b8ExpIn && Number(b8Nums?.[2]) === b8ExpOut,
      "B8 面板读数 = 该会话 JSONL 里 usage 之和（期望 " + String(b8ExpIn) + " + " + String(b8ExpOut) +
        "，实测 " + JSON.stringify(b8Nums ? b8Nums[1] + " + " + b8Nums[2] : b8Body.slice(0, 40)) + "）",
    );
    const b8Trip = await cdp2.eval<string>(
      `window.agent.compact("不存在的会话靶子").then((r) => String(r.ok) + ":" + String((r && r.error) || ""))`,
    );
    ok(
      b8Trip === "false:会话不存在，未压缩",
      "B8 renderer → preload → main 走通并按 sessionId 拒（零模型调用；实测回条=" + JSON.stringify(b8Trip) + "）",
    );
    console.log("[panels-check] B9 记忆面板：抽屉里看得见盘上真有的条目（**只读**，一下都不删）");
    // 删那一下由 tests/renderer-memory-panel.test.ts + 三条变异锚点管；这里补只有真窗口给得起的证据：
    // 快速卡片 → openView('memory') → 抽屉页挂载，且每层显示的条数 = 该层目录里的 .md 数
    // （期望由本脚本 readdir 独立算，不读渲染层的变量）。
    await cdp2.eval(`(() => { const c = document.querySelector('#qcMemory'); if (c) c.click(); return String(!!c); })()`);
    const b9Mounted = await tryWait(
      async () => ((await cdp2.eval<boolean>(`!!document.querySelector('.side-page[data-view="memory"]')`)) ? true : null),
      10_000,
    );
    ok(b9Mounted, "B9 点「记忆」快速卡片开得出抽屉页（openView 那一条路走通）");
    // 页面先以「读取中…」挂载，快照是异步的（getState 一个来回）⇒ 等层头出现再读数；
    // 等不到就把首屏文字原样报出来（读到的是「读取失败」还是「未提供快照」一目了然，不静默放行）。
    const b9Ready = await tryWait(
      async () => ((await cdp2.eval<boolean>(`!!document.querySelector('.side-page[data-view="memory"] .mem-path')`)) ? true : null),
      12_000,
    );
    const b9First = await cdp2.eval<string>(
      `(document.querySelector('.side-page[data-view="memory"]')?.textContent || '').trim().slice(0, 72)`,
    );
    ok(
      b9Ready,
      "B9 快照落到屏上（出现层头 + 目录行；实测首屏=" + JSON.stringify(b9First) + "）",
    );
    const b9 = await cdp2.eval<{ layers: { label: string; dir: string }[]; rows: number; names: string[] }>(
      `(() => {
        const p = document.querySelector('.side-page[data-view="memory"]');
        const layers = [];
        if (p) for (const sec of p.querySelectorAll('.sched-sec')) {
          const nxt = sec.nextElementSibling;
          if (nxt && nxt.classList.contains('mem-path')) layers.push({ label: (sec.textContent || '').trim(), dir: (nxt.textContent || '').trim() });
        }
        return {
          layers,
          rows: p ? p.querySelectorAll('.mem-topic').length : -1,
          names: p ? [...p.querySelectorAll('.mem-topic')].map((r) => r.getAttribute('data-topic') || '') : [],
        };
      })()`,
    );
    let b9Shown = 0;
    const b9Parts: string[] = [];
    let b9AllMatch = b9.layers.length > 0;
    for (const l of b9.layers) {
      const shown = Number(/（(\d+)）/.exec(l.label)?.[1] ?? -1);
      let onDisk = 0;
      try { onDisk = (await readdir(l.dir)).filter((f) => f.endsWith(".md") && f !== "MEMORY.md").length; } catch { onDisk = 0; }
      b9Shown += shown;
      b9Parts.push(l.label + " 盘上=" + String(onDisk));
      if (shown !== onDisk) b9AllMatch = false;
    }
    ok(b9AllMatch, "B9 每层条数 = 该层目录里的 .md 文件数（实测 " + JSON.stringify(b9Parts) + "）");
    ok(
      b9.rows === b9Shown,
      "B9 渲染出的行数 = 两层计数之和（不少渲染也不多渲染一遍；实测 rows=" + String(b9.rows) + " 期望 " + String(b9Shown) + "）",
    );
    ok(
      b9Shown > 0 && b9.names.includes("中文偏好") && b9.names.includes("build-gates") && !b9.names.includes("MEMORY"),
      "B9 全局层两个 topic 上了屏、MEMORY.md 只当索引不算条目（实测 names=" + JSON.stringify(b9.names) + " 计数 " + String(b9Shown) + "）",
    );
    const b10Sel = ".side-page[data-view=\"plugins\"] [data-plugin=\"hello-plugin\"]";    console.log("[panels-check] B10 插件授权闭环：一轮都没跑过也列得出「待决」，点信任后当场改口并落盘");
    // 判的是此前根本不存在的产品路径：§9.8「未信任不激活」，而 state 里的插件快照原先只有跑过
    // 一轮才有 ⇒ 用户永远看不到「待决」，也就永远没机会授权（先有鸡还是有蛋）。
    await cdp2.eval(
      `(() => { const c = document.querySelector('#qcPlugins'); if (c) c.click(); return String(!!c); })()`,
    );
    const b10Listed = await tryWait(
      async () => ((await cdp2.eval<boolean>(`!!document.querySelector(${JSON.stringify(b10Sel)})`)) ? true : null),
      12_000,
    );
    const b10First = await cdp2.eval<string>(
      `(document.querySelector('.side-page[data-view="plugins"]')?.textContent || '').trim().slice(0, 76)`,
    );
    ok(b10Listed, "B10 没跑过任何一轮也列出了靶子插件（冷快照走通；实测首屏=" + JSON.stringify(b10First) + "）");
    // 用户级样本按作用域直接算已信任，「待决」的样本是散装 skill：不写死名字（名字取自 frontmatter），
    // 而是找第一行待决的样本点它的「信任」——判的是「有待决就有可点的授权口」。
    const b10Name = await cdp2.eval<string>(
      `(() => {
        const rows = [...document.querySelectorAll('.side-page[data-view="plugins"] .plug-row')];
        const r = rows.find((x) => (x.textContent || '').includes('待决'));
        if (!r) return '';
        const b = r.querySelector('[data-plug-act="trust"]');
        if (!b) return '';
        b.click();
        return r.getAttribute('data-plugin') || '';
      })()`,
    );
    ok(b10Name !== "", "B10 有待决样本、其「信任」按钮在行里且点得动（实测样本=" + JSON.stringify(b10Name) + "）");
    const b10RowSel = ".side-page[data-view=\"plugins\"] [data-plugin=\"" + b10Name + "\"]";
    const b10Trusted = await tryWait(
      async () => ((await cdp2.eval<boolean>(
        `(document.querySelector(${JSON.stringify(b10RowSel)})?.textContent || '').includes('已信任')`,
      )) ? true : null),
      12_000,
    );
    ok(b10Trusted, "B10 点完当场改口为「已信任」（回读快照重画，不是本地改一行状态）");
    const b10File = await readFile(join(root, "plugin-trust.json"), "utf8").catch(() => "");
    ok(
      b10Name !== "" && b10File.includes(b10Name),
      "B10 决议真落盘（重启后仍生效；实测文件前 76 字=" + JSON.stringify(b10File.slice(0, 76)) + "）",
    );
    console.log("[panels-check] B11 子智能体页：盘上的 worker 事件流在真窗口里长成一列一列（各列各自的账，不并成一条）");
    // 分工：tests/renderer-agents-view.test.ts 判的是「给定列 → HTML 对不对」（含「等人审批」那一词，
    // 并由变异锚点 agents-view-waiting-said-as-running 反证）；这里判的是那条单测根本碰不到的接缝——
    // JSONL → session:open（含 §4.4.9 崩溃恢复补发）→ 重放 → panelData.agents → 抽屉页。
    // projectAgentPanel 曾被 agents.test 判绿多年而产品里一屏看不见（幽灵投影），所以这条接线必须由真窗口作证。
    // ⚠️ 本相只走「重放后」这一支：停在非终态的靶子会被产品的崩溃恢复扫成 failed(interrupted)，
    //    所以「等人审批」在真窗口里不出现（那需要活着的编排器 = 花真钱的一轮 run）。不假装两支都过。
    // 路径一律带 b11-child-only / b11-parent-only 前缀：toolArgsSummary 把 read_file 的 path 原样上屏，
    // 于是「这条文字在不在主转录里」成为一个可判读的归因读数（B11c/B11d 就是读它）。
    const b11A = "b11-read-1";
    const b11B = "b11-write-2";
    const b11File = pathOf(root, clarifyId);
    const b11T0 = Date.now() - 60_000;
    const b11ChildA = "src/b11-child-only-a.ts";
    const b11ChildB = "src/b11-child-only-b.ts";
    const b11Parent = "src/b11-parent-only.ts";
    const b11Evts: Record<string, unknown>[] = [
      // 父自己的一条工具调用：准入判据不许顺手把主流掐了（B11c 的正控）
      { type: "tool_call", id: "b11-p-t1", name: "read_file", args: { path: b11Parent } },
      { type: "agent_spawned", agent_id: b11A, parent_event_id: 1, mode: "read", task: "B11 只读调研", max_turns: 6, permission_mode: "default", ts: b11T0 },
      { type: "tool_call", id: "b11-a-t1", name: "read_file", args: { path: b11ChildA }, agent_id: b11A },
      { type: "tool_call", id: "b11-a-t2", name: "read_file", args: { path: b11ChildB }, agent_id: b11A },
      { type: "usage", id: "b11-a-u", agent_id: b11A, inputTokens: 1200, outputTokens: 300 },
      { type: "agent_status", agent_id: b11A, status: "done", ts: b11T0 + 4_200 },
      { type: "agent_spawned", agent_id: b11B, parent_event_id: 2, mode: "write", task: "B11 改排序", max_turns: 6, permission_mode: "default", ts: b11T0 + 1_000 },
      { type: "tool_call", id: "b11-b-t1", name: "edit_file", args: { path: b11ChildA }, agent_id: b11B },
      { type: "approval_requested", id: "b11-b-ap", agent_id: b11B, tool: "run_shell", args_digest: "pnpm test", risk: "high" },
    ];
    for (const e of b11Evts) await createEventLog(b11File).append(e as unknown as AgentEvent);
    // 重开这条会话才会重算 panelData（盘上追加不推事件，切换是唯一走 showHistory 的入口）；
    // 而 session:open 正是崩溃恢复的入口——期望要在它跑完之后再从盘上算，不能拿追加那一刻的快照。
    ok(await b8ClickSession("验收会话"), "B11 先切走（离开靶子会话）");
    ok(await b8ClickSession(clarifyId), "B11 再切回靶子会话");
    await cdp2.eval(`(() => { const c = document.querySelector('#qcAgents'); if (c) c.click(); return String(!!c); })()`);
    const b11Wait = await tryWait(
      async () =>
        ((await cdp2.eval<number>(
          `document.querySelectorAll('.side-page[data-view="agents"] .agent-row').length`,
        )) >= 2 ? true : null),
      15_000,
    );
    const b11First = await cdp2.eval<string>(
      `(document.querySelector('.side-page[data-view="agents"]')?.textContent || '').trim().slice(0, 76)`,
    );
    ok(b11Wait, "B11 抽屉页里列出了 worker 行（JSONL→重放→panelData.agents→HTML 整条接缝；实测首屏=" + JSON.stringify(b11First) + "）");
    // 期望独立从盘上重算（不读渲染层任何一个变量）：每 worker 的工具计数 / token 合计 / 末态 / 待批 / 终态报告
    interface B11Exp { tools: Record<string, number>; tok: number; status: string; pending: string; task: string; mode: string; report: string }
    const b11Exp = new Map<string, B11Exp>();
    let b11ParentToolCalls = 0; // 盘上**不带归因**的 tool_call 数 = 主转录里该有的工具条数
    for (const line of (await readFile(b11File, "utf8")).split("\n")) {
      if (line.trim() === "") continue;
      let e: Record<string, unknown>;
      try { e = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
      const t = String(e["type"] ?? "");
      if (t === "tool_call" && e["agent_id"] === undefined) b11ParentToolCalls += 1;
      if (t === "agent_spawned") {
        b11Exp.set(String(e["agent_id"]), {
          tools: {}, tok: 0, status: "running", pending: "", report: "",
          task: String(e["task"]), mode: String(e["mode"]),
        });
        continue;
      }
      const a = e["agent_id"] === undefined ? undefined : b11Exp.get(String(e["agent_id"]));
      if (!a) continue;
      if (t === "tool_call") a.tools[String(e["name"])] = (a.tools[String(e["name"])] ?? 0) + 1;
      else if (t === "usage") a.tok += Number(e["inputTokens"] ?? 0) + Number(e["outputTokens"] ?? 0);
      else if (t === "agent_status") a.status = String(e["status"]);
      // §10.2 的语义：审批请求把这一列变成「在等人」，批了才回到在跑（不是等人也算 running）
      else if (t === "approval_requested") { a.pending = String(e["tool"]); if (a.status === "running") a.status = "waiting_approval"; }
      else if (t === "approval_resolved") { a.pending = ""; a.status = "running"; }
      else if (t === "agent_result" && typeof e["summary"] === "string" && e["summary"] !== "") a.report = String(e["summary"]);
    }
    ok(b11Exp.size === 2, "B11 靶子会话盘上有两个 worker（期望由本脚本逐行重算；实测 " + String(b11Exp.size) + "）");
    const b11Rows = await cdp2.eval<{ id: string; text: string }[]>(
      `(() => [...document.querySelectorAll('.side-page[data-view="agents"] .agent-row')].map((r) => ({` +
        ` id: r.getAttribute('data-agent') || '', text: (r.textContent || '').replace(/\\s+/g, ' ').trim() })))()`,
    );
    ok(
      b11Rows.length === b11Exp.size,
      "B11 行数 = 盘上 spawn 出的 worker 数（不少列也不多列；实测 rows=" + String(b11Rows.length) + " 期望 " + String(b11Exp.size) + "）",
    );
    const B11_STATUS: Record<string, string> = {
      done: "已完成", failed: "失败", cancelled: "已取消", running: "运行中",
      waiting_approval: "等人审批", waiting_input: "等人回答",
    };
    for (const [id, exp] of [...b11Exp.entries()]) {
      const row = b11Rows.find((r) => r.id === id);
      ok(row !== undefined, "B11 " + id + " 上了屏（按 agent_id 归位，没有并成一条）");
      if (!row) continue;
      const label = B11_STATUS[exp.status] ?? exp.status;
      ok(
        row.text.includes(exp.task) && row.text.includes("（" + label + " · " + exp.mode + "）"),
        "B11 " + id + " 说的是这条任务与盘上那个终态（实测 " + JSON.stringify(row.text.slice(0, 88)) + " 期望态 " + label + "）",
      );
      const toolText = Object.entries(exp.tools).map(([k, n]) => k + "×" + String(n)).join(" · ");
      ok(
        row.text.includes(String(exp.tok) + " tok") && row.text.includes(toolText),
        "B11 " + id + " 的 token 与工具计数只算归因到它自己的那笔（实测 " + JSON.stringify(row.text.slice(0, 88)) + " 期望 " + String(exp.tok) + " tok / " + toolText + "）",
      );
      if (exp.pending !== "") {
        ok(row.text.includes("待批：" + exp.pending), "B11 " + id + " 把卡在哪个工具上摊开（实测 " + JSON.stringify(row.text.slice(0, 88)) + "）");
      }
      if (exp.report !== "") {
        ok(
          row.text.includes(exp.report.slice(0, 24)),
          "B11 " + id + " 的终态报告原文上屏（崩溃恢复为何判它失败，用户读得到；实测 " + JSON.stringify(row.text.slice(60, 150)) + "）",
        );
      }
    }
    // 归因不串账：A 的 1500 不许出现在 B 那一行（写死常数最容易被总量替代）
    const b11RowA = b11Rows.find((r) => r.id === b11A)?.text ?? "";
    const b11RowB = b11Rows.find((r) => r.id === b11B)?.text ?? "";
    ok(
      b11RowA.includes("1500 tok") && !b11RowB.includes("1500"),
      "B11 两列各记各的账（" + b11A + "=1500 未渗进 " + b11B + "；实测 B 行 " + JSON.stringify(b11RowB.slice(0, 60)) + "）",
    );
    const b11Waiting = [...b11Exp.values()].filter((a) => a.status === "waiting_approval" || a.status === "waiting_input").length;
    const b11Chips = await cdp2.eval<string>(
      `(() => [...document.querySelectorAll('.side-page[data-view="agents"] .sched-chip')].map((c) => (c.textContent || '').trim()).join('|'))()`,
    );
    ok(
      b11Chips.includes("worker 2") && (b11Waiting > 0 ? b11Chips.includes("等人 " + String(b11Waiting)) : !/等人 \d/.test(b11Chips)),
      "B11 顶部芯片按盘上事实数「共几条活」与「几条在等人」（期望等人 " + String(b11Waiting) + "；实测 " + JSON.stringify(b11Chips) + "）",
    );
    console.log("[panels-check] B11 子流准入：worker 的工具调用不在父的转录里（§4.4.4 的界面那一半，真窗口）");
    // 上面每一断言读的都是右栏；这一组读**主转录**——旧实现里带归因的 tool_call 一路走到
    // renderEvent/projectUnits，两支都没看 agent_id，于是子模型的动作挂在父的工具组里。
    // 正控先读（父的那条在不在）：虚拟化把窗口整块挪走时，它会先红，而不是让负控空过。
    const b11StreamText = await cdp2.eval<string>(`(document.querySelector('.stream')?.textContent || '')`);
    ok(
      b11StreamText.includes(b11Parent),
      "B11c 父自己的工具调用在主流（准入判据没顺手把主流掐了；实测转录 " + String(b11StreamText.length) + " 字，期望含 " + b11Parent + "）",
    );
    ok(
      !b11StreamText.includes(b11ChildA) && !b11StreamText.includes(b11ChildB),
      "B11d worker 的工具调用不在主流（它是子会话的账，右栏按 read_file×2 记；实测含 a=" +
        String(b11StreamText.includes(b11ChildA)) + " 含 b=" + String(b11StreamText.includes(b11ChildB)) + "）",
    );
    const b11Items = await cdp2.eval<number>(`document.querySelectorAll('.stream .tool-item').length`);
    ok(
      b11Items === b11ParentToolCalls,
      "B11e 主流工具条数 = 盘上不带归因的 tool_call 数（条数对得上才算「没画」而不是「画了别的」；实测 " +
        String(b11Items) + " 期望 " + String(b11ParentToolCalls) + "）",
    );
    // B11d 只证了「不在主流」；另一半是「在它在的地方」——否则这就是摘信息而不是搬信息。
    // 且必须**两个都在**：A 读过两本（child-a / child-b），写 `||` 等于「少一本也算过」，
    // 而摘走之后静默少一本恰是这类有界列表最自然的失效形态（判卷面不许析取，见 assertion-health-scan）。
    ok(
      b11RowA.includes(b11ChildA) && b11RowA.includes(b11ChildB),
      "B11f worker 读过的两本文件在右栏那一行都读得到（准入是搬走不是删掉；实测 A 行 " + JSON.stringify(b11RowA.slice(0, 200)) + "）",
    );
    console.log("[panels-check] B12 worker 审批两端：已死那一列不长卡，而 card_action 桥在真窗口走得通（零模型调用）");
    // B11 留下的 b11-write-2 已被崩溃恢复扫成 failed，但它的 approval 从未被答过（行上仍写「待批」）。
    // 这正是负控靶子：给死列弹审批卡 = 摆一个必然失败的按钮。删掉 workerApprovalAsks 的终态守卫，
    // B12 首条当场红（做过反向对照）；「活着才弹」的正向半边由单测 + 锚点锁（真弹一次要跑真 worker = 花真钱）。
    const b12CardOpen = await cdp2.eval<string>(`String(!!document.querySelector('#askPop:not([hidden])'))`);
    ok(
      b12CardOpen === "false",
      "B12 死列不弹审批卡（读法与 B2 同一条 #askPop:not([hidden])：屏上没有展开中的批准卡。" +
        "去掉 workerApprovalAsks 的终态守卫就会长出一张 ⇒ 这条可伪，不是「节点没建所以恒绿」；实测=" + b12CardOpen + "）",
    );
    const b12RowStill = await cdp2.eval<boolean>(
      `([...document.querySelectorAll('.side-page[data-view="agents"] .agent-row')].some((r) => (r.textContent || '').includes('待批：run_shell')))`,
    );
    ok(b12RowStill, "B12 不弹卡 ≠ 抹掉事实：那条未答审批仍如实显示在子智能体页那一行");
    // 恢复卡文案亲口写着「可在恢复卡重派」——那一列上真得有个按钮，否则那句话是空头承诺。
    // 只查按钮在不在，**一次都不点**：重派 = 真派一个 worker = 花真钱。
    const b12Acts = await cdp2.eval<string>(
      `(() => { const r = document.querySelector('.side-page[data-view="agents"] [data-agent="b11-write-2"]');` +
        ` return r ? [...r.querySelectorAll('[data-agent-act]')].map((b) => b.getAttribute('data-agent-act')).join(',') : 'no-row'; })()`,
    );
    ok(b12Acts === "respawn", "B12 被崩溃恢复扫死的那一列给「重派」而不给「取消」（实测按钮=" + JSON.stringify(b12Acts) + "）");
    const b12ActsDone = await cdp2.eval<string>(
      `(() => { const r = document.querySelector('.side-page[data-view="agents"] [data-agent="b11-read-1"]');` +
        ` return r ? String(r.querySelectorAll('[data-agent-act]').length) : 'no-row'; })()`,
    );
    ok(b12ActsDone === "0", "B12 正常跑完的那一列一个按钮都不给（实测 " + JSON.stringify(b12ActsDone) + "）");
    // 桥面：渲染层 → preload → main 的 card_action 真走得通，且 fail-closed 时一个字节都不落
    const b12Before = (await readFile(b11File, "utf8")).length;
    const b12Trip = await cdp2.eval<string>(
      `(window.agent && window.agent.cardAction) ? window.agent.cardAction({` +
        ` cardId: 'approval:b12-nope', sourceEventId: 1, cardType: 'approval', action: 'approve',` +
        ` payload: { approval_id: 'b12-nope' }, scope: 'once', targetAgentId: 'b12-no-agent'` +
        `}).then((r) => String(r.ok) + ':' + (r.error || '')) : 'no-bridge'`,
    );
    ok(b12Trip !== "no-bridge", "B12 preload 真把 cardAction 挂上了 window.agent（gate 0 的 A3 只查拼写，这里查挂没挂）");
    ok(
      b12Trip.startsWith("false:") && b12Trip.includes("fail-closed"),
      "B12 没跑过一轮时 card_action 当场拒（不静默半提交；实测回条=" + JSON.stringify(b12Trip) + "）",
    );
    const b12After = (await readFile(b11File, "utf8")).length;
    ok(b12After === b12Before, "B12 拒绝不落半条事件（审计面零新增；实测 " + String(b12Before) + " → " + String(b12After) + " 字节）");

    console.log("[panels-check] B13 新建定时任务：表单开得出、送得进主进程、被拒原样点名（一次都不真建 = 零钱）");
    // 只走**拒绝路径**：真建一条 = 调度器到点真会开真会话 = 真花模型钱。所以这里递一份必然越界的
    // 提示词（>4k），判的是「渲染层 → preload → main 的 validateAutomation 那条路真通、拒因真回显」，
    // 而不是主进程的校验规则本身（那由 tests/schedule.test.ts 与上面的单测锁）。
    const b13File = join(root, "automations", "automations.json");
    const b13Before = await readFile(b13File, "utf8").catch(() => "");
    const b13Chip = await cdp2.eval<string>(
      `(() => { const b = document.getElementById('ctxSched'); return b ? (b.disabled ? 'disabled' : 'live') : 'absent'; })()`,
    );
    ok(b13Chip === "live", "B13 「定时任务」芯片在 composer 上且没被禁用（实测=" + JSON.stringify(b13Chip) + "）");
    await cdp2.eval(`document.getElementById('ctxSched').click()`);
    const b13Form = await cdp2.eval<string>(
      `(() => {
        const f = document.querySelector('#schedPanelBody .sched-form');
        if (!f) return 'no-form';
        const vals = (id) => [...f.querySelectorAll('#' + id + ' option')].map((o) => o.getAttribute('value')).join(',');
        return f.getAttribute('data-kind') + '|kinds=' + vals('schedKind') + '|tiers=' + vals('schedTier');
      })()`,
    );
    ok(
      b13Form === "once|kinds=once,interval,daily,weekly|tiers=read-only,workspace-write,danger-full-access",
      "B13 打开即见表单：种类只有 main 白名单那四种、缺省是最便宜的 once、档位从只读起（实测=" + JSON.stringify(b13Form) + "）",
    );
    await cdp2.eval(
      `(() => { const s = document.getElementById('schedKind'); s.value = 'daily'; s.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()`,
    );
    const b13Kind = await cdp2.eval<string>(
      `(() => { const f = document.querySelector('#schedPanelBody .sched-form'); return f ? String(f.getAttribute('data-kind')) : 'gone'; })()`,
    );
    ok(b13Kind === "daily", "B13 换种类就换露哪一项（切换不重渲染，已填的值才留得住；实测 data-kind=" + JSON.stringify(b13Kind) + "）");
    await cdp2.eval(
      `(() => {
        document.getElementById('schedName').value = 'B13 验收任务';
        document.getElementById('schedTime').value = '07:30';
        document.getElementById('schedPrompt').value = 'x'.repeat(5001);
        document.querySelector('#schedPanelBody form').requestSubmit();
        return 1;
      })()`,
    );
    const b13Shown = await tryWait(
      async () => (await cdp2.eval<string>(
        `(() => { const p = document.getElementById('schedErr'); return p && !p.hidden ? (p.textContent || '') : ''; })()`,
      )) || null,
      8_000,
    );
    const b13Err = await cdp2.eval<string>(
      `(() => { const p = document.getElementById('schedErr'); return p ? (p.textContent || '') : 'no-node'; })()`,
    );
    ok(b13Shown, "B13 提交真走到了主进程并被拒（回条回显在表单里；实测=" + JSON.stringify(b13Err.slice(0, 90)) + "）");
    ok(
      b13Err.includes("4000 字符上限"),
      "B13 拒因原样上屏，不是「保存失败」这类含糊话（实测=" + JSON.stringify(b13Err.slice(0, 90)) + "）",
    );
    const b13Toast = await cdp2.eval<string>(
      `(() => { const t = document.getElementById('toast'); return t ? (t.textContent || '') : ''; })()`,
    );
    ok(
      b13Toast.includes("未创建") && !b13Toast.includes("已创建"),
      "B13 被拒不报成功（实测 toast=" + JSON.stringify(b13Toast) + "）",
    );
    // 第二刀：§12.2.6 要求表单带时区，而 IANA 规范化只在 main —— 非法值必须从表单这条路拒回来
    await cdp2.eval(
      `(() => {
        document.getElementById('schedPrompt').value = '验收用的一句话';
        document.getElementById('schedTimeZone').value = 'Mars/Olympus';
        document.querySelector('#schedPanelBody form').requestSubmit();
        return 1;
      })()`,
    );
    const b13TzShown = await tryWait(
      async () => (await cdp2.eval<string>(
        `(() => { const p = document.getElementById('schedErr'); const t = p && !p.hidden ? (p.textContent || '') : ''; return t.includes('timeZone') ? t : ''; })()`,
      )) || null,
      8_000,
    );
    const b13TzErr = await cdp2.eval<string>(
      `(() => { const p = document.getElementById('schedErr'); return p ? (p.textContent || '') : 'no-node'; })()`,
    );
    ok(
      b13TzShown && b13TzErr.includes("timeZone 非法"),
      "B13 非法 IANA 时区由 main 拒并原样回显（渲染层不自己判，也没静默收下；实测=" + JSON.stringify(b13TzErr.slice(0, 90)) + "）",
    );
    const b13After = await readFile(b13File, "utf8").catch(() => "");
    let b13Tasks = 0;
    try {
      b13Tasks = b13After === "" ? 0 : ((JSON.parse(b13After) as { tasks?: unknown[] }).tasks ?? []).length;
    } catch { b13Tasks = -1; }
    ok(
      b13After === b13Before && b13Tasks === 0,
      "B13 盘上没有新建的任务（= 不会被触发 = 零钱；实测字节 " + String(b13Before.length) + " → " + String(b13After.length) + "，任务数 " + String(b13Tasks) + "）",
    );

    console.log("[panels-check] B14 运行历史的状态筛选：筛选器在真窗口里长得出，值真走一个 IPC 来回（全程只读快照 = 零钱）");
    await cdp2.eval(`(() => { const c = document.querySelector('#qcSchedule'); if (c) c.click(); return String(!!c); })()`);
    let b14Sel = "";
    try {
      b14Sel = await waitFor<string>(
        async () => (await cdp2.eval<string>(
          `(() => { const s = document.querySelector('.side-page[data-view="schedule"] #schedHistFilter');` +
            ` return s ? [...s.options].map((o) => o.value).join(',') + '|sel=' + s.value : null; })()`,
        )) ?? null,
        12_000,
      );
    } catch { b14Sel = "waitFor 超时：段头一直没长出筛选下拉"; }
    ok(
      b14Sel === "all,queued,running,succeeded,failed,skipped,cancelled|sel=all",
      "B14 下拉恰是七项（六态 + 全部）、缺省「全部」，且段头文字给人读不印裸 token（实测=" + JSON.stringify(b14Sel) + "）",
    );
    await cdp2.eval(
      `(() => { const s = document.querySelector('.side-page[data-view="schedule"] #schedHistFilter');` +
        ` s.value = 'failed'; s.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()`,
    );
    const b14On = await tryWait(
      async () => ((await cdp2.eval<boolean>(
        `(() => { const p = document.querySelector('.side-page[data-view="schedule"]'); return !!p && (p.textContent || '').includes('只看 失败'); })()`,
      )) ? true : null),
      10_000,
    );
    const b14Text = await cdp2.eval<string>(
      `(() => { const p = document.querySelector('.side-page[data-view="schedule"]'); return p ? (p.textContent || '').replace(/\\s+/g, ' ').slice(0, 130) : 'no-page'; })()`,
    );
    ok(
      b14On,
      "B14 换筛选真的重要了一次快照并由 main 筛完回画（段头点名「只看 失败」；实测=" + JSON.stringify(b14Text) + "）",
    );
    ok(
      !b14Text.includes("暂无运行历史"),
      "B14 筛着的时候不说「暂无运行历史」——那会让用户以为任务从没跑过（假空；实测=" + JSON.stringify(b14Text) + "）",
    );
    // B15 评审闭环的读端：git 面板逐列给补丁、安全发现与行级评论。全程只往会话 JSONL 追加
    // 既有事件类型 + 重开读取，不调模型、不派 worker、不动 git（零钱，与 B11 同一手法）。
    console.log("[panels-check] B15 git 面板的评审读端：补丁取最新一份、发现与评论上屏（零模型调用）");
    const b15Rows: Record<string, unknown>[] = [
      // 带真文件头的补丁：行锚点形态（评按钮）只在 path + 新行号齐时长出，光秃秃的 + 行不该有入口
      { type: "tool_result", callId: "diff-" + b11B, ok: true, output: "## stat\n src/sort.ts | 2 +-\n## patch\ndiff --git a/src/sort.ts b/src/sort.ts\n--- a/src/sort.ts\n+++ b/src/sort.ts\n@@ -1 +1 @@\n+const old = 1" },
      { type: "tool_result", callId: "diff-" + b11B, ok: true, output: "## stat\n src/sort.ts | 3 +-\n## patch\ndiff --git a/src/sort.ts b/src/sort.ts\n--- a/src/sort.ts\n+++ b/src/sort.ts\n@@ -1 +1 @@\n+const newer = 2" },
      { type: "security_report", agent_id: b11B, mode: "standard", llm_reviewed: false,
        findings: [{ severity: "high", path: "src/sort.ts", line: 12, title: "拼接 SQL", description: "d", ruleId: "r1" }],
        summary: { total: 1, bySeverity: { critical: 0, high: 1 } } },
      { type: "diff_comment", agent_id: b11B, path: "src/sort.ts", line: 12, body: "改用参数绑定", ts: Date.now() },
    ];
    for (const e of b15Rows) await createEventLog(b11File).append(e as unknown as AgentEvent);
    ok(await b8ClickSession("验收会话"), "B15 先切走（重开才走 showHistory → panelData 这条路）");
    ok(await b8ClickSession(clarifyId), "B15 再切回靶子会话");
    await cdp2.eval(`(() => { const c = document.querySelector('#qcGit'); if (c) c.click(); return String(!!c); })()`);
    const b15Shown = await tryWait(
      async () => ((await cdp2.eval<string>(
        `(() => { const p = document.querySelector('.side-page[data-view="git"]'); const t = p ? (p.textContent || '') : ''; return t.includes('改用参数绑定') ? t : ''; })()`,
      )) || null),
      12_000,
    );
    const b15Text = await cdp2.eval<string>(
      `(() => { const p = document.querySelector('.side-page[data-view="git"]'); return p ? (p.textContent || '').replace(/\\s+/g, ' ') : 'no-page'; })()`,
    );
    ok(b15Shown, "B15 评审面真上了屏（补丁 / 发现 / 评论都由事件流投影；实测=" + JSON.stringify(b15Text.slice(0, 150)) + "）");
    ok(
      b15Text.includes("补丁 v2") && b15Text.includes("const newer = 2") && !b15Text.includes("const old = 1"),
      "B15 取的是最新那份补丁（v1→v2 里 v1 已被推翻，给旧版 = 让用户审错的代码；实测=" + JSON.stringify(b15Text.slice(0, 150)) + "）",
    );
    ok(
      b15Text.includes("安全报告 1 项") && b15Text.includes("src/sort.ts:12") && b15Text.includes("仅规则扫描"),
      "B15 安全发现带 path:line 且说清有没有模型复核（实测=" + JSON.stringify(b15Text.slice(0, 150)) + "）",
    );
    ok(
      !b15Text.includes("NaN"),
      "B15 屏面上没有 NaN（拼接式里夹一行注释会被读成一元正号 ⇒ 整段 HTML 变 NaN；本轮单测抓到过一次）",
    );
    // B16 评审闭环的写端：行锚点真长得出、点得动，且被 main 拒时如实说未送达。
    // 全程零钱：这一列是重放出来的历史 worker（本窗口没有它的编排器），card_action 必然在
    // 归属检查处被拒 ⇒ 不调模型、不落 diff_comment、不动工作树。
    // 反向对照（做过）：删掉委托里的 [data-cmt] 分支 ⇒ ①②当场红；把 ok=false 说成送达 ⇒ ③当场红。
    console.log("[panels-check] B16 行级评审写端：「评」点得动，被 main 拒时不谎报送达（零模型调用）");
    const b16Rows = await cdp2.eval<string>(
      `(() => {
        const rows = [...document.querySelectorAll('.side-page[data-view="git"] .ln-row[data-line]')];
        return JSON.stringify({ n: rows.length, bad: rows.filter(r => !r.querySelector('[data-cmt]') || !r.dataset.path || !(Number(r.dataset.line) >= 1)).length });
      })()`,
    );
    const b16Shape = JSON.parse(b16Rows) as { n: number; bad: number };
    ok(b16Shape.n >= 1, "B16 有行号的补丁行真长出了评论入口（实测行数 " + String(b16Shape.n) + "）");
    ok(b16Shape.bad === 0, "B16 每个入口都带 path 与 ≥1 的行号：挂错坐标的评论比不给入口更坏（实测缺项 " + String(b16Shape.bad) + "）");
    const b16Open = await cdp2.eval<string>(
      `(() => {
        const b = document.querySelector('.side-page[data-view="git"] .ln-row[data-line] [data-cmt]');
        if (!b) return 'no-btn';
        b.click();
        const p = document.getElementById('cmtPop');
        return JSON.stringify({
          hidden: p ? p.hidden : 'absent',
          head: p ? (document.getElementById('cmtHead').textContent || '') : '',
          aria: b.getAttribute('aria-expanded'),
        });
      })()`,
    );
    ok(b16Open !== "no-btn", "B16 点「评」前有按钮可点（实测 " + JSON.stringify(b16Open) + "）");
    const b16Pop = JSON.parse(b16Open) as { hidden: boolean; head: string; aria: string | null };
    ok(b16Pop.hidden === false, "B16 点「评」真弹出了评审框（实测 hidden=" + JSON.stringify(b16Pop.hidden) + "）");
    ok(
      b16Pop.head.includes("src/sort.ts") && b16Pop.head.includes(b11B) && b16Pop.head.includes("第 1 行"),
      "B16 框头点名评的是哪个文件哪一行、送给哪个 worker（实测 " + JSON.stringify(b16Pop.head) + "）",
    );
    ok(b16Pop.aria === "true", "B16 aria-expanded 跟着真翻了（实测 " + JSON.stringify(b16Pop.aria) + "）");
    const b16CmtsBefore = await cdp2.eval<number>(
      `(() => document.querySelectorAll('.side-page[data-view="git"] .mc-comments .cm').length)()`,
    );
    const b16ToastBefore = await cdp2.eval<string>(
      `(() => { const t = document.getElementById('toast'); return t ? (t.textContent || '') : ''; })()`,
    );
    const b16Sent = await cdp2.eval<string>(
      `(() => {
        const f = document.querySelector('#cmtPop form');
        const box = document.getElementById('cmtBody');
        box.value = 'B16 验收意见：别在这里吞异常';
        if (f.requestSubmit) f.requestSubmit(); else f.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        return 'submitted';
      })()`,
    );
    ok(b16Sent === "submitted", "B16 提交动作真发出去了（实测 " + JSON.stringify(b16Sent) + "）");
    const b16Err = await waitFor(
      async () => {
        const t = await cdp2.eval<string>(
          `(() => { const e = document.getElementById('cmtErr'); return e && !e.hidden ? (e.textContent || '') : ''; })()`,
        );
        return t && t.includes("未送达") ? "ok" : null;
      },
      8_000,
    ).catch(() => "waitFor 超时：提交后没等到「未送达」回显");
    ok(b16Err === "ok", "B16 被 main 拒时把「未送达」写在框里，而不是静默收起（实测 " + JSON.stringify(b16Err) + "）");
    const b16Detail = await cdp2.eval<string>(
      `(() => { const e = document.getElementById('cmtErr'); return e ? (e.textContent || '') : 'absent'; })()`,
    );
    // 实测这一窗口没有活动 session（与 B12 的 card_action 同一句 fail-closed 判因），所以断言钉死那一句。
    // 写成三条 || 的析取式会被 assertion-health-scan 判红（任一成立即通过 = 弱判据），也确实更差：
    // 路由哪天换分支了，析取式会静默跟着过。
    ok(
      b16Detail.includes("无可用事件管线（fail-closed）"),
      "B16 判因原样上屏（main 那句 fail-closed，不是「发送失败」这类含糊话；实测 " + JSON.stringify(b16Detail.slice(0, 90)) + "）",
    );
    const b16Toast = await cdp2.eval<string>(
      `(() => { const t = document.getElementById('toast'); return t ? (t.textContent || '') : ''; })()`,
    );
    // 比「不含『已送进』」更硬：那条读的是个陈旧节点（B13 留下的文案），本动作失败时根本不写 toast，
    // 恒绿。失败回执只有 #cmtErr 一处，所以判据是「这次动作一个字也没写成成功」。
    ok(
      b16Toast === b16ToastBefore,
      "B16 被拒不写成功文案（toast 逐字未变；实测 前=" + JSON.stringify(b16ToastBefore.slice(0, 30)) +
        " 后=" + JSON.stringify(b16Toast.slice(0, 30)) + "）",
    );
    const b16CmtsAfter = await cdp2.eval<number>(
      `(() => document.querySelectorAll('.side-page[data-view="git"] .mc-comments .cm').length)()`,
    );
    ok(
      b16CmtsAfter === b16CmtsBefore,
      "B16 被拒的评论不落进事件流评论面（条数 " + String(b16CmtsBefore) + " → " + String(b16CmtsAfter) + "）",
    );
    const b16Esc = await cdp2.eval<string>(
      `(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        const p = document.getElementById('cmtPop');
        const b = document.querySelector('.side-page[data-view="git"] .ln-row[data-line] [data-cmt]');
        return JSON.stringify({ hidden: p ? p.hidden : 'absent', aria: b ? b.getAttribute('aria-expanded') : 'gone' });
      })()`,
    );
    ok(
      b16Esc.includes('"hidden":true') && b16Esc.includes('"aria":"false"'),
      "B16 Escape 收起走的是看板那一条链（不另开一套收起逻辑；实测 " + JSON.stringify(b16Esc) + "）",
    );
    // B17 收尾那一列不给必然失败的入口（与 B12「已死那列不长审批卡」同一条规矩）：
    // 合并决策一定，mergeOwners 就注销 ⇒ injectComment 恒 injected:false ⇒ 「送给它」是个必败按钮。
    // 撤的是入口，不是信息：行号照给，且要说明为什么不能评、想改该走哪条路。
    console.log("[panels-check] B17 合并决策已定的那一列：评论入口撤掉且说明原因（零模型调用）");
    await createEventLog(b11File).append({
      type: "tool_result", callId: "merge-" + b11B, ok: true, output: "[merged] 9f2c1ab",
    } as unknown as AgentEvent);
    ok(await b8ClickSession("验收会话"), "B17 先切走");
    ok(await b8ClickSession(clarifyId), "B17 再切回（重绘才走到 comment 判定）");
    const b17Probe =
      `(() => {
        const p = document.querySelector('.side-page[data-view="git"]');
        if (!p) return 'no-page';
        const t = (p.textContent || '').replace(/\\s+/g, ' ');
        return JSON.stringify({
          btns: p.querySelectorAll('[data-cmt]').length,
          rows: p.querySelectorAll('.ln-row').length,
          lno: [...p.querySelectorAll('.diff-anchored .lno')].map(e => (e.textContent || '').trim()).filter(Boolean).slice(0, 3),
          why: t.includes('它读不到了') && t.includes('按原任务重派'),
        });
      })()`;
    // selectSession 是异步的（读盘 → showHistory），当场读会拿到切换前那一屏（B15 同因）——
    // 等落定的判据是「入口撤了且原因上屏」，等不到就把最后一次实测数字带出来红，不静默过。
    const b17Settled = await tryWait(async () => {
      const s = await cdp2.eval<string>(b17Probe);
      return s.includes('"btns":0') && s.includes('"why":true');
    }, 12_000);
    const b17 = await cdp2.eval<string>(b17Probe);
    const b17Shape = JSON.parse(b17) as { btns: number; rows: number; lno: string[]; why: boolean };
    ok(b17Shape.rows >= 1, "B17 重绘真发生了（补丁行还在屏上；实测行数 " + String(b17Shape.rows) + "）");
    ok(b17Shape.btns === 0, "B17 已收尾的那一列不再长评论入口（实测按钮数 " + String(b17Shape.btns) + "）");
    ok(b17Shape.why, "B17 撤入口同时说清原因与出路（不是静默少一个按钮；等落定=" + String(b17Settled) + "）");
    ok(
      b17Shape.lno.length >= 1 && b17Shape.lno.every((s) => /^[0-9]+$/.test(s)),
      "B17 撤的是入口不是信息：行号照给（实测 " + JSON.stringify(b17Shape.lno) + "）",
    );
    // B18 孤儿工作树：agent:state 的 worktree 字段此前在渲染层零读者（ipc:check 只查通道挂没挂，
    // 查不到"挂着没人读"）。这里判的是"从 IPC 到屏上"这半段真走通了——期望由实测的盘上数算出来，
    // 三种盘上态各有自己那句确切文案（不写成「要么显示要么不显示」的析取式，那属于任一成立即通过）。
    console.log("[panels-check] B18 孤儿工作树：盘上数出来多少，屏上就该是什么样（只读，零模型调用）");
    const b18State = await cdp2.eval<string>(
      `(() => window.agent.getState().then((st) => JSON.stringify({
        has: !!(st && st.worktree),
        n: (st && st.worktree && Array.isArray(st.worktree.orphans)) ? st.worktree.orphans.length : -1,
      })))()`,
    );
    const b18 = JSON.parse(b18State) as { has: boolean; n: number };
    const want = !b18.has
      ? { contains: "数不出来", wt: "error" }
      : b18.n === 0
        ? { contains: "本机没有残留工作树", wt: "0" }
        : { contains: "残留工作树 " + String(b18.n) + " 个", wt: String(b18.n) };
    // 这一段是打开 git 页时现扫盘才落地的（loadWorktree 的 await 之后才 redraw），所以先等它出现
    // 再量：等状态不等事件，否则量到的是自己造的时序红。落不了定就是真红，红字里带实测文本。
    const settled = await tryWait(async () => {
      const hit = await cdp2.eval<string>(
        `(() => { const p = document.querySelector('.side-page[data-view="git"]');
          return (p && p.querySelector('.wt-orphan')) ? 'y' : ''; })()`,
      );
      return hit === "y" ? true : null;
    }, 10_000);
    const b18Dom = await cdp2.eval<string>(
      `(() => {
        const p = document.querySelector('.side-page[data-view="git"]');
        const el = p ? p.querySelector('.wt-orphan') : null;
        return JSON.stringify({ present: !!el, text: el ? (el.textContent || '').replace(/\\s+/g, ' ') : '', wt: el ? (el.dataset.wt || '') : '' });
      })()`,
    );
    const b18Shown = JSON.parse(b18Dom) as { present: boolean; text: string; wt: string };
    ok(
      settled === true && b18Shown.present && b18Shown.text.includes(want.contains),
      "B18 屏面与盘上数一致（盘：" + JSON.stringify(b18) + " 期望：" + JSON.stringify(want) +
        " 实测：" + JSON.stringify(b18Shown.text.slice(0, 70)) + " 等落定=" + String(settled === true) + "）",
    );
    // data-wt 是关键：n=0 时「写没有」与「压根没读」在文本上像，但出处属性分得开
    ok(
      b18Shown.wt === want.wt,
      "B18 屏上那段带得出自己的出处（盘：" + JSON.stringify(b18) + " 实测 data-wt=" +
        JSON.stringify(b18Shown.wt) + "，期望 " + JSON.stringify(want.wt) + "）",
    );
    // 有这一段也只该有名字与命令：0 个可点的东西。清理那条路（cleanOrphanWorktree 连 agent/*- 分支
    // 一起 branch -D、且不判是否已合并）在 #46 裁决前不给按钮——判据是「不许有」，不是「没有或没渲染」。
    const b18Buttons = await cdp2.eval<number>(
      `(() => { const p = document.querySelector('.side-page[data-view="git"]');
        return p ? (p.querySelector('.wt-orphan') ? p.querySelectorAll('.wt-orphan button').length : -1) : -9; })()`,
    );
    ok(
      b18Buttons === 0,
      "B18 这一段只报不删（清理会连分支一起 branch -D，未裁决 ⇒ 不许有按钮；" +
        "实测按钮数 " + String(b18Buttons) + "，期望 0）",
    );
    /* B19 辅助对话（§10.8）：四根通道里三根真跑（create / state / promote），全程零模型调用。
       ask 那一根在无 key 的验收环境里是 fail-closed 的 ⇒ 判它「把原因说给人看」，不判它成功。
       盘上只写本相自己的临时 sessions 目录（sidechats/<id>/），不碰靶子仓库；
       旁路那条「答案」是验收侧直接落到 sidechat 自己的 JSONL（等价于跑过一轮 ask 的结果），
       为的是把提升那一跳端到端判到，而不是再造一个演示 env（M2F_SIDECHAT_DEMO 会在 run 起手
       就播三问答 + 一次提升，污染 B1/B3 的事件计数面）。 */
    console.log("[panels-check] B19 辅助对话：面板 → 新建 / 快照 / 提升 / fail-closed 回执（零模型调用）");
    const scProbe = `(() => {
      const p = document.querySelector('.side-page[data-view="sidechat"]');
      if (!p) return JSON.stringify({ page: false, text: '', id: '', chip: '', promoteEv: '' });
      const row = p.querySelector('.sc-row');
      const pb = p.querySelector('[data-sc-act="promote"]');
      return JSON.stringify({
        page: true,
        text: (p.textContent || '').replace(/\\s+/g, ' ').slice(0, 200),
        id: row ? (row.dataset.sc || '') : '',
        chip: [...p.querySelectorAll('.sched-chip')].map(e => (e.textContent || '').trim()).join(' | '),
        promoteEv: pb ? (pb.dataset.scEv || 'none') : 'nobtn',
      });
    })()`;
    type Sc = { page: boolean; text: string; id: string; chip: string; promoteEv: string };
    const scRead = async (): Promise<Sc> => JSON.parse(await cdp2.eval<string>(scProbe)) as Sc;
    const scClick = (sel: string): Promise<string> => cdp2.eval<string>(
      `(() => { const b = document.querySelector('.side-page[data-view="sidechat"] ${sel}'); if (b) b.click(); return String(!!b); })()`,
    );
    const openSidechat = async (): Promise<void> => {
      await cdp2.eval(`(() => { document.querySelector('#qcGit')?.click(); return true; })()`);
      await cdp2.eval(`(() => { document.querySelector('#qcSidechat')?.click(); return true; })()`);
    };
    await cdp2.eval(`(() => { document.querySelector('#qcSidechat')?.click(); return true; })()`);
    const scFirst = await settle(async () => {
      const s = await scRead();
      return s.page && !s.text.includes("读取中") ? s : null;
    });
    ok(scFirst !== null, "B19 打开辅助对话页即拿到快照，不停在「读取中…」（实测 " +
      JSON.stringify((scFirst?.text ?? "").slice(0, 70)) + "）");
    ok((scFirst?.chip ?? "").includes("父会话 " + String(clarifyId)),
      "B19 面板认的父会话＝当前打开的那条（实测 " + JSON.stringify(scFirst?.chip ?? "") + "）");
    const scNew = await scClick('[data-sc-act="new"]');
    ok(scNew === "true", "B19 新建按钮真的在页上并被点着（实测回条 " + scNew + "）");
    const scId = await settle(async () => {
      const s = await scRead();
      return s.id !== "" ? s.id : null;
    });
    ok(typeof scId === "string" && scId !== "", "B19 新建后面板列出这条旁路会话（实测 id " + JSON.stringify(String(scId)) + "）");
    const scFile = join(root, "sidechats", String(scId ?? "?"), "events.jsonl");
    const scHeadLines = await settle(async () => {
      try { return (await readFile(scFile, "utf8")).trim().split("\n").length; } catch { return null; }
    }, 5_000);
    ok(scHeadLines === 1, "B19 盘上 sidechats/<id>/events.jsonl 起手只有一行 session_meta（实测行数 " + String(scHeadLines) + "）");
    await writeFile(scFile, (await readFile(scFile, "utf8")) +
      JSON.stringify({ type: "assistant_message", content: "旁路结论：只读投影，主会话文件一个字节没动。" }) + "\n", "utf8");
    await openSidechat();
    const scAns = await settle(async () => {
      const s = await scRead();
      return s.promoteEv === "2" && s.text.includes("旁路结论") ? s : null;
    });
    ok(scAns !== null, "B19 重开面板带出旁路那条答，并把「提升」锚到它（实测 promoteEv=" +
      JSON.stringify(scAns?.promoteEv ?? "null") + " 期望 \"2\"，文本 " + JSON.stringify((scAns?.text ?? "").slice(0, 60)) + "）");
    const mainFile = pathOf(root, String(clarifyId));
    const mainBefore = (await readFile(mainFile, "utf8")).trim().split("\n").length;
    ok(await scClick('[data-sc-act="promote"]') === "true", "B19 提升按钮按得下去（未被禁用）");
    const promotedLine = await settle(async () => {
      const raw = (await readFile(mainFile, "utf8")).trim().split("\n");
      if (raw.length !== mainBefore + 1) return null;
      const e = JSON.parse(raw[raw.length - 1] ?? "{}") as {
        type?: string; content?: string; origin?: { kind?: string; session_id?: string; source_event_ids?: number[] },
      };
      const o = e.origin;
      return e.type === "user_message" && o?.kind === "sidechat" && o.session_id === scId &&
        (o.source_event_ids ?? []).join() === "2" && (e.content ?? "").includes("旁路结论") ? JSON.stringify(o) : null;
    }, 10_000);
    ok(promotedLine !== null, "B19 提升写进主会话的是一条带 origin 的 user_message（零新增事件类型；" +
      "行数 " + String(mainBefore) + "→" + String(mainBefore + 1) + "，实测 origin " + JSON.stringify(promotedLine ?? "null") + "）");
    await openSidechat();
    const scBadge = await settle(async () => {
      const s = await scRead();
      return s.text.includes("已提升") && s.text.includes("已提升到主会话") ? s : null;
    }, 10_000);
    ok(scBadge !== null, "B19 徽标由主会话 origin 反向投影 + 回执说清去了哪（不另记事件；实测 " +
      JSON.stringify((scBadge?.text ?? "null").slice(0, 80)) + "）");
    await cdp2.eval(`(() => {
      const i = document.querySelector('.side-page[data-view="sidechat"] .sc-row .sc-ask-input');
      if (i) i.value = '再问一句';
      return String(!!i);
    })()`);
    ok(await scClick('[data-sc-act="ask"]') === "true", "B19 提问按钮与输入框都在行内（不是全局选择态）");
    const scAsk = await settle(async () => {
      const s = await scRead();
      return s.text.includes("无 M0_API_KEY") ? s : null;
    }, 10_000);
    ok(scAsk !== null, "B19 无 key 时「问」不静默：fail-closed 的原因上屏（实测 " +
      JSON.stringify((scAsk?.text ?? "null").slice(0, 90)) + "）");

    console.log("[panels-check] B20 截断卡真上屏：函数层锁住字符串不等于 JSONL→重放→HTML 这一跳接上了");
    /* 起因：待办 2 收口时留了一句 ⚠️「未做视觉核验」——`eventLabel` 的 turn_truncated 支只在 vm 里
       跑过那份函数。这一型同时是「子流不进父上下文」名单（CHILD_DETAIL_TYPES）的成员，于是它有两头
       要各证一次：父那一头必须上屏（否则函数再对也是零输出），worker 那一头必须不上屏。
       两头都拿**可区分的数字**判（4096/512/无 token/7777），不写「含不含类型名」这类能被别的卡糊过去的断言。 */
    const b20File = pathOf(root, clarifyId);
    const b20Evts: Record<string, unknown>[] = [
      { type: "turn_truncated", callId: "b20-1", outcome: "output_budget", stop_reason: "max_tokens", output_tokens: 4096 },
      { type: "turn_truncated", callId: "b20-2", outcome: "content_blocked", stop_reason: "SAFETY", output_tokens: 512 },
      { type: "turn_truncated", callId: "b20-3", outcome: "output_budget", stop_reason: "max_tokens" },
      { type: "turn_truncated", callId: "b20-4", agent_id: b11A, outcome: "output_budget", stop_reason: "max_tokens", output_tokens: 7777 },
    ];
    for (const e of b20Evts) await createEventLog(b20File).append(e as unknown as AgentEvent);
    ok(await b8ClickSession("验收会话"), "B20 先切走（重开才走 showHistory 整段重投那一支）");
    ok(await b8ClickSession(clarifyId), "B20 再切回靶子会话");
    const b20Heads = await settle(async () => {
      const h = await cdp2.eval<string[]>(
        `[...document.querySelectorAll('.stream .card .card-head')].map((n) => (n.textContent || '').trim())`,
      );
      return h.filter((x) => x.includes("助手输出被截断")).length === 3 ? h : null;
    }, 15_000);
    const b20Cards = (b20Heads ?? []).filter((x) => x.includes("助手输出被截断"));
    ok(b20Cards.length === 3, "B20 三张截断卡上屏（父的三型各一张；实测 " + String(b20Cards.length) + " 张：" +
      JSON.stringify(b20Cards.map((x) => x.slice(0, 46))) + "）");
    const b20Budget = b20Cards.find((x) => x.includes("4096")) ?? "";
    const b20Blocked = b20Cards.find((x) => x.includes("512")) ?? "";
    ok(
      b20Budget.includes("没写完就被收走") && b20Budget.includes("max_tokens") && b20Budget.includes("4096"),
      "B20 篇幅用尽那张说清「续写得下去」+ 线上原因 + 离帽多远（实测 " + JSON.stringify(b20Budget.slice(0, 70)) + "）",
    );
    ok(
      b20Blocked.includes("被内容策略中止") && !b20Blocked.includes("没写完"),
      "B20 内容策略那张不串成上一张的话（两种原因的下一步不同，并成一句＝让用户猜；实测 " + JSON.stringify(b20Blocked.slice(0, 70)) + "）",
    );
    ok(
      b20Cards.filter((x) => x.includes("输出 token")).length === 2,
      "B20 provider 没报 token 的那张不落那半句（缺席≠0；三张里含 token 数的实测 " +
        String(b20Cards.filter((x) => x.includes("输出 token")).length) + " 张，期望 2）",
    );
    const b20Stream = await cdp2.eval<string>(`(document.querySelector('.stream')?.textContent || '')`);
    ok(
      b20Cards.length === 3 && b20Cards.every((x) => !x.includes("turn_truncated")),
      "B20 标题里不出现原始英文类型名（EVENT_LABELS 收了这一条，真窗口这一跳也认；实测 " +
        String(b20Cards.filter((x) => x.includes("turn_truncated")).length) + " 张标题带英文名，期望 0）",
    );
    /* 负控的负控：展开体本来就 dump 原始事件（appendRecordCard 无 detailText 时 JSON.stringify(e)），
       所以「主转录全文不含类型名」是**我这条断言越界**，不是产品说谎——第一次跑就是这么红的。
       正确的成对判法：标题说人话 + 原文仍在（把 body 一起擦掉等于删证据，同样要红）。 */
    const b20Bodies = await cdp2.eval<string[]>(
      `[...document.querySelectorAll('.stream .card .card-body .ti-code')].map((n) => (n.textContent || ''))`,
    );
    const b20RawBodies = b20Bodies.filter((x) => x.includes('"turn_truncated"'));
    ok(
      b20RawBodies.length === 3 && b20RawBodies.every((x) => x.includes('"outcome"')),
      "B20 原文仍在展开体里（标题说人话 ≠ 把证据也擦掉；实测带类型的正文块 " + String(b20RawBodies.length) +
        " 块，期望 3 且逐块含 outcome）",
    );
    ok(!b20Stream.includes("7777"), "B20 worker 那条截断不在主转录（它是子会话的账；实测含 7777=" +
      String(b20Stream.includes("7777")) + "）");
    const b20OnDisk = (await readFile(b20File, "utf8")).trim().split("\n");
    const b20ChildLine = b20OnDisk.find((l) => l.includes("7777"));
    ok(
      typeof b20ChildLine === "string" && JSON.parse(b20ChildLine).agent_id === b11A,
      "B20 另一半：那条确实写进了盘上转录且带归因（不在界面 ≠ 被丢掉；实测 " + JSON.stringify(b20ChildLine?.slice(0, 90) ?? "无此行") + "）",
    );
    await killElectron(electron2);
  } finally {
    if (electron.exitCode === null) await killElectron(electron);
  }
}

// ---------------------------------------------------------------- main
/** B21：§13 新手引导的「弹 / 不弹」——三次真启动，各判一个用户可见状态。
 *  为什么判跨进程而不是页内 reload：`onboarded` 是主进程写的 settings.json，SIGKILL 也带不走它
 *  （476 行那条 localStorage 教训——跨进程判据必须落在盘上，不然测的是"没杀干净"）。 */
async function phaseOnboarding(): Promise<void> {
  console.log("[panels-check] B21 §13 新手引导：必弹 + 焦点圈 → 鼠标关 / 键盘关 / 点完成 / 重开不再弹（四次真启动）");
  const root = await mkdtemp(join(tmpdir(), "m1e-onboard-"));
  const sessions = join(root, "sessions");
  const settingsPath = join(root, "settings.json");
  await mkdir(sessions, { recursive: true });
  const readDisk = async (): Promise<Record<string, unknown>> =>
    JSON.parse((await readFile(settingsPath, "utf8").catch(() => "{}")) as string) as Record<string, unknown>;
  const launch = async (): Promise<{ proc: ChildProcess; cdp: Cdp } | null> => {
    const { proc, output } = spawnElectron({ M1E_SESSIONS_DIR: sessions, M1E_SETTINGS_PATH: settingsPath });
    const up = await tryWait(async () => {
      try { return (await fetch(CDP_URL + "/json/version")).ok ? true : null; } catch { return null; }
    }, 25_000);
    if (!up) {
      ok(false, "B21 引导窗口起不来 → 未验证（输出尾 3 行：" + output().trim().split("\n").slice(-3).join(" / ").slice(0, 180) + "）");
      await killElectron(proc);
      return null;
    }
    const cdp = new Cdp();
    await cdp.connect();
    return { proc, cdp };
  };
  const state = (cdp: Cdp) => cdp.eval<{ shown: boolean; rows: number; steps: string[]; first: string }>(
    `(() => { const o = document.querySelector('#onboardOverlay');
       if (!o) return { shown: false, rows: 0, steps: [], first: '' };
       const b = o.querySelector('.onb-row b');
       return { shown: o.classList.contains('show'), rows: o.querySelectorAll('.onb-row').length,
         steps: [...o.querySelectorAll('.onb-step .st-h')].map((n) => (n.textContent || '').trim()),
         first: b ? (b.textContent || '').trim() : '' }; })()`,
  );
  const awaited = (cdp: Cdp) => settle(async () => { const s = await state(cdp); return s.shown ? s : null; }, 15_000);
  const awaitHidden = (cdp: Cdp) => settle(async () => { const s = await state(cdp); return s.shown ? null : s; }, 10_000);
  const click = (cdp: Cdp, sel: string) =>
    cdp.eval<string>(`(() => { const n = document.querySelector(${JSON.stringify(sel)}); if (!n) return "no-node"; n.click(); return "clicked"; })()`);
  /** 真按键（CDP 走浏览器输入通道，不是 new KeyboardEvent 自派发）：焦点圈与 Escape 只有 trusted 事件才判得动。 */
  const press = async (cdp: Cdp, key: "Escape" | "Tab", shift = false): Promise<void> => {
    const vk = key === "Escape" ? 27 : 9;
    for (const type of ["keyDown", "keyUp"] as const) {
      await cdp.send("Input.dispatchKeyEvent", {
        type, key, code: key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk,
        ...(shift ? { modifiers: 8 } : {}),
      });
    }
  };

  /** 背景可达性的当场读数：先把当前焦点 blur 掉（否则「上一次调用留下的焦点」会参与比较——
   *  证伪时实测到这条顺序依赖：inert 关掉后 `moved` 反因焦点已在背景上而报 false），
   *  再对背景按钮 `.focus()`，直接问**它自己有没有拿到焦点**：inert 挂着时是 no-op ⇒ `got:false`。
   *  `inert` + `got` 这一对，就是「锁背景」与「锁整页」的分界。 */
  const backdrop = (cdp: Cdp) => cdp.eval<{ inert: boolean; got: boolean; to: string }>(
    `(() => {
       const app = document.querySelector('body > .app');
       const bg = document.querySelector('#sidebarToggle');
       const has = !!(app && app.hasAttribute('inert'));
       if (!bg) return { inert: has, got: false, to: 'no-bg-node' };
       const cur = document.activeElement;
       if (cur && cur !== document.body && typeof cur.blur === 'function') cur.blur();
       bg.focus();
       const now = document.activeElement;
       return { inert: has, got: now === bg, to: now ? String(now.id || now.tagName) : 'null' };
     })()`,
  );

  // ① 全新安装：必弹，且七组是从主进程那张表来的（界面里一个字都没写死）
  const a = await launch();
  if (a) {
    const s1 = await awaited(a.cdp);
    ok(s1 !== null, "B21 首启必弹（settings.json 不存在 = 缺省 onboarded:false；实测 shown=" + String(s1?.shown ?? false) + "）");
    ok((s1?.rows ?? 0) === 7, "B21 七组全在向导里（数据走 agent:onboarding，不是界面写死；实测 " + String(s1?.rows ?? 0) + " 行，期望 7）");
    ok((s1?.steps ?? []).join("|") === "第 1 步|第 2 步|第 3 步|第 4 步",
      "B21 步号由投影算出（步数与归属只有一份事实源；实测 " + JSON.stringify(s1?.steps ?? []) + "）");
    ok((s1?.first ?? "").includes("Provider"), "B21 第一组是 provider 那一条（顺序也没在界面里重排；实测 " + JSON.stringify(s1?.first ?? "") + "）");
    /* 焦点圈：「完成引导」是最后一个可聚焦项，Tab 一次必须绕回第一个（稍后再说）。
       背景虽被 pointer-events 挡住，键盘不会自己停——这条判的是 trusted 按键，不是自派发的 KeyboardEvent。 */
    await press(a.cdp, "Tab");
    const wrapped = await a.cdp.eval<string>(
      `(() => { const o = document.querySelector('#onboardOverlay'); const n = document.activeElement;
         return !o || !o.contains(n) ? "outside:" + String(n ? (n.id || n.className || n.tagName) : "null") : String(n.id || ""); })()`,
    );
    ok(wrapped === "onbLater", "B21 Tab 圈在浮层内（焦点从末位绕回首位；实测 activeElement=" + JSON.stringify(wrapped) + "）");
    /* B22：背景在**真窗口**里到底走不走得到。a11y 门扫的是构建产物里的 DOM 可达性，
       这里判的是真 Electron + `.focus()` 的实际结果——inert 挂着时背景抢不走焦点，
       关掉之后必须抢得走（只测前一半，「整页锁死」也能骗绿）。 */
    console.log("[panels-check] B22 模态背景的可达性（真窗口 .focus()，不是静态扫描）");
    const openBg = await backdrop(a.cdp);
    ok(openBg.inert === true, "B22 向导开着时背景整块 inert（实测 body > .app inert=" + String(openBg.inert) + "）");
    ok(openBg.got === false, "B22 背景真的抢不到焦点（.focus() 后 activeElement 不是它；实测 " + JSON.stringify(openBg.to) + "）");
    // ② 「稍后再说」只关窗，不写确认位
    ok(await click(a.cdp, "#onbLater") === "clicked", "B21 「稍后再说」按得下去");
    const h1 = await awaitHidden(a.cdp);
    ok(h1 !== null, "B21 点「稍后再说」后向导收起（实测 shown=" + String(h1?.shown ?? true) + "）");
    const closedBg = await backdrop(a.cdp);
    ok(closedBg.inert === false, "B22 关掉后背景解锁（不成对测这条，「永远锁死背景」也判绿；实测 inert=" + String(closedBg.inert) + "）");
    ok(closedBg.got === true, "B22 关掉后焦点进得去背景（实测 activeElement=" + JSON.stringify(closedBg.to) + "）");
    ok((await readDisk()).onboarded !== true, "B21 但盘上没写 onboarded——可中断不等于已确认（实测 " + JSON.stringify((await readDisk()).onboarded ?? "缺席") + "）");
    await killElectron(a.proc);
  }
  // ③ 重开：上次没确认 ⇒ 照弹（②的反面，缺它「稍后再说」就成了偷偷完成）；这次走键盘退路
  const b = await launch();
  if (b) {
    const s2 = await awaited(b.cdp);
    ok(s2 !== null, "B21 重开仍然弹（「稍后再说」没被说成完成；实测 shown=" + String(s2?.shown ?? false) + "）");
    await press(b.cdp, "Escape");
    const h2 = await awaitHidden(b.cdp);
    ok(h2 !== null, "B21 Escape 同样收得起向导（键盘与鼠标共用那一张收起表；实测 shown=" + String(h2?.shown ?? true) + "）");
    ok((await readDisk()).onboarded !== true, "B21 键盘退路也不写确认位（关窗 ≠ 确认；实测 " + JSON.stringify((await readDisk()).onboarded ?? "缺席") + "）");
    await killElectron(b.proc);
  }
  // ④ 第三次启动：仍然弹 ⇒ 这次点「完成引导」，确认位必须落到盘上
  const c = await launch();
  if (c) {
    const s3 = await awaited(c.cdp);
    ok(s3 !== null, "B21 第三次启动仍然弹（实测 shown=" + String(s3?.shown ?? false) + "）");
    ok(await click(c.cdp, "#onbDone") === "clicked", "B21 「完成引导」按得下去");
    const h3 = await awaitHidden(c.cdp);
    ok(h3 !== null, "B21 点完成后向导收起");
    const disk = await settle(async () => (((await readDisk()).onboarded === true) ? true : null), 8_000);
    ok(disk === true, "B21 完成写进了盘上的 settings.json（不是只改内存；实测 " + JSON.stringify((await readDisk()).onboarded ?? "缺席") + "）");
    await killElectron(c.proc);
  }
  // ⑤ 再重开：不再弹（commercial-check D2c 那句「完成后不再弹」真正要的东西）
  const d = await launch();
  if (d) {
    const gone = await settle(async () => ((await state(d.cdp)).shown ? null : true), 6_000);
    ok(gone === true, "B21 完成引导后重开不再弹（跨进程，判据在盘上；实测 shown=" + String((await state(d.cdp)).shown) + "）");
    await killElectron(d.proc);
  }
  await rm(root, { recursive: true, force: true }).catch(() => {});
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
  /* 全新安装会弹新手引导（§13），它盖在窗口上会挡住后面每一相的点击。B 相们判的是"老用户"的界面，
     所以按老用户的磁盘样子预置这一位；「弹与不弹」本身由 B21 相用**没有这个文件**的临时目录判。 */
  await writeFile(join(work, "settings.json"), JSON.stringify({ onboarded: true }), "utf8");

  await phaseSettings(work);
  await phaseSessions(work);
  await phaseReplay(work, sid);
  try {
    await phaseElectron(work);
  } catch (err) {
    // fail-visible：任何未预期异常都不许静默——计失败并打印原因（M2g §1.4-1）
    ok(false, "B 相异常（未验证）：" + (err instanceof Error ? err.message : String(err)));
  }
  await phaseOnboarding();
} finally {
  if (!ROOT_DIR) await rm(work, { recursive: true, force: true }).catch(() => {});
}

console.log("[panels-check] " + (failures === 0 ? "全部断言通过 ✅" : String(failures) + " 项失败 ❌"));
process.exit(failures === 0 ? 0 : 1);
