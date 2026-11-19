// Plan 模式渲染层冒烟（2026-10-25 写；2026-11-19 按台账第 1016 页「方案自治」重估重写）：
//   第 1016 页（2026-11-04 业主口径）：是否先出方案由 agent 自判——Composer「方案」开关、
//   设置页 Switch 全撤，渲染层**不再发 RunRequest.planRequired**（字段与主进程方案门保留，CLI/判卷可用）。
//   本探针现在验的就是这条撤除契约：武装面不回潮 + run 载荷不带 planRequired。核心方案门
//   本身由 tests/plan-required.test.ts 覆盖；这里只验「UI 面 → run 请求」这一跳，不跑真模型。
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
  const shot = async (name) => writeFileSync(join(out, name + ".png"), (await win.webContents.capturePage()).toPNG());
  const pointer = async (selector) => {
    const point = await js(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: Math.round(r.left + r.width/2), y: Math.round(r.top+r.height/2) }; })()`);
    win.webContents.sendInputEvent({ type: "mouseDown", ...point, button: "left", clickCount: 1 });
    win.webContents.sendInputEvent({ type: "mouseUp", ...point, button: "left", clickCount: 1 });
  };
  const setText = (value) => js(`(() => {
    const el = document.querySelector(".row2 textarea");
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);

  const state = await read(`return { planCtl: !!document.querySelector(".plan-ctl"), composer: !!document.querySelector(".row2 textarea"), empty: document.querySelector(".main")?.dataset.empty ?? null, err: document.querySelector(".render-error")?.textContent ?? null };`);
  check("方案武装面已撤：composer 无方案开关、无根错误", state.planCtl === false && state.composer === true && state.err === null, state);
  await shot("01-no-plan-toggle");

  await setText("plan probe one"); await wait(100);
  await pointer('[aria-label="发送"]'); await wait(900);
  let runs = await read(`return window.__cairnRuns();`);
  check("渲染层不再发 planRequired（agent 自判面）", Array.isArray(runs) && runs.length >= 1 && runs[runs.length - 1].planRequired === undefined, runs.slice(-2));

  await wait(1200);
  const after = await read(`return { composer: !!document.querySelector(".row2 textarea"), err: document.querySelector(".render-error")?.textContent ?? null };`);
  check("首轮结束后 composer 正常、无根错误", after.composer && after.err === null, after);
  await setText("plan probe two"); await wait(100);
  await pointer('[aria-label="发送"]'); await wait(900);
  runs = await read(`return window.__cairnRuns();`);
  check("第二轮同样不带 planRequired（撤除是常态不是首帧巧合）", Array.isArray(runs) && runs.length >= 2 && runs.every((r) => r.planRequired === undefined), runs.slice(-2));
  check("渲染过程无控制台错误", errors.length === 0, errors);
  const imgFinal = await win.webContents.capturePage();
  writeFileSync(join(out, "02-run-without-planrequired.png"), imgFinal.toPNG());

  writeFileSync(join(out, "checks.json"), JSON.stringify(checks, null, 2));
  console.log(`截图与读数：${out}\n隔离测试配置：${profile}`);
  app.exit(checks.every((c) => c.ok) ? 0 : 1);
}

const watchdog = setTimeout(() => { console.error("plan-mode-smoke: 超时"); app.exit(1); }, 45_000);
watchdog.unref();
main().catch((err) => { console.error(err); app.exit(1); });
