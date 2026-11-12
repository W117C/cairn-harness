// 第二批设计方向样板（2026-11-08 第 1054 页）：会话页的两组纯几何提案。
//
// 与第一批（design-options.cjs）分工：第一批在空态首页做「深色层级 / 菜单降层」，
// 这批点进会话页，做 C「顶栏松紧与对齐」、D「消息之间的疏与密」。
// 每组仍给 现在 / 轻度 / 明显 三档，临时 CSS 覆盖、产品源码一行不改。
//
// 用法：cd apps/desktop && env -u ELECTRON_RUN_AS_NODE electron \
//         scripts/design-options-2.cjs ../../outputs/design-options-2026-11-08
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
const profile = mkdtempSync(join(tmpdir(), "cairn-options2-"));
app.setPath("userData", profile);
nativeTheme.themeSource = "dark";
app.on("quit", () => scheduleProfileCleanup(profile));

// C：顶栏要不要「独立成条」——轻度给一层浅表面 + 细分隔线，明显档再把标题做成 chip。
// 纯几何/gap 那版真机只差几百像素（等于看不出来），已撤，不拿不可辨的样板交差。
const C_LIGHT = `
.titlebar { background: hsl(60 2% 14% / .6) !important; border-bottom: 1px solid hsl(0 0% 100% / 12%) !important; }
.tb-center { gap: 8px !important; }
.tb-cluster { gap: 4px !important; }`;
const C_STRONG = C_LIGHT + `
.titlebar { background: hsl(60 2% 17%) !important; border-bottom: 1px solid hsl(0 0% 100% / 24%) !important; }
.tb-title { background: hsl(0 0% 11%) !important; border: 1px solid hsl(0 0% 100% / 22%) !important; border-radius: 999px !important; padding: 2px 12px !important; }
.tb-workspace-name { opacity: .68 !important; }`;

// D：轮间距 24px 收到 16px（轻度）/ 10px（明显），正文行高同步收一档。
const D_LIGHT = `
.row.user, .row.assistant { margin-top: 16px !important; }
.toolcluster { margin-top: 16px !important; }
.row.assistant .t { line-height: 1.6 !important; }`;
const D_STRONG = D_LIGHT + `
.row.user, .row.assistant { margin-top: 10px !important; }
.toolcluster { margin-top: 10px !important; }
.row.assistant .t { line-height: 1.5 !important; }`;

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
  // 进会话态：画廊桩的 .session 是现成的一段有内容的对话。
  const inSession = await js(`(() => { const e = document.querySelector('.session'); if (!e) return false; e.click(); return true; })()`);
  await pause(550);
  const state = await js(`(() => ({ rows: document.querySelectorAll('.row.user,.row.assistant').length,
    toolbar: !!document.querySelector('.tb-center'), stream: !!document.querySelector('.stream') }))()`);

  const setOption = (css) => js(`(() => {
    let s = document.getElementById('cairn-option2');
    if (s === null) { s = document.createElement('style'); s.id = 'cairn-option2'; document.head.appendChild(s); }
    s.textContent = ${JSON.stringify(css)}; return s.textContent.length;
  })()`);
  const shot = async (name) => { await pause(400); writeFileSync(join(OUT, name + ".png"), (await win.webContents.capturePage()).toPNG()); };

  await setOption("");          await shot("C-1-now");
  await setOption(C_LIGHT);     await shot("C-2-light");
  await setOption(C_STRONG);    await shot("C-3-strong");
  await setOption("");          await shot("D-1-now");
  await setOption(D_LIGHT);     await shot("D-2-light");
  await setOption(D_STRONG);    await shot("D-3-strong");

  writeFileSync(join(OUT, "options-2.json"), JSON.stringify({
    note: "第二批方向样板：会话页纯几何提案，临时 CSS 覆盖，产品源码未改；左=现在，中=轻度，右=明显。",
    theme: "dark", viewport: [1440, 900], inSession, state, errors,
    options: { C: { title: "顶栏松紧与对齐", now: "", light: C_LIGHT, strong: C_STRONG },
      D: { title: "消息之间的疏与密", now: "", light: D_LIGHT, strong: D_STRONG } },
  }, null, 2));
  console.log(`[design-options-2] 6 张｜inSession=${String(inSession)} state=${JSON.stringify(state)} console=${String(errors.length)}｜${OUT}`);
  await win.destroy();
  app.quit(0);
}
main().catch((e) => { console.error("[design-options-2]", e); app.quit(3); });
