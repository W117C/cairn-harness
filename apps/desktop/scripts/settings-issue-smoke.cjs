// 真实主进程 + 真实 renderer：设置文件写坏时，设置页必须出「设置文件未生效」横幅
// （v26 StateResponse.settingsIssue 的端到端接线）。不使用产品用户数据：profile/工作区都在临时目录。
// ELECTRON_RUN_AS_NODE= pnpm --filter cairn-desktop exec electron scripts/settings-issue-smoke.cjs [输出目录]
const { app, BrowserWindow } = require('electron');
const { scheduleProfileCleanup } = require("./lib/profile-cleanup.cjs");
const { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');

const root = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-settings-issue-')));
const profile = join(root, 'profile');
const workspace = join(root, 'workspace');
const sessions = join(workspace, '.agent', 'sessions');
const out = resolve(process.argv[2] ?? mkdtempSync(join(tmpdir(), 'cairn-settings-issue-evidence-')));
for (const dir of [profile, sessions, out]) mkdirSync(dir, { recursive: true });
app.setPath('userData', profile);
app.setAppPath(resolve(__dirname, '..'));
// 坏设置文件：JSON 语法错，主进程首读结论记为 invalid-json。
writeFileSync(join(profile, 'settings.json'), '{ 这不是 JSON');
process.env.CAIRN_DESKTOP_WORKSPACE = workspace;
process.env.M0A_PROVIDER = 'demo';
delete process.env.CAIRN_SMOKE;
const now = Date.now();
writeFileSync(join(sessions, 'issue-sample.jsonl'), [
  { type: 'user_message', content: '设置读取问题样本', ts: now - 3000 },
  { type: 'assistant_message', content: '这是一条样本回复。', ts: now - 2000 },
].map((e) => JSON.stringify(e)).join('\n') + '\n');

const checks = [];
const errors = [];
const check = (name, ok, detail) => { checks.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + JSON.stringify(detail)}`); };
const pause = (ms = 50) => new Promise((r) => setTimeout(r, ms));
async function waitFor(predicate, label) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) { if (await predicate()) return; await pause(); }
  throw new Error('Timeout: ' + label);
}
function finish(code) {
  writeFileSync(join(out, 'checks.json'), JSON.stringify({ fixtureData: true, checks, errors }, null, 2));
  for (const win of BrowserWindow.getAllWindows()) win.destroy();
  scheduleProfileCleanup(root);
  console.log('Evidence: ' + out);
  app.exit(code);
}
require('../src/main/entry.cjs');

async function main() {
  await app.whenReady();
  await waitFor(() => BrowserWindow.getAllWindows().length > 0, 'window');
  const win = BrowserWindow.getAllWindows()[0];
  win.webContents.setBackgroundThrottling(false);
  win.showInactive();
  win.setSize(1320, 950);
  win.webContents.on('console-message', (details) => { if (details.level === 'error') errors.push(details.message); });
  const js = (source) => win.webContents.executeJavaScript(source, true);
  const shot = async (name) => { await pause(300); writeFileSync(join(out, name + '.png'), (await win.webContents.capturePage()).toPNG()); };

  await waitFor(() => js('!!document.querySelector(".session, .home-header, .empty-home")'), 'app shell');
  await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: ',', code: 'Comma', metaKey: true, bubbles: true }))`);
  await waitFor(() => js('!!document.querySelector(".sp-nav")'), 'settings panel');

  await waitFor(() => js('!!document.querySelector(".ss-banner.warn")'), 'settings issue banner');
  const banner = await js(`(() => {
    const el = document.querySelector('.ss-banner.warn');
    return { text: el.innerText, all: document.querySelector('.sp-body').innerText };
  })()`);
  check('设置文件坏了 ⇒ 设置页出警告横幅', banner.text.includes('设置文件未生效') && banner.text.includes('当前按缺省设置运行'), banner.text);
  await js(`document.querySelector('.ss-banner-details summary')?.click()`);
  await pause(200);
  const details = await js(`document.querySelector('.ss-banner-detail-body')?.innerText ?? ''`);
  check('详情点名盘上文件与原因', details.includes('settings.json') && details.includes('JSON 解析失败'), details);
  check('横幅不是空壳：设置面板本身照常加载', await js('!!document.querySelector(".sp-nav") && document.querySelectorAll(".sp-nav-item").length > 5'), null);
  check('没有「重新检查」这种点了不会恢复的按钮', !banner.all.includes('重新检查'), null);
  check('横幅给的是「重新读取」真按钮（v31）', await js(`document.querySelector('.ss-banner-action')?.textContent?.trim() === '重新读取'`), await js(`document.querySelector('.ss-banner-action')?.textContent ?? null`));
  await shot('01-settings-issue');

  // v31 恢复路径（真机、真主进程）：外部修好文件 → 点「重新读取」→ 横幅消失且新值生效，不重启。
  const pointer = async (findExpr) => {
    const point = await js(`(() => {
      const el = ${findExpr};
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`);
    if (point === null) return false;
    win.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 });
    win.webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 });
    await pause(280);
    return true;
  };
  writeFileSync(join(profile, 'settings.json'), JSON.stringify({ mode: 'read-only', theme: 'dark' }), 'utf8');
  check('真指针点到「重新读取」', await pointer(`document.querySelector('.ss-banner-action')`), null);
  await waitFor(() => js(`!document.querySelector('.ss-banner.warn')`), 'banner cleared after reload');
  check('修好文件 + 重新读取 ⇒ 横幅消失（不用重启）', true, null);

  check('真指针点到「权限与安全」', await pointer(`[...document.querySelectorAll('.sp-nav-item')].find((el) => el.textContent.includes('权限与安全'))`), null);
  await waitFor(() => js(`!!document.querySelector('.ss-opt-list[aria-label="权限档"]')`), 'permission options after reload');
  const checked = await js(`[...document.querySelectorAll('.ss-opt-list[aria-label="权限档"] .ss-opt')].filter((el) => el.getAttribute('aria-checked') === 'true').map((el) => el.querySelector('.ss-opt-title')?.textContent ?? '')`);
  check('重读后设置页显示盘上新值（只读档选中）', checked.length === 1 && checked[0] === '只读', checked);

  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  await waitFor(() => js(`!document.querySelector('.sp-nav')`), 'settings closed');
  const chip = await js(`document.querySelector('.composer-card .mode-dot')?.closest('button')?.innerText?.trim() ?? null`);
  check('live state 同步：输入框旁的权限 chip 也变成「只读」', chip === '只读', chip);
  await shot('02-after-reload');
  check('全程无渲染层控制台错误', errors.length === 0, errors);

  const passed = checks.filter((c) => c.ok).length;
  console.log(`[settings-issue-smoke] ${passed}/${checks.length} PASS`);
  finish(passed === checks.length ? 0 : 1);
}

main().catch((error) => { console.error('[settings-issue-smoke] FAILED:', error); finish(2); });
