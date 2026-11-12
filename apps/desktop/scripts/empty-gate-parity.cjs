// 空态与 GateSlot 三卡 · 离屏几何自证（2026-11-08 第 1048 页）
//
// 与 design-audit.cjs 分工：那条拍全量目的地页做视觉体检（软模式），这条只量两件事的**几何**：
//  ① 空态：hero / 输入卡 / 起手行 / 留白带是否同一列宽，下半屏留白占多少；
//  ② 门卡：审批 / 澄清 / 方案三段骨架（head/evidence/actions）是否真的同一副几何，
//     以及卡片出现时 `.reading` 的 scrollTop 会不会被顶走（不覆盖正在读的正文）。
// computed 样式全绿不等于视觉落地（第 1044 页教训），所以这里量 rect + 截图。
//
// 用法：cd apps/desktop && THEME=dark|light env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron \
//         scripts/empty-gate-parity.cjs ../../outputs/empty-gate-2026-11-08/<theme>
const { app, BrowserWindow, nativeTheme } = require("electron");
const { scheduleProfileCleanup } = require("./lib/profile-cleanup.cjs");
if (!app || typeof app.whenReady !== "function") {
  console.error("[empty-gate-parity] 需要 Electron app；请用 env -u ELECTRON_RUN_AS_NODE electron ...");
  process.exit(2);
}
const { mkdirSync, mkdtempSync, readFileSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");

const SCRIPTS = __dirname;
const ROOT = resolve(SCRIPTS, "..");
const THEME = process.env.THEME === "light" ? "light" : "dark";
const OUT = process.argv[2] ? resolve(process.argv[2]) : resolve(ROOT, "outputs", `empty-gate-${THEME}`);
mkdirSync(OUT, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), "cairn-empty-gate-"));
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
  // 本脚本只量空态与门卡的几何，不进设置向导；画廊桩的 onboarding 参数给空数组即可
  // （preload 侧是 JSON.parse，缺组不影响这两个面）。避免为一段用不上的常量做源码求值。
  const groups = [];

  const win = new BrowserWindow({
    width: 1440, height: 900, show: false,
    webPreferences: {
      backgroundThrottling: false, offscreen: true,
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
  const pageErrors = [];
  win.webContents.on("console-message", (_e, level, msg) => { if (level === 3) pageErrors.push(msg); });

  await win.loadFile(resolve(ROOT, "dist", "index.html"));
  await pause(900);
  await js(`(() => { const el = document.documentElement;
    el.dataset.theme = ${JSON.stringify(THEME)}; el.dataset.mode = ${JSON.stringify(THEME)};
    document.body.toggleAttribute("data-ds-dark-theme", ${JSON.stringify(THEME)} === "dark"); return true; })()`);
  await pause(400);

  const shot = async (name) => {
    await pause(260);
    writeFileSync(join(OUT, name + "-" + THEME + ".png"), (await win.webContents.capturePage()).toPNG());
  };
  const rect = (sel) => js(`(() => { const e = document.querySelector(${JSON.stringify(sel)});
    if (!e) return null; const r = e.getBoundingClientRect();
    return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1), bottom: +r.bottom.toFixed(1) }; })()`);
  const push = (event) => js(`window.__cairnPushEvent(${JSON.stringify({ ...event, session_id: "s1", ts: Date.now() })})`);
  const scrollTop = () => js(`(+document.querySelector('.reading')?.scrollTop) || 0`);

  // ── ① 空态：同一阅读列 + 下半屏留白 ──────────────────────────────
  const vh = await js("window.innerHeight");
  const empty = {
    greet: await rect(".empty-greet"),
    hero: await rect(".empty"),
    chipRow: await rect(".empty-chip-row"),
    composer: await rect(".composer-card"),
    starts: await rect(".starts"),
    below: await rect(".empty-below"),
    tail: await rect(".empty-tail"),
    vh,
  };
  const emptyDetail = await js(`(() => {
    const g = (s) => { const e = document.querySelector(s); if (!e) return null;
      const c = getComputedStyle(e), r = e.getBoundingClientRect();
      return { x: +r.x.toFixed(1), w: +r.width.toFixed(1), ml: c.marginLeft, mr: c.marginRight,
        pl: c.paddingLeft, pr: c.paddingRight, maxW: c.maxWidth, box: c.boxSizing }; };
    const m = document.querySelector('.main');
    return { main: g('.main'), empty: g('.empty'), below: g('.empty-below'), zone: g('.zone-composer'),
      card: g('.composer-card'), starts: g('.starts'),
      colMax: m ? getComputedStyle(m).getPropertyValue('--col-max') : null,
      readingPad: m ? getComputedStyle(m).getPropertyValue('--reading-pad-x') : null };
  })()`);
  await shot("01-empty-home");
  // 列宽单源（第 1041 页）：比的是**内容**左缘，不是容器左缘——三个容器都带 41px
  // --reading-pad-x，拿容器 x 比内容 x 会凭空多出一个 padding（第 1045 页同类假阳性）。
  const edges = [empty.greet, empty.starts, empty.composer].filter(Boolean).map((r) => r.x);
  const edgeSpread = edges.length === 3 ? Math.max(...edges) - Math.min(...edges) : 999;
  check("空态：hero 文案 / 起手行 / 输入卡同一阅读列（内容左缘）", edgeSpread <= 2, { edges, edgeSpread });
  // 下半屏留白：起手行底 → 视口底，占全屏比；太大 = issues.md #1 的「下方大片留白」仍在
  const tailShare = empty.starts ? +(((vh - empty.starts.bottom) / vh) * 100).toFixed(1) : 999;
  check("空态：下半屏留白占比记录在案（不硬判，供本批决策）", true, { tailShare, tailH: empty.tail?.h ?? null });

  // ── 第 1048 页：下半屏「最近会话」承接行的真机几何 ────────────────
  const ctx = await rect(".empty-context");
  const ctxPad = ctx === null ? null : await js(`parseFloat(getComputedStyle(document.querySelector('.empty-context')).paddingLeft)`);
  const ctxItems = await js(`[...document.querySelectorAll('.empty-context-item')].map(e => {
    const r = e.getBoundingClientRect();
    return { h: +r.height.toFixed(1), label: (e.textContent || '').trim() };
  })`);
  if (ctx === null) {
    // 画廊桩若没有真实会话，承接行整块不渲染才是正确行为（不放假数据）
    check("下半屏承接：无真实会话时整块不渲染（不放假数据）", true, { ctx: null });
  } else {
    check("下半屏承接：坐在起手行下方、不超出视口", ctx.y >= empty.starts.bottom - 2 && ctx.bottom <= vh,
      { y: ctx.y, bottom: ctx.bottom, startsBottom: empty.starts.bottom, vh });
    check("下半屏承接：最多 3 条、每条命中区 ≥24px", ctxItems.length <= 3 && ctxItems.every((i) => i.h >= 24),
      { count: ctxItems.length, heights: ctxItems.map((i) => i.h), labels: ctxItems.map((i) => i.label) });
    check("下半屏承接：与输入卡同一阅读列（--col-max 单源）", Math.abs(ctx.x + ctxPad - empty.composer.x) <= 2,
      { ctxX: ctx.x, pad: ctxPad, contentX: +(ctx.x + ctxPad).toFixed(1), composerX: empty.composer.x });
  }

  // ── ② 三卡：按优先级 plan → clarify → ask 依次盖上来 ──────────────
  await js(`(() => { const e = document.querySelector('.session'); if (e) e.click(); return true; })()`);
  await pause(500);
  const readCard = async () => ({
    card: await rect(".zone-gate .card"),
    head: await rect(".zone-gate .card-head"),
    evidence: await rect(".zone-gate .card-evidence"),
    actions: await rect(".zone-gate .card-actions"),
    gate: await rect(".zone-gate"),
    status: await js(`document.querySelector('.zone-gate .card')?.getAttribute('data-status') ?? null`),
    gateAttr: await js(`document.querySelector('.zone-gate .card')?.getAttribute('data-gate') ?? null`),
  });
  const beforeScroll = await scrollTop();
  const pushPlan = { type: "plan_proposed", callId: "parity-plan", plan: {
    goal: "整理设置页分区层级", files: [{ path: "SettingsPanel.tsx", action: "edit", summary: "收紧导航密度" }],
    approach: "先量现状，再做最小改动", verify: { test: ["pnpm test"] } } };
  await push(pushPlan);
  await pause(500);
  const plan = await readCard();
  await shot("02-plan-card");
  const afterPlanScroll = await scrollTop();

  await push({ type: "clarify_requested", callId: "parity-clarify", questions: [
    { question: "这份报告要覆盖哪些模块？", header: "范围", options: [{ label: "核心模块" }, { label: "全部模块" }] } ] });
  await pause(500);
  const clarify = await readCard();
  await shot("03-clarify-card");

  await js(`window.__cairnPushAsk(${JSON.stringify({ askId: "parity-ask", sessionId: "s1", tool: "run_shell",
    args: { command: "pnpm test" }, reason: "默认档逐次审批", risk: "high", riskReasons: ["工作区内命令执行"] })})`);
  await pause(500);
  const approval = await readCard();
  await shot("04-approval-card");
  const afterAllScroll = await scrollTop();

  const cards = { plan, clarify, approval };
  for (const [name, c] of Object.entries(cards)) {
    check(`门卡 ${name} 三段骨架齐备`, Boolean(c.card && c.head && c.evidence && c.actions), {
      h: c.card?.h ?? null, head: c.head?.h ?? null, evidence: c.evidence?.h ?? null, actions: c.actions?.h ?? null,
      gate: c.gateAttr ?? c.status ?? null,
    });
  }
  // 骨架统一：head 与 actions 是高固定的两段；evidence 随内容变（不该拿它比）
  const headHeights = Object.values(cards).map((c) => c.head?.h).filter((h) => typeof h === "number");
  const actionHeights = Object.values(cards).map((c) => c.actions?.h).filter((h) => typeof h === "number");
  const spread = (xs) => (xs.length === 3 ? +(Math.max(...xs) - Math.min(...xs)).toFixed(1) : 999);
  check("三卡共用骨架：head 高度一致", spread(headHeights) <= 2, { headHeights, spread: spread(headHeights) });
  check("三卡共用骨架：actions 高度一致", spread(actionHeights) <= 2, { actionHeights, spread: spread(actionHeights) });
  // 卡片不顶走正文（第 1042 页裁决：scrollTop 不变）
  check("门卡出现不顶走正在读的正文（scrollTop 不变）", beforeScroll === afterPlanScroll && beforeScroll === afterAllScroll,
    { beforeScroll, afterPlanScroll, afterAllScroll });
  // 卡片高度封顶并自滚（.zone-gate > * 的 max-height），不能撑满整屏
  const maxCardH = Math.max(...Object.values(cards).map((c) => c.card?.h ?? 0));
  check("门卡高度封顶不撑满视口", maxCardH < vh * 0.7, { maxCardH, limit: +(vh * 0.7).toFixed(1) });
  check("console 无错误", pageErrors.length === 0, { pageErrors });

  writeFileSync(join(OUT, "checks.json"), JSON.stringify({ theme: THEME, checks, hardFailures, empty, emptyDetail, cards, pageErrors }, null, 2));
  console.log(`[empty-gate-parity] ${String(checks.filter((c) => c.ok).length)}/${String(checks.length)} PASS｜硬失败 ${String(hardFailures.length)}｜${OUT}`);
  await win.destroy();
  app.quit(hardFailures.length > 0 ? 1 : 0);
}

main().catch((e) => { console.error("[empty-gate-parity] 崩了", e); app.quit(3); });
