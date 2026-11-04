// 设置分区逐一点开的视觉自查冒烟（2026-10-30，第 791 页）。
// 缺陷形态：画廊缺 evolveReport 夹具 ⇒ 点「进化」拿到兜底 {}，渲染期炸成「这一块加载失败」；
// 视觉自查永远看不到这一页，而且一个分区炸了没人知道。这条冒烟逐个分区点开，断言：
//   1. 没有渲染错误边界文案（「这一块加载失败」/ .render-error）；
//   2. 分区正文非空；
//   3. 进化分区真的渲染出报告（Episode / playbook / 预算）；
//   4. 全程 0 控制台错误。
// 运行：env -u ELECTRON_RUN_AS_NODE pnpm --filter cairn-desktop exec electron
//   scripts/settings-sweep-smoke.cjs [输出目录]   （前置：pnpm --filter cairn-desktop build）
const { app, BrowserWindow, nativeTheme } = require("electron");
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");

const profile = mkdtempSync(join(tmpdir(), "cairn-settings-sweep-profile-"));
app.setPath("userData", profile);
nativeTheme.themeSource = "light";
app.on("quit", () => { rmSync(profile, { recursive: true, force: true }); });
const out = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), "cairn-settings-sweep-"));
mkdirSync(out, { recursive: true });

