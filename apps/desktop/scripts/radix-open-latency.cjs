// Radix 下拉首开/复开延迟的真 Electron 测量。
//
// 口径：用 webContents.sendInputEvent 发真实鼠标输入，命中测试必须落在模型下拉触发钮上；
// 页面时钟从输入前开始，量到 `.mp-pop` 首次进入 DOM。首开与后续复开分开报，不改产品代码。
//
// 跑法：pnpm --filter cairn-desktop build
//       ELECTRON_RUN_AS_NODE= pnpm --filter cairn-desktop exec electron scripts/radix-open-latency.cjs [out.json] [samples]
const { app, BrowserWindow, nativeTheme } = require("electron");
const { scheduleProfileCleanup } = require("./lib/profile-cleanup.cjs");
const { createHash } = require("node:crypto");
const { mkdirSync, mkdtempSync, readFileSync, writeFileSync } = require("node:fs");
const { dirname, join, resolve } = require("node:path");
const { tmpdir } = require("node:os");

const profile = mkdtempSync(join(tmpdir(), "cairn-radix-latency-"));
const output = resolve(process.argv[2] ?? "radix-open-latency.json");
const requestedSamples = Number(process.argv[3] ?? 20);
app.setPath("userData", profile);
nativeTheme.themeSource = "light";
app.on("quit", () => scheduleProfileCleanup(profile));

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

const pct = (sorted, ratio) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];

async function main() {
  if (!Number.isInteger(requestedSamples) || requestedSamples < 2) throw new Error("samples 必须是 >= 2 的整数");

// 开合耗时帽（第 959 页）：此前这支只打印不判定，`app.exit(0)` 无条件——开了 3 秒也照样绿。
// 首开 500 ms / 复开 p95 200 ms（实测首开 26.8、复开 p95 14.3，约 10–20 倍余量）：拦数量级回归。
const firstBudgetMs = Number(process.env.CAIRN_RADIX_FIRST_BUDGET_MS ?? 500);
const warmBudgetMs = Number(process.env.CAIRN_RADIX_WARM_BUDGET_MS ?? 200);
if (![firstBudgetMs, warmBudgetMs].every((v) => Number.isFinite(v) && v > 0)) throw new Error("radix 预算必须是有限正数");
  await app.whenReady();
  const { version, members } = apiSurface();
  const win = new BrowserWindow({
    width: 1440, height: 900, show: false,
    webPreferences: {
      preload: join(__dirname, "ui-gallery-preload.cjs"),
      additionalArguments: [
        "--cairn-api-members=" + JSON.stringify(members),
        "--cairn-protocol-version=" + version,
      ],
      backgroundThrottling: false,
    },
  });
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (expression, label, timeout = 5000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (await js(expression)) return;
      await pause(10);
    }
    throw new Error("等待超时：" + label);
  };

  const started = performance.now();
  await win.loadFile(join(__dirname, "../dist/index.html"));
  await waitFor("!!document.querySelector('.mp-trigger')", "model trigger");
  const startupMs = performance.now() - started;
  const hit = JSON.parse(await js(`(() => {
    const el = document.querySelector('.mp-trigger');
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const target = document.elementFromPoint(x, y);
    return JSON.stringify({ x, y, hit: target === el || el.contains(target), tag: target?.tagName ?? null });
  })()`));
  if (!hit.hit) throw new Error("模型下拉触发钮命中测试失败：" + JSON.stringify(hit));

  const opens = [];
  for (let i = 0; i < requestedSamples; i++) {
    await js(`window.__radixOpenStart = performance.now(); true`);
    win.webContents.sendInputEvent({ type: "mouseDown", x: Math.round(hit.x), y: Math.round(hit.y), button: "left", clickCount: 1 });
    win.webContents.sendInputEvent({ type: "mouseUp", x: Math.round(hit.x), y: Math.round(hit.y), button: "left", clickCount: 1 });
    const elapsed = await js(`new Promise((resolve, reject) => {
      const deadline = performance.now() + 3000;
      const tick = () => {
        if (document.querySelector('.mp-pop')) resolve(performance.now() - window.__radixOpenStart);
        else if (performance.now() > deadline) reject(new Error('menu timeout'));
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    })`);
    opens.push(elapsed);
    win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
    await waitFor("!document.querySelector('.mp-pop')", "menu close");
  }

  const warm = opens.slice(1);
  const sorted = [...warm].sort((a, b) => a - b);
  const report = {
    measuredAt: new Date().toISOString(),
    buildFingerprint: createHash("sha256").update(readFileSync(join(__dirname, "../dist/index.html"))).digest("hex"),
    startupMs,
    hitTest: hit,
    firstOpenMs: opens[0],
    warmOpenMs: { samples: warm.length, p50: pct(sorted, 0.5), p95: pct(sorted, 0.95), max: sorted.at(-1), all: warm },
  };
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  console.log(`[radix-open-latency] first ${opens[0].toFixed(1)}ms | warm p50 ${report.warmOpenMs.p50.toFixed(1)}ms / p95 ${report.warmOpenMs.p95.toFixed(1)}ms / max ${report.warmOpenMs.max.toFixed(1)}ms`);
  const overBudget = [
    ...(opens[0] > firstBudgetMs ? [`首开 ${opens[0].toFixed(1)}ms > 帽 ${String(firstBudgetMs)}ms`] : []),
    ...(report.warmOpenMs.p95 > warmBudgetMs ? [`复开 p95 ${report.warmOpenMs.p95.toFixed(1)}ms > 帽 ${String(warmBudgetMs)}ms`] : []),
  ];
  if (overBudget.length > 0) console.error("[radix-open-latency] 超预算：" + overBudget.join("；"));
  app.exit(overBudget.length === 0 ? 0 : 1);
}

setTimeout(() => { console.error("[radix-open-latency] 超时"); app.exit(1); }, 30000).unref();
main().catch((err) => { console.error("[radix-open-latency] 崩了:", err && err.stack ? err.stack : String(err)); app.exit(1); });
