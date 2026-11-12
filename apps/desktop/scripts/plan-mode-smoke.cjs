// Plan 模式一等入口的真实 renderer 冒烟（2026-10-25）：
//   默认（settings=false）→ 点「方案」→ 发送的 RunRequest 带 planRequired:true →
//   再关掉 → 下一轮带 planRequired:false。核心方案门本身由 tests/plan-required.test.ts 覆盖；
//   这里只验「UI 开关 → run 请求」这一跳，不跑真模型。
const { app, BrowserWindow, nativeTheme } = require("electron");
const { scheduleProfileCleanup } = require("./lib/profile-cleanup.cjs");
const { mkdirSync, mkdtempSync, readFileSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");

const profile = mkdtempSync(join(tmpdir(), "cairn-plan-profile-"));
app.setPath("userData", profile);
nativeTheme.themeSource = "light";
app.on("quit", () => scheduleProfileCleanup(profile));
const out = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), "cairn-plan-"));
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
      additionalArguments: ["--cairn-api-members=" + JSON.stringify(members), "--cairn-protocol-version=" + version],
    },
  });
  const errors = [];
  win.webContents.on("console-message", (_e, level, message) => { if (level >= 2) errors.push(message); });
  await win.loadFile(join(__dirname, "../dist/index.html"));
  await new Promise((r) => setTimeout(r, 1400));
  const js = (source) => win.webContents.executeJavaScript(source);
  const read = (source) => js(`(() => { ${source} })()`);
  const wait = (ms = 400) => new Promise((r) => setTimeout(r, ms));
  const checks = [];
  const check = (name, ok, detail) => { checks.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(detail)}`); };
  const pointer = async (selector) => {
    const point = await js(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: Math.round(r.left + r.width/2), y: Math.round(r.top+r.height/2) }; })()`);
    win.webContents.sendInputEvent({ type: "mouseDown", ...point, button: "left", clickCount: 1 });
    win.webContents.sendInputEvent({ type: "mouseUp", ...point, button: "left", clickCount: 1 });
  };
  const setText = (value) => js(`(() => {
    const el = document.querySelector(".row2 textarea");
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);

  let state = await read(`const b=document.querySelector(".plan-ctl"); return { exists:!!b, pressed:b?.getAttribute("aria-pressed"), on:b?.dataset.on, label:b?.textContent?.trim() ?? null };`);
  check("默认关闭：方案开关可见且 aria-pressed=false", state.exists && state.pressed === "false" && state.on === "false" && state.label === "方案", state);
  await pointer(".plan-ctl"); await wait(300);
  state = await read(`const b=document.querySelector(".plan-ctl"); return { pressed:b?.getAttribute("aria-pressed"), on:b?.dataset.on, notice:document.querySelector(".notice-strip")?.textContent ?? null };`);
  check("点开方案：aria-pressed=true、轻底态、回执在场", state.pressed === "true" && state.on === "true" && (state.notice ?? "").includes("方案模式已开启"), state);
  const imgOn = await win.webContents.capturePage();
  writeFileSync(join(out, "01-plan-on.png"), imgOn.toPNG());

  await setText("plan probe one"); await wait(100);
  await pointer('[aria-label="发送"]'); await wait(900);
  let runs = await read(`return window.__cairnRuns();`);
  check("第一轮 RunRequest 带 planRequired:true", Array.isArray(runs) && runs.length >= 1 && runs[runs.length - 1].planRequired === true, runs.slice(-2));

  await wait(1200);
  state = await read(`return { plan: !!document.querySelector('.plan-ctl'), disabled: document.querySelector('.plan-ctl')?.disabled ?? null, composer: !!document.querySelector('.row2 textarea'), empty: document.querySelector('.main')?.dataset.empty ?? null, err: document.querySelector('.render-error')?.textContent ?? null };`);
  check("首轮结束后方案开关仍在、无根错误", state.plan && state.disabled === false && state.composer && state.err === null, state);
  await pointer(".plan-ctl"); await wait(300);
  await setText("plan probe two"); await wait(100);
  await pointer('[aria-label="发送"]'); await wait(900);
  runs = await read(`return window.__cairnRuns();`);
  check("关掉后下一轮 RunRequest 带 planRequired:false", Array.isArray(runs) && runs.length >= 2 && runs[runs.length - 1].planRequired === false, runs.slice(-2));
  check("渲染过程无控制台错误", errors.length === 0, errors);
  await pointer(".plan-ctl"); await wait(200);
  const imgOff = await win.webContents.capturePage();
  writeFileSync(join(out, "02-plan-off-again.png"), imgOff.toPNG());

  writeFileSync(join(out, "checks.json"), JSON.stringify(checks, null, 2));
  console.log(`截图与读数：${out}\n隔离测试配置：${profile}`);
  app.exit(checks.every((c) => c.ok) ? 0 : 1);
}

const watchdog = setTimeout(() => { console.error("plan-mode-smoke: 超时"); app.exit(1); }, 45_000);
watchdog.unref();
main().catch((err) => { console.error(err); app.exit(1); });
