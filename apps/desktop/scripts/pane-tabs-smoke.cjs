// 单窗格标签页的真实 renderer 冒烟（2026-10-25）：
//   ① 切标签只换可见性，不卸载内容（终端/浏览器/文件树/旁路状态要保留）；
//   ② 8 个窗格全开、标签条横向溢出时，激活标签必须自己滚进可视区。
// 先 pnpm --filter cairn-desktop build，再 electron scripts/pane-tabs-smoke.cjs [输出目录]
const { app, BrowserWindow, nativeTheme } = require("electron");
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");

const profile = mkdtempSync(join(tmpdir(), "cairn-pane-tabs-profile-"));
app.setPath("userData", profile);
nativeTheme.themeSource = "light";
app.on("quit", () => { rmSync(profile, { recursive: true, force: true }); });
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
      preload: join(__dirname, "ui-gallery-preload.cjs"),
      additionalArguments: ["--cairn-api-members=" + JSON.stringify(members), "--cairn-protocol-version=" + version],
    },
  });
  const errors = [];
  win.webContents.on("console-message", (_e, level, message) => { if (level >= 2) errors.push(message); });
  await win.webContents.session.clearStorageData();
  await win.loadFile(join(__dirname, "../dist/index.html"));
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

  // 开满 8 个窗格，验证激活标签滚入可视区。
  await key("KeyD", "d", { meta: true, shift: true }); await wait();
  await key("KeyT", "t", { meta: true, shift: true }); await wait();
  await key("KeyB", "b", { meta: true, shift: true }); await wait();
  await key("Backquote", "`", { ctrl: true }); await wait();
  await key("Semicolon", ";", { meta: true }); await wait();
  await key("KeyU", "u", { meta: true, shift: true }); await wait(800);
  state = await readState();
  check("8 个窗格全挂载，只有一个 active 且可见", state.mounted === 8 && state.activeCount === 1 && state.active === "plugins", state);
  const geometry = await js(`(() => {
    const scroller = document.querySelector('.pane-nav-items');
    const activeTab = document.querySelector('.pane-tab.on');
    if (!scroller || !activeTab) return null;
    const s = scroller.getBoundingClientRect();
    const a = activeTab.getBoundingClientRect();
    return { scrollLeft: Math.round(scroller.scrollLeft), scrollWidth: scroller.scrollWidth, clientWidth: scroller.clientWidth, tabLeft: Math.round(a.left), tabRight: Math.round(a.right), viewLeft: Math.round(s.left), viewRight: Math.round(s.right), label: activeTab.textContent.trim() };
  })()`);
  check("多标签溢出时激活标签自动滚进可视区", geometry !== null && geometry.scrollWidth > geometry.clientWidth && geometry.scrollLeft > 0 && geometry.tabLeft >= geometry.viewLeft - 1 && geometry.tabRight <= geometry.viewRight + 1, geometry);
  const img = await win.webContents.capturePage();
  writeFileSync(join(out, "01-eight-panes-active-visible.png"), img.toPNG());

  // 用关闭钮关掉 active 的插件窗格：内容真的移除，其余 7 块仍在。
  await js(`document.querySelector('[aria-label="关闭插件窗格"]').focus()`);
  await js(`document.querySelector('[aria-label="关闭插件窗格"]').click()`); await wait();
  state = await readState();
  check("关闭 active 窗格只移除那一块，其余状态保留", state.mounted === 7 && state.pluginsPresent === false && state.fileIdentity === "kept-file" && state.planIdentity === "kept-plan", state);

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
      };
    })()`);
  }
}

const watchdog = setTimeout(() => { console.error("pane-tabs-smoke: 超时"); app.exit(1); }, 45_000);
watchdog.unref();
main().catch((err) => { console.error(err); app.exit(1); });
