// 「新建会话 → 首发消息 → 跳回旧对话」复现（真主进程 + 真 JSONL 存盘）。
//
// 与 session-continuity-smoke.cjs 同一条装配：require 真 entry.cjs，用 demo provider 的预录剧本
// 跑本地一轮，不联网、不用假 AgentApi。差别只在**读点**：每一步都读侧栏真实高亮项
// （`.session[data-active="true"]` 的 data-session-id）与主区转录，并留下变化序列。
//
// 跑法：
//   env -u ELECTRON_RUN_AS_NODE npx electron scripts/repro-new-session-jump.cjs \
//     /Users/ze/Downloads/Cairn/cairn/.tmp/audit-design/session-jump/real
const { app, BrowserWindow, nativeTheme } = require("electron");
const { scheduleProfileCleanup } = require("./lib/profile-cleanup.cjs");
const { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");

const root = realpathSync(mkdtempSync(join(tmpdir(), "cairn-jump-")));
const profile = join(root, "profile");
const workspace = join(root, "workspace");
const out = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), "cairn-jump-evidence-"));
for (const p of [profile, workspace, out]) mkdirSync(p, { recursive: true });
app.setPath("userData", profile);
app.setAppPath(resolve(__dirname, ".."));
nativeTheme.themeSource = "light";
writeFileSync(join(profile, "settings.json"), JSON.stringify({ provider: "demo", model: "", autoMemory: false, onboarded: false }));
const script = join(root, "provider.jsonl");
writeFileSync(script, JSON.stringify({ type: "assistant_message", content: "已收到本轮消息。" }) + "\n");
process.env.CAIRN_DESKTOP_WORKSPACE = workspace;
process.env.M0B_WORKSPACE = workspace;
process.env.M0A_PROVIDER = "demo";
process.env.M3A_MAIN_SCRIPT = script;
delete process.env.CAIRN_SMOKE;

const checks = [];
const errors = [];
const check = (name, ok, detail) => { checks.push({ name, ok: ok === true, detail }); console.log(`${ok === true ? "PASS" : "FAIL"} ${name} ${JSON.stringify(detail ?? "")}`); };

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const sessionDir = join(workspace, ".agent", "sessions");
function transcripts() {
  try {
    return readdirSync(sessionDir).filter((n) => n.endsWith(".jsonl")).map((n) => ({
      id: n.replace(/\.jsonl$/, ""),
      lines: readFileSync(join(sessionDir, n), "utf8").split("\n").filter(Boolean).length,
    }));
  } catch (e) { if (e.code === "ENOENT") return []; throw e; }
}

require("../src/main/entry.cjs");

