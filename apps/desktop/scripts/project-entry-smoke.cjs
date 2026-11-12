// Real renderer + synthetic bridge; no real project or repository is written.
// env -u ELECTRON_RUN_AS_NODE CAIRN_RENDERER_ENTRY=/path/index.html pnpm --filter cairn-desktop exec electron scripts/project-entry-smoke.cjs [output]
const { app, BrowserWindow, nativeTheme } = require('electron');
const { scheduleProfileCleanup } = require("./lib/profile-cleanup.cjs");
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const profile = mkdtempSync(join(tmpdir(), 'cairn-project-entry-profile-'));
const out = resolve(process.argv[2] || mkdtempSync(join(tmpdir(), 'cairn-project-entry-')));
app.setPath('userData', profile);
app.on('quit', () => scheduleProfileCleanup(profile));
mkdirSync(out, { recursive: true });
const checks = [], errors = [];
const check = (name, ok, detail) => { checks.push({ name, ok: ok === true, detail }); console.log(`${ok === true ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + JSON.stringify(detail)}`); };
const pause = (ms = 160) => new Promise(r => setTimeout(r, ms));
async function main() {
  await app.whenReady(); nativeTheme.themeSource = 'light';
  const source = readFileSync(join(__dirname, '../../../src/main/ipc-protocol.ts'), 'utf8');
  const version = Number(source.match(/IPC_PROTOCOL_VERSION\s*=\s*(\d+)/)[1]);
  const at = source.indexOf('export interface AgentApi'), body = source.slice(at, source.indexOf('\n}', at));
  const starts = [...body.matchAll(/^\s{2}(\w+)\??\s*[(<]/gm)];
  const members = starts.map((s, i) => ({ name: s[1], isArray: /Promise<[^>]*\[\]/.test(body.slice(s.index, starts[i + 1]?.index ?? body.length)) }));
  const win = new BrowserWindow({ width: 1440, height: 900, show: false, webPreferences: {
    backgroundThrottling: false, preload: join(__dirname, 'ui-gallery-preload.cjs'),
    additionalArguments: ['--cairn-api-members=' + JSON.stringify(members), '--cairn-protocol-version=' + version, '--cairn-project-entry-fixture'],
  } });
  win.webContents.on('console-message', d => { if (d.level === 'error') errors.push(d.message); });
  const js = s => win.webContents.executeJavaScript(s, true);
  const pointer = async (x, y) => {
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, x, y });
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x, y }); await pause();
  };
  const click = async expression => {
    const p = await js(`(() => { const el=${expression}; if(!el)throw Error('Missing '+${JSON.stringify(expression)}+'; menu='+[...document.querySelectorAll('[role="menuitem"]')].map(e=>e.textContent).join('|'));el.scrollIntoView({block:'nearest'}); const r=el.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}; })()`);
    await pointer(p.x, p.y);
  };
  const select = s => `document.querySelector(${JSON.stringify(s)})`;
  const text = (s, label) => `[...document.querySelectorAll(${JSON.stringify(s)})].find(e=>e.textContent.trim()===${JSON.stringify(label)})`;
  const key = async (keyCode, modifiers = []) => {
    // Electron 的原生方向键名是 Down/Up/Left/Right；ArrowDown 会发出空 key/code。
    const nativeKey = keyCode.startsWith('Arrow') ? keyCode.slice(5) : keyCode;
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: nativeKey, modifiers });
    // 原生 button 的 Enter 激活依赖 keypress；keyDown/keyUp 本身不会补这个字符事件。
    if (keyCode === 'Enter') win.webContents.sendInputEvent({ type: 'char', keyCode: '\r', modifiers });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: nativeKey, modifiers }); await pause();
  };
  const fill = async (s, value) => { await js(`(() => { const el=${select(s)};el.focus();el.select(); })()`); win.webContents.insertText(value); await pause(); };
  const menu = async label => { await click(select('.add-project-btn')); await click(text('[role="menuitem"]', label)); };
  const openNew = async () => {
    win.webContents.focus(); await key('K', ['meta']); win.webContents.insertText('添加项目'); await pause(); await key('Enter'); await pause(220);
  };
  const recent = async () => {
    await click(select('.add-project-btn'));
    win.webContents.focus();
    await click(text('[role="menuitem"]', '最近打开'));
    await click(`[...document.querySelectorAll('[role="menuitem"]')].find(e=>e.textContent.includes('历史项目'))`);
  };
  const shot = async name => writeFileSync(join(out, name + '.png'), (await win.webContents.capturePage()).toPNG());
  const dialog = '.modal-card[aria-label="新建项目"]';
  await win.loadFile(process.env.CAIRN_RENDERER_ENTRY ?? join(__dirname, '../dist/index.html')); await pause(1100);
  const finish = async () => {
    check('renderer无未处理错误', errors.length===0, errors);
    writeFileSync(join(out, 'checks.json'), JSON.stringify({ fixtureData:true, checks, errors, calls:await js(`window.__cairnProjectCalls()`) }, null, 2));
    win.destroy(); app.exit(checks.every(c=>c.ok) ? 0 : 1);
  };
  if (process.env.CAIRN_PROJECT_SETTINGS_ONLY === '1') {
    const settings = '.modal-card[aria-label="项目设置"]';
    const projectMenu = async label => {
      await click(select('.g-more'));
      await click(text('.ctx-menu button', label)); await pause();
    };
    const openSettings = () => projectMenu('项目设置…');
    const draft = '编辑后的项目';
    const location = '/tmp/' + '很长的默认运行目录/'.repeat(12) + 'src';
    const prepare = async () => {
      await openSettings(); await fill(settings+' input', draft);
      await js(`window.__cairnProjectEntry.pick(${JSON.stringify(location)})`);
      await click(select(settings+' .modal-row button'));
    };
    win.webContents.focus(); await openSettings();
    check('项目设置打开时聚焦显示名', await js(`document.activeElement===document.querySelector(${JSON.stringify(settings+' input')})`));
    await fill(settings+' input', draft);
    await js(`window.__cairnProjectEntry.failPick(true)`); await click(select(settings+' .modal-row button'));
    check('项目设置位置选择失败显示原因并保留名字', await js(`document.querySelector(${JSON.stringify(settings+' .form-error')})?.textContent.includes('目录选择失败') && document.querySelector(${JSON.stringify(settings+' input')}).value===${JSON.stringify(draft)}`));
    await js(`window.__cairnProjectEntry.failPick(false); window.__cairnProjectEntry.pick(${JSON.stringify(location)})`); await click(select(settings+' .modal-row button'));
    check('重选位置清掉错误并保留完整路径提示', await js(`!document.querySelector(${JSON.stringify(settings+' .form-error')}) && document.querySelector('.modal-path').title===${JSON.stringify(location)}`));
    await js(`window.__cairnProjectEntry.failAdd(true)`); await click(select(settings+' .modal-foot button:last-child')); await pause();
    check('项目设置写入失败留在弹窗并显示原因', await js(`document.querySelector(${JSON.stringify(settings+' .form-error')})?.textContent.includes('项目登记失败') && document.querySelector(${JSON.stringify(settings+' input')})?.value===${JSON.stringify(draft)}`));
    await shot('05-project-settings-write-error');
    await js(`window.__cairnProjectEntry.failAdd(false)`);
    if (!await js(`!!document.querySelector(${JSON.stringify(settings)})`)) await prepare();
    await js(`window.__cairnProjectEntry.holdUpdate(true)`); await click(select(settings+' .modal-foot button:last-child'));
    check('项目设置保存中固定名字和位置并正确标注保存', await js(`document.querySelector(${JSON.stringify(settings)})?.getAttribute('aria-busy')==='true' && [...document.querySelectorAll(${JSON.stringify(settings+' input, '+settings+' button')})].every(e=>e.disabled) && document.querySelector(${JSON.stringify(settings+' .modal-foot button:last-child')}).textContent==='保存中…'`));
    await key('Enter'); check('项目设置保存中只发起一次请求', await js(`window.__cairnProjectEntry.pendingUpdates()===1`));
    await key('Escape'); check('项目设置保存中Esc不关闭弹窗', await js(`!!document.querySelector(${JSON.stringify(settings)})`));
    await pointer(8,80); check('项目设置保存中遮罩不关闭弹窗', await js(`!!document.querySelector(${JSON.stringify(settings)})`));
    if (await js(`!!document.querySelector(${JSON.stringify(settings)})`)) await click(select(settings+' .modal-head button'));
    check('项目设置保存中关闭按钮不丢反馈', await js(`!!document.querySelector(${JSON.stringify(settings)})`));
    await js(`window.__cairnProjectEntry.settleUpdate(false)`); await pause();
    check('慢保存失败仍保留名字位置且允许重试', await js(`document.querySelector(${JSON.stringify(settings+' .form-error')})?.textContent.includes('项目更新失败') && document.querySelector(${JSON.stringify(settings+' input')})?.value===${JSON.stringify(draft)} && document.querySelector('.modal-path')?.title===${JSON.stringify(location)} && !document.querySelector(${JSON.stringify(settings+' input')}).disabled`));
    if (!await js(`!!document.querySelector(${JSON.stringify(settings)})`)) await prepare();
    await click(select(settings+' .modal-foot button:last-child')); await js(`window.__cairnProjectEntry.settleUpdate(true); window.__cairnProjectEntry.holdUpdate(false)`); await pause(250);
    check('项目设置重试成功后关闭并更新侧栏', await js(`!document.querySelector(${JSON.stringify(settings)}) && document.querySelector('.g-name')?.textContent===${JSON.stringify(draft)}`));
    await openSettings();
    check('重开项目设置回显实际保存的名称和位置', await js(`document.querySelector(${JSON.stringify(settings+' input')}).value===${JSON.stringify(draft)} && document.querySelector('.modal-path').title===${JSON.stringify(location)}`));
    await key('Escape');
    await js(`window.__cairnProjectEntry.failAdd(true)`); await projectMenu('重命名显示名…'); await fill('.group-head .s-rename','失败的改名'); await key('Enter');
    check('内联改名失败仍有反馈且保留已保存名称', await js(`document.body.innerText.includes('项目登记失败') && document.querySelector('.g-name')?.textContent===${JSON.stringify(draft)}`));
    await js(`window.__cairnProjectEntry.failAdd(false); window.__cairnProjectEntry.failPick(true)`); await projectMenu('更改项目目录…');
    check('更改项目目录的选择器失败有反馈', await js(`document.body.innerText.includes('目录选择失败')`));
    await js(`window.__cairnProjectEntry.failPick(false); window.__cairnProjectEntry.pick('/tmp/relocated-project')`); await projectMenu('更改项目目录…');
    check('更改目录失败后可重试且保留项目名', await js(`window.__cairnProjectCalls().some(c=>c.kind==='relocateProject' && c.path==='/tmp/relocated-project') && document.querySelector('.group-head').title==='/tmp/relocated-project' && document.querySelector('.g-name').textContent===${JSON.stringify(draft)}`));

    const edgeMenu = async () => {
      await js(`document.querySelector('.g-more').focus(); document.querySelector('.group-head').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:innerWidth-5,clientY:innerHeight-5}))`); await pause(260);
    };
    const menuFits = () => js(`(() => {const r=document.querySelector('.ctx-menu').getBoundingClientRect();return r.top>=0 && r.left>=0 && r.right<=innerWidth && r.bottom<=innerHeight;})()`);
    win.setContentSize(880,640); await edgeMenu();
    check('窗口右下角项目菜单完整可见', await menuFits()); await shot('06-project-menu-edge');
    check('成功提示不会遮住项目菜单操作', await js(`(() => {const items=[...document.querySelectorAll('.ctx-menu button')];return items.every(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));});})()`));
    check('项目菜单打开时聚焦第一项', await js(`document.activeElement===document.querySelector('.ctx-menu button:first-child')`));
    await js(`window.__projectMenuKeys=[]; document.addEventListener('keydown',e=>{window.__projectMenuKeys.push({key:e.key,code:e.code,target:e.target?.outerHTML?.slice(0,160)});},true)`);
    await key('ArrowDown'); check('项目菜单方向键移动焦点', await js(`document.activeElement===document.querySelectorAll('.ctx-menu button')[1]`), await js(`({keys:window.__projectMenuKeys,active:document.activeElement?.outerHTML})`));
    await key('End'); check('项目菜单End落到最后一项', await js(`document.activeElement===document.querySelector('.ctx-menu button:last-child')`));
    await key('Home'); check('项目菜单Home回到第一项', await js(`document.activeElement===document.querySelector('.ctx-menu button:first-child')`));
    await key('Escape'); check('项目菜单Esc关闭并还原触发器焦点', await js(`!document.querySelector('.ctx-menu') && document.activeElement===document.querySelector('.g-more')`));
    await edgeMenu(); win.setContentSize(1120,720); await pause(260);
    check('窗口变化后项目菜单仍完整可见', await menuFits());
    await key('ArrowDown'); await key('ArrowDown'); await key('Enter');
    const keyboardSettings = await js(`!!document.querySelector(${JSON.stringify(settings)})`);
    check('项目菜单键盘进入设置且焦点到显示名', keyboardSettings && await js(`document.activeElement===document.querySelector(${JSON.stringify(settings+' input')})`), await js(`({keys:window.__projectMenuKeys,active:document.activeElement?.outerHTML})`));
    if (!keyboardSettings) { await key('Escape'); await openSettings(); }
    win.setContentSize(880,640); nativeTheme.themeSource='dark'; await pause(250); await shot('07-project-settings-dark-880');
    check('深色窄窗长路径不挤出项目设置', await js(`(() => {const el=document.querySelector(${JSON.stringify(settings)});return document.documentElement.scrollWidth<=innerWidth && el.scrollWidth<=el.clientWidth && el.querySelector('.modal-foot button:last-child').getBoundingClientRect().bottom<=innerHeight;})()`));
    await key('Escape'); await edgeMenu(); await shot('08-project-menu-dark-880');
    await key('Escape'); await finish(); return;
  }
  await js(`window.__cairnProjectEntry.failPick(true)`); await menu('打开文件夹…');
  check('打开目录失败显示原因', await js(`document.querySelector('.add-project > .form-error')?.textContent.includes('目录选择失败') === true`));
  await js(`window.__cairnProjectEntry.failPick(false)`); await menu('打开文件夹…');
  check('打开目录失败后可重试成功并清掉旧错误', await js(`!document.querySelector('.add-project > .form-error') && window.__cairnProjectCalls().some(c=>c.kind==='addProject' && c.input.path==='/tmp/project-entry-parent')`));
  await js(`window.__cairnProjectEntry.failAdd(true)`); await recent();
  check('最近项目登记失败显示原因', await js(`document.querySelector('.add-project > .form-error')?.textContent.includes('项目登记失败') === true`));
  await js(`window.__cairnProjectEntry.failAdd(false)`); await recent();
  check('最近项目可重试成功并清掉旧错误', await js(`!document.querySelector('.add-project > .form-error') && window.__cairnProjectCalls().filter(c=>c.kind==='addProject' && c.input.path==='/tmp/history-project').length === 2`));

  await openNew(); await key('Enter');
  check('空项目名不会提交且有就地校验', await js(`document.querySelector(${JSON.stringify(dialog+' .form-error')})?.textContent.includes('请先起一个项目名') && window.__cairnProjectEntry.pending().length===0`));
  await fill('input[aria-label="项目名"]', '恢复项目');
  await click(select('.tpl-card[aria-checked="true"]')); await key('ArrowRight');
  check('模板方向键移动到下一项并保持单选语义', await js(`document.activeElement===document.querySelectorAll('.tpl-card')[1] && document.activeElement.getAttribute('aria-checked')==='true' && document.querySelectorAll('.tpl-card[tabindex="0"]').length===1`));
  await key('End');
  await js(`window.__cairnProjectEntry.failPick(true)`); await click(select(dialog+' .modal-row button'));
  check('新建项目选择位置失败可见且保留项目名', await js(`document.querySelector(${JSON.stringify(dialog+' .form-error')})?.textContent.includes('目录选择失败') && document.querySelector('input[aria-label="项目名"]').value==='恢复项目'`));
  await shot('01-new-project-pick-error');
  await js(`window.__cairnProjectEntry.failPick(false)`); await click(select(dialog+' .modal-row button'));
  check('重选位置成功后清掉旧错误并更新预览', await js(`!document.querySelector(${JSON.stringify(dialog+' .form-error')}) && document.querySelector('.modal-path')?.textContent==='/tmp/project-entry-parent'`));
  await fill('input[aria-label="项目名"]', '恢复项目'); await key('Enter');
  check('新建提交期间固定名称模板和位置', await js(`!!document.querySelector(${JSON.stringify(dialog)}) && [...document.querySelectorAll(${JSON.stringify(dialog+' input, '+dialog+' .tpl-card, '+dialog+' .modal-row button')})].every(e=>e.disabled)`));
  await shot('02-new-project-creating');
  await key('Enter'); check('新建提交期间不会重复发起创建', await js(`window.__cairnProjectEntry.pending().length===1`));
  await key('Escape'); check('新建尚未完成时Esc保留表单', await js(`!!document.querySelector(${JSON.stringify(dialog)})`));
  await pointer(8, 80); check('新建尚未完成时遮罩不关闭表单', await js(`!!document.querySelector(${JSON.stringify(dialog)})`));
  if (await js(`!!document.querySelector(${JSON.stringify(dialog)})`)) await click(select(dialog+' .modal-foot button:first-child'));
  check('新建尚未完成时取消按钮不关闭表单', await js(`!!document.querySelector(${JSON.stringify(dialog)})`));
  await js(`window.__cairnProjectEntry.settleNext(false)`); await pause(220);
  check('新建失败原因可见并保留原输入以便重试', await js(`document.querySelector(${JSON.stringify(dialog+' .form-error')})?.textContent.includes('项目操作失败') && document.querySelector('input[aria-label="项目名"]')?.value==='恢复项目' && !document.querySelector('input[aria-label="项目名"]').disabled`));
  if (!await js(`!!document.querySelector(${JSON.stringify(dialog)})`)) { await openNew(); await fill('input[aria-label="项目名"]', '恢复项目'); await click(select('.tpl-card:last-child')); }
  await click(select(dialog+' .modal-foot button:last-child')); await js(`window.__cairnProjectEntry.settleNext(true)`); await pause(300);
  check('新建失败后可重试成功并关闭表单', await js(`!document.querySelector(${JSON.stringify(dialog)}) && window.__cairnProjectCalls().filter(c=>c.kind==='createProject').length===2`));

  await menu('从 Git 仓库克隆…');
  check('克隆表单开启后焦点在仓库地址', await js(`document.activeElement===document.querySelector('.clone-form input')`));
  await fill('.clone-form input', 'https://example.com/team/demo.git');
  await js(`window.__cairnProjectEntry.failPick(true)`); await click(select('.clone-row button'));
  check('克隆选择位置失败显示原因并保留URL', await js(`document.querySelector('.clone-form .form-error')?.textContent.includes('目录选择失败') && document.querySelector('.clone-form input').value==='https://example.com/team/demo.git'`));
  await js(`window.__cairnProjectEntry.failPick(false)`); await click(select('.clone-row button'));
  check('克隆位置重试成功后清掉旧错误', await js(`!document.querySelector('.clone-form .form-error') && document.querySelector('.clone-row').textContent.includes('/tmp/project-entry-parent/demo')`));
  await click(select('.clone-form button[type="submit"]'));
  check('克隆期间固定URL位置并禁用取消与入口', await js(`['.clone-form input','.clone-row button','.clone-head button','.add-project-btn'].every(s=>document.querySelector(s)?.disabled===true)`));
  await click(select('.clone-head button')); check('克隆期间不会假装取消后台操作', await js(`!!document.querySelector('.clone-form') && window.__cairnProjectEntry.pending().length===1`));
  await js(`window.__cairnProjectEntry.settleNext(false)`); await pause();
  check('克隆失败可见并保留地址位置以便重试', await js(`document.querySelector('.clone-form .form-error')?.textContent.includes('项目操作失败') && document.querySelector('.clone-form input')?.value==='https://example.com/team/demo.git' && !document.querySelector('.clone-form input').disabled`));
  if (!await js(`!!document.querySelector('.clone-form')`)) await menu('从 Git 仓库克隆…');
  await shot('03-clone-retry');
  await click(select('.clone-form button[type="submit"]')); await js(`window.__cairnProjectEntry.settleNext(true)`); await pause(300);
  check('克隆失败后重试成功并关闭表单', await js(`!document.querySelector('.clone-form') && window.__cairnProjectCalls().filter(c=>c.kind==='gitClone').length===2`));
  await menu('从 Git 仓库克隆…');
  check('下次克隆从空地址和未选位置开始', await js(`document.querySelector('.clone-form input').value==='' && document.querySelector('.clone-row').textContent.includes('未选择位置')`));
  await click(select('.clone-head button'));
  win.setContentSize(880, 640); nativeTheme.themeSource = 'dark';
  await openNew(); await fill('input[aria-label="项目名"]', '窄窗口中文项目'); await shot('04-new-project-dark-880');
  check('深色窄窗新建表单无横向溢出且主按钮可见', await js(`(() => { const card=document.querySelector(${JSON.stringify(dialog)}), b=card.querySelector('.modal-foot button:last-child').getBoundingClientRect();return document.documentElement.scrollWidth<=innerWidth && card.scrollWidth<=card.clientWidth && b.top>=0 && b.bottom<=innerHeight; })()`));
  await key('Escape'); check('空闲时仍可Esc关闭新建表单', await js(`!document.querySelector(${JSON.stringify(dialog)})`));
  await finish();
}
setTimeout(() => { console.error('project entry timeout'); app.exit(2); }, 55000).unref();
main().catch(e=>{ console.error(e, errors);writeFileSync(join(out,'failure.txt'),String(e.stack||e)+'\n'+JSON.stringify(errors));app.exit(1); });
