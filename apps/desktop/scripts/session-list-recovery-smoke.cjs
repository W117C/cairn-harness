// 真实 renderer + 合成 IPC，断言首读/缓存/重试/乱序成功与失败；不调用 Provider。
// CAIRN_RENDERER_DIST 可指向隔离构建；第一个参数是证据目录。
const { app, BrowserWindow } = require("electron");
const { scheduleProfileCleanup } = require("./lib/profile-cleanup.cjs");
const { mkdtempSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");
const profile = mkdtempSync(join(tmpdir(), "cairn-list-recovery-profile-"));
const out = resolve(process.argv[2] || mkdtempSync(join(tmpdir(), "cairn-list-recovery-")));
mkdirSync(out, { recursive: true });
app.setPath("userData", profile);
app.on("quit", () => scheduleProfileCleanup(profile));
const checks = [];
const check = (name, ok) => { checks.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"} ${name}`); };
const pause = () => new Promise((r) => setTimeout(r, 80));
async function main() {
  await app.whenReady();
  const protocol = readFileSync(join(__dirname, "../../../src/main/ipc-protocol.ts"), "utf8");
  const body = protocol.slice(protocol.indexOf("export interface AgentApi"));
  const declarations = body.slice(0, body.indexOf("\n}"));
  const starts = [...declarations.matchAll(/^\s{2}(\w+)\??\s*[(<]/gm)];
  const members = starts.map((s, i) => ({ name: s[1], isArray: /Promise<[^>]*\[\]/.test(declarations.slice(s.index, starts[i + 1]?.index)) }));
  const win = new BrowserWindow({ width: 1440, height: 900, show: false, webPreferences: {
    preload: join(__dirname, "ui-gallery-preload.cjs"),
    additionalArguments: ["--cairn-api-members=" + JSON.stringify(members), "--cairn-protocol-version=" + protocol.match(/IPC_PROTOCOL_VERSION\s*=\s*(\d+)/)[1], "--cairn-list-recovery-fixture"],
  } });
  const errors = [];
  win.webContents.on("console-message", (details) => { if (details.level === "error") errors.push(details.message); });
  win.webContents.on("preload-error", (_event, _path, error) => errors.push(error.message));
  const js = (source) => win.webContents.executeJavaScript(source);
  async function wait(source) {
    for (let attempt = 0; attempt < 100; attempt++) { if (await js(source)) return; await pause(); }
    throw new Error("等待超时: " + source);
  }
  const row = (id) => `document.querySelector('[data-session-id="${id}"]')`;
  const refresh = async () => { const before = await js("window.__cairnSessionList.count()"); await js("window.__cairnSessionList.refresh()"); await wait(`window.__cairnSessionList.count() > ${before}`); return before; };
  const succeed = async (index, id) => { await js(`window.__cairnSessionList.succeed(${index}, ${JSON.stringify(id)})`); await pause(); };
  const fail = async (index) => { await js(`window.__cairnSessionList.fail(${index})`); await pause(); };
  const shot = async (name) => writeFileSync(join(out, name + ".png"), (await win.webContents.capturePage()).toPNG());
  await win.loadFile(join(process.env.CAIRN_RENDERER_DIST || join(__dirname, "../dist"), "index.html"));
  // 原生键盘默认动作要求窗口真正聚焦；只读 DOM focus 不能证明 Enter 展开。
  win.show();
  win.focus();
  await wait("window.__cairnSessionList?.count() === 1 && !!document.querySelector('.side-skeleton')");
  check("首次加载不显示空列表", await js("!document.querySelector('.sidenav').innerText.includes('还没有任务')"));
  await fail(0);
  await wait("!!document.querySelector('.side-load-error')");
  await shot("01-first-error");
  await js("document.querySelector('.side-load-error .side-retry').click()");
  await wait("window.__cairnSessionList.count() === 2");
  check("重试按钮禁用且错误原因保留", await js("!!document.querySelector('.side-load-error .side-retry:disabled') && !!document.querySelector('.side-load-detail')"));
  await succeed(1, "保留的会话");
  await wait(`!!${row("保留的会话")}`);
  const old = await refresh(); const latest = await refresh();
  await succeed(latest, "最新的会话"); await succeed(old, "过期的会话");
  check("旧成功回包不覆盖新列表", await js(`!!${row("最新的会话")} && !${row("过期的会话")}`));
  const oldFailure = await refresh(); const newest = await refresh();
  await succeed(newest, "保留的会话"); await fail(oldFailure);
  check("旧失败不覆盖新成功", await js(`!!${row("保留的会话")} && !document.querySelector('.side-load-error')`));
  await fail(await refresh());
  check("更新失败保留缓存并说明状态", await js(`!!${row("保留的会话")} && document.querySelector('.side-load-error').innerText.includes('更新失败，仍显示上次列表')`));
  for (const [theme, width] of [["light", 1440], ["dark", 880]]) {
    win.setSize(width, 720);
    await js(`document.documentElement.dataset.theme='${theme}'; document.documentElement.dataset.mode='${theme}'; document.body.toggleAttribute('data-ds-dark-theme', '${theme}' === 'dark'); true;`);
    await pause();
    await shot(`02-cached-error-${theme}`);
    const summary = await js("(() => { const el=document.querySelector('.side-load-error summary'); if (!el) return false; el.focus(); return document.activeElement === el; })()");
    check(`${theme} 错误原因可键盘聚焦`, summary);
    if (summary) {
      win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Return" });
      // 原生 summary 的默认激活还需要字符事件；React onKeyDown 控件没有这一要求。
      win.webContents.sendInputEvent({ type: "char", keyCode: "\r" });
      win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Return" });
      await pause();
    }
    check(`${theme} Enter 实际展开错误原因`, await js("document.querySelector('.side-load-error details')?.open === true"));
    check(`${theme} 长路径不撑宽侧栏`, await js("(() => {const nav=document.querySelector('.sidenav'); const detail=document.querySelector('.side-load-detail'); return !!detail && nav.scrollWidth <= nav.clientWidth + 1 && document.documentElement.scrollWidth <= innerWidth;})()"));
    await shot(`03-error-details-${theme}`);
    await js("document.querySelector('.side-load-error details')?.removeAttribute('open'); true;");
  }
  await js(`${row("保留的会话")}.click(); true;`);
  await wait(`!!document.querySelector('[data-session-id="保留的会话"][data-active="true"]') && !!document.querySelector('.row.user')`);
  check("更新失败期间仍能打开缓存会话", await js("!document.querySelector('.side-skeleton') && !!document.querySelector('.row.assistant')"));
  const retry = await js("window.__cairnSessionList.count()");
  await js("document.querySelector('.side-load-error .side-retry').click()");
  await pause();
  check("后台重试保留列表且不叠骨架", await js(`!!${row("保留的会话")} && !document.querySelector('.side-skeleton') && !!document.querySelector('.side-retry:disabled') && document.querySelector('.sidenav').getAttribute('aria-busy') === 'true'`));
  await succeed(retry, "恢复后的会话");
  await wait(`!!${row("恢复后的会话")}`);
  check("重试成功清除错误与忙碌标记", await js("!document.querySelector('.side-load-error') && document.querySelector('.sidenav').getAttribute('aria-busy') === 'false'"));
  const superseded = await refresh(); const pending = await refresh();
  await fail(superseded);
  check("旧请求结束不解除新请求的忙碌态", await js("document.querySelector('.sidenav').getAttribute('aria-busy') === 'true' && !document.querySelector('.side-load-error')"));
  await succeed(pending, "恢复后的会话");
  await succeed(await refresh(), null);
  check("真实空结果正常显示空态", await js("document.querySelector('.sidenav').innerText.includes('还没有任务') && !document.querySelector('.side-load-error')"));
  check("无 renderer 或 preload 错误", errors.length === 0);
  writeFileSync(join(out, "result.json"), JSON.stringify({ checks, errors }, null, 2));
  win.destroy();
  app.exit(checks.every((c) => c.ok) ? 0 : 1);
}
const watchdog = setTimeout(() => { console.error("smoke 超时"); app.exit(1); }, 45_000);
watchdog.unref();
main().catch((error) => { console.error(error); app.exit(1); });
