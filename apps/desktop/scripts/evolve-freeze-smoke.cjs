// 进化冻结开关的离屏真机冒烟（2026-10-31）：
//   设置 → 进化 → 「冻结」→ 确认卡后果 → 冻结后 STOP 横幅 + 按钮变「解冻」
//   → 解冻 → 横幅消失、按钮复原；evolveSetFrozen 调用记录 [true,false]；0 控制台错误。
// 真实 core 的 STOP 写/删由 tests/evolve-governance.test.ts 钉住；本脚本验桌面入口与状态往返。
const { app, BrowserWindow, nativeTheme } = require("electron");
const { scheduleProfileCleanup } = require("./lib/profile-cleanup.cjs");
const { mkdirSync, mkdtempSync, readFileSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");

const profile = mkdtempSync(join(tmpdir(), "cairn-evolve-profile-"));
app.setPath("userData", profile);
nativeTheme.themeSource = "light";
app.on("quit", () => scheduleProfileCleanup(profile));
const OUT = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), "cairn-evolve-"));
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
      additionalArguments: ["--cairn-api-members=" + JSON.stringify(members), "--cairn-protocol-version=" + version],
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
    await pause(140);
  };
  const checks = [];
  const check = (name, ok, detail) => { checks.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(detail ?? "")}`); };

  await win.loadFile(join(__dirname, "../dist/index.html"));
  await waitFor("!!document.querySelector('.composer-card textarea')", "shell");

  // ① 设置 → 进化（⌘, 是产品自己的设置快捷键）。
  win.webContents.sendInputEvent({ type: "keyDown", keyCode: ",", modifiers: ["meta"] });
  win.webContents.sendInputEvent({ type: "keyUp", keyCode: ",", modifiers: ["meta"] });
  await waitFor("!!document.querySelector('.sp-nav-item')", "settings nav");
  await clickAt(".sp-nav-item", "进化");
  await waitFor('!!document.querySelector(\'button[aria-label="冻结进化"]\')', "freeze button");
  const initial = await read(`return {
    governance: document.querySelector('.ss-page')?.textContent?.includes("治理") === true,
    banner: !!document.querySelector('.banner'),
    label: document.querySelector('button[aria-label="冻结进化"]')?.textContent ?? null,
    calls: window.__cairnEvolveFreezes(),
  };`);
  check("进化分区：治理行与「冻结」入口在场，初始未冻结", initial.governance && initial.label === "冻结" && initial.calls.length === 0, initial);

  // ② 冻结 → 确认卡 → 落盘。
  await clickAt('button[aria-label="冻结进化"]');
  await waitFor("!!document.querySelector('.confirm-scrim')", "freeze confirm");
  const confirm = await read(`return {
    title: document.querySelector('.cc-title')?.textContent ?? null,
    note: document.querySelector('.cc-note')?.textContent ?? null,
    buttons: [...document.querySelectorAll('.cc-actions button')].map((b) => (b.textContent || "").trim()),
  };`);
  writeFileSync(join(OUT, "01-freeze-confirm.png"), (await win.webContents.capturePage()).toPNG());
  check("冻结确认：说清不注入/不晋升/不写候选", (confirm.title ?? "").includes("冻结进化") && (confirm.note ?? "").includes("不会注入经验") && (confirm.note ?? "").includes("不会写技能候选") && confirm.buttons.includes("冻结"), confirm);
  await clickAt(".cc-actions button", "冻结");
  await waitFor('!!document.querySelector(\'button[aria-label="解除进化冻结"]\')', "unfreeze button");
  await waitFor("document.querySelector('.ss-page')?.textContent?.includes('STOP 冻结中') === true", "frozen banner");
  const frozen = await read(`return {
    banner: document.querySelector('.ss-page')?.textContent?.includes("STOP 冻结中") === true,
    label: document.querySelector('button[aria-label="解除进化冻结"]')?.textContent ?? null,
    calls: window.__cairnEvolveFreezes(),
  };`);
  writeFileSync(join(OUT, "02-frozen.png"), (await win.webContents.capturePage()).toPNG());
  check("冻结后：STOP 横幅 + 按钮变「解冻」+ 调用记录 true", frozen.banner && frozen.label === "解冻" && frozen.calls.join(",") === "true", frozen);

  // ③ 解冻 → 横幅消失、按钮复原。
  await clickAt('button[aria-label="解除进化冻结"]');
  await waitFor("!!document.querySelector('.confirm-scrim')", "unfreeze confirm");
  const unfreezeConfirm = await read(`return {
    title: document.querySelector('.cc-title')?.textContent ?? null,
    buttons: [...document.querySelectorAll('.cc-actions button')].map((b) => (b.textContent || "").trim()),
  };`);
  await clickAt(".cc-actions button", "解除冻结");
  await waitFor('!!document.querySelector(\'button[aria-label="冻结进化"]\')', "freeze button back");
  await waitFor("document.querySelector('.ss-page')?.textContent?.includes('STOP 冻结中') !== true", "banner gone");
  const unfrozen = await read(`return {
    banner: document.querySelector('.ss-page')?.textContent?.includes("STOP 冻结中") === true,
    label: document.querySelector('button[aria-label="冻结进化"]')?.textContent ?? null,
    calls: window.__cairnEvolveFreezes(),
  };`);
  writeFileSync(join(OUT, "03-unfrozen.png"), (await win.webContents.capturePage()).toPNG());
  check("解冻确认：标题与按钮", (unfreezeConfirm.title ?? "").includes("解除进化冻结") && unfreezeConfirm.buttons.includes("解除冻结"), unfreezeConfirm);
  check("解冻后：横幅消失、按钮复原、调用记录 true,false", unfrozen.banner === false && unfrozen.label === "冻结" && unfrozen.calls.join(",") === "true,false", unfrozen);
  check("真实渲染无控制台错误", errors.length === 0, errors);

  writeFileSync(join(OUT, "evolve-freeze-smoke.json"), JSON.stringify({ checks, consoleErrors: errors }, null, 2));
  console.log(`[evolve-freeze-smoke] ${checks.filter((c) => c.ok).length}/${checks.length} PASS｜console error ${errors.length}`);
  app.exit(checks.every((c) => c.ok) ? 0 : 1);
}

setTimeout(() => { console.error("[evolve-freeze-smoke] 超时"); app.exit(1); }, 45000).unref();
main().catch((err) => { console.error("[evolve-freeze-smoke] 崩了:", err && err.stack ? err.stack : String(err)); app.exit(1); });
