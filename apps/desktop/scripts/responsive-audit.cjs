// 多视口响应式走查（2026-11-08 第 1045 页 · Frontend Responsive Design Standards）：
// 离屏 Electron + 画廊桩，逐档量横向溢出 / 关键区几何 / 小靶面 / 控制台错误。
// 与 layout-smoke 分工：那条钉「已经定下的裁决」，这条负责「继续找出还没定的问题」——
// 读数先落盘，只有「横向溢出 / 控制台错误」是硬判据，其余是探索证据，不冒充验收。
// 用法：cd apps/desktop && env -u ELECTRON_RUN_AS_NODE electron scripts/responsive-audit.cjs [outDir]
const electron = require("electron");
const { scheduleProfileCleanup } = require("./lib/profile-cleanup.cjs");
if (electron === null || typeof electron !== "object" || electron.app === undefined) {
  console.error("[responsive-audit] 需要真 Electron：env -u ELECTRON_RUN_AS_NODE electron scripts/responsive-audit.cjs");
  process.exit(2);
}
const { app, BrowserWindow, nativeTheme } = electron;
const { mkdtempSync, readFileSync, mkdirSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");

const profile = mkdtempSync(join(tmpdir(), "cairn-responsive-profile-"));
app.setPath("userData", profile);
nativeTheme.themeSource = "light";
app.on("quit", () => scheduleProfileCleanup(profile));
const out = resolve(process.argv[2] ?? mkdtempSync(join(tmpdir(), "cairn-responsive-")));
mkdirSync(out, { recursive: true });
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
const errors = [];
// 覆盖本仓现役断点边界 + 响应式标准建议档（375/768/1024/1440 里桌面可达的那几档）。
const WIDTHS = [1440, 1200, 1120, 1119, 1080, 1024, 960, 920, 880, 760, 720, 700, 640, 620];
// 第 1051 页：相邻两档差几百 px，无法区分「断点瞬间的阶跃」与「窗口变窄的自然响应」。
// 每个断点两侧各取 1px，量同一读数，差多少就是断点本身制造了多少跳。
const PAIRS = [[1201, 1200], [1121, 1120], [961, 960], [881, 880], [761, 760], [641, 640], [621, 620]];

async function main() {
  await app.whenReady();
  const watchdog = setTimeout(() => { console.error("[responsive-audit] 超时 120s 自退"); app.exit(1); }, 120_000);
  watchdog.unref?.();
  const protocol = readFileSync(join(__dirname, "../../../src/main/ipc-protocol.ts"), "utf8");
  const version = Number(protocol.match(/IPC_PROTOCOL_VERSION\s*=\s*(\d+)/)[1]);
  const start = protocol.indexOf("export interface AgentApi");
  const body = protocol.slice(start, protocol.indexOf("\n}", start));
  const starts = [...body.matchAll(/^\s{2}(\w+)\??\s*[(<]/gm)];
  const members = starts.map((s, i) => ({ name: s[1], isArray: /Promise<[^>]*\[\]/.test(body.slice(s.index, starts[i + 1]?.index ?? body.length)) }));
  const win = new BrowserWindow({
    width: 1440, height: 900, show: false,
    webPreferences: {
      backgroundThrottling: false, offscreen: true,
      preload: join(__dirname, "ui-gallery-preload.cjs"),
      additionalArguments: ["--cairn-api-members=" + JSON.stringify(members), "--cairn-protocol-version=" + version],
    },
  });
  win.webContents.on("console-message", (_e, level, message) => { if (level >= 2) errors.push(message); });
  win.webContents.on("render-process-gone", (_e, d) => errors.push("gone: " + JSON.stringify(d)));
  const js = (source) => win.webContents.executeJavaScript(source);

  const probe = `(() => {
    const rect = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect();
      return { l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height) }; };
    // 第 1051 页：窄窗收侧栏改走 width 过渡后，visibility:hidden 的子按钮仍在 DOM 里，
    // display:none 时代 offsetWidth=0 会被过滤、现在不会。它们 pointer-events:none 且不可见，
    // 不该计入「可见可交互小靶面」——显式排除，避免把过渡机制的正常中间态读成缺陷。
    const vis = (e) => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length)
      && getComputedStyle(e).visibility !== "hidden";
    // 只量**按钮**：行内 <a> 是文本流的一部分，不适用 24/44px 靶面规则；
    // inert 容器里的元素当前不可交互，也不计入（检查器打开态另跑一轮）。
    // 窄窗侧栏收起（width 过渡结束、宽度 <2px）时，其所有后代都已被裁剪且 pointer-events:none，
    // 即便某个后代显式覆盖 visibility 也不该算「可见可交互」——按祖先链一次排除。
    const sideWrap = document.querySelector('.side-wrap');
    const sideHidden = sideWrap !== null && sideWrap.getBoundingClientRect().width < 2;
    const small = [...document.querySelectorAll('button,[role="button"]')]
      .filter(vis).filter((e) => !e.closest('[inert]'))
      .filter((e) => !(sideHidden && e.closest('.side-wrap') !== null))
      .map((e) => {
      const r = e.getBoundingClientRect();
      return { label: (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 26),
        cls: String(e.className || e.tagName).slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) };
    }).filter((x) => x.w > 0 && x.h > 0 && (x.w < 24 || x.h < 24));
    const clipped = [...document.querySelectorAll('.s-title,.tb-title,.sp-nav-item,.cc-phase')].filter(vis)
      .filter((e) => e.scrollWidth > e.clientWidth + 2).length;
    return {
      vw: innerWidth, scrollW: document.documentElement.scrollWidth,
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      composer: rect('.composer-card'), reading: rect('.reading'), zone: rect('.zone-stream'),
      inspector: rect('.inspector-col'), session: rect('.session'), toolbar: rect('.app-toolbar'),
      inspectorVisible: (rect('.inspector-col')?.w ?? 0) > 1 && !document.querySelector('.inspector-col')?.hasAttribute('inert'),
      composerInView: (() => { const c = rect('.composer-card'); return c !== null && c.l >= 0 && c.r <= innerWidth; })(),
      smallCount: small.length, smallTargets: small.slice(0, 10), clippedLabels: clipped,
    };
  })()`;

  await win.loadFile(join(__dirname, "../dist/index.html"));
  await pause(600);
  await js(`document.querySelector('.session')?.click()`);
  await pause(300);

  const readings = [];
  for (const w of WIDTHS) {
    await win.setContentSize(w, 900);
    await pause(260);
    const r = await js(probe);
    readings.push(r);
    const img = await win.webContents.capturePage();
    writeFileSync(join(out, `w-${String(w).padStart(4, "0")}.png`), img.toPNG());
    console.log(`w=${String(w).padStart(4, "0")} overflow=${r.overflow} scrollW=${r.scrollW} composer=[${r.composer?.l},${r.composer?.r}] reading=${r.reading?.w} inspector=${r.inspectorVisible} small=${r.smallCount} clipped=${r.clippedLabels}`);
  }
  // 断点对：两侧各 1px，读数差 = 断点本身制造的阶跃（排除窗口变窄的自然响应）。
  const pairs = [];
  for (const [wide, narrow] of PAIRS) {
    await win.setContentSize(wide, 900); await pause(220);
    const a = await js(probe);
    await win.setContentSize(narrow, 900); await pause(220);
    const b = await js(probe);
    const d = { from: wide, to: narrow,
      composerLeftDelta: (b.composer?.l ?? 0) - (a.composer?.l ?? 0),
      readingWidthDelta: (b.reading?.w ?? 0) - (a.reading?.w ?? 0),
      scrollWDelta: b.scrollW - a.scrollW };
    pairs.push(d);
    console.log(`pair ${wide}->${narrow} composerLeft=${d.composerLeftDelta} readingW=${d.readingWidthDelta} scrollW=${d.scrollWDelta}`);
  }
  // 第 1051 页：761→760 的终点几何必然变化（窄窗无侧栏），但「突然」与「平滑」的分别
  // 在过渡态：display:none 会一帧归零，width 过渡则中途仍有宽度。采样三个时刻作证据。
  const sideW = `(() => { const e = document.querySelector('.side-wrap'); return e !== null ? +e.getBoundingClientRect().width.toFixed(1) : null; })()`;
  await win.setContentSize(761, 900); await pause(260);
  const sideWide = await js(sideW);
  await win.setContentSize(760, 900); await pause(45);
  const sideMid = await js(sideW);
  await pause(320);
  const sideEnd = await js(sideW);
  const smooth = sideWide !== null && sideMid !== null && sideEnd !== null
    && sideWide > 2 && sideMid > 2 && sideMid < sideWide - 2 && sideEnd < 2;
  console.log(`side-collapse 761->760 wide=${sideWide} mid=${sideMid} end=${sideEnd} smooth=${smooth}`);
  await win.setContentSize(1440, 900);
  await pause(260);
  // 检查器打开态：inert 撤掉后再量一次靶面 —— 关闭态里那些按钮当前不可交互，读数不算数。
  await js(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "i", code: "KeyI", metaKey: true, altKey: true, bubbles: true }))`);
  await pause(300);
  const inspectorOpen = [];
  for (const w of [1440, 880, 640]) {
    await win.setContentSize(w, 900);
    await pause(260);
    const r = await js(probe);
    inspectorOpen.push(r);
    console.log(`inspector-open w=${String(w).padStart(4, "0")} small=${r.smallCount} ${JSON.stringify(r.smallTargets)}`);
  }
  // 硬判据三条：不横向溢出、输入卡完整在视口内、**可见可交互按钮不小于 24×24**。
  // 第三条是第 1045 页补的：先由走查发现 .md-copy 只有 12px 高，修完后固化，防以后新控件退步。
  const bad = (r) => r.overflow || !r.composerInView || r.smallCount > 0;
  const hardFailures = [...readings, ...inspectorOpen].filter(bad).map((r) => ({ vw: r.vw,
    overflow: r.overflow, composerInView: r.composerInView, smallCount: r.smallCount, smallTargets: r.smallTargets }));
  const report = { widths: WIDTHS, pairs: PAIRS, readings, pairDeltas: pairs,
    sideCollapse: { wide: sideWide, mid: sideMid, end: sideEnd, smooth },
    inspectorOpen, consoleErrors: errors, hardFailures,
    // 断点边界跳变：相邻两档的 composer 左缘 / reading 宽度差，> 24px 记一次「锯齿」候选
    jumps: readings.slice(1).map((r, i) => ({ from: readings[i].vw, to: r.vw,
      composerLeftDelta: (r.composer?.l ?? 0) - (readings[i].composer?.l ?? 0),
      readingWidthDelta: (r.reading?.w ?? 0) - (readings[i].reading?.w ?? 0),
      smallDelta: r.smallCount - readings[i].smallCount }))
      .filter((j) => Math.abs(j.composerLeftDelta) > 24 || Math.abs(j.readingWidthDelta) > 120 || j.smallDelta !== 0),
  };
  writeFileSync(join(out, "readings.json"), JSON.stringify(report, null, 2));
  console.log(`[responsive-audit] ${readings.length} 档 + ${inspectorOpen.length} 档检查器打开态｜硬失败 ${hardFailures.length}｜断点跳变候选 ${report.jumps.length}｜console ${errors.length} 条｜产物 ${out}`);
  if (report.jumps.length > 0) console.log("[responsive-audit] 跳变候选 " + JSON.stringify(report.jumps));
  if (hardFailures.length > 0) console.log("[responsive-audit] 硬失败 " + JSON.stringify(hardFailures.slice(0, 4)));
  clearTimeout(watchdog);
  app.exit(hardFailures.length > 0 || errors.length > 0 ? 1 : 0);
}

main().catch((err) => { console.error("[responsive-audit]", err); app.exit(1); });
