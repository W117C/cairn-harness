// IME 组字守卫 · 真机判卷（2026-10-28）：真实 renderer + 真实 dist，dispatch 真实的
// compositionstart + Enter(isComposing)，断言「组字途中的一次回车不消费、用户正在写的字不被改写」。
//
// 为什么必须真机：这条缺陷的本体是**浏览器事件顺序**（compositionstart → keydown(isComposing)
// → compositionend）——纯函数判卷只能证"守卫的判定口径对"，证不了"事件真的按那个顺序到达、
// React 真的把 isComposing 透传过来"。本机 Electron 可跑 ⇒ 真机读数是能拿的，就不拿假读数。
//
// 用法（先 build）：cd apps/desktop && env -u ELECTRON_RUN_AS_NODE \
//   ./node_modules/.bin/electron scripts/ime-guard-smoke.cjs outputs/ime-guard-749
// 不运行模型，不使用或清空产品用户数据（独立 userData 临时目录）。
const { app, BrowserWindow, nativeTheme } = require("electron");
const { scheduleProfileCleanup } = require("./lib/profile-cleanup.cjs");
const { mkdirSync, mkdtempSync, readFileSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");

const profile = mkdtempSync(join(tmpdir(), "cairn-ime-guard-profile-"));
app.setPath("userData", profile);
nativeTheme.themeSource = "light";
app.on("quit", () => scheduleProfileCleanup(profile));
const out = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), "cairn-ime-guard-"));
mkdirSync(out, { recursive: true });

