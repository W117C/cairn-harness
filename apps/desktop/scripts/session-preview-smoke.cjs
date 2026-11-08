// 会话预览窗格（⌘+点击）真机冒烟（2026-10-25）：
//   两场会话 → 正常打开 s1 → ⌘+点击 s2 → 右侧「会话」标签预览 s2（可继续发送，主体仍 s1）→
//   点「切到会话」→ 主体切到 s2。预览冒烟不跑真实模型、不改产品用户数据。
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
  const key = async (keyCode, modifiers = []) => {
    win.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
    await wait(160);
  };
  const setTextarea = (selector, value) => js(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);

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
    badge: document.querySelector('.svp-badge')?.textContent ?? null,
  };`);
  check("⌘+点击只开预览：主体仍 s1、预览标签激活、标题/预览徽标/正文在位", state.main === "s1" && state.tab === "会话预览" && state.preview && state.title === "整理竞品对照册" && state.rows > 0 && state.badge === "不切主会话", state);
  const img = await win.webContents.capturePage();
  writeFileSync(join(out, "01-session-preview.png"), img.toPNG());

  // 窄窗（2026-10-27）：右栏会被自动收起（744 门，保正文），不横向溢出；
  // 恢复宽度后若仍收起，⌘⌥I 必须能把预览拉回来——预览目标不能因一次缩放丢失。
  win.setContentSize(880, 860); await wait(800);
  const narrow = await read(`return {
    viewport: innerWidth,
    overflow: document.documentElement.scrollWidth > innerWidth,
    main: Math.round(document.querySelector('.main')?.getBoundingClientRect().width ?? 0),
    pane: Math.round(document.querySelector('.pane-panel')?.getBoundingClientRect().width ?? 0),
    preview: Math.round(document.querySelector('.session-preview')?.getBoundingClientRect().width ?? 0),
  };`);
  check("880 窄窗打开预览不横向溢出", narrow.viewport === 880 && !narrow.overflow && narrow.main > 0, narrow);
  win.setContentSize(1440, 900); await wait(800);
  let restored = await read(`return {
    pane: Math.round(document.querySelector('.pane-panel')?.getBoundingClientRect().width ?? 0),
    preview: Math.round(document.querySelector('.session-preview')?.getBoundingClientRect().width ?? 0),
    input: Math.round(document.querySelector('.svp-input')?.getBoundingClientRect().width ?? 0),
  };`);
  if (restored.pane <= 0) { await key("I", ["meta", "alt"]); await wait(900); }
  restored = await read(`return {
    pane: Math.round(document.querySelector('.pane-panel')?.getBoundingClientRect().width ?? 0),
    preview: Math.round(document.querySelector('.session-preview')?.getBoundingClientRect().width ?? 0),
    input: Math.round(document.querySelector('.svp-input')?.getBoundingClientRect().width ?? 0),
  };`);
  check("变宽或 ⌘⌥I 后预览可恢复", restored.pane > 0 && restored.preview > 0 && restored.input > 0, restored);

  // 预览可继续（2026-10-27）：空闲发送 / 运行中插话 / 插话被拒入队 / 停止。
  const composer = await read(`return {
    input: !!document.querySelector('.session-preview .svp-input'),
    send: !!document.querySelector('.svp-send'),
    sendDisabled: document.querySelector('.svp-send')?.disabled === true,
  };`);
  check("预览窗格有输入框与发送钮", composer.input && composer.send && composer.sendDisabled, composer);
  await js(`document.querySelector('.svp-input').focus()`);
  await setTextarea(".svp-input", "预览里继续");
  await key("Return");
  await wait(700);
  let sent = await read(`return {
    runs: window.__cairnRuns(),
    draft: document.querySelector('.svp-input')?.value ?? null,
    notice: document.querySelector('.svp-composer-note')?.textContent ?? null,
  };`);
  check("空闲时 Enter 真的向预览会话发一轮", sent.runs.at(-1)?.sessionId === "s2" && sent.runs.at(-1)?.message === "预览里继续" && sent.draft === "" && sent.notice === "已发送", sent);
  const mainAfterSend = await read(`return document.querySelector('.session.active')?.dataset.sessionId ?? null;`);
  check("预览发送后主体仍停在原会话", mainAfterSend === "s1", { main: mainAfterSend });

  await js(`window.__cairnPushEvent({ type: "assistant_delta", session_id: "s2", text: "运行中" })`);
  await wait(300);
  const live = await read(`return { live: !!document.querySelector('.svp-live'), stop: !!document.querySelector('.svp-stop') };`);
  check("运行中显示运行标记与停止钮", live.live && live.stop, live);
  await js(`document.querySelector('.svp-input').focus()`);
  await setTextarea(".svp-input", "插一句话");
  await key("Return");
  await wait(700);
  const steered = await read(`return {
    steers: window.__cairnSteers(),
    notice: document.querySelector('.svp-composer-note')?.textContent ?? null,
    draft: document.querySelector('.svp-input')?.value ?? null,
  };`);
  check("运行中 Enter 走 runSteer 并回报已插话", steered.steers.some((s) => s.sessionId === "s2" && s.text === "插一句话") && steered.notice === "已插话到本轮" && steered.draft === "", steered);

  await js(`window.__cairnSetSteerReject(true)`);
  await js(`document.querySelector('.svp-input').focus()`);
  await setTextarea(".svp-input", "排队这句");
  await key("Return");
  await wait(700);
  const queued = await read(`return {
    notice: document.querySelector('.svp-composer-note')?.textContent ?? null,
    disabled: document.querySelector('.svp-input')?.disabled === true,
  };`);
  check("插话被拒绝时入队并给出回执", queued.notice === "已加入队列，本轮结束后发送" && !queued.disabled, queued);
  await js(`window.__cairnPushEvent({ type: "agent_status", status: "done", session_id: "s2" })`);
  await wait(400);
  const pending = await read(`return { running: !!document.querySelector('.svp-live'), resume: !!document.querySelector('.svp-resume') };`);
  check("本轮结束后待发送队列可见", !pending.running && pending.resume, pending);
  if (pending.resume) { await pointer(".svp-resume"); await wait(700); }
  const drained = await read(`return {
    runs: window.__cairnRuns(),
    resume: !!document.querySelector('.svp-resume'),
    notice: document.querySelector('.svp-composer-note')?.textContent ?? null,
  };`);
  check("继续发送把队首交给同一会话", drained.runs.at(-1)?.sessionId === "s2" && drained.runs.at(-1)?.message === "排队这句" && !drained.resume, drained);

  await js(`window.__cairnSetSteerReject(false)`);
  await js(`window.__cairnPushEvent({ type: "assistant_delta", session_id: "s2", text: "又在跑" })`);
  await wait(300);
  await pointer(".svp-stop");
  await wait(400);
  const stopped = await read(`return {
    cancels: window.__cairnCancels(),
    notice: document.querySelector('.svp-composer-note')?.textContent ?? null,
  };`);
  check("停止钮打到预览会话", stopped.cancels.some((c) => c.sessionId === "s2") && stopped.notice === "已请求停止", stopped);

  await pointer(".svp-switch"); await wait(1000);
  state = await read(`return {
    main: document.querySelector('.session.active')?.dataset.sessionId ?? null,
    title: document.querySelector('.tb-title')?.textContent ?? null,
    preview: !!document.querySelector('.session-preview'),
    sessionTab: !!document.querySelector('.pane-nav-item[aria-pressed="true"]') && [...document.querySelectorAll('.pane-nav-item')].some((b) => b.textContent.trim() === "会话预览"),
  };`);
  check("「切到会话」把主体切到 s2，并收起预览（不留同一场的副本）", state.main === "s2" && (state.title ?? "").includes("整理竞品对照册") && !state.preview && !state.sessionTab, state);
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
  await pointer('[data-session-id="s2"]'); await wait(900);
  const adopted = await read(`return {
    main: document.querySelector('.session.active')?.dataset.sessionId ?? null,
    preview: !!document.querySelector('.session-preview'),
    sessionTab: [...document.querySelectorAll('.pane-nav-item')].some((b) => b.textContent.trim() === "会话预览"),
  };`);
  check("侧栏直接打开预览目标时预览自动收起", adopted.main === "s2" && !adopted.preview && !adopted.sessionTab, adopted);
  check("渲染过程无控制台错误", errors.length === 0, errors);

  writeFileSync(join(out, "checks.json"), JSON.stringify(checks, null, 2));
  console.log(`截图与读数：${out}\n隔离测试配置：${profile}`);
  app.exit(checks.every((c) => c.ok) ? 0 : 1);
}

const watchdog = setTimeout(() => { console.error("session-preview-smoke: 超时"); app.exit(1); }, 45_000);
watchdog.unref();
main().catch((err) => { console.error(err); app.exit(1); });
