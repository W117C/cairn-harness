// Electron renderer, existing synthetic AgentApi, disposable profile.
const { app, BrowserWindow, nativeTheme } = require("electron");
const { scheduleProfileCleanup } = require("./lib/profile-cleanup.cjs");
const { mkdirSync, mkdtempSync, readFileSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");
const profile = mkdtempSync(join(tmpdir(), "cairn-workspace-design-profile-"));
const out = resolve(process.argv[2] ?? mkdtempSync(join(tmpdir(), "cairn-workspace-design-")));
mkdirSync(out, { recursive: true });
app.setPath("userData", profile);
app.on("quit", () => scheduleProfileCleanup(profile));
nativeTheme.themeSource = "light";
const checks = [], errors = [];
const pause = (ms = 350) => new Promise(resolvePause => setTimeout(resolvePause, ms));
const check = (name, ok, detail) => { checks.push({ name, ok: ok === true, detail }); console.log(`${ok === true ? "PASS" : "FAIL"} ${name} ${JSON.stringify(detail ?? null)}`); };

async function main() {
  await app.whenReady();
  const protocol = readFileSync(join(__dirname, "../../../src/main/ipc-protocol.ts"), "utf8");
  const version = Number(protocol.match(/IPC_PROTOCOL_VERSION\s*=\s*(\d+)/)[1]);
  const start = protocol.indexOf("export interface AgentApi");
  const body = protocol.slice(start, protocol.indexOf("\n}", start));
  const starts = [...body.matchAll(/^\s{2}(\w+)\??\s*[(<]/gm)];
  const members = starts.map((s, i) => ({ name: s[1], isArray: /Promise<[^>]*\[\]/.test(body.slice(s.index, starts[i + 1]?.index ?? body.length)) }));
  const win = new BrowserWindow({ width: 880, height: 640, show: false, webPreferences: {
    backgroundThrottling: false, preload: join(__dirname, "ui-gallery-preload.cjs"),
    additionalArguments: ["--cairn-api-members=" + JSON.stringify(members), "--cairn-protocol-version=" + version,
      "--cairn-agent-os-fixture", "--cairn-long-memory-fixture"],
  } });
  win.webContents.on("console-message", details => { if (details.level === "error") { errors.push(details.message); console.error(details.message); } });
  win.webContents.on("preload-error", (_event, _path, error) => console.error(error));
  const js = source => win.webContents.executeJavaScript(source, true);
  const shot = async name => writeFileSync(join(out, name + ".png"), (await win.webContents.capturePage()).toPNG());
  const key = async (keyCode, modifiers = []) => {
    win.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
    if (keyCode === "Return") win.webContents.sendInputEvent({ type: "char", keyCode: "\r" });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
    await pause();
  };
  const click = async selector => {
    const p = await js(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error('Missing '+${JSON.stringify(selector)}); el.scrollIntoView({block:'nearest'}); const r=el.getBoundingClientRect(); return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}; })()`);
    win.webContents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, ...p });
    win.webContents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, ...p });
    await pause();
  };
  const pane = () => js(`(() => { const panel=document.querySelector('.pane-panel');const col=panel.querySelector('.inspector-col');const active=col.querySelector('[data-active="true"][data-pane]');return {display:getComputedStyle(panel).display, width:panel.getBoundingClientRect().width, group:document.querySelector('.main-group').getBoundingClientRect().width, main:document.querySelector('.main').getBoundingClientRect().width, inert:col.hasAttribute('inert'), active:active?.dataset.pane, kept:col.querySelector('[data-pane="file"]')?.dataset.testIdentity, sidebar:document.querySelector('.app').dataset.sidebar}; })()`);
  await win.loadFile(process.env.CAIRN_RENDERER_ENTRY ?? join(__dirname, "../dist/index.html"));
  for (let i = 0; i < 50; i++) { if (await js(`!!document.querySelector('.session')`)) break; await pause(100); }
  await click(".session");
  const initially = await pane();
  check("880 窄窗默认专注对话", initially.width === 0, initially);
  await key("i", ["meta", "alt"]); await pause();
  const overview = await pane();
  check("880 显式打开检查器后确实可见可交互", overview.width >= 320 && overview.main >= 419 && !overview.inert && overview.display !== "none", overview);
  await shot("01-inspector-880");
  await key("i", ["meta", "alt"]);
  check("880 检查器可再次隐藏", (await pane()).width === 0, await pane());
  await key("f", ["meta", "shift"]); await pause();
  const file = await pane();
  check("880 窗格快捷键打开可见文件", file.active === "file" && file.width >= 320 && file.main >= 419 && !file.inert, file);
  await shot("02-file-880");
  await js(`document.querySelector('[data-pane="file"]').dataset.testIdentity='preserved'`);
  await key("i", ["meta", "alt"]); await key("i", ["meta", "alt"]); await pause();
  const reopened = await pane();
  check("隐藏再显示同一窗格，不销毁内容", reopened.width >= 320 && reopened.kept === "preserved", reopened);
  await win.setContentSize(1120, 720); await pause();
  const wide = await pane();
  check("放宽窗口后已打开窗格仍可用", wide.width >= 320 && wide.kept === "preserved" && wide.main >= 419, wide);

  await win.setContentSize(880, 560); await pause();
  await click('[data-destination="memory"]');
  const secondCard = '.memory-card[aria-label="查看记忆主题 memory-02"]';
  await js(`document.querySelector(${JSON.stringify(secondCard)}).focus()`);
  await key("Tab");
  check("含链接预览的卡片仍只有一个键盘停点", await js(`document.activeElement?.getAttribute('aria-label') === '查看记忆主题 memory-03' && document.querySelector(${JSON.stringify(secondCard)}).textContent.includes('核对记录')`));
  await js(`document.querySelector(${JSON.stringify(secondCard)}).focus()`);
  await key("Return");
  check("打开卡片后正文保留可操作链接", await js(`document.querySelector('.ap-drawer-head .nm')?.textContent === 'memory-02' && !!document.querySelector('.ap-drawer a[href="http://localhost:5147/notes"]')`));
  await key("Escape");
  await js(`document.querySelector('.memory-card').focus()`);
  await key("Return");
  const detail = () => js(`(() => { const drawer=document.querySelector('.ap-drawer'), head=drawer.querySelector('.ap-drawer-head'), close=head.querySelector('button');const view=document.querySelector('[data-destination-page="memory"]');const body=drawer.querySelector('.ap-drawer-scroll, .ap-drawer-body');const r=drawer.getBoundingClientRect(),h=head.getBoundingClientRect();return {top:r.top, bottom:r.bottom, headTop:h.top, height:innerHeight, focused:document.activeElement===close, bodyOverflow:body.scrollHeight>body.clientHeight, pageOverflow:view.scrollWidth>view.clientWidth, scrollTop:body.scrollTop}; })()`);
  const opened = await detail();
  check("键盘打开记忆后焦点进入详情", opened.focused, opened);
  check("长正文约束在窗内并独立滚动", opened.bottom <= opened.height + 1 && opened.bodyOverflow && !opened.pageOverflow, opened);
  await shot("03-memory-open-880");
  await key("Tab"); await key("PageDown");
  check("键盘能直接聚焦详情正文并滚动阅读", await js(`document.activeElement === document.querySelector('.ap-drawer-scroll') && (document.activeElement?.scrollTop ?? 0)>0`));
  await js(`document.querySelector('.ap-drawer .ap-drawer-scroll, .ap-drawer .ap-drawer-body').scrollTop=100000`); await pause();
  const end = await detail();
  check("滚到正文底仍能看到标题与关闭", end.scrollTop > 0 && end.headTop >= 38 && end.bottom <= end.height + 1, end);
  await shot("04-memory-end-880");
  await key("Escape");
  const returned = await js(`({closed:!document.querySelector('.ap-drawer'),focus:document.activeElement?.getAttribute('aria-label')})`);
  check("Esc 关闭详情，焦点返回原卡片", returned.closed && returned.focus === "查看记忆主题 memory-01", returned);
  // On the original renderer Escape leaves the drawer open; close it to continue the checks.
  if (!returned.closed) await click(".ap-drawer-head button");
  await click(".memory-card");
  await click(".ap-drawer-head button");
  check("鼠标关闭详情同样返回卡片", await js(`!document.querySelector('.ap-drawer') && document.activeElement === document.querySelector('.memory-card')`));

  await click(".memory-card"); await click('.ap-drawer a[href="http://localhost:5147/audit"]');
  const browser = await js(`({visible:document.querySelector('.chat-workspace').dataset.hidden==='false',url:document.querySelector('[data-pane="browser"] input')?.value,shown:window.__cairnBrowserBounds().some(r=>r.width>0 && r.height>0)})`);
  check("记忆链接打开可见浏览器，地址正确", browser.visible && browser.url === "http://localhost:5147/audit" && browser.shown, browser);
  await click('[data-destination="memory"]');
  const retained = await js(`({detail:document.querySelector('.ap-drawer-head .nm')?.textContent,hidden:window.__cairnBrowserBounds().length>0 && window.__cairnBrowserBounds().every(r=>r.width===0 && r.height===0)})`);
  check("返回记忆保留已读详情，原生浏览视图让位", retained.detail === "memory-01" && retained.hidden, retained);
  const setSearch = async value => {
    await js(`(() => {const el=document.querySelector('input[aria-label="搜索记忆"]');el.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await pause();
  };
  await setSearch("zzzz无此条目");
  check("搜索排除已打开记录时不再显示旧详情", await js(`!document.querySelector('.ap-drawer') && document.querySelector('.memory-grid').textContent.includes('没有匹配的主题')`));
  await setSearch("");
  check("清空搜索不意外重开旧详情", await js(`!document.querySelector('.ap-drawer') && !!document.querySelector('.memory-card')`));
  if (await js(`!!document.querySelector('.ap-drawer')`)) await click(".ap-drawer-head button");

  const filters = destination => js(`(() => {const page=document.querySelector('[data-destination-page="'+${JSON.stringify(destination)}+'"]'); const visible=el=>el?.getClientRects().length>0 && getComputedStyle(el).visibility==='visible';const select=page.querySelector('.page-frame-filter');return {context:visible(document.querySelector('.page-context-sidebar')),chips:visible(page.querySelector('.page-frame-filter-chips')),select:visible(select),value:select?.value};})()`);
  await win.setContentSize(1440, 800); await pause();
  if (await js(`document.querySelector('.app').dataset.sidebar === 'collapsed'`)) await key("b", ["meta"]);
  const wideFilters = await filters("memory");
  check("宽窗有上下文栏时只显示一套筛选", wideFilters.context && !wideFilters.chips && !wideFilters.select, wideFilters);
  await shot("05-memory-filter-wide");
  await click(".page-context-item:nth-child(2)");
  await win.setContentSize(880, 560); await pause();
  const narrowFilters = await filters("memory");
  check("窄窗只有页内筛选，并保留项目层选择", !narrowFilters.context && !narrowFilters.chips && narrowFilters.select && narrowFilters.value === "project", narrowFilters);
  await click('[data-destination="automation"]');
  await click(".automation-views button:nth-child(2)");
  const idle = await filters("automation");
  check("窄窗闲时队列有唯一筛选入口", !idle.context && !idle.chips && idle.select, idle);
  await shot("06-idle-filter-880");
  const paused = await js(`(() => {const el=document.querySelector('[data-destination-page="automation"] .page-frame-filter');if(!el)return false;el.value='off';el.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
  await pause();
  check("闲时筛选隐藏排队任务并保留已完成历史", paused && await js(`(() => {const text=document.querySelector('.idle-task-section').innerText;return text.includes('暂无符合筛选的闲时任务') && !text.includes('整理本周笔记') && text.includes('汇总竞品动态');})()`));
  await click('button[data-destination="memory"]');
  await js(`document.documentElement.dataset.theme='dark';document.documentElement.dataset.mode='dark';document.body.toggleAttribute('data-ds-dark-theme',true)`);
  await click(".memory-card");
  const dark = await detail();
  check("深色窄窗详情和关闭按钮都在视口内", dark.top >= 38 && dark.bottom <= dark.height + 1 && dark.focused, dark);
  await shot("07-memory-dark-880");
  check("renderer 无控制台错误", errors.length === 0, errors);
  writeFileSync(join(out, "checks.json"), JSON.stringify({ fixtureData: true, checks, errors }, null, 2));
  console.log(`${checks.filter(c => c.ok).length}/${checks.length} PASS · ${out}`);
  app.exit(checks.every(c => c.ok) ? 0 : 1);
}
const watchdog = setTimeout(() => { console.error("workspace-design-smoke timeout"); app.exit(2); }, 60_000);
watchdog.unref();
main().catch(err => { console.error(err); app.exit(2); });
