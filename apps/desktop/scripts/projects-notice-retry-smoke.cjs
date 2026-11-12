// 项目注册表 notice 的「就地重试」真实 renderer 冒烟（2026-10-30，第 792 页）。
// 缺陷形态：projects.json 坏了 ⇒ 侧栏只有一行「项目注册表不可用」；外部修好文件后没有退路，
// 只能重启应用。修法：notice 带「重试」，重读成功即清提示并列出项目。
// 夹具：listProjects 一直失败，探针调 __cairnRepairProjects() 表示「文件已修好」，再点重试。
// 运行：env -u ELECTRON_RUN_AS_NODE pnpm --filter cairn-desktop exec electron
//   scripts/projects-notice-retry-smoke.cjs [输出目录]   （前置：pnpm --filter cairn-desktop build）
const { app, BrowserWindow, nativeTheme } = require("electron");
const { scheduleProfileCleanup } = require("./lib/profile-cleanup.cjs");
const { mkdirSync, mkdtempSync, readFileSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");

const profile = mkdtempSync(join(tmpdir(), "cairn-projects-retry-profile-"));
app.setPath("userData", profile);
nativeTheme.themeSource = "light";
app.on("quit", () => scheduleProfileCleanup(profile));
const out = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), "cairn-projects-retry-"));
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
      additionalArguments: ["--cairn-api-members=" + JSON.stringify(members), "--cairn-protocol-version=" + version, "--cairn-project-error-repairable"],
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
    await pause(350);
    return true;
  };

  await win.loadFile(join(__dirname, "../dist/index.html"));
  await pause(1400);
  await waitFor(() => js(`!!document.querySelector('.side-notice')`), "registry notice");
  const notice = await js(`document.querySelector('.side-notice')?.innerText ?? ''`);
  check("坏档 ⇒ 侧栏 notice 点名文件与出路", notice.includes("项目注册表不可用") && notice.includes("projects.json") && notice.includes("修好或删除"), notice);
  check("notice 带「重试」按钮", await js(`[...document.querySelectorAll('.side-notice button')].some((b) => b.textContent.includes('重试'))`), null);

  // 模拟外部修好 projects.json，再点重试。
  await js(`window.__cairnRepairProjects()`);
  check("真指针点「重试」", await pointerOn(`[...document.querySelectorAll('.side-notice button')].find((b) => b.textContent.includes('重试'))`), null);
  await waitFor(() => js(`!document.querySelector('.side-notice')`), "notice cleared");
  check("重试成功 ⇒ notice 消失（不用重启）", true, null);
  await waitFor(() => js(`document.querySelector('.side')?.innerText.includes('demo-ws')`), "project listed");
  check("重试成功 ⇒ 项目真的列出来了", await js(`document.querySelector('.side')?.innerText.includes('demo-ws')`), null);
  writeFileSync(join(out, "01-after-retry.png"), (await win.webContents.capturePage()).toPNG());
  check("全程无渲染层控制台错误", errors.length === 0, errors);

  writeFileSync(join(out, "checks.json"), JSON.stringify({ fixtureData: true, checks, errors }, null, 2));
  const passed = checks.filter((c) => c.ok).length;
  console.log(`[projects-notice-retry-smoke] ${passed}/${checks.length} PASS\nEvidence: ${out}`);
  app.exit(passed === checks.length ? 0 : 1);
}
const watchdog = setTimeout(() => { console.error("projects-notice-retry-smoke: 超时"); app.exit(1); }, 60_000);
watchdog.unref();
main().catch((err) => { console.error(err); app.exit(2); });
