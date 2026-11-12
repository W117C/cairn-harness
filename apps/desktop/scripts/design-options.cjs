// 设计方向样板生成器（2026-11-08 第 1052 页）
//
// 业主新要求：请他裁决时要说「有什么影响 / 做出来是什么效果」，并给**能直接看的样板**再选。
// 本脚本在离屏真机上用「临时 CSS 覆盖」拍同一界面的三档力度，产品源码一行不改：
//   A 暗色层级与颜色艳度：现在 / 轻度（提亮画布 + 描边清楚一点）/ 明显（再降品牌橙饱和）
//   B 菜单打开时背景降层：现在 / 轻度（9% 暗化）/ 明显（20% 暗化 + 浮层阴影加重）
// 产物是 6 张 PNG + options.json（含每档 CSS 与一句大白话），再由拼图脚本合成两张三联图。
//
// 用法：cd apps/desktop && env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron \
//         scripts/design-options.cjs ../../outputs/design-options-2026-11-08
const { app, BrowserWindow, nativeTheme } = require("electron");
const { scheduleProfileCleanup } = require("./lib/profile-cleanup.cjs");
if (!app || typeof app.whenReady !== "function") {
  console.error("[design-options] 需要 Electron app；请用 env -u ELECTRON_RUN_AS_NODE electron ...");
  process.exit(2);
}
const { mkdirSync, mkdtempSync, readFileSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");

const SCRIPTS = __dirname;
const ROOT = resolve(SCRIPTS, "..");
const OUT = process.argv[2] ? resolve(process.argv[2]) : resolve(ROOT, "outputs", "design-options-2026-11-08");
mkdirSync(OUT, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), "cairn-design-options-"));
app.setPath("userData", profile);
nativeTheme.themeSource = "dark";
app.on("quit", () => scheduleProfileCleanup(profile));

// ── 提案 CSS：只覆盖语义 token / 加一层遮罩，不动 DOM、不动布局 ──────────
// A 组：body 上被 dsh-claude-style.css 重定义了 --bg-100，html 上的 token 覆盖够不着 .main
// （computed 自证：--bg-100 已变 10.5%，.main 背景仍 8.2%）。样板直接覆盖元素表面，
// 落地实现时再收回到正确的 token 层——预览只负责把「看起来会怎样」拍出来。
const A_LIGHT = `
[data-theme="dark"] .main { background: hsl(0 0% 10.5%) !important; }
[data-theme="dark"] .side-wrap { background: hsl(60 3.4% 13.5%) !important; }
[data-theme="dark"] .composer-card,
[data-theme="dark"] .pop { background: hsl(60 2.4% 18.4%) !important; }
[data-theme="dark"] .composer-card,
[data-theme="dark"] .pop,
[data-theme="dark"] .empty-chip,
[data-theme="dark"] .empty-context-item { border-color: hsl(0 0% 100% / 22%) !important; }`;
const A_STRONG = A_LIGHT + `
[data-theme="dark"] .main { background: hsl(0 0% 13%) !important; }
[data-theme="dark"] .composer-card,
[data-theme="dark"] .pop { background: hsl(60 2.4% 22%) !important; }
[data-theme="dark"] .composer-card,
[data-theme="dark"] .pop,
[data-theme="dark"] .empty-chip,
[data-theme="dark"] .empty-context-item { border-color: hsl(0 0% 100% / 32%) !important; }
[data-theme="dark"] .app { filter: saturate(.8); }
[data-theme="dark"] .empty-greet-mark, [data-theme="dark"] .chip.on { filter: saturate(.72); }`;
const B_LIGHT = `
body:has(.chip-pop.show)::after {
  content: ""; position: fixed; inset: 0; z-index: 35; pointer-events: none;
  background: hsl(0 0% 0% / 9%);
}`;
const B_STRONG = `
body:has(.chip-pop.show)::after {
  content: ""; position: fixed; inset: 0; z-index: 35; pointer-events: none;
  background: hsl(0 0% 0% / 20%);
}
.pop.chip-pop.show { box-shadow: 0 12px 34px hsl(0 0% 0% / 48%); }`;

