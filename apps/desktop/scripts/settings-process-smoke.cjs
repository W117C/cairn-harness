// Real renderer + main IPC + isolated fixture logs + a local search server. No paid API calls.
// ELECTRON_RUN_AS_NODE= pnpm --filter cairn-desktop exec electron scripts/settings-process-smoke.cjs [output-directory]
const { app, BrowserWindow, clipboard } = require('electron');
const { createServer } = require('node:http');
const { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');

const root = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-settings-ui-')));
const profile = join(root, 'profile');
const workspace = join(root, 'workspace');
const sessions = join(workspace, '.agent', 'sessions');
const out = resolve(process.argv[2] ?? mkdtempSync(join(tmpdir(), 'cairn-settings-evidence-')));
for (const dir of [profile, sessions, out]) mkdirSync(dir, { recursive: true });
app.setPath('userData', profile);
app.setAppPath(resolve(__dirname, '..'));
writeFileSync(join(profile, 'settings.json'), JSON.stringify({ provider: 'demo', model: '', autoMemory: false, onboarded: true, theme: 'dark' }));
process.env.CAIRN_DESKTOP_WORKSPACE = workspace;
process.env.M0A_PROVIDER = 'demo';
delete process.env.CAIRN_SMOKE;
const now = Date.now();
const log = (id, events) => writeFileSync(join(sessions, id + '.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
for (let day = 1; day <= 40; day++) {
  const ts = now - day * 86400000;
  log('用量样本-' + day, [
    { type: 'user_message', content: '独立界面验证样本', ts },
    { type: 'usage', model: day % 3 === 0 ? 'deepseek-reasoner' : 'deepseek-chat', inputTokens: day * 850 + 1000, outputTokens: day * 110 + 200, cacheReadInputTokens: day * 80, ts: ts + 100 },
    { type: 'assistant_message', content: '测试数据', ts: ts + 300 },
  ]);
}
log('过程展示', [
  { type: 'user_message', content: '检查项目配置并运行验证', ts: now - 15000 },
  { type: 'thinking_delta', callId: 'thought', text: '先确认项目的配置与依赖，再执行有针对性的检查。遇到错误时保留原始输出，便于定位原因。', ts: now - 14000 },
  { type: 'assistant_message', content: '我会先读取配置，再检查测试结果。', ts: now - 13000 },
  { type: 'tool_call', id: 'read', name: 'read_file', args: { path: 'package.json' }, ts: now - 12000 },
  { type: 'tool_result', callId: 'read', ok: true, output: '{"name":"example-app","scripts":{"test":"vitest run"}}', ts: now - 11800 },
  { type: 'tool_call', id: 'test', name: 'run_shell', args: { command: 'pnpm test' }, ts: now - 10000 },
  { type: 'tool_result', callId: 'test', ok: false, output: '测试未通过：预期返回 2，实际返回 1。请检查空输入分支。', ts: now - 8300 },
  { type: 'assistant_message', content: '已找到失败用例，下一步修复空输入分支。\n\n完整过程可以按需展开查看。', ts: now - 8000 },
  { type: 'usage', model: 'deepseek-chat', inputTokens: 4800, outputTokens: 650, cacheReadInputTokens: 1200, ts: now - 7900 },
]);

const checks = [];
const errors = [];
const requests = [];
const secret = 'cairn-local-fixture-secret';
const server = createServer((req, res) => {
  requests.push({ url: req.url, authorization: req.headers.authorization });
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ results: [{ title: '本地连接验证', url: 'https://example.com/result', content: 'search fixture' }] }));
});
const check = (name, ok, detail) => { checks.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + JSON.stringify(detail)}`); };
const pause = (ms = 40) => new Promise((r) => setTimeout(r, ms));
async function waitFor(predicate, label) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) { if (await predicate()) return; await pause(); }
  throw new Error('Timeout: ' + label);
}
function finish(code) {
  writeFileSync(join(out, 'checks.json'), JSON.stringify({ fixtureData: true, checks, errors, requests: requests.map((r) => ({ url: r.url, authenticated: r.authorization === 'Bearer ' + secret })) }, null, 2));
  for (const win of BrowserWindow.getAllWindows()) win.destroy();
  server.close();
  rmSync(root, { recursive: true, force: true });
  console.log('Evidence: ' + out);
  app.exit(code);
}
require('../src/main/entry.cjs');

async function main() {
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  await app.whenReady();
  await waitFor(() => BrowserWindow.getAllWindows().length > 0, 'window');
  const win = BrowserWindow.getAllWindows()[0];
  win.webContents.setBackgroundThrottling(false);
  win.showInactive();
  win.setSize(1320, 950);
  win.webContents.on('console-message', (details) => { if (details.level === 'error') errors.push(details.message); });
  const js = (source) => win.webContents.executeJavaScript(source, true);
  const click = (selector) => js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const fill = (selector, value) => js(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error('找不到控件：' + ${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); })()`);
  const shot = async (name) => { await pause(300); writeFileSync(join(out, name + '.png'), (await win.webContents.capturePage()).toPNG()); };
  const nav = async (name) => { await js(`[...document.querySelectorAll('.sp-nav-item')].find(el => el.textContent.trim() === ${JSON.stringify(name)}).click()`); };
  const key = async (keyCode) => {
    win.focus(); win.webContents.focus(); await pause(100);
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode });
    if (keyCode === 'Enter' || keyCode === 'Space') win.webContents.sendInputEvent({ type: 'char', keyCode: keyCode === 'Enter' ? '\r' : ' ' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode }); await pause(100);
  };
  await waitFor(() => js('!!document.querySelector(".session") && (!document.getElementById("boot") || getComputedStyle(document.getElementById("boot")).visibility === "hidden")'), 'ready');
  await js(`[...document.querySelectorAll('.session')].find(el => el.textContent.includes('过程展示')).click()`);
  await waitFor(() => js('!!document.querySelector(".think-toggle")'), 'thinking record');
  check('摘要默认折叠，朗读入口已移除', await js(`document.querySelector('.think-toggle').getAttribute('aria-expanded') === 'false' && document.querySelector('.tool-group-toggle').getAttribute('aria-expanded') === 'false' && ![...document.querySelectorAll('button')].some(el => /朗读|停止朗读/.test(el.getAttribute('aria-label') || ''))`));
  await js(`document.querySelector('.think-toggle').focus()`); await key('Enter');
  check('Enter 展开思考，独立正文可读', await js(`document.querySelector('.think-toggle').getAttribute('aria-expanded') === 'true' && document.querySelector('.think-body').innerText.includes('先确认项目')`));
  await key('Space');
  check('Space 收起思考', await js(`document.querySelector('.think-toggle').getAttribute('aria-expanded') === 'false'`));
  await click('.think-toggle');
  const before = await clipboard.readText();
  await click('[aria-label="复制思考记录"]'); await pause();
  check('复制思考不会触发折叠', (await clipboard.readText()).includes('先确认项目') && await js(`document.querySelector('.think-toggle').getAttribute('aria-expanded') === 'true'`));
  await clipboard.writeText(before);
  await click('.tool-group-toggle');
  await js(`document.querySelectorAll('.tool-head')[1].click()`);
  check('工具摘要可展开参数与返回，失败原因保持可见', await js(`document.querySelectorAll('.tool-head')[1].getAttribute('aria-expanded') === 'true' && document.body.innerText.includes('预期返回 2') && !!document.querySelector('[aria-label="复制原始参数"]') && !!document.querySelector('[aria-label="复制工具返回内容"]')`));
  const dimensions = await js(`(() => { const button = document.querySelector('.row-action'); const r = button.getBoundingClientRect(); return { width: r.width, height: r.height, gap: getComputedStyle(button.parentElement).columnGap }; })()`);
  check('操作按钮实际为30px点击区和6px间距', dimensions.width >= 30 && dimensions.height >= 30 && dimensions.gap === '6px', dimensions);
  await waitFor(() => js('!document.querySelector("[data-sonner-toast]")'), 'copy toast dismissed');
  await js(`document.querySelector('.think-toggle').scrollIntoView({ block: 'start' })`);
  await shot('01-process');

  await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: ',', code: 'Comma', metaKey: true, bubbles: true }))`);
  await waitFor(() => js('!!document.querySelector(".sp-nav")'), 'settings');
  await nav('用量统计');
  await waitFor(() => js('!!document.querySelector(".ud-overview")'), 'usage dashboard');
  check('用量是设置独立页，真实日志聚合出模型与趋势', await js(`!!document.querySelector('.sp-nav-item[aria-current="page"]') && document.querySelector('.sp-nav-item[aria-current="page"]').innerText.includes('用量统计') && !!document.querySelector('.ud-trend') && !!document.querySelector('.ud-heat-day') && document.querySelector('.ud-model-table').innerText.includes('deepseek-chat')`));
  await js(`[...document.querySelectorAll('.ud-range button')].find(el => el.textContent.includes('90')).click()`);
  check('90天范围可切换并保留模型明细', await js(`document.querySelector('.ud-range button[aria-pressed="true"]').textContent.includes('90') && document.querySelector('.ud-model-table').innerText.includes('deepseek-reasoner')`));
  await shot('02-usage-desktop');
  await js(`document.querySelector('.sp-body').scrollTop = document.querySelector('.sp-body').scrollHeight`);
  await shot('02b-usage-details');
  await js(`document.querySelector('.sp-body').scrollTop = 0`);
  await nav('进化');
  await waitFor(() => js(`!!document.querySelector('.sp-nav-item[aria-current="page"]') && document.querySelector('.sp-nav-item[aria-current="page"]').innerText.includes('进化') && document.body.innerText.includes('Episode')`), 'evolve report');
  check('进化分区只读报告可打开（真实 IPC）', await js(`document.querySelector('.sp-nav-item[aria-current="page"]').innerText.includes('进化') && document.body.innerText.includes('Episode') && document.body.innerText.includes('无 holdout 不晋升')`));
  await shot('02c-evolve');
  win.setSize(900, 820); await pause(300);
  check('窄窗口下设置整页无横向溢出', await js('document.documentElement.scrollWidth <= innerWidth + 1'));
  await shot('03-usage-narrow');
  win.setSize(1320, 950);

  await nav('联网搜索');
  await waitFor(() => js('!!document.querySelector(".network-settings")'), 'search form');
  const countBefore = requests.length;
  await fill('select[aria-label="服务商"]', 'custom');
  await waitFor(() => js('!!document.querySelector(".network-settings input[type=url]")'), 'custom endpoint field');
  await fill('input[aria-label="搜索服务地址"]', `http://127.0.0.1:${server.address().port}/search`);
  await click('input[aria-label="启用联网搜索"]');
  await js(`document.querySelector('.ns-advanced').open = true`);
  await click('input[aria-label="允许本机或局域网搜索服务"]');
  const capability = await js('window.agent.searchSettingsGet()');
  if (capability.secureStorageAvailable) await fill('input[aria-label="搜索 API Key"]', secret);
  check('填写配置不会自动发送网络请求', requests.length === countBefore);
  await js(`[...document.querySelectorAll('.ns-actions button')].find(el => el.textContent.includes('测试连接')).click()`);
  await waitFor(() => js(`document.querySelector('.ns-feedback')?.innerText.includes('连接成功')`), 'test success');
  check('测试按钮发送一次真实请求并显示结果', requests.length === countBefore + 1 && new URL(requests.at(-1).url, 'http://local').searchParams.has('q'));
  check('密钥只经请求认证头发送', capability.secureStorageAvailable ? requests.at(-1).authorization === 'Bearer ' + secret : true, { secureStorageAvailable: capability.secureStorageAvailable });
  await click('.ns-actions button[type="submit"]');
  await waitFor(() => js(`document.querySelector('.ns-feedback')?.innerText.includes('设置已保存')`), 'save success');
  const config = readFileSync(join(workspace, '.agent', 'config.json'), 'utf8');
  check('配置写回且没有明文密钥', JSON.parse(config).search.enabled === true && !config.includes(secret));
  await shot('04-network');
  win.reload();
  await waitFor(() => js('!!document.querySelector(".composer-card")'), 'reloaded app');
  // 重载后回到首页路径：先打开真实会话，让 renderer 重新上报当前工作区；
  // 直接调 searchSettingsGet 会撞主进程的「工作区未知」保护（不是配置没保存）。
  await waitFor(() => js(`!![...document.querySelectorAll('.session')].find(el => el.textContent.includes('过程展示'))`), 'sessions after reload');
  await js(`[...document.querySelectorAll('.session')].find(el => el.textContent.includes('过程展示')).click()`);
  await waitFor(async () => {
    try {
      return await js(`window.agent.searchSettingsGet().then(r => r.workspace === ${JSON.stringify(workspace)})`);
    } catch {
      return false;
    }
  }, 'workspace context after reload');
  const restored = await js('window.agent.searchSettingsGet()');
  check('重载后配置与密钥状态保留，读取接口不泄露密钥', restored.enabled && restored.provider === 'custom' && (!capability.secureStorageAvailable || restored.hasKey) && !JSON.stringify(restored).includes(secret));
  check('真实渲染无控制台错误', errors.length === 0, errors);
  finish(checks.every((c) => c.ok) ? 0 : 1);
}
const watchdog = setTimeout(() => { console.error('settings smoke timeout'); finish(2); }, 120000);
watchdog.unref();
main().catch((error) => { console.error(error); finish(2); });
