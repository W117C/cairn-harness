// 偏好备份真实 renderer 冒烟（2026-10-30 · 第 809 页）。
// 判：设置「关于与更新」的导出/导入按钮真调 agent 方法；导入先读 patch 再 setSettings，
// 回执上屏且设置真的变了（textSize=lg）。
const { app, BrowserWindow, nativeTheme } = require("electron");
const { scheduleProfileCleanup } = require("./lib/profile-cleanup.cjs");
const { mkdirSync, mkdtempSync, readFileSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");

const profile = mkdtempSync(join(tmpdir(), "cairn-prefs-profile-"));
app.setPath("userData", profile);
nativeTheme.themeSource = "light";
app.on("quit", () => scheduleProfileCleanup(profile));
const out = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), "cairn-prefs-smoke-"));
mkdirSync(out, { recursive: true });

async function main() {
  await app.whenReady();
  const protocol = readFileSync(join(__dirname, "../../../src/main/ipc-protocol.ts"), "utf8");
  const version = Number(protocol.match(/IPC_PROTOCOL_VERSION\s*=\s*(\d+)/)[1]);
  const start = protocol.indexOf("export interface AgentApi");
  const body = protocol.slice(start, protocol.indexOf("\n}", start));
  const starts = [...body.matchAll(/^\s{2}(\w+)\??\s*[(<]/gm)];
  const members = starts.map((m, i) => ({ name: m[1], isArray: /Promise<[^>]*\[\]/.test(body.slice(m.index, starts[i + 1]?.index ?? body.length)) }));
  const win = new BrowserWindow({
    width: 1440, height: 900, show: false,
    webPreferences: {
      backgroundThrottling: false,
      preload: join(__dirname, "ui-gallery-preload.cjs"),
      additionalArguments: ["--cairn-api-members=" + JSON.stringify(members), "--cairn-protocol-version=" + version],
    },
  });
  const errors = [];
  win.webContents.on("console-message", (d) => { if (d.level === "error") { errors.push(d.message); console.error("renderer:", d.message); } });
  const js = (s) => win.webContents.executeJavaScript(s);
  const pause = (ms = 250) => new Promise((r) => setTimeout(r, ms));
  const checks = [];
  const check = (name, ok, detail) => { checks.push({ name, ok: ok === true, detail }); console.log(`${ok === true ? "PASS" : "FAIL"} ${name} ${JSON.stringify(detail)}`); };
  async function waitFor(predicate, label, timeout = 15000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) { if (await predicate()) return true; await pause(80); }
    throw new Error("Timeout: " + label);
  }
  const pointerOn = async (findExpr) => {
    const point = await js(`(() => { const el = ${findExpr}; if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    if (point === null) return false;
    win.webContents.sendInputEvent({ type: "mouseDown", ...point, button: "left", clickCount: 1 });
    win.webContents.sendInputEvent({ type: "mouseUp", ...point, button: "left", clickCount: 1 });
    await pause(300);
    return true;
  };

  await win.loadFile(join(__dirname, "../dist/index.html"));
  await pause(1400);
  await win.webContents.focus();
  win.webContents.sendInputEvent({ type: "keyDown", keyCode: ",", modifiers: ["meta"] });
  win.webContents.sendInputEvent({ type: "keyUp", keyCode: ",", modifiers: ["meta"] });
  await waitFor(() => js(`!!document.querySelector('.sp-nav')`), "settings panel");
  check("真指针进「关于与更新」", await pointerOn(`[...document.querySelectorAll('.sp-nav-item')].find((el) => el.textContent.includes('关于与更新'))`), null);
  const before = await js(`document.querySelector('.sp-body')?.innerText ?? ''`);
  check("导出/导入偏好按钮在屏上", before.includes("导出偏好…") && before.includes("导入偏好…"), null);
  check("真指针点「导出偏好…」", await pointerOn(`[...document.querySelectorAll('.sp-body button')].find((b) => b.textContent.trim() === '导出偏好…')`), null);
  await waitFor(() => js(`document.querySelector('.sp-body')?.innerText.includes('已保存：/tmp/cairn-preferences.json')`), "export receipt");
  check("导出回执带保存路径", true, null);
  const beforeSize = await js(`window.agent.getSettings().then((s) => s.textSize)`);
  check("导入前字号不是 lg（夹具初值）", beforeSize !== "lg", beforeSize);
  check("真指针点「导入偏好…」", await pointerOn(`[...document.querySelectorAll('.sp-body button')].find((b) => b.textContent.trim() === '导入偏好…')`), null);
  await waitFor(() => js(`document.querySelector('.confirm-card')?.innerText.includes('导入偏好？')`), "import confirm");
  check("导入先出确认卡（列出覆盖项）", await js(`document.querySelector('.confirm-card')?.innerText.includes('textSize')`), null);
  writeFileSync(join(out, "01-import-preview.png"), (await win.webContents.capturePage()).toPNG());
  check("真指针点「应用」", await pointerOn(`[...document.querySelectorAll('.confirm-card button')].find((b) => b.textContent.trim() === '应用')`), null);
  await waitFor(() => js(`document.querySelector('.sp-body')?.innerText.includes('已导入 1 项偏好')`), "import receipt");
  const afterSize = await js(`window.agent.getSettings().then((s) => s.textSize)`);
  check("导入回执上屏且设置真的变了（textSize=lg）", afterSize === "lg", afterSize);
  writeFileSync(join(out, "02-after-import.png"), (await win.webContents.capturePage()).toPNG());
  // 第 816 页：恢复默认要二次确认，确认后设置真的回默认（textSize=md）。
  check("真指针点「恢复默认…」", await pointerOn(`[...document.querySelectorAll('.sp-body button')].find((b) => b.textContent.trim() === '恢复默认…')`), null);
  await waitFor(() => js(`document.querySelector('.confirm-card')?.innerText.includes('恢复默认偏好？')`), "reset confirm");
  check("恢复默认先出确认卡", await js(`document.querySelector('.confirm-card')?.innerText.includes('模型、项目路径')`), null);
  check("真指针点「恢复默认」", await pointerOn(`[...document.querySelectorAll('.confirm-card button')].find((b) => b.textContent.trim() === '恢复默认')`), null);
  await waitFor(() => js(`document.querySelector('.sp-body')?.innerText.includes('已恢复默认偏好')`), "reset receipt");
  const resetSize = await js(`window.agent.getSettings().then((s) => s.textSize)`);
  check("恢复回执上屏且设置回默认（textSize=md）", resetSize === "md", resetSize);
  writeFileSync(join(out, "03-after-reset.png"), (await win.webContents.capturePage()).toPNG());
  check("全程无渲染层控制台错误", errors.length === 0, errors);

  writeFileSync(join(out, "checks.json"), JSON.stringify({ fixtureData: true, checks, errors }, null, 2));
  const passed = checks.filter((c) => c.ok).length;
  console.log(`[preferences-backup-smoke] ${passed}/${checks.length} PASS\nEvidence: ${out}`);
  app.exit(passed === checks.length ? 0 : 1);
}
const watchdog = setTimeout(() => { console.error("preferences-backup-smoke: 超时"); app.exit(1); }, 60_000);
watchdog.unref();
main().catch((err) => { console.error(err); app.exit(2); });
