// 可见会话上报的真实 renderer 冒烟（2026-10-30，第 788 页）。
// 缺陷形态：完成通知只判「窗口整体失焦」，聚焦着看 A 时 B 跑完不发——设计规范写的是
// 「你不在看那个会话」。主进程要判这件事，就必须知道窗口在看谁：本冒烟验 renderer 真的在报。
// 运行：env -u ELECTRON_RUN_AS_NODE pnpm --filter cairn-desktop exec electron
//   scripts/viewing-report-smoke.cjs [输出目录]   （前置：pnpm --filter cairn-desktop build）
const { app, BrowserWindow, nativeTheme } = require("electron");
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");

const profile = mkdtempSync(join(tmpdir(), "cairn-viewing-report-profile-"));
app.setPath("userData", profile);
nativeTheme.themeSource = "light";
app.on("quit", () => { rmSync(profile, { recursive: true, force: true }); });
const out = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), "cairn-viewing-report-"));
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
      additionalArguments: ["--cairn-api-members=" + JSON.stringify(members), "--cairn-protocol-version=" + version, "--cairn-agent-os-fixture"],
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
  const pointerOn = async (selector) => {
    const point = await js(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    if (point === null) return false;
    win.webContents.sendInputEvent({ type: "mouseDown", ...point, button: "left", clickCount: 1 });
    win.webContents.sendInputEvent({ type: "mouseUp", ...point, button: "left", clickCount: 1 });
    await pause(400);
    return true;
  };
  const lastViewing = () => js(`window.__cairnViewing().at(-1) ?? null`);

  await win.loadFile(join(__dirname, "../dist/index.html"));
  await pause(1400);
  await waitFor(() => js(`!!document.querySelector('.session')`), "session list");
  await waitFor(() => js(`window.__cairnViewing().length > 0`), "initial viewing report");
  const atHome = await lastViewing();
  check("主页上报 sessionId=null（不是把主页当成在看某个会话）", atHome !== null && atHome.sessionId === null, atHome);
  check("上报形状稳定：workspace 恒为字符串（首屏还没选项目时为空串）", atHome !== null && typeof atHome.workspace === "string", atHome);

  check("真指针打开会话 s1", await pointerOn(".session"), null);
  await waitFor(() => js(`window.__cairnViewing().at(-1)?.sessionId === 's1'`), "viewing s1 report");
  const viewingS1 = await lastViewing();
  check("打开会话后上报 {sessionId:'s1', workspace}", viewingS1.sessionId === "s1" && viewingS1.workspace === "/tmp/demo-ws", viewingS1);

  win.webContents.sendInputEvent({ type: "keyDown", keyCode: "W", modifiers: ["meta"] });
  win.webContents.sendInputEvent({ type: "keyUp", keyCode: "W", modifiers: ["meta"] });
  await waitFor(() => js(`window.__cairnViewing().at(-1)?.sessionId === null`), "viewing null after home");
  const backHome = await lastViewing();
  check("回主页后上报 null（主进程据此恢复「不在看」）", backHome.sessionId === null, backHome);
  check("回主页后工作区仍在上报里（判据按同 workspace 比对）", backHome.workspace === "/tmp/demo-ws", backHome);
  writeFileSync(join(out, "01-viewing-home.png"), (await win.webContents.capturePage()).toPNG());
  check("全程无渲染层控制台错误", errors.length === 0, errors);

  writeFileSync(join(out, "checks.json"), JSON.stringify({ fixtureData: true, checks, errors }, null, 2));
  const passed = checks.filter((c) => c.ok).length;
  console.log(`[viewing-report-smoke] ${passed}/${checks.length} PASS\nEvidence: ${out}`);
  app.exit(passed === checks.length ? 0 : 1);
}
const watchdog = setTimeout(() => { console.error("viewing-report-smoke: 超时"); app.exit(1); }, 60_000);
watchdog.unref();
main().catch((err) => { console.error(err); app.exit(2); });
