// 同名会话：插话等待期间切项目，失败回包只能入原项目队列；循环快捷键保留 workspace。
const { app, BrowserWindow } = require("electron");
const { scheduleProfileCleanup } = require("./lib/profile-cleanup.cjs");
const { mkdtempSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const profile = mkdtempSync(join(tmpdir(), "cairn-queue-target-profile-"));
const out = resolve(process.argv[2] || mkdtempSync(join(tmpdir(), "cairn-queue-target-")));
mkdirSync(out, { recursive: true }); app.setPath("userData", profile);
app.on("quit", () => scheduleProfileCleanup(profile));
const checks = [];
const checkControls = process.argv.includes("--check-controls");
const check = (name, ok) => { checks.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"} ${name}`); };
const pause = () => new Promise((r) => setTimeout(r, 90));
async function main() {
  await app.whenReady();
  const protocol = readFileSync(join(__dirname, "../../../src/main/ipc-protocol.ts"), "utf8");
  const tail = protocol.slice(protocol.indexOf("export interface AgentApi"));
  const body = tail.slice(0, tail.indexOf("\n}")); const starts = [...body.matchAll(/^\s{2}(\w+)\??\s*[(<]/gm)];
  const members = starts.map((s, i) => ({ name: s[1], isArray: /Promise<[^>]*\[\]/.test(body.slice(s.index, starts[i + 1]?.index)) }));
  const win = new BrowserWindow({ width: 1280, height: 820, show: false, webPreferences: {
    preload: join(__dirname, "ui-gallery-preload.cjs"), additionalArguments: ["--cairn-api-members=" + JSON.stringify(members), "--cairn-protocol-version=" + protocol.match(/IPC_PROTOCOL_VERSION\s*=\s*(\d+)/)[1], "--cairn-same-id-workspace-fixture", "--cairn-steer-switch-fixture", ...(checkControls ? ["--cairn-control-rejection-fixture"] : [])],
  } });
  const errors = [];
  win.webContents.on("console-message", (details) => { if (details.level === "error") errors.push(details.message); });
  win.webContents.on("preload-error", (_event, _path, error) => errors.push(error.message));
  const js = (source) => win.webContents.executeJavaScript(source);
  async function wait(source) { for (let i = 0; i < 100; i++) { if (await js(source)) return; await pause(); } throw new Error("等待超时: " + source); }
  const openProject = async (label) => {
    await js(`([...document.querySelectorAll('.s-title')].find(e => e.textContent.includes('${label}'))).closest('.session').click();true;`);
    await wait(`document.querySelector('.row.user')?.textContent.includes('${label === "项目甲" ? "甲" : "乙"}项目的消息') && !document.querySelector('.composer-card textarea').disabled`);
  };
  const shot = async (name) => {
    await new Promise((resolve) => setTimeout(resolve, 350)); // 等现有切换动画完成再留图。
    writeFileSync(join(out, name + ".png"), (await win.webContents.capturePage()).toPNG());
  };
  await win.loadFile(join(process.env.CAIRN_RENDERER_DIST || join(__dirname, "../dist"), "index.html")); win.show(); win.focus();
  await wait("document.querySelectorAll('.session[data-session-id=\"dup\"]').length === 2");
  await openProject("项目甲");
  await js("(() => {const t=document.querySelector('.composer-card textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,'必须留在甲的消息');t.dispatchEvent(new Event('input',{bubbles:true}));t.focus();})()");
  win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Return" }); win.webContents.sendInputEvent({ type: "char", keyCode: "\r" }); win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Return" });
  await wait("window.__cairnSteerSwitch.count() === 1");
  if (checkControls) check("插话 IPC 显式携带原目标工作区", await js("window.__cairnSteerSwitch.calls().steers[0].workspace === '/tmp/demo-ws'"));
  await openProject("项目乙");
  await js("window.__cairnSteerSwitch.finish(0)");
  await wait("window.__cairnSameId.calls().queueSet.length > 0");
  check("迟到的插话失败只写原项目甲的队列", await js("window.__cairnSameId.calls().queueSet.every(c => c.sessionId === 'dup' && c.workspace === '/tmp/demo-ws')"));
  check("乙项目持久队列没有混入甲的消息", await js("JSON.stringify(window.__cairnSteerSwitch.queues()['/tmp/demo-ws-other|dup']) === JSON.stringify([{text:'乙项目排队的那条',attachments:[]}])"));
  check("乙项目当前界面没有混入甲的待发送消息", await js("!document.querySelector('.queue-strip').textContent.includes('必须留在甲的消息')"));
  await shot("01-current-project-b");
  await openProject("项目甲");
  check("回到甲项目能读回原队列和刚才的消息", await js("document.querySelector('.queue-strip').textContent.includes('甲项目排队的那条') && document.querySelector('.queue-strip').textContent.includes('必须留在甲的消息')"));
  await shot("02-origin-project-a");
  if (checkControls) {
    await js("document.querySelector('.send-btn.stop').click();true;");
    await wait("window.__cairnSteerSwitch.calls().cancels.length === 1 && document.body.innerText.includes('目标工作区不匹配，请重新打开会话')");
    check("停止 IPC 显式携带目标工作区", await js("window.__cairnSteerSwitch.calls().cancels[0].workspace === '/tmp/demo-ws'"));
    check("停止被拒绝后保留全部待发送消息且不自动出队", await js("window.__cairnSameId.calls().queueSet.length === 1 && document.querySelectorAll('.queue-strip .queue-item').length === 2 && window.__cairnSteerSwitch.runs() === 0"));
    check("停止拒绝的原因在当前工作台可见", await js("document.body.innerText.includes('目标工作区不匹配，请重新打开会话')"));
    await shot("03-cancel-rejected");
  }
  await js("document.querySelector('.sidenav .session[aria-current=\"true\"]').focus();true;");
  const before = await js("window.__cairnSameId.calls().open.length");
  win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Tab", modifiers: ["control"] }); win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Tab", modifiers: ["control"] });
  await wait(`window.__cairnSameId.calls().open.length > ${before}`); await pause();
  check("Ctrl+Tab 把同名会话切到项目乙并显式传 workspace", await js("window.__cairnSameId.calls().open.at(-1).workspace === '/tmp/demo-ws-other' && document.querySelector('.row.user')?.textContent.includes('乙项目的消息')"));
  check("同名会话只标记一个当前项", await js("document.querySelectorAll('.sidenav .session[aria-current=\"true\"]').length === 1"));
  check("本次验证未启动额外任务", await js("window.__cairnSteerSwitch.runs() === 0"));
  check("无 renderer/preload 错误", errors.length === 0);
  writeFileSync(join(out, "result.json"), JSON.stringify({ checks, errors, calls: await js("window.__cairnSameId.calls()"), controls: await js("window.__cairnSteerSwitch.calls()") }, null, 2));
  win.destroy(); app.exit(checks.every(c => c.ok) ? 0 : 1);
}
const watchdog = setTimeout(() => { console.error("smoke 超时"); app.exit(1); }, 45000); watchdog.unref();
main().catch(error => { console.error(error); app.exit(1); });