async function main() {
  await app.whenReady();
  const deadline = Date.now() + 30000;
  while (BrowserWindow.getAllWindows().length === 0 && Date.now() < deadline) await pause(40);
  const win = BrowserWindow.getAllWindows()[0];
  win.webContents.setBackgroundThrottling(false);
  win.showInactive();
  win.webContents.on("console-message", (d) => { if (d.level === "error") { errors.push(d.message); } });

  const js = (code) => win.webContents.executeJavaScript(code);
  const waitFor = async (expression, label, timeout = 25000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) { if (await js(expression)) return true; await pause(30); }
    throw new Error("等待超时：" + label);
  };
  const snapshot = () => js(`(() => {
    const act = document.querySelector('.session[data-active="true"]');
    const stream = document.querySelector('.stream');
    return {
      t: Math.round(performance.now()),
      active: act ? act.getAttribute("data-session-id") : null,
      last: (() => { try { return localStorage.getItem("cairn.lastSession.v1"); } catch { return null; } })(),
      ids: [...document.querySelectorAll(".session")].map((el) => el.getAttribute("data-session-id")),
      stream: (stream?.innerText ?? "").slice(0, 80),
      streamVisible: stream === null ? null : (() => { const s = getComputedStyle(stream); const r = stream.getBoundingClientRect(); return s.display !== "none" && s.visibility !== "hidden" && r.width > 0 && r.height > 0; })(),
      streamHiddenAncestor: stream === null ? null : (() => {
        let el = stream;
        while (el !== null) { if (el.getAttribute && el.getAttribute("data-hidden") === "true") return true; el = el.parentElement; }
        return false;
      })(),
      emptyVisible: !!document.querySelector(".empty, .empty-surface, .home-empty"),
      workspaceText: (document.querySelector(".chat-workspace")?.innerText ?? "").slice(0, 120),
    };
  })()`);
  const fill = (text) => js(`(() => {
    const ta = document.querySelector(".composer-card textarea");
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(ta, ${JSON.stringify(text)});
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  const clickSend = () => js(`document.querySelector(".send-btn:not(.stop)")?.click()`);

  await waitFor("!!document.querySelector('.composer-card textarea')", "composer");
  await waitFor("!document.getElementById('boot') || getComputedStyle(document.getElementById('boot')).visibility === 'hidden'", "boot overlay");
  await pause(400);

  // ① 先造一条「上一个对话」：主页首发一句，等它落盘并收束。
  await fill("这是上一个对话的内容");
  await waitFor("!!document.querySelector('.send-btn:not(.stop)')", "send button");
  await clickSend();
  await waitFor("document.querySelectorAll('.session').length === 1", "first session row");
  await waitFor("!document.querySelector('.send-btn.stop')", "first run settled");
  await pause(400);
  const first = await snapshot();
  check("① 上一对话已建立并高亮", first.active !== null && transcripts().length === 1, first);

  // 必须走真实打开路径：它回填 SessionView，刚创建后直接新建会漏掉旧视图残留。
  await js(`document.querySelector('.session[data-session-id="${first.active}"]')?.click()`);
  await waitFor("!!document.querySelector('.composer-card textarea:not(:disabled)') && document.querySelector('.stream')?.innerText.includes('这是上一个对话的内容')", "old conversation view loaded");
  check("① 旧对话经侧栏重开，历史视图已载入", (await snapshot()).stream.includes("这是上一个对话的内容"));

  // ② 新建任务（真按钮）→ 空屏。
  await js("document.querySelector('.side-new')?.click()");
  await pause(200);
  const afterNew = await snapshot();
  check("② 点「新建任务」回到空屏（无高亮项）", afterNew.active === null, afterNew);

  // ③ 首发消息，密切采样。
  await fill("新对话的第一句");
  const enterAt = Date.now();
  await clickSend();
  const marks = [];
  for (let i = 0; i < 120; i += 1) { marks.push({ dtMs: Date.now() - enterAt, ...(await snapshot()) }); await pause(40); }
  await pause(500);
  const final = await snapshot();

  const seq = [];
  for (const m of marks) { const last = seq[seq.length - 1]; if (last === undefined || last.id !== m.active) seq.push({ dtMs: m.dtMs, id: m.active }); }
  const jumpBack = seq.filter((s) => s.id !== null && s.id !== final.active && s.id !== seq[seq.length - 1]?.id);
  const finalTranscripts = transcripts();

  check("③ 新会话首发后高亮 = 新会话", final.active !== null && final.active !== first.active, { final, first });
  check("③ 高亮序列里没有回到上一对话", !seq.some((s) => s.id === first.active), { seq, firstActive: first.active });
  check("③ 落盘是两条独立会话", finalTranscripts.length === 2, finalTranscripts);
  check("③ 新对话主区显示自己的首条消息，不显示旧历史", final.streamVisible === true && final.streamHiddenAncestor === false && final.stream.includes("新对话的第一句") && !final.stream.includes("这是上一个对话的内容"), final);

  // ④ 启动恢复 vs 首发抢拍：让 key 指向旧会话后 reload（key 在 reload 后仍指向 #1），
  //    再走一次「新建任务 → 首发」，看恢复效应会不会在发送之后把 activeId 拉回旧会话。
  await js(`localStorage.setItem("cairn.lastSession.v1", ${JSON.stringify(JSON.stringify({ id: first.active, workspace }))})`);
  const reloadAt = Date.now();
  await win.webContents.reload();
  await waitFor("!!document.querySelector('.composer-card textarea')", "composer after reload");
  await waitFor("!document.getElementById('boot') || getComputedStyle(document.getElementById('boot')).visibility === 'hidden'", "boot after reload");
  // 对照实验分臂：--interrupt 臂在恢复还在途时就点「新建任务」；缺省臂等恢复完全落定。
  const interruptArm = process.argv.includes("--interrupt");
  if (interruptArm) { await pause(40); } else { await pause(1500); }
  const afterReload = await snapshot();
  check("④ reload 后由启动恢复打开上一对话", afterReload.active === first.active, { afterReload, firstActive: first.active, reloadAt, interruptArm });

  await js("document.querySelector('.side-new')?.click()");
  await pause(200);
  const newAgain = await snapshot();
  check("④ 再点新建任务回空屏且清 key", newAgain.active === null && newAgain.last === null, newAgain);

  await fill("第二次新会话的第一句");
  const enter2At = Date.now();
  await clickSend();
  const marks2 = [];
  for (let i = 0; i < 140; i += 1) { marks2.push({ dtMs: Date.now() - enter2At, ...(await snapshot()) }); await pause(40); }
  const final2 = await snapshot();
  const seq2 = [];
  for (const m of marks2) { const last = seq2[seq2.length - 1]; if (last === undefined || last.id !== m.active) seq2.push({ dtMs: m.dtMs, id: m.active }); }
  check("④ reload 之后的新会话首发也不再跳回", final2.active !== null && final2.active !== first.active && !seq2.some((s) => s.id === first.active), { seq2, final2 });
  check("④ 恢复旧对话再新建，主区仍只显示新对话内容", final2.stream.includes("第二次新会话的第一句") && !final2.stream.includes("这是上一个对话的内容"), final2);

  check("真实渲染过程无控制台错误", errors.length === 0, errors.slice(0, 6));

  writeFileSync(join(out, "repro-result.json"), JSON.stringify({ checks, errors, first, afterNew, marks, seq, afterReload, marks2, seq2, finalTranscripts }, null, 2));
  writeFileSync(join(out, "01-final.png"), (await win.webContents.capturePage()).toPNG());
  console.log("证据：" + out);
  console.log("高亮序列：" + JSON.stringify(seq));
  console.log("reload 后高亮序列：" + JSON.stringify(seq2));
  console.log("上一对话：" + JSON.stringify(first));
  console.log("落盘：" + JSON.stringify(finalTranscripts));
  finish(checks.every((c) => c.ok) ? 0 : 1);
}

function finish(code) {
  writeFileSync(join(out, "checks.json"), JSON.stringify({ checks, errors }, null, 2));
  for (const w of BrowserWindow.getAllWindows()) w.destroy();
  scheduleProfileCleanup(root);
  app.exit(code);
}
const watchdog = setTimeout(() => { console.error("repro 超时"); finish(2); }, 150000);
watchdog.unref();
main().catch((err) => { console.error(err); check("复现脚本跑完", false, String(err)); finish(2); });
