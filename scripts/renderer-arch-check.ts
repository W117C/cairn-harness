// renderer-arch-check —— 渲染层**结构**门禁（对运行中的应用断言，不是对源码文本 grep）。
//
// 存在的理由（S-1 事故）：静态标记里多了两个 </div>，容器提前闭合，.composer 与
// aside.drawer 被挤出 .app 成为 <body> 直接子节点；默认窗口 1280×832 下输入框与右板
// 完全落在首屏之外。当时 26 道门全绿，没有一道发现——因为没有任何一道门**在真实 DOM 上**
// 断言容器归属。本门补的就是这一格。
//
// 口径：在**运行中的应用**里取 DOM 快照（默认 = 构建产物 out/renderer + headless Chrome；
// --electron = 真实交付壳），逐条打印 ✅/❌，任一失败退出码 1。
//
// 驱动取舍（裁决 1，2026-09-17）：**默认 `--static out/renderer`**，不走 Electron。
// 本宿主 Electron 交付壳根本起不来——`import { BrowserWindow } from "electron"` 在本宿主
// ESM loader 下解析到 npm wrapper 而失败（`Electron --version` 打印 Node v24.20.0 而非
// 44.2.0），已归档于 BLOCKED.md:432。断言集在两支下**完全相同**，只有启动机制不同；
// 而构建产物正是**发货物**（S-1 缺陷当初就是在这个对象上抓到的）。让默认路径永久红
// 只会训练人忽略门禁。Electron 路径**保留**为显式 opt-in，供能起 Electron 的宿主 / CI 用。
// 刻意不做「先试 Electron、超时再降级」的自动探测：白加约 25s 等待且降级时机不确定。
//
// 用法：
//   pnpm renderer-arch-check                              （默认：构建产物 out/renderer）
//   pnpm renderer-arch-check -- --static /tmp/dsh-s1neg   （反向对照：必须判红）
//   pnpm renderer-arch-check -- --electron                （显式走真实交付壳）
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Cdp,
  cdpUp,
  diagnoseBoot,
  launchChromeCdp,
  launchElectronCdp,
  makeReporter,
  parseArgs,
  printTarget,
  serveStatic,
  seedSettingsFor,
  sleep,
  tryWait,
  type Launched,
  type StaticServer,
} from "./lib/harness";

/** 视口矩阵：默认窗口 1280×832 + 三档跨断点视口。
 *  DT-03（2026-09-19）扩表理由：原表只有 1280 与 1000。1280 **恰好落在** `max-width:1279`
 *  的边界外侧（1279 < 1280），而 1000 落在 `max-width:1023` 内侧——两个视口都测不到
 *  「1024–1279 这一档」的右栏浮层路径，而那道路径正是当时无人写过 `.open-m` 的地方。
 *  1152 补上这一格；1600 覆盖 `min-width:1600` 宽屏档。 */
const VIEWPORTS: { w: number; h: number }[] = [
  { w: 1600, h: 900 },
  { w: 1280, h: 832 },
  { w: 1152, h: 800 },
  { w: 1000, h: 832 },
];

/** 面板可达性探针（DT-03）：只点开关键、只读几何，不写业务状态。
 *  判据是**几何**而不是 DOM 归属：缺陷当初正是「DOM 父级全对、元素却在视口外」。
 *  测量前先挂 `html.reduce-motion`（应用自带的"关闭全部动画/过渡"开关）并强制同步重排——
 *  面板显隐走的是 transform 过渡，点完立刻量只会读到过渡的起始值（= 永远"不可见"），
 *  那是探针自己的假阴性，不是产品缺陷。这里量的是终态，与动效无关。 */
