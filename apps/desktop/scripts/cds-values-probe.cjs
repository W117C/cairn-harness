// 把真实 renderer 里算出来的颜色读出来，和官方 CDS 令牌逐档比对。
// 不是看截图猜色，是读 getComputedStyle 的解析结果——这是「一比一」唯一能机读的证据。
// 跑法（先 pnpm --filter cairn-desktop build）：
//   electron scripts/cds-values-probe.cjs <输出 JSON>
const { app, BrowserWindow, nativeTheme } = require("electron");
const { scheduleProfileCleanup } = require("./lib/profile-cleanup.cjs");
const { mkdtempSync, readFileSync, writeFileSync, mkdirSync } = require("node:fs");
const { join, resolve, dirname } = require("node:path");
const { tmpdir } = require("node:os");

const profile = mkdtempSync(join(tmpdir(), "cairn-cds-probe-"));
app.setPath("userData", profile);
app.on("quit", () => scheduleProfileCleanup(profile));
const out = process.argv[2] ? resolve(process.argv[2]) : join(tmpdir(), "cds-values.json");

async function main() {
  await app.whenReady();
  // 合成 AgentApi 的成员表必须与 layout-smoke 同源（读 ipc-protocol.ts），
  // 否则 renderer 会落进 render-error 边界：页面上什么都量不到，
  // 而令牌照样读得出值 —— 那样「量了」等于没量（2026-10-28 实测踩过）。
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
  win.webContents.on("console-message", (d) => { if (d.level === "error") errors.push(d.message); });
  await win.loadFile(join(__dirname, "../dist/index.html"));
  await new Promise((r) => setTimeout(r, 400));
  const js = (src) => win.webContents.executeJavaScript(src);

  const read = async (theme) => js(`(() => {
    document.documentElement.setAttribute("data-theme", ${JSON.stringify(theme)});
    document.documentElement.setAttribute("data-mode", ${JSON.stringify(theme)});
    document.body.toggleAttribute("data-ds-dark-theme", ${JSON.stringify(theme)} === "dark");
    const cs = getComputedStyle(document.documentElement);
    const probe = getComputedStyle(document.body);
    // 读法要按令牌的**类型**选探针属性：颜色读 backgroundColor、长度读 width。
    // 全用 color 会把长度/未定义令牌读成继承色（第一版探针就错在这）。
    const probeColor = (name) => { const el = document.createElement("div"); el.style.backgroundColor = "var(" + name + ")"; document.body.appendChild(el); const v = getComputedStyle(el).backgroundColor; el.remove(); return v; };
    const probeLen = (name) => { const el = document.createElement("div"); el.style.width = "var(" + name + ")"; document.body.appendChild(el); const v = getComputedStyle(el).width; el.remove(); return v; };
    const triplet = (name) => { const el = document.createElement("span"); el.style.color = "hsl(var(" + name + "))"; document.body.appendChild(el); const v = getComputedStyle(el).color; el.remove(); return v; };
    const out = { theme: ${JSON.stringify(theme)}, tokens: {}, triplets: {} };
    for (const name of ["--surface-0","--surface-1","--surface-2","--surface-3","--clay","--fill-accent","--bg-accent","--chart-muted","--chart-axis"]) out.tokens[name] = probeColor(name);
    for (const name of ["--radius","--h-control"]) out.tokens[name] = probeLen(name);
    for (const name of ["--bg-000","--bg-100","--bg-200","--bg-300","--bg-elevated","--text-000","--text-200","--text-400","--accent-brand","--accent-control","--chart-muted-hsl"]) out.triplets[name] = triplet(name);
    // 关键：量**真实画出来的颜色**，不只是令牌。2026-10-28 踩过一次：
    // 令牌是对的，但后载入的皮肤 CSS 把元素底色覆盖成 #141413，判卷照样绿。
    const paint = (sel) => { const el = document.querySelector(sel); return el === null ? null : getComputedStyle(el).backgroundColor; };
    out.paint = {
      body: getComputedStyle(document.body).backgroundColor,
      sidebar: paint(".side"),
      composerCard: paint("[data-composer-card]"),
      codeBlock: paint(".md-code"),
    };
    out.probe = { bodyColor: probe.color, bodyBg: probe.backgroundColor };
    };
    const mk = (tag, cls, attrs) => { const el = document.createElement(tag); el.className = cls; for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v); return el; };
    const bubbleRow = mk("div", "row user", { "data-cds": "UserMessage" });
    const bubble = mk("span", "t", {}); bubble.textContent = "probe"; bubbleRow.appendChild(bubble);
    const asstRow = mk("div", "row assistant", { "data-cds": "AssistantMessage", "data-cds-reply-type": "true" });
    const asstBody = mk("span", "t", {}); const prose = mk("div", "md-body", { "data-cds": "Prose" });
    prose.textContent = "probe"; asstBody.appendChild(prose); asstRow.appendChild(asstBody);
    const skelGroup = mk("div", "side-skeleton", { "data-cds": "SkeletonGroup", "data-motion": "wave" });
    const skel = mk("div", "side-skeleton-row", { "data-cds": "Skeleton" }); skelGroup.appendChild(skel);
    const queue = mk("div", "queue-strip", { "data-cds": "ChatComposerQueuedMessages" });
    for (const el of [bubbleRow, asstRow, skelGroup, queue]) document.body.appendChild(el);
    out.geometry = {
      userBubble: geom('.row.user[data-cds="UserMessage"] .t'),
      assistantText: geom('.row.assistant[data-cds="AssistantMessage"] .t'),
      assistantProse: geom('.row.assistant[data-cds="AssistantMessage"] .md-body'),
      skeleton: geom('.side-skeleton[data-cds="SkeletonGroup"] .side-skeleton-row[data-cds="Skeleton"]'),
      queueStrip: geom('.queue-strip[data-cds="ChatComposerQueuedMessages"]'),
      titlebarGround: (() => { const el = document.querySelector('.titlebar'); if (el === null) return null; const cs = getComputedStyle(el, "::before"); return { backgroundColor: cs.backgroundColor, backdropFilter: cs.backdropFilter }; })(),
      realUserBubble: geom('.row.user .t'),
    };
    for (const el of [bubbleRow, asstRow, skelGroup, queue]) el.remove();
    return out;
  })()`);

  // 官方薄是否真的进了产物：不数 styleSheets（file:// 下 cssRules 可能被拒），
  // 而是读一枚**只有官方薄有、Cairn 自己不曾定义**的令牌（--surface-0 的别名链 --gray-20）。
  const officialsPresent = await js(`(() => {
    const el = document.createElement("div");
    el.style.backgroundColor = "var(--gray-20)";
    document.body.appendChild(el);
    const gray20 = getComputedStyle(el).backgroundColor;
    el.style.backgroundColor = "var(--gray-900)";
    const gray900 = getComputedStyle(el).backgroundColor;
    el.remove();
    return { gray20, gray900 };
  })()`);
  const rendered = await js(`document.querySelector(".side") !== null && document.querySelector("[data-composer-card]") !== null`);
  const result = { appRendered: rendered, officialSheetLoaded: officialsPresent.gray20 === "rgb(249, 249, 247)" && officialsPresent.gray900 === "rgb(11, 11, 11)", officialsPresent, light: await read("light"), dark: await read("dark"), errors };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ out, errors: errors.length }));
  app.quit();
}
main().catch((e) => { console.error(e); app.exit(1); });
