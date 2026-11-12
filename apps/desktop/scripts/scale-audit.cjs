// 双轴缩放走查（2026-11-08 第 1050 页 · 「最舒服」的可访问性面）
//
// 前几批的多视口走查（responsive-audit.cjs）一直在**默认档**跑。本仓有两条真实缩放轴：
//   文字轴 html[data-text-size]  sm=0.92 / md=1 / lg=1.08      → --rem-scale
//   尺寸轴 html[data-ui-size]    1..5 = 0.833/1/1.167/1.333/1.667 → --size-scale
// 极端组合（lg+step5 最大、sm+step1 最小）最容易溢出或让可见靶面掉到 24px 以下。
// 这里按**真档位属性**驱动（不伪造 CSS 变量），每组合自证两个 scale 的 computed 值。
//
// 用法：cd apps/desktop && env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron \
//         scripts/scale-audit.cjs ../../outputs/scale-audit-2026-11-08
const electron = require("electron");
const { scheduleProfileCleanup } = require("./lib/profile-cleanup.cjs");
if (electron === null || typeof electron !== "object" || electron.app === undefined) {
  console.error("[scale-audit] 需要真 Electron：env -u ELECTRON_RUN_AS_NODE electron scripts/scale-audit.cjs");
  process.exit(2);
}
const { app, BrowserWindow, nativeTheme } = electron;
const { mkdtempSync, readFileSync, mkdirSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");

const profile = mkdtempSync(join(tmpdir(), "cairn-scale-profile-"));
app.setPath("userData", profile);
nativeTheme.themeSource = "light";
app.on("quit", () => scheduleProfileCleanup(profile));
const out = resolve(process.argv[2] ?? mkdtempSync(join(tmpdir(), "cairn-scale-")));
mkdirSync(out, { recursive: true });
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
const errors = [];

// 真档位：tokens.css 的 html[data-text-size] / html[data-ui-size] 选择器值。
const COMBOS = [
  { text: "md", ui: "2", rem: 1, size: 1, label: "baseline" },
  { text: "lg", ui: "5", rem: 1.08, size: 1.667, label: "max" },
  { text: "sm", ui: "1", rem: 0.92, size: 0.833, label: "min" },
  { text: "lg", ui: "2", rem: 1.08, size: 1, label: "large-text" },
  { text: "md", ui: "5", rem: 1, size: 1.667, label: "large-controls" },
];
const WIDTHS = [1440, 1200, 1080, 960, 880, 760, 640, 620];

async function main() {
  await app.whenReady();
  const watchdog = setTimeout(() => { console.error("[scale-audit] 超时 180s 自退"); app.exit(1); }, 180_000);
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
  const js = (source) => win.webContents.executeJavaScript(source);

  const probe = `(() => {
    const rect = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect();
      return { l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height) }; };
    // 与 responsive-audit.cjs 同口径（第 1051 页）：窄窗侧栏走 width 过渡后，
    // visibility:hidden / 被裁剪的后代仍在 DOM 里，不是「可见可交互」按钮。
    const vis = (e) => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length)
      && getComputedStyle(e).visibility !== "hidden";
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
    const clipped = [...document.querySelectorAll('.s-title,.tb-title,.sp-nav-item,.cc-phase,.empty-context-item,.start')]
      .filter(vis).filter((e) => e.scrollWidth > e.clientWidth + 2)
      .map((e) => ({ cls: String(e.className).slice(0, 30), text: (e.textContent || '').trim().slice(0, 24),
        scrollW: e.scrollWidth, clientW: e.clientWidth,
        ellipsis: getComputedStyle(e).textOverflow === "ellipsis",
        nowrap: getComputedStyle(e).whiteSpace === "nowrap" }))
      // 第 1050 页验伪：单行 ellipsis 是刻意的标题省略（侧栏会话名 / 工具栏标题），
      // 不是「大字号把文字截断」的缺陷；只有非省略元素真的溢出才算数。
      .filter((x) => !(x.ellipsis && x.nowrap));
    const root = getComputedStyle(document.documentElement);
    const c = rect('.composer-card');
    return {
      vw: innerWidth, scrollW: document.documentElement.scrollWidth,
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      composer: c, reading: rect('.reading'),
      composerInView: c !== null && c.l >= 0 && c.r <= innerWidth,
      remScale: +parseFloat(root.getPropertyValue('--rem-scale')).toFixed(3),
      sizeScale: +parseFloat(root.getPropertyValue('--size-scale')).toFixed(3),
      smallCount: small.length, smallTargets: small.slice(0, 8), clipped: clipped.length, clippedLabels: clipped.slice(0, 6),
    };
  })()`;

  await win.loadFile(join(__dirname, "../dist/index.html"));
  await pause(600);
  await js(`document.querySelector('.session')?.click()`);
  await pause(300);

  const rows = [];
  const checks = [];
  const fail = (name, ok, detail) => {
    checks.push({ name, ok, ...detail });
    console.log(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(detail)}`);
    if (!ok) rows.push({ name, ...detail });
  };
  for (const combo of COMBOS) {
    await js(`(() => { const h = document.documentElement;
      h.dataset.textSize = ${JSON.stringify(combo.text)}; h.dataset.uiSize = ${JSON.stringify(combo.ui)}; return true; })()`);
    await pause(320);
    const first = await js(probe);
    fail(`档位自证 ${combo.label}: --rem-scale=${combo.rem} / --size-scale=${combo.size}`,
      Math.abs(first.remScale - combo.rem) < 0.005 && Math.abs(first.sizeScale - combo.size) < 0.005,
      { gotRem: first.remScale, gotSize: first.sizeScale });
    for (const w of WIDTHS) {
      await win.setContentSize(w, 900);
      await pause(220);
      const r = await js(probe);
      const bad = r.overflow || !r.composerInView;
      checks.push({ name: `硬判 ${combo.label}@${w}`, ok: !bad,
        overflow: r.overflow, composerInView: r.composerInView, smallCount: r.smallCount,
        smallTargets: r.smallTargets, clipped: r.clipped, clippedLabels: r.clippedLabels });
      if (bad) rows.push({ name: `硬失败 ${combo.label}@${w}`, ...r });
      if (w === 1440 || w === 640) {
        const img = await win.webContents.capturePage();
        writeFileSync(join(out, `${combo.label}-${w}.png`), img.toPNG());
      }
      console.log(`${combo.label.padEnd(15)} w=${String(w).padStart(4, "0")} overflow=${r.overflow} composerInView=${r.composerInView} small=${r.smallCount} clipped=${r.clipped} scrollW=${r.scrollW}`);
    }
    // 默认档必须维持第 1045 页「无小靶面」；第 1050 页补命中区兜底后，
    // 用户主动选最小尺寸档同样不许有小靶面（视觉可紧凑，命中区不能缩）。
    if (combo.label === "baseline" || combo.label === "min") {
      const worst = checks.filter((c) => c.name.startsWith(`硬判 ${combo.label}@`)).reduce((m, c) => Math.max(m, c.smallCount), 0);
      fail(`${combo.label} 档无小靶面（命中区 ≥24px 不随尺寸轴缩水）`, worst === 0, { worst });
    }
  }
  fail("console 无错误", errors.length === 0, { errors });

  writeFileSync(join(out, "readings.json"), JSON.stringify({ combos: COMBOS, widths: WIDTHS, checks, failures: rows, consoleErrors: errors }, null, 2));
  console.log(`[scale-audit] ${CHECKS_OK(checks)}/${checks.length} PASS｜硬失败 ${rows.length}｜产物 ${out}`);
  clearTimeout(watchdog);
  app.exit(rows.length > 0 ? 1 : 0);
}

function CHECKS_OK(checks) { return checks.filter((c) => c.ok).length; }
main().catch((err) => { console.error("[scale-audit]", err); app.exit(1); });