const PROBE = `(() => {
  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), right: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height) };
  };
  // 可见 = 宽高有实体且在水平方向与视口有实质交集（留 8px 容差，避免刚好贴边算可见）
  const vis = (el) => {
    const r = rect(el);
    if (!r) return false;
    if (r.w < 8 || r.h < 8) return false;
    return r.right > 8 && r.x < window.innerWidth - 8;
  };
  const settle = () => {
    document.documentElement.classList.add('reduce-motion');
    void document.documentElement.offsetWidth;   // 强制同步重排，拿到过渡后的终态
  };
  const drawer = document.querySelector('aside.drawer');
  const sidebar = document.querySelector('aside.sidebar');
  const dt = document.querySelector('#drawerToggle');
  const st = document.querySelector('#sidebarToggle');
  settle();
  const out = {
    vw: window.innerWidth,
    drawerRect: rect(drawer),
    sidebarRect: rect(sidebar),
    drawerVis: vis(drawer),
    sidebarVis: vis(sidebar),
    drawerToggleName: dt ? String(dt.getAttribute('aria-label') || '') : 'absent',
    sidebarToggleName: st ? String(st.getAttribute('aria-label') || '') : 'absent',
  };
  // 不可见就点一次开关键；点完仍不可见 = 该面板在本视口无任何可达路径
  if (!out.drawerVis && dt) { dt.click(); settle(); out.drawerVisAfterToggle = vis(drawer); out.drawerRect = rect(drawer); }
  else out.drawerVisAfterToggle = out.drawerVis;
  if (!out.sidebarVis && st) { st.click(); settle(); out.sidebarVisAfterToggle = vis(sidebar); out.sidebarRect = rect(sidebar); }
  else out.sidebarVisAfterToggle = out.sidebarVis;
  out.drawerPressed = dt ? String(dt.getAttribute('aria-pressed')) : 'absent';
  out.sidebarPressed = st ? String(st.getAttribute('aria-pressed')) : 'absent';
  const inner = document.querySelector('.stream-inner');
  out.streamInnerW = inner ? Math.round(inner.getBoundingClientRect().width) : -1;
  return out;
})()`;

interface ProbeResult {
  vw: number;
  drawerRect: { x: number; right: number; w: number; h: number } | null;
  sidebarRect: { x: number; right: number; w: number; h: number } | null;
  drawerVis: boolean;
  sidebarVis: boolean;
  drawerVisAfterToggle: boolean;
  sidebarVisAfterToggle: boolean;
  drawerToggleName: string;
  sidebarToggleName: string;
  drawerPressed: string;
  sidebarPressed: string;
  streamInnerW: number;
}

/** 阅读行宽上限：`--content-max` 的四档封顶中最大为 1040，留 20px 容差。
 *  失控时（改前 ≤1279 档是 `--content-max:none`）中栏会被拉满，此断言即变红。 */
const MEASURE_MAX_PX = 1060;

/** 页面内取数脚本：只读 DOM，不改任何状态。返回结构化快照供 Node 侧判定。 */
const SNAPSHOT = `(() => {
  const label = (el) => el ? el.tagName.toLowerCase() + '.' + String(el.className || '').trim() : 'absent';
  const q = (s) => document.querySelector(s);
  const kids = (el) => el ? [...el.children].map(label) : [];
  const composer = q('.composer');
  const drawer = q('aside.drawer') || q('.drawer');
  const chat = q('main.chat') || q('.chat');
  const stream = q('.stream');
  const inner = q('.stream-inner');
  const FORBIDDEN = ['.composer', '.drawer', '.gutter'];
  const bodyKids = [...document.body.children];
  const forbiddenInBody = bodyKids
    .filter((el) => el.matches('.composer, .drawer, .gutter'))
    .map(label);
  const innerKids = kids(inner);
  const badInner = inner
    ? [...inner.children].filter((c) => !c.classList.contains('msg')).map(label)
    : ['absent'];
  const rect = (el) => {
    if (!el) return 'absent';
    const r = el.getBoundingClientRect();
    return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)].join(',');
  };
  const eventCount = q('#eventCount');
  return {
    viewport: window.innerWidth + 'x' + window.innerHeight,
    composerCount: document.querySelectorAll('.composer').length,
    composerLabel: label(composer),
    composerParentLabel: composer && composer.parentElement ? label(composer.parentElement) : 'absent',
    composerRect: rect(composer),
    drawerCount: document.querySelectorAll('aside.drawer').length,
    drawerLabel: label(drawer),
    drawerParentLabel: drawer && drawer.parentElement ? label(drawer.parentElement) : 'absent',
    drawerRect: rect(drawer),
    chatLabel: label(chat),
    chatKids: kids(chat),
    chatHasStream: chat ? chat.contains(stream) : false,
    chatDirectStream: chat ? [...chat.children].some((c) => c.classList.contains('stream')) : false,
    chatDirectComposer: chat ? [...chat.children].some((c) => c.classList.contains('composer')) : false,
    streamExists: !!stream,
    streamInChat: !!(stream && chat && chat.contains(stream)),
    streamParentLabel: stream && stream.parentElement ? label(stream.parentElement) : 'absent',
    streamInnerKids: innerKids,
    streamInnerBadKids: badInner,
    bodyChildCount: bodyKids.length,
    bodyKids: bodyKids.map(label),
    bodyForbidden: forbiddenInBody,
    fakeProbeCount: document.querySelectorAll(
      '[data-m1e-event-count],[data-m1e-item],[data-m1e-settings-open],[data-approval-badge],[data-virtuoso-scroller]'
    ).length,
    toolToggleCount: document.querySelectorAll('[data-tool-toggle]').length,
    msgActCount: document.querySelectorAll('[data-msg-act]').length,
    eventCountExists: !!eventCount,
    eventCountText: eventCount ? String(eventCount.textContent || '').trim() : 'absent',
    errors: (window.__archErrors || []).slice(0, 3),
  };
})()`;

