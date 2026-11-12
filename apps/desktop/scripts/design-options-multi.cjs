// 多路线样板（2026-11-08 第 1055 页）：同一首页，四种**不同风格**而非力度递进。
// 业主「做多种让用户自己选择」⇒ 每种路线配一句大白话影响 + 效果，拼成四宫格让他挑。
// 临时 CSS 覆盖，产品源码一行不改；基底是当前已落地的「A 轻度」暗色界面。
//
// 用法：cd apps/desktop && env -u ELECTRON_RUN_AS_NODE electron \
//         scripts/design-options-multi.cjs ../../outputs/design-options-2026-11-08
const { app, BrowserWindow, nativeTheme } = require("electron");
const { scheduleProfileCleanup } = require("./lib/profile-cleanup.cjs");
if (!app || typeof app.whenReady !== "function") { console.error("需要 Electron app"); process.exit(2); }
const { mkdirSync, mkdtempSync, readFileSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");

const SCRIPTS = __dirname;
const ROOT = resolve(SCRIPTS, "..");
const OUT = process.argv[2] ? resolve(process.argv[2]) : resolve(ROOT, "outputs", "design-options-2026-11-08");
mkdirSync(OUT, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), "cairn-options-multi-"));
app.setPath("userData", profile);
nativeTheme.themeSource = "dark";
app.on("quit", () => scheduleProfileCleanup(profile));

// ① 现在：基底不动
const NOW = "";
// ② 更聚焦：撤掉下半屏的建议行与最近会话，只留问候 + 项目 + 输入卡，输入区放大居中
const FOCUS = `
.empty-below, .empty-context { display: none !important; }
.empty { justify-content: center !important; gap: var(--space-lg) !important; }
.composer-card textarea { min-height: 84px !important; }
.composer-card { border-radius: 18px !important; }`;
// ③ 更有内容：把留白收掉，建议行更紧凑并成组，最近会话一行铺开
const INFO = `
.empty-tail { flex: .35 1 0 !important; }
.empty-below { gap: 2px !important; padding-top: var(--space-sm) !important; }
.start { min-height: 30px !important; border-bottom: 1px solid hsl(0 0% 100% / 8%) !important; border-radius: 0 !important; }
.empty-context { width: 100% !important; max-width: var(--col-max) !important; margin-top: var(--space-md) !important; padding-top: var(--space-sm) !important; border-top: 1px solid hsl(0 0% 100% / 14%) !important; }
.empty-context-list { justify-content: flex-start !important; }`;
// ④ 更柔和分层：建议行成一块浅表面，输入卡更浮起，胶囊改实心
const LAYER = `
.empty-below { background: hsl(60 2% 15% / .7) !important; border: 1px solid hsl(0 0% 100% / 10%) !important; border-radius: 16px !important; padding: var(--space-md) !important; }
.composer-card { box-shadow: 0 14px 34px hsl(0 0% 0% / 38%) !important; border-radius: 18px !important; }
.empty-chip, .empty-context-item { background: hsl(60 2% 19%) !important; border-color: transparent !important; }
.empty-greet-mark { opacity: .9 !important; }`;

async function main() {
  await app.whenReady();
  const protocol = readFileSync(resolve(SCRIPTS, "../../../src/main/ipc-protocol.ts"), "utf8");
  const version = Number(protocol.match(/IPC_PROTOCOL_VERSION\s*=\s*(\d+)/)?.[1]);
  const start = protocol.indexOf("export interface AgentApi");
  const body = protocol.slice(start, protocol.indexOf("\n}", start));
  const starts = [...body.matchAll(/^\s{2}(\w+)\??\s*[(<]/gm)];
  const members = starts.map((m, i) => ({ name: m[1], isArray: /Promise<[^>]*\[\]/.test(body.slice(m.index, starts[i + 1]?.index ?? body.length)) }));
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
  const pause = (ms = 380) => new Promise((r) => setTimeout(r, ms));
  const errors = [];
  win.webContents.on("console-message", (_e, level, msg) => { if (level === 3) errors.push(msg); });

  await win.loadFile(resolve(ROOT, "dist", "index.html"));
  await pause(900);
  await js(`(() => { const h = document.documentElement;
    h.dataset.theme = "dark"; h.dataset.mode = "dark";
    document.body.toggleAttribute("data-ds-dark-theme", true); return true; })()`);
  await pause(450);
  const state = await js(`(() => ({ starts: document.querySelectorAll('.start').length,
    context: document.querySelectorAll('.empty-context-item').length,
    composer: !!document.querySelector('.composer-card'), empty: !!document.querySelector('.empty') }))()`);

  const setOption = (css) => js(`(() => {
    let s = document.getElementById('cairn-option-multi');
    if (s === null) { s = document.createElement('style'); s.id = 'cairn-option-multi'; document.head.appendChild(s); }
    s.textContent = ${JSON.stringify(css)}; return s.textContent.length;
  })()`);
  const shot = async (name) => { await pause(420); writeFileSync(join(OUT, name + ".png"), (await win.webContents.capturePage()).toPNG()); };

  const variants = [
    ["M-1-now", "现在", NOW, "保持现状：问候、项目选择、输入框、建议行、最近会话都在，下半屏留白较多。"],
    ["M-2-focus", "更聚焦", FOCUS, "撤掉下半屏所有建议与最近会话，只留问候和输入框；输入区更大、整体居中。影响：最干净，但少了一键起手和回到旧会话的入口。"],
    ["M-3-info", "更有内容", INFO, "把下半屏留白收掉，建议行更紧凑成组、最近会话铺成一行。影响：一屏能看到更多可点的东西，但会显得忙一点。"],
    ["M-4-layer", "更柔和分层", LAYER, "建议行做成一块浅表面，输入框浮得更明显、胶囊变实心。影响：层次最清楚、最'有设计感'，但表面块变多。"],
  ];
  for (const [name, , css] of variants) {
    await setOption(css);
    await shot(name);
  }
  writeFileSync(join(OUT, "options-multi.json"), JSON.stringify({
    note: "首页四种不同路线（不是力度递进），临时 CSS 覆盖、产品源码未改；最终由业主四选一。",
    theme: "dark", viewport: [1440, 900], state, errors,
    variants: variants.map(([file, label, css, effect]) => ({ file: file + ".png", label, effect, css })),
  }, null, 2));
  console.log(`[design-options-multi] 4 张路线｜state=${JSON.stringify(state)} console=${String(errors.length)}｜${OUT}`);
  await win.destroy();
  app.quit(0);
}
main().catch((e) => { console.error("[design-options-multi]", e); app.quit(3); });
