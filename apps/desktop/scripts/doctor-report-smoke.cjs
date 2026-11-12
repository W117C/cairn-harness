// 桌面「运行诊断」真实 renderer 冒烟（2026-10-30，第 793 页）。
// 判：About 里的按钮真的走 agent.doctor()；结果上屏九项；凭据一行按桌面口径合成
// （环境变量 + 设置页已存），不与 CLI 的「全未设」原句打架；总档按上屏行计数。
// 运行：env -u ELECTRON_RUN_AS_NODE pnpm --filter cairn-desktop exec electron
//   scripts/doctor-report-smoke.cjs [输出目录]   （前置：pnpm --filter cairn-desktop build）
const { app, BrowserWindow, nativeTheme, clipboard } = require("electron");
const { scheduleProfileCleanup } = require("./lib/profile-cleanup.cjs");
const { mkdirSync, mkdtempSync, readFileSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");

const profile = mkdtempSync(join(tmpdir(), "cairn-doctor-report-profile-"));
app.setPath("userData", profile);
nativeTheme.themeSource = "light";
app.on("quit", () => scheduleProfileCleanup(profile));
const out = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), "cairn-doctor-report-"));
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
  const pre = await js(`document.querySelector('.sp-body')?.innerText ?? ''`);
  check("诊断结果点击前不出现（不在打开面板时偷偷跑）", !pre.includes("总档："), null);
  check("真指针点「运行诊断」", await pointerOn(`[...document.querySelectorAll('.sp-body button')].find((b) => b.textContent.trim() === '运行诊断')`), null);
  await waitFor(() => js(`!!document.querySelector('.ss-doctor')`), "doctor results");

  const report = await js(`(() => {
    const box = document.querySelector('.ss-doctor');
    const rows = [...box.querySelectorAll('.ss-doctor-row')].map((row) => ({
      label: row.querySelector('.ss-doctor-label')?.textContent ?? '',
      ok: row.classList.contains('ok'),
      detail: row.querySelector('.ss-doctor-detail')?.textContent ?? '',
    }));
    return { verdict: box.querySelector('.ss-doctor-verdict')?.textContent ?? '', rows };
  })()`);
  check("九项检查全部上屏", report.rows.length === 9, report.rows.map((r) => r.label));
  check("凭据行按桌面口径合成（环境变量 + 设置页已存）", (() => {
    const row = report.rows.find((r) => r.label === "凭据");
    return row !== undefined && row.ok && row.detail.includes("环境变量在位：glm") && row.detail.includes("设置页已存 2 家");
  })(), report.rows.find((r) => r.label === "凭据"));
  check("联网搜索失败项在屏上（✗ + 原因）", (() => {
    const row = report.rows.find((r) => r.label === "联网搜索");
    return row !== undefined && !row.ok && row.detail.includes("search.endpoint 未配");
  })(), report.rows.find((r) => r.label === "联网搜索"));
  check("总档按上屏行计数（1 项要处理，不是 CLI 原行的 2 项）", report.verdict === "总档：部分就绪（1 项要处理）", report.verdict);
  // 第 803 页：诊断结果要能一键带走（剪贴板里是完整文本，不是截图）。
  check("真指针点「复制报告」", await pointerOn(`[...document.querySelectorAll('.sp-body button')].find((b) => b.textContent.trim() === '复制报告')`), null);
  await pause(300);
  const clip = await clipboard.readText();
  check("剪贴板里是完整诊断报告（版本/总档/失败项）", clip.includes("Cairn 诊断报告") && clip.includes("总档：部分就绪") && clip.includes("联网搜索"), clip.slice(0, 80));
  check("复制回执上屏", await js(`document.querySelector('.sp-body')?.innerText.includes('已复制诊断报告')`), null);
  // 第 807 页：诊断包 = 报告 + 主进程日志尾部，落成一个 Markdown 文件（画廊只验点击与回执）。
  check("真指针点「导出诊断包…」", await pointerOn(`[...document.querySelectorAll('.sp-body button')].find((b) => b.textContent.trim() === '导出诊断包…')`), null);
  await waitFor(() => js(`document.querySelector('.sp-body')?.innerText.includes('已保存：/tmp/cairn-diagnostics.md')`), "export receipt");
  check("导出回执带保存路径", await js(`document.querySelector('.sp-body')?.innerText.includes('已保存：/tmp/cairn-diagnostics.md')`), null);
  writeFileSync(join(out, "01-doctor-report.png"), (await win.webContents.capturePage()).toPNG());

  // v37：失败项不再只是一行红字——点「联网搜索」这行要跳到能修它的设置分区。
  const navBefore = await js(`document.querySelector('.sp-nav-item.on')?.textContent ?? ''`);
  check("诊断结果出现在「关于与更新」分区", navBefore.includes("关于与更新"), navBefore);
  check("真指针点失败的「联网搜索」行", await pointerOn(`document.querySelector('[data-doctor-id="search"]')`), null);
  await waitFor(async () => (await js(`document.querySelector('.sp-nav-item.on')?.textContent ?? ''`)).includes("联网搜索"), "network section");
  const navAfter = await js(`document.querySelector('.sp-nav-item.on')?.textContent ?? ''`);
  check("点后切到「联网搜索」分区", navAfter.includes("联网搜索"), navAfter);
  const bodyAfter = await js(`document.querySelector('.sp-body')?.innerText ?? ''`);
  // 2026-11-07 脚本漂移订正：原断言找「搜索服务」——那是旧版 API Key 行描述
  // 「从搜索服务获取密钥…」的残影（该描述已在设置改版中移除，HEAD 无 keyDescription）。
  // 改钉首行行标签「启用联网搜索」：它是该分区恒渲染的稳定短语，语义（跳到的是搜索设置正文）不变。
  check("分区正文是搜索设置（不是空白）", bodyAfter.includes("启用联网搜索"), bodyAfter.slice(0, 80));
  writeFileSync(join(out, "02-after-doctor-jump.png"), (await win.webContents.capturePage()).toPNG());
  check("全程无渲染层控制台错误", errors.length === 0, errors);

  writeFileSync(join(out, "checks.json"), JSON.stringify({ fixtureData: true, checks, errors, report }, null, 2));
  const passed = checks.filter((c) => c.ok).length;
  console.log(`[doctor-report-smoke] ${passed}/${checks.length} PASS\nEvidence: ${out}`);
  app.exit(passed === checks.length ? 0 : 1);
}
const watchdog = setTimeout(() => { console.error("doctor-report-smoke: 超时"); app.exit(1); }, 60_000);
watchdog.unref();
main().catch((err) => { console.error(err); app.exit(2); });