async function main() {
  await app.whenReady();
  const protocol = readFileSync(join(__dirname, "../../../src/main/ipc-protocol.ts"), "utf8");
  const version = Number(protocol.match(/IPC_PROTOCOL_VERSION\s*=\s*(\d+)/)[1]);
  const start = protocol.indexOf("export interface AgentApi");
  const body = protocol.slice(start, protocol.indexOf("\n}", start));
  const starts = [...body.matchAll(/^\s{2}(\w+)\??\s*[(<]/gm)];
  const members = starts.map((m, i) => ({ name: m[1], isArray: /Promise<[^>]*\[\]/.test(body.slice(m.index, starts[i + 1]?.index ?? body.length)) }));
  const win = new BrowserWindow({
    width: 1440, height: 900, show: false,
    webPreferences: {
      backgroundThrottling: false,
      offscreen: true,
      preload: join(__dirname, "ui-gallery-preload.cjs"),
      additionalArguments: ["--cairn-api-members=" + JSON.stringify(members), "--cairn-protocol-version=" + version],
    },
  });
  const errors = [];
  win.webContents.on("console-message", (d) => { if (d.level === "error") { errors.push(d.message); console.error("renderer:", d.message); } });
  const js = (s) => win.webContents.executeJavaScript(s);
  const pause = (ms = 250) => new Promise((r) => setTimeout(r, ms));
  const checks = [];
  const check = (name, ok, detail) => { checks.push({ name, ok: ok === true, detail }); console.log(`${ok === true ? "PASS" : "FAIL"} ${name} ${JSON.stringify(detail)}`); };
  async function waitFor(predicate, label, timeout = 15000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) { if (await predicate()) return true; await pause(80); }
    throw new Error("Timeout: " + label);
  }
  const pointerOn = async (findExpr) => {
    const point = await js(`(() => { const el = ${findExpr}; if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    if (point === null) return false;
    win.webContents.sendInputEvent({ type: "mouseDown", ...point, button: "left", clickCount: 1 });
    win.webContents.sendInputEvent({ type: "mouseUp", ...point, button: "left", clickCount: 1 });
    await pause(300);
    return true;
  };

  await win.loadFile(process.env.CAIRN_RENDERER_ENTRY ?? join(__dirname, "../dist/index.html"));
  await pause(1400);
  await win.webContents.focus();
  win.webContents.sendInputEvent({ type: "keyDown", keyCode: ",", modifiers: ["meta"] });
  win.webContents.sendInputEvent({ type: "keyUp", keyCode: ",", modifiers: ["meta"] });
  await waitFor(() => js(`!!document.querySelector('.sp-nav')`), "settings panel");
  const labels = await js(`[...document.querySelectorAll('.sp-nav-item')].map((el) => el.textContent.trim())`);
  check("设置导航列出全部分区", labels.length >= 10, labels);

  const results = [];
  for (const label of labels) {
    const clicked = await pointerOn(`[...document.querySelectorAll('.sp-nav-item')].find((el) => el.textContent.trim() === ${JSON.stringify(label)})`);
    await pause(500); // 各分区异步取数（usage/evolve/plugins 有 30ms 桩 + 渲染）
    const state = await js(`(() => {
      const body = document.querySelector('.sp-body');
      const text = (body?.innerText ?? '').trim();
      return {
        textLen: text.length,
        boundary: text.includes('这一块加载失败'),
        renderError: !!document.querySelector('.sp-body .render-error'),
        title: body?.querySelector('.ss-title, .sp-section-title, .page-frame-title, h1, h2, h3')?.textContent?.trim() ?? null,
      };
    })()`);
    results.push({ label, clicked, ...state });
    writeFileSync(join(out, `section-${String(results.length).padStart(2, "0")}.png`), (await win.webContents.capturePage()).toPNG());
  }
  const broken = results.filter((r) => !r.clicked || r.boundary || r.renderError || r.textLen === 0);
  check("每个分区都能点开、正文非空、无渲染错误边界", broken.length === 0, broken);

  await pointerOn(`[...document.querySelectorAll('.sp-nav-item')].find((el) => el.textContent.trim() === '进化')`);
  await waitFor(() => js(`document.querySelector('.sp-body')?.innerText.includes('Episode')`), "evolve report rendered");
  const evolve = await js(`document.querySelector('.sp-body')?.innerText ?? ''`);
  check("进化分区渲染出报告（Episode / playbook / 预算）", evolve.includes("Episode") && evolve.includes("经验 playbook") && evolve.includes("预算"), { text: evolve.slice(0, 200) });
  writeFileSync(join(out, "01-evolve.png"), (await win.webContents.capturePage()).toPNG());

  const globalRead = await js(`(() => {
    const sec = [...document.querySelectorAll('.ss-sec')].find((el) => el.querySelector('.ss-sec-title')?.textContent?.trim() === '全局经验');
    if (!sec) return { found: false };
    sec.scrollIntoView({ block: 'center' });
    const text = sec.innerText;
    const button = sec.querySelector('button[aria-label^="撤销全局经验"]');
    return {
      found: true,
      text,
      hasBody: text.includes('跨项目通用：先读测试再改实现。'),
      hasObservation: text.includes('负证据（本库+证据库）：观测 0/5'),
      hasFinding: text.includes('负证据（本库+证据库）'),
      hasButton: button !== null,
      hasRestore: sec.querySelector('button[aria-label^="恢复全局经验"]') !== null,
      label: button?.getAttribute('aria-label') ?? null,
    };
  })()`);
  check("全局经验分区渲染出条目与撤销入口", globalRead.found === true && globalRead.hasBody === true && globalRead.hasButton === true, globalRead);
  check("全局经验分区显示本库观测与体检", globalRead.hasObservation === true && globalRead.hasFinding === true, globalRead);
  check("全局经验分区显示恢复入口", globalRead.hasRestore === true, globalRead);
  await pause(250);
  writeFileSync(join(out, "02-evolve-global.png"), (await win.webContents.capturePage()).toPNG());

  if (globalRead.hasButton === true) {
    const opened = await pointerOn(`[...document.querySelectorAll('.ss-sec')].find((el) => el.querySelector('.ss-sec-title')?.textContent?.trim() === '全局经验')?.querySelector('button[aria-label^="撤销全局经验"]')`);
    const confirm = await js(`document.body.innerText.includes('撤销这条全局经验？')`);
    check("全局经验撤销先出确认卡", opened === true && confirm === true, { opened, confirm });
    writeFileSync(join(out, "03-evolve-global-confirm.png"), (await win.webContents.capturePage()).toPNG());
    if (confirm === true) {
      await pointerOn(`[...document.querySelectorAll('.confirm-card button')].find((el) => el.textContent.trim() === '取消')`);
    }
  }

  const restoreOpened = await pointerOn(`[...document.querySelectorAll('.ss-sec')].find((el) => el.querySelector('.ss-sec-title')?.textContent?.trim() === '全局经验')?.querySelector('button[aria-label^="恢复全局经验"]')`);
  const restoreConfirm = restoreOpened === true && await js(`document.body.innerText.includes('恢复这条全局经验？')`);
  check("全局恢复先出确认卡", restoreOpened === true && restoreConfirm === true, { restoreOpened, restoreConfirm });
  if (restoreConfirm === true) {
    await pointerOn(`[...document.querySelectorAll('.confirm-card button')].find((el) => el.textContent.trim() === '取消')`);
  }

  const freezeOpened = await pointerOn(`[...document.querySelectorAll('.ss-sec')].find((el) => el.querySelector('.ss-sec-title')?.textContent?.trim() === '全局经验')?.querySelector('button[aria-label="冻结全局经验"]')`);
  const freezeConfirm = freezeOpened === true && await js(`document.body.innerText.includes('冻结全局经验？')`);
  check("全局冻结先出确认卡", freezeOpened === true && freezeConfirm === true, { freezeOpened, freezeConfirm });
  if (freezeConfirm === true) {
    await pointerOn(`[...document.querySelectorAll('.confirm-card button')].find((el) => el.textContent.trim() === '冻结')`);
    await waitFor(() => js(`document.querySelector('.sp-body')?.innerText.includes('全局已冻结（STOP）')`), "global frozen state");
    const frozen = await js(`(() => {
      const sec = [...document.querySelectorAll('.ss-sec')].find((el) => el.querySelector('.ss-sec-title')?.textContent?.trim() === '全局经验');
      return {
        text: sec?.innerText ?? '',
        hasUnfreeze: sec?.querySelector('button[aria-label="解除全局冻结"]') !== null,
        hasRevoke: sec?.querySelector('button[aria-label^="撤销全局经验"]') !== null,
      };
    })()`);
    check("全局冻结后按钮变解冻、撤销隐藏", frozen.hasUnfreeze === true && frozen.hasRevoke === false, frozen);
    writeFileSync(join(out, "04-evolve-global-frozen.png"), (await win.webContents.capturePage()).toPNG());
    await pointerOn(`[...document.querySelectorAll('.ss-sec')].find((el) => el.querySelector('.ss-sec-title')?.textContent?.trim() === '全局经验')?.querySelector('button[aria-label="解除全局冻结"]')`);
    await pointerOn(`[...document.querySelectorAll('.confirm-card button')].find((el) => el.textContent.trim() === '解除冻结')`);
    await pause(300);
  }

  check("全程无渲染层控制台错误", errors.length === 0, errors);

  writeFileSync(join(out, "checks.json"), JSON.stringify({ fixtureData: true, checks, errors, results }, null, 2));
  const passed = checks.filter((c) => c.ok).length;
  console.log(`[settings-sweep-smoke] ${passed}/${checks.length} PASS\nEvidence: ${out}`);
  app.exit(passed === checks.length ? 0 : 1);
}
const watchdog = setTimeout(() => { console.error("settings-sweep-smoke: 超时"); app.exit(1); }, 90_000);
watchdog.unref();
main().catch((err) => { console.error(err); app.exit(2); });
