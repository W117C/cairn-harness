// 第 9 点·轮中插话的**离屏全链冒烟**（2026-10-23）。
//
// ⛔ **本脚本今天不通（未证，不是已证）**：运行态在这一套 gallery 桩里立不住——
//    活动会话的 running 只由 `send()` 那条路置位（session-subscription.ts 的「运行集口径」注释），
//    而桩侧 `run` 挂住之后 `stop` 钮仍从不出现（逐拍 200ms×6 观测：trail = "------"），
//    ⇒ "运行中按回车"这一拍根本走不到。若有人接着做，先解决"让 gallery 里的 running 真的成立"，
//    再谈这条冒烟；不要为了让判据变绿去改产品代码。
//
// 本脚本仍然有价值的三件产出（都是今天真跑出来的）：
//  ① 暴露出三个**构建门抓得到、test 门抓不到**的类型错（`KernelHost.steer` 未声明、
//     `StreamRow.steering` 未声明、`sendWithGoal` 第三参没穿透）——`pnpm --filter cairn-desktop build`
//     全红，而 `test` 全绿。这条本身就是一条值得记的教训：desktop 的 build 门比 test 门严。
//  ② 桩里 `runSteer` 原本落到兜底 `reply({})` ⇒ 渲染层读 `ok === true` 得 undefined
//     ⇒ 运行中回车**永远走队列**，插话那条路在界面上一次都走不到，而所有单测照样绿。已补真实现。
//  ③ 桩记录器第一版写在 `globalThis`（preload 与 renderer 不共享）⇒ 调用成功而记录恒 null。
//     改用 contextBridge 暴露 `__cairnSteers()` / `__cairnRuns()` / `__cairnReleaseRun()`。
//
// 跑法：pnpm --filter cairn-desktop build
//       ELECTRON_RUN_AS_NODE= pnpm --filter cairn-desktop exec electron scripts/steer-smoke.cjs [out]
//      （本仓宿主会注入 ELECTRON_RUN_AS_NODE，不清掉会把 Electron 降级成纯 Node）

const { app
const { app, BrowserWindow, nativeTheme } = require("electron");
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");

const profile = mkdtempSync(join(tmpdir(), "cairn-steer-profile-"));
app.setPath("userData", profile);
nativeTheme.themeSource = "light";
app.on("quit", () => { rmSync(profile, { recursive: true, force: true }); });
const OUT = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), "cairn-steer-"));
mkdirSync(OUT, { recursive: true });

/** AgentApi 的成员表取自真源（与 ui-gallery 同一条纪律：手抄会漏，漏的那个 mount 时就炸）。 */
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
        "--cairn-steer-fixture", // 让桩的 run 挂住 ⇒ 运行态才立得住（理由见 preload 里那段注释）
      ],
    },
  });
  const errors = [];
  win.webContents.on("console-message", (d) => { if (d.level === "error") errors.push(d.message); });
  const js = (code) => win.webContents.executeJavaScript(code);
  const checks = [];
  const check = (name, ok, detail) => {
    checks.push({ name, ok, detail });
    console.log(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(detail)}`);
  };

  await win.loadFile(join(__dirname, "../dist/index.html"));
  await new Promise((r) => setTimeout(r, 1200));

  // ---- ① 先真发一条：让 send() 自己把 running 置起来 ----
  // 不能用推事件伪造：活动会话的 running 置位只走发送那条路（session-subscription.ts 注释）。
  const firstSent = await js(`(async () => {
    const ta = document.querySelector("textarea");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    setter.call(ta, "把 a.ts 改一下");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise(r => setTimeout(r, 80));
    ta.focus();
    ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 500));
    return JSON.stringify({
      steersSoFar: (window.__cairnSteers && window.__cairnSteers()) ?? [],
      stopBtn: !!document.querySelector(".send-btn.stop"),
    });
  })()`);
  const f1 = JSON.parse(firstSent);
  check("① 空闲时回车 = 起一轮（不插话）：runSteer 未被调用，且出现停止钮",
    f1.steersSoFar.length === 0 && f1.stopBtn === true, firstSent);

  // ---- ② 关键一拍：**运行中**在输入框里打字并回车 ----
  const steered = await js(`(async () => {
    const ta = document.querySelector("textarea");
    if (!ta) return JSON.stringify({ error: "no textarea" });
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    setter.call(ta, "插话：先别改 a.ts");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise(r => setTimeout(r, 80));
    ta.focus();
    ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 600));
    return JSON.stringify({
      steers: (window.__cairnSteers && window.__cairnSteers()) ?? [],
      noticeText: document.body.innerText.includes("已插话到本轮"),
      queueRows: document.querySelectorAll(".q-sub").length,
    });
  })()`);
  const s2 = JSON.parse(steered);
  check("★ 运行中回车真的调了 runSteer（不是默默排队）",
    Array.isArray(s2.steers) && s2.steers.length === 1, steered);
  check("★ 带的话就是输入框里那句",
    Array.isArray(s2.steers) && s2.steers[0] && s2.steers[0].text === "插话：先别改 a.ts", s2.steers);
  check("★ 回执是「已插话到本轮」（用户分得清插话与排队）", s2.noticeText === true, s2.noticeText);
  check("反向：这条话**没有**进队列条（否则既插话又排队＝发两遍）", s2.queueRows === 0, s2.queueRows);

  const img = await win.webContents.capturePage();
  writeFileSync(join(OUT, "steer-sent.png"), img.toPNG());

  // ---- 反面：主进程说「不在运行」时，必须回落入队（一个字都不丢）----
  const fallback = await js(`(async () => {
    // 把窗口里的 runSteer 换成"不在运行"的应答，模拟这一轮刚好收束
    const real = window.agent.runSteer;
    window.agent.runSteer = async () => ({ ok: false, error: "会话不在运行（插话无人接收）" });
    const ta = document.querySelector("textarea");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    setter.call(ta, "这句该进队列");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise(r => setTimeout(r, 60));
    ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 400));
    window.agent.runSteer = real;
    return JSON.stringify({ queueRows: document.querySelectorAll(".q-sub").length });
  })()`);
  const f = JSON.parse(fallback);
  check("镜像：不在运行 ⇒ 回落为队列（不吞消息）", f.queueRows >= 1, fallback);

  const report = {
    checks,
    consoleErrors: errors,
    passed: checks.every((c) => c.ok) && errors.length === 0,
  };
  writeFileSync(join(OUT, "steer-smoke.json"), JSON.stringify(report, null, 2));
  console.log("[steer-smoke] 输出目录:", OUT);
  console.log(`[steer-smoke] ${checks.filter((c) => c.ok).length}/${checks.length} PASS｜console error ${errors.length}`);
  app.exit(report.passed ? 0 : 1);
}

main().catch((err) => {
  console.error("[steer-smoke] 崩了:", err && err.stack ? err.stack : String(err));
  app.exit(1);
});