/** 采集运行时错误（在任何页面脚本之前注入）。 */
const ERROR_HOOK = `
  window.__archErrors = [];
  window.addEventListener('error', (e) => {
    window.__archErrors.push('error: ' + (e.message || '') + ' @' + (e.filename || '') + ':' + (e.lineno || 0));
  }, true);
  window.addEventListener('unhandledrejection', (e) => {
    window.__archErrors.push('rejection: ' + String((e.reason && e.reason.message) || e.reason));
  });
`;

interface Snapshot {
  viewport: string;
  composerCount: number;
  composerLabel: string;
  composerParentLabel: string;
  composerRect: string;
  drawerCount: number;
  drawerLabel: string;
  drawerParentLabel: string;
  drawerRect: string;
  chatLabel: string;
  chatKids: string[];
  chatHasStream: boolean;
  chatDirectStream: boolean;
  chatDirectComposer: boolean;
  streamExists: boolean;
  streamInChat: boolean;
  streamParentLabel: string;
  streamInnerKids: string[];
  streamInnerBadKids: string[];
  bodyChildCount: number;
  bodyKids: string[];
  bodyForbidden: string[];
  fakeProbeCount: number;
  toolToggleCount: number;
  msgActCount: number;
  eventCountExists: boolean;
  eventCountText: string;
  errors: string[];
}

const reporter = makeReporter();
const args = parseArgs(process.argv.slice(2), 9411 + (process.pid % 400));
if (args.error !== null) {
  console.error("[renderer-arch-check] 参数错误：" + args.error);
  process.exit(2);
}
const staticMode = args.staticDir !== null;

// 用对象持有句柄：`let` 变量的赋值发生在 boot() 闭包内，TS 的控制流分析看不到，
// 顶层会被收窄成 null → finally 里访问属性报 never。
const ctx: { launched: Launched | null; server: StaticServer | null; profileDir: string | null } = {
  launched: null,
  server: null,
  profileDir: null,
};

/** 起被测应用并连上 CDP；起不来返回 null（调用方按 fail-visible 判红）。 */
async function boot(): Promise<Cdp | null> {
  if (staticMode) {
    const dir = args.staticDir as string;
    ctx.profileDir = await mkdtemp(join(tmpdir(), "arch-chrome-"));
    ctx.server = await serveStatic(dir, Number(process.env.PROBE_HTTP_PORT ?? args.port + 1));
    ctx.launched = launchChromeCdp({ port: args.port, profileDir: ctx.profileDir });
  } else {
    // Electron 模式也要隔离 settings：原先不传 = 读用户自己的 userData/settings.json，
    // 而 §13 首启浮层一弹就会盖住每一次点击（profileDir 由本门收尾时删）。
    ctx.profileDir = await mkdtemp(join(tmpdir(), "arch-settings-"));
    ctx.launched = launchElectronCdp({ port: args.port, env: { M1E_SETTINGS_PATH: await seedSettingsFor(ctx.profileDir) } });
  }
  if (!(await cdpUp(args.port))) {
    const tail = (ctx.launched?.output() ?? "").trim().split("\n").slice(-8);
    console.log("    诊断（进程输出尾 8 行）：");
    for (const l of tail) console.log("      " + l);
    const hint = diagnoseBoot(tail.join("\n"));
    if (hint !== null) console.log("    ⚠️  归因：" + hint);
    return null;
  }
  const cdp = new Cdp();
  await cdp.connect(args.port);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: ERROR_HOOK });
  if (staticMode && ctx.server !== null) {
    await cdp.send("Page.navigate", { url: ctx.server.url + args.htmlPath });
  }
  // 就绪口径：DOM 完成 + 静态标记可用（.composer 是静态标记，不依赖 JS 起没起来）。
  await tryWait(async () => {
    const ready = await cdp.eval<boolean>("document.readyState === 'complete' && !!document.querySelector('body')");
    return ready ? true : null;
  }, 20_000);
  await sleep(700);
  return cdp;
}

