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
  await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', code: 'KeyB', metaKey: true, bubbles: true }))`); await pause();
  state = await read(`return { rail: document.querySelector('.sidebar-rail').getBoundingClientRect().width, side: document.querySelector('.side-wrap').getBoundingClientRect().width };`);
  check('侧栏收起仍有可用快捷栏', state.rail === 48 && state.side === 0, state);
  state = await read(`const g = document.querySelector('.main-group').getBoundingClientRect(); const rail = document.querySelector('.sidebar-rail').getBoundingClientRect(); return { top: g.top, railTop: rail.top, right: g.right, viewport: innerWidth, railHeight: rail.height };`);
  check('快捷栏和主区同排且主区填满剩余宽高', Math.abs(state.top-state.railTop) < 1 && Math.abs(state.right-state.viewport) < 1 && state.railHeight > 600, state);
  await click('.sidebar-rail [aria-label="打开文件窗格"]'); await pause();
  check('快捷栏文件入口打开可交互的面板', await read(`return !!document.querySelector('[data-pane="file"]') && !document.querySelector('.inspector-col').hasAttribute('inert');`));
  await pointerClick('[aria-label="添加面板"]'); await pause();
  await js(`[...document.querySelectorAll('[role="menuitem"]')].find(el => el.textContent.trim() === '方案').click()`); await pause();
  check('添加面板直接聚焦新开的面板', await read(`return document.querySelector('.pane-grid').dataset.focused === 'plan';`));
  await click('[aria-label="聚焦文件窗格"]'); await pause();
  await js(`document.querySelector('[data-pane="file"]').dataset.identity = 'retained-file'`);
  await click('[aria-label="聚焦方案窗格"]'); await pause();
  state = await read(`const file = document.querySelector('[data-pane="file"]'); return { display: getComputedStyle(file).display, plan: document.querySelector('[data-pane="plan"]').getBoundingClientRect().height, identity: file.dataset.identity };`);
  check('聚焦切换隐藏其他面板并保留同一内容树', state.display === 'none' && state.plan > 100 && state.identity === 'retained-file', state);
  await shot('03-focused-panel');
  await click('[aria-label="恢复多面板布局"]'); await pause();
  check('恢复原来的多面板布局', await read(`return !document.querySelector('.pane-grid').hasAttribute('data-focused') && [...document.querySelectorAll('.pane-cell')].every(el => el.getBoundingClientRect().height > 20);`));
  await shot('04-split-panels');
  await click('[aria-label="聚焦方案窗格"]'); await pause();
  await js(`document.querySelector('[aria-label="关闭方案窗格"]').focus()`);
  await click('[aria-label="关闭方案窗格"]'); await pause();
  check('关闭面板后键盘焦点回到剩余面板导航', await read(`return document.activeElement.getAttribute('aria-label') === '聚焦文件窗格';`));
  check('关闭聚焦面板后回到剩余面板', await read(`return !document.querySelector('[data-pane="plan"]') && document.querySelector('[data-pane="file"]').getBoundingClientRect().height > 100;`));
  // 2026-10-21 批 142：显式关闭必须压过恢复窗格。旧实现只看 paneTabs.length，
  // 关闭检查器后带窗格重启会被强行掰开——这条在真实 renderer 里走一遍（含 localStorage 与 reload）。
  await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', code: 'KeyB', metaKey: true, altKey: true, bubbles: true }))`); await pause();
  check('显式关闭检查器：窗格仍开、偏好写成 0', await read(`return localStorage.getItem('cairn.inspector.open.v1') === '0' && !!document.querySelector('[data-pane="file"]');`));
  await win.reload(); await pause();
  state = await read(`const col = document.querySelector('.inspector-col'); return { pref: localStorage.getItem('cairn.inspector.open.v1'), pane: !!document.querySelector('[data-pane="file"]'), width: col?.getBoundingClientRect().width ?? -1, inert: col?.hasAttribute('inert') ?? false };`);
  check('带恢复窗格重载后检查器保持关闭（显式偏好优先）', state.pref === '0' && state.pane && state.width < 1 && state.inert, state);
  await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', code: 'KeyB', metaKey: true, altKey: true, bubbles: true }))`); await pause();
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
