// 用量 CSV 真 renderer 冒烟（2026-10-30 · 第 825 页）：
// 设置 -> 用量统计 -> 点「复制 CSV」-> 主进程剪贴板读回表头与合计行。
const { app, BrowserWindow, clipboard, nativeTheme } = require("electron");
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");
const profile = mkdtempSync(join(tmpdir(), "cairn-usage-export-"));
app.setPath("userData", profile);
nativeTheme.themeSource = "light";
app.on("quit", () => rmSync(profile, { recursive: true, force: true }));
const out = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), "cairn-usage-export-smoke-"));
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
    additionalArguments: ["--cairn-api-members=" + JSON.stringify(members), "--cairn-protocol-version=" + version],
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
  win.webContents.sendInputEvent({ type: "keyDown", keyCode: ",", modifiers: ["meta"] });
  win.webContents.sendInputEvent({ type: "keyUp", keyCode: ",", modifiers: ["meta"] });
  await pause(600);
  check("设置页已打开", await js(`!!document.querySelector('.sp-nav')`), null);
  check("真指针点用量统计", await pointerOn(`[...document.querySelectorAll('.sp-nav-item')].find((el) => el.textContent.includes('用量统计'))`), null);
  await pause(800);
  check("用量页读到账本", await js(`document.querySelector('.ud-overview') !== null`), null);
  // 第 826 页：两个头部按钮在 880 支持宽度不许把页撑出横向滚动。
  await win.setContentSize(880, 760); await pause(400);
  const narrow = await js(`(() => { const header = document.querySelector('.ud-header'); return { viewport: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth, headerOverflow: header ? header.scrollWidth > header.clientWidth : null, buttons: [...document.querySelectorAll('.ud-header button')].filter((b) => b.getBoundingClientRect().width > 0).length }; })()`);
  check("880 用量头部可见且无横向溢出", narrow.overflow === false && narrow.headerOverflow === false && narrow.buttons === 2, narrow);
  const btn = await js(`!![...document.querySelectorAll('.ud-header button')].find((b) => b.textContent.includes('复制 CSV'))`);
  check("用量页有「复制 CSV」按钮", btn === true, null);
  check("真指针点复制 CSV", await pointerOn(`[...document.querySelectorAll('.ud-header button')].find((b) => b.textContent.includes('复制 CSV'))`), null);
  await pause(500);
  const csv = String((await clipboard.readText()) ?? "");
  check("剪贴板拿到 CSV 表头与合计", csv.includes("日期,输入Token,输出Token") && csv.includes("合计,"), csv.slice(0, 120));
  writeFileSync(join(out, "01-usage-csv.png"), (await win.webContents.capturePage()).toPNG());
  check("全程无渲染层控制台错误", errors.length === 0, errors);
  writeFileSync(join(out, "checks.json"), JSON.stringify({ fixtureData: true, checks, errors }, null, 2));
  const passed = checks.filter((c) => c.ok).length;
  console.log(`[usage-export-smoke] ${passed}/${checks.length} PASS\nEvidence: ${out}`);
  app.exit(passed === checks.length ? 0 : 1);
}
const watchdog = setTimeout(() => { console.error("usage-export-smoke: 超时"); app.exit(1); }, 60_000);
watchdog.unref();
main().catch((err) => { console.error(err); app.exit(2); });