function assertViewport(s: Snapshot): void {
  console.log("[renderer-arch-check] 视口 " + s.viewport);

  // 1. .composer 存在且挂在 main.chat 下
  reporter.ok(s.composerCount === 1, "`.composer` 恰好 1 个（实际 " + String(s.composerCount) + "）");
  reporter.ok(
    s.composerParentLabel === "main.chat",
    "`.composer` 的 parentElement = main.chat（实际 " + s.composerParentLabel + "）",
  );

  // 2. aside.drawer 存在且挂在 div.shell 下
  reporter.ok(s.drawerCount === 1, "`aside.drawer` 恰好 1 个（实际 " + String(s.drawerCount) + "）");
  reporter.ok(
    s.drawerParentLabel === "div.shell",
    "`aside.drawer` 的 parentElement = div.shell（实际 " + s.drawerParentLabel + "）",
  );

  // 3. main.chat 的直接子元素同时含 div.stream 与 div.composer
  const chatLabel = s.chatLabel === "absent" ? "main.chat" : s.chatLabel;
  reporter.ok(s.chatDirectStream, chatLabel + " 直接子元素含 div.stream（实际子元素：" + s.chatKids.join(" ") + "）");
  reporter.ok(s.chatDirectComposer, chatLabel + " 直接子元素含 div.composer（实际子元素：" + s.chatKids.join(" ") + "）");

  // 4. .stream-inner 直接子元素全部是 .msg
  const innerOk = s.streamInnerBadKids.length === 0;
  reporter.ok(
    innerOk,
    "`.stream-inner` 直接子元素全部是 .msg（实际 " + String(s.streamInnerKids.length) + " 个；越界：" + s.streamInnerBadKids.join(" ") + "）",
  );

  // 5. body 直接子元素 ≤ 6 且不含 .composer / .drawer / .gutter
  reporter.ok(
    s.bodyChildCount <= 6,
    "document.body 直接子元素数 " + String(s.bodyChildCount) + " ≤ 6（实际：" + s.bodyKids.join(" ") + "）",
  );
  reporter.ok(
    s.bodyForbidden.length === 0,
    "document.body 直接子元素不含 .composer/.drawer/.gutter（实际越界：" + s.bodyForbidden.join(" ") + "）",
  );

  // 6. .stream 存在且在 main.chat 内（滚动容器）
  reporter.ok(s.streamExists, "`.stream` 存在（滚动容器）");
  reporter.ok(s.streamInChat, "`.stream` 在 main.chat 内（实际 parent = " + s.streamParentLabel + "）");

  // 7. 无伪造探针（旧 React/Virtuoso 时代的钩子一个都不许残留）
  reporter.ok(
    s.fakeProbeCount === 0,
    "无伪造探针：data-m1e-* / data-approval-badge / data-virtuoso-scroller 命中 0（实际 " + String(s.fakeProbeCount) + "）",
  );

  // 8. 冻结钩子运行时普查（打印实际数字；只对下界断言，不硬编码脆弱精确值）
  console.log(
    "     ℹ️  钩子普查： [data-tool-toggle]=" + String(s.toolToggleCount) + "  [data-msg-act]=" + String(s.msgActCount),
  );
  reporter.ok(s.toolToggleCount >= 1, "[data-tool-toggle] ≥ 1（实际 " + String(s.toolToggleCount) + "）");

  // 9. 底栏事件计数（另一 worker 并行添加；缺失即判红，这正是正确行为）
  reporter.ok(
    s.eventCountExists,
    "#eventCount 存在（底栏事件计数；实际 " + (s.eventCountExists ? "text=" + s.eventCountText : "缺失") + "）",
  );

  // 附：位置信息（诊断用，不参与判定）
  console.log("     ℹ️  .composer rect=" + s.composerRect + "  aside.drawer rect=" + s.drawerRect);
  if (s.errors.length > 0) console.log("     ℹ️  页面运行时错误：" + s.errors.join(" | "));
  console.log("");
}

