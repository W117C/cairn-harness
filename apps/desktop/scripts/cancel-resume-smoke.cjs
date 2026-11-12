// 同一活跃会话的「取消后继续发送」离屏全链冒烟。
//
// 验证的是产品行为，不是队列纯函数：
//   ① 首轮运行中出现停止钮；
//   ② 运行中发送先入队，不新开 run；
//   ③ 停止当前 run 后，队列头自动接上，同一会话起下一轮；
//   ④ 第二轮收束后停止钮消失，队列清空。
//
// 跑法：pnpm --filter cairn-desktop build
//       ELECTRON_RUN_AS_NODE= pnpm --filter cairn-desktop exec electron scripts/cancel-resume-smoke.cjs [out]
const { app, BrowserWindow, nativeTheme } = require("electron");
const { scheduleProfileCleanup } = require("./lib/profile-cleanup.cjs");
const { mkdirSync, mkdtempSync, readFileSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");

const profile = mkdtempSync(join(tmpdir(), "cairn-cancel-profile-"));
app.setPath("userData", profile);
nativeTheme.themeSource = "light";
app.on("quit", () => scheduleProfileCleanup(profile));
const OUT = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), "cairn-cancel-"));
mkdirSync(OUT, { recursive: true });

function agentApiMembers() {
  const src = readFileSync(join(__dirname, "../../../src/main/ipc-protocol.ts"), "utf8");
  const version = Number((src.match(/IPC_PROTOCOL_VERSION\s*=\s*(\d+)/) || [])[1]);
  const start = src.indexOf("export interface AgentApi");
  const body = src.slice(start, src.indexOf("\n}", start));
  const starts = [...body.matchAll(/^\s{2}(\w+)\??\s*[(<]/gm)].map((m) => ({ name: m[1], at: m.index }));
  const members = starts.map((s, i) => {
    const decl = body.slice(s.at, starts[i + 1] ? starts[i + 1].at : body.length);
    return { name: s.name, isArray: /Promise<[^>]*\[\]/.test(decl) };
  });
  return { version, members };
}

async function main() {
  await app.whenReady();
  const { version, members } = agentApiMembers();
  const win = new BrowserWindow({
    width: 1440, height: 900, show: false,
    webPreferences: {
      preload: join(__dirname, "ui-gallery-preload.cjs"),
      additionalArguments: [
        "--cairn-api-members=" + JSON.stringify(members),
        "--cairn-protocol-version=" + version,
        "--cairn-cancel-fixture",
      ],
    },
  });
  const errors = [];
  win.webContents.on("console-message", (d) => { if (d.level === "error") errors.push(d.message); });
  const js = (code) => win.webContents.executeJavaScript(code);
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (expression, label, timeout = 8000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (await js(expression)) return;
      await pause(30);
    }
    throw new Error("等待超时：" + label);
  };
  const fill = async (text) => {
    await js(`(() => {
      const ta = document.querySelector("textarea");
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
      setter.call(ta, ${JSON.stringify(text)});
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`);
  };
  const enter = () => js(`document.querySelector("textarea").dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true })
  )`);

  await win.loadFile(join(__dirname, "../dist/index.html"));
  await waitFor("!!document.querySelector('.composer-card textarea')", "composer");
  await fill("开始一个长任务");
  await enter();
  await waitFor("!!document.querySelector('.send-btn.stop') && window.__cairnRuns().length === 1", "first run");

  await fill("取消后继续发送");
  await waitFor("!!document.querySelector('.send-btn.queue')", "queue button");
  await js("document.querySelector('.send-btn.queue').click()");
  await waitFor("document.querySelectorAll('.queue-item').length === 1", "queued message");
  const beforeCancel = await js("JSON.stringify({ runs: window.__cairnRuns(), queue: document.querySelectorAll('.queue-item').length })");

  await js("document.querySelector('.send-btn.stop').click()");
  await waitFor("window.__cairnRuns().length === 2 && document.querySelectorAll('.queue-item').length === 0", "queued run starts");
  const afterCancel = await js("JSON.stringify({ runs: window.__cairnRuns(), stop: !!document.querySelector('.send-btn.stop'), queue: document.querySelectorAll('.queue-item').length })");

  await js("window.__cairnReleaseRun({ ok: true })");
  await waitFor("!document.querySelector('.send-btn.stop')", "second run finishes");
  const afterRelease = await js("JSON.stringify({ stop: !!document.querySelector('.send-btn.stop'), queue: document.querySelectorAll('.queue-item').length })");

  const b = JSON.parse(beforeCancel);
  const a = JSON.parse(afterCancel);
  const done = JSON.parse(afterRelease);
  const checks = [
    { name: "运行中发送先入队，不新开 run", ok: b.runs.length === 1 && b.queue === 1, detail: b },
    { name: "取消后队列头自动接上同一会话", ok: a.runs.length === 2 && a.runs[1].sessionId === a.runs[0].sessionId && a.runs[1].message === "取消后继续发送" && a.stop === true && a.queue === 0, detail: a },
    { name: "第二轮收束后停止钮消失、队列清空", ok: done.stop === false && done.queue === 0, detail: done },
    { name: "真实渲染无控制台错误", ok: errors.length === 0, detail: errors },
  ];
  writeFileSync(join(OUT, "cancel-resume-smoke.json"), JSON.stringify({ checks, consoleErrors: errors }, null, 2));
  for (const check of checks) console.log(`${check.ok ? "PASS" : "FAIL"} ${check.name}${check.ok ? "" : " " + JSON.stringify(check.detail)}`);
  console.log(`[cancel-resume-smoke] ${checks.filter((c) => c.ok).length}/${checks.length} PASS｜console error ${errors.length}`);
  app.exit(checks.every((c) => c.ok) ? 0 : 1);
}

setTimeout(() => { console.error("[cancel-resume-smoke] 超时"); app.exit(1); }, 30000).unref();
main().catch((err) => { console.error("[cancel-resume-smoke] 崩了:", err && err.stack ? err.stack : String(err)); app.exit(1); });
