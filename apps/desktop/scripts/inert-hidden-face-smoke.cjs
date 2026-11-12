// 隐藏面 inert 真机判据（第 1058 页）：真 main/preload/renderer + demo 通道，全程离线。
//
// 为什么必须真机：inert 是**浏览器行为**，SSR 只能看到属性在不在。本仓装的是 React 18.3.1，
// `inert={true}` 会被整个丢掉 ⇒ 属性没了。所以这里判属性 + 真输入下的焦点落点。
//
// 两条防空判的纪律（本页实测踩过）：
//   · 隐藏面 CSS 已经是 `visibility:hidden`，它本身就把子树移出 Tab 序 ⇒ 只判「focus() 拿不到焦点」
//     对「inert 被删掉」这个变异是**恒真**的。必须另判「有没有后代靠 visibility:visible 逃出去」，
//     那才是 inert 真正兜的那一格（inert 不可被后代覆盖，visibility 可以）。
//   · 合成 KeyboardEvent **不会**触发 Chromium 的默认 Tab 导航 ⇒ 焦点根本不动，「没落进聊天树」恒真。
//     真 Tab 走 webContents.sendInputEvent，并且要有「焦点确实移动过」的正对照。
//
// pnpm --filter cairn-desktop build
// ELECTRON_RUN_AS_NODE= pnpm --filter cairn-desktop exec electron scripts/inert-hidden-face-smoke.cjs [output-directory]
const { app, BrowserWindow, nativeTheme } = require('electron');
const { scheduleProfileCleanup } = require("./lib/profile-cleanup.cjs");
const { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');

const root = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-inert-')));
const profile = join(root, 'profile');
const workspace = join(root, 'workspace');
const out = resolve(process.argv[2] ?? mkdtempSync(join(tmpdir(), 'cairn-inert-evidence-')));
for (const path of [profile, workspace, out]) mkdirSync(path, { recursive: true });
app.setPath('userData', profile);
app.setAppPath(resolve(__dirname, '..'));
nativeTheme.themeSource = 'dark';
writeFileSync(join(profile, 'settings.json'), JSON.stringify({ provider: 'demo', model: '', autoMemory: false, onboarded: false }));
const script = join(root, 'provider.jsonl');
writeFileSync(script, JSON.stringify({ type: 'assistant_message', content: '已收到本轮消息。' }) + '\n');
process.env.CAIRN_DESKTOP_WORKSPACE = workspace;
process.env.M0B_WORKSPACE = workspace;
process.env.M0A_PROVIDER = 'demo';
process.env.M3A_MAIN_SCRIPT = script;
delete process.env.CAIRN_SMOKE;

const checks = [];
const errors = [];
const check = (name, ok, detail) => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + JSON.stringify(detail)}`);
};
const pause = () => new Promise((r) => setTimeout(r, 40));
async function waitFor(predicate, label) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) { if (await predicate()) return; await pause(); }
  throw new Error('Timed out: ' + label);
}
function finish(code) {
  writeFileSync(join(out, 'checks.json'), JSON.stringify({ checks, errors }, null, 2));
  for (const win of BrowserWindow.getAllWindows()) win.destroy();
  scheduleProfileCleanup(root);
  console.log('Evidence: ' + out);
  app.exit(code);
}
require('../src/main/entry.cjs');

// 子树里第一个真能聚焦的控件（找不到就回 null，由调用方降级成只判属性 + Tab 扫）。
const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';
const probeSource = (selector) => `(() => {
  const host = document.querySelector(${JSON.stringify(selector)});
  if (!host) return { present: false };
  const el = host.querySelector(${JSON.stringify(FOCUSABLE)});
  const before = document.activeElement;
  if (el) el.focus();
  const took = el !== null && document.activeElement === el;
  if (el && took) el.blur();
  if (before && before !== document.body && before.focus) before.focus();
  // inert 真正兜的那一格：visibility 可被后代覆盖，inert 不可。逃出隐藏面的可聚焦后代必须是 0。
  const escaped = [...host.querySelectorAll(${JSON.stringify(FOCUSABLE)})]
    .filter((n) => getComputedStyle(n).visibility === 'visible')
    .map((n) => n.tagName.toLowerCase() + '.' + String(n.className).split(' ')[0]);
  return {
    present: true,
    inertAttr: host.getAttribute('inert'),
    hasInert: host.hasAttribute('inert'),
    dataHidden: host.getAttribute('data-hidden'),
    focusableFound: el !== null,
    focusableTag: el ? el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : '') : null,
    focusTook: took,
    visibilityEscapes: escaped,
    childCount: host.querySelectorAll('*').length,
  };
})()`;

async function main() {
  await app.whenReady();
  await waitFor(() => BrowserWindow.getAllWindows().length > 0, 'main window');
  const win = BrowserWindow.getAllWindows()[0];
  win.webContents.setBackgroundThrottling(false);
  win.showInactive();
  win.webContents.on('console-message', (details) => { if (details.level === 'error') errors.push(details.message); });
  const js = (source) => win.webContents.executeJavaScript(source);
  await waitFor(() => js('!!document.querySelector(".composer-card textarea")'), 'composer');
  await waitFor(() => js('!document.getElementById("boot") || getComputedStyle(document.getElementById("boot")).visibility === "hidden"'), 'startup overlay dismissed');

  // ① 演示模式常驻标识（第 812 页形态）：零凭据缺省走 demo，标题栏必须明说回复来自剧本。
  const demo = await js(`(() => {
    const el = document.querySelector('.tb-demo');
    if (!el) return { present: false };
    const cs = getComputedStyle(el);
    const dot = el.querySelector('.tb-demo-dot');
    return { present: true, text: el.textContent.trim(), title: el.getAttribute('title') ?? '',
      aria: el.getAttribute('aria-label') ?? '', display: cs.display, height: cs.height,
      dotBg: dot ? getComputedStyle(dot).backgroundColor : null,
      clickable: el.tagName === 'BUTTON' && !el.disabled };
  })()`);
  check('标题栏常驻「演示模式」胶囊（文案 + 说明 + 可点）',
    demo.present && demo.text.includes('演示模式') && demo.title.includes('预录剧本') && demo.clickable, demo);
  check('胶囊真上屏（不是 display:none 的死面）', demo.present && demo.display !== 'none' && parseFloat(demo.height) > 0, demo);
  writeFileSync(join(out, '01-chat-demo.png'), (await win.webContents.capturePage()).toPNG());

  // ② 对话目的地：聊天树活着，必须能聚焦。
  const chatActive = await js(probeSource('.chat-workspace'));
  check('对话态聊天树无 inert 且内部控件真能拿到焦点',
    chatActive.present && !chatActive.hasInert && chatActive.focusableFound && chatActive.focusTook, chatActive);

  // ③ 切到插件页：聊天树仍挂着（keep-alive），但必须 inert —— 属性 + 真焦点双判。
  await js('document.querySelector(\'.app-rail-item[data-destination="plugins"]\').click()');
  await waitFor(() => js('!!document.querySelector(\'section[data-destination-page="plugins"][data-hidden="false"]\')'), 'plugins page visible');
  const chatParked = await js(probeSource('.chat-workspace'));
  check('插件页可见时聊天树仍挂着（keep-alive，不是卸载）',
    chatParked.present && chatParked.childCount > 0 && chatParked.dataHidden === 'true', chatParked);
  check('隐藏的聊天树带 inert 属性', chatParked.hasInert && chatParked.inertAttr === '', chatParked);
  check('隐藏的聊天树里控件拿不到焦点（与 visibility 隐藏一致，非 inert 独立证据）',
    chatParked.focusableFound && !chatParked.focusTook, chatParked);

  // ④ 真 Tab 扫：从插件页连按 Tab，焦点不许落进被遮的聊天树。
  //    正对照必须先过：合成 KeyboardEvent 不触发默认导航，焦点不动的话下面那条就是恒真。
  const pluginsFocusable = `section[data-destination-page="plugins"] ${FOCUSABLE}`;
  await js(`document.querySelector(${JSON.stringify(pluginsFocusable)})?.focus()`);
  const beforeTab = await js('document.activeElement ? document.activeElement.tagName.toLowerCase() + "." + String(document.activeElement.className).split(" ")[0] : null');
  const landedInChat = [];
  const visited = new Set();
  for (let i = 0; i < 25; i++) {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
    await pause();
    const info = await js(`(() => {
      const a = document.activeElement; const chat = document.querySelector('.chat-workspace');
      return { tag: a ? a.tagName.toLowerCase() + '.' + String(a.className).split(' ')[0] : null,
        inChat: !!(a && chat && chat.contains(a)) };
    })()`);
    if (info.tag !== null) visited.add(info.tag);
    if (info.inChat) landedInChat.push(info.tag);
  }
  const tabSweep = { steps: 25, beforeTab, visited: [...visited], landedInChat };
  check('真 Tab 确实移动了焦点（正对照，防恒真）', visited.size >= 2, tabSweep);
  check('连按 25 次真 Tab 焦点一次都不落进被遮聊天树', landedInChat.length === 0, tabSweep);
  check('被遮聊天树没有靠 visibility:visible 逃出去的可聚焦后代', chatParked.visibilityEscapes.length === 0, chatParked.visibilityEscapes);
  writeFileSync(join(out, '02-plugins-chat-inert.png'), (await win.webContents.capturePage()).toPNG());

  // ⑤ 再切到记忆页：插件页变成「已访问但被遮」，那一支此前无判卷覆盖。
  await js('document.querySelector(\'.app-rail-item[data-destination="memory"]\').click()');
  await waitFor(() => js('!!document.querySelector(\'section[data-destination-page="memory"][data-hidden="false"]\')'), 'memory page visible');
  const pluginsParked = await js(probeSource('section[data-destination-page="plugins"]'));
  const memoryCurrent = await js(probeSource('section[data-destination-page="memory"]'));
  check('切走后插件页仍挂着且带 inert', pluginsParked.present && pluginsParked.dataHidden === 'true' && pluginsParked.hasInert, pluginsParked);
  check('被遮的插件页里控件拿不到焦点', pluginsParked.focusableFound ? !pluginsParked.focusTook : pluginsParked.hasInert, pluginsParked);
  check('被遮插件页没有靠 visibility:visible 逃出去的可聚焦后代', pluginsParked.visibilityEscapes.length === 0, pluginsParked.visibilityEscapes);
  check('当前记忆页不带 inert（可见面不许被误隔离）', memoryCurrent.present && !memoryCurrent.hasInert && memoryCurrent.dataHidden === 'false', memoryCurrent);

  // ⑥ 回到对话：聊天树解除 inert，两个被遮页都带上。
  await js('document.querySelector(\'.app-rail-item[data-destination="chat"]\').click()');
  await waitFor(() => js('document.querySelector(".chat-workspace")?.getAttribute("data-hidden") === "false"'), 'back to chat');
  const chatBack = await js(probeSource('.chat-workspace'));
  const parkedBoth = await js(`['plugins','memory'].map((d) => {
    const el = document.querySelector('section[data-destination-page="' + d + '"]');
    return { d, present: !!el, hasInert: el ? el.hasAttribute('inert') : null, hidden: el ? el.getAttribute('data-hidden') : null };
  })`);
  check('回到对话后聊天树解除 inert 且焦点恢复', chatBack.present && !chatBack.hasInert && chatBack.focusTook, chatBack);
  check('两个被遮 durable 页都带 inert', parkedBoth.every((p) => p.present && p.hasInert && p.hidden === 'true'), parkedBoth);
  writeFileSync(join(out, '03-back-to-chat.png'), (await win.webContents.capturePage()).toPNG());

  check('全程无 renderer console 错误', errors.length === 0, errors.slice(0, 5));
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} PASS`);
  finish(failed.length === 0 ? 0 : 1);
}
main().catch((error) => { console.error(error); errors.push(String(error)); finish(1); });