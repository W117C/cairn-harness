// 完成通知开关的真实 renderer 冒烟（2026-10-30，第 787 页）。
// 缺陷形态：通知此前恒发（只判窗口失焦），设置页没有开关——用户不想被打扰只能忍。
// 本冒烟判三面：通用段有这枚开关（缺省开）；真指针点一下 → aria 翻面 + setSettings 收到
// {notifyOnComplete:false}；再点回来恢复。
// 运行：env -u ELECTRON_RUN_AS_NODE pnpm --filter cairn-desktop exec electron
//   scripts/notify-toggle-smoke.cjs [输出目录]   （前置：pnpm --filter cairn-desktop build）
const { app, BrowserWindow, nativeTheme } = require("electron");
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");

const profile = mkdtempSync(join(tmpdir(), "cairn-notify-toggle-profile-"));
app.setPath("userData", profile);
nativeTheme.themeSource = "light";
app.on("quit", () => { rmSync(profile, { recursive: true, force: true }); });
const out = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), "cairn-notify-toggle-"));
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
  const notifySwitch = `[...document.querySelectorAll('button[role="switch"]')].find((el) => el.getAttribute('aria-label') === '任务完成时通知')`;
  const switchState = () => js(`(() => { const el = ${notifySwitch}; return el === undefined ? null : el.getAttribute('aria-checked'); })()`);

  await win.loadFile(join(__dirname, "../dist/index.html"));
  await pause(1400);
  await win.webContents.focus();
  win.webContents.sendInputEvent({ type: "keyDown", keyCode: ",", modifiers: ["meta"] });
  win.webContents.sendInputEvent({ type: "keyUp", keyCode: ",", modifiers: ["meta"] });
  await waitFor(() => js(`!!document.querySelector('.sp-nav')`), "settings panel");

  check("通用段有「任务完成时通知」开关", (await switchState()) !== null, null);
  check("缺省开（与既有行为一致：默认就会通知）", (await switchState()) === "true", await switchState());
  await js(`document.querySelector('.sp-body')?.scrollTo?.(0, 0)`);
  await pointerOn(notifySwitch);
  check("真指针点一下 ⇒ aria-checked=false", (await switchState()) === "false", await switchState());
  const calls = await js(`window.__cairnSettingsCalls().filter((p) => p.notifyOnComplete !== undefined)`);
  check("落盘补丁是 {notifyOnComplete:false}", calls.length === 1 && calls[0].notifyOnComplete === false, calls);
  writeFileSync(join(out, "01-notify-off.png"), (await win.webContents.capturePage()).toPNG());
  await pointerOn(notifySwitch);
  check("再点回来 ⇒ 恢复开", (await switchState()) === "true", await switchState());
  check("全程无渲染层控制台错误", errors.length === 0, errors);

  writeFileSync(join(out, "checks.json"), JSON.stringify({ fixtureData: true, checks, errors }, null, 2));
  const passed = checks.filter((c) => c.ok).length;
  console.log(`[notify-toggle-smoke] ${passed}/${checks.length} PASS\nEvidence: ${out}`);
  app.exit(passed === checks.length ? 0 : 1);
}
const watchdog = setTimeout(() => { console.error("notify-toggle-smoke: 超时"); app.exit(1); }, 60_000);
watchdog.unref();
main().catch((err) => { console.error(err); app.exit(2); });
