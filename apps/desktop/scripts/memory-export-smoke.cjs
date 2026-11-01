// 记忆导出真 renderer 冒烟（2026-10-30 · 第 824 页）：
// 记忆页 -> 点「导出记忆…」-> 主进程 stub 返回路径 -> 页面出回执；确保按钮不是死 chip。
const { app, BrowserWindow, nativeTheme } = require("electron");
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");
const profile = mkdtempSync(join(tmpdir(), "cairn-memory-export-"));
app.setPath("userData", profile);
nativeTheme.themeSource = "light";
app.on("quit", () => rmSync(profile, { recursive: true, force: true }));
const out = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), "cairn-memory-export-smoke-"));
mkdirSync(out, { recursive: true });

async function main() {
  await app.whenReady();
  const protocol = readFileSync(join(__dirname, "../../../src/main/ipc-protocol.ts"), "utf8");
  const version = Number(protocol.match(/IPC_PROTOCOL_VERSION\s*=\s*(\d+)/)[1]);
  const start = protocol.indexOf("export interface AgentApi");
  const body = protocol.slice(start, protocol.indexOf("\n}", start));
  const starts = [...body.matchAll(/^\s{2}(\w+)\??\s*[(<]/gm)];
  const members = starts.map((m, i) => ({ name: m[1], isArray: /Promise<[^>]*\[\]/.test(body.slice(m.index, starts[i + 1]?.index ?? body.length)) }));
  const win = new BrowserWindow({ width: 1440, height: 900, show: false, webPreferences: {
    backgroundThrottling: false, preload: join(__dirname, "ui-gallery-preload.cjs"),
    additionalArguments: ["--cairn-api-members=" + JSON.stringify(members), "--cairn-protocol-version=" + version, "--cairn-agent-os-fixture"],
  } });
  const errors = [];
  win.webContents.on("console-message", (d) => { if (d.level === "error") { errors.push(d.message); console.error("renderer:", d.message); } });
  const js = (s) => win.webContents.executeJavaScript(s);
  const pause = (ms = 250) => new Promise((r) => setTimeout(r, ms));
  const checks = [];
  const check = (name, ok, detail) => { checks.push({ name, ok: ok === true, detail }); console.log(`${ok === true ? "PASS" : "FAIL"} ${name} ${JSON.stringify(detail)}`); };
  const pointerOn = async (expr) => {
    const point = await js(`(() => { const el = ${expr}; if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    if (point === null) return false;
    win.webContents.sendInputEvent({ type: "mouseDown", ...point, button: "left", clickCount: 1 });
    win.webContents.sendInputEvent({ type: "mouseUp", ...point, button: "left", clickCount: 1 });
    await pause(300);
    return true;
  };
  await win.loadFile(join(__dirname, "../dist/index.html"));
  await pause(1200);
  await win.webContents.focus();
  check("真指针点记忆目的地", await pointerOn(`document.querySelector('[data-destination="memory"]')`), null);
  await pause(600);
  const title = await js(`document.querySelector('.page-title')?.textContent ?? document.body.innerText.slice(0, 120)`);
  check("记忆页已打开", String(title).includes("记忆"), title);
  await win.setContentSize(880, 760); await pause(400);
  const narrow = await js(`(() => { const bar = document.querySelector('.ap-toolbar'); return { viewport: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth, barOverflow: bar ? bar.scrollWidth > bar.clientWidth : null, visible: [...document.querySelectorAll('.ap-toolbar button')].filter((b) => b.getBoundingClientRect().width > 0).length }; })()`);
  check("880 记忆工具栏可见且无横向溢出", narrow.overflow === false && narrow.barOverflow === false && narrow.visible === 2, narrow);
  const btn = await js(`!![...document.querySelectorAll('.ap-toolbar button')].find((b) => b.textContent.includes('导出记忆'))`);
  check("记忆页有「导出记忆…」按钮", btn === true, null);
  check("真指针点导出", await pointerOn(`[...document.querySelectorAll('.ap-toolbar button')].find((b) => b.textContent.includes('导出记忆'))`), null);
  await pause(500);
  const notice = await js(`document.querySelector('.ap-actions-row')?.innerText ?? ''`);
  check("导出回执上屏（含路径）", notice.includes("已导出") && notice.includes("cairn-memory.md"), notice);
  writeFileSync(join(out, "01-memory-export.png"), (await win.webContents.capturePage()).toPNG());
  check("全程无渲染层控制台错误", errors.length === 0, errors);
  writeFileSync(join(out, "checks.json"), JSON.stringify({ fixtureData: true, checks, errors }, null, 2));
  const passed = checks.filter((c) => c.ok).length;
  console.log(`[memory-export-smoke] ${passed}/${checks.length} PASS\nEvidence: ${out}`);
  app.exit(passed === checks.length ? 0 : 1);
}
const watchdog = setTimeout(() => { console.error("memory-export-smoke: 超时"); app.exit(1); }, 60_000);
watchdog.unref();
main().catch((err) => { console.error(err); app.exit(2); });
