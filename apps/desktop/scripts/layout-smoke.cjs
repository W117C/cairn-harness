// 用真实 renderer + 合成 AgentApi 验证布局；不运行模型，不使用或清空产品用户数据。
// 先 pnpm --filter cairn-desktop build，再 pnpm --filter cairn-desktop exec electron scripts/layout-smoke.cjs [输出目录]
const { app, BrowserWindow, nativeTheme } = require("electron");
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");

const profile = mkdtempSync(join(tmpdir(), "cairn-layout-profile-"));
app.setPath("userData", profile);
nativeTheme.themeSource = "light";
app.on("quit", () => { rmSync(profile, { recursive: true, force: true }); });
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
      additionalArguments: ["--cairn-api-members=" + JSON.stringify(members), "--cairn-protocol-version=" + version],
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
  await shot("01-home");
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
    return { greetPx: fs(greet), taPx: fs(ta), loudest, headingLeft: h.left, composerLeft: c.left, footer: document.querySelector('.avatar').textContent, railSettings: document.querySelector('.app-rail-settings')?.getAttribute('aria-label') ?? null,
      canvas: getComputedStyle(document.body).backgroundColor,
      radius: getComputedStyle(document.querySelector('.composer-card')).borderRadius,
      upstream: document.body.hasAttribute('data-dsh-claude-style') };
  })()`);
  check("首页标题、项目与输入区共用阅读起点", Math.abs(home.headingLeft - home.composerLeft) <= 24, home);
  check("设置入口只在能力轨，页脚账户位不再复制一枚", home.railSettings === "设置" && home.footer.trim() === "", home);
  // 第 870 页（业主「让布局说话」）：屏幕上最大的一档字不能再归给一句不能点、不能输入的
  // 装饰性问候。改前真机 1440 实测：问候 44.2px vs 输入正文 14px（3.2:1 倒挂）。
  check("首页问候不再以装饰大字压过输入区（≤ 24px 且 ≤ 输入正文 1.8 倍）", home.greetPx <= 24 && home.taPx > 0 && home.greetPx / home.taPx <= 1.8, home);
  // 2026-10-25：输入卡圆角按设计规范 §4.5 回到 12px（上游 18px 被 adapter 覆盖层压回 v3 档）；
  // 这条读数原先钉 18px，是改版后没跟上，不是产品回归。
  check("已加载上游 Claude 主题与输入卡样式", home.upstream && home.canvas === "rgb(252, 252, 251)" && home.radius === "12px", home);
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
    overviewNames: document.querySelectorAll('.isp-ov-name').length,
    overviewContext: !!document.querySelector('.isp-ov-context'),
  }))()`);
  check(
    "检查器概览不重复顶栏会话名，只保留上下文与运行事实",
    inspectorOverview.open && inspectorOverview.toolbarTitles === 1 && inspectorOverview.toolbarTitle !== "" && inspectorOverview.overviewNames === 0 && inspectorOverview.overviewContext,
    inspectorOverview,
  );
  await shot("02b-inspector-overview");
  // 运行态 chip 的**可读性**（第 903 页）：它是文字（--fs-caption-2xs），按文本 4.5:1 判。
  // 不靠"看着还行"——页内取计算色与它自己那层淡染底，现算 WCAG 相对亮度比。
  // 属性是这一档的唯一开关（真实运行时由状态机写），这里按同一形制临时置上再量，量完还原。
  const runChip = await js(`(() => {
    const el = document.querySelector('.isp-ov-status');
    if (!el) return { present: false };
    const was = el.getAttribute('data-running');
    el.setAttribute('data-running', 'true');
    const cs = getComputedStyle(el);
    const rgba = (s) => { const m = s.match(/[\\d.]+/g); if (!m) return null; return { c: m.slice(0, 3).map(Number), a: m.length > 3 ? Number(m[3]) : 1 }; };
    const lum = (rgb) => { const [r, g, b] = rgb.map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    // getComputedStyle 返回的是**活对象**：还原属性后再读 cs.color 会拿到空闲态的灰，
    // 于是读数看着"过了线"其实量错了对象 ⇒ 所有取值必须在还原之前落成字符串/数字。
    const fgStr = cs.color;
    const size = cs.fontSize;
    const fg = rgba(fgStr);
    const chip = rgba(cs.backgroundColor) || { c: [255, 255, 255], a: 0 };
    // 底是 6% 淡染 ⇒ 必须先与宿主底色混成不透明色再算（拿带 alpha 的值直接当亮度会算错）。
    let host = { c: [255, 255, 255], a: 1 };
    for (let n = el.parentElement; n; n = n.parentElement) {
      const h = rgba(getComputedStyle(n).backgroundColor);
      if (h && h.a > 0.99) { host = h; break; }
    }
    const bg = chip.c.map((v, i) => v * chip.a + host.c[i] * (1 - chip.a));
    const lf = lum(fg.c), lb = lum(bg);
    const ratio = +(((Math.max(lf, lb) + 0.05) / (Math.min(lf, lb) + 0.05))).toFixed(2);
    if (was === null) el.removeAttribute('data-running'); else el.setAttribute('data-running', was);
    return { present: true, ratio, fg: fgStr, bg: bg.map((v) => Math.round(v)).join(','), size };
  })()`);
  check(
    "运行态 chip 的文字与它自己的淡染底过 AA 文本 4.5:1",
    runChip.present === true && runChip.ratio >= 4.5 && runChip.fg === "rgb(162, 89, 5)",
    runChip,
  );
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
  check(
    "检查器方向键切 Tab，焦点与面板语义同步，只保留一个 Tab 停点",
    inspectorTabState.selected === "改动" && inspectorTabState.focused === "改动" && inspectorTabState.panel !== "" && inspectorTabState.rovingStops === 1,
    inspectorTabState,
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
