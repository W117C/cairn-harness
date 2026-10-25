// 用真实 renderer + 合成 AgentApi 验证工具披露、侧栏与面板交互；不运行模型，不使用或清空产品用户数据。
// 先 pnpm --filter cairn-desktop build，再 pnpm --filter cairn-desktop exec electron scripts/interaction-smoke.cjs [输出目录]
const { app, BrowserWindow, nativeTheme } = require("electron");
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");

const profile = mkdtempSync(join(tmpdir(), "cairn-interactions-profile-"));
app.setPath("userData", profile);
nativeTheme.themeSource = "light";
app.on("quit", () => { rmSync(profile, { recursive: true, force: true }); });
const out = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), "cairn-interactions-"));
mkdirSync(out, { recursive: true });

async function main() {
  await app.whenReady();
  const protocol = readFileSync(join(__dirname, "../../../src/main/ipc-protocol.ts"), "utf8");
  const version = Number(protocol.match(/IPC_PROTOCOL_VERSION\s*=\s*(\d+)/)[1]);
  const start = protocol.indexOf("export interface AgentApi");
  const body = protocol.slice(start, protocol.indexOf("\n}", start));
  const starts = [...body.matchAll(/^\s{2}(\w+)\??\s*[(<]/gm)];
  const members = starts.map((s, i) => ({
    name: s[1],
    isArray: /Promise<[^>]*\[\]/.test(body.slice(s.index, starts[i + 1]?.index ?? body.length)),
  }));
  const win = new BrowserWindow({
    width: 1440, height: 900, show: false,
    webPreferences: {
      preload: join(__dirname, "ui-gallery-preload.cjs"),
      additionalArguments: ["--cairn-api-members=" + JSON.stringify(members), "--cairn-protocol-version=" + version, "--cairn-interaction-fixture"],
    },
  });
  const errors = [];
  win.webContents.on("console-message", (details) => { if (details.level === "error") { errors.push(details.message); console.error("renderer:", details.message); } });
  const js = (source) => win.webContents.executeJavaScript(source).catch((err) => { console.error("操作失败:", source); throw err; });
  const pause = () => new Promise((r) => setTimeout(r, 350));
  const shot = async (name) => { await pause(); writeFileSync(join(out, name + ".png"), (await win.webContents.capturePage()).toPNG()); };
  const checks = [];
  const check = (name, ok, detail) => { checks.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(detail)}`); };
  await win.loadFile(join(__dirname, "../dist/index.html"));
  await pause();
  const click = (selector) => js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const pointerClick = async (selector) => {
    const point = await js(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: Math.round(r.left + r.width/2), y: Math.round(r.top+r.height/2) }; })()`);
    win.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 });
    win.webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 });
  };
  const read = (source) => js(`(() => { ${source} })()`);
  const setInput = (selector, value) => js(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await click('.session'); await pause();
  let state = await read(`const b = document.querySelector('.tool-group-toggle'); return { text: b.textContent, open: b.getAttribute('aria-expanded'), hidden: document.querySelector('.tool-group-body').hidden };`);
  check('停转会话的工具组明确未收到结果，失败原因仍可见', state.open === 'false' && state.hidden && state.text.includes('未收到结果') && state.text.includes('Assertion failed'), state);
  await shot('01-tools-folded');
  await click('.tool-group-toggle'); await pause();
  await click('.tool-head'); await pause();
  check('展开调用可读真实返回内容', await read(`return document.querySelector('.tool-output').innerText.includes('export const desktop = true;');`));
  await js(`document.querySelector('.toolcluster').dataset.identity = 'retained'; window.agent.run({ sessionId: 's1', text: 'synthetic completion' });`);
  await pause();
  state = await read(`const g = document.querySelector('.toolcluster'); return { identity: g.dataset.identity, open: g.querySelector('.tool-group-toggle').getAttribute('aria-expanded'), body: g.querySelector('.tool-output')?.innerText, count: g.querySelectorAll('.tool-head').length, summary: g.querySelector('.tool-group-toggle').textContent };`);
  check('流式追加、收口和最终答复保留组与单次展开状态', state.identity === 'retained' && state.open === 'true' && state.body.includes('export const desktop') && state.count === 4 && !state.summary.includes('执行中'), state);
  await shot('02-tools-expanded');
  await click('.tool-group-toggle'); await pause();
  await click('.group-toggle'); await pause();
  check('项目组收起状态已保存', await read(`return JSON.parse(localStorage.getItem('cairn.sidebar.groups.v1')).length === 1;`));
  await win.reload(); await pause();
  check('重载恢复项目组收起状态', await read(`return document.querySelector('.group').dataset.collapsed === 'true';`));
  await setInput('.side-search-input', 'routing'); await pause();
  check('搜索自动显示收起组里的匹配会话', await read(`return document.querySelector('.group').dataset.collapsed === 'false' && document.querySelector('.session').getBoundingClientRect().height > 0;`));
  await setInput('.side-search-input', ''); await pause();
  check('清除搜索恢复原折叠选择', await read(`return document.querySelector('.group').dataset.collapsed === 'true';`));
  // 会话筛选：此前 filterSessions 只被喂 "all"；补真实菜单开合、空态与清除。
  await pointerClick('.side-filter-btn'); await pause();
  state = await read(`const items=[...document.querySelectorAll('.side-filter-menu [role="menuitemradio"]')]; return { n: items.length, ids: items.map(e=>e.dataset.filter), checked: items.filter(e=>e.getAttribute('aria-checked')==='true').map(e=>e.dataset.filter), archived: items.find(e=>e.dataset.filter==='archived')?.textContent.trim() ?? null };`);
  check('筛选菜单列全五档并标出当前档', state.n === 5 && state.checked.length === 1 && state.checked[0] === 'all' && state.archived?.includes('0'), state);
  await shot('02b-sidebar-filter');
  await pointerClick('[data-filter="archived"]'); await pause();
  state = await read(`return { active: document.querySelector('.side-filter-btn')?.dataset.active, stored: localStorage.getItem('cairn.sidebar.filter.v1'), empty: document.querySelector('.side-filter-empty')?.textContent ?? null, sessions: document.querySelectorAll('.session').length, emptyGroups: document.querySelectorAll('.group').length };`);
  check('切到已归档：专属空态、不摆空组头、选择已存', state.active === 'true' && state.stored === 'archived' && state.empty?.includes('已归档') && state.sessions === 0 && state.emptyGroups === 0, state);
  await shot('02c-sidebar-filter-empty');
  await pointerClick('.side-filter-empty .side-retry'); await pause();
  state = await read(`return { active: document.querySelector('.side-filter-btn')?.dataset.active, stored: localStorage.getItem('cairn.sidebar.filter.v1'), sessions: document.querySelectorAll('.session').length, collapsed: document.querySelector('.group')?.dataset.collapsed };`);
  check('清除筛选回到全部：会话恢复、折叠组展开', state.active === 'false' && state.stored === 'all' && state.sessions > 0 && state.collapsed === 'false', state);
  await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', code: 'KeyB', metaKey: true, bubbles: true }))`); await pause();
  state = await read(`return { rail: document.querySelector('.sidebar-rail').getBoundingClientRect().width, side: document.querySelector('.side-wrap').getBoundingClientRect().width };`);
  check('侧栏收起仍有可用快捷栏', state.rail === 48 && state.side === 0, state);
  state = await read(`const g = document.querySelector('.main-group').getBoundingClientRect(); const rail = document.querySelector('.sidebar-rail').getBoundingClientRect(); return { top: g.top, railTop: rail.top, right: g.right, viewport: innerWidth, railHeight: rail.height };`);
  check('快捷栏和主区同排且主区填满剩余宽高', Math.abs(state.top-state.railTop) < 1 && Math.abs(state.right-state.viewport) < 1 && state.railHeight > 600, state);
  await click('.sidebar-rail [aria-label="打开文件窗格"]'); await pause();
  check('快捷栏文件入口打开可交互的面板', await read(`return document.querySelector('[data-pane="file"]')?.dataset.active === 'true' && !document.querySelector('.inspector-col').hasAttribute('inert');`));
  await pointerClick('[aria-label="添加面板"]'); await pause();
  await js(`[...document.querySelectorAll('[role="menuitem"]')].find(el => el.textContent.trim() === '方案').click()`); await pause();
  check('添加面板直接聚焦新开的面板', await read(`return document.querySelector('[data-pane="plan"]')?.dataset.active === 'true';`));
  // 单窗格标签页：切走只隐藏，不卸载（终端/浏览器/文件树状态要活下来）。
  await js(`document.querySelector('[data-pane="file"]').dataset.identity = 'retained-file'`);
  await click('[aria-label="切换到文件窗格"]'); await pause();
  state = await read(`const file = document.querySelector('[data-pane="file"]'); const plan = document.querySelector('[data-pane="plan"]'); return { fileActive: file?.dataset.active, planActive: plan?.dataset.active, fileVisibility: file ? getComputedStyle(file).visibility : null, planVisibility: plan ? getComputedStyle(plan).visibility : null, identity: file?.dataset.identity, tabs: document.querySelectorAll('.pane-chunk').length };`);
  check('切标签只换可见性：两块都挂载、文件块状态保留', state.fileActive === 'true' && state.planActive === 'false' && state.fileVisibility === 'visible' && state.planVisibility === 'hidden' && state.identity === 'retained-file' && state.tabs === 2, state);
  await shot('03-pane-tabs');
  await click('[aria-label="切换到方案窗格"]'); await pause();
  await js(`document.querySelector('[aria-label="关闭方案窗格"]').focus()`);
  await click('[aria-label="关闭方案窗格"]'); await pause();
  check('关闭面板后键盘焦点回到剩余面板导航', await read(`return document.activeElement.getAttribute('aria-label') === '切换到文件窗格';`));
  check('关闭方案后只剩文件块且它是激活块', await read(`return !document.querySelector('[data-pane="plan"]') && document.querySelector('[data-pane="file"]')?.dataset.active === 'true';`));
  // 2026-10-21 批 142：显式关闭必须压过恢复窗格。旧实现只看 paneTabs.length，
  // 关闭检查器后带窗格重启会被强行掰开——这条在真实 renderer 里走一遍（含 localStorage 与 reload）。
  await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'i', code: 'KeyI', metaKey: true, altKey: true, bubbles: true }))`); await pause();
  check('显式关闭检查器：窗格仍开、偏好写成 0', await read(`return localStorage.getItem('cairn.inspector.open.v1') === '0' && !!document.querySelector('[data-pane="file"]');`));
  await win.reload(); await pause();
  state = await read(`const col = document.querySelector('.inspector-col'); return { pref: localStorage.getItem('cairn.inspector.open.v1'), pane: !!document.querySelector('[data-pane="file"]'), width: col?.getBoundingClientRect().width ?? -1, inert: col?.hasAttribute('inert') ?? false };`);
  check('带恢复窗格重载后检查器保持关闭（显式偏好优先）', state.pref === '0' && state.pane && state.width < 1 && state.inert, state);
  await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'i', code: 'KeyI', metaKey: true, altKey: true, bubbles: true }))`); await pause();
  state = await read(`const col = document.querySelector('.inspector-col'); return { pref: localStorage.getItem('cairn.inspector.open.v1'), width: col?.getBoundingClientRect().width ?? -1, inert: col?.hasAttribute('inert') ?? false };`);
  check('关闭后仍可重新打开检查器', state.pref === '1' && state.width > 300 && !state.inert, state);
  // 上面的 reload 会回到「侧栏展开」的启动态；后续窄窗检查量的是收起快捷栏，先恢复收起。
  if (!(await read(`return !!document.querySelector('.sidebar-rail');`))) {
    await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', code: 'KeyB', metaKey: true, bubbles: true }))`); await pause();
  }
  check('检查器场景结束后侧栏快捷栏可回到收起态', await read(`return document.querySelector('.sidebar-rail')?.getBoundingClientRect().width === 48;`));
  // 2026-10-21 评审修：设置返回必须在 ModalSurface 内部、且真实指针可命中。
  // 脚本 `.click()` 会绕过 inert/hit-test，不能作为"可点"的证据。
  await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', code: 'Comma', metaKey: true, bubbles: true }))`); await pause();
  state = await read(`const b = document.querySelector('.sp-back'); const r = b?.getBoundingClientRect(); const hit = r ? document.elementFromPoint(r.left + r.width/2, r.top + r.height/2) : null; return { page: !!document.querySelector('.sp-page'), back: !!b, hit: !!hit?.closest('.sp-back'), toggle: !!document.querySelector('.titlebar .iconbtn'), tbBack: !!document.querySelector('.tb-back') };`);
  check('设置返回在 surface 内且命中测试可点', state.page && state.back && state.hit && !state.toggle && !state.tbBack, state);
  await pointerClick('.sp-back'); await pause();
  check('真实指针点击返回关闭设置', !(await read(`return !!document.querySelector('.sp-page');`)));
  // 命令面板（⌘K）是 Codex/Claude 级入口；此前只有源码/单测，没有真实 renderer 的开合证据。
  await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', metaKey: true, bubbles: true }))`); await pause();
  check('命令面板可开且搜索框聚焦', await read(`return !!document.querySelector('.cp-panel') && document.activeElement?.classList.contains('cp-input');`));
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' }); await pause();
  check('命令面板 Esc 关闭', await read(`return !document.querySelector('.cp-panel');`));
  // 文件快速打开：命令面板搜文件名 → 选中 → 右侧文件窗格激活、父目录展开、预览到位。
  await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', metaKey: true, bubbles: true }))`); await pause();
  await setInput('.cp-input', 'main'); await new Promise((r) => setTimeout(r, 650));
  state = await read(`const item=document.querySelector('[data-file="src/main.ts"]'); return { item: !!item, label: item?.querySelector('.cp-label')?.textContent ?? null, dir: item?.querySelector('.cp-at')?.textContent ?? null, group: [...document.querySelectorAll('.cp-group [cmdk-group-heading]')].map(e=>e.textContent) };`);
  check('命令面板文件组列出 workspaceSearch 命中', state.item && state.label === 'main.ts' && state.dir === 'src' && state.group.includes('文件'), state);
  await shot('02d-palette-files');
  await js(`document.querySelector('[data-file="src/main.ts"]')?.scrollIntoView({ block: 'nearest' })`);
  await pointerClick('[data-file="src/main.ts"]'); await new Promise((r) => setTimeout(r, 800));
  state = await read(`return { palette: !!document.querySelector('.cp-panel'), active: document.querySelector('[data-pane="file"]')?.dataset.active, tab: document.querySelector('.pane-tab.on')?.textContent?.trim() ?? null, preview: document.querySelector('.fp-preview-path')?.textContent ?? null, tree: !!document.querySelector('.fp-row[data-path="src/main.ts"]'), expanded: document.querySelector('.fp-row[data-path="src"]')?.getAttribute('aria-expanded') ?? null };`);
  check('选中文件：面板关闭、文件窗格激活、父目录展开并预览', !state.palette && state.active === 'true' && state.tab === '文件' && state.preview === 'src/main.ts' && state.tree && state.expanded === 'true', state);
  await shot('02e-file-quick-open');
  await win.setContentSize(880, 700); await pause();
  state = await read(`return { overflow: document.documentElement.scrollWidth > innerWidth, rail: document.querySelector('.sidebar-rail').getBoundingClientRect().width };`);
  check('窄窗快捷栏和面板无横向溢出', !state.overflow && state.rail === 48, state);
  await shot('05-narrow');
  nativeTheme.themeSource = 'dark'; await shot('06-dark');
  check("渲染过程无控制台错误", errors.length === 0, errors);
  writeFileSync(join(out, "checks.json"), JSON.stringify(checks, null, 2));
  console.log(`截图与读数：${out}\n隔离测试配置：${profile}`);
  app.exit(checks.every((c) => c.ok) ? 0 : 1);
}
const watchdog = setTimeout(() => { console.error("interaction-smoke: 超时"); app.exit(1); }, 45_000);
watchdog.unref();
main().catch((err) => { console.error(err); app.exit(1); });