async function main() {
  await app.whenReady();
  const protocol = readFileSync(join(__dirname, "../../../src/main/ipc-protocol.ts"), "utf8");
  const version = Number(protocol.match(/IPC_PROTOCOL_VERSION\s*=\s*(\d+)/)[1]);
  const start = protocol.indexOf("export interface AgentApi");
  const body = protocol.slice(start, protocol.indexOf("\n}", start));
  const starts = [...body.matchAll(/^\s{2}(\w+)\??\s*[(<]/gm)];
  const members = starts.map((s, i) => ({
    name: s[1],
    isArray: /Promise<[^>]*\[\]/.test(body.slice(s.index, starts[i + 1]?.index ?? body.length)),
  }));
  const win = new BrowserWindow({
    width: 1440, height: 900, show: false,
    webPreferences: {
      preload: join(__dirname, "ui-gallery-preload.cjs"),
      additionalArguments: ["--cairn-api-members=" + JSON.stringify(members), "--cairn-protocol-version=" + version],
    },
  });
  const errors = [];
  win.webContents.on("console-message", (details) => { if (details.level === "error") errors.push(details.message); });
  const js = async (source) => {
    try {
      return await win.webContents.executeJavaScript(source);
    } catch (err) {
      errors.push(`probe-js: ${String(err && err.message ? err.message : err)}`);
      return null;
    }
  };
  const pause = (ms = 350) => new Promise((r) => setTimeout(r, ms));
  const checks = [];
  const check = (name, ok, detail) => {
    checks.push({ name, ok, detail });
    console.log(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(detail)}`);
  };
  const setComposerValue = (value) => js(`(() => {
    const t = document.querySelector('[data-composer-input="true"]');
    if (!t) return false;
    t.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(t, ${JSON.stringify(value)});
    t.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  // 真实 IME 的事件顺序：compositionstart → keydown(Enter, isComposing=true) → compositionend。
  const imeEnter = () => js(`(() => {
    const t = document.querySelector('[data-composer-input="true"]');
    if (!t) return null;
    t.focus();
    t.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
    const ev = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'isComposing', { value: true });
    const notPrevented = t.dispatchEvent(ev);
    t.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' }));
    return { defaultPrevented: !notPrevented };
  })()`);

  await win.loadFile(join(__dirname, "../dist/index.html"));
  await pause(600);

  // ── ① 斜杠菜单开着：组字回车不得把正在写的字改成 /compact ──
  await setComposerValue("/");
  await pause(400);
  const slashOpen = await js(`(() => ({
    open: !!document.querySelector('.slash-menu'),
    rows: document.querySelectorAll('.slash-menu [role="menuitem"], .slash-menu .menu-item').length,
  }))()`);
  check("斜杠菜单在输入 / 后展开（有可被吃掉的 Enter 分支）", slashOpen?.open === true && slashOpen?.rows > 0, slashOpen);
  const slashIme = await imeEnter();
  await pause(400);
  const slashAfter = await js(`(() => ({
    value: document.querySelector('[data-composer-input="true"]').value,
    slashOpen: !!document.querySelector('.slash-menu'),
  }))()`);
  check(
    "组字期间回车不被斜杠菜单吃掉，用户正在写的字不被改写",
    slashIme?.defaultPrevented === false && slashAfter?.value === "/" && slashAfter?.slashOpen === true,
    { ime: slashIme, after: slashAfter },
  );

  // ── ② 菜单关着（无斜杠命中）：组字回车不得发送 ──
  await setComposerValue("/zzz-no-such-command");
  await pause(400);
  const plainBefore = await js(`(() => ({
    value: document.querySelector('[data-composer-input="true"]').value,
    slashOpen: !!document.querySelector('.slash-menu'),
  }))()`);
  const plainIme = await imeEnter();
  await pause(400);
  const plainAfter = await js(`(() => ({
    value: document.querySelector('[data-composer-input="true"]').value,
    slashOpen: !!document.querySelector('.slash-menu'),
  }))()`);
  check(
    "无菜单时组字回车不发消息（草稿原文留在输入框）",
    plainBefore?.slashOpen === false && plainIme?.defaultPrevented === false && plainAfter?.value === "/zzz-no-such-command",
    { before: plainBefore, ime: plainIme, after: plainAfter },
  );

  // ── ③ 对照：非组字的普通回车**仍然**要能选菜单项（守卫不能把正常 Enter 一起吃掉）──
  await setComposerValue("/");
  await pause(400);
  const normalEnter = await js(`(() => {
    const t = document.querySelector('[data-composer-input="true"]');
    t.focus();
    const ev = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true });
    const notPrevented = t.dispatchEvent(ev);
    return { defaultPrevented: !notPrevented };
  })()`);
  await pause(400);
  const normalAfter = await js(`(() => ({
    value: document.querySelector('[data-composer-input="true"]').value,
    slashOpen: !!document.querySelector('.slash-menu'),
  }))()`);
  check(
    "非组字的回车仍走菜单选中（守卫只挡组字那一次）",
    normalEnter?.defaultPrevented === true && normalAfter?.value === "/compact " && normalAfter?.slashOpen === false,
    { enter: normalEnter, after: normalAfter },
  );

  // ── ④ 候选确认的真实顺序：compositionend **先于** keydown ──
  //    Chromium 的「按回车确认候选词」是这个顺序 ⇒ React 的 onCompositionEnd 已经跑完
  //    ⇒ 维护 composition 状态的引用**已经是 false** ⇒ 只看引用的旧口径会漏挡，
  //    用户的半成品拼音会被当消息发出去（这是 D3 那一族缺陷的本体）。
  //    修法：守卫同时读**事件自身**的 isComposing 旗。
  await setComposerValue("nihao");
  await pause(200);
  const candidateOrder = await js(`(() => {
    const t = document.querySelector('[data-composer-input="true"]');
    if (!t) return null;
    t.focus();
    t.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
    t.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '你好' }));
    const ev = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'isComposing', { value: true });
    const notPrevented = t.dispatchEvent(ev);
    return { defaultPrevented: !notPrevented };
  })()`);
  await pause(600);
  const runsAfter = await js(`JSON.stringify((window.__cairnRuns ? window.__cairnRuns() : []).map((r) => r.message))`);
  check(
    "候选确认顺序（compositionend 先于 keydown）也不发送半成品拼音",
    candidateOrder?.defaultPrevented === false && !String(runsAfter).includes("nihao"),
    { order: candidateOrder, runs: runsAfter },
  );

  check("渲染过程无控制台错误", errors.length === 0, errors);

  writeFileSync(join(out, "checks.json"), JSON.stringify(checks, null, 2));
  const failed = checks.filter((c) => !c.ok);
  console.log(`读数：${checks.length} 条，${checks.length - failed.length} 绿 / ${failed.length} 红 → ${out}`);
  win.destroy();
  rmSync(profile, { recursive: true, force: true });
  app.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("ime-guard-smoke failed:", err);
  rmSync(profile, { recursive: true, force: true });
  app.exit(1);
});
