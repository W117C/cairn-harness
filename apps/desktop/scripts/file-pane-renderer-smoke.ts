// 真实 renderer + 生产 preload + Electron IPC；真实临时文件，延迟/失败只注入 IPC 边界。
import { app, BrowserWindow, ipcMain, nativeTheme } from 'electron';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { listDir, readTextFile, type ListDirPayload, type ReadTextPayload } from '../../../src/main/workspace-fs';
import { INVOKE_CHANNELS } from '../src/main/channels';
import { IPC_PROTOCOL_VERSION } from '../../../src/main/ipc-protocol';

const profile = mkdtempSync(join(tmpdir(), 'cairn-files-renderer-'));
const workspace = join(profile, 'workspace');
const output = resolve(process.argv[2] ?? 'outputs/file-pane-renderer');
mkdirSync(output, { recursive: true });
mkdirSync(workspace);
app.setPath('userData', profile);
nativeTheme.themeSource = 'light';
app.on('window-all-closed', () => {});
app.on('quit', () => rmSync(profile, { recursive: true, force: true }));
const checks: { name: string; ok: boolean; detail?: unknown }[] = [];
const check = (name: string, ok: boolean, detail?: unknown): void => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail === undefined ? '' : JSON.stringify(detail)}`);
};
const waitFor = async (condition: () => boolean | Promise<boolean>, title: string): Promise<void> => {
  const start = Date.now();
  while (Date.now() - start < 8000) {
    if (await condition()) return;
    await new Promise(r => setTimeout(r, 20));
  }
  throw new Error(`超时：${title}`);
};
const save = (): void => writeFileSync(join(output, 'checks.json'), JSON.stringify({ checks, protocolVersion: IPC_PROTOCOL_VERSION }, null, 2));

async function main(): Promise<void> {
  for (const dir of ['00-empty', '01-delayed', '02-retry', '03-large', 'src/很长的目录名称与中文路径']) mkdirSync(join(workspace, dir), { recursive: true });
  for (let i = 0; i < 501; i++) writeFileSync(join(workspace, '03-large', `${String(i).padStart(3, '0')}.txt`), 'item');
  const longPath = 'src/很长的目录名称与中文路径/这是一个足够长以验证窄面板完整路径不会丢失的文件名称-你好-world.txt';
  for (const [path, text] of Object.entries({ '01-delayed/fresh.txt': 'FRESH_DIRECTORY', 'A-slow.txt': 'SLOW_OLD_CONTENT', 'B-fast.txt': 'CURRENT_FILE_CONTENT', 'C-reject.txt': 'OLD_REJECT', 'broken.txt': 'RECOVERED_FILE', [longPath]: '中文内容与 emoji 🌍', 'wide.txt': 'x'.repeat(512 * 1024 + 1) })) writeFileSync(join(workspace, path), text);
  writeFileSync(join(workspace, 'binary.bin'), Buffer.from([0, 1, 2]));
  await app.whenReady();
  const dirCalls = new Map<string, number>();
  const readCalls = new Map<string, number>();
  const pendingDirs: ((r: ListDirPayload) => void)[] = [];
  const pendingReads: ((r: ReadTextPayload) => void)[] = [];
  const pendingErrors: ((e: Error) => void)[] = [];
  const actions: { path: string; action: string }[] = [];
  ipcMain.handle(INVOKE_CHANNELS.protocolVersion, () => IPC_PROTOCOL_VERSION);
  ipcMain.handle(INVOKE_CHANNELS.getSettings, () => ({ theme: 'system' }));
  ipcMain.handle(INVOKE_CHANNELS.workspaceListDir, async (_event, path: string) => {
    const n = (dirCalls.get(path) ?? 0) + 1; dirCalls.set(path, n);
    if (path === '01-delayed' && n === 1) return new Promise<ListDirPayload>(done => pendingDirs.push(done));
    if (path === '02-retry' && n === 1) return { ok: false, error: '目录读取暂时失败（受控 IPC）' };
    return listDir(workspace, path);
  });
  ipcMain.handle(INVOKE_CHANNELS.workspaceReadText, async (_event, path: string) => {
    const n = (readCalls.get(path) ?? 0) + 1; readCalls.set(path, n);
    if (path === 'A-slow.txt') return new Promise<ReadTextPayload>(done => pendingReads.push(done));
    if (path === 'C-reject.txt') return new Promise<ReadTextPayload>((_done, reject) => pendingErrors.push(reject));
    if (path === 'broken.txt' && n === 1) return { ok: false, error: '文件读取暂时失败（受控 IPC）' };
    return readTextFile(workspace, path);
  });
  ipcMain.handle(INVOKE_CHANNELS.workspacePathAction, (_event, path: string, action: string) => {
    actions.push({ path, action }); return { ok: true, path: join(workspace, path) };
  });
  const win = new BrowserWindow({ width: 720, height: 700, show: false, webPreferences: {
    preload: join(__dirname, '../dist-electron/preload.cjs'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
  } });
  const errors: string[] = [];
  win.webContents.on('console-message', d => { if (d.level === 'error') errors.push(d.message); });
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const frame = (): Promise<unknown> => js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const row = (path: string): string => `.fp-row[data-path=${JSON.stringify(path)}]`;
  const click = async (selector: string): Promise<void> => { await js(`document.querySelector(${JSON.stringify(selector)}).click()`); await frame(); };
  const focus = async (path: string): Promise<void> => { await js(`document.querySelector(${JSON.stringify(row(path))}).focus()`); await frame(); };
  const key = async (keyCode: string): Promise<void> => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode });
    if (keyCode === 'Enter' || keyCode === 'Space') win.webContents.sendInputEvent({ type: 'char', keyCode: keyCode === 'Enter' ? '\r' : ' ' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode }); await frame();
  };
  const focused = (): Promise<string | null> => js(`document.activeElement?.getAttribute('data-path')`);
  const shot = async (name: string): Promise<void> => { await frame(); writeFileSync(join(output, name + '.png'), (await win.webContents.capturePage()).toPNG()); };
  const waitRow = (path: string): Promise<void> => waitFor(() => js(`!!document.querySelector(${JSON.stringify(row(path))})`), `树行 ${path}`);
  const waitText = (text: string): Promise<void> => waitFor(() => js(`document.querySelector('.file-preview')?.textContent.includes(${JSON.stringify(text)})`), text);
  await win.loadFile(join(__dirname, '../dist/index.html'), { hash: 'pane=file' });
  await waitRow('00-empty');
  const initialTabs = await js(`[...document.querySelectorAll('.file-tree .fp-row')].filter(el=>el.tabIndex===0).map(el=>el.dataset.path)`);
  check('首次加载只有一个树 Tab 停点', initialTabs.length === 1 && initialTabs[0] === '00-empty', initialTabs);
  await shot('01-initial');
  await focus('00-empty'); await key('Right');
  await waitFor(() => js(`document.querySelector(${JSON.stringify(row('00-empty'))}).getAttribute('aria-expanded')==='true'`), '空目录展开');
  await key('Right');
  check('空目录再按右键不跳到无关兄弟', await focused() === '00-empty', await focused());
  await focus('01-delayed'); await key('Right');
  await waitFor(() => pendingDirs.length === 1, '目录延迟边界');
  await key('Right');
  check('目录加载中按右键保持当前目录焦点', await focused() === '01-delayed', await focused());
  await focus('01-delayed'); await key('Left'); await key('Right');
  await waitRow('01-delayed/fresh.txt');
  pendingDirs.shift()!({ ok: true, path: '01-delayed', entries: [{ name: 'obsolete.txt', kind: 'file', size: 0 }], truncated: false });
  await frame();
  check('同目录旧响应不覆盖后发请求', await js(`!!document.querySelector(${JSON.stringify(row('01-delayed/fresh.txt'))})&&!document.querySelector(${JSON.stringify(row('01-delayed/obsolete.txt'))})`));
  await focus('01-delayed'); await key('Right');
  check('展开目录右键进入直属子行', await focused() === '01-delayed/fresh.txt', await focused());
  await key('Left');
  check('子文件左键返回父目录', await focused() === '01-delayed');
  await key('Left');
  check('目录左键收起且保留焦点与 aria 状态', await js(`document.activeElement.dataset.path==='01-delayed'&&document.activeElement.getAttribute('aria-expanded')==='false'`));
  await focus('02-retry'); await key('Enter');
  await waitFor(() => js(`document.querySelector('.file-tree')?.textContent.includes('目录读取暂时失败')`), '目录失败可见');
  await key('Right');
  check('目录失败时右键不跳到无关兄弟', await focused() === '02-retry', await focused());
  await shot('02-directory-error');
  await click('.file-tree .mini-btn');
  await waitFor(() => dirCalls.get('02-retry') === 2 && js(`!document.querySelector('.file-tree [role=alert]')`), '目录重试恢复');
  check('目录失败可原地重试恢复', await js(`document.querySelector('.file-tree').textContent.includes('空目录')&&!document.querySelector('.file-tree [role=alert]')`));
  await focus('B-fast.txt'); await key('Home'); check('Home 到第一行', await focused() === '00-empty');
  await key('Down'); check('下键到相邻可见行', await focused() === '01-delayed');
  await key('Up'); check('上键回到前一行', await focused() === '00-empty');
  await key('End'); check('End 到最后行', await focused() === 'wide.txt');
  await focus('03-large'); await key('Space');
  await waitRow('03-large/000.txt');
  check('目录真实超过 500 项时明确显示截断和已显示数量', await js(`document.querySelector('.file-tree').textContent.includes('只显示前 500 项')&&document.querySelectorAll('[data-parent="03-large"]').length===500`));
  await focus('03-large'); await key('Left');
  await click(row('A-slow.txt')); await waitFor(() => pendingReads.length === 1, '文件延迟边界');
  await click(row('B-fast.txt')); await waitText('CURRENT_FILE_CONTENT');
  pendingReads.shift()!({ ok: true, path: 'A-slow.txt', text: 'SLOW_OLD_CONTENT', truncated: false, size: 16 }); await frame();
  check('旧文件成功响应不覆盖新预览', await js(`document.querySelector('.fp-text')?.textContent==='CURRENT_FILE_CONTENT'&&document.querySelector('.fp-preview-path')?.textContent==='B-fast.txt'`));
  await click(row('C-reject.txt')); await waitFor(() => pendingErrors.length === 1, '旧失败延迟边界');
  await click(row('B-fast.txt')); await waitText('CURRENT_FILE_CONTENT');
  pendingErrors.shift()!(new Error('旧文件失败响应')); await frame();
  check('旧文件异常响应不覆盖新预览', await js(`document.querySelector('.fp-text')?.textContent==='CURRENT_FILE_CONTENT'&&!document.querySelector('.file-preview [role=alert]')`));
  await click(row('broken.txt')); await waitText('文件读取暂时失败');
  await shot('03-preview-error'); await click('.file-preview .mini-btn'); await waitText('RECOVERED_FILE');
  check('文件读取失败可原地重试恢复', await js(`document.querySelector('.fp-text')?.textContent==='RECOVERED_FILE'&&!document.querySelector('.file-preview [role=alert]')`));
  await click(row('binary.bin')); await waitText('二进制文件不预览');
  check('真实二进制文件明确拒绝预览', await js(`!!document.querySelector('.file-preview [role=alert]')&&!document.querySelector('.fp-text')`));
  await click(row('wide.txt')); await waitFor(() => js(`document.querySelector('.fp-text')?.textContent.length===524288`), '真实预览截断');
  check('真实超长文件显示截断提示', await js(`document.querySelector('.file-preview').textContent.includes('已截断')`));
  await click(row('src')); await waitRow('src/很长的目录名称与中文路径'); await click(row('src/很长的目录名称与中文路径')); await waitRow(longPath);
  await focus(longPath); await key('Enter'); await waitText('中文内容与 emoji 🌍');
  check('Enter 打开文件，选中态与完整相对路径可读', await js(`document.querySelector(${JSON.stringify(row(longPath))}).getAttribute('aria-selected')==='true'&&document.querySelector('.fp-preview-path').textContent===${JSON.stringify(longPath)}&&document.querySelector('.fp-preview-path').title===${JSON.stringify(longPath)}`));
  check('打开预览后仍明确显示只读状态', await js(`document.querySelector('.file-preview').textContent.includes('只读')`));
  await win.setContentSize(360, 640); await frame();
  const layout = await js(`(()=>{const p=document.querySelector('.fp-preview-path');const tree=document.querySelector('.file-tree'); return {viewport:innerWidth,body:document.documentElement.scrollWidth,pathWidth:p.clientWidth,pathScroll:p.scrollWidth,treeWidth:tree.clientWidth,treeScroll:tree.scrollWidth};})()`);
  check('窄面板长路径可换行完整阅读且无横向溢出', layout.body <= layout.viewport && layout.pathScroll <= layout.pathWidth + 1 && layout.treeScroll <= layout.treeWidth + 1, layout);
  await shot('04-long-path-narrow');
  nativeTheme.themeSource = 'dark'; await waitFor(() => js(`document.documentElement.dataset.theme==='dark'&&document.body.hasAttribute('data-ds-dark-theme')`), '系统暗色主题同步'); await shot('05-dark-narrow');
  await win.setContentSize(720, 700);
  await js(`document.querySelector(${JSON.stringify(row(longPath))}).dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:150,clientY:180}))`); await frame();
  check('文件右键路径菜单仍包含已有动作', await js(`document.querySelector('.path-menu')?.textContent.includes('复制路径（绝对）')&&document.querySelector('.path-menu')?.textContent.includes('在 Finder 中显示')&&document.querySelector('.pm-head')?.textContent===${JSON.stringify(longPath)}`));
  await js(`[...document.querySelectorAll('.path-menu button')].find(b=>b.textContent==='在 Finder 中显示').click()`);
  await waitFor(() => actions.length === 1, '右键 IPC');
  check('路径菜单通过生产 preload 携带准确相对路径和动作', actions[0].path === longPath && actions[0].action === 'reveal', actions[0]);
  check('渲染过程无控制台错误', errors.length === 0, errors);
  save(); win.destroy(); app.exit(checks.every(c => c.ok) ? 0 : 1);
}
setTimeout(() => { console.error('file-pane-renderer-smoke 超时'); save(); app.exit(1); }, 60000).unref();
main().catch(error => { console.error(error); checks.push({ name: 'smoke 完成所有步骤', ok: false, detail: String(error) }); save(); app.exit(1); });
