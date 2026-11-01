const { app, BrowserWindow, nativeTheme } = require("electron");
const { mkdtempSync, readFileSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const profile = mkdtempSync(join(tmpdir(), "cairn-diag13-"));
app.setPath("userData", profile);
nativeTheme.themeSource = "light";
app.on("quit", () => { rmSync(profile, { recursive: true, force: true }); });
async function main() {
  await app.whenReady();
  const protocol = readFileSync(join(__dirname, "../../../src/main/ipc-protocol.ts"), "utf8");
  const version = Number(protocol.match(/IPC_PROTOCOL_VERSION\s*=\s*(\d+)/)[1]);
  const start = protocol.indexOf("export interface AgentApi");
  const body = protocol.slice(start, protocol.indexOf("\n}", start));
  const starts = [...body.matchAll(/^\s{2}(\w+)\??\s*[(<]/gm)];
  const members = starts.map((s, i) => ({ name: s[1], isArray: /Promise<[^>]*[\]>]/ .test(body.slice(s.index, starts[i + 1]?.index ?? body.length)) }));
  const win = new BrowserWindow({ width: 1440, height: 900, show: false, webPreferences: {
    preload: join(__dirname, "ui-gallery-preload.cjs"),
    additionalArguments: ["--cairn-api-members=" + JSON.stringify(members), "--cairn-protocol-version=" + version, "--cairn-steer-fixture"],
  }});
  const js = async (s) => { try { return await win.webContents.executeJavaScript(s); } catch (e) { return "ERR: " + e.message; } };
  const pause = (ms=400) => new Promise(r => setTimeout(r, ms));
  await win.loadFile(join(__dirname, "../dist/index.html"));
  await pause(800);
  await js(`document.querySelector('.session')?.click()`);
  await pause(600);

  // D6：模型菜单开着时点用量环 ⇒ 两个浮层是否同屏？
  await js(`document.querySelector('.mp-trigger')?.click()`);
  await pause(400);
  console.log("model menu open:", await js(`!!document.querySelector('.mp-pop')`));
  await js(`document.querySelector('.usage-ring')?.click()`);
  await pause(500);
  const both = await js(`(() => {
    const mp = document.querySelector('.mp-pop');
    const pops = Array.from(document.querySelectorAll('.pop.show')).map(p=>p.className);
    return { mpPresent: !!mp, pops, count: document.querySelectorAll('.pop.show').length };
  })()`);
  console.log("D6 after clicking usage ring:", JSON.stringify(both));
  // 量两个浮层的几何：是否真的叠在同一处（重叠 = 用户只能点一次关掉一个）
  const geo = await js(`(() => {
    const mp = document.querySelector('.mp-pop');
    const usage = Array.from(document.querySelectorAll('.pop.show')).find(p => !p.classList.contains('mp-pop'));
    const r1 = mp?.getBoundingClientRect();
    const r2 = usage?.getBoundingClientRect();
    if (!r1 || !r2) return { no: 1 };
    const overlap = !(r2.left > r1.right || r2.right < r1.left || r2.top > r1.bottom || r2.bottom < r1.top);
    // 命中测试：用量浮层中央点命中的是谁？
    const cx = r2.left + r2.width/2, cy = r2.top + r2.height/2;
    const hit = document.elementFromPoint(cx, cy);
    return { mp: {l:r1.left,t:r1.top,w:r1.width,h:r1.height}, usage: {l:r2.left,t:r2.top,w:r2.width,h:r2.height}, overlap,
             hitClass: hit?.className, hitIsUsage: hit === usage || (hit && usage?.contains(hit)) };
  })()`);
  console.log("D6 geometry:", JSON.stringify(geo));

  // D4：模型菜单里按 ⌘↑ ⇒ 滚的是转录还是菜单？
  await js(`document.querySelector('.mp-trigger')?.click()`);  // 重新开模型菜单
  await pause(400);
  const scrollBefore = await js(`(() => { const s=document.querySelector('.stream, .stream-scroll'); return s? s.scrollTop : -1; })()`);
  const focused = await js(`(() => { const b = document.querySelector('.mp-pop .menu-item, .mp-pop button'); if(b) b.focus(); return document.activeElement?.className; })()`);
  console.log("focused in model menu:", focused);
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'ArrowUp', modifiers: ['meta'] });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'ArrowUp', modifiers: ['meta'] });
  await pause(500);
  const scrollAfter = await js(`(() => { const s=document.querySelector('.stream, .stream-scroll'); return s? s.scrollTop : -1; })()`);
  console.log("D4 scroll before:", scrollBefore, "after:", scrollAfter, "| model menu still open:", await js(`!!document.querySelector('.mp-pop')`));
  win.destroy();
}
main().catch(e => { console.error(e); process.exitCode=1; });
