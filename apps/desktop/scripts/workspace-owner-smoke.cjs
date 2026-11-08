// Real application main + preload; two temporary projects, no model requests.
const { app, BrowserWindow } = require('electron');
const { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const root = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-workspace-owner-')));
const profile = join(root, 'profile');
const workspaceA = join(root, 'A');
const workspaceB = join(root, 'B');
for (const dir of [profile, workspaceA, workspaceB]) mkdirSync(dir);
writeFileSync(join(workspaceA, 'same.txt'), 'PROJECT_A\n');
writeFileSync(join(workspaceB, 'same.txt'), 'PROJECT_B\n');
for (const [workspace, marker] of [[workspaceA, 'A'], [workspaceB, 'B']]) {
  const sessions = join(workspace, '.agent', 'sessions');
  mkdirSync(sessions, { recursive: true });
  writeFileSync(join(sessions, 'same-session.jsonl'), [
    { type: 'user_message', content: `real_main_search_needle_${marker}` },
    { type: 'assistant_message', content: `REAL_MAIN_${marker}_HISTORY_ONLY` },
  ].map(e => JSON.stringify(e)).join('\n') + '\n');
}
app.setPath('userData', profile);
// Electron was launched with this harness file; the trusted shell still belongs to the app.
app.setAppPath(resolve(__dirname, '..'));
process.env.CAIRN_DESKTOP_WORKSPACE = workspaceA;
const output = resolve(process.argv[2] ?? 'workspace-owner-checks.json');
const checks = [];
const pause = ms => new Promise(r => setTimeout(r, ms));
const check = (name, ok, detail) => { checks.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); };
const save = () => writeFileSync(output, JSON.stringify({ checks }, null, 2));
const cleanup = () => {
  for (const win of BrowserWindow.getAllWindows()) win.destroy();
  rmSync(root, { recursive: true, force: true });
};
async function waitFor(fn, label) {
  const until = Date.now() + 20000;
  while (Date.now() < until) { if (await fn()) return; await pause(40); }
  throw Error('timeout: ' + label);
}
require('../src/main/entry.cjs');
async function main() {
  await app.whenReady();
  await waitFor(() => BrowserWindow.getAllWindows().some(w => !w.webContents.isLoading()), 'main window');
  const mainWindow = BrowserWindow.getAllWindows()[0];
  const call = (win, expression) => win.webContents.executeJavaScript(expression);
  await waitFor(() => call(mainWindow, '!!document.querySelector(".composer-card textarea")'), 'main renderer');
  await call(mainWindow, `window.agent.addProject({path:${JSON.stringify(workspaceB)}})`);
  await call(mainWindow, `window.agent.setWorkspaceContext(${JSON.stringify(workspaceA)})`);
  const searchA = await call(mainWindow, `window.agent.sessionSearch(${JSON.stringify(workspaceA)},"real_main_search_needle_A")`);
  const searchB = await call(mainWindow, `window.agent.sessionSearch(${JSON.stringify(workspaceB)},"real_main_search_needle_A")`);
  check('生产 main 检索 A 命中 A 的正文', searchA.kind === 'ok' && searchA.matches.some(h => h.sessionId === 'same-session'), searchA);
  check('生产 main 同名 B 不借用 A 正文', searchB.kind === 'ok' && searchB.matches.length === 0, searchB);
  const openedA = await call(mainWindow, `window.agent.openSession("same-session",${JSON.stringify(workspaceA)})`);
  const openedB = await call(mainWindow, `window.agent.openSession("same-session",${JSON.stringify(workspaceB)})`);
  check('生产 KernelHost 按 workspace 打开同名会话', openedA.events.some(e => e.content === 'REAL_MAIN_A_HISTORY_ONLY') && openedB.events.some(e => e.content === 'REAL_MAIN_B_HISTORY_ONLY'));
  await call(mainWindow, 'window.agent.panePopout("file")');
  await waitFor(() => BrowserWindow.getAllWindows().length === 2, 'file popout');
  const popout = BrowserWindow.getAllWindows().find(w => w !== mainWindow);
  await waitFor(() => !popout.webContents.isLoading(), 'popout renderer');
  const before = await call(popout, 'window.agent.workspaceReadText("same.txt")');
  check('弹窗继承打开时的项目 A', before.ok && before.text === 'PROJECT_A\n', before);
  await call(mainWindow, `window.agent.setWorkspaceContext(${JSON.stringify(workspaceB)})`);
  const mainB = await call(mainWindow, 'window.agent.workspaceReadText("same.txt")');
  const popA = await call(popout, 'window.agent.workspaceReadText("same.txt")');
  check('主窗切到项目 B', mainB.ok && mainB.text === 'PROJECT_B\n', mainB);
  check('主窗切项目不改变已弹窗的项目', popA.ok && popA.text === 'PROJECT_A\n', popA);
  const pathA = await call(popout, 'window.agent.workspacePathAction("same.txt", "abs")');
  check('弹窗路径动作也绑定项目 A', pathA.ok && pathA.path === join(workspaceA, 'same.txt'), pathA);
  const refused = await call(popout, 'window.agent.setWorkspaceContext("/")');
  check('按窗口存储仍拒绝未注册的工作区根', refused.ok === false, refused);
  const afterRefusal = await call(popout, 'window.agent.workspaceReadText("same.txt")');
  check('拒绝非法根后保留弹窗自己的项目', afterRefusal.ok && afterRefusal.text === 'PROJECT_A\n', afterRefusal);
  // Simulate a previous run without contacting a provider: clearing a window must not use this global fallback.
  require('../../../src/main/runner-workspace.ts').setRunWorkspace(workspaceB);
  await call(mainWindow, 'window.agent.setWorkspaceContext("")');
  const cleared = await call(mainWindow, 'window.agent.workspaceReadText("same.txt").then(r=>({r}),e=>({error:e.message}))');
  check('清除主窗上下文后不回落到另一窗项目', !!cleared.error || cleared.r?.ok === false, cleared);
  const stillA = await call(popout, 'window.agent.workspaceReadText("same.txt")');
  check('主窗清空不影响弹窗', stillA.ok && stillA.text === 'PROJECT_A\n', stillA);
  // Drive the actual product command palette, not an IPC fixture handler.
  await call(mainWindow, 'document.querySelector(".session").click()');
  await call(mainWindow, 'window.dispatchEvent(new KeyboardEvent("keydown",{key:"k",code:"KeyK",metaKey:true,bubbles:true}))');
  await waitFor(() => call(mainWindow, '!!document.querySelector(".cp-input")'), 'real command palette');
  await call(mainWindow, `(()=>{const input=document.querySelector('.cp-input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'real_main_search_needle_A');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await waitFor(() => call(mainWindow, '!!document.querySelector("[data-session-search-result=\\"same-session\\"]")'), 'real main body result');
  check('真实命令面板通过生产 main 显示正文结果', true);
  await call(mainWindow, 'document.querySelector("[data-session-search-result=\\"same-session\\"]").click()');
  await waitFor(() => call(mainWindow, 'document.querySelector(".stream")?.innerText.includes("REAL_MAIN_A_HISTORY_ONLY")'), 'real main opened A');
  check('真实搜索结果打开 A 正文且不显示 B', await call(mainWindow, '!document.querySelector(".stream").innerText.includes("REAL_MAIN_B_HISTORY_ONLY")'));
  save();
  cleanup();
  app.exit(checks.every(c => c.ok) ? 0 : 1);
}
setTimeout(() => { console.error('workspace-owner-smoke timeout'); check('未超时', false); save(); cleanup(); app.exit(1); }, 60000).unref();
main().catch(error => { console.error(error); check('完成全部步骤', false, String(error)); save(); cleanup(); app.exit(1); });
