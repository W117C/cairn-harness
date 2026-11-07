// 设置页「关闭前提交」真实 renderer 冒烟（2026-10-30，第 790 页）。
// 缺陷形态（真机实测）：数字/文本输入失焦才保存；输入框还聚焦时按 Esc 关设置，
// 面板卸载不触发 onBlur ⇒ 编辑值悄悄丢失（「返回」按钮因为焦点转移反而会保存）。
// 修法：关闭路径先把面板内的焦点元素 blur()（同步触发 onBlur）再关。
// 判两路：Esc 与「返回」都要落盘；面板都要关。
// 运行：env -u ELECTRON_RUN_AS_NODE pnpm --filter cairn-desktop exec electron
//   scripts/settings-esc-commit-smoke.cjs [输出目录]   （前置：pnpm --filter cairn-desktop build）
const { app, BrowserWindow, nativeTheme } = require("electron");
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");

const profile = mkdtempSync(join(tmpdir(), "cairn-esc-commit-profile-"));
app.setPath("userData", profile);
nativeTheme.themeSource = "light";
app.on("quit", () => { rmSync(profile, { recursive: true, force: true }); });
const out = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), "cairn-esc-commit-"));
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
  const openSettings = async () => {
    await win.webContents.focus();
    win.webContents.sendInputEvent({ type: "keyDown", keyCode: ",", modifiers: ["meta"] });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode: ",", modifiers: ["meta"] });
    await waitFor(() => js(`!!document.querySelector('.sp-nav')`), "settings panel");
    await pointerOn(`[...document.querySelectorAll('.sp-nav-item')].find((el) => el.textContent.includes('高级'))`);
    await waitFor(() => js(`!!document.querySelector('input[aria-label="同时运行的定时会话上限"]')`), "cap input");
  };
  const capInput = `document.querySelector('input[aria-label="同时运行的定时会话上限"]')`;
  /** 设值但**不失焦**（模拟用户正在编辑；与真键入等价的产品状态）。 */
  const setCapDraft = async (value) => {
    await js(`(() => { const el = ${capInput}; el.focus(); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    return await js(`document.activeElement === ${capInput} && ${capInput}.value`);
  };
  const capCalls = () => js(`window.__cairnSettingsCalls().filter((p) => p.scheduleConcurrencyCap !== undefined).map((p) => p.scheduleConcurrencyCap)`);

  await win.loadFile(process.env.CAIRN_RENDERER_ENTRY ?? join(__dirname, "../dist/index.html"));
  await pause(1400);

  await openSettings();
  check("输入框拿到焦点且草稿在框里（尚未失焦）", (await setCapDraft("6")) === "6", await capCalls());
  win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
  win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
  await pause(400);
  check("Esc 关闭后面板真的关了", await js(`!document.querySelector('.sp-nav')`), null);
  check("Esc 关闭前提交了草稿（6 落盘，不是丢掉）", (await capCalls()).at(-1) === 6, await capCalls());

  await openSettings();
  check("重开后输入框显示盘上值 6", (await js(`${capInput}?.value ?? null`)) === "6", await js(`${capInput}?.value ?? null`));
  check("第二次拿到焦点且草稿为 7", (await setCapDraft("7")) === "7", null);
  await pointerOn(`document.querySelector('.sp-back')`);
  await pause(400);
  check("「返回」关闭同样落盘（7）", (await capCalls()).at(-1) === 7, await capCalls());
  writeFileSync(join(out, "01-after-esc.png"), (await win.webContents.capturePage()).toPNG());
  check("全程无渲染层控制台错误", errors.length === 0, errors);

  writeFileSync(join(out, "checks.json"), JSON.stringify({ fixtureData: true, checks, errors }, null, 2));
  const passed = checks.filter((c) => c.ok).length;
  console.log(`[settings-esc-commit-smoke] ${passed}/${checks.length} PASS\nEvidence: ${out}`);
  app.exit(passed === checks.length ? 0 : 1);
}
const watchdog = setTimeout(() => { console.error("settings-esc-commit-smoke: 超时"); app.exit(1); }, 60_000);
watchdog.unref();
main().catch((err) => { console.error(err); app.exit(2); });
