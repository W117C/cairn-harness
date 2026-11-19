// Real Electron renderer, synthetic AgentApi, isolated profile. No provider calls.
// ELECTRON_RUN_AS_NODE= pnpm --filter cairn-desktop exec electron scripts/desktop-design-smoke.cjs [output]
// 2026-11-19 重估重写：模型菜单在台账第 1037 页设计批改成双层 popover（根格 mp-cell
// 「模型/思考」→ 钻入模型面 mp-search+mp-models / 思考面 mp-effort）。本探针从单层菜单
// 旧形状跟到当前形状：断言语义不变（聚焦、高亮同步、IME、档位、越界、深色），落点换新面。
// 搜索面需要 >4 个模型才出现（ModelPicker.tsx showSearch），探针经 --cairn-provider-models
// 给夹具追加三条目录（见 ui-gallery-preload.cjs 顶部注释）。
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
    additionalArguments: [
      '--cairn-api-members=' + JSON.stringify(members), '--cairn-protocol-version=' + version,
      '--cairn-provider-models=' + JSON.stringify([
        // 追加目录必须落在已配 key 的 provider（gallery providerKeyStatus.stored = deepseek/glm；
        // ModelPicker 按 configuredProviders 过滤——其他 provider 的模型进不了菜单）。
        // 全走 deepseek：搜索过滤 'glm' 仍只命中 glm-5.3-flash，Down 首步仍是 deepseek-reasoner。
        ['deepseek-v3.2-exp', 'deepseek', 'deepseek-v3.2-exp', 'strong', 128000, false, true],
        ['deepseek-v3.1', 'deepseek', 'deepseek-v3.1', 'standard', 128000, false, false],
        ['deepseek-lite', 'deepseek', 'deepseek-lite', 'cheap', 64000, false, true],
      ]),
    ],
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
  // 根格读数：菜盒与两格/底部管理都在视口与菜盒内。
  const rootBounds = () => js(`(() => {
    const menu = document.querySelector('.mp-pop'), r = menu.getBoundingClientRect();
    const cells = menu.querySelectorAll('.mp-cell');
    const first = cells[0]?.getBoundingClientRect();
    const effort = cells[1]?.getBoundingClientRect();
    const manage = menu.querySelector('.mp-foot').getBoundingClientRect();
    return { top:r.top, bottom:r.bottom, left:r.left, right:r.right, width:innerWidth, height:innerHeight,
      firstBottom:first.bottom, effortBottom:effort.bottom, manageBottom:manage.bottom };
  })()`);
  // 模型面读数：列表可滚且菜盒在视口内。
  const modelBounds = () => js(`(() => {
    const menu = document.querySelector('.mp-pop'), r = menu.getBoundingClientRect();
    return { top:r.top, bottom:r.bottom, left:r.left, right:r.right, width:innerWidth, height:innerHeight,
      listOverflow:getComputedStyle(menu.querySelector('.mp-models')).overflowY };
  })()`);
  // 菜盒自身读数（思考面没有 .mp-models，用这个）。
  const menuBounds = () => js(`(() => {
    const menu = document.querySelector('.mp-pop'), r = menu.getBoundingClientRect();
    return { top:r.top, bottom:r.bottom, left:r.left, right:r.right, width:innerWidth, height:innerHeight };
  })()`);
  const openMenu = async () => {
    await click('.mp-trigger');
    for (let i = 0; i < 8; i++) { if (await js(`!!document.querySelector('.mp-pop')`)) return true; await pause(); }
    return false;
  };
  const closeMenu = async () => {
    await key('Escape'); await key('Escape'); // 子面先退根格，再整体关菜单
    for (let i = 0; i < 8; i++) { if (!await js(`!!document.querySelector('.mp-pop')`)) return true; await pause(); }
    return false;
  };
  await win.loadFile(join(__dirname, '../dist/index.html'));
  for (let i=0;i<100;i++) { if (await js(`!!document.querySelector('.mp-trigger')`)) break; await pause(); }
  await openMenu();
  check('打开模型菜单进根格：触发条保持焦点，模型/思考两格与底部管理在场', await js(`document.activeElement?.classList.contains('mp-trigger') && document.querySelectorAll('.mp-cell').length === 2 && !!document.querySelector('.mp-foot')`));
  await click('.mp-cell'); // 钻入模型面（首格=模型）
  check('钻入模型面即聚焦搜索，当前模型定位与高亮一致', await js(`document.activeElement === document.querySelector('.mp-search input') && document.querySelector('[data-highlighted="true"]')?.getAttribute('aria-selected') === 'true'`));
  await key('Down');
  check('方向键切换可见高亮并同步读屏引用', await js(`(() => { const input = document.querySelector('.mp-search input'); const row = document.getElementById(input.getAttribute('aria-activedescendant')); return row?.dataset.highlighted === 'true' && row.textContent.includes('deepseek-reasoner'); })()`));
  await fill('glm');
  check('搜索只留下命中模型并重置焦点', await js(`document.querySelectorAll('.mp-models [role="option"]').length === 1 && document.querySelector('[data-highlighted="true"]').textContent.includes('glm')`));
  // IME Enter confirms composition, never a model.
  await js(`document.querySelector('.mp-search input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true}))`);
  check('中文输入法确认不误选模型', await js(`!!document.querySelector('.mp-pop')`));
  await fill('');
  await key('Escape'); // 模型面退回根格，焦点归还模型格
  // 思考格钻入：离屏 sendInputEvent 的 Enter 不触发按钮原生激活（旧探针的 Return 同样是空转），
  // 键盘路径在本架具里只测得到 React 层处理的键（方向键/Esc/IME），激活走真实点击。
  await js(`document.querySelectorAll('.mp-cell')[1].click()`);
  check('点思考格钻入思考面，不误选模型', await js(`!!document.querySelector('.mp-pop') && !!document.querySelector('.mp-effort') && document.querySelector('.mp-trigger').textContent.includes('deepseek-chat')`));
  await click('.mp-effort button[data-e="medium"]');
  check('思考档位修改生效并关闭菜单', await js(`!document.querySelector('.mp-pop') && document.querySelector('.mp-trigger').textContent.includes('思考 medium')`));
  await shot('01-model-light');
  for (const [width, height] of [[1440,900],[880,640],[880,420]]) {
    win.setContentSize(width,height); await pause();
    await closeMenu(); await openMenu();
    const d = await rootBounds();
    check(`${width}×${height}根格两格与底部操作不越界`, d.top >= 38 && d.bottom <= d.height && d.left >= 0 && d.right <= d.width && d.firstBottom <= d.bottom && d.effortBottom <= d.bottom && d.manageBottom <= d.bottom, d);
    await click('.mp-cell');
    const m = await modelBounds();
    check(`${width}×${height}模型面列表可滚且菜盒在视口内`, m.top >= 38 && m.bottom <= m.height && m.left >= 0 && m.right <= m.width && m.listOverflow === 'auto', m);
  }
  await shot('02-model-short');
  await closeMenu();
  // The gallery keeps getProviderInfo fixed. Use a session override to exercise a
  // capability change without pretending the fake setSettings persists anything.
  await click('.session'); await openMenu(); await click('.mp-cell');
  await fill('glm');
  const beforePick = await js(`({active:document.activeElement?.outerHTML,highlight:document.querySelector('[data-highlighted="true"]')?.textContent,trigger:document.querySelector('.mp-trigger').textContent})`);
  await key('Return');
  check('搜索后Enter选择GLM并关闭菜单', await js(`!document.querySelector('.mp-pop') && document.querySelector('.mp-trigger').textContent.includes('glm-5.3-flash')`), beforePick);
  await openMenu(); await js(`document.querySelectorAll('.mp-cell')[1].click()`); // 钻思考面：GLM 不支持思考
  check('不支持思考的模型保留原因面', await js(`document.querySelector('.mp-effort')?.dataset.unsupported === 'true' && !!document.querySelector('.mp-effort .mp-empty') && !!document.querySelector('.mp-effort .th-why')`));
  await click('.th-why summary');
  const explained = await menuBounds();
  check('展开能力说明后说明面仍在菜单内', explained.top >= 38 && explained.bottom <= explained.height && explained.left >= 0 && explained.right <= explained.width, explained);
  await closeMenu();
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
  // 2026-11-02 过程折叠批 + 2026-11-17 R5 fold-inner：历史轮的过程（思考/工具）默认收成一行
  // 「思考与工具」，旧行在折叠体里（aria-hidden、grid 0fr）。默认收起判据落在折叠层。
  check('过程默认收成一行折叠，正文与思考体都不可见', await js(`(() => { const f = document.querySelector('.process-fold-toggle'); const b = document.querySelector('.process-fold-body'); const tb = document.querySelector('.think-body'); return f?.getAttribute('aria-expanded') === 'false' && b?.dataset.open === 'false' && (tb === null || tb.getAttribute('aria-hidden') === 'true'); })()`));
  await shot('04-process-light');
  await click('.process-fold-toggle');
  check('展开过程折叠：思考行与工具簇回到界面', await js(`document.querySelector('.process-fold-toggle').getAttribute('aria-expanded') === 'true' && document.querySelector('.think-toggle')?.offsetParent !== null && document.querySelector('.tool-group-toggle')?.offsetParent !== null`));
  await click('.think-toggle');
  check('展开思考后正文可读', await js(`(() => { const b = document.querySelector('.think-body'); return b?.dataset.open === 'true' && b.innerText.includes('RunOverrides'); })()`));
  await click('.tool-group-toggle');
  check('工具组支持展开明细', await js(`document.querySelector('.tool-group-body').hidden === false`));
  await shot('05-process-expanded');
  // Theme changes apply only to this disposable renderer profile.
  await js(`document.documentElement.dataset.theme='dark'; document.documentElement.dataset.mode='dark';document.body.dataset.dsDarkTheme='';document.body.dataset.dswDarkTheme=''`);
  await openMenu(); await shot('06-model-dark');
  check('深色模型菜单使用深色面', await js(`getComputedStyle(document.querySelector('.mp-pop')).backgroundColor !== 'rgb(255, 255, 255)'`));
  check('renderer无控制台错误', errors.length === 0, errors);
  writeFileSync(join(out, 'checks.json'), JSON.stringify({fixtureData:true,checks,errors},null,2));
  console.log('Evidence: '+out);
  win.destroy(); app.exit(checks.every(c=>c.ok)?0:1);
}
main().catch(err=>{console.error(err);writeFileSync(join(out,'failure.txt'),String(err.stack||err));writeFileSync(join(out,'checks.json'),JSON.stringify({fixtureData:true,checks,errors},null,2));app.exit(1);});
