// 真实 renderer 的路由加载与资源闭包：弹出窗不得先加载主聊天工作台。
const { app, BrowserWindow } = require('electron');
const { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, statSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve, dirname } = require('node:path');
const { fileURLToPath } = require('node:url');
const profile = mkdtempSync(join(tmpdir(), 'cairn-route-'));
app.setPath('userData', profile);
app.on('window-all-closed', () => {});
app.on('quit', () => rmSync(profile, { recursive: true, force: true }));
const output = resolve(process.argv[2]);
const waitFor = async (win, condition) => {
  const start = Date.now();
  while (Date.now() - start < 15000) {
    if (await win.webContents.executeJavaScript(condition)) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`路由未就绪：${condition}`);
};
async function main() {
  await app.whenReady();
  const protocol = readFileSync(join(__dirname, '../../../src/main/ipc-protocol.ts'), 'utf8');
  const version = Number(protocol.match(/IPC_PROTOCOL_VERSION\s*=\s*(\d+)/)[1]);
  const start = protocol.indexOf('export interface AgentApi');
  const body = protocol.slice(start, protocol.indexOf('\n}', start));
  const starts = [...body.matchAll(/^\s{2}(\w+)\??\s*[(<]/gm)];
  const members = starts.map((s,i) => ({ name:s[1], isArray:/Promise<[^>]*\[\]/.test(body.slice(s.index, starts[i+1]?.index??body.length)) }));
  const reports = [];
  for (const route of ['', 'pane=plan']) {
    const win = new BrowserWindow({ show: false, width: 1440, height: 900, webPreferences: {
      preload: join(__dirname, 'ui-gallery-preload.cjs'),
      additionalArguments: ['--cairn-api-members='+JSON.stringify(members), '--cairn-protocol-version='+version],
    }});
    const errors = [];
    const resources = new Set();
    win.webContents.on('console-message', detail => { if (detail.level === 'error') errors.push(detail.message); });
    // Chromium 目标须先就绪，再启用网络采集；首次文件导航仍在采集之后。
    await win.loadURL('about:blank');
    win.webContents.debugger.attach('1.3');
    win.webContents.debugger.on('message', (_event, method, params) => {
      if (method === 'Network.requestWillBeSent' && new URL(params.request.url).pathname.endsWith('.js')) resources.add(params.request.url);
    });
    await win.webContents.debugger.sendCommand('Network.enable');
    const started = performance.now();
    await win.loadFile(join(__dirname, '../dist/index.html'), { hash: route });
    await waitFor(win, route ? `!!document.querySelector('.popout-app .pane-workbench')` : `!!document.querySelector('.composer-card textarea')`);
    const readyMs = performance.now() - started;
    await win.webContents.executeJavaScript('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const dom = await win.webContents.executeJavaScript(`({ popout:!!document.querySelector('.popout-app'), composer:!!document.querySelector('.composer-card'), title:document.title })`);
    const files = [...new Set(resources)].map(url => ({ file: fileURLToPath(url), bytes: statSync(fileURLToPath(url)).size }));
    reports.push({ route: route || 'main', readyMs, dom, files, jsBytes: files.reduce((sum, f) => sum + f.bytes, 0), errors });
    win.destroy();
  }
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(reports, null, 2));
  console.log(JSON.stringify(reports));
  app.exit(reports.length === 2 && reports.every(r => r.files.length > 0 && r.errors.length === 0 && (r.route === 'main' ? r.dom.composer && !r.dom.popout : r.dom.popout && !r.dom.composer)) ? 0 : 1);
}
setTimeout(()=>{console.error('route-smoke 超时');app.exit(1);},45000).unref();
main().catch(error=>{console.error(error);app.exit(1);});
