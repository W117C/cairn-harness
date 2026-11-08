// 真实 renderer + 生产 preload + IPC + 生产全文检索；真实临时 JSONL，非目标接口为隔离 fixture。
import { app, BrowserWindow, ipcMain, nativeTheme } from 'electron';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { closeAllEventLogs, createEventLog, replay, type AgentEvent } from '../../../src/events';
import { searchSessions, type SessionSearchResult } from '../../../src/main/session-search';
import { SessionMetadataRepository } from '../../../src/main/session-metadata';
import { INVOKE_CHANNELS } from '../src/main/channels';
import { IPC_PROTOCOL_VERSION } from '../../../src/main/ipc-protocol';

const profile = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-session-search-renderer-')));
const workspace = join(profile, 'workspace-a');
const otherWorkspace = join(profile, 'workspace-b');
for (const ws of [workspace, otherWorkspace]) mkdirSync(join(ws, '.agent', 'sessions'), { recursive: true });
const root = join(workspace, '.agent', 'sessions');
const output = resolve(process.argv[2] ?? 'session-search-renderer');
mkdirSync(output, { recursive: true });
app.setPath('userData', profile);
nativeTheme.themeSource = 'light';
app.on('window-all-closed', () => {});
app.on('quit', () => rmSync(profile, { recursive: true, force: true }));
const checks: { name: string; ok: boolean; detail?: unknown }[] = [];
const skipped: string[] = [];
const calls: { workspace: string; query: string; at: number; kind?: string }[] = [];
const opened: { id: string; workspace: string | undefined }[] = [];
const contexts: string[] = [];
const errors: string[] = [];
const check = (name: string, ok: boolean, detail?: unknown): void => {
  checks.push({ name, ok, detail: structuredClone(detail) }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail === undefined ? '' : JSON.stringify(detail)}`);
};
const save = (): void => writeFileSync(join(output, 'checks.json'), JSON.stringify({ checks, skipped, calls, opened, contexts, errors, protocolVersion: IPC_PROTOCOL_VERSION }, null, 2));
const pause = (ms: number): Promise<void> => new Promise(done => setTimeout(done, ms));
const waitFor = async (condition: () => boolean | Promise<boolean>, title: string, ms = 5000): Promise<void> => {
  const start = Date.now();
  while (Date.now() - start < ms) { if (await condition()) return; await pause(20); }
  throw new Error(`超时：${title}`);
};
async function main(): Promise<void> {
  const writeSession = async (ws: string, id: string, body: AgentEvent[], age: number): Promise<void> => {
    const path = join(ws, '.agent', 'sessions', id + '.jsonl');
    const log = createEventLog(path);
    await log.append({ type: 'session_meta' });
    for (const event of body) await log.append(event);
    const stamp = new Date(Date.now() - age); utimesSync(path, stamp, stamp);
  };
  await writeSession(workspace, 'recent-session', [
    { type: 'user_message', content: '今天的任务' },
    { type: 'thinking_delta', callId: 'hidden', text: 'PRIVATE_HINT_ONLY' },
    { type: 'assistant_message', content: '当前会话内容' },
  ], 1000);
  await writeSession(workspace, 'shared-session', [
    { type: 'user_message', content: '检索样本：Nebula 与紫罗兰只在正文中出现。' },
    { type: 'assistant_message', content: 'lagone lagerror lagclear unavailablemarker retrymarker' },
  ], 86400000 * 30);
  await writeSession(workspace, 'new-session', [
    { type: 'assistant_message', content: 'newword partialmarker，这份是新查询结果。' },
  ], 0);
  await writeSession(otherWorkspace, 'shared-session', [
    { type: 'assistant_message', content: '这是另一个项目的同名会话，禁止开错。' },
  ], 0);
  const metadata = new SessionMetadataRepository(join(profile, 'session-metadata.json'));
  const now = new Date().toISOString();
  for (const [id, title] of [['shared-session', '旧工程笔记'], ['new-session', '较新记录']]) await metadata.restore({ id, title, pinned: false, archived: false, createdAt: now, updatedAt: now });
  await app.whenReady();
  const pending = new Map<string, { resolve: (result: SessionSearchResult) => void; reject: (error: Error) => void; result: SessionSearchResult }>();
  const attempts = new Map<string, number>();
  const sessions = [
    { id: 'recent-session', title: '今日任务', workspace, mtimeMs: Date.now(), lines: 4 },
    // A 下的旧会话刻意不进标题列表；B 下有同名 id，必须靠结果传 workspace 才能开对。
    { id: 'shared-session', title: '另一个项目的同名会话', workspace: otherWorkspace, mtimeMs: Date.now() - 1000, lines: 2 },
  ];
  const projects = [workspace, otherWorkspace].map((path, i) => ({ id: path, name: `项目 ${i === 0 ? 'A' : 'B'}`, path, createdAt: now, updatedAt: now, defaultLocation: 'local' }));
  const settings = { mode: 'guided', theme: 'system', provider: 'demo', model: '', onboarded: true };
  const base: Record<string, (...args: any[]) => unknown> = {
    protocolVersion: () => IPC_PROTOCOL_VERSION,
    getSettings: () => settings,
    setSettings: () => settings,
    getProviderInfo: () => ({ kind: 'demo', provider: 'demo', model: 'demo', modelId: '', models: [], keyConfigured: true }),
    providerKeyStatus: () => ({ available: true, stored: [], envActive: false, envProviders: [] }),
    listSessions: () => sessions,
    listProjects: () => projects,
    listSkills: () => ({ skills: [], commands: [] }),
    getOnboarding: () => [],
    projectTemplates: () => [],
    queueGet: () => ({ items: [] }),
    queueSet: () => ({ ok: true }),
    listFeedback: () => [],
    listMessagePins: () => [],
    capabilities: () => ({ search: { kind: 'unset' }, vision: { state: 'undeclared', modelId: null, declaredModalities: [] }, workspace }),
    getState: () => ({ plugins: { plugins: [], looseSkills: [], mcpServers: [], toolScopes: [], errors: [], warnings: [] } }),
    gitStatus: () => ({ ok: false }),
    workspaceListDir: () => ({ ok: true, path: '', entries: [], truncated: false }),
    workspaceReadText: () => ({ ok: false, error: 'fixture 未提供文件' }),
    touchProject: (id: string) => projects.find(p => p.id === id),
    setWorkspaceContext: (ws: string) => { contexts.push(ws); return { ok: true }; },
    openSession: async (id: string, ws?: string) => {
      opened.push({ id, workspace: ws });
      const owner = ws ?? sessions.find(s => s.id === id)?.workspace;
      if (owner !== workspace && owner !== otherWorkspace) throw new Error('搜索打开了未登记的工作区');
      return { events: await replay(join(owner, '.agent', 'sessions', id + '.jsonl')) };
    },
    run: () => { throw new Error('smoke 不运行模型'); },
    openExternal: () => { throw new Error('smoke 不打开外站'); },
  };
  // 非目标 IPC 接口只提供挂载所需形状；正文检索独立注册，始终执行生产核心扫描。
  for (const [name, channel] of Object.entries(INVOKE_CHANNELS)) {
    if (name === 'sessionSearch') continue;
    ipcMain.handle(channel, (_event, ...args: unknown[]) => base[name]?.(...args) ?? (name.startsWith('list') ? [] : {}));
  }
  ipcMain.handle(INVOKE_CHANNELS.sessionSearch, async (_event, ws: string, query: string) => {
    const call = { workspace: ws, query, at: Date.now(), kind: undefined as string | undefined }; calls.push(call);
    if (ws !== workspace) throw new Error(`正文检索工作区不匹配：${ws}`);
    const n = (attempts.get(query) ?? 0) + 1; attempts.set(query, n);
    if (query === 'retrymarker' && n === 1) throw new Error('搜索受控失败，请重试');
    const result = await searchSessions({
      root: query === 'unavailablemarker' && n === 1 ? join(profile, 'missing-sessions') : root,
      query, metadataById: new Map((await metadata.list()).map(r => [r.id, r])),
      ...(query === 'partialmarker' ? { maxSessions: 1 } : {}),
    });
    call.kind = result.kind;
    if (['lagone', 'lagerror', 'lagclear'].includes(query)) return new Promise<SessionSearchResult>((resolve, reject) => pending.set(query, { resolve, reject, result }));
    return result;
  });
  const win = new BrowserWindow({ width: 1200, height: 800, show: false, webPreferences: {
    preload: join(__dirname, '../dist-electron/preload.cjs'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
  } });
  win.webContents.on('console-message', d => { if (d.level === 'error') errors.push(d.message); });
  const js = (source: string) => win.webContents.executeJavaScript(source);
  const frame = () => js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const shot = async (name: string) => {
    await js(`Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect?.getComputedTiming().endTime)).map(a=>a.finished.catch(()=>undefined)))`);
    await frame(); writeFileSync(join(output, name + '.png'), (await win.webContents.capturePage()).toPNG());
  };
  const query = async (text: string) => {
    await js(`(()=>{const input=document.querySelector('.cp-input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(text)}); input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await frame();
  };
  const results = () => js(`[...document.querySelectorAll('[data-session-search-result]')].filter(el=>el.getBoundingClientRect().height>0&&!el.closest('[hidden]')).map(el=>({id:el.dataset.sessionSearchResult,text:el.innerText}))`);
  const panelText = () => js(`document.querySelector('.cp-panel')?.innerText??''`);
  const waitResult = (id: string) => waitFor(async () => (await results()).some((r: { id: string }) => r.id === id), `正文结果 ${id}`);
  const key = async (keyCode: string) => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode });
    if (keyCode === 'Enter') win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode }); await frame();
  };
  const retry = async () => {
    const found = await js(`(()=>{const b=[...document.querySelectorAll('.cp-panel button,.cp-panel [role=button]')].find(el=>el.textContent.includes('重试'));if(!b)return false;b.click();return true;})()`);
    check('失败状态提供原地重试入口', found); if (!found) throw new Error('失败状态没有重试按钮');
    await frame();
  };
  await win.loadFile(join(__dirname, '../dist/index.html'));
  await waitFor(() => js(`!!document.querySelector('.session')`), '会话 fixture 挂载');
  await js(`document.querySelector('.session').click()`);
  await waitFor(() => contexts.includes(workspace), '当前项目上下文成为 A');
  await js(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'k',code:'KeyK',metaKey:true,bubbles:true}))`);
  await waitFor(() => js(`!!document.querySelector('.cp-input')`), '命令面板打开');
  await pause(250); check('空查询不发送正文检索', calls.length === 0, calls);
  check('生产 preload 暴露正文检索 IPC', await js(`typeof window.agent.sessionSearch==='function'`));
  await query('NEBULA');
  let wired = true;
  try { await waitFor(() => calls.length > 0, '非空查询触达正文检索', 1600); } catch { wired = false; }
  check('非空查询通过生产 preload 发起正文检索', wired, calls);
  if (!wired) {
    check('标题无关键词的旧会话正文命中可见', (await results()).some((r: { id: string }) => r.id === 'shared-session'));
    skipped.push('中英文正文匹配、200ms debounce、迟到成功/失败/清空保护、partial/unavailable/错误重试、空结果、键盘workspace身份：依赖renderer调用目标IPC，基线尚未接线');
    await shot('01-missing-search-wiring'); save(); win.destroy(); await closeAllEventLogs(); app.exit(1); return;
  }
  check('正文检索带当前项目身份', calls[0].workspace === workspace, calls[0]);
  await waitResult('shared-session');
  const first = await results();
  check('英文忽略大小写，标题无关键词的旧正文会话可见', first.length === 1 && first[0].id === 'shared-session' && /nebula/i.test(first[0].text), first);
  await shot('02-english-body-match');
  const beforeDebounce = calls.length;
  await query('NE'); await pause(60); await query('NEBULA'); await pause(100);
  check('连续输入在200ms窗口内不提前请求', calls.length === beforeDebounce, calls.slice(beforeDebounce));
  await waitFor(() => calls.length > beforeDebounce, 'debounce 后一次请求');
  check('连续输入只请求最终查询', calls.length === beforeDebounce + 1 && calls.at(-1)?.query === 'NEBULA', calls.slice(beforeDebounce));
  await query('紫罗兰'); await waitResult('shared-session');
  check('中文正文关键词和摘录可见', (await results()).some((r: { id: string; text: string }) => r.id === 'shared-session' && r.text.includes('紫罗兰')));
  await query('lagone'); await waitFor(() => pending.has('lagone'), '旧查询已执行真实扫描');
  await query('newword'); await waitResult('new-session');
  pending.get('lagone')!.resolve(pending.get('lagone')!.result); await frame();
  check('迟到旧查询成功不覆盖新查询结果', (await results()).length === 1 && (await results())[0].id === 'new-session');
  await query('lagerror'); await waitFor(() => pending.has('lagerror'), '旧查询延迟失败边界');
  await query('紫罗兰'); await waitResult('shared-session');
  pending.get('lagerror')!.reject(new Error('过时查询失败')); await frame();
  check('迟到旧查询失败不污染当前结果和状态', (await results()).some((r: { id: string }) => r.id === 'shared-session') && !(await panelText()).includes('过时查询失败'));
  await query('lagclear'); await waitFor(() => pending.has('lagclear'), '清空前查询边界');
  const beforeBlank = calls.length; await query('  ');
  pending.get('lagclear')!.resolve(pending.get('lagclear')!.result); await pause(300);
  check('全空白不请求且清空后迟到结果不残留', calls.length === beforeBlank && (await results()).length === 0);
  await query('PRIVATE_HINT_ONLY');
  await waitFor(() => calls.at(-1)?.query === 'PRIVATE_HINT_ONLY' && calls.at(-1)?.kind === 'ok', '零命中真实扫描结束'); await frame();
  check('只有思考事件中的词不冒充正文命中，完整零命中可见', (await results()).length === 0 && /没有匹配|没有找到|无匹配/.test(await panelText()), await panelText());
  await query('partialmarker'); await waitResult('new-session');
  check('真实扫描上限返回partial，保留命中并如实提示未完成', calls.at(-1)?.kind === 'partial' && /部分|未完成|未扫|可能还有|截断/.test(await panelText()) && !(await panelText()).includes('没有匹配的结果'), await panelText());
  await shot('03-partial');
  await query('unavailablemarker');
  await waitFor(() => calls.at(-1)?.query === 'unavailablemarker' && calls.at(-1)?.kind === 'unavailable', '真实缺失根目录'); await frame();
  check('unavailable如实显示，不能写成没有匹配', /不可用|无法|未能|root-missing|未.*检索/.test(await panelText()) && !(await panelText()).includes('没有匹配的结果'), await panelText());
  await shot('04-unavailable'); await retry(); await waitResult('shared-session');
  check('不可用后原地重试执行真实扫描并恢复', attempts.get('unavailablemarker') === 2 && calls.at(-1)?.kind === 'ok');
  await query('retrymarker');
  await waitFor(() => panelText().then(t => t.includes('搜索受控失败')), 'IPC错误上屏');
  await shot('05-ipc-error'); await retry(); await waitResult('shared-session');
  check('IPC异常可原地重试恢复', attempts.get('retrymarker') === 2 && calls.at(-1)?.kind === 'ok');
  await query('紫罗兰'); await waitResult('shared-session'); await js(`document.querySelector('.cp-input').focus()`);
  const beforeOpen = opened.length; await key('Down'); await key('Enter');
  await waitFor(() => opened.length > beforeOpen, '原生键盘打开匹配会话');
  check('键盘打开正文匹配携带准确workspace，同名会话不串项目', opened.at(-1)?.id === 'shared-session' && opened.at(-1)?.workspace === workspace, opened.at(-1));
  await waitFor(() => js(`document.body.textContent.includes('检索样本')&&!document.querySelector('.cp-input')`), '正确项目正文实际上屏');
  check('搜索打开当前项目真实JSONL并关闭命令面板', await js(`document.body.textContent.includes('Nebula 与紫罗兰')&&!document.body.textContent.includes('禁止开错')&&!document.querySelector('.cp-input')`));
  check('正文结果不借用另一项目同名会话的标题', await js(`document.querySelector('.tb-title')?.textContent==='shared-session'`));
  check('搜索打开未列出的旧会话不高亮另一项目的同名行', await js(`document.querySelectorAll('.session.active').length===0`));
  await shot('06-opened-correct-workspace');
  check('渲染过程无控制台错误', errors.length === 0, errors);
  save(); win.destroy(); await closeAllEventLogs(); app.exit(checks.every(c => c.ok) ? 0 : 1);
}
setTimeout(() => { console.error('session-search-renderer-smoke 超时'); save(); app.exit(1); }, 60000).unref();
main().catch(error => { console.error(error); checks.push({ name: '完成全部搜索验证步骤', ok: false, detail: String(error) }); save(); app.exit(1); });
