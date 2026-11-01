// 真实 renderer + 可控 IPC：落盘失败/项目切换/显式重试/续发/接收拒绝，不调用真实 Provider。
const { app, BrowserWindow } = require("electron");
const { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const profile = mkdtempSync(join(tmpdir(), "cairn-queue-save-"));
const out = resolve(process.argv[2]); mkdirSync(out, { recursive: true });
app.setPath("userData", profile); app.on("quit", () => rmSync(profile, { recursive: true, force: true }));
const checks = [];
const check = (name, ok) => { checks.push({ name, ok: Boolean(ok) }); console.log(`${ok ? "PASS" : "FAIL"} ${name}`); };
const pause = (ms = 90) => new Promise((r) => setTimeout(r, ms));
async function main() {
  await app.whenReady();
  const protocol = readFileSync(join(__dirname, "../../../src/main/ipc-protocol.ts"), "utf8");
  const tail = protocol.slice(protocol.indexOf("export interface AgentApi")), body = tail.slice(0, tail.indexOf("\n}"));
  const starts = [...body.matchAll(/^\s{2}(\w+)\??\s*[(<]/gm)];
  const members = starts.map((s, i) => ({ name: s[1], isArray: /Promise<[^>]*\[\]/.test(body.slice(s.index, starts[i + 1]?.index)) }));
  const win = new BrowserWindow({ width: 1280, height: 820, show: false, webPreferences: {
    preload: join(__dirname, "ui-gallery-preload.cjs"), additionalArguments: ["--cairn-api-members=" + JSON.stringify(members), "--cairn-protocol-version=" + (process.env.CAIRN_EXPECT_PROTOCOL || protocol.match(/IPC_PROTOCOL_VERSION\s*=\s*(\d+)/)[1]), "--cairn-same-id-workspace-fixture", "--cairn-queue-persistence-fixture"],
  } });
  const errors = [];
  win.webContents.on("console-message", (details) => { if (details.level === "error") errors.push(details.message); });
  win.webContents.on("preload-error", (_event, _path, error) => errors.push(error.message));
  const js = (source) => win.webContents.executeJavaScript(source);
  async function wait(source) { for (let i = 0; i < 100; i++) { if (await js(source)) return; await pause(); } throw new Error("等待超时: " + source); }
  const state = () => js("window.__cairnQueuePersistence.calls()");
  const write = async (index, ok) => { await js(`window.__cairnQueuePersistence.write(${index}, ${ok})`); await pause(); };
  const shot = async (name) => { await pause(350); writeFileSync(join(out, name + ".png"), (await win.webContents.capturePage()).toPNG()); };
  const finish = async () => {
    writeFileSync(join(out, "result.json"), JSON.stringify({ checks, errors, calls: await state() }, null, 2));
    win.destroy(); app.exit(checks.every(c => c.ok) && errors.length === 0 ? 0 : 1);
  };
  const open = async (label) => {
    await js(`([...document.querySelectorAll('.s-title')].find(e => e.textContent.includes('${label}'))).closest('.session').click();true;`);
    await wait(`document.querySelector('.row.user')?.textContent.includes('${label === "项目甲" ? "甲" : "乙"}项目的消息') && !document.querySelector('.composer-card textarea').disabled`);
  };
  const pressEnter = () => {
    win.focus();
    win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Return" });
    win.webContents.sendInputEvent({ type: "char", keyCode: "\r" });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Return" });
  };
  await win.loadFile(join(process.env.CAIRN_RENDERER_DIST, "index.html")); win.show(); win.focus();
  await wait("document.querySelectorAll('.session').length === 2"); await open("项目甲");
  await js("document.querySelector('.queue-resume').click();true;");
  await wait("window.__cairnQueuePersistence.calls().writes.length === 1");
  check("保存确认前没有启动任务", (await state()).runs.length === 0);
  check("待保存期间显示状态且不能重复恢复", await js("document.querySelector('.queue-strip')?.textContent.includes('正在保存') && !document.querySelector('.queue-resume:not(:disabled)')"));
  await shot("01-saving"); await write(0, false);
  check("出队保存失败恢复原消息且没有运行", await js("document.querySelector('.queue-strip')?.textContent.includes('甲项目排队的那条')") && (await state()).runs.length === 0);
  if (checks.some(c => !c.ok)) { await finish(); return; } // 改前在这里明确失败，不按错误状态继续驱动后续步骤。
  await js("document.querySelector('.queue-item button[aria-label^=\"编辑排队项\"]').click();true;");
  await js("(() => {const t=document.querySelector('.q-edit');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(t,'修改后保留的消息');t.dispatchEvent(new Event('input',{bubbles:true}));t.focus();})()"); pressEnter();
  await wait("window.__cairnQueuePersistence.calls().writes.length === 2"); await write(1, false);
  await open("项目乙"); await open("项目甲");
  check("保存失败后切换项目不会被旧磁盘消息覆盖", await js("document.querySelector('.queue-strip').textContent.includes('修改后保留的消息')"));
  await shot("02-unsaved-after-switch");
  for (const theme of ["light", "dark"]) {
    win.setSize(theme === "dark" ? 880 : 1280, 820);
    await js(`document.documentElement.dataset.theme='${theme}';document.documentElement.dataset.mode='${theme}';document.body.toggleAttribute('data-ds-dark-theme','${theme}'==='dark');true;`); await pause();
    const colors = await js("(() => { const button=document.querySelector('.queue-retry'), backgrounds=[],canvas=document.createElement('canvas');canvas.width=canvas.height=1;const context=canvas.getContext('2d',{willReadFrequently:true}); const rgba=value=>{context.clearRect(0,0,1,1);context.fillStyle=value;context.fillRect(0,0,1,1);const pixel=context.getImageData(0,0,1,1).data;return [pixel[0],pixel[1],pixel[2],pixel[3]/255];}; for(let parent=button;parent;parent=parent.parentElement) backgrounds.push(rgba(getComputedStyle(parent).backgroundColor)); return {fg:rgba(getComputedStyle(button).color),backgrounds};})()");
    const over = (color, background) => color.slice(0,3).map((v,i) => v*color[3] + background[i]*(1-color[3]));
    const background = colors.backgrounds.slice().reverse().reduce((base, color) => over(color, base), [255,255,255]);
    const luminance = (value) => value.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
    const a = luminance(over(colors.fg, background)), b = luminance(background), contrast = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
    check(`${theme} 重试保存按钮对比度至少 4.5`, contrast >= 4.5); console.log(`contrast ${theme}: ${contrast.toFixed(2)}`);
    if (theme === "dark") {
      check("窄窗口队列与重试入口没有横向溢出", await js("document.querySelector('.queue-strip').scrollWidth <= document.querySelector('.queue-strip').clientWidth + 1 && document.documentElement.scrollWidth <= innerWidth"));
      await shot("02-unsaved-dark");
    }
  }
  win.setSize(1280, 820);
  await js("document.documentElement.dataset.theme='light';document.documentElement.dataset.mode='light';document.body.removeAttribute('data-ds-dark-theme');true;");
  await js("document.querySelector('.queue-retry').click();true;");
  await wait("window.__cairnQueuePersistence.calls().writes.length === 3");
  check("重试保存期间仍没有派发任务", (await state()).runs.length === 0);
  await write(2, true); await wait("!document.querySelector('.queue-retry')");
  check("重试保存提交的是本窗口修改后的消息", (await state()).writes[2].items[0].text === "修改后保留的消息");
  await js("document.querySelector('.queue-resume').click();true;");
  await wait("window.__cairnQueuePersistence.calls().writes.length === 4"); await write(3, true);
  await wait("window.__cairnQueuePersistence.calls().runs.length === 1");
  check("落盘确认后只执行一次正确的队首", (await state()).runs[0].message === "修改后保留的消息");
  await js("(() => {const t=document.querySelector('.composer-card textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,'后续排队消息');t.dispatchEvent(new Event('input',{bubbles:true}));t.focus();})()"); pressEnter();
  await wait("window.__cairnQueuePersistence.calls().writes.length === 5"); await write(4, true);
  await js("window.__cairnQueuePersistence.run(0,{ok:true,accepted:true})");
  await wait("window.__cairnQueuePersistence.calls().writes.length === 6");
  check("自动续发也等待出队保存确认", (await state()).runs.length === 1);
  await write(5, true); await wait("window.__cairnQueuePersistence.calls().runs.length === 2");
  await js("window.__cairnQueuePersistence.run(1,{ok:false,accepted:false,error:'请求未接收'})");
  await wait("window.__cairnQueuePersistence.calls().writes.length === 7"); await write(6, true);
  check("主进程明确未接收时恢复队列，等待用户继续", await js("document.querySelector('.queue-strip').textContent.includes('后续排队消息') && !!document.querySelector('.queue-resume')") && (await state()).runs.length === 2);
  await shot("03-admission-rejected");
  await js("document.querySelector('.queue-resume').click();true;");
  await wait("window.__cairnQueuePersistence.calls().writes.length === 8"); await write(7, true);
  await wait("window.__cairnQueuePersistence.calls().runs.length === 3");
  await js("window.__cairnQueuePersistence.run(2,{ok:false,accepted:true,error:'执行失败'})"); await pause();
  check("已接收后的执行失败不会重新入队或重复派发", await js("!document.querySelector('.queue-strip')") && (await state()).runs.length === 3);
  await js("(() => {const t=document.querySelector('.composer-card textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,'运行中读取快照');t.dispatchEvent(new Event('input',{bubbles:true}));t.focus();})()"); pressEnter();
  await wait("window.__cairnQueuePersistence.calls().runs.length === 4");
  await js("(() => {const t=document.querySelector('.composer-card textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,'快照竞态消息');t.dispatchEvent(new Event('input',{bubbles:true}));t.focus();})()"); pressEnter();
  await wait("window.__cairnQueuePersistence.calls().writes.length === 9"); await write(8, true);
  await js("window.__cairnQueuePersistence.holdReads(true);([...document.querySelectorAll('.s-title')].find(e=>e.textContent.includes('项目甲'))).closest('.session').click();true;");
  await wait("window.__cairnQueuePersistence.calls().reads === 1");
  await js("window.__cairnQueuePersistence.run(3,{ok:true,accepted:true})");
  await wait("window.__cairnQueuePersistence.calls().writes.length === 10"); await write(9, true);
  await wait("window.__cairnQueuePersistence.calls().runs.length === 5");
  await js("window.__cairnQueuePersistence.read(0)"); await wait("!document.querySelector('.composer-card textarea').disabled");
  check("迟到的旧磁盘快照不能把已派发的消息放回队列", await js("!document.querySelector('.queue-strip')"));
  await js("window.__cairnQueuePersistence.run(4,{ok:true,accepted:true})"); await pause(250);
  check("旧快照未造成重复执行", (await state()).runs.length === 5);
  check("所有队列写入与任务均绑定原项目", (await state()).writes.every(c => c.workspace === "/tmp/demo-ws") && (await state()).runs.every(c => c.workspace === "/tmp/demo-ws"));
  check("无 renderer/preload 错误", errors.length === 0); await finish();
}
setTimeout(() => { console.error("queue smoke 超时"); app.exit(1); }, 45000).unref();
main().catch(error => { console.error(error); app.exit(1); });
