// Live 审批卡冒烟（2026-10-31）：真实 renderer + gallery preload 推一条 ask 事件，
// 验证卡片出现、按钮命中（elementFromPoint 不是遮挡）、真实指针「允许」、AskDone 收卡、
// 卡本体 Enter=允许一次。真实主进程的权限决策链由 core/desktop 判卷覆盖；这里只验 UI 面。
// 运行：pnpm --filter cairn-desktop build && env -u ELECTRON_RUN_AS_NODE pnpm --filter cairn-desktop exec electron scripts/approval-live-smoke.cjs [out]
const { app, BrowserWindow, nativeTheme } = require("electron");
const { scheduleProfileCleanup } = require("./lib/profile-cleanup.cjs");
const { mkdirSync, mkdtempSync, readFileSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");

const profile = mkdtempSync(join(tmpdir(), "cairn-approval-live-profile-"));
app.setPath("userData", profile);
nativeTheme.themeSource = "light";
app.on("quit", () => scheduleProfileCleanup(profile));
const out = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), "cairn-approval-live-"));
mkdirSync(out, { recursive: true });

async function main() {
  await app.whenReady();
  const protocol = readFileSync(join(__dirname, "../../../src/main/ipc-protocol.ts"), "utf8");
  const version = Number(protocol.match(/IPC_PROTOCOL_VERSION\s*=\s*(\d+)/)[1]);
  const start = protocol.indexOf("export interface AgentApi");
  const body = protocol.slice(start, protocol.indexOf("\n}", start));
  const starts = [...body.matchAll(/^\s{2}(\w+)\??\s*[(<]/gm)];
  const members = starts.map((member, index) => ({
    name: member[1],
    isArray: /Promise<[^>]*\[\]/.test(body.slice(member.index, starts[index + 1]?.index ?? body.length)),
  }));
  const win = new BrowserWindow({
    width: 1440, height: 900, show: false,
    webPreferences: {
      backgroundThrottling: false,
      preload: join(__dirname, "ui-gallery-preload.cjs"),
      additionalArguments: ["--cairn-api-members=" + JSON.stringify(members), "--cairn-protocol-version=" + version],
    },
  });
  const errors = [];
  win.webContents.on("console-message", (details) => { if (details.level === "error") { errors.push(details.message); console.error("renderer:", details.message); } });
  const js = (source) => win.webContents.executeJavaScript(source);
  const pause = (ms = 250) => new Promise((r) => setTimeout(r, ms));
  const checks = [];
  const check = (name, ok, detail) => { checks.push({ name, ok: ok === true, detail }); console.log(`${ok === true ? "PASS" : "FAIL"} ${name} ${JSON.stringify(detail)}`); };
  const waitFor = async (predicate, label, timeout = 12000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) { if (await predicate()) return true; await pause(80); }
    throw new Error("Timeout: " + label);
  };
  const clickPoint = async (x, y) => {
    win.webContents.sendInputEvent({ type: "mouseMove", x, y });
    win.webContents.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 });
    win.webContents.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 });
    await pause(320);
  };
  const pushAsk = async (payload) => { await js(`window.__cairnPushAsk(${JSON.stringify(payload)})`); };
  const pushDone = async (askId) => { await js(`window.__cairnPushAskDone(${JSON.stringify({ askId })})`); };

  await win.loadFile(join(__dirname, "../dist/index.html"));
  await pause(1400);
  await js(`(() => { const b=[...document.querySelectorAll('button')].find((x) => x.textContent.trim()==='返回'); if(b) b.click(); return true; })()`);
  await pause(350);
  const sid = await js(`(() => { const row=document.querySelector('.session[role="option"]'); if(!row) return null; row.click(); return row.getAttribute('data-session-id'); })()`);
  check("有活动会话可挂审批卡", typeof sid === "string" && sid !== "", sid);
  await pause(700);
  await pushAsk({ sessionId: sid, askId: "ask-live", tool: "run_shell", args: { command: "pnpm test" }, reason: "验证审批卡", risk: "high", riskReasons: ["网络"] });
  await waitFor(() => js(`!!document.querySelector('.card .card-actions')`), "approval card");
  const card = await js(`(() => { const c=document.querySelector('.card'); const btns=[...c.querySelectorAll('.card-actions .btn')]; const r=c.getBoundingClientRect(); return { title:c.querySelector('h3')?.textContent, subject:c.querySelector('.cmdline')?.textContent, buttons:btns.map(b=>({t:b.textContent.trim(), cls:b.className})), rect:{x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)} }; })()`);
  check("审批卡标题/主体/按钮齐全", card.title === "运行命令" && card.subject === "pnpm test" && card.buttons.some((b) => b.t.includes("允许 · 本次")), card);
  const primary = await js(`(() => { const b=[...document.querySelectorAll('.card-actions .btn')].find((x)=>x.textContent.includes('允许 · 本次')); if(!b) return null; b.scrollIntoView({block:'center'}); const r=b.getBoundingClientRect(); return {x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2), label:b.textContent.trim()}; })()`);
  const hit = await js(`(() => { const b=[...document.querySelectorAll('.card-actions .btn')].find((x)=>x.textContent.includes('允许 · 本次')); if(!b) return null; const r=b.getBoundingClientRect(); const e=document.elementFromPoint(r.x+r.width/2, r.y+r.height/2); const btn=e?.closest?.('button'); return { tag:e?.tagName, text:btn?.textContent?.trim() ?? null, same:btn===b }; })()`);
  check("允许按钮真实命中（不被遮挡）", hit?.same === true && hit.text?.includes("允许 · 本次"), hit);
  await pause(260); // gate-in 140ms：等淡入落定再拍，否则截图是首帧透明
  writeFileSync(join(out, "01-approval-card.png"), (await win.webContents.capturePage()).toPNG());
  await clickPoint(primary.x, primary.y);
  const decisions1 = await js(`window.__cairnDecisions()`);
  check("真实指针点「允许 · 本次」→ decide(true)", decisions1.length === 1 && decisions1[0].askId === "ask-live" && decisions1[0].approved === true, decisions1);
  await pushDone("ask-live");
  const gone = await waitFor(() => js(`!document.querySelector('.card')`), "ask card removed", 4000).then(() => true).catch(() => false);
  check("AskDone 后卡片移除", gone, null);
  writeFileSync(join(out, "02-approval-after.png"), (await win.webContents.capturePage()).toPNG());

  // 键盘：卡本体 Enter = 允许一次
  await pushAsk({ sessionId: sid, askId: "ask-kb", tool: "write_file", args: { path: "src/a.ts" }, risk: "low" });
  await waitFor(() => js(`!!document.querySelector('.card')`), "second approval card");
  await js(`(() => { const c=document.querySelector('.card'); c?.focus(); c?.scrollIntoView({block:'center'}); return document.activeElement===c; })()`);
  win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Enter" });
  win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Enter" });
  await pause(350);
  const decisions2 = await js(`window.__cairnDecisions()`);
  check("卡本体 Enter → decide(true)（不双发按钮）", decisions2.length === 2 && decisions2[1].askId === "ask-kb" && decisions2[1].approved === true, decisions2);
  await pushDone("ask-kb");
  check("全程无渲染层控制台错误", errors.length === 0, errors);
  writeFileSync(join(out, "checks.json"), JSON.stringify({ checks, errors }, null, 2));
  const passed = checks.filter((c) => c.ok).length;
  console.log(`[approval-live-smoke] ${passed}/${checks.length} PASS\nEvidence: ${out}`);
  app.exit(passed === checks.length ? 0 : 1);
}
const watchdog = setTimeout(() => { console.error("approval-live-smoke: 超时"); app.exit(1); }, 60_000);
watchdog.unref();
main().catch((err) => { console.error(err); app.exit(2); });
