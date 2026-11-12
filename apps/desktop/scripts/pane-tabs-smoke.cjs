// 单窗格标签页的真实 renderer 冒烟（2026-10-25）：
//   ① 切标签只换可见性，不卸载内容（终端/浏览器/文件树/旁路状态要保留）；
//   ② 7 个工具窗格与独立插件侧栏同时打开时，激活标签必须完整可见。
// 先 pnpm --filter cairn-desktop build，再 electron scripts/pane-tabs-smoke.cjs [输出目录]
const { app, BrowserWindow, nativeTheme } = require("electron");
const { scheduleProfileCleanup } = require("./lib/profile-cleanup.cjs");
const { mkdirSync, mkdtempSync, readFileSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");

const profile = mkdtempSync(join(tmpdir(), "cairn-pane-tabs-profile-"));
app.setPath("userData", profile);
nativeTheme.themeSource = "light";
app.on("quit", () => scheduleProfileCleanup(profile));
const out = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), "cairn-pane-tabs-"));
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
      backgroundThrottling: false,
      offscreen: true,
      preload: join(__dirname, "ui-gallery-preload.cjs"),
      additionalArguments: ["--cairn-api-members=" + JSON.stringify(members), "--cairn-protocol-version=" + version],
    },
  });
  const errors = [];
  win.webContents.on("console-message", (details) => { if (details.level === "error") errors.push(details.message); });
  await win.webContents.session.clearStorageData();
  await win.loadFile(process.env.CAIRN_RENDERER_ENTRY ?? join(__dirname, "../dist/index.html"));
  await new Promise((r) => setTimeout(r, 1200));
  const js = (source) => win.webContents.executeJavaScript(source);
  const wait = (ms = 300) => new Promise((r) => setTimeout(r, ms));
  const checks = [];
  const check = (name, ok, detail) => { checks.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(detail)}`); };
  const key = (code, keyValue, mods = {}) => js(`window.dispatchEvent(new KeyboardEvent("keydown", { code: ${JSON.stringify(code)}, key: ${JSON.stringify(keyValue)}, bubbles: true, metaKey: ${mods.meta ? "true" : "false"}, ctrlKey: ${mods.ctrl ? "true" : "false"}, shiftKey: ${mods.shift ? "true" : "false"}, altKey: ${mods.alt ? "true" : "false"} }))`);

  // 打开文件与方案窗格；验证切换只隐藏、不卸载。
  await key("KeyF", "f", { meta: true, shift: true }); await wait();
  await js(`document.querySelector('[data-pane="file"]').dataset.identity = 'kept-file'`);
  await key("KeyP", "p", { meta: true, shift: true }); await wait();
  await js(`document.querySelector('[data-pane="plan"]').dataset.identity = 'kept-plan'`);
  let state = await readState();
  check("两个标签都挂载，只有最新开的方案是 active", state.mounted === 2 && state.active === "plan" && state.planIdentity === "kept-plan", state);
  await js(`document.querySelector('[aria-label="切换到文件窗格"]').click()`); await wait();
  state = await readState();
  check("切回文件标签：文件可见、方案隐藏，两边状态都还在", state.active === "file" && state.fileVisible === "visible" && state.planVisible === "hidden" && state.fileIdentity === "kept-file" && state.planIdentity === "kept-plan", state);
  await js(`document.querySelector('[aria-label="切换到方案窗格"]').click()`); await wait();
  check("再切回方案：方案状态仍在（DOM 未被销毁重建）", (await readState()).planIdentity === "kept-plan");

  // 当前插件入口打开独立上下文侧栏；同时保留 7 个工具窗格的内容树。
  await key("KeyD", "d", { meta: true, shift: true }); await wait();
  await key("KeyT", "t", { meta: true, shift: true }); await wait();
  await key("KeyB", "b", { meta: true, shift: true }); await wait();
  await key("Backquote", "`", { ctrl: true }); await wait();
  await key("Semicolon", ";", { meta: true }); await wait();
  await key("KeyU", "u", { meta: true, shift: true }); await wait(800);
  state = await readState();
  check("7 个工具窗格与独立插件侧栏同时在场，只有旁路 active", state.mounted === 7 && state.activeCount === 1 && state.active === "sidechat" && !state.pluginsPresent && await js(`!!document.querySelector('.mod-sidebar')`), state);
  const geometry = await js(`(() => {
    const scroller = document.querySelector('.pane-nav-items');
    const activeTab = document.querySelector('.pane-tab.on');
    if (!scroller || !activeTab) return null;
    const s = scroller.getBoundingClientRect();
    const a = activeTab.getBoundingClientRect();
    return { scrollLeft: Math.round(scroller.scrollLeft), scrollWidth: scroller.scrollWidth, clientWidth: scroller.clientWidth, tabLeft: Math.round(a.left), tabRight: Math.round(a.right), viewLeft: Math.round(s.left), viewRight: Math.round(s.right), label: activeTab.textContent.trim() };
  })()`);
  check("多标签溢出时激活标签自动滚进可视区", geometry !== null && geometry.scrollWidth > geometry.clientWidth && geometry.scrollLeft > 0 && geometry.tabLeft >= geometry.viewLeft - 1 && geometry.tabRight <= geometry.viewRight + 1, geometry);
  // 2026-11-02 补一刀：溢出时左缘渐隐（mask）必须真的生效——此前只量了滚动位置，
  // 截图里首标签仍被拦腰切开（mask 是否挂上没人验证过）。
  const maskCheck = await js(`(() => {
    const scroller = document.querySelector('.pane-nav-items');
    const nav = document.querySelector('.pane-nav');
    if (!scroller || !nav) return null;
    const fade = getComputedStyle(nav, "::before");
    return { scrolled: scroller.dataset.scrolled ?? null, fadeWidth: fade.width, fadeImage: fade.backgroundImage !== "none" ? fade.backgroundImage.slice(0, 40) : null };
  })()`);
  check("溢出标签条左缘有渐隐覆盖层（首标签淡出，不被拦腰切）", maskCheck !== null && maskCheck.scrolled === "true" && maskCheck.fadeImage !== null && parseFloat(maskCheck.fadeWidth) >= 20, maskCheck);
  const img = await win.webContents.capturePage();
  writeFileSync(join(out, "01-seven-panes-active-visible.png"), img.toPNG());
  for (const width of [1120, 880, 1440]) {
    win.setContentSize(width, 720); await wait(450);
    const visible = await js(`(() => {
      const s = document.querySelector('.pane-nav-items'), t = document.querySelector('.pane-tab.on');
      const sr = s.getBoundingClientRect(), tr = t.getBoundingClientRect();
      return { viewport: innerWidth, width: sr.width, left: tr.left - sr.left, right: tr.right - sr.right };
    })()`);
    if (width === 880) {
      check("880px 自动收起工具区时保留全部窗格状态", visible.width === 0 && (await readState()).mounted === 7 && (await readState()).fileIdentity === "kept-file", visible);
    } else {
      check(`${width}px 调整窗口后当前标签与关闭按钮完整可见`, visible.width > 0 && visible.left >= -1 && visible.right <= 1, visible);
    }
    const composer = await js(`(() => {
      const row = document.querySelector('.row3'), action = row.querySelector('.send-btn:last-child');
      const r = row.getBoundingClientRect(), a = action.getBoundingClientRect();
      return { gap: r.right - a.right, padding: parseFloat(getComputedStyle(row).paddingRight) };
    })()`);
    check(`${width}px 输入控件换行后主动作仍靠右`, composer.gap <= composer.padding + 1, composer);
  }
  await js(`document.querySelector('[aria-label="切换到浏览器窗格"]').click()`); await wait();
  writeFileSync(join(out, "02-browser.png"), (await win.webContents.capturePage()).toPNG());
  await js(`document.querySelector('[aria-label="切换到旁路窗格"]').click()`); await wait();

  // 关闭 active 的旁路：内容移除，其余 6 块保留，焦点跟随当前可见窗格。
  await js(`document.querySelector('[aria-label="关闭旁路窗格"]').focus()`);
  await js(`document.querySelector('[aria-label="关闭旁路窗格"]').click()`); await wait();
  state = await readState();
  check("关闭 active 窗格只移除那一块，其余状态保留", state.mounted === 6 && !state.sidechatPresent && state.fileIdentity === "kept-file" && state.planIdentity === "kept-plan", state);
  check("关闭后焦点落到当前可见标签", await js(`document.activeElement === document.querySelector('.pane-nav-item[aria-pressed="true"]')`));
  check("renderer 无控制台错误", errors.length === 0, errors);

  writeFileSync(join(out, "checks.json"), JSON.stringify({ checks, consoleErrors: errors }, null, 2));
  console.log(`截图与读数：${out}\n隔离测试配置：${profile}`);
  app.exit(checks.every((c) => c.ok) ? 0 : 1);

  async function readState() {
    return js(`(() => {
      const chunks = [...document.querySelectorAll('.pane-chunk')];
      const active = chunks.find((el) => el.dataset.active === 'true');
      const byPane = (p) => chunks.find((el) => el.dataset.pane === p);
      const vis = (el) => el ? getComputedStyle(el).visibility : null;
      return {
        mounted: chunks.length,
        activeCount: chunks.filter((el) => el.dataset.active === 'true').length,
        active: active?.dataset.pane ?? null,
        fileVisible: vis(byPane('file')),
        planVisible: vis(byPane('plan')),
        fileIdentity: byPane('file')?.dataset.identity ?? null,
        planIdentity: byPane('plan')?.dataset.identity ?? null,
        pluginsPresent: !!byPane('plugins'),
        sidechatPresent: !!byPane('sidechat'),
      };
    })()`);
  }
}

const watchdog = setTimeout(() => { console.error("pane-tabs-smoke: 超时"); app.exit(1); }, 45_000);
watchdog.unref();
main().catch((err) => { console.error(err); app.exit(1); });
