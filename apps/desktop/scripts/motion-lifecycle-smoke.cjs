// Synthetic AgentApi, isolated Electron profile; no provider, credentials or user sessions.
const { app, BrowserWindow, nativeTheme } = require('electron');
const { scheduleProfileCleanup } = require("./lib/profile-cleanup.cjs");
const { mkdtempSync, readFileSync, mkdirSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const profile = mkdtempSync(join(tmpdir(), 'cairn-motion-profile-'));
app.setPath('userData', profile);
nativeTheme.themeSource = 'light';
app.on('quit', () => scheduleProfileCleanup(profile));
const out = resolve(process.argv[2] ?? mkdtempSync(join(tmpdir(), 'cairn-motion-')));
mkdirSync(out, { recursive: true });
const pause = (ms) => new Promise((done) => setTimeout(done, ms));

async function main() {
  await app.whenReady();
  const protocol = readFileSync(join(__dirname, '../../../src/main/ipc-protocol.ts'), 'utf8');
  const version = Number(protocol.match(/IPC_PROTOCOL_VERSION\s*=\s*(\d+)/)[1]);
  const start = protocol.indexOf('export interface AgentApi');
  const body = protocol.slice(start, protocol.indexOf('\n}', start));
  const starts = [...body.matchAll(/^\s{2}(\w+)\??\s*[(<]/gm)];
  const members = starts.map((s, i) => ({ name: s[1], isArray: /Promise<[^>]*\[\]/.test(body.slice(s.index, starts[i + 1]?.index ?? body.length)) }));
  const win = new BrowserWindow({ width: 1440, height: 900, show: false, webPreferences: {
    preload: join(__dirname, 'ui-gallery-preload.cjs'),
    additionalArguments: ['--cairn-api-members=' + JSON.stringify(members), '--cairn-protocol-version=' + version, '--cairn-steer-fixture', '--cairn-motion-fixture'],
  } });
  const errors = [];
  win.webContents.on('console-message', (d) => { if (d.level === 'error') errors.push(d.message); });
  const js = (source) => win.webContents.executeJavaScript(source);
  const waitFor = async (source) => {
    const until = Date.now() + 15000;
    while (Date.now() < until) { if (await js(source)) return; await pause(10); }
    throw new Error('Timed out: ' + source);
  };
  const checks = [];
  const check = async (name, source) => {
    const detail = await js(source);
    const ok = detail === true || detail.ok === true;
    checks.push({ name, ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(detail)}`);
  };
  const send = async (text) => {
    await js(`(() => { const el = document.querySelector('.composer-card textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, ${JSON.stringify(text)}); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await pause(30);
    await js(`document.querySelector('.composer-card textarea').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))`);
  };
  const emit = async (event) => { await js(`window.__cairnPushEvent(${JSON.stringify({ ...event, session_id: 's2', workspace: '/tmp/demo-ws', ts: Date.now() })})`); await pause(40); };
  const waiting = `document.querySelectorAll('[aria-label="等待模型输出"] .cairn-loader').length`;
  const noMotion = `!document.querySelector('[aria-label="等待模型输出"]') && document.querySelector('.gen-bar')?.dataset.running === 'false' && !document.querySelector('.reading .cairn-loader')`;
  await win.loadFile(join(__dirname, '../dist/index.html'));
  await waitFor(`!!document.querySelector('.composer-card textarea') && !!document.querySelector('.session')`);
  await send('检查发送与输出动效');
  await pause(40);
  await check('首页 createSession 尚未完成时立即有等待 Logo', `${waiting} === 1 && window.__cairnRuns().length === 0`);
  await js(`document.querySelector('.session[data-session-id="s1"]').click()`);
  await pause(40);
  await check('建会话期间切到已有空闲会话不会借用 pendingSend 动效', `${waiting} === 0 && document.querySelector('.gen-bar')?.dataset.running === 'false' && window.__cairnRuns().length === 0`);
  await waitFor(`window.__cairnRuns().length === 1 && document.querySelector('.gen-bar')?.dataset.running === 'true'`);
  await check('user_message 与首个 delta 都未到达时等待 Logo 仍在', `${waiting} === 1`);
  await pause(1350);
  await check('顶部流光超过一个周期仍在运行', `(() => { const el = document.querySelector('.gen-bar'); const css = getComputedStyle(el); const animation = el.getAnimations().find(a => a.animationName === 'genbar-sweep'); return { ok: css.animationIterationCount === 'infinite' && animation?.playState === 'running' && animation.currentTime > 1100, iterations: css.animationIterationCount, state: animation?.playState, time: animation?.currentTime }; })()`);
  await js(`document.documentElement.setAttribute('data-reduce-motion', 'true')`);
  await pause(40);
  await check('应用内减弱动效停掉流光并保留可见的静态运行提示', `(() => { const css = getComputedStyle(document.querySelector('.gen-bar')); return { ok: css.animationName === 'none' && css.backgroundImage === 'none' && css.opacity === '1' && css.backgroundColor !== 'rgba(0, 0, 0, 0)', animation: css.animationName, background: css.backgroundColor, opacity: css.opacity }; })()`);
  await js(`document.documentElement.removeAttribute('data-reduce-motion')`);
  await pause(40);
  await check('恢复动效后当前运行的流光继续循环', `getComputedStyle(document.querySelector('.gen-bar')).animationIterationCount === 'infinite' && document.querySelector('.gen-bar').getAnimations().some(a => a.animationName === 'genbar-sweep' && a.playState === 'running')`);
  await emit({ type: 'user_message', content: '检查发送与输出动效' });
  await check('用户事件抵达时没有等待 Logo 闪退', `${waiting} === 1`);
  await emit({ type: 'assistant_delta', callId: 'motion-1', text: '先读取项目。' });
  await check('首个增量接替等待 Logo 并保留追字光标', `${waiting} === 0 && document.querySelectorAll('.row.assistant .spark .cairn-loader').length === 1 && !!document.querySelector('.row.assistant .cursor')`);
  await emit({ type: 'usage', inputTokens: 10, outputTokens: 5 });
  await check('模型输出已完成时不在收尾阶段补出等待 Logo', `${waiting} === 0 && !document.querySelector('.row.assistant .cursor')`);
  await emit({ type: 'tool_call', id: 'motion-tool', name: 'read_file', args: { path: 'README.md' } });
  await check('工具执行阶段不重复显示模型等待', `${waiting} === 0`);
  await emit({ type: 'tool_result', callId: 'motion-tool', ok: true, output: 'fixture' });
  await check('工具收口后立即等待下一段模型输出', `${waiting} === 1`);
  await emit({ type: 'agent_status', agent_id: 'worker', status: 'done' });
  await check('worker 终态不会结束主模型等待', `${waiting} === 1 && document.querySelector('.gen-bar')?.dataset.running === 'true'`);
  await emit({ type: 'assistant_delta', callId: 'motion-2', text: '项目检查完成。' });
  await check('下一段输出接替等待且 Logo 不重复', `${waiting} === 0 && document.querySelectorAll('.row.assistant .spark .cairn-loader').length === 1`);
  await emit({ type: 'usage', inputTokens: 10, outputTokens: 5 });
  await emit({ type: 'error', message: 'synthetic request failure' });
  await check('请求错误立即清掉模型等待', `${waiting} === 0`);
  await js(`window.__cairnReleaseRun({ ok: false, error: 'synthetic request failure' })`);
  await waitFor(`document.querySelector('.gen-bar')?.dataset.running === 'false'`);
  await check('失败收束后无残留 Logo 或顶部运行态', noMotion);
  await send('切换会话边界');
  await waitFor(`window.__cairnRuns().length === 2`);
  await check('已有会话再次发送，首个 user 事件前也显示等待', `${waiting} === 1`);
  await js(`document.querySelector('.session[data-session-id="s1"]').click()`);
  await waitFor(`document.querySelector('.gen-bar')?.dataset.running === 'false'`);
  await check('切到空闲会话不携带其他会话等待态', noMotion);
  await js(`document.querySelector('.session[data-session-id="s2"]').click()`);
  await waitFor(`!!document.querySelector('.send-btn.stop')`);
  await js(`document.querySelector('.send-btn.stop').click()`);
  await waitFor(`document.querySelector('.gen-bar')?.dataset.running === 'false'`);
  await check('停止后清掉等待 Logo 与顶部运行态', noMotion);
  await send('正常完成边界');
  await waitFor(`window.__cairnRuns().length === 3`);
  await emit({ type: 'agent_status', status: 'done' });
  await check('主会话完成事件立即清掉运行态', noMotion);
  await js(`window.__cairnReleaseRun({ ok: true })`);
  await pause(30);
  writeFileSync(join(out, 'final.png'), (await win.webContents.capturePage()).toPNG());
  const report = { synthetic: true, checks, errors };
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  const failed = checks.some(c => !c.ok) || errors.length > 0;
  console.log('Report: ' + join(out, 'report.json'));
  win.destroy();
  scheduleProfileCleanup(profile);
  app.exit(failed ? 1 : 0);
}
main().catch((err) => { console.error(err); scheduleProfileCleanup(profile); app.exit(1); });
