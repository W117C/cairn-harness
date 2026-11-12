// 桌面端设计全面体检（软模式）：离屏 Electron + 假 AgentApi，不跑真模型。
// 与 ui-gallery.cjs 的差别：不把版式断言当硬门（主画廊已守），只拍全量目的地页/门卡/暗色/窄宽，
// 逐像素相同的截图会在 checks.json 里点名，避免「拍了 29 张但其中几张是同一个面」的假证据。
//
// 用法：cd apps/desktop && env -u ELECTRON_RUN_AS_NODE npx electron scripts/design-audit.cjs
// 产物：outputs/design-audit-2026-11-06/*.png + checks.json（可用 CAIRN_DESIGN_AUDIT_OUT 覆盖）
const { app, BrowserWindow, nativeTheme } = require("electron");
const { scheduleProfileCleanup } = require("./lib/profile-cleanup.cjs");
if (!app || typeof app.whenReady !== "function") {
  console.error("[design-audit] 需要 Electron app；请用 env -u ELECTRON_RUN_AS_NODE npx electron scripts/design-audit.cjs");
  process.exit(2);
}
const { mkdirSync, mkdtempSync, readFileSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { createHash } = require("node:crypto");
const { join, resolve } = require("node:path");

const SCRIPTS = __dirname;
const ROOT = resolve(SCRIPTS, "..");
const OUT = process.env.CAIRN_DESIGN_AUDIT_OUT ?? resolve(ROOT, "outputs", "design-audit-2026-11-06");
const RENDERER_ENTRY = resolve(ROOT, "dist", "index.html");
mkdirSync(OUT, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), "cairn-design-audit-"));
app.setPath("userData", profile);
nativeTheme.themeSource = "light";
app.on("quit", () => scheduleProfileCleanup(profile));

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
  const onboarding = readFileSync(resolve(SCRIPTS, "../../../src/main/onboarding-groups.ts"), "utf8");
  const from = onboarding.indexOf("[");
  const to = onboarding.indexOf("] as const;", from);
  const groups = new Function("return " + onboarding.slice(from, to + 1) + ";")();

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    webPreferences: {
      backgroundThrottling: false,
      offscreen: true,
      preload: join(SCRIPTS, "ui-gallery-preload.cjs"),
      additionalArguments: [
        "--cairn-api-members=" + JSON.stringify(members),
        "--cairn-protocol-version=" + String(version),
        "--cairn-onboarding-groups=" + JSON.stringify(groups),
        "--cairn-agent-os-fixture",
        "--cairn-plugin-marketplace-fixture",
      ],
    },
  });
  const js = (src) => win.webContents.executeJavaScript(src);
  const pause = (ms = 420) => new Promise((r) => setTimeout(r, ms));
  const seen = new Map();
  const checks = { version, protocolShots: [], duplicates: [], misses: [], pageErrors: [], themeChecks: [] };
  const shot = async (name) => {
    await pause();
    const png = (await win.webContents.capturePage()).toPNG();
    const key = createHash("sha256").update(png).digest("hex").slice(0, 16);
    if (seen.has(key)) checks.duplicates.push({ shot: name, identicalTo: seen.get(key) });
    seen.set(key, name);
    writeFileSync(join(OUT, name + ".png"), png);
    checks.protocolShots.push({ name, bytes: png.length, sha256: key });
    console.log("[design-audit] shot", name);
  };
  // Radix 菜单要真 pointerdown；普通 React 控件 click() 即可。
  const pointer = (expr) => `(() => {
    const el = ${expr}; if (!el) return false;
    const o = { bubbles: true, cancelable: true, button: 0, pointerType: "mouse", isPrimary: true };
    el.dispatchEvent(new PointerEvent("pointerdown", o));
    el.dispatchEvent(new PointerEvent("pointerup", o));
    el.dispatchEvent(new MouseEvent("click", o)); return true;
  })()`;
  const byText = (sel, text) =>
    `[...document.querySelectorAll(${JSON.stringify(sel)})].find((b) => (b.textContent || "").includes(${JSON.stringify(text)}) && !b.disabled)`;
  const clickText = async (name, sel, text) => {
    const ok = await js(`(() => { const el = ${byText(sel, text)}; if (!el) return false; el.click(); return true; })()`);
    if (!ok) checks.misses.push({ step: name, selector: sel, text });
    return ok;
  };
  const pointerText = async (name, sel, text) => {
    const ok = await js(pointer(byText(sel, text)));
    if (!ok) checks.misses.push({ step: name, selector: sel, text });
    return ok;
  };
  const clickSel = async (name, sel) => {
    const ok = await js(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.click(); return true; })()`);
    if (!ok) checks.misses.push({ step: name, selector: sel });
    return ok;
  };
  const openSettings = async (name) => {
    await js(pointer('document.querySelector(".avatar")'));
    await pause(250);
    const ok = await pointerText(name, ".pop-rd .menu-item", "设置");
    await pause(500);
    return ok;
  };
  const setTheme = async (want) => {
    nativeTheme.themeSource = want;
    await js(`(() => {
      const el = document.documentElement;
      el.dataset.theme = ${JSON.stringify(want)};
      el.dataset.mode = ${JSON.stringify(want)};
      document.body.toggleAttribute("data-ds-dark-theme", ${JSON.stringify(want)} === "dark");
      return true;
    })()`);
    await pause(500);
    const got = await js(`(() => ({ theme: document.documentElement.dataset.theme, mode: document.documentElement.dataset.mode, dark: document.body.hasAttribute("data-ds-dark-theme") }))()`);
    checks.themeChecks.push({ want, got });
  };
  const resize = async (w, h) => { win.setContentSize(w, h); await pause(450); };
  const closeOverlays = async () => {
    await js(`(() => {
      const o = { bubbles: true, cancelable: true, button: 0, pointerType: "mouse", isPrimary: true };
      document.body.dispatchEvent(new PointerEvent("pointerdown", o));
      document.body.dispatchEvent(new PointerEvent("pointerup", o));
      document.querySelector(".sp-back")?.click();
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
      return true;
    })()`);
    await pause(350);
  };
  const goto = async (name, destination) => {
    await clickSel(name, `[data-destination="${destination}"]`);
    await pause(450);
  };

  const installErrorCollector = () => js(`(() => {
    window.__designErrors = [];
    window.addEventListener("error", (e) => window.__designErrors.push(String((e.error && e.error.stack) || e.message)));
    window.addEventListener("unhandledrejection", (e) => window.__designErrors.push(String((e.reason && e.reason.stack) || e.reason)));
    return true;
  })()`);
  const resetRenderer = async () => {
    await win.webContents.session.clearStorageData();
    await win.loadFile(RENDERER_ENTRY);
    await pause(1200);
    await installErrorCollector();
  };
  await resetRenderer();
  await setTheme("light");

  await shot("01-home");
  await clickSel("02-session", ".session");
  await shot("02-session");

  // 检查器：只有带数据的 Tab 才渲染，缺「概览/时间线」是设计契约而非脚本失败。
  await js(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "i", code: "KeyI", metaKey: true, altKey: true, bubbles: true }))`);
  await pause(350);
  await clickText("03-inspector-changes", ".isp-tab", "改动");
  await shot("03-inspector-changes");
  await js(`window.__cairnPushEvent({ type: "plan_proposed", callId: "plan-inspector-audit", plan: { goal: "整理设置页分区层级", files: [{ path: "SettingsPanel.tsx", action: "edit", summary: "收紧导航密度" }], approach: "先量现状，再做最小改动", verify: { test: ["pnpm test"] } } })`);
  await pause(350);
  await clickText("04-inspector-plan", ".isp-tab", "计划");
  await shot("04-inspector-plan");
  await clickText("05-inspector-timeline", ".isp-tab", "时间线");
  await shot("05-inspector-timeline");
  await js(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "i", code: "KeyI", metaKey: true, altKey: true, bubbles: true }))`);
  await pause(300);

  // 设置：Radix 头像菜单 → 设置 → 逐分区。
  await openSettings("06-settings");
  await shot("06-settings");
  for (const [name, label] of [
    ["07-settings-general", "通用"],
    ["08-settings-provider", "模型与 Provider"],
    ["09-settings-personalization", "个性化"],
    ["10-settings-subagents", "子 Agent"],
    ["11-settings-integrations", "MCP 服务器"],
    ["12-settings-hooks", "Hooks"],
    ["13-settings-network", "联网搜索"],
    ["14-settings-usage", "用量统计"],
    ["15-settings-evolve", "进化"],
    ["16-settings-permissions", "权限与安全"],
    ["17-settings-advanced", "高级"],
    ["18-settings-shortcuts", "快捷键"],
    ["19-settings-migration", "迁移导入"],
    ["20-settings-about", "关于与更新"],
    ["21-settings-skills", "技能中心"],
    ["22-settings-worktrees", "工作树"],
  ]) {
    const clicked = await clickText(name, ".sp-nav-item", label);
    if (!clicked) { checks.misses.push({ step: name, selector: ".sp-nav-item", text: label }); continue; }
    // 「通用」本来就是设置页的缺省分区；点它自然是同一张图。给这一格拍搜索收窄态，
    // 既验证分区搜索真能工作，又避免把重复图冒充成一张新面。
    if (name === "07-settings-general") {
      await js(`(() => {
        const input = document.querySelector(".sp-nav-search-input");
        if (!input) return false;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        setter.call(input, "通用");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      })()`);
      await pause(250);
    }
    await shot(name);
    if (name === "07-settings-general") {
      await js(`(() => {
        const input = document.querySelector(".sp-nav-search-input");
        if (!input) return false;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        setter.call(input, "");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      })()`);
      await pause(200);
    }
  }
  await closeOverlays();

  // 目的地页：插件三视图 / 详情 / 记忆 / 自动化。
  await goto("23-plugins", "plugins");
  await shot("23-plugins");
  await clickText("24-plugins-installed", ".plugin-tabs button", "已安装");
  await shot("24-plugins-installed");
  await clickText("25-plugins-updates", ".plugin-tabs button", "可更新");
  await shot("25-plugins-updates");
  await clickText("26-plugins-discover", ".plugin-tabs button", "发现");
  await clickSel("27-plugins-detail", ".plugin-card, .plugin-store-main, .plugin-list-card");
  await shot("27-plugins-detail");
  await goto("28-memory", "memory");
  await shot("28-memory");
  await clickSel("29-memory-detail", ".memory-grid .memory-card, .memory-topic");
  await shot("29-memory-detail");
  await goto("30-automation", "automation");
  await shot("30-automation");
  await clickText("31-automation-idle", ".automation-views button", "闲时队列");
  await shot("31-automation-idle");

  // 门卡：澄清 / 审批 / 方案各推一条合成事件，门只收状态和事件，不跑模型。
  await goto("32-gates", "chat");
  await clickSel("32-gates", ".session");
  await js(`window.__cairnPushEvent({ type: "clarify_requested", session_id: "s1", callId: "clarify-audit", questions: [{ question: "这份报告要覆盖哪些模块？", header: "范围", options: [{ label: "核心模块" }, { label: "全部模块" }] }] })`);
  await pause(350);
  await shot("32-clarify-card");
  await js(`window.__cairnPushAsk({ askId: "ask-audit", sessionId: "s1", tool: "run_shell", args: { command: "pnpm test" }, reason: "默认档逐次审批", risk: "high", riskReasons: ["工作区内命令执行"] })`);
  await pause(350);
  await shot("33-approval-card");
  await js(`window.__cairnPushAskDone({ askId: "ask-audit", outcome: "rejected", reason: "用户取消" }); window.__cairnPushEvent({ type: "tool_result", session_id: "s1", callId: "clarify-audit", ok: true, output: "核心模块" }); window.__cairnPushEvent({ type: "plan_proposed", session_id: "s1", callId: "plan-audit", plan: { goal: "把设置页的分区层级重排一遍", files: [{ path: "SettingsPanel.tsx", action: "edit", summary: "收紧导航密度" }], approach: "先量现状，再做最小改动", verify: { test: ["pnpm test"] } } })`);
  await pause(350);
  await shot("34-plan-card");
  // 门卡是 live 事件状态：合成事件不会随导航消失。暗色/窄宽段重载一次，
  // 不让同一张未决卡片冒充「新拍到」的后续页面（这也是 checks.json 抓到的重复帧）。
  await resetRenderer();

  // 暗色：主屏 / 会话 / 插件 / 设置。
  await setTheme("dark");
  await goto("35-dark-home", "chat");
  await clickSel("35-dark-home", ".new-task-btn, .side-new, button[aria-label*='新任务']");
  await shot("35-dark-home");
  await clickSel("36-dark-session", ".session");
  await shot("36-dark-session");
  await goto("37-dark-plugins", "plugins");
  await shot("37-dark-plugins");
  await openSettings("38-dark-settings");
  await shot("38-dark-settings");
  await closeOverlays();

  // 窄宽：880 / 1120 / 1440 三档，先回亮色。
  await setTheme("light");
  await resize(880, 900);
  await goto("39-narrow-880-plugins", "plugins");
  await shot("39-narrow-880-plugins");
  await goto("40-narrow-880-chat", "chat");
  await shot("40-narrow-880-chat");
  await resize(1120, 900);
  await shot("41-1120-chat");
  await resize(1440, 900);
  await clickSel("42-session-1440", ".session");
  // 会话正文追加在滚动区下方，capturePage 只看视口 ⇒ 用模型菜单这张可见浮层做 1440 宽的最终帧，
  // 避免「推了事件但画面没变」被当成新面。
  await clickSel("42-session-1440", ".mp-trigger");
  await pause(350);
  await shot("42-session-1440");

  checks.pageErrors = await js(`window.__designErrors ?? []`);
  checks.summary = {
    shots: checks.protocolShots.length,
    unique: seen.size,
    duplicates: checks.duplicates.length,
    misses: checks.misses.length,
    pageErrors: checks.pageErrors.length,
    themes: checks.themeChecks.map((x) => x.want).join(","),
  };
  writeFileSync(join(OUT, "checks.json"), JSON.stringify(checks, null, 2) + "\n");
  console.log("[design-audit] summary", JSON.stringify(checks.summary));
  app.exit(0);
}

main().catch((err) => { console.error("[design-audit] FAIL", err); app.exit(1); });
