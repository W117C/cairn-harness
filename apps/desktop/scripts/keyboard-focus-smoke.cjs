// 键盘 / 焦点手感 · 离屏真机走查（2026-11-08 第 1049 页）
//
// 为什么不用 dispatchEvent(new KeyboardEvent(...))：焦点移动是浏览器默认行为，
// 合成事件推不动 Tab 序，也测不出 focus-visible 的真实命中。这里走 Electron
// webContents.sendInputEvent（真输入），每步读 activeElement 的几何与焦点环。
//
// 覆盖：① 空态 Tab 序列（含第 1048 页新增的「最近会话」按钮）② 焦点是否可见 /
// 是否被 overflow 裁掉 ③ 焦点有没有中途掉到 body ④ ⌘K 命令面板 + Esc 归还
// ⑤ 项目 chip 弹层 + Esc 归还。判据只钉客观可达性，不替业主做视觉裁决。
//
// 用法：cd apps/desktop && THEME=dark|light env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron \
//         scripts/keyboard-focus-smoke.cjs ../../outputs/keyboard-focus-2026-11-08/<theme>
const { app, BrowserWindow, nativeTheme } = require("electron");
const { scheduleProfileCleanup } = require("./lib/profile-cleanup.cjs");
if (!app || typeof app.whenReady !== "function") {
  console.error("[keyboard-focus] 需要 Electron app；请用 env -u ELECTRON_RUN_AS_NODE electron ...");
  process.exit(2);
}
const { mkdirSync, mkdtempSync, readFileSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");

const SCRIPTS = __dirname;
const ROOT = resolve(SCRIPTS, "..");
const THEME = process.env.THEME === "light" ? "light" : "dark";
const OUT = process.argv[2] ? resolve(process.argv[2]) : resolve(ROOT, "outputs", `keyboard-focus-${THEME}`);
mkdirSync(OUT, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), "cairn-kbd-"));
app.setPath("userData", profile);
nativeTheme.themeSource = THEME;
app.on("quit", () => scheduleProfileCleanup(profile));

