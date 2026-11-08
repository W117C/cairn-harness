// 完成通知点击的 renderer 真机（离屏）冒烟（2026-10-25）：
//   ⌘W 回主页 → 畸形载荷被忽略 → 合法载荷把 s1 打开（会话行 active、主区退出空屏）。
// 真实 OS Notification 弹出/点击在离屏 Electron 造不出来；那一段由 run-notification 单测
// 与 notification-open-wiring 源判据覆盖，并在报告里明确标未验。
const { app, BrowserWindow, nativeTheme } = require("electron");
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");

const profile = mkdtempSync(join(tmpdir(), "cairn-notification-profile-"));
app.setPath("userData", profile);
nativeTheme.themeSource = "light";
app.on("quit", () => { rmSync(profile, { recursive: true, force: true }); });
const out = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), "cairn-notification-"));
mkdirSync(out, { recursive: true });

async function main() {
  await app.whenReady();
  const protocol = readFileSync(join(__dirname, "../../../src/main/ipc-protocol.ts"), "utf8");
  const version = Number(protocol.match(/IPC_PROTOCOL_VERSION\s*=\s*(\d+)/)[1]);
  const start = protocol.indexOf("export interface AgentApi");
  const body = protocol.slice(start, protocol.indexOf("\n}", start));
  const starts = [...body.matchAll(/^\s{2}(\w+)\??\s*[(<]/gm)];
  const members = starts.map((s, i) => ({
    name: s[1],
    isArray: /Promise<[^>]*\[\]/.test(body.slice(s.index, starts[i + 1]?.index ?? body.length)),
  }));
  const win = new BrowserWindow({
    width: 1440, height: 900, show: false,
    webPreferences: {
      preload: join(__dirname, "ui-gallery-preload.cjs"),
      additionalArguments: ["--cairn-api-members=" + JSON.stringify(members), "--cairn-protocol-version=" + version],
    },
  });
  const errors = [];
  win.webContents.on("console-message", (_e, level, message) => { if (level >= 2) errors.push(message); });
  win.webContents.on("did-fail-load", (_e, code, desc) => console.error("[did-fail-load]", code, desc));
  win.webContents.on("render-process-gone", (_e, details) => console.error("[gone]", JSON.stringify(details)));
  await win.loadFile(join(__dirname, "../dist/index.html"));
  await new Promise((r) => setTimeout(r, 1600));
  const js = (source) => win.webContents.executeJavaScript(source).catch((err) => { console.error('[js-failed]', source); throw err; });
  const read = (source) => js(`(() => { ${source} })()`);
  const wait = (ms = 400) => new Promise((r) => setTimeout(r, ms));
  const checks = [];
  const check = (name, ok, detail) => { checks.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(detail)}`); };

  await js(`document.querySelector('.session')?.click()`); await wait(1400);
  check("先打开 s1", await read(`return document.querySelector('.session')?.classList?.contains('active') === true && document.querySelector('.main')?.dataset?.empty === 'false';`));
  await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', code: 'KeyW', metaKey: true, bubbles: true }))`); await wait(500);
  const home = await read(`return { empty: document.querySelector('.main')?.dataset.empty ?? null, active: !!document.querySelector('.session.active') };`);
  check("⌘W 回到主页", home.empty === "true" && home.active === false, home);

  await js(`window.__cairnPushNotification({})`); await wait(300);
  const malformed = await read(`return { empty: document.querySelector('.main')?.dataset.empty ?? null, active: !!document.querySelector('.session.active') };`);
  check("畸形通知载荷被忽略，不打开错会话", malformed.empty === "true" && malformed.active === false, malformed);

  await js(`window.__cairnPushNotification({ sessionId: 's1', workspace: '/tmp/demo-ws' })`); await wait(900);
  const opened = await read(`return { empty: document.querySelector('.main')?.dataset.empty ?? null, active: document.querySelector('.session.active')?.textContent ?? null, title: document.querySelector('.tb-title')?.textContent ?? null };`);
  check("合法通知载荷打开目标会话", opened.empty === "false" && opened.active !== null && (opened.title ?? "").includes("routing"), opened);
  const img = await win.webContents.capturePage();
  writeFileSync(join(out, "01-notification-opened-session.png"), img.toPNG());
  check("渲染过程无控制台错误", errors.length === 0, errors);

  writeFileSync(join(out, "checks.json"), JSON.stringify(checks, null, 2));
  console.log(`截图与读数：${out}\n隔离测试配置：${profile}`);
  app.exit(checks.every((c) => c.ok) ? 0 : 1);
}

const watchdog = setTimeout(() => { console.error("notification-open-smoke: 超时"); app.exit(1); }, 45_000);
watchdog.unref();
main().catch((err) => { console.error(err); app.exit(1); });
