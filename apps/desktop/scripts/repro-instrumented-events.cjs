// 产物插桩运行器（只读原产物，副本另开目录；不进产品链路）。
//
// 要回答的问题不是「函数返回了什么」，而是「**谁**在什么时候把旧转录写回屏上」。
// 渲染层状态的内部分配在打包后没有可注入的缝，唯一可信的读点是真跑时对 activate / setEvents
// 的记账（含调用栈）。做法：复制 dist → 给 App chunk 的 `activate` 与 `setEvents` 接线处插
// 记账 → 生成指向副本的 index.html → 真 renderer 跑副本。原产物零改动。
const { app, BrowserWindow, nativeTheme } = require("electron");
const { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");

const root = mkdtempSync(join(tmpdir(), "cairn-instr-"));
const profile = join(root, "profile");
const workspace = join(root, "workspace");
const bundleDir = join(root, "bundle");
const out = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), "cairn-instr-evidence-"));
for (const p of [profile, workspace, bundleDir, out]) mkdirSync(p, { recursive: true });

// 原地插桩真产物：先备份字节，收尾逐字节复原并校验 sha256。
// 为什么不做副本：主进程 loadFile 的是 `<repo>/apps/desktop/dist/index.html`（apps/desktop/src/main/index.ts:1114），
// 副本不会被加载——插桩就白插。产物是构建物，复原即无痕。
const { createHash } = require("node:crypto");
const dist = resolve(__dirname, "../dist");
const appChunk = readdirSync(join(dist, "assets")).find((n) => /^App-.*\.js$/.test(n));
const appPath = join(dist, "assets", appChunk);
const originalBytes = readFileSync(appPath);
const originalSha = createHash("sha256").update(originalBytes).digest("hex");
const backupPath = join(root, appChunk + ".orig");
writeFileSync(backupPath, originalBytes);
let source = originalBytes.toString("utf8");

// 记账工具：全局一份。setEvents 记「这次写入是什么形状」，activate 记「是谁调的」（调用栈）。
const PREAMBLE = `
globalThis.__sjLog = globalThis.__sjLog || [];
globalThis.__sjTrace = function (kind, extra) {
  var st = "";
  try { st = String(new Error().stack || "").split("\\n").slice(2, 7).join(" | "); } catch (e) { st = "no-stack"; }
  globalThis.__sjLog.push(Object.assign({ t: Math.round(performance.now()), kind: kind, stack: st }, extra || {}));
};
globalThis.__sjWrapSet = function (name, f) {
  if (!f || f.__sjWrapped) return f;
  var w = function (v) {
    var info = { n: name };
    if (Array.isArray(v)) { info.arr = v.length; info.first = v.length ? String(v[0] && v[0].type) : null; info.last = v.length ? String(v[v.length - 1] && v[v.length - 1].type) : null; }
    else { info.kindv = typeof v; }
    if (typeof v === "function") { globalThis.__sjTrace("setEvents-thunk", info); return f(v); }
    globalThis.__sjTrace("setEvents", info);
    return f(v);
  };
  for (var k in f) w[k] = f[k];
  w.__sjWrapped = true;
  return w;
};
globalThis.__sjWrapActivate = function (f) {
  if (!f || f.__sjActWrapped) return f;
  var w = function (id) {
    globalThis.__sjTrace("activate", { to: id });
    return f(id);
  };
  for (var k in f) w[k] = f[k];
  w.__sjActWrapped = true;
  return w;
};
`;
source = PREAMBLE + source;

let a = 0, b = 0;
source = source.replace(/Zt=o\.useCallback\(D=>\{z\.current=D,f\(D\)\},\[\]\)/g, (m) => {
  a += 1;
  return "Zt=o.useCallback(globalThis.__sjWrapActivate(D=>{z.current=D,f(D)}),[])";
});
source = source.replace(/setEvents:d\}/g, (m) => { b += 1; return "setEvents:globalThis.__sjWrapSet('state',d)}"; });
writeFileSync(appPath, source);
console.log(`插桩：activate 命中 ${a} 处 / setEvents 接线命中 ${b} 处 / chunk=${appChunk}`);
if (a === 0) console.error("!! activate 未命中——插桩无效，读数不可信");
if (b === 0) console.error("!! setEvents 未命中——插桩无效，读数不可信");

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

