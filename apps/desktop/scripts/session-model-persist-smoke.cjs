// 会话级模型/思考档持久化的真实 renderer 冒烟（2026-10-30，第 795 页）。
// 缺陷形态：会话模型/思考只活在内存；切走再回来/重启就回到全局缺省。
// 本冒烟判：① 列表回读灌进选择器（s1 存的是 deepseek-chat + 思考 high）；
//          ② 有会话时换模型只写 sessionPrefsSet，**不改全局设置**；③ 思考档变化同样落会话。
// 运行：env -u ELECTRON_RUN_AS_NODE pnpm --filter cairn-desktop exec electron
//   scripts/session-model-persist-smoke.cjs [输出目录]   （前置：pnpm --filter cairn-desktop build）
const { app, BrowserWindow, nativeTheme } = require("electron");
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");

const profile = mkdtempSync(join(tmpdir(), "cairn-session-prefs-profile-"));
app.setPath("userData", profile);
nativeTheme.themeSource = "light";
app.on("quit", () => { rmSync(profile, { recursive: true, force: true }); });
const out = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), "cairn-session-prefs-"));
mkdirSync(out, { recursive: true });

async function main() {
  await app.whenReady();
  const protocol = readFileSync(join(__dirname, "../../../src/main/ipc-protocol.ts"), "utf8");
  const version = Number(protocol.match(/IPC_PROTOCOL_VERSION\s*=\s*(\d+)/)[1]);
  const start = protocol.indexOf("export interface AgentApi");
  const body = protocol.slice(start, protocol.indexOf("\n}", start));
  const starts = [...body.matchAll(/^\s{2}(\w+)\??\s*[(<]/gm)];
  const members = starts.map((m, i) => ({ name: m[1], isArray: /Promise<[^>]*\[\]/.test(body.slice(m.index, starts[i + 1]?.index ?? body.length)) }));
  const win = new BrowserWindow({
    width: 1440, height: 900, show: false,
    webPreferences: {
      backgroundThrottling: false,
      preload: join(__dirname, "ui-gallery-preload.cjs"),
      additionalArguments: ["--cairn-api-members=" + JSON.stringify(members), "--cairn-protocol-version=" + version, "--cairn-session-prefs-fixture"],
    },
  });
  const errors = [];
  win.webContents.on("console-message", (d) => { if (d.level === "error") { errors.push(d.message); console.error("renderer:", d.message); } });
  const js = (s) => win.webContents.executeJavaScript(s);
  const pause = (ms = 250) => new Promise((r) => setTimeout(r, ms));
  const checks = [];
  const check = (name, ok, detail) => { checks.push({ name, ok: ok === true, detail }); console.log(`${ok === true ? "PASS" : "FAIL"} ${name} ${JSON.stringify(detail)}`); };
  async function waitFor(predicate, label, timeout = 15000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) { if (await predicate()) return true; await pause(80); }
    throw new Error("Timeout: " + label);
  }
  const pointerOn = async (findExpr) => {
    const point = await js(`(() => { const el = ${findExpr}; if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    if (point === null) return false;
    win.webContents.sendInputEvent({ type: "mouseDown", ...point, button: "left", clickCount: 1 });
    win.webContents.sendInputEvent({ type: "mouseUp", ...point, button: "left", clickCount: 1 });
    await pause(300);
    return true;
  };
  const trigger = () => js(`document.querySelector('.mp-trigger')?.innerText ?? ''`);
  const prefsCalls = () => js(`window.__cairnSessionPrefs()`);
  const modelSettingsWrites = () => js(`window.__cairnSettingsCalls().filter((p) => p.model !== undefined).length`);

  await win.loadFile(join(__dirname, "../dist/index.html"));
  await pause(1400);
  await waitFor(() => js(`!!document.querySelector('.session')`), "session list");
  check("真指针打开 s1", await pointerOn(`document.querySelector('.session')`), null);
  await waitFor(() => js(`!!document.querySelector('.mp-trigger')`), "composer");
  await waitFor(() => (trigger()).then ? true : true);
  await pause(400);
  const hydrated = await trigger();
  check("列表里的会话级模型/思考回读进选择器（不是全局 deepseek 缺省）", hydrated.includes("deepseek-chat") && hydrated.includes("思考 强"), hydrated);

  await pointerOn(`document.querySelector('.mp-trigger')`);
  await waitFor(() => js(`!!document.querySelector('.mp-pop')`), "model menu");
  await pointerOn(`[...document.querySelectorAll('.mp-pop [role="option"]')].find((el) => el.textContent.includes('glm-5.3-flash'))`);
  await waitFor(() => js(`window.__cairnSessionPrefs().length >= 1`), "model prefs call");
  const modelCall = (await prefsCalls()).at(-1);
  check("换模型 ⇒ sessionPrefsSet({sessionId:'s1', model:'glm-5.3-flash'})", modelCall?.sessionId === "s1" && modelCall?.prefs?.model === "glm-5.3-flash", modelCall);
  check("有会话时换模型**不**写全局设置（旧实现会悄悄改掉所有新会话的缺省）", (await modelSettingsWrites()) === 0, await js(`window.__cairnSettingsCalls()`));
  const after = await trigger();
  check("选择器显示新会话模型", after.includes("glm-5.3-flash"), after);

  // 思考档：选回 deepseek-chat（支持思考）→ 打开菜单点「中」
  await pointerOn(`document.querySelector('.mp-trigger')`);
  await waitFor(() => js(`!!document.querySelector('.mp-pop')`), "model menu 2");
  await pointerOn(`[...document.querySelectorAll('.mp-pop [role="option"]')].find((el) => el.textContent.includes('deepseek-chat'))`);
  await pause(300);
  await pointerOn(`document.querySelector('.mp-trigger')`);
  await waitFor(() => js(`!!document.querySelector('.th-row button[data-e="medium"]')`), "thinking rows");
  await pointerOn(`document.querySelector('.th-row button[data-e="medium"]')`);
  await waitFor(() => js(`window.__cairnSessionPrefs().some((c) => c.prefs?.thinking !== undefined)`), "thinking prefs call");
  const thinkingCall = (await prefsCalls()).filter((c) => c.prefs?.thinking !== undefined).at(-1);
  check("思考档变化 ⇒ sessionPrefsSet({thinking:'medium'})", thinkingCall?.sessionId === "s1" && thinkingCall?.prefs?.thinking === "medium", thinkingCall);
  writeFileSync(join(out, "01-session-prefs.png"), (await win.webContents.capturePage()).toPNG());
  check("全程无渲染层控制台错误", errors.length === 0, errors);

  writeFileSync(join(out, "checks.json"), JSON.stringify({ fixtureData: true, checks, errors, calls: await prefsCalls() }, null, 2));
  const passed = checks.filter((c) => c.ok).length;
  console.log(`[session-model-persist-smoke] ${passed}/${checks.length} PASS\nEvidence: ${out}`);
  app.exit(passed === checks.length ? 0 : 1);
}
const watchdog = setTimeout(() => { console.error("session-model-persist-smoke: 超时"); app.exit(1); }, 60_000);
watchdog.unref();
main().catch((err) => { console.error(err); app.exit(2); });
