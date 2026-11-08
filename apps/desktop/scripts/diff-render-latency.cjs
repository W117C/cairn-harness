// 大 diff 真实 renderer 渲染延迟：4000 行 / 20 hunks（core MAX_PATCH_LINES 帽内最坏形状）。
//
// 跑法：pnpm --filter cairn-desktop build
//       ELECTRON_RUN_AS_NODE= pnpm --filter cairn-desktop exec electron scripts/diff-render-latency.cjs [out.json]
const { app, BrowserWindow, nativeTheme } = require("electron");
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { dirname, join, resolve } = require("node:path");
const { tmpdir } = require("node:os");

const profile = mkdtempSync(join(tmpdir(), "cairn-diff-latency-"));
const output = resolve(process.argv[2] ?? "diff-render-latency.json");
app.setPath("userData", profile);
nativeTheme.themeSource = "light";
app.on("quit", () => { rmSync(profile, { recursive: true, force: true }); });

function apiSurface() {
  const protocol = readFileSync(join(__dirname, "../../../src/main/ipc-protocol.ts"), "utf8");
  const version = Number((protocol.match(/IPC_PROTOCOL_VERSION\s*=\s*(\d+)/) || [])[1]);
  const start = protocol.indexOf("export interface AgentApi");
  const body = protocol.slice(start, protocol.indexOf("\n}", start));
  const starts = [...body.matchAll(/^\s{2}(\w+)\??\s*[(<]/gm)];
  const members = starts.map((s, i) => ({
    name: s[1],
    isArray: /Promise<[^>]*\[\]/.test(body.slice(s.index, starts[i + 1]?.index ?? body.length)),
  }));
  return { version, members };
}

async function main() {
  await app.whenReady();
  const { version, members } = apiSurface();
  const win = new BrowserWindow({
    width: 1440, height: 900, show: false,
    webPreferences: {
      preload: join(__dirname, "ui-gallery-preload.cjs"),
      additionalArguments: [
        "--cairn-api-members=" + JSON.stringify(members),
        "--cairn-protocol-version=" + version,
        "--cairn-large-diff-fixture",
      ],
      backgroundThrottling: false,
    },
  });
  const errors = [];
  win.webContents.on("console-message", (d) => { if (d.level === "error") errors.push(d.message); });
  const js = (code) => win.webContents.executeJavaScript(code, true);
  // 挂载耗时帽（第 959 页）：此前 `elapsedMs` 只打印不判定——4000 行 diff 挂成 5 秒也照样 PASS。
// 帽取 2000 ms（实测 203 ms 的约 10 倍）：拦的是数量级回归，不是「慢 10%」。
const budgetMs = Number(process.env.CAIRN_DIFF_BUDGET_MS ?? 2000);
if (!Number.isFinite(budgetMs) || budgetMs <= 0) throw new Error("CAIRN_DIFF_BUDGET_MS 必须是有限正数");
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (expression, label, timeout = 8000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (await js(expression)) return;
      await pause(20);
    }
    throw new Error("等待超时：" + label);
  };

  await win.loadFile(join(__dirname, "../dist/index.html"));
  await waitFor("!!document.querySelector('.session')", "session row");
  await js("document.querySelector('.session').click()");
  await waitFor("!!document.querySelector('.toolcluster')", "tool cluster");
  await js("document.querySelector('.tool-group-toggle').click()");
  // 按**中文动词**选行（第 959 页）：产品自「不暴露实现名」之后，行上只写动词（edit_file → 「编辑」，
  // 词表在 derived/tool-verbs.ts），再按 textContent 找 `edit_file` 永远找不到——这支冒烟因此静默坏掉过。
  // 不许加 data-tool 之类的钩子：`stream-rework.test.tsx` 钉着「渲染出的 HTML 里不出现实现名」。
  await waitFor("!![...document.querySelectorAll('.row.tool .tool-head')].find(el => (el.textContent || '').includes('编辑'))", "edit tool row");
  await js(`(() => {
    window.__diffRenderStart = performance.now();
    [...document.querySelectorAll('.row.tool .tool-head')].find(el => (el.textContent || '').includes('编辑')).click();
    return true;
  })()`);
  await waitFor("document.querySelectorAll('.diff-line').length === 4000", "4000 diff lines");
  const elapsedMs = await js(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() =>
    resolve(performance.now() - window.__diffRenderStart)
  )))`);
  const dom = JSON.parse(await js(`JSON.stringify({
    hunks: document.querySelectorAll('.diff-hunk').length,
    lines: document.querySelectorAll('.diff-line').length,
    nodes: document.querySelectorAll('*').length,
    truncated: document.querySelector('.diff-note')?.textContent.includes('已截断') === true,
  })`));
  const report = { elapsedMs, dom, consoleErrors: errors };
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  const overTime = elapsedMs > budgetMs;
  const ok = dom.hunks === 20 && dom.lines === 4000 && dom.truncated && errors.length === 0 && !overTime;
  if (overTime) console.error(`[diff-render-latency] 超预算：挂载 ${elapsedMs.toFixed(1)}ms > 帽 ${String(budgetMs)}ms`);
  console.log(`[diff-render-latency] ${ok ? "PASS" : "FAIL"} ${elapsedMs.toFixed(1)}ms | ${dom.hunks} hunks / ${dom.lines} lines / ${dom.nodes} nodes`);
  app.exit(ok ? 0 : 1);
}

setTimeout(() => { console.error("[diff-render-latency] 超时"); app.exit(1); }, 30000).unref();
main().catch((err) => { console.error("[diff-render-latency] 崩了:", err && err.stack ? err.stack : String(err)); app.exit(1); });
