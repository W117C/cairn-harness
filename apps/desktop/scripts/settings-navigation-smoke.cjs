// Real renderer, synthetic AgentApi, disposable profile. No provider or user-setting writes.
const { app, BrowserWindow, nativeTheme } = require('electron');
const { scheduleProfileCleanup } = require("./lib/profile-cleanup.cjs");
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const profile = mkdtempSync(join(tmpdir(), 'cairn-settings-nav-'));
const out = resolve(process.argv[2] || mkdtempSync(join(tmpdir(), 'cairn-settings-nav-evidence-')));
mkdirSync(out, { recursive: true });
app.setPath('userData', profile);
app.on('quit', () => scheduleProfileCleanup(profile));
nativeTheme.themeSource = 'light';
const checks = [], errors = [];
const check = (name, ok, detail) => { checks.push({ name, ok: ok === true, detail }); console.log(`${ok === true ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(detail ?? null)}`); };
const pause = (ms = 120) => new Promise(r => setTimeout(r, ms));
async function main() {
  await app.whenReady();
  const protocol = readFileSync(join(__dirname, '../../../src/main/ipc-protocol.ts'), 'utf8');
  const version = Number(protocol.match(/IPC_PROTOCOL_VERSION\s*=\s*(\d+)/)[1]);
  const start = protocol.indexOf('export interface AgentApi');
  const body = protocol.slice(start, protocol.indexOf('\n}', start));
  const starts = [...body.matchAll(/^\s{2}(\w+)\??\s*[(<]/gm)];
  const members = starts.map((m, i) => ({ name: m[1], isArray: /Promise<[^>]*\[\]/.test(body.slice(m.index, starts[i + 1]?.index ?? body.length)) }));
  const win = new BrowserWindow({ width: 1440, height: 900, show: false, webPreferences: {
    backgroundThrottling: false, preload: join(__dirname, 'ui-gallery-preload.cjs'),
    additionalArguments: ['--cairn-api-members=' + JSON.stringify(members), '--cairn-protocol-version=' + version],
  }});
  win.webContents.on('console-message', d => { if (d.level === 'error') errors.push(d.message); });
  const js = s => win.webContents.executeJavaScript(s, true);
  const key = async (keyCode, modifiers = []) => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    if (keyCode === 'Return') win.webContents.sendInputEvent({ type: 'char', keyCode: '\r', modifiers });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    await pause();
  };
  const click = async selector => {
    const p = await js(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error('Missing '+${JSON.stringify(selector)}); el.scrollIntoView({block:'nearest'}); const r=el.getBoundingClientRect(); return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}; })()`);
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...p });
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...p });
    await pause();
  };
  const query = async text => {
    await js(`(() => { const el=document.querySelector('.sp-nav-search-input'); el.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(text)}); el.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    await pause();
  };
  const select = async label => {
    await js(`(() => { const el=[...document.querySelectorAll('.sp-nav-item')].find(el=>el.textContent.trim()===${JSON.stringify(label)}); if(!el) throw new Error('Missing section'); el.click(); })()`);
    await pause();
  };
  const shot = async name => writeFileSync(join(out, name+'.png'), (await win.webContents.capturePage()).toPNG());
  const open = async () => {
    if (!await js(`!!document.querySelector('.sp-page')`)) { await key(',', ['meta']); await pause(300); }
  };
  await win.loadFile(join(__dirname, '../dist/index.html'));
  for (let i=0;i<100;i++) { if (await js(`!!document.querySelector('.avatar')`)) break; await pause(); }
  await open();
  check('打开设置即聚焦搜索', await js(`document.activeElement === document.querySelector('.sp-nav-search-input')`));
  await query('网络'); await click('.sp-nav-search-x');
  check('清空后焦点归还搜索，可继续输入', await js(`document.activeElement === document.querySelector('.sp-nav-search-input') && document.querySelector('.sp-nav-search-input').value === ''`));
  await query('网络');
  const clearBounds = await js(`(() => {const r=document.querySelector('.sp-nav-search-x').getBoundingClientRect();return {width:r.width,height:r.height};})()`);
  check('清空按钮达到28px操作目标', clearBounds.width >= 28 && clearBounds.height >= 28, clearBounds);
  await key('Escape');
  check('搜索中Esc只清空查询，设置仍打开', await js(`!!document.querySelector('.sp-page') && document.querySelector('.sp-nav-search-input').value === '' && document.activeElement === document.querySelector('.sp-nav-search-input')`));
  await shot('01-search-escape');
  await open(); await query('网络');
  await js(`document.querySelector('.sp-nav-search-input').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',isComposing:true,bubbles:true,cancelable:true}))`);
  check('组字期间Esc不关闭设置或清空查询', await js(`document.querySelector('.sp-nav-search-input')?.value === '网络'`));
  await open(); await query('网络'); await key('Down');
  check('搜索下键激活并聚焦首个匹配分区', await js(`document.activeElement?.classList.contains('sp-nav-item') && document.activeElement.textContent.includes('联网搜索') && document.activeElement.getAttribute('aria-current') === 'page'`));
  await query('zzzz不存在'); await key('Down');
  check('无匹配时保留搜索焦点和空态', await js(`document.activeElement === document.querySelector('.sp-nav-search-input') && !!document.querySelector('.sp-nav-empty')`));
  await query(''); await select('通用');
  await js(`document.querySelector('.sp-nav-item[aria-current="page"]').focus()`);
  await key('Down');
  check('分区下键移焦下一项，不误切换正文', await js(`document.activeElement?.textContent.includes('模型与 Provider') && document.querySelector('.ss-title')?.textContent === '通用'`));
  await key('Return');
  check('分区回车激活聚焦项', await js(`document.querySelector('.ss-title')?.textContent === '模型与 Provider'`));
  await select('模型与 Provider'); await query('网络');
  await js(`document.querySelector('.sp-nav-search-input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true}))`);
  check('组字回车不误跳分区', await js(`document.querySelector('.ss-title')?.textContent === '模型与 Provider'`));
  await win.setContentSize(880, 560); await pause();
  await query(''); await select('关于与更新');
  await js(`document.querySelector('.sp-body').scrollTop=10000`); await pause();
  const beforeScroll = await js(`document.querySelector('.sp-body').scrollTop`);
  await select('高级');
  const afterScroll = await js(`document.querySelector('.sp-body').scrollTop`);
  check('切分区正文回顶，标题和首项直接可见', beforeScroll > 0 && afterScroll === 0, {beforeScroll,afterScroll});
  await shot('02-section-start');
  await win.setContentSize(880, 560); await pause();
  await js(`document.querySelector('.sp-nav-item').focus()`); await key('End');
  const short = await js(`(() => { const nav=document.querySelector('.sp-nav').getBoundingClientRect();const back=document.querySelector('.sp-back').getBoundingClientRect();const search=document.querySelector('.sp-nav-search').getBoundingClientRect();const active=document.activeElement;const r=active.getBoundingClientRect();return {focus:active.textContent,backTop:back.top,searchTop:search.top,navTop:nav.top,lastBottom:r.bottom,height:innerHeight,bodyOverflow:document.querySelector('.sp-body').scrollWidth>document.querySelector('.sp-body').clientWidth};})()`);
  check('短窗End直达最后分区，返回与搜索持续可见', short.focus.includes('关于与更新') && short.backTop >= short.navTop && short.searchTop >= short.navTop && short.lastBottom <= short.height && !short.bodyOverflow, short);
  await key('Return'); await shot('03-short-light');
  await key('Home');
  check('Home回首项并保留当前正文', await js(`document.activeElement.textContent.trim() === '通用' && document.querySelector('.ss-title')?.textContent === '关于与更新'`));
  await key('Up');
  check('上键首尾循环', await js(`document.activeElement.textContent.trim() === '关于与更新'`));
  await query(''); await key('Escape');
  check('空搜索Esc先离开搜索，设置保持打开', await js(`!!document.querySelector('.sp-page') && document.activeElement !== document.querySelector('.sp-nav-search-input')`));
  await key('Escape');
  check('再次Esc关闭设置', await js(`!document.querySelector('.sp-page')`));
  await open(); await query('网络'); await click('.sp-back');
  check('返回按钮直接关闭，不被搜索清空逻辑截走', await js(`!document.querySelector('.sp-page')`));
  await open(); await select('个性化');
  await js(`(() => {const el=document.querySelector('#custom-instructions');el.focus();Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,'保留这份未保存草稿');el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await key('Escape');
  check('有未保存草稿时Esc先打开确认框', await js(`!!document.querySelector('.confirm-card') && !!document.querySelector('.sp-page')`));
  await key('Escape');
  check('嵌套确认框Esc仅返回编辑，草稿和焦点保留', await js(`!document.querySelector('.confirm-card') && document.querySelector('#custom-instructions')?.value === '保留这份未保存草稿' && document.activeElement === document.querySelector('#custom-instructions')`));
  await click('.agent-settings-actions button[type="button"]');
  await click('.sp-back');
  await open(); await query(''); await select('通用');
  for (const [width,height] of [[1440,900],[1120,760],[880,560]]) {
    win.setContentSize(width,height); await pause();
    const layout=await js(`(() => {const b=document.querySelector('.sp-body');const n=document.querySelector('.sp-nav-search').getBoundingClientRect();return {overflow:b.scrollWidth>b.clientWidth,searchVisible:n.top>=38 && n.bottom<=innerHeight};})()`);
    check(`${width}×${height}设置无横向溢出且搜索可见`, !layout.overflow && layout.searchVisible, layout);
  }
  await js(`document.documentElement.dataset.theme='dark';document.documentElement.dataset.mode='dark';document.body.toggleAttribute('data-ds-dark-theme',true)`);
  await query('网络'); await shot('04-short-dark');
  check('深色窄窗搜索清空仍可用', await js(`document.querySelector('.sp-nav-search-x').getBoundingClientRect().width >= 28`));
  check('renderer无错误', errors.length === 0, errors);
  writeFileSync(join(out,'checks.json'),JSON.stringify({fixtureData:true,checks,errors},null,2));
  console.log(`Evidence: ${out}`); app.exit(checks.every(c=>c.ok)?0:1);
}
const watchdog = setTimeout(()=>{console.error('settings-navigation-smoke timeout');app.exit(2);},60000);watchdog.unref();
main().catch(err=>{console.error(err);writeFileSync(join(out,'failure.txt'),String(err.stack||err));app.exit(2);});