require("../src/main/entry.cjs");

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  await app.whenReady();
  const deadline = Date.now() + 30000;
  while (BrowserWindow.getAllWindows().length === 0 && Date.now() < deadline) await pause(40);
  const win = BrowserWindow.getAllWindows()[0];
  win.webContents.setBackgroundThrottling(false);
  win.showInactive();
  const errors = [];
  win.webContents.on("console-message", (d) => { if (d.level === "error") errors.push(d.message); });
  const js = (code) => win.webContents.executeJavaScript(code);

  const waitFor = async (expression, label, timeout = 25000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) { if (await js(expression)) return true; await pause(30); }
    throw new Error("等待超时：" + label);
  };
  const fill = (t) => js(`(() => { const ta = document.querySelector(".composer-card textarea");
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(ta, ${JSON.stringify(t)});
    ta.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
  const clickSend = () => js(`document.querySelector(".send-btn:not(.stop)")?.click()`);
  const activeNow = () => js(`(() => { const a = document.querySelector('.session[data-active="true"]'); return a ? a.getAttribute("data-session-id") : null; })()`);

  await waitFor("!!document.querySelector('.composer-card textarea')", "composer");
  await waitFor("!document.getElementById('boot') || getComputedStyle(document.getElementById('boot')).visibility === 'hidden'", "boot");
  await pause(500);

  await fill("这是上一个对话的内容");
  await waitFor("!!document.querySelector('.send-btn:not(.stop)')", "send");
  await clickSend();
  await waitFor("document.querySelectorAll('.session').length === 1", "row1");
  await waitFor("!document.querySelector('.send-btn.stop')", "settled1");
  await pause(600);
  const first = await activeNow();

  // 启动恢复：key 指向旧会话 → reload
  await js(`localStorage.setItem("cairn.lastSession.v1", ${JSON.stringify(JSON.stringify({ id: first, workspace }))})`);
  await win.webContents.reload();
  await waitFor("!!document.querySelector('.composer-card textarea')", "composer2");
  await waitFor("!document.getElementById('boot') || getComputedStyle(document.getElementById('boot')).visibility === 'hidden'", "boot2");
  console.log("DIAG 恢复读点:", JSON.stringify(await js(`(() => { const a = document.querySelector('.session[data-active="true"]');
    return { active: a ? a.getAttribute("data-session-id") : null, last: (() => { try { return localStorage.getItem("cairn.lastSession.v1"); } catch { return null; } })(), rows: document.querySelectorAll('.session').length, errs: JSON.stringify((globalThis.__sjLog||[]).slice(0,3)) }; })()`)));
  await waitFor(`(() => { const a = document.querySelector('.session[data-active="true"]'); return a && a.getAttribute("data-session-id") === ${JSON.stringify(first)}; })()`, "restored");
  await pause(1500);

  const t0 = await js(`(globalThis.__sjLog||[]).length`);
  await js("document.querySelector('.side-new')?.click()");
  await pause(400);
  const t1 = await js(`(globalThis.__sjLog||[]).length`);
  await fill("第二次新会话的第一句");
  await clickSend();
  await waitFor("!!document.querySelector('.session[data-active=\"true\"]')", "new active");
  await pause(4500);

  const log = await js(`(globalThis.__sjLog||[]).slice(${t0})`);
  const dom = await js(`(() => {
    const a = document.querySelector('.session[data-active="true"]');
    return { active: a ? a.getAttribute('data-session-id') : null, stream: (document.querySelector('.stream')?.innerText ?? "").slice(0, 80),
      sessions: [...document.querySelectorAll('.session')].map((el) => el.getAttribute('data-session-id')) };
  })()`);
  console.log("起点 active:", first, "｜点新建后记账：", t1 - t0, "条");
  console.log("DOM 终态:", JSON.stringify(dom));
  console.log("—— 记账 ——");
  for (const row of log) console.log("  ", JSON.stringify(row));
  console.log("控制台错误:", JSON.stringify(errors.slice(0, 5)));
  writeFileSync(join(out, "instrumented-run.json"), JSON.stringify({ first, t0, t1, log, dom, errors }, null, 2));
  console.log("证据：" + out);
  finish(0);
}

function finish(code) {
  // 逐字节复原产物并校验（插桩绝不留在构建物里）
  try {
    const now = readFileSync(appPath);
    const nowSha = createHash("sha256").update(now).digest("hex");
    if (nowSha !== originalSha) {
      writeFileSync(appPath, originalBytes);
      const back = createHash("sha256").update(readFileSync(appPath)).digest("hex");
      console.log(`产物复原：${appChunk} → ${back === originalSha ? "OK（sha256 一致）" : "!! 不一致"}`);
    } else {
      console.log("产物未被改动（无需复原）");
    }
  } catch (e) { console.error("复原失败：", e); }
  for (const w of BrowserWindow.getAllWindows()) w.destroy();
  rmSync(root, { recursive: true, force: true });
  app.exit(code);
}
const watchdog = setTimeout(() => { console.error("插桩冒烟超时"); finish(2); }, 150000);
watchdog.unref();
main().catch((err) => { console.error(err); finish(2); });
