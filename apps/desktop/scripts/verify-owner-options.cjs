// 落地自证（第 1053 页）：不注入任何 CSS，拍真实产品界面，
// 与业主选中的「轻度」样板（第 1052 页 A-2-light / B-2-light）做像素比对。
// 用法：cd apps/desktop && env -u ELECTRON_RUN_AS_NODE electron scripts/verify-owner-options.cjs <outDir>
const { app, BrowserWindow, nativeTheme } = require("electron");
const { scheduleProfileCleanup } = require("./lib/profile-cleanup.cjs");
if (!app || typeof app.whenReady !== "function") { console.error("需要 Electron app"); process.exit(2); }
const { mkdirSync, mkdtempSync, readFileSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");

const SCRIPTS = __dirname;
const ROOT = resolve(SCRIPTS, "..");
const OUT = process.argv[2] ? resolve(process.argv[2]) : resolve(ROOT, "outputs", "owner-options-landed");
mkdirSync(OUT, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), "cairn-landed-"));
app.setPath("userData", profile);
app.on("quit", () => scheduleProfileCleanup(profile));

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
      additionalArguments: ["--cairn-api-members=" + JSON.stringify(members), "--cairn-protocol-version=" + String(version), "--cairn-onboarding-groups=[]"],
    },
  });
  const js = (src) => win.webContents.executeJavaScript(src);
  const pause = (ms = 350) => new Promise((r) => setTimeout(r, ms));
  const errors = [];
  win.webContents.on("console-message", (_e, level, msg) => { if (level === 3) errors.push(msg); });
  await win.loadFile(resolve(ROOT, "dist", "index.html"));
  await pause(900);

  const setTheme = (t) => js(`(() => { const h = document.documentElement;
    h.dataset.theme = ${JSON.stringify(t)}; h.dataset.mode = ${JSON.stringify(t)};
    document.body.toggleAttribute("data-ds-dark-theme", ${JSON.stringify(t)} === "dark"); return true; })()`);
  const shot = async (name) => { await pause(380); writeFileSync(join(OUT, name + ".png"), (await win.webContents.capturePage()).toPNG()); };
  const probe = () => js(`(() => {
    const b = getComputedStyle(document.body), m = document.querySelector('.main'), c = document.querySelector('.composer-card');
    return { bodyBg100: b.getPropertyValue('--bg-100').trim(),
      surfaceCard: b.getPropertyValue('--surface-card').trim(),
      hairlineStrong: b.getPropertyValue('--hairline-strong').trim(),
      mainBg: m !== null ? getComputedStyle(m).backgroundColor : null,
      composerBg: c !== null ? getComputedStyle(c).backgroundColor : null,
      composerSurfaceCard: c !== null ? getComputedStyle(c).getPropertyValue('--surface-card').trim() : null,
      composerBgRaw: c !== null ? getComputedStyle(c).background.slice(0, 120) : null,
      composerCount: document.querySelectorAll('.composer-card').length,
      composerRadius: c !== null ? getComputedStyle(c).borderRadius : null,
      composerShadow: c !== null ? getComputedStyle(c).boxShadow.slice(0, 90) : null,
      focusRingRadius: c !== null ? getComputedStyle(c, '::after').borderRadius : null,
      below: (() => { const e = document.querySelector('.empty-below'); if (e === null) return null;
        const s = getComputedStyle(e); return { bg: s.backgroundColor, border: s.borderTopColor,
          radius: s.borderRadius, padLeft: s.paddingLeft, padBottom: s.paddingBottom }; })(),
      chip: (() => { const e = document.querySelector('.empty-chip'); if (e === null) return null;
        const s = getComputedStyle(e); return { bg: s.backgroundColor, border: s.borderTopColor }; })(),
      greetOpacity: (() => { const e = document.querySelector('.empty-greet-mark');
        return e !== null ? getComputedStyle(e).opacity : null; })(),
      scrim: getComputedStyle(document.body, '::after').backgroundColor };
  })()`);

  await setTheme("dark"); await pause(450);
  const dark = await probe();
  await shot("landed-A-dark");
  const opened = await js(`(() => { const e = document.querySelector('.empty-chip'); if (!e) return false; e.click(); return true; })()`);
  await pause(450);
  const darkPop = await probe();
  await shot("landed-B-dark");

  // 亮色：确认 --surface-card 未定义 ⇒ 输入卡回退 --bg-000，视觉不回归
  await setTheme("light"); await pause(450);
  const light = await probe();
  await shot("landed-A-light");

  writeFileSync(join(OUT, "verify.json"), JSON.stringify({ dark, darkPop, light, opened, errors }, null, 2));
  console.log("[verify-owner-options] dark=" + JSON.stringify(dark));
  console.log("[verify-owner-options] darkPop=" + JSON.stringify(darkPop));
  console.log("[verify-owner-options] light=" + JSON.stringify(light));
  console.log(`[verify-owner-options] chipOpened=${String(opened)} console=${String(errors.length)} ${OUT}`);
  await win.destroy();
  app.quit(0);
}
main().catch((e) => { console.error("[verify-owner-options]", e); app.quit(3); });
