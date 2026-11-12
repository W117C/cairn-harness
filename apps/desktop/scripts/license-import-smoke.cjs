// 许可证导入真实 renderer 冒烟（2026-10-30 · 第 805 页）。
// 判：设置「关于与更新」的「导入许可证…」真调 agent.importLicense()；
// 成功后许可证标签从「未读取」变「有效 · 测试客户」，回执上屏。
// 夹具：ui-gallery-preload 的 importLicense 固定返回 valid（验签逻辑在 core 判，不在本冒烟）。
// 运行：env -u ELECTRON_RUN_AS_NODE pnpm --filter cairn-desktop exec electron
//   scripts/license-import-smoke.cjs [输出目录]   （前置：pnpm --filter cairn-desktop build）
const { app, BrowserWindow, nativeTheme } = require("electron");
const { scheduleProfileCleanup } = require("./lib/profile-cleanup.cjs");
const { mkdirSync, mkdtempSync, readFileSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");

const profile = mkdtempSync(join(tmpdir(), "cairn-license-import-profile-"));
app.setPath("userData", profile);
nativeTheme.themeSource = "light";
app.on("quit", () => scheduleProfileCleanup(profile));
const out = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), "cairn-license-import-"));
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
      additionalArguments: ["--cairn-api-members=" + JSON.stringify(members), "--cairn-protocol-version=" + version],
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

  await win.loadFile(join(__dirname, "../dist/index.html"));
  await pause(1400);
  await win.webContents.focus();
  win.webContents.sendInputEvent({ type: "keyDown", keyCode: ",", modifiers: ["meta"] });
  win.webContents.sendInputEvent({ type: "keyUp", keyCode: ",", modifiers: ["meta"] });
  await waitFor(() => js(`!!document.querySelector('.sp-nav')`), "settings panel");
  check("真指针进「关于与更新」", await pointerOn(`[...document.querySelectorAll('.sp-nav-item')].find((el) => el.textContent.includes('关于与更新'))`), null);
  const before = await js(`document.querySelector('.sp-body')?.innerText ?? ''`);
  check("导入前许可证是显式未读取态", before.includes("未读取") && before.includes("导入许可证"), before.slice(0, 120));
  check("真指针点「导入许可证…」", await pointerOn(`[...document.querySelectorAll('.sp-body button')].find((b) => b.textContent.trim() === '导入许可证…')`), null);
  await waitFor(() => js(`document.querySelector('.sp-body')?.innerText.includes('有效 · 测试客户')`), "license tag updated");
  const after = await js(`document.querySelector('.sp-body')?.innerText ?? ''`);
  check("导入成功：标签即时变为「有效 · 测试客户」", after.includes("有效 · 测试客户"), after.slice(0, 160));
  check("导入回执上屏", after.includes("许可证已导入：测试客户"), null);
  writeFileSync(join(out, "01-after-license-import.png"), (await win.webContents.capturePage()).toPNG());
  check("全程无渲染层控制台错误", errors.length === 0, errors);

  writeFileSync(join(out, "checks.json"), JSON.stringify({ fixtureData: true, checks, errors }, null, 2));
  const passed = checks.filter((c) => c.ok).length;
  console.log(`[license-import-smoke] ${passed}/${checks.length} PASS\nEvidence: ${out}`);
  app.exit(passed === checks.length ? 0 : 1);
}
const watchdog = setTimeout(() => { console.error("license-import-smoke: 超时"); app.exit(1); }, 60_000);
watchdog.unref();
main().catch((err) => { console.error(err); app.exit(2); });