async function main() {
  await app.whenReady();
  const protocol = readFileSync(resolve(SCRIPTS, "../../../src/main/ipc-protocol.ts"), "utf8");
  const version = Number(protocol.match(/IPC_PROTOCOL_VERSION\s*=\s*(\d+)/)?.[1]);
  const start = protocol.indexOf("export interface AgentApi");
  const body = protocol.slice(start, protocol.indexOf("\n}", start));
  const starts = [...body.matchAll(/^\s{2}(\w+)\??\s*[(<]/gm)];
  const members = starts.map((m, i) => ({
    name: m[1],
    isArray: /Promise<[^>]*\[\]/.test(body.slice(m.index, starts[i + 1]?.index ?? body.length)),
  }));
  const win = new BrowserWindow({
    width: 1440, height: 900, show: false,
    webPreferences: {
      backgroundThrottling: false, offscreen: true,
      preload: join(SCRIPTS, "ui-gallery-preload.cjs"),
      additionalArguments: [
        "--cairn-api-members=" + JSON.stringify(members),
        "--cairn-protocol-version=" + String(version),
        "--cairn-onboarding-groups=[]",
        "--cairn-agent-os-fixture",
        "--cairn-plugin-marketplace-fixture",
      ],
    },
  });
  const js = (src) => win.webContents.executeJavaScript(src);
  const pause = (ms = 350) => new Promise((r) => setTimeout(r, ms));
  const errors = [];
  win.webContents.on("console-message", (_e, level, msg) => { if (level === 3) errors.push(msg); });

  await win.loadFile(resolve(ROOT, "dist", "index.html"));
  await pause(900);
  await js(`(() => { const h = document.documentElement;
    h.dataset.theme = "dark"; h.dataset.mode = "dark";
    document.body.toggleAttribute("data-ds-dark-theme", true); return true; })()`);
  await pause(500);

  const setOption = (css) => js(`(() => {
    let s = document.getElementById('cairn-option');
    if (s === null) { s = document.createElement('style'); s.id = 'cairn-option'; document.head.appendChild(s); }
    s.textContent = ${JSON.stringify(css)};
    return s.textContent.length;
  })()`);
  const shot = async (name) => {
    await pause(380);
    writeFileSync(join(OUT, name + ".png"), (await win.webContents.capturePage()).toPNG());
    console.log("[design-options] shot", name);
  };

  // A：空态首屏（默认就是空态）
  const tokenProbe = () => js(`(() => {
    const h = getComputedStyle(document.documentElement);
    const b = document.body, cb = getComputedStyle(b);
    const m = document.querySelector('.main');
    const c = document.querySelector('.composer-card');
    return { htmlBg100: h.getPropertyValue('--bg-100').trim(),
      bodyBg100: cb.getPropertyValue('--bg-100').trim(),
      bodySurface1: cb.getPropertyValue('--surface-1').trim(),
      bodySurface2: cb.getPropertyValue('--surface-2').trim(),
      bodyDswBase: cb.getPropertyValue('--dsw-alias-bg-base').trim(),
      bodyAttrs: [...b.attributes].map(a => a.name + '=' + a.value).slice(0, 14),
      mainBg: m !== null ? getComputedStyle(m).backgroundColor : null,
      composerBg: c !== null ? getComputedStyle(c).backgroundColor : null };
  })()`);
  await setOption("");
  await shot("A-1-now");
  const aNow = await tokenProbe();
  await setOption(A_LIGHT);
  await shot("A-2-light");
  const aLight = await tokenProbe();
  await setOption(A_STRONG);
  await shot("A-3-strong");
  const aStrong = await tokenProbe();

  // B：同界面，点开项目 chip 弹层
  await setOption("");
  const opened = await js(`(() => { const e = document.querySelector('.empty-chip'); if (!e) return false; e.click(); return true; })()`);
  await pause(450);
  const popOpen = await js(`Boolean(document.querySelector('.chip-pop.show'))`);
  await shot("B-1-now");
  await setOption(B_LIGHT);
  await shot("B-2-light");
  await setOption(B_STRONG);
  await shot("B-3-strong");

  writeFileSync(join(OUT, "options.json"), JSON.stringify({
    note: "临时 CSS 覆盖生成的方向样板，产品源码未改；左=现在，中=轻度，右=明显。",
    theme: "dark", viewport: [1440, 900], chipOpened: opened, popOpen, errors,
    tokenProbe: { now: aNow, light: aLight, strong: aStrong },
    options: {
      A: { title: "暗色层级与颜色艳度", now: "", light: A_LIGHT, strong: A_STRONG },
      B: { title: "菜单打开时背景降层", now: "", light: B_LIGHT, strong: B_STRONG },
    },
  }, null, 2));
  console.log(`[design-options] 6 张样板｜弹层打开=${String(popOpen)}｜console ${String(errors.length)} 条｜${OUT}`);
  await win.destroy();
  app.quit(0);
}
main().catch((e) => { console.error("[design-options] 崩了", e); app.quit(3); });