/** 面板可达性断言（DT-03）：结构对 ≠ 用户点得到。
 *  改前 1024–1279 右栏、≤1023 左栏因 CSS 侧 `.open-m`/`.open` 无人写入而永久停在
 *  translateX(±100%)，DOM 父子关系却全部正确——本组断言补的就是这一格。 */
function assertReachability(p: ProbeResult): void {
  console.log("[renderer-arch-check] 可达性 " + String(p.vw) + "×（探针实测）");

  const dRect = p.drawerRect ? p.drawerRect.x + "…" + p.drawerRect.right + " w=" + p.drawerRect.w : "absent";
  const sRect = p.sidebarRect ? p.sidebarRect.x + "…" + p.sidebarRect.right + " w=" + p.sidebarRect.w : "absent";

  reporter.ok(
    p.drawerVisAfterToggle,
    "右栏可达：静息" + (p.drawerVis ? "可见" : "不可见") + " → 点开关键后可见（rect " + dRect + "，视口宽 " + p.vw + "）",
  );
  reporter.ok(
    p.sidebarVisAfterToggle,
    "左栏可达：静息" + (p.sidebarVis ? "可见" : "不可见") + " → 点开关键后可见（rect " + sRect + "，视口宽 " + p.vw + "）",
  );

  // 开关键不得「谎报」：aria-pressed=true 必须对应面板真在视口内，反之亦然。
  const drawerLie = p.drawerPressed === "true" && !p.drawerVisAfterToggle;
  const sidebarLie = p.sidebarPressed === "true" && !p.sidebarVisAfterToggle;
  reporter.ok(!drawerLie, "右栏开关键状态与实际可见性一致（aria-pressed=" + p.drawerPressed + "）");
  reporter.ok(!sidebarLie, "左栏开关键状态与实际可见性一致（aria-pressed=" + p.sidebarPressed + "）");

  reporter.ok(
    p.drawerToggleName !== "absent" && p.drawerToggleName.length > 0,
    "右栏开关键有可访问名（实际「" + p.drawerToggleName + "」）",
  );
  reporter.ok(
    p.sidebarToggleName !== "absent" && p.sidebarToggleName.length > 0,
    "左栏开关键有可访问名（实际「" + p.sidebarToggleName + "」）",
  );

  reporter.ok(
    p.streamInnerW > 0 && p.streamInnerW <= MEASURE_MAX_PX,
    "中栏阅读行宽受 --content-max 约束 ≤ " + String(MEASURE_MAX_PX) + "（实际 " + String(p.streamInnerW) + "）",
  );
  console.log("");
}

console.log("[renderer-arch-check] 渲染层结构门禁");
printTarget(args);
try {
  const cdp = await boot();
  if (cdp === null) {
    // fail-visible：应用起不来 = 本门**未验证**，不得静默算绿
    reporter.fail(
      "应用起不来（CDP " + String(args.port) + " 不可达）→ 本门未验证；" +
        (staticMode ? "检查 --static 目录是否有 index.html + assets/" : "检查 Electron 能否在 --no-sandbox 下启动"),
    );
  } else {
    for (const v of VIEWPORTS) {
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: v.w,
        height: v.h,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await sleep(350);
      const snap = await cdp.eval<Snapshot>(SNAPSHOT);
      assertViewport(snap);
      /* 可达性探针会点开关键改变状态，故每条视口前重载页面，保证各档互不串味。 */
      if (staticMode && ctx.server !== null) {
        await cdp.send("Page.navigate", { url: ctx.server.url + args.htmlPath });
        await sleep(700);
      }
      const probe = await cdp.eval<ProbeResult>(PROBE);
      assertReachability(probe);
    }
    cdp.close();
  }
} catch (err) {
  reporter.fail("未预期异常（未验证）：" + (err instanceof Error ? err.message : String(err)));
} finally {
  if (ctx.launched !== null) await ctx.launched.kill();
  if (ctx.server !== null) await ctx.server.close();
  if (ctx.profileDir !== null) await rm(ctx.profileDir, { recursive: true, force: true }).catch(() => {});
}

console.log(
  "[renderer-arch-check] " + String(reporter.total - reporter.failures) + "/" + String(reporter.total) +
    " 通过" + (reporter.failures === 0 ? " ✅" : "，失败 " + String(reporter.failures) + " 项 ❌"),
);
process.exit(reporter.failures === 0 ? 0 : 1);
