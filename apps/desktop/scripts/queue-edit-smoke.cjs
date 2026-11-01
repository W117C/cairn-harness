// 队列项就地编辑的离屏真机冒烟（2026-10-31）：
//   ① 运行中排入一条 → 铅笔入口出现；② 点开编辑框（全选原正文），真实输入改字，Enter 提交
//   → 队列条正文更新且 queueSet 落盘载荷带新正文；③ 再开一次，Esc 丢弃草稿、正文不变；
//   ④ 全程 0 控制台错误。
const { app, BrowserWindow, nativeTheme } = require("electron");
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");

const profile = mkdtempSync(join(tmpdir(), "cairn-queue-edit-profile-"));
app.setPath("userData", profile);
nativeTheme.themeSource = "light";
app.on("quit", () => { rmSync(profile, { recursive: true, force: true }); });
const OUT = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), "cairn-queue-edit-"));
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
  const read = (body) => js(`(() => { ${body} })()`);
  const clickAt = async (selector) => {
    const point = await read(`
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      el.scrollIntoView({ block: "center" });
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    `);
    if (point === null) throw new Error(`找不到可点元素：${selector}`);
    win.webContents.sendInputEvent({ type: "mouseMove", x: point.x, y: point.y });
    win.webContents.sendInputEvent({ type: "mouseDown", x: point.x, y: point.y, button: "left", clickCount: 1 });
    win.webContents.sendInputEvent({ type: "mouseUp", x: point.x, y: point.y, button: "left", clickCount: 1 });
    await pause(120);
  };
  const key = async (keyCode) => {
    win.webContents.sendInputEvent({ type: "keyDown", keyCode });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode });
    await pause(120);
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

  // ① 挂住一轮 run，再排一条消息。
  await fill("先跑一个长任务");
  await enter();
  await waitFor("!!document.querySelector('.send-btn.stop') && window.__cairnRuns().length === 1", "held run");
  await fill("排队里的错字");
  await waitFor("!!document.querySelector('.send-btn.queue')", "queue send button");
  // 运行中每拍都有计时器重渲染，指针命中会飘（打断冒烟同因用了 .click()）；本冒烟要点在编辑，不在入队手势。
  await js("document.querySelector('.send-btn.queue').click()");
  await waitFor("document.querySelectorAll('.queue-item').length === 1", "queued item");
  const queued = await read(`return {
    text: document.querySelector('.queue-item .q-text')?.textContent ?? null,
    editButton: !!document.querySelector('.queue-item button[aria-label^="编辑排队项："]'),
    run: window.__cairnRuns()[0]?.sessionId ?? null,
  };`);
  check("运行中入队出现铅笔入口", queued.editButton && queued.text === "排队里的错字", queued);

  // ② 编辑并 Enter 提交（真实输入 + 真实按键）。
  await js(`document.querySelector('.queue-item button[aria-label^="编辑排队项："]').click()`);
  await waitFor("!!document.querySelector('.q-edit') && document.activeElement === document.querySelector('.q-edit')", "edit input focused");
  const opened = await read(`const el = document.querySelector('.q-edit'); return { value: el.value, focused: document.activeElement === el };`);
  await pause(260); // 稳定帧：编辑框挂载/聚焦后的第一帧可能带启动层残影（截图取证不采过渡帧）
  writeFileSync(join(OUT, "01-queue-edit.png"), (await win.webContents.capturePage()).toPNG());
  check("编辑框带原正文并获焦", opened.value === "排队里的错字" && opened.focused, opened);
  // 指针点进输入框会落光标（正常编辑行为）：冒烟里显式全选后整段替换。
  await js("document.querySelector('.q-edit').select()");
  win.webContents.insertText("排队里的正文已改好");
  await waitFor(`document.querySelector('.q-edit')?.value === "排队里的正文已改好"`, "typed edit");
  await key("Enter");
  await waitFor("!document.querySelector('.q-edit')", "edit closed");
  await waitFor(`document.querySelector('.queue-item .q-text')?.textContent === "排队里的正文已改好"`, "queue text updated");
  const committed = await read(`return {
    text: document.querySelector('.queue-item .q-text')?.textContent ?? null,
    sets: window.__cairnQueueSets(),
  };`);
  const lastSet = committed.sets.at(-1);
  check("Enter 提交：条面与落盘载荷都是新正文", committed.text === "排队里的正文已改好" && lastSet?.entries?.[0]?.text === "排队里的正文已改好" && lastSet?.sessionId === queued.run, { text: committed.text, lastSet });
  writeFileSync(join(OUT, "02-queue-edited.png"), (await win.webContents.capturePage()).toPNG());

  // ③ Esc 丢弃草稿。
  await js(`document.querySelector('.queue-item button[aria-label^="编辑排队项："]').click()`);
  await waitFor("!!document.querySelector('.q-edit')", "edit reopened");
  await js(`(() => { const el = document.querySelector('.q-edit'); el.focus(); el.select(); return true; })()`);
  win.webContents.insertText("临时草稿不提交");
  await waitFor(`document.querySelector('.q-edit')?.value === "临时草稿不提交"`, "typed draft");
  await key("Escape");
  await waitFor("!document.querySelector('.q-edit')", "edit cancelled");
  await waitFor("!document.querySelector('.q-edit')", "edit cancelled");
  const cancelled = await read(`return {
    text: document.querySelector('.queue-item .q-text')?.textContent ?? null,
    sets: window.__cairnQueueSets(),
    runs: window.__cairnRuns().length,
    stop: !!document.querySelector('.send-btn.stop'),
  };`);
  check("Esc 取消：正文保持上次提交值，草稿未落盘", cancelled.text === "排队里的正文已改好" && !cancelled.sets.some((c) => c.entries?.some((e) => e.text === "临时草稿不提交")), { text: cancelled.text, sets: cancelled.sets.length });
  check("Esc 只取消编辑：本轮仍在跑、队列条目还在", cancelled.runs === 1 && cancelled.stop === true && cancelled.text !== null, { runs: cancelled.runs, stop: cancelled.stop });

  // ④ 第二条入队 → 下移首条 → 上移回来（条面与落盘载荷同序）。
  await fill("第二条排队消息");
  await waitFor("!!document.querySelector('.send-btn.queue')", "queue send button (second)");
  await js("document.querySelector('.send-btn.queue').click()");
  await waitFor("document.querySelectorAll('.queue-item').length === 2", "two queued");
  await js(`document.querySelector('.queue-item button[aria-label^="下移排队项："]').click()`);
  await waitFor(`[...document.querySelectorAll('.queue-item .q-text')].map((e) => e.textContent).join('|') === "第二条排队消息|排队里的正文已改好"`, "moved down");
  await waitFor(`(window.__cairnQueueSets().at(-1)?.entries?.map((e) => e.text) ?? []).join('|') === "第二条排队消息|排队里的正文已改好"`, "moved down persisted");
  const movedDown = await read(`return {
    order: [...document.querySelectorAll('.queue-item .q-text')].map((e) => e.textContent),
    last: window.__cairnQueueSets().at(-1)?.entries?.map((e) => e.text) ?? null,
  };`);
  check("下移：条面与落盘载荷同序", movedDown.order.join("|") === "第二条排队消息|排队里的正文已改好" && (movedDown.last ?? []).join("|") === movedDown.order.join("|"), movedDown);
  await js(`[...document.querySelectorAll('.queue-item button[aria-label^="上移排队项："]')].at(-1).click()`);
  await waitFor(`[...document.querySelectorAll('.queue-item .q-text')].map((e) => e.textContent).join('|') === "排队里的正文已改好|第二条排队消息"`, "moved back up");
  const movedUp = await read(`return [...document.querySelectorAll('.queue-item .q-text')].map((e) => e.textContent);`);
  check("上移：回到原顺序", movedUp.join("|") === "排队里的正文已改好|第二条排队消息", movedUp);

  // ⑤ 清队列并放行本轮，收干净。
  await js(`document.querySelector('.queue-item button[aria-label^="移出队列："]').click()`);
  await waitFor("document.querySelectorAll('.queue-item').length === 1", "one left");
  await js(`document.querySelector('.queue-item button[aria-label^="移出队列："]').click()`);
  await waitFor("document.querySelectorAll('.queue-item').length === 0", "queue cleared");
  await js("window.__cairnReleaseRun({ ok: true })");
  await waitFor("!document.querySelector('.send-btn.stop')", "run finished");
  check("真实渲染无控制台错误", errors.length === 0, errors);

  writeFileSync(join(OUT, "queue-edit-smoke.json"), JSON.stringify({ checks, consoleErrors: errors }, null, 2));
  console.log(`[queue-edit-smoke] ${checks.filter((c) => c.ok).length}/${checks.length} PASS｜console error ${errors.length}`);
  app.exit(checks.every((c) => c.ok) ? 0 : 1);
}

setTimeout(() => { console.error("[queue-edit-smoke] 超时"); app.exit(1); }, 45000).unref();
main().catch((err) => { console.error("[queue-edit-smoke] 崩了:", err && err.stack ? err.stack : String(err)); app.exit(1); });
