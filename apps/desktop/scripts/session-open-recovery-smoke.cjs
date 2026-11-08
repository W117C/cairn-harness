// 会话正文/队列读回失败：真实 renderer + 可控 IPC，禁止未读完整时发消息或改队列。
const { app, BrowserWindow } = require("electron");
const { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const profile = mkdtempSync(join(tmpdir(), "cairn-open-recovery-profile-"));
const out = resolve(process.argv[2] || mkdtempSync(join(tmpdir(), "cairn-open-recovery-")));
mkdirSync(out, { recursive: true });
app.setPath("userData", profile);
app.on("quit", () => rmSync(profile, { recursive: true, force: true }));
const checks = [];
const check = (name, ok) => { checks.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"} ${name}`); };
const pause = () => new Promise((r) => setTimeout(r, 90));
async function main() {
  await app.whenReady();
  const protocol = readFileSync(join(__dirname, "../../../src/main/ipc-protocol.ts"), "utf8");
  const tail = protocol.slice(protocol.indexOf("export interface AgentApi"));
  const body = tail.slice(0, tail.indexOf("\n}"));
  const starts = [...body.matchAll(/^\s{2}(\w+)\??\s*[(<]/gm)];
  const members = starts.map((s, i) => ({ name: s[1], isArray: /Promise<[^>]*\[\]/.test(body.slice(s.index, starts[i + 1]?.index)) }));
  const win = new BrowserWindow({ width: 1440, height: 900, show: false, webPreferences: {
    preload: join(__dirname, "ui-gallery-preload.cjs"),
    additionalArguments: ["--cairn-api-members=" + JSON.stringify(members), "--cairn-protocol-version=" + protocol.match(/IPC_PROTOCOL_VERSION\s*=\s*(\d+)/)[1], "--cairn-open-recovery-fixture"],
  } });
  const errors = [];
  win.webContents.on("console-message", (details) => { if (details.level === "error") errors.push(details.message); });
  win.webContents.on("preload-error", (_event, _path, error) => errors.push(error.message));
  const js = (source) => win.webContents.executeJavaScript(source);
  const counts = () => js("window.__cairnOpenRecovery.counts()");
  async function wait(source) { for (let i = 0; i < 80; i++) { if (await js(source)) return; await pause(); } throw new Error("等待超时: " + source); }
  const control = async (name, index) => { await js(`window.__cairnOpenRecovery.${name}(${index})`); await pause(); };
  const click = async (id) => {
    const before = await counts(); await js(`document.querySelector('[data-session-id="${id}"]').click(); true;`);
    await wait(`window.__cairnOpenRecovery.counts().opens === ${before.opens + 1}`);
    return before;
  };
  const retry = async () => {
    const before = await counts();
    const present = await js("!!document.querySelector('[data-session-retry]')");
    check("提供就地重新读取入口", present);
    if (present) {
      await js("document.querySelector('[data-session-retry]').focus(); true;");
      win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Return" });
      win.webContents.sendInputEvent({ type: "char", keyCode: "\r" });
      win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Return" });
    }
    else await click("s1"); // 改前基线仍跑完后续断言；缺入口已经记为失败。
    await wait(`window.__cairnOpenRecovery.counts().opens === ${before.opens + 1}`);
    return before;
  };
  const disabledQueue = "(() => { const buttons=[...document.querySelectorAll('.queue-strip button')]; return buttons.length > 0 && buttons.every(b => b.disabled); })()";
  const shot = async (name) => writeFileSync(join(out, name + ".png"), (await win.webContents.capturePage()).toPNG());
  await win.loadFile(join(process.env.CAIRN_RENDERER_DIST || join(__dirname, "../dist"), "index.html"));
  win.show(); win.focus();
  await wait("!!document.querySelector('[data-session-id=\"s1\"]')");
  let request = await click("s1");
  await control("resolveOpen", request.opens); await control("resolveQueue", request.queues);
  await wait("!document.querySelector('.composer-card textarea').disabled && !!document.querySelector('.queue-strip')");
  await js("(() => {const t=document.querySelector('.composer-card textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,'不要丢失的草稿'); t.dispatchEvent(new Event('input',{bubbles:true}));})()");
  request = await click("s1");
  check("读取期间缓存队列所有动作禁用", await js(disabledQueue));
  await control("resolveOpen", request.opens); await control("rejectQueue", request.queues);
  check("队列读取失败后仍锁住输入", await js("document.querySelector('.composer-card textarea').disabled"));
  check("队列读取失败后仍阻止缓存队列改写", await js(disabledQueue));
  check("失败原因在独立恢复提示中", await js("document.querySelector('.session-load-notice')?.textContent.includes('发送队列损坏') === true"));
  for (const [theme, width] of [["light", 1440], ["dark", 880]]) {
    win.setSize(width, 720);
    await js(`(() => {document.documentElement.dataset.theme='${theme}';document.documentElement.dataset.mode='${theme}';document.body.toggleAttribute('data-ds-dark-theme','${theme}'==='dark');const details=document.querySelector('.session-load-notice details');if(details)details.open=true;return true;})()`);
    await pause();
    check(`${theme} 长错误不横向溢出`, await js("document.documentElement.scrollWidth <= innerWidth"));
    check(`${theme} 长错误实际展开`, await js("document.querySelector('.session-load-notice details')?.open === true"));
    const contrast = await js(`(() => {
      const el=document.querySelector('[data-session-retry]'); if(!el)return 0;
      const color=getComputedStyle(el).color; let node=el, bg='rgb(255,255,255)';
      while(node){const value=getComputedStyle(node).backgroundColor;if(value!=='rgba(0, 0, 0, 0)'&&value!=='transparent'){bg=value;break;}node=node.parentElement;}
      const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');
      const lum=(value)=>{ctx.fillStyle=value;ctx.fillRect(0,0,1,1);const rgb=[...ctx.getImageData(0,0,1,1).data].slice(0,3).map(v=>{v/=255;return v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4;});return rgb[0]*0.2126+rgb[1]*0.7152+rgb[2]*0.0722;};
      const a=lum(color),b=lum(bg);return (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);
    })()`);
    check(`${theme} 重读按钮文字对比度至少 4.5`, contrast >= 4.5);
    console.log(`contrast ${theme}: ${contrast.toFixed(2)}`);
    await shot(`01-queue-error-${theme}`);
  }
  request = await retry();
  await control("resolveQueue", request.queues);
  check("队列先读完时等待正文，不提前解锁", await js("document.querySelector('.composer-card textarea').disabled"));
  await control("resolveOpen", request.opens);
  check("重读成功解除锁并移除提示", await js("!document.querySelector('.composer-card textarea').disabled && !document.querySelector('.session-load-notice')"));
  check("重读保留未发送草稿与持久队列", await js("document.querySelector('.composer-card textarea').value === '不要丢失的草稿' && document.querySelector('.queue-strip').textContent.includes('s1 持久队列')"));
  request = await click("s1");
  await control("rejectOpen", request.opens); await control("resolveQueue", request.queues);
  check("正文读取失败后仍锁住输入", await js("document.querySelector('.composer-card textarea').disabled"));
  const old = await retry(); const next = await click("s2");
  await control("resolveOpen", next.opens); await control("resolveQueue", next.queues);
  await control("rejectOpen", old.opens); await control("rejectQueue", old.queues);
  check("切会话后旧失败不污染新会话", await js("document.querySelector('.sidenav .session.active')?.dataset.sessionId === 's2' && !document.querySelector('.composer-card textarea').disabled && !document.querySelector('.session-load-notice') && document.querySelector('.row.user')?.textContent.includes('s2 正文')"));
  const final = await counts();
  check("读取与恢复未改写队列、未派发任务", final.writes === 0 && final.runs === 0);
  check("无 renderer/preload 错误", errors.length === 0);
  writeFileSync(join(out, "result.json"), JSON.stringify({ checks, errors }, null, 2));
  win.destroy(); app.exit(checks.every((c) => c.ok) ? 0 : 1);
}
const watchdog = setTimeout(() => { console.error("smoke 超时"); app.exit(1); }, 45000); watchdog.unref();
main().catch((error) => { console.error(error); app.exit(1); });
