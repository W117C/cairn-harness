// 「新建会话 → 首发消息 → 跳回旧对话」复现（2026-11-03）。
//
// 真 renderer（apps/desktop/dist 的打包产物）+ 假 AgentApi（scripts/session-jump-preload.cjs）。
// 走真路径：空屏 → 输入 → 回车。读数全部来自 DOM 与渲染层真调过的通道，不读源码文本。
//
// 跑法：
//   env -u ELECTRON_RUN_AS_NODE npx electron scripts/session-jump-smoke.cjs \
//     /Users/ze/Downloads/Cairn/cairn/.tmp/audit-design/session-jump
//
// 读点：
//   · .session[data-active="true"] 的 data-session-id —— 侧栏高亮项（用户看到的「当前对话」）
//   · .stream 文本 —— 主区是不是真的换了会话（高亮对了但转录没换 = 另一种病）
//   · localStorage['cairn.lastSession.v1'] —— 渲染层自己写的「上次会话」
//   · window.__cairnScheme 账本 —— createSession / run 的真实会话 id
const { app, BrowserWindow, nativeTheme } = require("electron");
const { scheduleProfileCleanup } = require("./lib/profile-cleanup.cjs");
const { mkdirSync, mkdtempSync, readFileSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");

const profile = mkdtempSync(join(tmpdir(), "cairn-session-jump-profile-"));
app.setPath("userData", profile);
nativeTheme.themeSource = "light";
app.on("quit", () => scheduleProfileCleanup(profile));

const out = process.argv[2]
  ? resolve(process.argv[2])
  : mkdtempSync(join(tmpdir(), "cairn-session-jump-"));
mkdirSync(out, { recursive: true });

const checks = [];
const errors = [];
const check = (name, ok, detail) => {
  checks.push({ name, ok: ok === true, detail });
  console.log(`${ok === true ? "PASS" : "FAIL"} ${name} ${JSON.stringify(detail ?? "")}`);
};

async function main() {
  await app.whenReady();
  // 协议成员表：与 app-shell-smoke.cjs 同一条读法（preload 沙箱里 require("node:fs") 不可用）。
  const protocol = readFileSync(join(__dirname, "../../../src/main/ipc-protocol.ts"), "utf8");
  const version = Number(protocol.match(/IPC_PROTOCOL_VERSION\s*=\s*(\d+)/)[1]);
  const start = protocol.indexOf("export interface AgentApi");
  const body = protocol.slice(start, protocol.indexOf("\n}", start));
  const starts = [...body.matchAll(/^\s{2}(\w+)\??\s*[(<]/gm)];
  const members = starts.map((member) => ({ name: member[1] }));

  const win = new BrowserWindow({
    width: 1440, height: 900, show: false,
    webPreferences: {
      backgroundThrottling: false,
      preload: join(__dirname, "session-jump-preload.cjs"),
      additionalArguments: [
        "--cairn-sj-members=" + JSON.stringify(members),
        "--cairn-protocol-version=" + version,
      ],
    },
  });
  win.webContents.on("console-message", (d) => {
    if (d.level === "error") { errors.push(d.message); console.error("renderer:", d.message, d.lineNumber); }
  });

  const js = (code) => win.webContents.executeJavaScript(code);
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (expression, label, timeout = 10000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (await js(expression)) return true;
      await pause(25);
    }
    throw new Error("等待超时：" + label);
  };
  const fill = (text) => js(`(() => {
    const ta = document.querySelector(".composer-card textarea") ?? document.querySelector("textarea");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    setter.call(ta, ${JSON.stringify(text)});
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  const enter = () => js(`(() => {
    const ta = document.querySelector(".composer-card textarea") ?? document.querySelector("textarea");
    ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    return true;
  })()`);
  const snapshot = () => js(`(() => {
    const act = document.querySelector('.session[data-active="true"]');
    return {
      t: Math.round(performance.now()),
      active: act ? act.getAttribute("data-session-id") : null,
      activeTitle: act ? (act.querySelector(".s-title")?.textContent ?? null) : null,
      last: (() => { try { return localStorage.getItem("cairn.lastSession.v1"); } catch { return "<unreadable>"; } })(),
      streamHead: (document.querySelector(".stream")?.innerText ?? "").slice(0, 60),
      sidebarIds: [...document.querySelectorAll(".session")].map((el) => el.getAttribute("data-session-id")),
    };
  })()`);

  await win.loadFile(process.env.CAIRN_RENDERER_ENTRY ?? join(__dirname, "../dist/index.html"));
  await waitFor("!!document.querySelector('.composer-card textarea, textarea')", "composer");
  await pause(600);
  console.log("PROBE listSessions:", JSON.stringify(await js(`(async () => { const r = await window.agent.listSessions(); return { t: Object.prototype.toString.call(r), isArray: Array.isArray(r), keys: r && typeof r === "object" ? Object.keys(r).slice(0,8) : null }; })()`)));
  await js(`window.__cairnErrs = []; window.addEventListener("error", (e) => window.__cairnErrs.push(String(e.error && e.error.stack || e.message))); window.addEventListener("unhandledrejection", (e) => window.__cairnErrs.push("REJ:" + String(e.reason && e.reason.stack || e.reason))); true`);
  await pause(800);
  console.log("PROBE errs:", JSON.stringify(await js("window.__cairnErrs")));
  console.log("PROBE dom:", JSON.stringify(await js(`({ side: !!document.querySelector(".side"), sessions: document.querySelectorAll(".session").length, appRail: document.querySelectorAll(".app-rail-item").length, body: document.body.innerText.slice(0,200) })`)));
  console.log("PROBE listProjects:", JSON.stringify(await js(`(async () => { const r = await window.agent.listProjects(); return { isArray: Array.isArray(r) }; })()`)));

  // 读点：DOM 变化序列（谁在什么时候把高亮换掉了）。
  await js(`(() => {
    window.__cairnTrace = [];
    const rec = (why) => {
      const act = document.querySelector('.session[data-active="true"]');
      const row = { t: Math.round(performance.now()), why, active: act ? act.getAttribute("data-session-id") : null,
        last: (() => { try { return localStorage.getItem("cairn.lastSession.v1"); } catch { return null; } })() };
      const prev = window.__cairnTrace[window.__cairnTrace.length - 1];
      if (prev && prev.active === row.active && prev.last === row.last) return;
      window.__cairnTrace.push(row);
    };
    window.__cairnRec = rec;
    new MutationObserver(() => rec("dom")).observe(document.body, {
      subtree: true, attributes: true, attributeFilter: ["data-active"], childList: true,
    });
    const orig = localStorage.setItem.bind(localStorage);
    localStorage.setItem = (k, v) => { const r = orig(k, v); if (k === "cairn.lastSession.v1") rec("lastSession:" + v); return r; };
    rec("init");
    return true;
  })()`);

  await waitFor("document.querySelectorAll('.session').length >= 2", "sidebar sessions");
  await pause(300);

  const before = await snapshot();
  check("起点：空屏（没有高亮项）", before.active === null, before);

  // ① 新会话：真按钮（侧栏「新建任务」）。
  await js("document.querySelector('.side-new')?.click()");
  await pause(120);
  const afterNew = await snapshot();
  check("点「新建任务」后仍停在空屏", afterNew.active === null, afterNew);

  // ② 首发消息。
  const enterAt = Date.now();
  await fill("你好，这是新对话的第一句");
  await enter();

  // 观测窗口：足够覆盖 createSession → activate → refreshSessions → run 返回 → 收束。
  const marks = [];
  for (let i = 0; i < 60; i += 1) {
    marks.push({ dtMs: Date.now() - enterAt, ...(await snapshot()) });
    await pause(50);
  }
  await pause(400);

  const trace = await js("window.__cairnTrace ?? []");
  const ledger = await js("window.__cairnScheme && ({ ...window.__cairnScheme.get(), runs: window.__cairnScheme.runs(), created: window.__cairnScheme.created() })");

  // 判据 A：首发之后高亮项就是新会话（不再变）。
  const activeSeq = [];
  for (const m of marks) {
    const last = activeSeq[activeSeq.length - 1];
    if (last !== m.active) activeSeq.push(m.active);
  }
  // 判据 B：高亮序列里出现过旧会话 = 跳回。
  const jumpedBack = activeSeq.some((id) => id === "old-a" || id === "old-b");
  // 判据 C：最终落点。
  const finalActive = marks[marks.length - 1].active;

  check("首发后高亮项 = 新建会话（不跳回旧会话）", finalActive === "new-1", { finalActive, activeSeq });
  check("高亮序列里没有出现过旧会话 id", !jumpedBack, { activeSeq });
  check("高亮序列只有一次迁移（无 → 新会话）", activeSeq.length <= 2, activeSeq);
  check("renderer 只在这次新会话上跑了一轮", (ledger?.runs ?? []).every((r) => r.sessionId === "new-1"), ledger?.runs);
  check("真实渲染过程无控制台错误", errors.length === 0, errors.slice(0, 5));

  writeFileSync(join(out, "session-jump-result.json"), JSON.stringify({ checks, errors, before, afterNew, marks, trace, ledger }, null, 2));
  writeFileSync(join(out, "01-new-session.png"), (await win.webContents.capturePage()).toPNG());
  console.log("证据：" + out);
  console.log("高亮序列：" + JSON.stringify(activeSeq));
  console.log("trace：" + JSON.stringify(trace));
  console.log("账本：" + JSON.stringify(ledger));

  finish(checks.every((c) => c.ok) ? 0 : 1);
}

function finish(code) {
  for (const w of BrowserWindow.getAllWindows()) w.destroy();
  app.exit(code);
}

const watchdog = setTimeout(() => { console.error("session-jump smoke 超时"); finish(2); }, 120000);
watchdog.unref();
main().catch((err) => { console.error(err); check("冒烟自身跑完", false, String(err)); finish(2); });
