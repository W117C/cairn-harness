// misc 域的变异配置条目（2026-10-17 从 scripts/mutate-verify.mjs 按域拆出，见 PROGRESS 第 501 页）。
// 每条 = 一处语义突变 + 期望被它杀死的具体用例标题。追加条目时放进对应域的文件；
// **组间顺序不影响任何判据**（每条独立），同一文件内保持原顺序以便 diff。
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
    id: "desktop-steer-route-ignores-running",
    src: "apps/desktop/src/renderer/send-queue.ts",
    test: "apps/desktop/tests/send-queue.test.ts",
    config: "apps/desktop/vitest.config.ts",
    desc: "分岔不看「是否运行中」⇒ 空闲时把「起新一轮」错当插话（消息会被送进一个不存在的 run，用户看到「已插话」而什么都没发生）",
    apply: (s) => s.replace('  if (!input.running) return "run";', "  // mutated"),
    expectFail: "★ 空闲 ⇒ run（不能把「起新一轮」错当插话）",
  },
  {
    id: "desktop-steer-route-ignores-forcequeue",
    src: "apps/desktop/src/renderer/send-queue.ts",
    test: "apps/desktop/tests/send-queue.test.ts",
    config: "apps/desktop/vitest.config.ts",
    desc: "分岔忽略 forceQueue ⇒ 「加入队列」钮点下去实际把话插进当前轮：按钮在说谎，而两种结局在界面上长得一样",
    apply: (s) => s.replace('  if (input.forceQueue) return "queue";', "  // mutated"),
    expectFail: "★ forceQueue（点「加入队列」钮）⇒ queue：按钮写着「加入队列」就必须真排队",
  },
  {
    id: "desktop-steer-accept-undefined-as-ok",
    src: "apps/desktop/src/renderer/send-queue.ts",
    test: "apps/desktop/tests/send-queue.test.ts",
    config: "apps/desktop/vitest.config.ts",
    desc: "把协议/桩兜底的 {} 读成成功 ⇒ 消息被吞：回执说「已插话到本轮」，而那一轮根本没收到（第 681 页桩兜底的同一形状）",
    apply: (s) => s.replace("  return res.ok === true;", "  return res.ok !== false;"),
    expectFail: "★ 应答判据：只认 ok === true；桩/协议兜底的 {} 读成 undefined = 吞消息",
  },
  {
    id: "desktop-steering-splits-turn",
    src: "apps/desktop/src/renderer/derived/stream.ts",
    test: "apps/desktop/tests/stream-steering-round.test.tsx",
    config: "apps/desktop/vitest.config.ts",
    desc: "轮中插话被当成新轮（projectStream 的 rounds += 1 不再跳过 steering）⇒ 同一轮被劈成两轮：轮号错位、上一轮气泡提前落定、按轮跳转全错",
    apply: (s) => s.replace('        const steering = e.origin?.kind === "steering";', '        const steering = false;'),
    expectFail: "★ 插话不推轮号：同一轮里的一条插话，round 仍是 1",
  },
    {
    id: "desktop-steering-badge-not-rendered",
    src: "apps/desktop/src/renderer/components/Stream.tsx",
    test: "apps/desktop/tests/stream-steering-round.test.tsx",
    config: "apps/desktop/vitest.config.ts",
    desc: "投影标了 steering:true 而组件不渲染徽标 ⇒ 用户看到的那句话与普通新任务一模一样（分不清「我补了一句」与「我又开了个任务」）",
    apply: (s) => s.replace('    {r.steering === true && <span className="ur-steer" title="这一轮进行中补的话（没开新任务）">插话</span>}', '    {/* mutated */}'),
    expectFail: "SSR：插话行带出「插话」徽标，普通用户行没有",
  },
{
    id: "desktop-steering-row-dropped",
    src: "apps/desktop/src/renderer/derived/stream.ts",
    test: "apps/desktop/tests/stream-steering-round.test.tsx",
    config: "apps/desktop/vitest.config.ts",
    desc: "插话那一行直接丢掉（不渲染）⇒ 用户说过的话在转录里消失，而模型那边确实收到了它：界面在说谎",
    apply: (s) => s.replace('        const steering = e.origin?.kind === "steering";', '        const steering = e.origin?.kind === "steering";\n        if (steering) break;'),
    expectFail: "★ 插话仍显示，且被标成插话（不是悄悄丢掉）",
  },
{
    // 桌面层第二条锚点（第 485 页）：projections.ts 11 个导出函数、409 行、27 条用例，
    // 而变异表里桌面侧此前只有 send-queue 那一条 ⇒ 整份投影层是「有判据、无分辨力证据」。
    // 挑这一格是因为它**可以静默地丢**：思考桶在终稿到达时被 clear，若不同时把正文挂到
    // 终稿行上，「思考过程」就只在流式那几秒可见——功能还在、信息没了，没有任何门会红。
    id: "desktop-thinking-not-carried-onto-final",
    // 2026-10-22：实现从 `projections.ts` 搬进 `derived/stream.ts`（App 拆分批）——
    // `projections.ts` 变成再导出桶，针脚跟着实现走（规则 217/255）。判卷侧仍走
    // `projections` 那个桶（用例没搬，钉的还是同一格行为）。
    src: "apps/desktop/src/renderer/derived/stream.ts",
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
    // 2026-10-22：闸从 `App.tsx` 搬进 `state/workbench.ts`（App 拆分批）⇒ 针脚改指新家。
    // 判卷侧 `apps/desktop/tests/protocol-version.test.ts` 走的是 `readAppSurface()`
    // （读整个渲染层面，不只一个文件）⇒ 搬走后它照样能看见这行，钉的还是同一格。
    src: "apps/desktop/src/renderer/state/workbench.ts",
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
    apply: (s) => s.replace('/^\\s*table\\["([a-z_][a-z0-9_]*)\"\\]\\s*=/gm', '/^\\s*NEVER\\["([a-z_][a-z0-9_]*)\"\\]\\s*=/gm'),
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
    id: "worktrees-dirty-badge-hidden",
    src: "apps/desktop/src/renderer/components/WorktreesPane.tsx",
    test: "apps/desktop/tests/app-page.test.tsx",
    config: "apps/desktop/vitest.config.ts",
    desc: "孤儿行的未提交改动标记恒假 ⇒ 清理前看不见自己会丢什么：确认框只有一句泛泛的「未提交改动无法恢复」，"
      + "而当前这棵树到底是干净还是攒着活，界面一个字不说（数据丢失面的信息缺口）",
    apply: (s) => s.replace("const dirty = props.snap.details?.find((d) => d.name === name)?.dirty === true;", "const dirty = false;"),
    expectFail: "工作树页：孤儿逐条列出 + 清理按钮；空态不摆假列表",
  },
  {
    id: "license-label-always-inactive",
    src: "apps/desktop/src/renderer/components/settings-sections.tsx",
    test: "apps/desktop/tests/settings-sections.test.tsx",
    config: "apps/desktop/vitest.config.ts",
    desc: "许可证有效也显示「未激活」⇒ 用户以为自己的 license 没生效，而主进程其实验过了；"
      + "四态被压成一态，设置页的「许可证」行就成了装饰",
    apply: (s) => s.replace(
      'case "valid": return state.expiresAt === null ? "有效 · " + state.licensee : "有效 · " + state.licensee + " · 至 " + state.expiresAt;',
      'case "valid": return "未激活";',
    ),
    expectFail: "valid / expired / invalid / inactive 各有话说，未读取不冒充未激活",
  },
  {
    id: "diff-patch-add-lines-dropped",
    src: "apps/desktop/src/renderer/diff-patch.ts",
    test: "apps/desktop/tests/diff-patch.test.ts",
    config: "apps/desktop/vitest.config.ts",
    desc: "统一 diff 解析不认 + 行 ⇒ worker 改动预览只剩删除/上下文，新增内容整片消失："
      + "用户看着「没有新增」去点合并，实际合进去的是没看过的代码",
    apply: (s) => s.replace('    if (line.startsWith("+")) {', "    if (false) {"),
    expectFail: "文件头跳过；+/-/空格三类行与两侧行号正确",
  },
  {
    id: "worker-diff-ref-path-traversal-allowed",
    src: "src/agent/worktree.ts",
    test: "tests/worktree-pure.test.ts",
    desc: "diff_ref 解析放开 .agents/wt-* 前缀 ⇒ `../` 或任意路径能进「查看 worker 改动」；"
      + "主进程虽然随后有 startsWith 兜底，但形状闸是第一道也是唯一贴着解析器的闸（别把安全押在第二道）",
    apply: (s) => s.replace('/^(\\.agents\\/wt-[A-Za-z0-9_-]+)@([0-9a-f]{7,40})$/', '/^(.+)@([0-9a-f]{7,40})$/'),
    expectFail: "只认 .agents/wt-<id>@<hex>；路径穿越/非 hex/空串一律 null",
  },
  {
    id: "invoke-census-schedule-consumer-dropped",
    src: "apps/desktop/src/renderer/components/AppPage.tsx",
    test: "apps/desktop/tests/invoke-consumer-census.test.ts",
    config: "apps/desktop/vitest.config.ts",
    desc: "自动化页退回整份 getState ⇒ scheduleSnapshot 又成零消费通道：主进程接得通、UI 没人调，"
      + "而人口普查守卫会把这条当场点名（第 642 页 createProject/cardAction 的同一形状）",
    apply: (s) => s.replace("window.agent.scheduleSnapshot()", "window.agent.getState()"),
    expectFail: "100 条通道全部有消费者；例外只有带理由的 allowlist",
  },
  {
    id: "worker-card-action-cardtype-drift",
    src: "apps/desktop/src/renderer/components/panes.ts",
    test: "apps/desktop/tests/panes.test.ts",
    config: "apps/desktop/vitest.config.ts",
    desc: "合并/拒绝请求的 cardType 漂成 merge_tower ⇒ 主进程 merge/reject 路由虽然也认它，"
      + "但审计面与既有 diff 卡来源分家；更坏的是以后收窄路由只认 diff 时，界面按钮静默失效",
    apply: (s) => s.replace('return { cardId: "worker-diff-" + agentId, sourceEventId, cardType: "diff", action, targetAgentId: agentId };', 'return { cardId: "worker-diff-" + agentId, sourceEventId, cardType: "merge_tower", action, targetAgentId: agentId };'),
    expectFail: "sourceEventId 用 agent_result 行号，cardType=diff，targetAgentId 原样",
  },
  {
    id: "blank-project-routes-to-template",
    src: "apps/desktop/src/renderer/state/projects.ts",
    test: "apps/desktop/tests/new-project-blank.test.tsx",
    config: "apps/desktop/vitest.config.ts",
    desc: "空白项目卡也走模板建项 ⇒ createProject 通道仍是死路，用户点「空白项目」却拿到模板文件"
      + "（界面承诺与真实落盘相反，且删掉模板还得手动清）",
    apply: (s) => s.replace('return templateId === "blank" ? "blank" : "template";', 'return "template";'),
    expectFail: "通道选择：blank 走 createProject，其余走模板",
  },
  {
    id: "worktrees-page-orphan-list-emptied",
    src: "apps/desktop/src/renderer/components/WorktreesPane.tsx",
    test: "apps/desktop/tests/app-page.test.tsx",
    config: "apps/desktop/vitest.config.ts",
    desc: "工作树页把孤儿列表恒当空 ⇒ 协议里明明有 orphans、界面只显示「没有遗留的工作树」："
      + "用户看不到可清理的树，clean 入口等于没接（假空态比不显示更坏）",
    apply: (s) => s.replace("props.snap.orphans.length === 0 ?", "true ?"),
    expectFail: "工作树页：孤儿逐条列出 + 清理按钮；空态不摆假列表",
  },
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
