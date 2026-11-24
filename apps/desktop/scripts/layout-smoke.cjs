// 用真实 renderer + 合成 AgentApi 验证布局；不运行模型，不使用或清空产品用户数据。
// 先 pnpm --filter cairn-desktop build，再 pnpm --filter cairn-desktop exec electron scripts/layout-smoke.cjs [输出目录]
const { app, BrowserWindow, nativeTheme } = require("electron");
const { scheduleProfileCleanup } = require("./lib/profile-cleanup.cjs");
const { mkdirSync, mkdtempSync, readFileSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");

const profile = mkdtempSync(join(tmpdir(), "cairn-layout-profile-"));
app.setPath("userData", profile);
nativeTheme.themeSource = "light";
app.on("quit", () => scheduleProfileCleanup(profile));
const out = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), "cairn-layout-"));
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
      additionalArguments: [
        "--cairn-api-members=" + JSON.stringify(members),
        "--cairn-protocol-version=" + version,
        "--cairn-project-launcher-fixture",
      ],
    },
  });
  const errors = [];
  win.webContents.on("console-message", (details) => { if (details.level === "error") errors.push(details.message); });
  const js = (source) => win.webContents.executeJavaScript(source);
  const pause = () => new Promise((r) => setTimeout(r, 350));
  const shot = async (name) => { await pause(); writeFileSync(join(out, name + ".png"), (await win.webContents.capturePage()).toPNG()); };
  const checks = [];
  const check = (name, ok, detail) => checks.push({ name, ok, detail });
  await win.loadFile(join(__dirname, "../dist/index.html"));
  await pause();
  const searchClosed = await js(`(() => ({
    row: document.querySelectorAll('.side-search').length,
    toggle: !!document.querySelector('[data-sidebar-search-toggle]'),
    title: document.querySelector('[data-sidebar-search-toggle]')?.getAttribute('title') ?? '',
    ariaLabel: document.querySelector('[data-sidebar-search-toggle]')?.getAttribute('aria-label') ?? '',
  }))()`);
  check(
    "侧栏默认只保留会话搜索入口，不常驻搜索框",
    searchClosed.row === 0 && searchClosed.toggle && searchClosed.title === "搜索会话" && searchClosed.ariaLabel === "搜索会话",
    searchClosed,
  );
  await js(`document.querySelector('[data-sidebar-search-toggle]')?.click()`);
  await pause();
  const searchExpanded = await js(`(() => ({
    row: document.querySelectorAll('.side-search').length,
    focused: document.activeElement?.classList.contains('side-search-input') ?? false,
  }))()`);
  check("点击搜索入口后展开并自动聚焦输入框", searchExpanded.row === 1 && searchExpanded.focused, searchExpanded);
  await shot("01b-search-open");
  await js(`document.querySelector('.side-search-input')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await pause();
  const searchDismissed = await js(`(() => ({
    row: document.querySelectorAll('.side-search').length,
    focused: document.activeElement?.hasAttribute('data-sidebar-search-toggle') ?? false,
  }))()`);
  check("空搜索再按 Esc 收起，并把焦点还给搜索入口", searchDismissed.row === 0 && searchDismissed.focused, searchDismissed);
  const quickStarts = await js(`(() => ({
    rows: document.querySelectorAll('.start').length,
    numbers: document.querySelectorAll('.start-n').length,
  }))()`);
  check("空态建议保持无编号行", quickStarts.rows > 0 && quickStarts.numbers === 0, quickStarts);
  const launcherInitial = await js(`(() => ({
    labels: [...document.querySelectorAll('.project-row .launch-label')].map((el) => el.textContent.trim()),
    active: document.querySelectorAll('.project-row[aria-current="true"]').length,
    hasPopup: document.querySelector('.environment-row')?.getAttribute('aria-haspopup') ?? null,
    expanded: document.querySelector('.environment-row')?.getAttribute('aria-expanded') ?? null,
    controls: document.querySelector('.environment-row')?.getAttribute('aria-controls') ?? null,
    dialog: !!document.querySelector('#project-picker[role="dialog"]'),
  }))()`);
  check(
    "首页先按最近顺序展示真实项目，不点击补造当前项",
    launcherInitial.labels.join("|") === "mobile-app|design-system|demo-ws"
      && launcherInitial.active === 0 && launcherInitial.hasPopup === "dialog"
      && launcherInitial.expanded === "false" && launcherInitial.controls === "project-picker" && launcherInitial.dialog,
    launcherInitial,
  );
  await js(`(() => {
    const group = [...document.querySelectorAll('.group')].find((el) => el.querySelector('.g-name')?.textContent?.trim() === 'design-system');
    group?.querySelector('.g-more')?.click();
  })()`);
  await pause();
  await js(`[...document.querySelectorAll('.ctx-menu [role="menuitem"]')].find((el) => el.textContent.includes('重命名显示名'))?.click()`);
  await pause();
  await js(`(() => {
    const input = document.querySelector('.s-rename');
    if (input === null) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, '设计系统');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  })()`);
  await pause();
  const renamed = await js(`(() => ({
    labels: [...document.querySelectorAll('.project-row .launch-label')].map((el) => el.textContent.trim()),
    calls: window.__cairnProjectLauncher?.calls().add ?? [],
  }))()`);
  check("项目改名后卡组立即采用注册表新名，不保留旧最近行标签", renamed.labels.includes("设计系统") && !renamed.labels.includes("design-system") && renamed.calls.some((call) => call.name === "设计系统"), renamed);
  await js(`document.querySelectorAll('.action-row')[0]?.click()`);
  await pause();
  const addedProject = await js(`(() => ({
    labels: [...document.querySelectorAll('.project-row .launch-label')].map((el) => el.textContent.trim()),
    registered: window.__cairnProjectLauncher?.registeredPaths() ?? [],
    calls: window.__cairnProjectLauncher?.calls().add ?? [],
  }))()`);
  check("空屏添加项目后最近卡组刷新，新项目不再被旧快照遮住", addedProject.labels.includes("demo-ws-new") && addedProject.registered.includes("/tmp/demo-ws-new") && addedProject.calls.some((call) => call.path === "/tmp/demo-ws-new"), addedProject);
  await js(`document.querySelector('.diagnosis-card .x')?.click()`);
  await js(`[...document.querySelectorAll('.project-row')].find((el) => el.textContent.includes('mobile-app'))?.click()`);
  await pause();
  const readded = await js(`(() => {
    const row = document.querySelector('.environment-row');
    const branch = row?.querySelector('.launch-branch');
    const rect = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width }; };
    return {
      active: document.querySelector('.project-row[aria-current="true"] .launch-label')?.textContent?.trim() ?? null,
      branch: branch?.textContent?.trim() ?? null,
      branchTruncated: branch !== null && branch !== undefined && branch.scrollWidth > branch.clientWidth,
      sameRow: row !== null && [...row.children].every((el) => {
        const a = el.getBoundingClientRect();
        const b = row.getBoundingClientRect();
        return Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2) <= 1;
      }),
      chevronInside: row !== null && rect(row.lastElementChild).right <= rect(row).right - 8,
      calls: window.__cairnProjectLauncher?.calls(),
      registered: window.__cairnProjectLauncher?.registeredPaths(),
    };
  })()`);
  check(
    "已移除项目从卡组真实重加、切根并显示长分支，四个格子不换行",
    readded.active === "mobile-app" && readded.branch === "feature/empty-state-with-a-very-long-branch-name"
      && readded.branchTruncated && readded.sameRow && readded.chevronInside
      && readded.calls?.add?.some((call) => call.path === "/tmp/demo-ws-mobile")
      && readded.calls?.workspace?.includes("/tmp/demo-ws-mobile")
      && readded.calls?.touch?.includes("p3")
      && readded.registered?.includes("/tmp/demo-ws-mobile"),
    readded,
  );
  await js(`document.querySelector('.diagnosis-card .x')?.click()`);
  await shot("01-home");
  const launcher = await js(`(() => {
    const root = document.querySelector('.project-launcher');
    const rect = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, center: (r.left + r.right) / 2 }; };
    return {
      cards: root?.querySelectorAll('[data-cds="Card"]').length ?? 0,
      links: root?.querySelectorAll('[data-cds="CardLink"]').length ?? 0,
      projectRows: root?.querySelectorAll('.project-row').length ?? 0,
      active: root?.querySelectorAll('.project-row[aria-current="true"]').length ?? 0,
      environment: root?.querySelector('.environment-row')?.textContent?.trim() ?? '',
      autoPressed: root?.querySelector('.action-row[aria-pressed]')?.getAttribute('aria-pressed') ?? null,
      launcher: root ? rect(root) : null,
      hero: rect(document.querySelector('.empty-greet')),
      composer: rect(document.querySelector('.composer-card')),
    };
  })()`);
  check("首页项目卡组使用官方 Card/CardLink，当前项目与环境可读", launcher.cards === 3 && launcher.links === launcher.projectRows + 3 && launcher.projectRows > 0 && launcher.active === 1 && launcher.environment.includes('本地工作区'), launcher);
  check("首页 hero、项目卡组与输入区共用中轴", Math.abs(launcher.hero.center - launcher.launcher.center) <= 1 && Math.abs(launcher.launcher.center - launcher.composer.center) <= 1, launcher);
  await js(`document.querySelector('.environment-row')?.click()`);
  await pause();
  const picker = await js(`(() => ({
    open: !!document.querySelector('.chip-pop.show'),
    focused: document.activeElement?.classList.contains('chip-search') ?? false,
    rows: document.querySelectorAll('.chip-list .menu-item').length,
    expanded: document.querySelector('.environment-row')?.getAttribute('aria-expanded') ?? null,
    current: document.querySelector('.chip-list .menu-item[aria-current="true"]')?.textContent?.includes('mobile-app') ?? false,
  }))()`);
  check("环境行打开真实项目选择弹层、同步 ARIA 并聚焦搜索", picker.open && picker.focused && picker.rows > 0 && picker.expanded === "true" && picker.current, picker);
  await shot("01b-project-picker");
  await js(`document.querySelector('.chip-search')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await pause();
  const pickerDismissed = await js(`(() => ({
    open: !!document.querySelector('.chip-pop.show'),
    expanded: document.querySelector('.environment-row')?.getAttribute('aria-expanded') ?? null,
    focused: document.activeElement?.classList.contains('environment-row') ?? false,
  }))()`);
  check("项目弹层 Esc 关闭后归还环境行焦点", !pickerDismissed.open && pickerDismissed.expanded === "false" && pickerDismissed.focused, pickerDismissed);
  const autoPoint = await js(`(() => {
    const r = document.querySelector('.action-row[aria-pressed]').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  await win.webContents.sendInputEvent({ type: "mouseMove", ...autoPoint });
  await win.webContents.sendInputEvent({ type: "mouseDown", ...autoPoint, button: "left", clickCount: 1 });
  await pause();
  const cardPress = await js(`(() => {
    const row = document.querySelector('.action-row[aria-pressed]');
    const card = row.closest('[data-cds="Card"]');
    const fill = card.querySelector('.cds-card-fill');
    const body = card.querySelector('.cds-card-body');
    const style = getComputedStyle(card);
    return {
      active: row.matches(':active'),
      cardActive: card.matches(':has([data-cds="CardLink"]:active)'),
      sx: style.getPropertyValue('--cds-card-press-sx').trim(),
      sy: style.getPropertyValue('--cds-card-press-sy').trim(),
      d: style.getPropertyValue('--cds-card-press-d').trim(),
      transform: getComputedStyle(fill).transform,
      clipPath: getComputedStyle(body).clipPath,
    };
  })()`);
  await win.webContents.sendInputEvent({ type: "mouseUp", ...autoPoint, button: "left", clickCount: 1 });
  await pause();
  check(
    "官方 Card 按压几何有真实缩放与裁切，不是只写 data-cds",
    Number(cardPress.sx) === 0.99 && Number(cardPress.sy) === 0.99 && cardPress.d === "2px"
      && cardPress.active && cardPress.cardActive
      && cardPress.transform.startsWith("matrix(0.99, 0, 0, 0.99") && cardPress.clipPath.startsWith("inset(2px"),
    cardPress,
  );
  const autoConfirm = await js(`(() => ({
    dialog: !!document.querySelector('.confirm-card'),
    pressed: document.querySelector('.action-row[aria-pressed]')?.getAttribute('aria-pressed') ?? null,
    settings: window.__cairnSettingsCalls?.().filter((patch) => patch.mode === 'auto') ?? [],
  }))()`);
  check("自动模式危险档先确认，确认前不落盘", autoConfirm.dialog && autoConfirm.pressed === 'false' && autoConfirm.settings.length === 0, autoConfirm);
  await js("document.querySelector('.confirm-card .mini-btn.danger')?.click()");
  await pause();
  const autoOn = await js(`document.querySelector('.action-row[aria-pressed]')?.getAttribute('aria-pressed')`);
  const autoSettings = await js(`window.__cairnSettingsCalls?.().filter((patch) => patch.mode === 'auto') ?? []`);
  check("自动模式动作切换现有权限档、落盘并回显状态", autoOn === 'true' && autoSettings.length === 1, { autoOn, autoSettings });
  await js(`document.querySelector('.action-row[aria-pressed]')?.click()`);
  await pause();
  const autoOff = await js(`document.querySelector('.action-row[aria-pressed]')?.getAttribute('aria-pressed')`);
  const autoOffSettings = await js(`window.__cairnSettingsCalls?.().filter((patch) => patch.mode === 'default') ?? []`);
  check("自动模式可逆切回默认档并落盘", autoOff === 'false' && autoOffSettings.length === 1, { autoOff, autoOffSettings });
  const home = await js(`(() => {
    const h = document.querySelector('.empty-greet').getBoundingClientRect();
    const c = document.querySelector('.composer-card').getBoundingClientRect();
    const fs = (el) => (el ? parseFloat(getComputedStyle(el).fontSize) : 0);
    const greet = document.querySelector('.empty-greet');
    const ta = document.querySelector('.composer-card textarea');
    // 首页可见文字里字号最大的一档归谁（装饰性问候 vs 可操作的输入区）
    let loudest = { t: null, px: 0 };
    for (const el of document.querySelectorAll('.main *, .main')) {
      const r = el.getBoundingClientRect();
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);
      if (!own || r.width < 2 || r.height < 2) continue;
      const px = fs(el);
      if (px > loudest.px) loudest = { t: (el.className || el.tagName).toString().slice(0, 24), px };
    }
    return { greetPx: fs(greet), taPx: fs(ta), loudest, headingLeft: h.left, composerLeft: c.left,
      railAccount: document.querySelector('.app-rail-user .avatar')?.getAttribute('aria-label') ?? null,
      sideSettings: [...document.querySelectorAll('.side-wrap button')].filter((el) => (el.getAttribute('aria-label') ?? '') === '设置' || (el.textContent ?? '').trim() === '设置').length,
      emptyLeft: document.querySelector('.empty').getBoundingClientRect().left,
      emptyRight: document.querySelector('.empty').getBoundingClientRect().right,
      belowLeft: document.querySelector('.empty-below').getBoundingClientRect().left,
      zoneLeft: document.querySelector('.zone-composer').getBoundingClientRect().left,
      zoneRight: document.querySelector('.zone-composer').getBoundingClientRect().right,
      brandInBar: document.querySelectorAll('.tb-brand').length,
      brandInSide: document.querySelectorAll('.side-brand').length,
      canvas: getComputedStyle(document.body).backgroundColor,
      radius: getComputedStyle(document.querySelector('.composer-card')).borderRadius,
      upstream: document.body.hasAttribute('data-dsh-claude-style') };
  })()`);
  // ADR 0019 P2/P3：项目卡组是居中独立卡面，不再与输入卡共用左缘；真实契约是同轴。
  check("首页 dock 横贯主区，项目卡组保持独立最大宽度", home.zoneRight > home.emptyRight && launcher.launcher.right - launcher.launcher.left <= 440, { home, launcher });
  check("品牌标同屏一处：恒在顶栏，侧栏不重复", home.brandInBar === 1 && home.brandInSide === 0, home);
  await js(`document.querySelector('.titlebar button[aria-label="折叠侧栏"]')?.click()`);
  await pause();
  const collapsedBrand = await js(`(() => ({
    bar: document.querySelectorAll('.tb-brand').length,
    side: document.querySelectorAll('.side-brand').length,
    sidebar: document.querySelector('.app')?.getAttribute('data-sidebar') ?? null,
  }))()`);
  check("侧栏收起后品牌标仍在顶栏，且侧栏状态真实切换", collapsedBrand.bar === 1 && collapsedBrand.side === 0 && collapsedBrand.sidebar === 'collapsed', collapsedBrand);
  await js(`document.querySelector('.titlebar button[aria-label="展开侧栏"]')?.click()`);
  await pause();
  // 第 1041 页：一屏一条列宽不能只在 1440 成立。气沟（--reading-pad-x）此前只落在
  // .reading 上，880 窗实测空态 41px vs 输入区 16px ⇒ 问候左缘 345 vs 输入卡 320。
  // 现在气沟也收在 .main 一个变量上，窄窗内容左缘必须一起对齐。
  await win.setContentSize(880, 700);
  await pause();
  const narrowHome = await js(`(() => {
    const rect = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { left: +r.left.toFixed(1), right: +r.right.toFixed(1), center: +(r.left + r.right).toFixed(1) / 2 }; };
    const pad = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).paddingLeft : null; };
    return { empty: rect('.empty'), below: rect('.empty-below'), zone: rect('.zone-composer'), greet: rect('.empty-greet'), card: rect('.composer-card'), launcher: rect('.project-launcher'), overflow: document.documentElement.scrollWidth > innerWidth, pads: { empty: pad('.empty'), below: pad('.empty-below'), zone: pad('.zone-composer') } };
  })()`);
  check(
    "窄窗 880：hero / 项目卡组 / 输入区同轴，页面无横向溢出",
    narrowHome.empty !== null && narrowHome.zone !== null && narrowHome.greet !== null && narrowHome.card !== null && narrowHome.launcher !== null
      && Math.abs(narrowHome.greet.center - narrowHome.launcher.center) <= 1
      && Math.abs(narrowHome.launcher.center - narrowHome.card.center) <= 1
      && !narrowHome.overflow,
    narrowHome,
  );
  await win.setContentSize(1440, 900);
  await pause();
  check("设置入口只在能力轨账户菜单，侧栏不再复制一枚", home.railAccount === "设置、外观与用量" && home.sideSettings === 0, home);
  // 第 870 页（业主「让布局说话」）：屏幕上最大的一档字不能再归给一句不能点、不能输入的
  // 装饰性问候。改前真机 1440 实测：问候 44.2px vs 输入正文 14px（3.2:1 倒挂）。
  check("首页问候不再以装饰大字压过输入区（≤ 24px 且 ≤ 输入正文 1.8 倍）", home.greetPx <= 24 && home.taPx > 0 && home.greetPx / home.taPx <= 1.8, home);
  // 2026-10-25：输入卡圆角按设计规范 §4.5 回到 12px（上游 18px 被 adapter 覆盖层压回 v3 档）；
  // 这条读数原先钉 18px，是改版后没跟上，不是产品回归。
  check("已加载上游 Claude 主题与输入卡样式", home.upstream && home.canvas === "rgb(252, 252, 251)" && home.radius === "12px", home);
  await js("document.querySelector('.session').click()");
  await pause();
  const crossWorkspaceOpen = await js(`(() => ({
    empty: document.querySelector('.main')?.getAttribute('data-empty'),
    workspace: document.querySelector('.tb-workspace')?.textContent?.trim() ?? '',
    calls: window.__cairnProjectLauncher?.calls().workspace ?? [],
  }))()`);
  check(
    "从移动项目打开旧会话时会话归属覆盖窗口根，不沿用卡组刚选的路径",
    crossWorkspaceOpen.empty === "false" && crossWorkspaceOpen.workspace.includes("demo-ws")
      && crossWorkspaceOpen.calls.includes("/tmp/demo-ws"),
    crossWorkspaceOpen,
  );
  await js("document.querySelector('.app-rail-item[data-row=\"new\"]')?.click()");
  await pause();
  const returnedHome = await js(`(() => ({
    empty: document.querySelector('.main')?.getAttribute('data-empty'),
    active: document.querySelector('.project-row[aria-current="true"] .launch-label')?.textContent?.trim() ?? null,
    stream: !!document.querySelector('.stream'),
  }))()`);
  check("跨工作区会话回新任务后清掉旧转录并保留真实项目根", returnedHome.empty === "true" && returnedHome.active === "demo-ws" && !returnedHome.stream, returnedHome);
  await js(`[...document.querySelectorAll('.project-row')].find((el) => el.textContent.includes('mobile-app'))?.click()`);
  await pause();
  const switchedProject = await js(`(() => ({
    empty: document.querySelector('.main')?.getAttribute('data-empty'),
    active: document.querySelector('.project-row[aria-current="true"] .launch-label')?.textContent?.trim() ?? null,
    calls: window.__cairnProjectLauncher?.calls().workspace ?? [],
    stream: !!document.querySelector('.stream'),
  }))()`);
  check(
    "空屏切到第二项目只换根、不把上一项目的会话带过来",
    switchedProject.empty === "true" && switchedProject.active === "mobile-app"
      && switchedProject.calls.includes("/tmp/demo-ws-mobile") && !switchedProject.stream,
    switchedProject,
  );
  await js("document.querySelector('.session').click()");
  await shot("02-session");
  const defaultShell = await js(`(() => {
    const inspector = document.querySelector('.inspector-col');
    const composer = document.querySelector('.composer-card').getBoundingClientRect();
    return {
      inspectorWidth: inspector?.getBoundingClientRect().width ?? -1,
      inspectorInert: inspector?.hasAttribute('inert') ?? false,
      pluginStrip: document.querySelectorAll('.plugin-strip').length,
      composerWidth: Math.round(composer.width),
    };
  })()`);
  check(
    "1440 首次进会话保持专注两栏，插件命令不常驻",
    defaultShell.inspectorWidth < 1 && defaultShell.inspectorInert && defaultShell.pluginStrip === 0,
    defaultShell,
  );
  await js(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "i", code: "KeyI", metaKey: true, altKey: true, bubbles: true }))`);
  await pause();
  const inspectorOverview = await js(`(() => ({
    open: !document.querySelector('.inspector-col')?.hasAttribute('inert'),
    toolbarTitles: document.querySelectorAll('.tb-title').length,
    toolbarTitle: document.querySelector('.tb-title')?.textContent?.trim() ?? '',
    headText: document.querySelector('.isp-head')?.textContent ?? '',
    deadOverview: document.querySelectorAll('.isp-ov-name, .isp-ov-context, .isp-ov-status').length,
  }))()`);
  // 2026-11-07 第 1041 页归因：概览 Tab 已按「没有数据的 Tab 一律不出现」下架（Inspector.tsx），
  // 旧判卷钉的 .isp-ov-* 三个选择器在现源码里 0 命中 ⇒ 恒红。新契约：检查器头只有 Tab 与窗格入口，
  // 不重复顶栏会话名；旧选择器留作回潮反证。
  check(
    "检查器头不重复顶栏会话名（只留 Tab 与窗格入口，概览面不回潮）",
    inspectorOverview.open && inspectorOverview.toolbarTitles === 1 && inspectorOverview.toolbarTitle !== "" && !inspectorOverview.headText.includes(inspectorOverview.toolbarTitle) && inspectorOverview.deadOverview === 0,
    inspectorOverview,
  );
  await shot("02b-inspector-overview");
  // 运行态可读性：旧量的 .isp-ov-status 淡染 chip 随概览面一起下架；--color-run-ink 的
  // AA 纪律现由 contrast-gate.test.ts 的具名墨色对表 + 回潮扫描守（桌面套件每跑必量）。
  // 这里只留反证：死 chip 不许复活成又一个没人量对比度的面。
  const runChip = await js(`(() => ({ present: document.querySelectorAll('.isp-ov-status').length }))()`);
  check(
    "已下架的概览运行 chip 不回潮（run-ink 对比度归 contrast-gate 具名对表）",
    runChip.present === 0,
    runChip,
  );
  const tabsBefore = await js(`[...document.querySelectorAll('.isp-tab')].map((t) => t.textContent.trim())`);
  await js(`(() => {
    const current = document.querySelector('.isp-tab[aria-selected="true"]');
    current?.focus();
    current?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', bubbles: true, cancelable: true }));
  })()`);
  await pause();
  const inspectorTabState = await js(`(() => ({
    selected: document.querySelector('.isp-tab[aria-selected="true"]')?.textContent?.trim() ?? '',
    focused: document.activeElement?.classList.contains('isp-tab') ? document.activeElement.textContent?.trim() ?? '' : '',
    panel: document.querySelector('[role="tabpanel"]')?.getAttribute('aria-labelledby') ?? '',
    rovingStops: document.querySelectorAll('.isp-tab[tabindex="0"]').length,
  }))()`);
  // 旧判卷硬钉「ArrowRight 后＝改动」，前提是概览 Tab 排在改动之前；概览下架后首可用 Tab 即改动，
  // 方向键应落到**第二个可用 Tab**。按现契约动态取期望，不硬钉档名。
  check(
    "检查器方向键切 Tab，焦点与面板语义同步，只保留一个 Tab 停点",
    tabsBefore.length > 1 && inspectorTabState.selected === tabsBefore[1] && inspectorTabState.focused === tabsBefore[1] && inspectorTabState.panel !== "" && inspectorTabState.rovingStops === 1,
    { ...inspectorTabState, tabsBefore },
  );
  await shot("02c-inspector-changes");
  const row = await js(`(() => {
    const r = document.querySelector('.session').getBoundingClientRect();
    const t = document.querySelector('.s-title').getBoundingClientRect();
    return { rowWidth: r.width, titleWidth: t.width };
  })()`);
  check("侧栏任务名获得至少六成行宽", row.titleWidth >= row.rowWidth * .6, row);

  // 一轮 = 一条列（2026-11-01 第 862 页）：助手行 / 思考带 / 工具簇 / 交付卡 / 署名条同为
  // `.reading` 的直接子元素，右缘必须落在同一条 fluid stop 上。
  // 改前真机读数：正文右缘 1185，而思考带与工具簇 1241 ⇒ 同一轮里 56px 的右沿锯齿。
  // 用户行仍贴阅读列右缘（上游 Claude 同样只给助手正文右侧留白）。
  const turnEdges = await js(`(() => {
    const right = (sel) => { const el = document.querySelector(sel); return el ? Math.round(el.getBoundingClientRect().right) : -1; };
    return {
      assistant: right('.row.assistant'), prose: right('.row.assistant .md-body'),
      think: right('.row.think'), tools: right('.toolcluster'),
      card: right('.changes-card'), footer: right('.assistant-footer'),
      user: right('.row.user'), reading: right('.reading'),
    };
  })()`);
  const bandRights = [turnEdges.assistant, turnEdges.prose, turnEdges.think, turnEdges.tools, turnEdges.card, turnEdges.footer].filter((v) => v > 0);
  check(
    "一轮 = 一条列：助手行/正文/过程带/交付卡/署名条共用同一右缘，用户行仍贴列右",
    bandRights.length >= 4 && bandRights.every((v) => Math.abs(v - bandRights[0]) <= 1) && turnEdges.user > bandRights[0] && turnEdges.reading > turnEdges.user,
    { ...turnEdges, bands: bandRights },
  );
  await win.setContentSize(880, 700);
  await shot("03-narrow");
  const narrow = await js(`(() => {
    const c = document.querySelector('.composer-card').getBoundingClientRect();
    return { left: c.left, right: c.right, viewport: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth };
  })()`);
  check("窄窗输入框完整可见，页面无横向溢出", !narrow.overflow && narrow.left >= 0 && narrow.right <= narrow.viewport, narrow);
  nativeTheme.themeSource = "dark";
  await shot("04-dark");
  const dark = await js(`({ canvas: getComputedStyle(document.body).backgroundColor, link: getComputedStyle(document.querySelector('.md-body a')).color })`);
  // 2026-10-28：画布从皮肤近似色 #141413 改为官方 CDS surface-1 = gray-850 #151515
  // （真机实测 Claude 主窗暗色页面就是 #151515，见 PROGRESS 第 733 页）。链接色不变。
  check("暗色主题与 Markdown 链接使用上游配色", dark.canvas === "rgb(21, 21, 21)" && dark.link === "rgb(138, 180, 248)", dark);
  await win.setContentSize(1440, 900);
  nativeTheme.themeSource = "light";
  await js('window.dispatchEvent(new KeyboardEvent("keydown", { key: ",", code: "Comma", metaKey: true, bubbles: true }))');
  await pause();
  await js(`[...document.querySelectorAll('.sp-nav-item')].find(b => b.textContent.includes('模型与 Provider'))?.click()`);
  await shot("05-settings");
  const settings = await js(`({ open: !!document.querySelector('.sp-page'), title: document.querySelector('.tb-title-slot').textContent, tools: document.querySelector('.tb-right').textContent, taskButton: !!document.querySelector('.tb-right button') })`);
  check("设置页顶栏显示当前页面并收起任务操作", settings.open && settings.title === "设置" && !settings.taskButton, settings);
  check("渲染过程无控制台错误", errors.length === 0, errors);
  writeFileSync(join(out, "checks.json"), JSON.stringify(checks, null, 2));
  checks.forEach((c) => console.log(`${c.ok ? "PASS" : "FAIL"} ${c.name} ${JSON.stringify(c.detail)}`));
  console.log(`截图与读数：${out}\n隔离测试配置：${profile}`);
  app.exit(checks.every((c) => c.ok) ? 0 : 1);
}
const watchdog = setTimeout(() => { console.error("layout-smoke: 超时"); app.exit(1); }, 30_000);
watchdog.unref();
main().catch((err) => { console.error(err); app.exit(1); });