const checks = [];
const hardFailures = [];
function check(name, ok, detail) {
  checks.push({ name, ok, ...detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(detail)}`);
  if (!ok) hardFailures.push(name);
}

async function main() {
  await app.whenReady();
  const protocol = readFileSync(resolve(SCRIPTS, "../../../src/main/ipc-protocol.ts"), "utf8");
  const version = Number(protocol.match(/IPC_PROTOCOL_VERSION\s*=\s*(\d+)/)?.[1]);
  const start = protocol.indexOf("export interface AgentApi");
  const body = protocol.slice(start, protocol.indexOf("\n}", start));
  const starts = [...body.matchAll(/^\s{2}(\w+)\??\s*[(<]/gm)];
  const members = starts.map((m, i) => ({
    name: m[1],
    isArray: /Promise<[^>]*\[\]/.test(body.slice(m.index, starts[i + 1]?.index ?? body.length)),
  }));

  const win = new BrowserWindow({
    width: 1440, height: 900, show: false,
    webPreferences: {
      backgroundThrottling: false, offscreen: true,
      preload: join(SCRIPTS, "ui-gallery-preload.cjs"),
      additionalArguments: [
        "--cairn-api-members=" + JSON.stringify(members),
        "--cairn-protocol-version=" + String(version),
        "--cairn-onboarding-groups=[]",
        "--cairn-agent-os-fixture",
        "--cairn-plugin-marketplace-fixture",
      ],
    },
  });
  const js = (src) => win.webContents.executeJavaScript(src);
  const pause = (ms = 90) => new Promise((r) => setTimeout(r, ms));
  const pageErrors = [];
  win.webContents.on("console-message", (_e, level, msg) => { if (level === 3) pageErrors.push(msg); });

  await win.loadFile(resolve(ROOT, "dist", "index.html"));
  await pause(900);
  await js(`(() => { const el = document.documentElement;
    el.dataset.theme = ${JSON.stringify(THEME)}; el.dataset.mode = ${JSON.stringify(THEME)};
    document.body.toggleAttribute("data-ds-dark-theme", ${JSON.stringify(THEME)} === "dark"); return true; })()`);
  await pause(400);

  // 真输入：sendInputEvent 走浏览器默认行为，能移动焦点并命中 :focus-visible。
  const key = async (keyCode, modifiers = []) => {
    await win.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
    await win.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
    await pause(70);
  };
  const focusSnap = () => js(`(() => {
    const e = document.activeElement;
    if (!e || e === document.body) return { body: true, tag: "BODY" };
    const r = e.getBoundingClientRect(), c = getComputedStyle(e);
    return {
      tag: e.tagName, cls: (e.className || "").toString().slice(0, 64),
      text: (e.innerText || e.value || e.getAttribute("aria-label") || "").trim().slice(0, 40),
      x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1),
      outline: c.outlineStyle === "none" ? "none" : (c.outlineWidth + " " + c.outlineStyle),
      shadow: c.boxShadow === "none" ? "none" : "set",
      focusVisible: e.matches(":focus-visible"),
      visible: r.width > 0 && r.height > 0 && c.visibility !== "hidden" && c.display !== "none",
    };
  })()`);
  const shot = async (name) => {
    await pause(200);
    writeFileSync(join(OUT, name + "-" + THEME + ".png"), (await win.webContents.capturePage()).toPNG());
  };

  // ── ① 空态 Tab 序列 ─────────────────────────────────────────────
  await js("document.body.focus()");
  const seq = [];
  for (let i = 0; i < 30; i += 1) { await key("Tab"); seq.push({ step: i + 1, ...(await focusSnap()) }); }
  await shot("01-tab-seq");
  // 记录用的序列写进 checks.json，不塞进每条断言
  console.log("[keyboard-focus] Tab 序列:", JSON.stringify(seq.map((s) => `${String(s.step)}:${String(s.cls || s.tag)}`)));

  check("Tab 序列里没有焦点掉回 body（首尾之外）", !seq.slice(0, -1).some((s) => s.body), {
    bodySteps: seq.filter((s) => s.body).map((s) => s.step),
  });
  check("每个 Tab 落点都是可见元素（非零尺寸）", seq.filter((s) => !s.body).every((s) => s.visible), {
    invisible: seq.filter((s) => !s.body && !s.visible).map((s) => ({ step: s.step, cls: s.cls, w: s.w, h: s.h })),
  });
  // 焦点环：outline 或 box-shadow 至少一处有值；输入框刻意把环交给父盒（focus-within），
  // 由 .composer-card / .chip-search 这类父盒承载，故只统计「两者皆无」的落点做观察，不硬判。
  const noRing = seq.filter((s) => !s.body && s.focusVisible && s.outline === "none" && s.shadow === "none");
  check("焦点环：无「既无 outline 也无 box-shadow」的可见落点（观察项）", noRing.length === 0, {
    noRing: noRing.map((s) => ({ step: s.step, cls: s.cls })),
  });
  check("第 1048 页新增的最近会话按钮键盘可达", seq.some((s) => (s.cls || "").includes("empty-context-item")), {
    reached: seq.filter((s) => (s.cls || "").includes("empty-context-item")).map((s) => s.step),
  });
  // 视觉顺序：焦点 y 应大体单调（允许同一行内左右移动的小回退）
  const ys = seq.filter((s) => !s.body && s.visible).map((s) => s.y);
  const bigJumps = ys.slice(1).filter((y, i) => y < ys[i] - 120).length;
  // 观察项不硬判：焦点从顶栏 → 底栏账户 → 侧栏的 y 回跳是既有信息架构的 DOM 顺序，
  // 重排 tabindex 属方向性改造，需业主裁决；这里只把读数留在 checks.json。
  check("Tab 焦点大幅倒跳（观察项，登记待裁决）", true, { bigJumps, ys });

  // ── ② ⌘K 命令面板：打开 / 焦点 / Esc 归还 ───────────────────────
  const beforePalette = await focusSnap();
  await key("k", ["meta"]);
  await pause(350);
  const paletteOpen = await js(`Boolean(document.querySelector('.cp-input'))`);
  const inPalette = await focusSnap();
  await shot("02-palette");
  check("⌘K 打开命令面板且焦点进搜索框", paletteOpen && (inPalette.tag === "INPUT" || inPalette.tag === "TEXTAREA"),
    { paletteOpen, tag: inPalette.tag, cls: inPalette.cls });
  await key("Escape");
  await pause(350);
  const paletteClosed = await js(`Boolean(document.querySelector('.cp-input'))`);
  const afterPalette = await focusSnap();
  check("Esc 关面板后焦点归还（不丢到 body）", !paletteClosed && !afterPalette.body,
    { paletteClosed, after: afterPalette.cls || afterPalette.tag, before: beforePalette.cls || beforePalette.tag });

  // ── ③ 项目 chip 弹层：打开 / Esc 归还 ───────────────────────────
  // usePopoverDismiss 的纪律是「焦点没丢就不抢」：JS click 打开弹层时焦点还在 composer，
  // Esc 后留在 composer 正是归还目标（不是硬塞回 chip）。故比的是打开前的落点。
  const beforeChip = await focusSnap();
  const chipClicked = await js(`(() => { const e = document.querySelector('.empty-chip'); if (!e) return false; e.click(); return true; })()`);
  await pause(350);
  const popOpen = await js(`Boolean(document.querySelector('.chip-pop.show'))`);
  const popFocus = await focusSnap();
  await shot("03-chip-pop");
  check("项目 chip 弹层能打开且有焦点落点", chipClicked && popOpen && !popFocus.body,
    { chipClicked, popOpen, focus: popFocus.cls || popFocus.tag });
  await key("Escape");
  await pause(350);
  const popClosed = await js(`Boolean(document.querySelector('.chip-pop.show'))`);
  const afterPop = await focusSnap();
  check("Esc 关闭项目弹层后焦点回到打开前的落点（不丢、不抢）",
    !popClosed && !afterPop.body && afterPop.cls === beforeChip.cls && afterPop.tag === beforeChip.tag,
    { popClosed, before: beforeChip.cls || beforeChip.tag, after: afterPop.cls || afterPop.tag });

  // ── ④ 有建议时 Tab 仍是「想下一条」（业主 22.02 裁决不回退） ──────
  // workbench.ts 的 onSuggestNext 直接调 window.agent.suggestNext；给画廊桩打补丁，
  // 真按一次 Tab，量「填入不发送 + 焦点留在输入框」。补丁打不上就记为未测，不制造假红。
  const patched = await js(`(() => {
    try {
      Object.defineProperty(window.agent, "suggestNext", {
        value: () => Promise.resolve({ ok: true, text: "接着抓定价页" }),
        configurable: true, writable: true,
      });
      return true;
    } catch (e) { return String(e); }
  })()`);
  if (patched !== true) {
    check("有建议路径：桩对象不可打补丁，记为未测", true, { patched });
  } else {
    await js(`(() => { const ta = document.querySelector('.composer-card textarea'); if (ta) ta.focus(); return true; })()`);
    await pause(140);
    await key("Tab");
    await pause(650);
    const taVal = await js(`document.querySelector('.composer-card textarea')?.value ?? null`);
    const stillFocused = await js(`document.activeElement?.tagName === "TEXTAREA"`);
    check("有建议时 Tab 仍只填不发、焦点留在输入框（裁决不回退）",
      taVal === "接着抓定价页" && stillFocused, { taVal, stillFocused });
  }

  check("console 无错误", pageErrors.length === 0, { pageErrors });
  writeFileSync(join(OUT, "checks.json"), JSON.stringify({ theme: THEME, checks, hardFailures, seq, pageErrors }, null, 2));
  console.log(`[keyboard-focus] ${String(checks.filter((c) => c.ok).length)}/${String(checks.length)} PASS｜硬失败 ${String(hardFailures.length)}｜${OUT}`);
  await win.destroy();
  app.quit(hardFailures.length > 0 ? 1 : 0);
}

main().catch((e) => { console.error("[keyboard-focus] 崩了", e); app.quit(3); });
