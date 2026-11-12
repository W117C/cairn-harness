// 启动检查更新的真实 renderer 冒烟（2026-10-30 · 第 810 页）。
// 判：有更新源时启动会调 checkUpdate；发现新版本后 notice 上屏；不弹错误、不自动下载。
const { app, BrowserWindow, nativeTheme } = require("electron");
const { scheduleProfileCleanup } = require("./lib/profile-cleanup.cjs");
const { mkdirSync, mkdtempSync, readFileSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");

const profile = mkdtempSync(join(tmpdir(), "cairn-update-profile-"));
app.setPath("userData", profile);
nativeTheme.themeSource = "light";
app.on("quit", () => scheduleProfileCleanup(profile));
const out = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), "cairn-update-smoke-"));
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
      additionalArguments: [
        "--cairn-api-members=" + JSON.stringify(members),
        "--cairn-protocol-version=" + version,
        "--cairn-update-fixture",
      ],
    },
  });
  const errors = [];
  win.webContents.on("console-message", (d) => { if (d.level === "error") { errors.push(d.message); console.error("renderer:", d.message); } });
  const js = (s) => win.webContents.executeJavaScript(s);
  const pause = (ms = 200) => new Promise((r) => setTimeout(r, ms));
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

  await win.loadFile(join(__dirname, "../dist/index.html"));
  await waitFor(() => js(`(document.querySelector('.notice-strip .msg')?.textContent ?? '').includes('发现新版本 0.2.0')`), "update notice");
  const text = await js(`document.querySelector('.notice-strip .msg')?.textContent ?? ''`);
  check("有更新源时启动检查并上屏新版本", text.includes("发现新版本 0.2.0"), text);
  check("提醒指向设置里的关于与更新", text.includes("设置 → 关于与更新"), text);
  check("只有一条 notice，不重复", await js(`document.querySelectorAll('.notice-strip').length === 1`), await js(`document.querySelectorAll('.notice-strip').length`));
  const calls = await js(`window.agent.getSettings().then(() => true)`);
  check("设置读取成功（没有把未配置源当错误）", calls === true, calls);
  // 第 811 页：notice 会随会话走，头像上的点不随会话走——点开菜单能到「关于与更新」。
  // 落位按 2026-11-03 裁决改钉：侧栏页脚已删，头像入口在全局轨底部（`.app-rail-user`），
  // 旧选择器 `.side-foot .avatar` 永远取不到 ⇒ 红点与菜单两格恒红（第 1059 页实测 4 PASS / 2 FAIL）。
  check("头像按钮带更新红点", await js(`document.querySelector('.app-rail-user button.avatar')?.getAttribute('data-update') === 'true'`), null);
  const avatarClicked = await pointerOn(`document.querySelector('.app-rail-user button.avatar')`);
  await waitFor(() => js(`document.body.innerText.includes('发现新版本 0.2.0')`), "update menu item");
  check("头像菜单里有「发现新版本 0.2.0」", avatarClicked === true && await js(`[...document.querySelectorAll('[role="menuitem"]')].some((el) => el.textContent.includes('发现新版本 0.2.0'))`), null);
  const clicked = await js(`(() => { const item = [...document.querySelectorAll('[role="menuitem"]')].find((el) => el.textContent.includes('发现新版本 0.2.0')); if (!item) return false; item.click(); return true; })()`);
  await pause(400);
  await waitFor(() => js(`!!document.querySelector('.sp-nav') && document.body.innerText.includes('关于与更新')`), "settings about");
  check("点菜单项打开设置「关于与更新」", clicked === true, null);
  writeFileSync(join(out, "02-update-menu.png"), (await win.webContents.capturePage()).toPNG());
  check("全程无渲染层控制台错误", errors.length === 0, errors);

  writeFileSync(join(out, "checks.json"), JSON.stringify({ fixtureData: true, checks, errors }, null, 2));
  const passed = checks.filter((c) => c.ok).length;
  console.log(`[update-notice-smoke] ${passed}/${checks.length} PASS\nEvidence: ${out}`);
  app.exit(passed === checks.length ? 0 : 1);
}
const watchdog = setTimeout(() => { console.error("update-notice-smoke: 超时"); app.exit(1); }, 60_000);
watchdog.unref();
main().catch((err) => { console.error(err); app.exit(2); });
