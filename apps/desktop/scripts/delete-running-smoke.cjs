// 删除运行中会话的离屏全链冒烟（2026-10-31）：
//   ① 行菜单删除运行中的会话 → 确认卡前置「先停止本轮」+ 按钮变「停止并删除」；
//   ② 确认后先 runCancel，再越过模拟的运行锁（首次 delete 被拒、预算内重试成功）；
//   ③ 删除后回主页、无错误条、运行旗清掉；④ 非运行会话的确认仍只说「删除」。
// 真实 core 的运行锁硬闸由 tests/sessions.test.ts 钉住；本脚本验渲染层先停再删的接线与重试。
const { app, BrowserWindow, nativeTheme } = require("electron");
const { scheduleProfileCleanup } = require("./lib/profile-cleanup.cjs");
const { mkdirSync, mkdtempSync, readFileSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");

const profile = mkdtempSync(join(tmpdir(), "cairn-delete-profile-"));
app.setPath("userData", profile);
nativeTheme.themeSource = "light";
app.on("quit", () => scheduleProfileCleanup(profile));
const OUT = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), "cairn-delete-"));
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
        "--cairn-delete-running-fixture",
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
  const read = (body) => js(`(() => { ${body} })()`);
  const clickAt = async (selector, text) => {
    const point = await read(`
      const els = [...document.querySelectorAll(${JSON.stringify(selector)})];
      const el = ${text === undefined ? "els[0]" : `els.find((e) => (e.textContent || "").trim() === ${JSON.stringify(text)})`};
      if (!el) return null;
      el.scrollIntoView({ block: "center" });
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    `);
    if (point === null) throw new Error(`找不到可点元素：${selector} ${text ?? ""}`);
    win.webContents.sendInputEvent({ type: "mouseMove", x: point.x, y: point.y });
    win.webContents.sendInputEvent({ type: "mouseDown", x: point.x, y: point.y, button: "left", clickCount: 1 });
    win.webContents.sendInputEvent({ type: "mouseUp", x: point.x, y: point.y, button: "left", clickCount: 1 });
    await pause(120);
  };
  const hover = async (selector) => {
    const point = await read(`
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      el.scrollIntoView({ block: "center" });
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    `);
    if (point === null) throw new Error(`找不到可悬停元素：${selector}`);
    win.webContents.sendInputEvent({ type: "mouseMove", x: point.x, y: point.y });
    await pause(140);
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
  const checks = [];
  const check = (name, ok, detail) => { checks.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(detail ?? "")}`); };

  await win.loadFile(join(__dirname, "../dist/index.html"));
  await waitFor("!!document.querySelector('.composer-card textarea')", "composer");

  // ① 起一轮被挂住的 run（fixture 不放行）。
  await fill("删除运行中的会话");
  await enter();
  await waitFor("!!document.querySelector('.send-btn.stop') && window.__cairnRuns().length === 1", "held run");
  await waitFor("document.querySelector('.session.active') !== null", "active session row");
  const before = await read(`return { active: document.querySelector('.session.active')?.textContent ?? null, runs: window.__cairnRuns(), rows: [...document.querySelectorAll('.session')].map((e) => e.getAttribute('data-session-id') || e.textContent) };`);

  // ② 行菜单 → 归档 → 确认卡前置「后台继续跑」→ 取消（可逆动作不拦）。
  await clickAt(".session.active .s-more");
  await waitFor('[...document.querySelectorAll("[role=menuitem]")].some((e) => (e.textContent || "").trim() === "归档…")', "archive menu item");
  await clickAt("[role=menuitem]", "归档…");
  await waitFor("!!document.querySelector('.confirm-scrim')", "archive confirm");
  const archive = await read(`return {
    note: document.querySelector('.cc-note')?.textContent ?? null,
    buttons: [...document.querySelectorAll('.cc-actions button')].map((b) => (b.textContent || "").trim()),
  };`);
  check("运行中归档确认：前置「后台继续跑」说明", (archive.note ?? "").includes("该会话正在运行：归档后本轮（含已排队消息）会在后台继续跑，完成后照常通知。") && archive.buttons.includes("归档"), archive);
  await clickAt(".cc-actions button", "取消");
  await waitFor("!document.querySelector('.confirm-scrim')", "archive cancelled");

  // ③ 行菜单 → 删除 → 确认卡。
  await clickAt(".session.active .s-more");
  await waitFor('[...document.querySelectorAll("[role=menuitem]")].some((e) => (e.textContent || "").trim() === "删除…")', "delete menu item");
  await clickAt("[role=menuitem]", "删除…");
  await waitFor("!!document.querySelector('.confirm-scrim')", "delete confirm");
  const confirm = await read(`return {
    title: document.querySelector('.cc-title')?.textContent ?? null,
    note: document.querySelector('.cc-note')?.textContent ?? null,
    buttons: [...document.querySelectorAll('.cc-actions button')].map((b) => (b.textContent || "").trim()),
  };`);
  writeFileSync(join(OUT, "01-delete-running-confirm.png"), (await win.webContents.capturePage()).toPNG());
  check("运行中删除确认：前置说明 + 停止并删除按钮", (confirm.title ?? "").includes("删除") && (confirm.note ?? "").includes("该会话正在运行：确认后会先停止本轮，再删除。") && confirm.buttons.includes("停止并删除"), confirm);

  // ④ 真指针确认 → 取消 → 重试删除 → 回主页。
  await clickAt(".cc-actions button", "停止并删除");
  await waitFor("!document.querySelector('.confirm-scrim')", "confirm closed");
  await waitFor("document.querySelector('.main')?.dataset.empty === 'true'", "back home after delete", 10000);
  await pause(250);
  const after = await read(`return {
    empty: document.querySelector('.main')?.dataset.empty ?? null,
    rows: [...document.querySelectorAll('.session')].map((e) => e.getAttribute('data-session-id') || e.textContent),
    cancels: window.__cairnCancels(),
    deletes: window.__cairnDeletes(),
    error: document.querySelector('.error-strip')?.textContent ?? null,
    stop: !!document.querySelector('.send-btn.stop'),
  };`);
  writeFileSync(join(OUT, "02-after-delete.png"), (await win.webContents.capturePage()).toPNG());
  const targetId = before.runs[0]?.sessionId;
  check("先取消本轮再删除：cancel/delete 都打到目标会话", after.cancels.some((c) => c.sessionId === targetId) && after.deletes.length > 0 && after.deletes.every((d) => d.id === targetId), { targetId, cancels: after.cancels, deletes: after.deletes });
  check("运行锁错误在预算内重试越过（首拒后成功）", after.deletes.some((d) => d.busy) && after.deletes.at(-1)?.busy === false, after.deletes);
  check("删除后回主页、无错误条、停止钮消失", after.empty === "true" && after.error === null && after.stop === false, { empty: after.empty, error: after.error, stop: after.stop });

  // ⑤ 非运行会话：确认仍只说「删除」，不摆停止说明。
  await hover(".session");
  await clickAt(".session .s-more");
  await waitFor('[...document.querySelectorAll("[role=menuitem]")].some((e) => (e.textContent || "").trim() === "删除…")', "delete menu item (idle)");
  await clickAt("[role=menuitem]", "删除…");
  await waitFor("!!document.querySelector('.confirm-scrim')", "idle delete confirm");
  const idle = await read(`return {
    note: document.querySelector('.cc-note')?.textContent ?? null,
    buttons: [...document.querySelectorAll('.cc-actions button')].map((b) => (b.textContent || "").trim()),
  };`);
  writeFileSync(join(OUT, "03-idle-delete-confirm.png"), (await win.webContents.capturePage()).toPNG());
  check("非运行会话：按钮为「删除」且无停止说明", idle.buttons.includes("删除") && !(idle.note ?? "").includes("该会话正在运行"), idle);
  await clickAt(".cc-actions button", "取消");
  await waitFor("!document.querySelector('.confirm-scrim')", "idle confirm cancelled");

  check("真实渲染无控制台错误", errors.length === 0, errors);
  writeFileSync(join(OUT, "delete-running-smoke.json"), JSON.stringify({ checks, consoleErrors: errors }, null, 2));
  console.log(`[delete-running-smoke] ${checks.filter((c) => c.ok).length}/${checks.length} PASS｜console error ${errors.length}`);
  app.exit(checks.every((c) => c.ok) ? 0 : 1);
}

setTimeout(() => { console.error("[delete-running-smoke] 超时"); app.exit(1); }, 45000).unref();
main().catch((err) => { console.error("[delete-running-smoke] 崩了:", err && err.stack ? err.stack : String(err)); app.exit(1); });
