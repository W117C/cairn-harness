// M1e 验收脚本（pnpm panels-check）：
//   A. headless：settings 布局持久化（写→重载一致 / 非法回退默认）+ 会话列表 CRUD + 会话 run→重放投影逐字一致
//   B. Electron + CDP：1 万条事件虚拟化（DOM ≤300 / 滚动一屏 ≤200ms）+ 审批徽标 ≤1s + 布局重启还原 + 会话重命名落盘 + 截图
// 退出码 0 = 全部断言通过；任何断言失败退出码 1。
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
    const { proc: electron2, output: output2 } = spawnElectron({ M1E_SESSIONS_DIR: root, M1E_SETTINGS_PATH: join(root, "settings.json") });
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
  try {
    await phaseElectron(work);
  } catch (err) {
    // fail-visible：任何未预期异常都不许静默——计失败并打印原因（M2g §1.4-1）
    ok(false, "B 相异常（未验证）：" + (err instanceof Error ? err.message : String(err)));
  }
} finally {
  if (!ROOT_DIR) await rm(work, { recursive: true, force: true }).catch(() => {});
}

console.log("[panels-check] " + (failures === 0 ? "全部断言通过 ✅" : String(failures) + " 项失败 ❌"));
process.exit(failures === 0 ? 0 : 1);
