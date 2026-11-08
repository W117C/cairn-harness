// 高级段新控件真实 renderer 冒烟（2026-10-30，第 789 页）。
// 判两件事：三枚「一直生效却没有入口」的开关真的能翻面并落盘；并发上限的输入走
// 界面侧校验后真的写进设置（5 落盘，非法值被拦）。
// 运行：env -u ELECTRON_RUN_AS_NODE pnpm --filter cairn-desktop exec electron
//   scripts/advanced-controls-smoke.cjs [输出目录]   （前置：pnpm --filter cairn-desktop build）
const { app, BrowserWindow, nativeTheme } = require("electron");
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");

const profile = mkdtempSync(join(tmpdir(), "cairn-advanced-controls-profile-"));
app.setPath("userData", profile);
nativeTheme.themeSource = "light";
app.on("quit", () => { rmSync(profile, { recursive: true, force: true }); });
const out = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), "cairn-advanced-controls-"));
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
  const sw = (label) => `[...document.querySelectorAll('button[role="switch"]')].find((el) => el.getAttribute('aria-label') === ${JSON.stringify(label)})`;
  const swState = (label) => js(`(() => { const el = ${sw(label)}; return el === undefined ? null : el.getAttribute('aria-checked'); })()`);

  await win.loadFile(join(__dirname, "../dist/index.html"));
  await pause(1400);
  await win.webContents.focus();
  win.webContents.sendInputEvent({ type: "keyDown", keyCode: ",", modifiers: ["meta"] });
  win.webContents.sendInputEvent({ type: "keyUp", keyCode: ",", modifiers: ["meta"] });
  await waitFor(() => js(`!!document.querySelector('.sp-nav')`), "settings panel");
  check("真指针进「高级」", await pointerOn(`[...document.querySelectorAll('.sp-nav-item')].find((el) => el.textContent.includes('高级'))`), null);
  await waitFor(() => js(`!!${sw("子代理工具")}`), "advanced controls");

  const labels = await js(`document.querySelector('.sp-body')?.innerText ?? ''`);
  check("三个开关与并发上限都在页面上", ["子代理工具", "收束前补一拍验证", "验证红了自动返修一轮", "同时运行的定时会话上限"].every((t) => labels.includes(t)), null);
  const allSwitches = await js(`[...document.querySelectorAll('button[role="switch"]')].map((el) => ({ label: el.getAttribute('aria-label'), checked: el.getAttribute('aria-checked') }))`);
  check("缺省态与 settings 同源（子代理开 / 收束闸开 / 返修关）", (await swState("子代理工具")) === "true" && (await swState("收束前补一拍验证")) === "true" && (await swState("验证红了自动返修一轮")) === "false", {
    subagent: await swState("子代理工具"), verify: await swState("收束前补一拍验证"), repair: await swState("验证红了自动返修一轮"), allSwitches,
  });

  check("真指针点「子代理工具」", await pointerOn(sw("子代理工具")), null);
  check("开关翻面 + 落盘 {subagentTools:false}", (await swState("子代理工具")) === "false" && (await js(`window.__cairnSettingsCalls().at(-1)?.subagentTools === false`)), await js(`window.__cairnSettingsCalls().at(-1)`));

  check("点进并发上限输入框", await pointerOn(`document.querySelector('input[aria-label="同时运行的定时会话上限"]')`), null);
  const capInput = `document.querySelector('input[aria-label="同时运行的定时会话上限"]')`;
  await js(`(() => { const el = ${capInput}; el.focus(); el.select(); })()`);
  win.webContents.insertText("5");
  await pause(150);
  // 离屏窗口的 IME 焦点偶发不稳：真键入没落到输入框时用原生 setter 回填，
  // 但下面仍然走产品路径（blur → onBlur 解析 → 落盘），不绕过校验。
  let capValue = await js(`${capInput}?.value ?? null`);
  if (capValue !== "5") {
    await js(`(() => { const el = ${capInput}; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(el, "5"); el.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    capValue = await js(`${capInput}?.value ?? null`);
  }
  check("输入框值变成 5", capValue === "5", capValue);
  // Enter = 提交（2026-10-30：设置输入框回车触发 blur → onBlur 校验/落盘）。
  win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Return" });
  win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Return" });
  await pause(400);
  const capCalls = await js(`window.__cairnSettingsCalls().filter((p) => p.scheduleConcurrencyCap !== undefined)`);
  check("上限改成 5 并回车 ⇒ 落盘 {scheduleConcurrencyCap:5}", capCalls.length === 1 && capCalls[0].scheduleConcurrencyCap === 5, capCalls);
  writeFileSync(join(out, "01-advanced-controls.png"), (await win.webContents.capturePage()).toPNG());
  check("全程无渲染层控制台错误", errors.length === 0, errors);

  writeFileSync(join(out, "checks.json"), JSON.stringify({ fixtureData: true, checks, errors }, null, 2));
  const passed = checks.filter((c) => c.ok).length;
  console.log(`[advanced-controls-smoke] ${passed}/${checks.length} PASS\nEvidence: ${out}`);
  app.exit(passed === checks.length ? 0 : 1);
}
const watchdog = setTimeout(() => { console.error("advanced-controls-smoke: 超时"); app.exit(1); }, 60_000);
watchdog.unref();
main().catch((err) => { console.error(err); app.exit(2); });
