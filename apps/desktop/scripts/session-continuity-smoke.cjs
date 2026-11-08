// Real main/preload/renderer and JSONL storage; a local scripted provider keeps this offline.
// pnpm --filter cairn-desktop build
// ELECTRON_RUN_AS_NODE= pnpm --filter cairn-desktop exec electron scripts/session-continuity-smoke.cjs [output-directory]
const { app, BrowserWindow, nativeTheme } = require('electron');
const { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');

const root = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-continuity-')));
const profile = join(root, 'profile');
const workspace = join(root, 'workspace');
const out = resolve(process.argv[2] ?? mkdtempSync(join(tmpdir(), 'cairn-continuity-evidence-')));
for (const path of [profile, workspace, out]) mkdirSync(path, { recursive: true });
app.setPath('userData', profile);
app.setAppPath(resolve(__dirname, '..'));
nativeTheme.themeSource = 'dark';
writeFileSync(join(profile, 'settings.json'), JSON.stringify({ provider: 'demo', model: '', autoMemory: false, onboarded: false }));
const script = join(root, 'provider.jsonl');
writeFileSync(script, JSON.stringify({ type: 'assistant_message', content: '已收到本轮消息。' }) + '\n');
process.env.CAIRN_DESKTOP_WORKSPACE = workspace;
process.env.M0B_WORKSPACE = workspace;
process.env.M0A_PROVIDER = 'demo';
process.env.M3A_MAIN_SCRIPT = script;
delete process.env.CAIRN_SMOKE;

const checks = [];
const errors = [];
const check = (name, ok, detail) => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + JSON.stringify(detail)}`);
};
const pause = () => new Promise((r) => setTimeout(r, 40));
async function waitFor(predicate, label) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) { if (await predicate()) return; await pause(); }
  throw new Error('Timed out: ' + label);
}
function transcripts() {
  const dir = join(workspace, '.agent', 'sessions');
  try {
    return readdirSync(dir).filter((name) => name.endsWith('.jsonl')).map((name) => ({
      name,
      messages: readFileSync(join(dir, name), 'utf8').split('\n').filter(Boolean)
        .map((line) => JSON.parse(line)).filter((e) => e.type === 'user_message').map((e) => e.content),
    }));
  } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}
function finish(code) {
  writeFileSync(join(out, 'checks.json'), JSON.stringify({ checks, errors, transcripts: transcripts() }, null, 2));
  for (const win of BrowserWindow.getAllWindows()) win.destroy();
  rmSync(root, { recursive: true, force: true });
  console.log('Evidence: ' + out);
  app.exit(code);
}
require('../src/main/entry.cjs');

async function main() {
  await app.whenReady();
  await waitFor(() => BrowserWindow.getAllWindows().length > 0, 'main window');
  const win = BrowserWindow.getAllWindows()[0];
  win.webContents.setBackgroundThrottling(false);
  win.showInactive();
  win.webContents.on('console-message', (details) => { if (details.level === 'error') errors.push(details.message); });
  const js = (source) => win.webContents.executeJavaScript(source);
  await waitFor(() => js('!!document.querySelector(".composer-card textarea")'), 'composer');
  await waitFor(() => js('document.querySelector(".mp-trigger")?.textContent.includes("演示")'), 'demo provider settings');
  await waitFor(() => js('!document.getElementById("boot") || getComputedStyle(document.getElementById("boot")).visibility === "hidden"'), 'startup overlay dismissed');
  // 演示模式仍由标题栏明确标注；页脚只留用户菜单。
  check('标题栏常驻「演示模式」胶囊（说明在 title 里）', await js(`(() => {
    const el = document.querySelector('.tb-demo');
    if (!el) return false;
    return el.textContent.includes('演示模式') && (el.getAttribute('title') ?? '').includes('预录剧本');
  })()`));
  check('页脚不显示服务状态，用户菜单名称可见', await js(`!document.querySelector('.provider-dot') && document.querySelector('.side-foot .avatar')?.textContent.includes('设置与偏好') === true`));
  check('首启直接进入工作界面，不显示设置检查、说明或开始使用按钮', await js(`!document.querySelector('.onboard') && !document.querySelector('.empty-sub') && ![...document.querySelectorAll('button')].some(el => el.textContent.trim() === '开始使用')`));
  check('首启输入框和模型入口可直接操作', await js(`!!document.querySelector('.composer-card textarea:not(:disabled)') && !!document.querySelector('.mp-trigger:not(:disabled)')`));
  check('旧的 onboarded=false 偏好无需改写即可使用', (await js('window.agent.getSettings()')).onboarded === false);
  await js('new Promise((resolve) => setTimeout(resolve, 500))');
  writeFileSync(join(out, '01-home.png'), (await win.webContents.capturePage()).toPNG());

  async function send(text, count) {
    await js(`(() => {
      const ta = document.querySelector('.composer-card textarea');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, ${JSON.stringify(text)});
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await waitFor(() => js('!!document.querySelector(".send-btn:not(.stop):not(:disabled)")'), 'send enabled');
    await js('document.querySelector(".send-btn:not(.stop)").click()');
    await waitFor(() => transcripts().reduce((sum, t) => sum + t.messages.length, 0) === count, 'message persisted');
    await waitFor(() => js('!document.querySelector(".send-btn.stop")'), 'run finished');
  }
  const messages = ['你好', '介绍一下自己', '你可以干什么'];
  for (let i = 0; i < messages.length; i++) await send(messages[i], i + 1);
  let logs = transcripts();
  check('连续三次发送只创建一个日志，消息按顺序追加', logs.length === 1 && JSON.stringify(logs[0].messages) === JSON.stringify(messages), logs);
  check('当前对话同时显示三条用户消息', await js(`${JSON.stringify(messages)}.every(text => document.querySelector('.stream')?.innerText.includes(text))`));
  // Let the message entrance finish before capturing its visual state.
  await js('new Promise(resolve => setTimeout(resolve, 400))');
  writeFileSync(join(out, '02-three-rounds.png'), (await win.webContents.capturePage()).toPNG());

  win.reload();
  await waitFor(() => js(`${JSON.stringify(messages)}.every(text => document.querySelector('.stream')?.innerText.includes(text))`), 'restored transcript');
  check('重载后恢复同一对话及三条历史消息', true);
  await send('继续这个对话', 4);
  logs = transcripts();
  check('恢复后的续发仍追加到原日志', logs.length === 1 && logs[0].messages[3] === '继续这个对话', logs);

  await js('document.dispatchEvent(new KeyboardEvent("keydown", { key: "n", code: "KeyN", metaKey: true, bubbles: true }))');
  await waitFor(() => js('!document.querySelector(".stream") && !!document.querySelector(".composer-card textarea")'), 'explicit new task');
  await send('这是一个新任务', 5);
  logs = transcripts();
  check('显式新建任务后才创建第二个对话，原对话完整保留', logs.length === 2 && logs.some((t) => t.messages.length === 4) && logs.some((t) => JSON.stringify(t.messages) === '["这是一个新任务"]'), logs);
  check('真实渲染过程无控制台错误', errors.length === 0, errors);
  finish(checks.every((c) => c.ok) ? 0 : 1);
}
const watchdog = setTimeout(() => { console.error('continuity smoke timeout'); finish(2); }, 90000);
watchdog.unref();
main().catch((error) => { console.error(error); finish(2); });
