// Real Electron renderer, synthetic AgentApi, isolated profile. No provider calls.
// ELECTRON_RUN_AS_NODE= pnpm --filter cairn-desktop exec electron scripts/desktop-design-smoke.cjs [output]
const { app, BrowserWindow, nativeTheme } = require('electron');
const { scheduleProfileCleanup } = require("./lib/profile-cleanup.cjs");
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const profile = mkdtempSync(join(tmpdir(), 'cairn-design-profile-'));
const out = resolve(process.argv[2] || mkdtempSync(join(tmpdir(), 'cairn-design-check-')));
mkdirSync(out, { recursive: true });
app.setPath('userData', profile);
app.on('quit', () => scheduleProfileCleanup(profile));
const checks = [], errors = [];
const check = (name, ok, detail) => { checks.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + JSON.stringify(detail)}`); };
const pause = (ms = 220) => new Promise(r => setTimeout(r, ms));
async function main() {
  await app.whenReady();
  nativeTheme.themeSource = 'light';
  const source = readFileSync(join(__dirname, '../../../src/main/ipc-protocol.ts'), 'utf8');
  const version = Number(source.match(/IPC_PROTOCOL_VERSION\s*=\s*(\d+)/)[1]);
  const at = source.indexOf('export interface AgentApi');
  const body = source.slice(at, source.indexOf('\n}', at));
  const starts = [...body.matchAll(/^\s{2}(\w+)\??\s*[(<]/gm)];
  const members = starts.map((s, i) => ({ name: s[1], isArray: /Promise<[^>]*\[\]/.test(body.slice(s.index, starts[i+1]?.index ?? body.length)) }));
  const win = new BrowserWindow({ width: 1440, height: 900, show: false, webPreferences: {
    backgroundThrottling: false, preload: join(__dirname, 'ui-gallery-preload.cjs'),
    additionalArguments: ['--cairn-api-members=' + JSON.stringify(members), '--cairn-protocol-version=' + version],
  }});
  win.webContents.on('console-message', d => { if (d.level === 'error') errors.push(d.message); });
  const js = text => win.webContents.executeJavaScript(text, true);
  const click = async selector => {
    const p = await js(`(() => { const el=document.querySelector(${JSON.stringify(selector)}); if(!el) throw new Error('Missing '+${JSON.stringify(selector)}); el.scrollIntoView({block:'nearest'}); const r=el.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}; })()`);
    win.webContents.sendInputEvent({type:'mouseMove',...p});
    win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...p});
    win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...p});
    await pause();
  };
  const key = async keyCode => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode });
    await pause();
  };
  const fill = async value => {
    await js(`(() => { const el = document.querySelector('.mp-search input'); el.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', {bubbles:true})); })()`);
    await pause();
  };
  const shot = async name => writeFileSync(join(out, name + '.png'), (await win.webContents.capturePage()).toPNG());
  const bounds = () => js(`(() => {
    const menu = document.querySelector('.mp-pop'), r = menu.getBoundingClientRect();
    const effort = menu.querySelector('.th-row').getBoundingClientRect();
    const manage = menu.querySelector('.mp-foot').getBoundingClientRect();
    return { top:r.top, bottom:r.bottom, left:r.left, right:r.right, width:innerWidth, height:innerHeight,
      effortBottom:effort.bottom, manageBottom:manage.bottom, display:getComputedStyle(menu).display,
      listOverflow:getComputedStyle(menu.querySelector('.mp-models')).overflowY };
  })()`);
  await win.loadFile(join(__dirname, '../dist/index.html'));
  for (let i=0;i<100;i++) { if (await js(`!!document.querySelector('.mp-trigger')`)) break; await pause(); }
  await click('.mp-trigger');
  check('打开模型菜单即聚焦搜索', await js(`document.activeElement === document.querySelector('.mp-search input')`));
  check('当前模型定位与高亮一致', await js(`document.querySelector('[data-highlighted="true"]')?.getAttribute('aria-selected') === 'true'`));
  await key('Down');
  check('方向键切换可见焦点并同步读屏引用', await js(`(() => { const input = document.querySelector('.mp-search input'); const row = document.getElementById(input.getAttribute('aria-activedescendant')); return row?.dataset.highlighted === 'true' && row.textContent.includes('deepseek-reasoner'); })()`));
  await fill('glm');
  check('搜索只留下命中模型并重置焦点', await js(`document.querySelectorAll('.mp-models [role="option"]').length === 1 && document.querySelector('[data-highlighted="true"]').textContent.includes('glm')`));
  // IME Enter confirms composition, never a model.
  await js(`document.querySelector('.mp-search input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true}))`);
  check('中文输入法确认不误选模型', await js(`!!document.querySelector('.mp-pop')`));
  await fill('');
  await js(`document.querySelector('.th-row button[data-e="medium"]').focus()`);
  await key('Return');
  check('在思考档位按Enter不会误选模型', await js(`!!document.querySelector('.mp-pop') && document.querySelector('.mp-trigger').textContent.includes('deepseek-chat')`));
  await click('.th-row button[data-e="medium"]');
  check('思考档位修改生效且保留控件焦点', await js(`document.querySelector('.th-row button[data-e="medium"]').getAttribute('aria-pressed') === 'true' && document.activeElement === document.querySelector('.th-row button[data-e="medium"]') && document.querySelector('.mp-trigger').textContent.includes('思考 中')`));
  await shot('01-model-light');
  for (const [width, height] of [[1440,900],[880,640],[880,420]]) {
    win.setContentSize(width,height); await pause();
    const d = await bounds();
    check(`${width}×${height}模型列表与底部操作不越界`, d.top >= 38 && d.bottom <= d.height && d.left >= 0 && d.right <= d.width && d.effortBottom <= d.bottom && d.manageBottom <= d.bottom && d.listOverflow === 'auto', d);
  }
  await shot('02-model-short');
  // The gallery keeps getProviderInfo fixed. Use a session override to exercise a
  // capability change without pretending the fake setSettings persists anything.
  await key('Escape'); await click('.session'); await click('.mp-trigger');
  await fill('glm');
  const beforePick = await js(`({active:document.activeElement?.outerHTML,highlight:document.querySelector('[data-highlighted="true"]')?.textContent,trigger:document.querySelector('.mp-trigger').textContent})`);
  await key('Return');
  check('搜索后Enter选择GLM并关闭菜单', await js(`!document.querySelector('.mp-pop') && document.querySelector('.mp-trigger').textContent.includes('glm-5.3-flash')`), beforePick);
  await click('.mp-trigger');
  const unsupported = await bounds();
  check('不支持思考的模型保留原因且底部操作可见', await js(`!!document.querySelector('.th-off') && document.querySelectorAll('.th-row button:disabled').length > 0`) && unsupported.manageBottom <= unsupported.bottom, unsupported);
  await click('.th-why summary');
  const explained = await bounds();
  check('展开能力说明后底部操作仍在菜单内', explained.manageBottom <= explained.bottom, explained);
  await key('Escape');
  check('Esc关闭并归还模型入口焦点', await js(`!document.querySelector('.mp-pop') && document.activeElement?.classList.contains('mp-trigger')`));
  win.setContentSize(1440,900); await pause();
  await click('.side-filter-btn');
  const filter = await js(`(() => { const el=document.querySelector('.side-filter-menu');return {text:el.innerText,top:el.getBoundingClientRect().top,bottom:el.getBoundingClientRect().bottom,items:el.querySelectorAll('[role="menuitemradio"]').length}; })()`);
  check('筛选菜单只有五个选项，无重复标题和脚注', filter.items === 5 && !filter.text.includes('筛选对话') && !filter.text.includes('本进程'), filter);
  await shot('03-filter-light');
  await click('[data-filter="pinned"]');
  check('筛选生效后入口明确标记，列表有恢复入口', await js(`document.querySelector('.side-filter-btn').dataset.active === 'true' && !!document.querySelector('.side-filter-empty button')`));
  await click('.side-filter-empty button');
  check('清除筛选恢复对话', await js(`document.querySelector('.side-filter-btn').dataset.active === 'false' && !!document.querySelector('.session')`));
  await click('.session');
  await js(`document.querySelector('.stream').scrollTop=0`); await pause();
  check('思考与工具默认收起，思考没有重复摘要', await js(`document.querySelector('.think-toggle')?.getAttribute('aria-expanded') === 'false' && document.querySelector('.tool-group-toggle')?.getAttribute('aria-expanded') === 'false' && (!document.querySelector('.think-preview') || getComputedStyle(document.querySelector('.think-preview')).display === 'none')`));
  await shot('04-process-light');
  await click('.think-toggle');
  check('展开思考后正文可读', await js(`document.querySelector('.think-body').hidden === false && document.querySelector('.think-body').innerText.includes('RunOverrides')`));
  await click('.tool-group-toggle');
  check('工具组支持展开明细', await js(`document.querySelector('.tool-group-body').hidden === false`));
  await shot('05-process-expanded');
  // Theme changes apply only to this disposable renderer profile.
  await js(`document.documentElement.dataset.theme='dark'; document.documentElement.dataset.mode='dark';document.body.dataset.dsDarkTheme='';document.body.dataset.dswDarkTheme=''`);
  await click('.mp-trigger'); await shot('06-model-dark');
  check('深色模型菜单使用深色面', await js(`getComputedStyle(document.querySelector('.mp-pop')).backgroundColor !== 'rgb(255, 255, 255)'`));
  check('renderer无控制台错误', errors.length === 0, errors);
  writeFileSync(join(out, 'checks.json'), JSON.stringify({fixtureData:true,checks,errors},null,2));
  console.log('Evidence: '+out);
  win.destroy(); app.exit(checks.every(c=>c.ok)?0:1);
}
main().catch(err=>{console.error(err);writeFileSync(join(out,'failure.txt'),String(err.stack||err));writeFileSync(join(out,'checks.json'),JSON.stringify({fixtureData:true,checks,errors},null,2));app.exit(1);});
