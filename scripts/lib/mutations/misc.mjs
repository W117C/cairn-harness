// misc 域的变异配置条目（2026-10-17 从 scripts/mutate-verify.mjs 按域拆出，见 PROGRESS 第 501 页）。
// 每条 = 一处语义突变 + 期望被它杀死的具体用例标题。追加条目时放进对应域的文件；
// **组间顺序不影响任何判据**（每条独立），同一文件内保持原顺序以便 diff。
import { regexSource } from "./regex-source.mjs";

export const MUTATIONS = [
  {
    id: "ask-card-owner-not-scoped",
    src: "apps/desktop/src/renderer/send-queue.ts",
    test: "apps/desktop/tests/send-queue.test.ts",
    // 桌面层第一批锚点：renderer 此前在变异表里一条都没有（1556 条尽数落在 src/ 与 scripts/）。
    // 能进表是因为 runTest 现在按锚点自带的 config 跑（桌面是独立 vitest 配置）。
    config: "apps/desktop/vitest.config.ts",
    desc: "审批卡归属判定退回「来者不拒」（别人的卡画在自己头上——第 481 页修的那个串台面的渲染层半边）",
    apply: (s) => s.replace(
      '  if (sid === "") return true; // 未知 ⇒ 沿用旧行为，不猜也不吞\n  return sid === (activeId ?? "");',
      "  return true;",
    ),
    expectFail: "归属已知：只认本会话那张卡，别人的卡不上屏（此前是渲染最后到达的那张）",
  },
  {
    // 桌面层第二条锚点（第 485 页）：projections.ts 11 个导出函数、409 行、27 条用例，
    // 而变异表里桌面侧此前只有 send-queue 那一条 ⇒ 整份投影层是「有判据、无分辨力证据」。
    // 挑这一格是因为它**可以静默地丢**：思考桶在终稿到达时被 clear，若不同时把正文挂到
    // 终稿行上，「思考过程」就只在流式那几秒可见——功能还在、信息没了，没有任何门会红。
    id: "desktop-thinking-not-carried-onto-final",
    src: "apps/desktop/src/renderer/projections.ts",
    test: "apps/desktop/tests/projections.test.ts",
    config: "apps/desktop/vitest.config.ts",
    desc: "终稿到达时清掉思考桶却**不把正文挂到终稿行上** ⇒ 输出结束后思考过程消失（清空后不可见，等于没展示）",
    apply: (s) => s.replace(
      '        const carriedThinking = [...thinkingBuckets.values()].join("") || undefined;',
      "        const carriedThinking = undefined;",
    ),
    expectFail: "思考正文挂到终稿行上再清（否则只在流式那几秒可见，等于没展示）",
  },
  {
    // 桌面层第三条锚点（第 489 页）：kernel-host 的 workspace 白名单是**IPC 注入面**的闸——
    // renderer 可经 IPC 传任意路径建会话，无校验即凭空 mkdir <注入路径>/.agent/sessions。
    // 挑它是因为「闸失效」与「闸不存在」在功能上长得一样：正常路径两种实现都建得出会话，
    // 只有传入未注册路径时才分得开。桌面 17 个判卷文件里此前只有 2 个有锚点。
    id: "desktop-create-session-workspace-whitelist-dropped",
    src: "apps/desktop/src/main/kernel-host.ts",
    test: "apps/desktop/tests/kernel-host.test.ts",
    config: "apps/desktop/vitest.config.ts",
    desc: "createSession 不再校验 workspace ∈ workspaces ⇒ renderer 可指任意路径，"
      + "会话目录被凭空 mkdir（IPC 任意路径注入面；正常路径两种实现都建得出会话，只有注入路径分得开）",
    apply: (s) => s.replace(
      "      if (!workspaces.includes(ws)) {\n        throw new Error(`workspace 不在 workspaces 里: ${ws}`);\n      }",
      "      // 变异：白名单校验整段摘掉",
    ),
    expectFail: "createSession：未注册 workspace 被拒（fail-visible，堵 IPC 任意路径注入面）",
  },
  {
    // 桌面层第四条锚点（第 490 页）：协议版本握手。这道闸坏掉的形状很隐蔽——
    // 把 `live !== __IPC_PROTOCOL_VERSION__` 写成 `===`，**功能看着还在**（挂载照旧、查询照旧、
    // 文案照旧），只有版本真失配时才分得开，而那时失配的渲染层会带着旧契约继续跑。
    // 桌面 17 个判卷文件里此前只有 3 个有锚点。
    id: "desktop-protocol-mismatch-gate-inverted",
    src: "apps/desktop/src/renderer/App.tsx",
    test: "apps/desktop/tests/protocol-version.test.ts",
    config: "apps/desktop/vitest.config.ts",
    desc: "版本失配的判据反过来（!== 写成 ===）⇒ 失配的渲染层照旧挂载，带着旧 IPC 契约继续调主进程；"
      + "功能面看不出任何异常（查询照旧、文案照旧），只有版本真失配那一趟才分得开",
    apply: (s) => s.replace(
      "        if (live !== __IPC_PROTOCOL_VERSION__) {",
      "        if (live === __IPC_PROTOCOL_VERSION__) {",
    ),
    expectFail: "renderer 闸在：挂载比对实况版本，失配/查询失败 fail-closed 早退",
  },
  {
    id: "g-b-injection-face-ignores-table-form",
    src: "tests/tool-surface-parity.test.ts",
    test: "tests/tool-surface-parity.test.ts",
    desc: "实例面解析器退回只认一形 ⇒ 走 table 下标注入的工具整个从分母消失，而这道门照常绿（本轮抓到的就是这个）",
    apply: (s) => s.replace(
      regexSource('^\\s*table\\["([a-z_][a-z0-9_]*)"\\]\\s*=', "gm"),
      regexSource('^\\s*NEVER\\["([a-z_][a-z0-9_]*)"\\]\\s*=', "gm"),
    ),
    expectFail: "扩形后的分母自证：table[\"name\"] = 那一形确实被算进来了（解析器静默 0 命中比不扩更坏）",
  },

  /* ── 第 287 页：spawn 单价的杠杆——真仓那一次扫（本机实测 8.9s）从 describe 体搬进 beforeAll。
   *    这一条的 `src` 就是判卷自己：钉的是「收集期不许扫真仓」这个形状——形状回去后 81 条用例照样全绿、
   *    没有任何断言为此喊，但表里 26 条锚点的每条 spawn 都要重新付那 8.9s。 ── */
  {
    id: "prose-scan-real-repo-scan-back-at-collection-time",
    src: "tests/prose-needle-scan.test.ts",
    test: "tests/prose-needle-scan.test.ts",
    desc: "把这一次真仓扫从 `beforeAll` 搬回 describe 体 ⇒ 判卷照旧全绿，差别只在 vitest 打印的 `import` 那一格：" +
      "「-t 只选中合成面那条」也要付整趟扫（本机实测 9.54s→0.644s）。能挡它的只有形状，秒数本身写成断言就是抖动",
    apply: (s) => s.replace(
      "  let r: ScanReport;\n  beforeAll(() => {\n    r = scanRepo(root);\n  }, HOOK_BUDGET_MS);",
      "  const r = scanRepo(root);"
    ),
    expectFail: "收集期不再扫真仓：那种写法恰好一条",
  },
  {
    id: "prose-scan-heavy-hook-left-on-default-timeout",
    src: "tests/prose-needle-scan.test.ts",
    test: "tests/prose-needle-scan.test.ts",
    desc: "把真仓那支 `beforeAll` 的显式时限摘掉（回到第 287 页落下来的形状）⇒ 钩子改吃 vitest 缺省 10s，而 `scanRepo(真仓)` 冷缓存实测 8.9～9.5s：" +
      "空闲刚好过、隔壁起一套判卷就炸（`e42b4af` 那趟认证就是这条：`Error: Hook timed out in 10000ms.`）。判卷两条各红一次：声明数 2→1、旧形状 0→1",
    apply: (s) => s.replace(
      "  beforeAll(() => {\n    r = scanRepo(root);\n  }, HOOK_BUDGET_MS);",
      "  beforeAll(() => {\n    r = scanRepo(root);\n  });"
    ),
    expectFail: "两支重钩子都声明了预算（第 291 页：钩子吃缺省 10s，而冷扫实测 8.9～9.5s）",
  },
  // ---- 2026-10-05：R2 的「一致性判据」随判卷同笔配的锚点 ----
  {
    id: "engines-floor-below-feature-requirement",
    src: "package.json",
    test: "tests/engines-consistency.test.ts",
    desc: "engines.node 的下限调回低于 import.meta.dirname 的要求（20.11）⇒ 在**声明支持**的区间上"
      + "取 `.dirname` 会得 undefined 并当场 TypeError。评审 §2.3 R2 的原形状（当时 `>=20.3.0`）",
    apply: (s) => s.replace('"node": ">=20.11.0 <25"', '"node": ">=20.3.0 <25"'),
    expectFail: "真仓：下限覆盖全部已用特性（缺口为 0）",
  },
];
