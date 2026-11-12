// 对话框回车提交真实 renderer 冒烟（2026-10-30，第 794 页）。
// 缺陷形态：新建项目 / 项目设置两个模态只有按钮提交，名字输入框里按回车没反应（内联改名却支持回车）。
// 判两路：① 项目设置：改显示名 → 回车 → 面板关 + addProject 收到新名字；
//         ② 新建项目：空名回车 ⇒ 错误留在面板内；填名回车 ⇒ createProject 收到名字 + 面板关。
// 运行：env -u ELECTRON_RUN_AS_NODE pnpm --filter cairn-desktop exec electron
//   scripts/dialogs-enter-smoke.cjs [输出目录]   （前置：pnpm --filter cairn-desktop build）
const { app, BrowserWindow, nativeTheme } = require("electron");
const { scheduleProfileCleanup } = require("./lib/profile-cleanup.cjs");
const { mkdirSync, mkdtempSync, readFileSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");

const profile = mkdtempSync(join(tmpdir(), "cairn-dialogs-enter-profile-"));
app.setPath("userData", profile);
nativeTheme.themeSource = "light";
app.on("quit", () => scheduleProfileCleanup(profile));
const out = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), "cairn-dialogs-enter-"));
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
  const pressEnter = async () => {
    win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Return" });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Return" });
    await pause(350);
  };
  const setInput = async (label, value) => {
    await js(`(() => { const el = document.querySelector('input[aria-label="' + ${JSON.stringify(label)} + '"]'); el.focus(); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    return await js(`document.querySelector('input[aria-label="' + ${JSON.stringify(label)} + '"]')?.value ?? null`);
  };
  /** 组字途中的回车：事件带 isComposing:true，应用不许消费（否则正在写的字被当成确认）。 */
  const composingEnter = async (label) => {
    await js(`(() => { const el = document.querySelector('input[aria-label="' + ${JSON.stringify(label)} + '"]'); el.focus(); el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true, isComposing: true })); })()`);
    await pause(300);
  };
  const projectCalls = () => js(`window.__cairnProjectCalls()`);

  await win.loadFile(process.env.CAIRN_RENDERER_ENTRY ?? join(__dirname, "../dist/index.html"));
  await pause(1400);
  await waitFor(() => js(`!!document.querySelector('.group-head')`), "project group");

  // ① 项目设置：上下文菜单 → 项目设置… → 改名 → 回车
  await js(`document.querySelector('.group-head').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 160 }))`);
  await waitFor(() => js(`!!document.querySelector('.ctx-menu')`), "project context menu");
  check("真指针点「项目设置…」", await pointerOn(`[...document.querySelectorAll('.ctx-menu .menu-item')].find((el) => el.textContent.includes('项目设置'))`), null);
  await waitFor(() => js(`!!document.querySelector('.modal-card[aria-label="项目设置"]')`), "project settings dialog");
  check("显示名输入框写入草稿", (await setInput("显示名", "回车改名")) === "回车改名", null);
  await composingEnter("显示名");
  check("组字中的回车不提交（面板还在、名字没发出去）", await js(`!!document.querySelector('.modal-card[aria-label="项目设置"]')`) && (await projectCalls()).filter((c) => c.kind === "addProject").every((c) => c.input?.name !== "回车改名"), await projectCalls());
  await pressEnter();
  await waitFor(() => js(`!document.querySelector('.modal-card[aria-label="项目设置"]')`), "project settings closed by Enter");
  const settingsCall = (await projectCalls()).filter((c) => c.kind === "addProject").at(-1);
  check("回车提交：addProject 收到新显示名并关面板", settingsCall?.input?.name === "回车改名", settingsCall);

  // ② 新建项目：命令面板 → 添加项目 → 空名回车（错误留在面板）→ 填名回车（创建 + 关面板）
  await win.webContents.focus();
  win.webContents.sendInputEvent({ type: "keyDown", keyCode: "K", modifiers: ["meta"] });
  win.webContents.sendInputEvent({ type: "keyUp", keyCode: "K", modifiers: ["meta"] });
  await waitFor(() => js(`!!document.querySelector('.cp-panel')`), "palette");
  win.webContents.insertText("添加项目");
  await pause(200);
  await pressEnter();
  await waitFor(() => js(`!!document.querySelector('.modal-card[aria-label="新建项目"]')`), "new project dialog");
  await waitFor(() => js(`document.querySelectorAll('.tpl-card').length > 0`), "template cards");
  await pressEnter();
  const emptyErr = await js(`document.querySelector('.modal-card[aria-label="新建项目"] .form-error')?.textContent ?? ''`);
  check("空名回车 ⇒ 错误留在面板内（不关、不建）", emptyErr.includes("请先起一个项目名") && await js(`!!document.querySelector('.modal-card[aria-label="新建项目"]')`), emptyErr);
  check("项目名输入框写入草稿", (await setInput("项目名", "回车验收")) === "回车验收", null);
  await composingEnter("项目名");
  check("组字中的回车不建项目（对话框还在、没发 createProject）", await js(`!!document.querySelector('.modal-card[aria-label="新建项目"]')`) && (await projectCalls()).every((c) => c.kind !== "createProject"), await projectCalls());
  await pressEnter();
  await waitFor(() => js(`!document.querySelector('.modal-card[aria-label="新建项目"]')`), "new project closed by Enter");
  const createCall = (await projectCalls()).filter((c) => c.kind === "createProject").at(-1);
  check("回车提交：createProject 收到项目名并关面板", createCall?.input?.name === "回车验收", createCall);
  writeFileSync(join(out, "01-after-enter.png"), (await win.webContents.capturePage()).toPNG());
  check("全程无渲染层控制台错误", errors.length === 0, errors);

  writeFileSync(join(out, "checks.json"), JSON.stringify({ fixtureData: true, checks, errors, calls: await projectCalls() }, null, 2));
  const passed = checks.filter((c) => c.ok).length;
  console.log(`[dialogs-enter-smoke] ${passed}/${checks.length} PASS\nEvidence: ${out}`);
  app.exit(passed === checks.length ? 0 : 1);
}
const watchdog = setTimeout(() => { console.error("dialogs-enter-smoke: 超时"); app.exit(1); }, 60_000);
watchdog.unref();
main().catch((err) => { console.error(err); app.exit(2); });
