const { app, BrowserWindow, nativeTheme } = require("electron");
const { scheduleProfileCleanup } = require("./lib/profile-cleanup.cjs");
const { mkdtempSync, readFileSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const profile = mkdtempSync(join(tmpdir(), "cairn-diag14-"));
app.setPath("userData", profile);
nativeTheme.themeSource = "light";
app.on("quit", () => scheduleProfileCleanup(profile));
async function main() {
  await app.whenReady();
  const protocol = readFileSync(join(__dirname, "../../../src/main/ipc-protocol.ts"), "utf8");
  const version = Number(protocol.match(/IPC_PROTOCOL_VERSION\s*=\s*(\d+)/)[1]);
  const start = protocol.indexOf("export interface AgentApi");
  const body = protocol.slice(start, protocol.indexOf("\n}", start));
  const starts = [...body.matchAll(/^\s{2}(\w+)\??\s*[(<]/gm)];
  const members = starts.map((s, i) => ({ name: s[1], isArray: /Promise<[^>]*[\]>]/.test(body.slice(s.index, starts[i + 1]?.index ?? body.length)) }));
  const win = new BrowserWindow({ width: 1440, height: 900, show: false, webPreferences: {
    preload: join(__dirname, "ui-gallery-preload.cjs"),
    additionalArguments: ["--cairn-api-members=" + JSON.stringify(members), "--cairn-protocol-version=" + version],
  }});
  const js = async (s) => { try { return await win.webContents.executeJavaScript(s); } catch (e) { return "ERR: " + e.message; } };
  const pause = (ms=400) => new Promise(r => setTimeout(r, ms));
  await win.loadFile(join(__dirname, "../dist/index.html"));
  await pause(800);
  await js(`document.querySelector('.session')?.click()`);
  await pause(600);
  const rect = (sel) => js(`(() => { const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return null; const r=e.getBoundingClientRect(); return {l:Math.round(r.left),t:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)}; })()`);
  // 各触发钮的位置
  console.log("mp-trigger:", await rect('.mp-trigger'));
  console.log("usage-ring:", await rect('.usage-ring'));
  console.log("attach-btn:", await rect('.attach-btn'));
  // 权限钮
  console.log("perm triggers:", await js(`JSON.stringify([...document.querySelectorAll('.row3 button')].map(b=>({cls:b.className,l:Math.round(b.getBoundingClientRect().left),t:Math.round(b.getBoundingClientRect().top)})))`));
  // 各浮层打开后的实际矩形（两两是否重叠）
  const openAndRect = async (trigger, popSel) => {
    await js(`document.querySelector(${JSON.stringify(trigger)})?.click()`);
    await pause(450);
    const r = await rect(popSel);
    await js(`document.body.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`);
    await pause(350);
    return r;
  };
  const model = await openAndRect('.mp-trigger', '.mp-pop');
  const usage = await openAndRect('.usage-ring', '.pop.up.show');
  const attach = await openAndRect('.attach-btn', '.pop.up.show');
  console.log("model popup:", JSON.stringify(model));
  console.log("usage popup:", JSON.stringify(usage));
  console.log("attach popup:", JSON.stringify(attach));
  const ov = (a,b) => a&&b ? !(b.l > a.l+a.w || b.l+b.w < a.l || b.t > a.t+a.h || b.t+b.h < a.t) : null;
  console.log("model∩usage:", ov(model,usage), "model∩attach:", ov(model,attach), "usage∩attach:", ov(usage,attach));
  win.destroy();
}
main().catch(e => { console.error(e); process.exitCode=1; });
