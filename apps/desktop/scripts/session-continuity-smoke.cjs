// Real main/preload/renderer and JSONL storage; a local scripted provider keeps this offline.
// pnpm --filter cairn-desktop build
// ELECTRON_RUN_AS_NODE= pnpm --filter cairn-desktop exec electron scripts/session-continuity-smoke.cjs [output-directory]
const { app, BrowserWindow, nativeTheme } = require('electron');
const { scheduleProfileCleanup } = require("./lib/profile-cleanup.cjs");
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
  scheduleProfileCleanup(root);
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
  // 演示模式仍由标题栏明确标注；账户入口在 2026-11-03 裁决后搬到全局轨底部（侧栏页脚已删）。
  check('标题栏常驻「演示模式」胶囊（说明在 title 里）', await js(`(() => {
    const el = document.querySelector('.tb-demo');
    if (!el) return false;
    return el.textContent.includes('演示模式') && (el.getAttribute('title') ?? '').includes('预录剧本');
  })()`));
  // 原判据钉 `.side-foot .avatar`（页脚里的文字入口）。页脚整块已按裁决删除，入口改挂
  // `.app-rail-user .avatar`（头像图标 + aria-label），所以这里改钉新落位并**加强**：
  // 页脚本体不许回来、服务状态点不许回来、入口是可点的真按钮且有无障碍名。
  check('侧栏页脚已删除，服务状态不外露；账户入口在全局轨底部且有名字', await js(`(() => {
    if (document.querySelector('.side-foot') || document.querySelector('.provider-dot')) return false;
    const el = document.querySelector('.app-rail-user button.avatar');
    if (!el || el.disabled) return false;
    return (el.getAttribute('aria-label') ?? '').includes('设置') && (el.getAttribute('title') ?? '').includes('设置');
  })()`));
  // 原判据要求「不显示说明」（`!document.querySelector('.empty-sub')`）。2026-11-08 公开就绪审计
  // 反过来要求首启把「agent 会干什么」说清楚 ⇒ 副标题是**故意在场**的。改钉新契约：引导墙与
  // 「开始使用」按钮仍不许有，副标题必须落在空屏工作面里（`.empty-below`）、文案与 STR 同源，
  // 且输入框当场可用——即「说明在场但不挡路」，比原来只判缺席更严。
  check('首启直接进入工作界面：无引导墙/开始使用按钮，说明副标题在场且不挡路', await js(`(() => {
    if (document.querySelector('.onboard')) return false;
    if ([...document.querySelectorAll('button')].some(el => el.textContent.trim() === '开始使用')) return false;
    const sub = document.querySelector('.empty-below .empty-sub');
    if (!sub || sub.textContent.trim() !== '描述任务，agent 在工作区里读代码、改代码、跑测试、交付结果。') return false;
    return !!document.querySelector('.composer-card textarea:not(:disabled)');
  })()`));
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
