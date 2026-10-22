// 指针分叉真机冒烟（计划 Task 9）：真实 main + preload + 构建后的 renderer；临时 profile / 两个项目；
// 不调模型、不出网。验证：父前缀在视图里、产品分叉只写血缘、来源搜索、带来源的反馈/置顶、
// 祖先轮的文件回滚、父依赖拒绝改名/删除。
const { app, BrowserWindow } = require('electron');
const { createHash } = require('node:crypto');
const { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');

const root = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-ref-smoke-')));
const profile = join(root, 'profile');
const workspaceA = join(root, 'A');
const workspaceB = join(root, 'B');
for (const dir of [profile, workspaceA, workspaceB]) mkdirSync(dir);
app.setPath('userData', profile);
app.setAppPath(resolve(__dirname, '..'));
process.env.CAIRN_DESKTOP_WORKSPACE = workspaceA;

const output = resolve(process.argv[2] ?? 'session-reference-checks.json');
const checks = [];
const check = (name, ok, detail) => { checks.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + JSON.stringify(detail)}`); };
const save = () => writeFileSync(output, JSON.stringify({ checks, root }, null, 2));
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const cleanup = () => {
  for (const win of BrowserWindow.getAllWindows()) win.destroy();
  rmSync(root, { recursive: true, force: true });
};
async function waitFor(fn, label) {
  const until = Date.now() + 20000;
  while (Date.now() < until) { if (await fn()) return; await pause(40); }
  throw Error('timeout: ' + label);
}
function writeSession(workspace, id, events) {
  const sessions = join(workspace, '.agent', 'sessions');
  mkdirSync(sessions, { recursive: true });
  const path = join(sessions, id + '.jsonl');
  writeFileSync(path, events.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return path;
}

// A 工作区：parent（含一次写 a.ts 的轮）+ 指针子会话；B 工作区：同名会话用于归属隔离。
const snapshotId = `${join(workspaceA, '.agent', 'snapshots', '1--c1', 'a.ts')}`;
mkdirSync(join(workspaceA, '.agent', 'snapshots', '1--c1'), { recursive: true });
writeFileSync(join(workspaceA, 'a.ts'), 'NEW\n');
writeFileSync(snapshotId, 'OLD\n');
const parentPath = writeSession(workspaceA, 'parent', [
  { type: 'user_message', content: 'PARENT_ROUND_ONE' },
  { type: 'tool_call', id: 'c1', name: 'write_file', args: { path: 'a.ts' } },
  { type: 'tool_result', callId: 'c1', ok: true, output: 'wrote', snapshotId: '.agent/snapshots/1--c1/a.ts', change: 'modified' },
  { type: 'assistant_message', content: 'PARENT_ANSWER' },
  { type: 'user_message', content: 'PARENT_ROUND_TWO' },
  { type: 'assistant_message', content: 'PARENT_ANSWER_2' },
]);
const childPath = writeSession(workspaceA, 'child', [
  { type: 'session_meta', fork: { from_session_path: parentPath, boundary_event_id: 4, from_session_id: 'parent' } },
  { type: 'user_message', content: 'CHILD_LOCAL' },
]);
writeSession(workspaceB, 'same', [{ type: 'user_message', content: 'B_ONLY' }]);
void childPath;
void workspaceB;

require('../src/main/entry.cjs');

async function main() {
  await app.whenReady();
  await waitFor(() => BrowserWindow.getAllWindows().some((w) => !w.webContents.isLoading()), 'main window');
  const win = BrowserWindow.getAllWindows()[0];
  const call = (expression) => win.webContents.executeJavaScript(expression);
  await waitFor(() => call('!!document.querySelector(".composer-card textarea")'), 'main renderer');
  await call(`window.agent.addProject({path:${JSON.stringify(workspaceB)}})`);
  await call(`window.agent.setWorkspaceContext(${JSON.stringify(workspaceA)})`);

  // ① 视图：父前缀 + 本地有效历史
  const opened = await call(`window.agent.openSession("child",${JSON.stringify(workspaceA)})`);
  const inherited = (opened.view?.entries ?? []).filter((e) => e.inherited);
  check('openSession 回传 SessionView 与父前缀', opened.session?.sessionId === 'child' &&
    inherited.some((e) => e.event.content === 'PARENT_ROUND_ONE') &&
    inherited.every((e) => e.ref.sessionId === 'parent'), opened.view?.entries?.map((e) => [e.ref, e.inherited]));
  check('父前缀保留物理行号（父第 1 行与子第 2 行各归各）',
    inherited.some((e) => e.ref.eventId === 1) && (opened.view?.entries ?? []).some((e) => e.ref.sessionId === 'child' && e.ref.eventId === 2));

  // ② 产品分叉：子文件只有血缘，父文件 sha 不变
  const parentBefore = sha(parentPath);
  const forked = await call(`window.agent.forkSession("child", 1, true, ${JSON.stringify(workspaceA)})`);
  check('产品分叉成功', forked.ok === true, forked);
  if (forked.ok && forked.id) {
    const sessions = join(workspaceA, '.agent', 'sessions');
    const raw = readFileSync(join(sessions, forked.id + '.jsonl'), 'utf8').trim().split('\n');
    check('子日志初始只有一行血缘（不复制父事件）', raw.length === 1 && raw[0].includes('"fork"'), raw);
    check('分叉后父日志 sha 不变', sha(parentPath) === parentBefore);
  }

  // ③ 来源搜索：祖先正文在子会话视图里命中，且带来源
  const search = await call(`window.agent.sessionSearch(${JSON.stringify(workspaceA)},"PARENT_ANSWER")`);
  const childHit = (search.matches ?? []).find((m) => m.sessionId === 'child');
  check('祖先正文可被搜索且带来源引用', search.kind === 'ok' && childHit?.snippets?.[0]?.ref?.sessionId === 'parent', childHit);

  // ④ 带来源的反馈/置顶
  const ref = { workspace: workspaceA, sessionId: 'parent', eventId: 4 };
  const fb = await call(`window.agent.submitFeedback({sessionId:"child",eventId:4,rating:"up",workspace:${JSON.stringify(workspaceA)},eventRef:${JSON.stringify(ref)}})`);
  const fbList = await call(`window.agent.listFeedback("child",${JSON.stringify(workspaceA)})`);
  check('祖先行的反馈落子会话并可读回来源', fb.ok === true && fbList.some((r) => r.eventRef?.sessionId === 'parent' && r.eventRef?.eventId === 4), { fb, fbList });
  const pin = await call(`window.agent.setMessagePinned({sessionId:"child",eventId:4,pinned:true,workspace:${JSON.stringify(workspaceA)},eventRef:${JSON.stringify(ref)}})`);
  const pins = await call(`window.agent.listMessagePins("child")`);
  check('祖先行的置顶保留来源', pin.ok === true && pins.some((p) => p.eventRef?.sessionId === 'parent' && p.eventRef?.eventId === 4), { pin, pins });

  // ⑤ 祖先轮的文件回滚：a.ts 回到 OLD，留痕写子会话
  const reverted = await call(`window.agent.revertTurn("child", 1, ${JSON.stringify(workspaceA)})`);
  check('祖先轮的文件回滚可执行', reverted.ok === true, reverted);
  check('盘上文件回到覆盖前内容', readFileSync(join(workspaceA, 'a.ts'), 'utf8') === 'OLD\n', readFileSync(join(workspaceA, 'a.ts'), 'utf8'));
  const childEvents = readFileSync(childPath, 'utf8');
  check('file_restored 落在子会话日志', childEvents.includes('file_restored') && childEvents.includes('"source_ref"'), childEvents.slice(-300));

  // ⑥ 父依赖拒绝破坏性操作
  const del = await call(`window.agent.deleteSession("parent", ${JSON.stringify(workspaceA)}).then((r)=>({rejected:false,r}), (e)=>({rejected:true,message:String(e)}))`);
  check('被指针依赖的父会话拒绝删除', del.rejected === true && String(del.message).includes('指针分叉依赖'), del);

  // ⑦ 两个同名会话互不串（B 另有 same 会话）
  const sameB = await call(`window.agent.openSession("same",${JSON.stringify(workspaceB)})`);
  check('同名会话按 workspace 精确打开', sameB.session?.workspace === workspaceB && sameB.events.some((e) => e.content === 'B_ONLY'));
  check('父日志仍未变', sha(parentPath) === parentBefore);
  save();
  cleanup();
  app.exit(checks.every((c) => c.ok) ? 0 : 1);
}

main().catch((error) => {
  console.error('SMOKE ERROR', error && error.stack ? error.stack : error);
  save();
  cleanup();
  app.exit(2);
});
