// 终端尺寸同步 · 渲染段真机证据（2026-10-22）。
//
// 为什么要有这个脚本：路线表第 4 行写「`terminal-host.ts` 仍明确留有 resize 通道，
// 先用 stty/实际列宽复现尺寸问题，再贯通前后端」。主进程 → PTY 那一段已经由
// `tests/terminal-size.test.ts` 用 `stty size` 量过（24 80 → 30 100 逐档可复现）；
// **渲染段**（xterm 网格变化 ⇒ 调 terminalResize 把行列发给主进程）此前没有任何判卷。
// 本仓无 jsdom（渲染面的既定仪器是 SSR + 源文哨兵，行为面靠真机 CDP）⇒ 这里走真 Electron：
// 真 renderer + 真 xterm + 合成 AgentApi（终端相关通道被夹具记账），只改窗口宽度/高度，
// 断言「容器变了 ⇒ 发给主进程的行列也变了，且方向一致」。
//
// 不跑模型、不碰产品用户数据（隔离 userData profile，退出即删）。
// 用法：先 pnpm --filter cairn-desktop build，再
//   pnpm --filter cairn-desktop exec electron scripts/terminal-resize-smoke.cjs [输出目录]
const { app, BrowserWindow, nativeTheme } = require("electron");
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");

const profile = mkdtempSync(join(tmpdir(), "cairn-terminal-resize-profile-"));
app.setPath("userData", profile);
nativeTheme.themeSource = "light";
app.on("quit", () => { rmSync(profile, { recursive: true, force: true }); });
const out = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), "cairn-terminal-resize-"));
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
        "--cairn-terminal-fixture",
      ],
    },
  });
  const errors = [];
  win.webContents.on("console-message", (details) => { if (details.level === "error") { errors.push(details.message); console.error("renderer:", details.message); } });
  const js = (source) => win.webContents.executeJavaScript(source).catch((err) => { console.error("操作失败:", source); throw err; });
  const pause = (ms = 400) => new Promise((r) => setTimeout(r, ms));
  const shot = async (name) => { await pause(); writeFileSync(join(out, name + ".png"), (await win.webContents.capturePage()).toPNG()); };
  const checks = [];
  const check = (name, ok, detail) => { checks.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(detail)}`); };
  const read = (source) => js(`(() => { ${source} })()`);
  const resizeCalls = () => read(`return (window.__cairnTerminal?.calls() ?? { resize: [] }).resize;`);

  await win.loadFile(join(__dirname, "../dist/index.html"));
  await pause(800);

  // 打开终端窗格：快捷栏「添加面板」→「终端」。
  const addBtn = await read(`return !!document.querySelector('[aria-label="添加面板"]');`);
  if (!addBtn) { check("渲染面就绪（存在「添加面板」入口）", false, { addBtn }); app.exit(1); return; }
  await js(`document.querySelector('[aria-label="添加面板"]').click()`);
  await pause();
  await js(`[...document.querySelectorAll('[role="menuitem"]')].find(el => el.textContent.trim() === '终端').click()`);
  await pause(1200);

  const paneState = await read(`const p = document.querySelector('[data-pane="terminal"]'); const h = document.querySelector('.term-host'); return { pane: !!p, host: !!h, w: h?.getBoundingClientRect().width ?? 0, h: h?.getBoundingClientRect().height ?? 0, xterm: !!document.querySelector('.term-host .xterm') };`);
  check("终端窗格与 xterm 都真的挂上了", paneState.pane && paneState.host && paneState.xterm && paneState.w > 50, paneState);

  const first = await resizeCalls();
  check("渲染层启动后就把行列发给了主进程（不是等用户拖窗格才发）", first.length > 0 && first[0].cols > 0 && first[0].rows > 0, { calls: first });

  const before = first.length > 0 ? first[first.length - 1] : null;
  const hostBefore = await read(`const h = document.querySelector('.term-host'); const r = h.getBoundingClientRect(); return { w: r.width, h: r.height };`);

  // 变宽：窗口变窄 ⇒ 终端容器变窄 ⇒ 行列应变少。
  await win.setContentSize(760, 900);
  await pause(1200);
  const narrow = await resizeCalls();
  const afterNarrow = narrow.length > 0 ? narrow[narrow.length - 1] : null;
  const hostNarrow = await read(`const h = document.querySelector('.term-host'); const r = h.getBoundingClientRect(); return { w: r.width, h: r.height };`);
  check("容器变窄 ⇒ 发给主进程的列数变少（方向一致，不是反的）",
    afterNarrow !== null && before !== null && afterNarrow.cols < before.cols && hostNarrow.w < hostBefore.w,
    { before, afterNarrow, hostBefore, hostNarrow });
  await shot("01-narrow");

  // 变高：窗口变矮 ⇒ 行数应变少。
  await win.setContentSize(760, 560);
  await pause(1200);
  const short = await resizeCalls();
  const afterShort = short.length > 0 ? short[short.length - 1] : null;
  const hostShort = await read(`const h = document.querySelector('.term-host'); const r = h.getBoundingClientRect(); return { w: r.width, h: r.height };`);
  check("容器变矮 ⇒ 发给主进程的行数变少",
    afterShort !== null && afterNarrow !== null && afterShort.rows < afterNarrow.rows && hostShort.h < hostNarrow.h,
    { afterNarrow, afterShort, hostNarrow, hostShort });

  // 再放大：行列必须跟着回去（不是单向递减的假象）。
  await win.setContentSize(1440, 900);
  await pause(1200);
  const wide = await resizeCalls();
  const afterWide = wide.length > 0 ? wide[wide.length - 1] : null;
  check("容器放大 ⇒ 行列跟着回去（不是单向递减）",
    afterWide !== null && afterShort !== null && afterWide.cols > afterShort.cols && afterWide.rows > afterShort.rows,
    { afterShort, afterWide });

  const all = await resizeCalls();
  const monotonic = all.every((c) => Number.isInteger(c.cols) && Number.isInteger(c.rows) && c.cols > 0 && c.rows > 0);
  check("每一次同步都是正整数行列（0 尺寸不外发）", monotonic, { count: all.length, last: all[all.length - 1] ?? null });

  check("渲染过程无控制台错误", errors.length === 0, errors);
  writeFileSync(join(out, "checks.json"), JSON.stringify(checks, null, 2));
  writeFileSync(join(out, "resize-calls.json"), JSON.stringify(all, null, 2));
  console.log(`截图与读数：${out}\n隔离测试配置：${profile}`);
  app.exit(checks.every((c) => c.ok) ? 0 : 1);
}
const watchdog = setTimeout(() => { console.error("terminal-resize-smoke: 超时"); app.exit(1); }, 90_000);
watchdog.unref();
main().catch((err) => { console.error(err); app.exit(1); });
