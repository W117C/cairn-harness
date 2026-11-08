// 真实 Electron renderer + 合成 AgentApi；隔离 profile，不调用模型、不写产品用户数据。
// pnpm --filter cairn-desktop exec electron scripts/workbench-tools-smoke.cjs [输出目录]
const { app, BrowserWindow, nativeTheme } = require("electron");
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");
const profile = mkdtempSync(join(tmpdir(), "cairn-workbench-profile-"));
app.setPath("userData", profile);
app.on("quit", () => rmSync(profile, { recursive: true, force: true }));
const out = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), "cairn-workbench-"));
mkdirSync(out, { recursive: true });
const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(detail)}`);
}

async function main() {
  await app.whenReady();
  nativeTheme.themeSource = "light";
  const protocol = readFileSync(join(__dirname, "../../../src/main/ipc-protocol.ts"), "utf8");
  const version = Number(protocol.match(/IPC_PROTOCOL_VERSION\s*=\s*(\d+)/)[1]);
  const start = protocol.indexOf("export interface AgentApi");
  const body = protocol.slice(start, protocol.indexOf("\n}", start));
  const starts = [...body.matchAll(/^\s{2}(\w+)\??\s*[(<]/gm)];
  const members = starts.map((s, i) => ({ name: s[1], isArray: /Promise<[^>]*\[\]/.test(body.slice(s.index, starts[i + 1]?.index ?? body.length)) }));
  const win = new BrowserWindow({ width: 1440, height: 900, show: false, webPreferences: {
    backgroundThrottling: false,
    preload: join(__dirname, "ui-gallery-preload.cjs"),
    additionalArguments: ["--cairn-api-members=" + JSON.stringify(members), "--cairn-protocol-version=" + version, "--cairn-workbench-fixture"],
  } });
  const errors = [];
  win.webContents.on("console-message", (d) => { if (d.level === "error") errors.push(d.message); });
  const js = (source) => win.webContents.executeJavaScript(source, true);
  const settle = () => new Promise((r) => setTimeout(r, 400));
  const shot = async (name) => writeFileSync(join(out, name + ".png"), (await win.webContents.capturePage()).toPNG());
  const click = async (selector) => {
    const point = await js(`(() => { const r = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect(); if (!r || r.width <= 0 || r.height <= 0) throw new Error('不可见入口: ' + ${JSON.stringify(selector)}); return { x: Math.round(r.left+r.width/2), y: Math.round(r.top+r.height/2) }; })()`);
    win.webContents.sendInputEvent({ type: "mouseDown", ...point, button: "left", clickCount: 1 });
    win.webContents.sendInputEvent({ type: "mouseUp", ...point, button: "left", clickCount: 1 });
    await settle();
  };
  const key = async (key, modifiers = []) => {
    const keyCode = { ArrowDown: "Down", Enter: "Return" }[key] ?? key;
    win.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
    await settle();
  };
  const openMenu = '[data-workbench-menu][data-state="open"]';
  const menuItemSelector = JSON.stringify(openMenu + ' [role^="menuitem"]');
  const menuItems = () => js(`[...document.querySelectorAll(${menuItemSelector})].map(e => e.textContent.trim())`);
  const menuItem = async (text) => {
    const found = await js(`(() => { const el = [...document.querySelectorAll(${menuItemSelector})].find(e => e.textContent.startsWith(${JSON.stringify(text)})); el?.click(); return !!el; })()`);
    if (!found) throw new Error(`工作台菜单项缺失: ${text}`);
  };
  const menu = async () => { await click('[aria-label="工作台工具"]'); };
  const openFromMenu = async (text) => { await menu(); await menuItem(text); await settle(); };
  const active = (kind) => js(`document.querySelector('[data-pane="${kind}"]')?.dataset.active === 'true'`);
  const visible = () => js(`document.querySelector('.inspector-col')?.getBoundingClientRect().width > 0`);
  await win.loadFile(join(__dirname, "../dist/index.html"));
  await settle();
  const home = await js(`({ tools: !!document.querySelector('[aria-label="工作台工具"]'), changes: !!document.querySelector('[data-workbench-changes]') })`);
  check("首页仅保留窗口级工具", home.tools && !home.changes, home);
  if (!home.tools) throw new Error("缺少工作台工具入口");
  await menu();
  const homeItems = await menuItems();
  check("首页工具不提供会话审查入口", homeItems.length === 5 &&
    ["文件窗格", "终端窗格", "浏览器窗格", "已加载插件", "专注模式"].every(t => homeItems.some(item => item.includes(t))), homeItems);
  await key("Escape");
  await click(".session");
  const shell = await js(`({ labels: [...document.querySelectorAll('.tb-right button')].map(b => b.textContent.trim()), changeLabel: document.querySelector('[data-workbench-changes]')?.getAttribute('aria-label'), hidden: document.querySelector('.inspector-col')?.hasAttribute('inert') })`);
  check("会话只常驻改动和工具，数量指本会话", shell.labels.join("|") === "改动1|工具" && shell.changeLabel === "查看本会话改动（1 个文件）" && shell.hidden, shell);
  await shot("01-session");
  await menu();
  const sessionItems = await menuItems();
  check("会话工具菜单只保留三个常用窗格与三项布局操作", sessionItems.length === 6 &&
    ["文件窗格", "终端窗格", "浏览器窗格", "已加载插件", "右侧面板", "专注模式"].every(t => sessionItems.some(item => item.includes(t))), sessionItems);
  await shot("02-tools-menu");
  await key("Escape");
  const escapeState = await js(`({ menu: !!document.querySelector(${JSON.stringify(openMenu)}), active: document.activeElement?.outerHTML.slice(0,600), focused: document.hasFocus() })`);
  check("Esc 关闭菜单并还焦点给工具入口", !escapeState.menu && escapeState.active?.includes('aria-label="工作台工具"'), escapeState);
  await click("[data-workbench-changes]");
  check("改动按钮一次打开审查窗格", await active("changes") && await visible());
  await openFromMenu("打开文件窗格");
  check("从工具菜单打开文件窗格", await active("file"));
  await click("[data-workbench-changes]");
  check("已挂载改动窗格可再次直达，不误关且切到前台", await active("changes") && await js(`!!document.querySelector('[data-pane="file"]')`));
  await openFromMenu("收起右侧面板");
  check("菜单可收起右侧面板", !await visible());
  await click("[data-workbench-changes]");
  check("隐藏后点击改动恢复面板与原审查内容", await visible() && await active("changes"));
  await openFromMenu("进入专注模式");
  check("工具菜单进入专注模式", await js(`document.querySelector('.app')?.dataset.sidebar === 'collapsed' && !document.querySelector('.sidebar-rail')`) && !await visible());
  await openFromMenu("退出专注模式");
  check("工具菜单退出专注模式", await js(`document.querySelector('.app')?.dataset.sidebar === 'expanded'`));
  await openFromMenu("已加载插件");
  check("插件侧栏可从菜单打开", await js(`!!document.querySelector('#mod-sidebar')`));
  await openFromMenu("收起已加载插件");
  check("插件侧栏可从菜单关闭", await js(`!document.querySelector('#mod-sidebar')`));
  await openFromMenu("已加载插件");
  await click('#mod-sidebar .mod-sidebar-head button');
  check("侧栏内部关闭后焦点返回新的工具入口", await js(`!document.querySelector('#mod-sidebar') && document.activeElement?.getAttribute('aria-label') === '工作台工具'`));
  await key("b", ["meta", "shift"]);
  check("原浏览器快捷键仍可打开窗格", await active("browser"));
  await openFromMenu("打开终端窗格");
  check("终端可从工具菜单打开", await active("terminal"));
  await openFromMenu("收起右侧面板");
  await click('.tb-title');
  await js(`(() => { const el = document.querySelector('.tb-rename'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '长任务标题用于验证窄窗工具入口不会被遮挡'.repeat(8)); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await key('Enter');
  await win.setContentSize(720, 700);
  await settle();
  const narrow = await js(`(() => { const c = document.querySelector('[data-workbench-changes]').getBoundingClientRect(); const t = document.querySelector('[aria-label="工作台工具"]').getBoundingClientRect(); const title = document.querySelector('.tb-center').getBoundingClientRect(); return { c: c.width, cLeft: c.left, cRight: c.right, t: t.width, tLeft: t.left, end: t.right, viewport: innerWidth, titleRight: title.right, titleLength: document.querySelector('.tb-title')?.textContent.length ?? 0, overflow: document.documentElement.scrollWidth > innerWidth }; })()`);
  check("720 窄窗与长标题仍有两个文字入口且不重叠", narrow.c > 24 && narrow.t > 24 && narrow.end <= narrow.viewport && narrow.titleRight <= narrow.cLeft && narrow.cRight <= narrow.tLeft && narrow.titleLength > 100 && !narrow.overflow, narrow);
  await shot("03-narrow");
  await menu();
  await key("ArrowDown");
  const keyState = await js(`({ active: document.activeElement?.outerHTML.slice(0,600), role: document.activeElement?.getAttribute('role'), inMenu: !!document.activeElement?.closest(${JSON.stringify(openMenu)}), focused: document.hasFocus() })`);
  check("菜单项可用方向键到达", keyState.inMenu && keyState.role?.startsWith('menuitem'), keyState);
  await key("Escape");
  // 现在只剩六项，300 px 已经能放完；缩到 205 px 才会触发滚动。
  await win.setContentSize(880, 205);
  await settle();
  await menu();
  const shortMenu = await js(`(() => { const m = document.querySelector('[data-workbench-menu][data-state="open"]'); const r = m.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, viewport: innerHeight, client: m.clientHeight, scroll: m.scrollHeight }; })()`);
  check("低高度窗口的工具菜单限高且可滚动", shortMenu.top >= 0 && shortMenu.bottom <= shortMenu.viewport && shortMenu.client < shortMenu.scroll, shortMenu);
  await key("End");
  const lastMenuItem = await js(`(() => { const m = document.querySelector('[data-workbench-menu][data-state="open"]'); const last = [...m.querySelectorAll('[role^="menuitem"]')].at(-1); const r = last.getBoundingClientRect(); return { focused: last === document.activeElement, text: last.textContent, top: r.top, bottom: r.bottom, viewport: innerHeight, scrollTop: m.scrollTop }; })()`);
  check("低高度时 End 能滚动并聚焦菜单末项", lastMenuItem.focused && lastMenuItem.text.includes("专注模式") && lastMenuItem.top >= 0 && lastMenuItem.bottom <= lastMenuItem.viewport && lastMenuItem.scrollTop > 0, lastMenuItem);
  await shot("05-short-menu");
  await key("Escape");
  await win.setContentSize(720, 700);
  await settle();
  nativeTheme.themeSource = "dark";
  await settle();
  await shot("04-dark");
  await key(",", ["meta"]);
  check("设置页不展示工作台任务入口", await js(`!!document.querySelector('.sp-page') && document.querySelectorAll('.tb-right button').length === 0`));
  check("renderer 无控制台错误", errors.length === 0, errors);
  writeFileSync(join(out, "checks.json"), JSON.stringify(checks, null, 2));
  app.exit(checks.length > 0 && checks.every(c => c.ok) ? 0 : 1);
}
const watchdog = setTimeout(() => { console.error("workbench-tools-smoke 超时"); app.exit(1); }, 45000);
watchdog.unref();
main().catch((e) => { writeFileSync(join(out, "checks.json"), JSON.stringify(checks, null, 2)); console.error(e); app.exit(1); });
