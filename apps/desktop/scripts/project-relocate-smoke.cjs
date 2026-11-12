// 项目「更改项目目录…」真实 renderer 冒烟（2026-10-30 · 第 801 页）。
// 形态：项目文件夹被移动/改名后，侧栏记录还指着旧路径；用户从项目菜单选新目录，
// 走 relocateProject 换同一条记录的 path（id / name / 会话归属不变），不用移除再添加。
// 夹具：--cairn-relocate-fixture 让 pickDirectory 返回 /tmp/demo-ws-moved，
// relocateProject 记录调用并让 listProjects 回新记录。
// 运行：env -u ELECTRON_RUN_AS_NODE pnpm --filter cairn-desktop exec electron
//   scripts/project-relocate-smoke.cjs [输出目录]   （前置：pnpm --filter cairn-desktop build）
const { app, BrowserWindow, nativeTheme } = require("electron");
const { scheduleProfileCleanup } = require("./lib/profile-cleanup.cjs");
const { mkdirSync, mkdtempSync, readFileSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");

const profile = mkdtempSync(join(tmpdir(), "cairn-project-relocate-profile-"));
app.setPath("userData", profile);
nativeTheme.themeSource = "light";
app.on("quit", () => scheduleProfileCleanup(profile));
const out = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), "cairn-project-relocate-"));
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
      additionalArguments: ["--cairn-api-members=" + JSON.stringify(members), "--cairn-protocol-version=" + version, "--cairn-relocate-fixture"],
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
  await waitFor(() => js(`!!document.querySelector('.g-more')`), "project menu button");
  check("项目行有「更多」菜单入口", await js(`!!document.querySelector('.g-more')`), null);
  // 第 802 页：目录不在场的项目在侧栏先标出来（不等点击后的错误）。
  check("侧栏标出「目录失联」", await js(`document.querySelector('.g-missing')?.textContent.trim() === '目录失联'`), await js(`document.querySelector('.g-missing')?.textContent ?? ''`));
  writeFileSync(join(out, "00-before-relocate.png"), (await win.webContents.capturePage()).toPNG());
  check("真指针点开项目菜单", await pointerOn(`document.querySelector('.g-more')`), null);
  await waitFor(() => js(`!!document.querySelector('.ctx-menu')`), "project context menu");
  const menuText = await js(`document.querySelector('.ctx-menu')?.innerText ?? ''`);
  check("菜单里有「更改项目目录…」", menuText.includes("更改项目目录"), menuText);
  check("真指针点「更改项目目录…」", await pointerOn(`[...document.querySelectorAll('.ctx-menu .menu-item')].find((b) => b.textContent.includes('更改项目目录'))`), null);

  await waitFor(async () => (await js(`window.__cairnProjectCalls()`)).some((c) => c.kind === "relocateProject"), "relocate call");
  const call = (await js(`window.__cairnProjectCalls()`)).find((c) => c.kind === "relocateProject");
  check("走 relocateProject，新目录取系统选择器返回值", call?.path === "/tmp/demo-ws-moved", call);
  await pause(400);
  const bodyText = await js(`document.body.innerText`);
  check("成功提示上屏（项目与会话不变，只换目录）", bodyText.includes("已指向新目录"), bodyText.slice(0, 120));
  writeFileSync(join(out, "01-after-relocate.png"), (await win.webContents.capturePage()).toPNG());
  check("全程无渲染层控制台错误", errors.length === 0, errors);

  writeFileSync(join(out, "checks.json"), JSON.stringify({ fixtureData: true, checks, errors, call }, null, 2));
  const passed = checks.filter((c) => c.ok).length;
  console.log(`[project-relocate-smoke] ${passed}/${checks.length} PASS\nEvidence: ${out}`);
  app.exit(passed === checks.length ? 0 : 1);
}
const watchdog = setTimeout(() => { console.error("project-relocate-smoke: 超时"); app.exit(1); }, 60_000);
watchdog.unref();
main().catch((err) => { console.error(err); app.exit(2); });
