// Real renderer, synthetic AgentApi, disposable profile; no writes to user configuration.
// env -u ELECTRON_RUN_AS_NODE CAIRN_RENDERER_ENTRY=/path/index.html pnpm --filter cairn-desktop exec electron scripts/form-recovery-smoke.cjs [output]
const { app, BrowserWindow, nativeTheme } = require('electron');
const { scheduleProfileCleanup } = require("./lib/profile-cleanup.cjs");
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const profile = mkdtempSync(join(tmpdir(), 'cairn-form-recovery-profile-'));
const out = resolve(process.argv[2] || mkdtempSync(join(tmpdir(), 'cairn-form-recovery-')));
app.setPath('userData', profile);
app.on('quit', () => scheduleProfileCleanup(profile));
mkdirSync(out, { recursive: true });
const checks = [], errors = [];
const check = (name, ok, detail) => { checks.push({ name, ok: ok === true, detail }); console.log(`${ok === true ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + JSON.stringify(detail)}`); };
const pause = (ms = 180) => new Promise(r => setTimeout(r, ms));
async function main() {
  await app.whenReady(); nativeTheme.themeSource = 'light';
  const source = readFileSync(join(__dirname, '../../../src/main/ipc-protocol.ts'), 'utf8');
  const version = Number(source.match(/IPC_PROTOCOL_VERSION\s*=\s*(\d+)/)[1]);
  const at = source.indexOf('export interface AgentApi'), body = source.slice(at, source.indexOf('\n}', at));
  const starts = [...body.matchAll(/^\s{2}(\w+)\??\s*[(<]/gm)];
  const members = starts.map((s, i) => ({ name: s[1], isArray: /Promise<[^>]*\[\]/.test(body.slice(s.index, starts[i + 1]?.index ?? body.length)) }));
  const win = new BrowserWindow({ width: 1440, height: 900, show: false, webPreferences: {
    backgroundThrottling: false, preload: join(__dirname, 'ui-gallery-preload.cjs'),
    additionalArguments: ['--cairn-api-members=' + JSON.stringify(members), '--cairn-protocol-version=' + version, '--cairn-agent-os-fixture', '--cairn-form-recovery-fixture'],
  } });
  win.webContents.on('console-message', d => { if (d.level === 'error') errors.push(d.message); });
  const js = s => win.webContents.executeJavaScript(s, true);
  const click = async selector => {
    const point = await js(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw Error('Missing '+${JSON.stringify(selector)}); el.scrollIntoView({block:'nearest'}); const r = el.getBoundingClientRect(); return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}; })()`);
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point }); await pause();
  };
  const key = async (keyCode, modifiers = []) => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers }); await pause();
  };
  const section = async label => { await js(`(() => { const el=[...document.querySelectorAll('.sp-nav-item')].find(e=>e.textContent.trim()===${JSON.stringify(label)}); if(!el)throw Error('Missing section');el.click(); })()`); await pause(); };
  const openSettings = async () => { win.webContents.focus(); await key(',', ['meta']); await pause(300); await section('个性化'); };
  const fill = async text => { await js(`document.querySelector('#custom-instructions').focus(); document.querySelector('#custom-instructions').select()`); win.webContents.insertText(text); await pause(); };
  const shot = async name => writeFileSync(join(out, name + '.png'), (await win.webContents.capturePage()).toPNG());
  await win.loadFile(process.env.CAIRN_RENDERER_ENTRY ?? join(__dirname, '../dist/index.html')); await pause(1000);
  const draft = '未保存的工作习惯：先说明测试结果。';
  await openSettings(); await fill(draft); await key('Escape');
  const guarded = await js(`!!document.querySelector('.sp-page .confirm-card')`);
  check('Esc关闭前提示未保存的自定义指令', guarded);
  if (guarded) {
    await shot('01-instructions-discard'); await click('.confirm-card button:first-child');
    check('继续编辑保留输入和编辑焦点', await js(`document.querySelector('#custom-instructions')?.value === ${JSON.stringify(draft)} && document.activeElement === document.querySelector('#custom-instructions')`));
  } else {
    check('继续编辑保留输入和编辑焦点', false); await openSettings(); await fill(draft);
  }
  await section('通用'); await section('个性化');
  check('切换设置分区后自定义指令草稿仍在', await js(`document.querySelector('#custom-instructions')?.value === ${JSON.stringify(draft)}`));
  await click('.sp-back');
  const backGuard = await js(`!!document.querySelector('.sp-page .confirm-card')`);
  check('返回按钮同样保护未保存的自定义指令', backGuard);
  if (backGuard) await click('.confirm-card button:last-child');
  check('明确放弃修改后关闭设置', backGuard && await js(`!document.querySelector('.sp-page')`));
  await openSettings(); await fill('保存中的工作习惯');
  await js(`window.__cairnFormRecovery.holdInstructions(true)`); await click('.agent-settings-editor button[type="submit"]');
  check('保存中禁用重复提交', await js(`document.querySelector('.agent-settings-editor button[type="submit"]').disabled && window.__cairnFormRecovery.pending() === 1`));
  await key('Escape');
  check('保存尚未完成时保持设置在场', await js(`!!document.querySelector('.sp-page')`));
  await js(`window.__cairnFormRecovery.holdInstructions(false); window.__cairnFormRecovery.settleNext(true)`); await pause();
  if (!await js(`!!document.querySelector('.sp-page')`)) await openSettings();
  check('保存完成后回显已保存内容', await js(`document.querySelector('#custom-instructions')?.value === '保存中的工作习惯' && document.querySelector('.agent-settings-editor button[type="submit"]').disabled`));
  await key('Escape'); check('已保存的设置可直接关闭', await js(`!document.querySelector('.sp-page')`));
  await js(`window.__cairnFormRecovery.failRead(true)`); await click('[data-destination="automation"]'); await pause(300);
  const readError = await js(`document.querySelector('.destination-page[aria-label="自动化"]')?.innerText ?? ''`);
  check('唤醒设置读取失败有可见说明', readError.includes('读取失败'), readError.slice(0, 240));
  check('读取失败不冒充已关闭状态', await js(`!document.querySelector('.at-wake [role="switch"]')`));
  await shot('02-wake-read-error');
  const retry = await js(`!!document.querySelector('.at-wake button[aria-label="重新读取保持唤醒设置"]')`);
  await js(`window.__cairnFormRecovery.failRead(false)`);
  if (retry) await click('.at-wake button[aria-label="重新读取保持唤醒设置"]');
  check('就地重试后恢复真实开关状态', retry && await js(`document.querySelector('.at-wake [role="switch"]')?.getAttribute('aria-checked') === 'false' && !document.querySelector('.at-wake [role="switch"]').disabled`));
  await js(`window.__cairnFormRecovery.failWakeWrite(true)`); await click('.at-wake [role="switch"]'); await pause();
  check('保存失败回滚并显示原因', await js(`document.querySelector('.at-wake [role="switch"]')?.getAttribute('aria-checked') === 'false' && document.querySelector('.at-wake')?.innerText.includes('保存失败')`));
  await js(`window.__cairnFormRecovery.failWakeWrite(false); window.__cairnFormRecovery.holdWake(true)`);
  await click('.at-wake [role="switch"]');
  check('唤醒设置保存中禁止连续切换', await js(`document.querySelector('.at-wake [role="switch"]').disabled && document.querySelector('.at-wake').innerText.includes('保存中')`));
  await js(`window.__cairnFormRecovery.holdWake(false); window.__cairnFormRecovery.settleNext(true)`); await pause();
  check('失败后可重新保存并回显', await js(`document.querySelector('.at-wake [role="switch"]').getAttribute('aria-checked') === 'true' && !document.querySelector('.at-wake [role="switch"]').disabled`));
  await js(`window.__cairnAgentOs.setMode('operation-error')`);
  await click('.destination-page[aria-label="自动化"] .page-frame-head button[aria-label="刷新"]'); await pause(300);
  check('已有定时任务时仍可调整唤醒设置', await js(`!!document.querySelector('.automation-list .ap-item') && document.querySelectorAll('.at-wake').length === 1 && !!document.querySelector('.at-wake [role="switch"]')`));
  win.setContentSize(880, 640); nativeTheme.themeSource = 'dark'; await pause(300); await shot('03-wake-with-tasks-dark-880');
  check('窄窗口没有横向溢出', await js(`document.documentElement.scrollWidth <= innerWidth`));
  check('renderer 无控制台错误', errors.length === 0, errors);
  writeFileSync(join(out, 'checks.json'), JSON.stringify({ fixtureData: true, checks, errors }, null, 2));
  win.destroy(); app.exit(checks.every(c => c.ok) ? 0 : 1);
}
setTimeout(() => { console.error('form recovery timeout'); app.exit(2); }, 45000).unref();
main().catch(e => { console.error(e); writeFileSync(join(out, 'failure.txt'), String(e.stack || e)); app.exit(1); });
