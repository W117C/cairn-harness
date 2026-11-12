// Real Electron renderer. Local event fixtures, isolated profile, no provider calls.
const { app, BrowserWindow, nativeTheme } = require("electron");
const { scheduleProfileCleanup } = require("./lib/profile-cleanup.cjs");
const { mkdirSync, mkdtempSync, readFileSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");
const profile = mkdtempSync(join(tmpdir(), "cairn-work-status-profile-"));
const out = resolve(process.argv[2] ?? mkdtempSync(join(tmpdir(), "cairn-work-status-")));
mkdirSync(out, { recursive: true });
app.setPath("userData", profile);
app.on("quit", () => scheduleProfileCleanup(profile));
nativeTheme.themeSource = "light";
const checks = [], errors = [];
const pause = (ms = 270) => new Promise(done => setTimeout(done, ms));
const check = (name, ok, detail) => { checks.push({ name, ok: ok === true, detail }); console.log(`${ok === true ? "PASS" : "FAIL"} ${name} ${JSON.stringify(detail ?? null)}`); };

async function main() {
  await app.whenReady();
  const protocol = readFileSync(join(__dirname, "../../../src/main/ipc-protocol.ts"), "utf8");
  const version = Number(protocol.match(/IPC_PROTOCOL_VERSION\s*=\s*(\d+)/)[1]);
  const start = protocol.indexOf("export interface AgentApi");
  const body = protocol.slice(start, protocol.indexOf("\n}", start));
  const starts = [...body.matchAll(/^\s{2}(\w+)\??\s*[(<]/gm)];
  const members = starts.map((s, i) => ({ name: s[1], isArray: /Promise<[^>]*\[\]/.test(body.slice(s.index, starts[i + 1]?.index ?? body.length)) }));
  const win = new BrowserWindow({ width: 1440, height: 800, show: false, webPreferences: {
    backgroundThrottling: false, preload: join(__dirname, "ui-gallery-preload.cjs"),
    additionalArguments: ["--cairn-api-members=" + JSON.stringify(members), "--cairn-protocol-version=" + version,
      "--cairn-steer-fixture", "--cairn-work-status-fixture"],
  } });
  win.webContents.on("console-message", details => { if (details.level === "error") errors.push(details.message); });
  const js = source => win.webContents.executeJavaScript(source, true);
  const key = async (keyCode, modifiers = []) => {
    win.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
    if (keyCode === "Return") win.webContents.sendInputEvent({ type: "char", keyCode: "\r", modifiers });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
    await pause();
  };
  const shot = async name => writeFileSync(join(out, name + ".png"), (await win.webContents.capturePage()).toPNG());
  const panel = `document.querySelector('.pop.show:has(.ws-panel)')`;
  const read = () => js(`(() => {
    const p=${panel}; if(!p)return null;
    const r=p.getBoundingClientRect(), head=p.querySelector('.ws-head'), foot=p.querySelector('.ws-foot');
    return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:innerWidth,height:innerHeight,
      role:p.getAttribute('role'),focused:p.contains(document.activeElement),footer:foot?.textContent,
      headTop:head?.getBoundingClientRect().top, footBottom:foot?.getBoundingClientRect().bottom,
      panelScroll:p.scrollTop,listScroll:p.querySelector('.ws-items')?.scrollTop??0};
  })()`);
  const openPanel = async () => { await js(`document.querySelector('.tb-workpill').focus()`); await key("Return"); };
  await win.loadFile(process.env.CAIRN_RENDERER_ENTRY ?? join(__dirname, "../dist/index.html"));
  for (let i = 0; i < 60; i++) { if (await js(`document.querySelectorAll('.session').length === 2`)) break; await pause(80); }
  await js(`[...document.querySelectorAll('.session')].find(s=>s.textContent.includes('routing')).click()`);
  await pause(600);
  await js(`(() => {const input=document.querySelector('[data-composer-input="true"]');input.focus();Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'本轮只核对一个文件');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await key("Return");
  check("本轮已开始，仍在等待合成运行结束", await js(`window.__cairnRuns().some(r=>r.sessionId==='s1' && r.message==='本轮只核对一个文件')`));
  await js(`(() => {const push=event=>window.__cairnPushEvent({...event,session_id:'s1'});push({type:'user_message',content:'本轮只核对一个文件'});push({type:'tool_call',name:'read_file',id:'status-current-step',args:{path:'README.md'}});push({type:'todo_updated',callId:'status-current-list',items:Array.from({length:22},(_,i)=>({text:'第 '+(i+1)+' 项：核对桌面端交互与验证记录',state:i===0?'done':'pending'}))});})()`);
  await pause();
  await openPanel();
  const initial = await read();
  check("进度只显示当前轮的 1 步", initial?.footer?.endsWith("· 1 步") === true, initial);
  check("键盘打开后焦点进入可阅读区域", initial?.focused === true && initial.role === "region", initial);
  await shot("01-running-wide");
  await js(`(() => {const push=event=>window.__cairnPushEvent({...event,session_id:'s1'});push({type:'user_message',content:'补充看验证结果',origin:{kind:'steering',step:1}});push({type:'tool_call',name:'read_file',id:'status-after-steer',args:{path:'STATE.md'}});})()`);
  await pause();
  const steered = await read();
  check("轮中插话后保留本轮前后两步", steered?.footer?.endsWith("· 2 步") === true, steered);

  win.setContentSize(880, 205); await pause();
  const short = await read();
  check("已打开的进度面板缩到短窗仍完整在视口内", short !== null && short.top >= 0 && short.bottom <= short.height - 4 && short.left >= 0 && short.right <= short.width, short);
  await key("PageDown");
  const scrolled = await read();
  check("键盘滚动清单，标题与步数保持可见",
    scrolled !== null && scrolled.listScroll > 0 && scrolled.panelScroll === 0 &&
      scrolled.headTop >= scrolled.top && scrolled.footBottom <= scrolled.bottom, scrolled);
  await shot("02-short-list");
  await key("Escape");
  check("Esc 只关进度并还焦点，未停止运行", await js(`!${panel} && document.activeElement===document.querySelector('.tb-workpill') && window.__cairnCancels().length===0`));

  win.setContentSize(1120, 700); await pause();
  await openPanel();
  await key("Tab", ["ctrl"]);
  const switched = await js(`({title:document.querySelector('.tb-title')?.textContent,open:!!${panel},pill:document.querySelector('.tb-workpill-text')?.textContent})`);
  check("键盘切换会话关闭旧进度，下一会话可自行打开", switched.title?.includes("整理竞品") === true && !switched.open && switched.pill === "另一会话的任务", switched);
  if (switched.open) await key("Escape");
  await js(`document.documentElement.dataset.theme='dark';document.documentElement.dataset.mode='dark';document.body.toggleAttribute('data-ds-dark-theme',true)`);
  await openPanel();
  await shot("03-second-session-dark");
  check("另一会话显示自己的清单", await js(`${panel}?.textContent.includes('另一会话的任务')`));
  await key("Escape");
  await js(`window.__cairnReleaseRun({ok:true})`);
  check("renderer 无控制台错误", errors.length === 0, errors);
  writeFileSync(join(out, "checks.json"), JSON.stringify({ fixtureData: true, checks, errors }, null, 2));
  console.log(`${checks.filter(c => c.ok).length}/${checks.length} PASS · ${out}`);
  app.exit(checks.every(c => c.ok) ? 0 : 1);
}
const watchdog = setTimeout(() => { console.error("work-status-smoke timeout"); app.exit(2); }, 45000);
watchdog.unref();
main().catch(err => { console.error(err); writeFileSync(join(out, "checks.json"), JSON.stringify({ checks, errors }, null, 2)); app.exit(2); });
