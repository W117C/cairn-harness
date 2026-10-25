// 会话预览窗格（⌘+点击）真机冒烟（2026-10-25）：
//   两场会话 → 正常打开 s1 → ⌘+点击 s2 → 右侧「会话」标签只读预览 s2（主体仍 s1）→
//   点「切到会话」→ 主体切到 s2。只读预览不跑模型、不改事件日志。
const { app, BrowserWindow, nativeTheme } = require("electron");
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");

const profile = mkdtempSync(join(tmpdir(), "cairn-preview-profile-"));
app.setPath("userData", profile);
nativeTheme.themeSource = "light";
app.on("quit", () => { rmSync(profile, { recursive: true, force: true }); });
const out = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), "cairn-preview-"));
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
        "--cairn-session-preview-fixture",
      ],
    },
  });
  const errors = [];
  win.webContents.on("console-message", (_e, level, message) => { if (level >= 2) errors.push(message); });
  await win.loadFile(join(__dirname, "../dist/index.html"));
  await new Promise((r) => setTimeout(r, 1400));
  const js = (source) => win.webContents.executeJavaScript(source).catch((err) => { console.error("[js-failed]", source); throw err; });
  const read = (source) => js(`(() => { ${source} })()`);
  const wait = (ms = 400) => new Promise((r) => setTimeout(r, ms));
  const checks = [];
  const check = (name, ok, detail) => { checks.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(detail)}`); };
  const pointOf = (selector) => js(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: Math.round(r.left + r.width/2), y: Math.round(r.top+r.height/2) }; })()`);
  const pointer = async (selector, modifiers = []) => {
    const point = await pointOf(selector);
    win.webContents.sendInputEvent({ type: "mouseDown", ...point, button: "left", clickCount: 1, modifiers });
    win.webContents.sendInputEvent({ type: "mouseUp", ...point, button: "left", clickCount: 1, modifiers });
  };

  let state = await read(`return { s1: !!document.querySelector('[data-session-id="s1"]'), s2: !!document.querySelector('[data-session-id="s2"]') };`);
  check("两场会话在侧栏（预览夹具）", state.s1 && state.s2, state);
  await pointer('[data-session-id="s1"]'); await wait(800);
  check("先正常打开 s1", await read(`return document.querySelector('.session.active')?.dataset.sessionId === 's1';`));

  await pointer('[data-session-id="s2"]', ["meta"]); await wait(1100);
  state = await read(`return {
    main: document.querySelector('.session.active')?.dataset.sessionId ?? null,
    tab: document.querySelector('.pane-tab.on .pane-nav-item')?.textContent?.trim() ?? null,
    preview: !!document.querySelector('.session-preview'),
    title: document.querySelector('.svp-title')?.textContent ?? null,
    rows: document.querySelectorAll('.session-preview .stream .row').length,
    readonly: document.querySelector('.svp-readonly')?.textContent ?? null,
  };`);
  check("⌘+点击只开预览：主体仍 s1、预览标签激活、标题/只读徽标/正文在位", state.main === "s1" && state.tab === "会话预览" && state.preview && state.title === "整理竞品对照册" && state.rows > 0 && state.readonly === "只读", state);
  const img = await win.webContents.capturePage();
  writeFileSync(join(out, "01-session-preview.png"), img.toPNG());

  await pointer(".svp-switch"); await wait(1000);
  state = await read(`return {
    main: document.querySelector('.session.active')?.dataset.sessionId ?? null,
    title: document.querySelector('.tb-title')?.textContent ?? null,
    preview: !!document.querySelector('.session-preview'),
    sessionTab: !!document.querySelector('.pane-nav-item[aria-pressed="true"]') && [...document.querySelectorAll('.pane-nav-item')].some((b) => b.textContent.trim() === "会话预览"),
  };`);
  check("「切到会话」把主体切到 s2，并收起只读预览（不留同一场的副本）", state.main === "s2" && (state.title ?? "").includes("整理竞品对照册") && !state.preview && !state.sessionTab, state);
  await wait(200);
  const img2 = await win.webContents.capturePage();
  writeFileSync(join(out, "02-switched.png"), img2.toPNG());

  // 发现路径：行菜单里也要有「在侧栏预览」（只靠隐藏手势等于没接线）。
  await pointer('[data-session-id="s1"]'); await wait(800);
  await js(`(() => { const row = document.querySelector('[data-session-id="s2"]'); const r = row.getBoundingClientRect(); row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: Math.round(r.left + 40), clientY: Math.round(r.top + 12) })); })()`);
  await wait(500);
  const menuPoint = await js(`(() => { const hit = [...document.querySelectorAll(".pop-rd .menu-item")].find((el) => el.textContent.trim() === "在侧栏预览"); if (!hit) return null; const r = hit.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  check("行菜单里有「在侧栏预览」", menuPoint !== null, menuPoint);
  if (menuPoint !== null) {
    win.webContents.sendInputEvent({ type: "mouseDown", ...menuPoint, button: "left", clickCount: 1 });
    win.webContents.sendInputEvent({ type: "mouseUp", ...menuPoint, button: "left", clickCount: 1 });
    await wait(1100);
    state = await read(`return { main: document.querySelector('.session.active')?.dataset.sessionId ?? null, preview: !!document.querySelector('.session-preview'), title: document.querySelector('.svp-title')?.textContent ?? null };`);
    check("菜单预览同样不切走主体", state.main === "s1" && state.preview && state.title === "整理竞品对照册", state);
  }
  check("渲染过程无控制台错误", errors.length === 0, errors);

  writeFileSync(join(out, "checks.json"), JSON.stringify(checks, null, 2));
  console.log(`截图与读数：${out}\n隔离测试配置：${profile}`);
  app.exit(checks.every((c) => c.ok) ? 0 : 1);
}

const watchdog = setTimeout(() => { console.error("session-preview-smoke: 超时"); app.exit(1); }, 45_000);
watchdog.unref();
main().catch((err) => { console.error(err); app.exit(1); });
