// scripts-certs-eval 域的变异配置条目（2026-10-17 从 scripts/mutate-verify.mjs 按域拆出，见 PROGRESS 第 501 页）。
// 每条 = 一处语义突变 + 期望被它杀死的具体用例标题。追加条目时放进对应域的文件；
// **组间顺序不影响任何判据**（每条独立），同一文件内保持原顺序以便 diff。
export const MUTATIONS = [
  {
    id: "loop-eval-pick-equals-form-dropped",
    src: "scripts/loop-eval.ts",
    test: "tests/loop-eval-repair-arm.test.ts",
    desc: "取值旗标退回只认空格形 ⇒ `--arm=repair` 被静默忽略、对照臂记成 `arm: base`" +
      "（身份面少一维，两副臂会被配成同一张脸——2026-10-13 那批读数正是这么被记错的）",
    apply: (s) => s.replace(
      "  const eq = flag + \"=\";\n  const withEq = argv.find((a) => a.startsWith(eq));\n  if (withEq !== undefined) return withEq.slice(eq.length);\n",
      "",
    ),
    expectFail: "红拍之后再要一轮 ⇒ 拿到修复轮",
  },
  // ── D-8 复跑面登记表（两张格各钉一半：引用无源 / 陈旧登记——缺任一侧，登记表就会静默烂掉）
  {
    id: "replay-unregistered-refs-blinded",
    src: "scripts/replay-readings.ts",
    test: "tests/docs-check.test.ts",
    desc: "「引用无源」那格恒空 ⇒ 文档写 replay:<id> 而登记表没这项时门全绿——而这正是本判据要拦的第一种腐（那句话本来就是死的）",
    apply: (s) => s.replace("unregisteredRefs: [...new Set(referenced.filter((id) => !ids.has(id)))],", "unregisteredRefs: [],"),
    expectFail: "引用了未登记的 id ⇒ 红，且 detail 点名那个 id",
  },
  {
    id: "replay-unreferenced-ids-blinded",
    src: "scripts/replay-readings.ts",
    test: "tests/docs-check.test.ts",
    desc: "反向一侧恒空 ⇒ 登记表只进不出：脚本改名/删掉后表项烂在那儿，等下一个人引用它才发现（清单缺反向就等于装饰）",
    apply: (s) => s.replace("unreferencedIds: [...ids].filter((id) => !referencedSet.has(id)),", "unreferencedIds: [],"),
    expectFail: "登记了却没人引用 ⇒ 红（陈旧登记，与上一条反向）",
  },

  // ── D-8 复跑面的零语料体检（两格各钉一半：没扫到 / 扫到却认不出）
  {
    id: "replay-corpus-empty-blinded",
    src: "scripts/replay/corpus.ts",
    test: "tests/replay-corpus.test.ts",
    desc: "「一个文件都没扫到」这格恒假 ⇒ 干净 checkout（会话流不在 git 里）上复跑命令照样退出 0，「没有尺」之身冒充真读数；另一格的文案不算覆盖，因为那句说的是「形状漂了」而真相是根本没料",
    apply: (s) => s.replace("  if (scan.files.length === 0) {", "  if (false) { // BLINDED"),
    expectFail: "一个 .jsonl 也没扫到 ⇒ 报，且那句话点名扫描根与不存在的那一支",
  },
  {
    id: "replay-corpus-nocalls-blinded",
    src: "scripts/replay/corpus.ts",
    test: "tests/replay-corpus.test.ts",
    desc: "「有文件却零 tool_call」这格恒假 ⇒ 事件名/字段一漂，那片零（受管=0 ask=0）照样被当成读数念出去（2026-09-21 的 join 键事故就是这个形状）",
    apply: (s) => s.replace("  if (toolCalls === 0) {", "  if (false) { // BLINDED"),
    expectFail: "扫到了文件却一条 tool_call 也没有 ⇒ 报（认不出不等于没有，正是 09-21 那片零的形状）",
  },

  // ── 复跑面 gate-outcomes（读数面自己的三态纪律：漏计比红更坏）
  {
    id: "gate-outcomes-unmatched-swallowed",
    src: "scripts/replay/gate-outcomes.ts",
    test: "tests/replay-gate-outcomes.test.ts",
    desc: "join 不上 tool_call 的受管结果被静默跳过 ⇒ 分母少一块而读数看起来完整（「读数取不到」老族：差值就是尺，别把差值丢掉）",
    apply: (s) => s.replace("    if (tool === undefined) {", "    if (false && tool === undefined) {"),
    expectFail: "只有受管工具进分母；join 不上 tool_call 的记 unmatched，不当没有",
  },
  {
    id: "gate-outcomes-unknown-dropped",
    src: "scripts/replay/gate-outcomes.ts",
    test: "tests/replay-gate-outcomes.test.ts",
    desc: "表外 layer/verdict 不记账 ⇒ 新加一层/一种结果时它整列消失，而不是矩阵多出一格空行",
    apply: (s) => s.replace("    if (!layerOk) bump(t.unknownLayer, g.layer);", "    if (false) bump(t.unknownLayer, g.layer);"),
    expectFail: "表外 layer / verdict 单独记账：既不混进矩阵，也不静默丢掉",
  },
  {
    id: "gate-outcomes-skeleton-per-side-only",
    src: "scripts/replay/gate-outcomes.ts",
    test: "tests/replay-gate-outcomes.test.ts",
    desc: "骨架只按层铺、不按结果铺 ⇒ 少一列没人知道（格数必须等于两层数之积，这条断言就是它的守门人）",
    apply: (s) => s.replace("  for (const l of GATE_LAYERS) for (const v of GATE_VERDICTS) m.set(l + CELL_SEP + v, 0);", "  for (const l of GATE_LAYERS) m.set(l + CELL_SEP + String(GATE_VERDICTS[0]), 0);"),
    expectFail: "骨架格子数 = 层数 × 结果数（任一侧加值，格数自动跟上，不靠人记得补）",
  },

  // ── 复跑面 join-lapse（这条读数给 W1b 定默认值：读数偏 0 = 安静地决定不花钱，所以四格各钉一条）
  {
    id: "join-lapse-denominator-diluted",
    src: "scripts/replay/join-lapse.ts",
    test: "tests/replay-join-lapse.test.ts",
    desc: "分母把无 worker 的普通会话也算进去 ⇒ 占比被大量不相关 run 稀释成好看的 0，W1b 就此「有据」不做",
    apply: (s) => s.replace("  const worker = rows.filter((r) => r.spawns > 0);", "  const worker = rows;"),
    expectFail: "分母只数真派过活的 run：掺进无 worker 的会话不会把占比稀释成 0",
  },
  {
    id: "join-lapse-terminal-list-recopied",
    src: "scripts/replay/join-lapse.ts",
    test: "tests/replay-join-lapse.test.ts",
    desc: "「在途」另抄一份判定而不复用 interruptedWorkers ⇒ 恢复面加一种终态时这里读成在途，两处分叉（第六族）",
    apply: (s) => s.replace(
      "    inFlight: interruptedWorkers(raws as readonly AgentEvent[]).length,",
      "    inFlight: raws.filter((r) => (r as { type?: string }).type === \"agent_spawned\").length,",
    ),
    expectFail: "failed / cancelled 同样算收队——终态名单挂产品的 `interruptedWorkers`，不在此另抄一份",
  },
  {
    id: "join-lapse-unmeasurable-as-zero",
    src: "scripts/replay/join-lapse.ts",
    test: "tests/replay-join-lapse.test.ts",
    desc: "零 worker 时不走「不可测」分支 ⇒ 0/0 与「占比是 0」长成同一句话，读的人据此判定不用建闸（未证读成通过）",
    apply: (s) => s.replace("  if (s.totalSpawns === 0) {", "  if (false) {"),
    expectFail: "零 worker 语料 ⇒ 红着退出并说「不可测」，不许报 0/0 让人读成「占比是 0」",
  },
  {
    id: "join-lapse-families-counted-all-runs",
    src: "scripts/replay/join-lapse.ts",
    test: "tests/replay-join-lapse.test.ts",
    desc: "样本宽度按全语料数目录 ⇒ 无 worker 的文件把「样本只来自一次实验」这句警告自己稀释掉（本面施工时真踩过）",
    apply: (s) => s.replace("families: new Set(worker.map(", "families: new Set(rows.map("),
    expectFail: "样本宽度只数派过活的 run：掺进来的无 worker 目录不许把「样本很窄」这句稀释掉",
  },
  {
    id: "latency-d8-rule-all-or-nothing",
    src: "scripts/replay/latency.ts",
    test: "tests/replay-latency.test.ts",
    desc: "可并发判据退回「整轮全是只读工具」⇒ 真语料那个 25 调用的轮（23 读 + 2 别的）被整轮判 0，读数与结论一起翻向",
    apply: (s) => s.replace(
      "      const safe = turnNames.reduce((n, x) => n + (D8_SAFE_TOOLS.has(x) ? 1 : 0), 0);",
      "      const safe = turnNames.every((x) => D8_SAFE_TOOLS.has(x)) ? turnNames.length : 0;",
    ),
    expectFail: "D8 可折次数按「该轮只读调用数 − 1」算，不按「整轮是否全只读」（真语料有个 25 调用的轮，23 个是 read_file）",
  },
  {
    id: "latency-streams-flattened",
    src: "scripts/replay/latency.ts",
    test: "tests/replay-latency.test.ts",
    desc: "把多个会话拼成一条数组再 tally ⇒ 一条流末尾未闭合的调用吞掉下一条流的「轮」（实测 189 轮读成 19 轮）",
    apply: (s) => s.replace(
      "  return foldLatency(streams.map((raws) => tallyLatency(raws)));",
      "  return foldLatency([tallyLatency(streams.flat())]);",
    ),
    expectFail: "一条流末尾未闭合的调用会把下一条流的「轮」吞掉 ⇒ 必须逐条成流再合并",
  },
  {
    id: "latency-unmeasurable-as-zero",
    src: "scripts/replay/latency.ts",
    test: "tests/replay-latency.test.ts",
    desc: "无戳不再单独判「不可测」⇒ 旧语料上印出「工具耗时 0ms / 占比 0%」，D8 就据此被判定不值得做",
    apply: (s) => s.replace("  if (!t.hasTimestamps) {", "  if (false) {"),
    expectFail: "有调用但全无戳 ⇒ 触发面照常报，时间面单独说「旧语料无戳」并红着退出",
  },
  {
    id: "latency-picker-swallows-empty-path",
    src: "scripts/replay/latency.ts",
    test: "tests/replay-latency.test.ts",
    desc: "指到的路径里没有 .jsonl 却不被记下 ⇒ 读数为空却像「本次跑过了」，与全语料那批混成一谈",
    apply: (s) => s.replace("    if (found.length === 0) empty.push(a);", "    if (false) empty.push(a);"),
    expectFail: "路径下一条 .jsonl 也没有 ⇒ 红着点名该路径，绝不退回全语料",
  },
  {
    id: "latency-picker-always-uses-corpus",
    src: "scripts/replay/latency.ts",
    test: "tests/replay-latency.test.ts",
    desc: "无视命令行路径、永远扫登记表语料 ⇒ 「这一批的数」里混进别处的会话（e2e 读数就此失去归因）",
    apply: (s) => s.replace(
      "  if (args.length === 0) return { files: [...corpus], problem: null };",
      "  return { files: [...corpus], problem: null };",
    ),
    expectFail: "给了路径就只用那些路径，不掺登记表语料（否则「这一批的数」会混进别的批）",
  },

  // ── 复跑面 corpus-inventory（这张表的最后一行是「要不要给主循环加换路压力」的决策依据，
  //    偏小 = 安静地不下判断，所以五格各自钉一条：窗口、规范化、断链、决策线两半）
  {
    id: "corpus-inventory-retry-window-adjacent-only",
    src: "scripts/replay/corpus-inventory.ts",
    test: "tests/replay-corpus-inventory.test.ts",
    // 向后看到序列尾 ⇒ 退回旧写法只看紧邻一格。这一格偏小不会报错，只会让人读成「没重复」。
    desc: "重试只认紧邻的下一个 tool_call ⇒ 中间隔一次别的调用就漏计，「无卡死证据」是数出来的假读数",
    apply: (s) => s.replace("      for (let j = i + 1; j < tc.length; j++) {", "      for (let j = i + 1; j < i + 2; j++) {"),
    expectFail: "中间隔了一次别的调用 ⇒ 仍算原样重试（旧写法只看紧邻，这里会读成 0）",
  },
  {
    id: "corpus-inventory-canonical-args-dropped",
    src: "scripts/replay/corpus-inventory.ts",
    test: "tests/replay-corpus-inventory.test.ts",
    desc: "参数退回原始 JSON.stringify 比对 ⇒ 同一调用换个键序就被读成「改过参数」，「一字不变」偏低",
    apply: (s) => s.replace("    const args = canonicalArgs(c.args);", "    const args = JSON.stringify(c.args);"),
    expectFail: "参数键序不同、内容相同 ⇒ 仍算「一字不变」（旧写法用原始 JSON.stringify，这里会读成 0）",
  },
  {
    id: "corpus-inventory-result-joinkey-guard-off",
    src: "scripts/replay/corpus-inventory.ts",
    test: "tests/replay-corpus-inventory.test.ts",
    // 09-21 实踩：按 callId 查 tool_call 得到 has(undefined) 恒 false ⇒ 一片零假读数。
    // 现在断链是崩而不是数 0，这一格守的就是"崩"这半边。
    desc: "tool_result 缺 callId 不再抛而被静默跳过 ⇒ 「失败=0」这类零读数重新可能（join 键断链要当场崩）",
    apply: (s) => s.replace('    if (typeof key !== "string") {', "    if (false) {"),
    expectFail: "join 键断链必须抛，而不是把「失败」读成 0（09-21 实踩过的形状）",
  },
  {
    id: "corpus-inventory-repeat-verdict-always-act",
    src: "scripts/replay/corpus-inventory.ts",
    test: "tests/replay-corpus-inventory.test.ts",
    desc: "换路压力裁决恒「该动」⇒ 印出来的那行不再是读数，而是口号（决策线两半都得有反例）",
    apply: (s) => s.replace("  if (deepRun && hasExactRepeat) {", "  if (true) {"),
    expectFail: "零原样重试 ⇒ 不给主 loop 加压（今天的真语料形状）",
  },
  {
    id: "corpus-inventory-run-threshold-loosened",
    src: "scripts/replay/corpus-inventory.ts",
    test: "tests/replay-corpus-inventory.test.ts",
    desc: "run 深度阈值 3 放宽到 2 ⇒ 一次普通重试即被判成卡死（偏大的代价是白加主 loop 闸门）",
    apply: (s) => s.replace("  const deepRun = t.maxSameFailedRun >= 3;", "  const deepRun = t.maxSameFailedRun >= 2;"),
    expectFail: "只有原样重试、run 未到 3 ⇒ 仍不动（阈值这一半的分歧格）",
  },
  // ---- 09-24 run-scorecard：y 轴读数的三条口径纪律各钉一针（面自己承诺过的，就得有人抓着）----
  {
    id: "scorecard-env-beats-billed-to-model",
    src: "scripts/replay/run-scorecard.ts",
    test: "tests/replay-run-scorecard.test.ts",
    desc: "不再识别环境拍 ⇒ 装不上工具链的机器把 run 判成「模型没修好」，成功率与返工数一起说谎（P1-3 归因白做）",
    apply: (s) => s.replace("      const env = !e.ok && isEnvVerifyCause(e.cause);", "      const env = false;"),
    expectFail: "环境红不记在模型账上：只有一拍环境红 ⇒ env-blocked，既不 ended-red 也不算返工",
  },
  {
    id: "scorecard-private-write-list",
    src: "scripts/replay/run-scorecard.ts",
    test: "tests/replay-run-scorecard.test.ts",
    desc: "面里另抄一份两名字写向清单（不用 mayHaveWrittenDisk）⇒ shell 改盘的 run 被判 no-write，分母反过来骗人",
    apply: (s) => s.replace("      if (e.ok && c !== undefined && mayHaveWrittenDisk(c.name, c.args)) writeAt.push(i);", "      if (e.ok && c !== undefined && (c.name === \"write_file\" || c.name === \"edit_file\")) writeAt.push(i);"),
    expectFail: "只经 shell 改盘也算写过盘（复用 mayHaveWrittenDisk；旧的两名字清单会把这一格判成 no-write，分母就此骗人）",
  },
  {
    id: "scorecard-denominator-includes-unproven",
    src: "scripts/replay/run-scorecard.ts",
    test: "tests/replay-run-scorecard.test.ts",
    desc: "成功率分母把「证据缺席」的流也算进去 ⇒ 一个没人验过的 run 直接压低分数，读数不再可比",
    apply: (s) => s.replace("  const judgedRows = closedLoop.filter((r) => r.decisive !== \"none\");", "  const judgedRows = closedLoop;"),
    expectFail: "汇总给分档计数，no-write 单独列出（不进分母也不被丢弃）",
  },
  {
    id: "head-import-js-suffix-never-swapped",
    src: "scripts/head-import-face.ts",
    test: "tests/head-import-face.test.ts",
    desc: "只做「加后缀」不做「换后缀」⇒ `./x.js` 这类 ESM 写法全被判成悬空（第一版实测 47 条假红里最大的一族）；假红一多，人们关的是门不是修尺",
    apply: (s) => s.replace("    if (!rel.endsWith(from)) continue;", "    if (true) continue;"),
    expectFail: "`./x.js` 这种 ESM 写法指向的其实是 x.ts（第二版没做换后缀，凭空 40+ 条假红）",
  },
  {
    id: "head-import-two-states-collapse",
    src: "scripts/head-import-face.ts",
    test: "tests/head-import-face.test.ts",
    desc: "「漏 git add」与「模块不存在」压成一态 ⇒ 修法完全不同的两类红长得一样（前者补一笔、后者要找删它的提交）",
    apply: (s) => s.replace("onDisk: existsOnDisk(target)", "onDisk: true"),
    expectFail: "两态分开判：盘上有＝「漏 git add」，盘上也没有＝「引用写错/模块被删」",
  },
  {
    id: "head-import-waiver-never-goes-stale",
    src: "scripts/head-import-face.ts",
    test: "tests/head-import-face.test.ts",
    desc: "命中豁免却不记 hit ⇒ stale 永不触发，补好之后那条名还躺在表里（本仓「豁免不许静默烂在这儿」那一族）",
    apply: (s) => s.replace("{ hit.add(d.target); continue; }", "{ continue; }"),
    expectFail: "豁免是双向的：名单内不红；不再悬空则 stale 红（不许静默烂在表里）",
  },
  {
    id: "head-import-fixture-strings-counted",
    src: "scripts/head-import-face.ts",
    test: "tests/head-import-face.test.ts",
    // 第 135 页改指：取料从「逐行 git grep」换成「整条语句」，旧针脚（IMPORT_LINE 那一行）随之消失 ⇒ 跟着搬。
    desc: "去掉「行首或分号之后才算一条语句」这道边界 ⇒ 判卷里的假源码字符串（一行中间写着 import … from ./nope）又被当成真边，凭空多出十几条悬空",
    apply: (s) => s.replace("(?:^|[;\\n])[ \\t]*(import|export)", "[ \\t]*(import|export)"),
    expectFail: "假源码字符串不算边",
  },
  {
    id: "head-import-clause-spans-into-body",
    src: "scripts/head-import-face.ts",
    test: "tests/head-import-face.test.ts",
    desc: "clause 那一截不设字符禁区 ⇒ 非贪婪从 export function f( 一路跨过整个函数体，撞上注释里举例用的 from ./todo ⇒ 尺把**自己**报成悬空（第 135 页实测）",
    apply: (s) => s.replace("([^();=]*?)[ \\t]+from", "([\\s\\S]*?)[ \\t]+from"),
    expectFail: "clause 不许跨过语句边界",
  },
  {
    id: "head-import-inline-type-not-stripped",
    src: "scripts/head-import-face.ts",
    test: "tests/head-import-face.test.ts",
    desc: "花括号里的内联 type 修饰不剥 ⇒ 「type B」整个当名字 ⇒ 既把合法写法报成缺失，又把整条标成读不懂而静默不判（第 135 页那 6 条假红全在这一族）",
    apply: (s) => s.replace('part.trim().replace(/^type\\s+/, "")', "part.trim()"),
    expectFail: "内联 `type` 修饰与",
  },
  {
    id: "head-import-as-side-swapped",
    src: "scripts/head-import-face.ts",
    test: "tests/head-import-face.test.ts",
    desc: "a as b 在导入侧要源侧的 a、在导出侧要报出去的 b；取错一侧 ⇒ 目标明明导出 renamed 却按本地名判缺失（第十三族：一份谓词抄两处，这次收成一处，两处一起验）",
    apply: (s) => s.replace('side === "import" ? as[1]! : as[2]!', "as[1]!"),
    expectFail: "三种都要收",
  },
  {
    id: "head-import-opaque-target-judged",
    src: "scripts/head-import-face.ts",
    test: "tests/head-import-face.test.ts",
    desc: "摘掉「目标看不全就不判」这道闸 ⇒ 凡是 export * from 的中转文件都会把下游名字报成缺失（假红一族，数量随依赖深度涨）",
    apply: (s) => s.replace("if (exp === null || exp === undefined || exp.opaque) continue;", "if (exp === null || exp === undefined) continue;"),
    expectFail: "目标看不全",
  },
  {
    id: "head-import-partial-batch-counts-as-face",
    src: "scripts/head-import-face.ts",
    test: "tests/head-import-face.test.ts",
    desc: "cat-file 回包形状不认识时交出「已经读到的那部分」⇒ 半份导出面拿去判自洽＝假绿（规则 92：读不到要说读不到）",
    apply: (s) => s.replace("return null; // 形状不认识 ⇒ 整批判未取，不猜", "return map; // 交半份"),
    expectFail: "回包形状不认识",
  },
  {
    id: "head-import-symbol-waiver-never-goes-stale",
    src: "scripts/head-import-face.ts",
    test: "tests/head-import-face.test.ts",
    desc: "符号那张豁免表命中却不记 hit ⇒ 补好后那条名永远躺在表里（本仓「豁免不许静默烂在这儿」那一族的第二张表）",
    apply: (s) => s.replace("{ hit.add(key); continue; }", "{ continue; }"),
    expectFail: "豁免表外新出现的缺失即红",
  },
  {
    id: "head-cert-import-face-asks-head-not-target",
    src: "scripts/head-cert.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "认证别的 rev 时 import 面却去问 HEAD ⇒ 用 `--at=<旧提交>` 复查历史红因（第 131 页就是这么定位到 `834ba3a`）时，报的是当前 HEAD 的悬空——「验的是这棵树」被偷偷换成「验的是最新提交」",
    apply: (s) => s.replace("const importFace = collectHeadEdges(TARGET);", 'const importFace = collectHeadEdges("HEAD");'),
    expectFail: "必须问被认证的 rev（TARGET），不是问 HEAD 字面量、也不是问盘",
  },
  {
    id: "head-cert-gate-table-packages-ask-target",
    src: "scripts/head-cert.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "认证别的 rev 时门表比的是「那一笔的 manifest × HEAD 的 scripts」⇒ 拿最新提交的 script 清单去证明旧提交能跑，混口径读出来永远「一条不缺」（第 136 页我自己就这么读错过一次）",
    apply: (s) => s.replace("headGateTableIntegrity(gateSrc.status === 0 ? gateSrc.out : null, pkgText.out)", 'headGateTableIntegrity(gateSrc.status === 0 ? gateSrc.out : null, run(MAIN, "git", ["show", "HEAD:package.json"]).out)'),
    expectFail: "两头都取自被认证的那一笔：绝不许 import 盘上那份活数组",
  },
  {
    id: "head-cert-gate-table-manifest-ask-target",
    src: "scripts/head-cert.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "另一头同理：manifest 写成 HEAD 字面量 ⇒ 用现在的门表名去比那一笔的 scripts，改过门名的那一笔会被读成「门表里没这道门」",
    apply: (s) => s.replace('run(MAIN, "git", ["show", TARGET + ":scripts/gate-manifest.ts"])', 'run(MAIN, "git", ["show", "HEAD:scripts/gate-manifest.ts"])'),
    expectFail: "两头都取自被认证的那一笔：绝不许 import 盘上那份活数组",
  },
  {
    id: "head-gate-trailing-comment-drops-gate",
    src: "scripts/lib/head-cert-deps.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "门名行不许带行尾注释：那一行整体匹配不上 ⇒ 真门被静默丢掉，门表读窄了没人说（少一位观察者就是静默失明）",
    apply: (s) => s.replace('(?:\\/\\/.*)?$', "$"),
    expectFail: "注释里的引号词不算门；真门名带行尾注释要照样收",
  },
  {
    id: "head-gate-without-script-always-empty",
    src: "scripts/lib/head-cert-deps.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "「缺 script 的那些」永远读空 ⇒ 这道尺退化成一条只会说「门表完整」的装饰（第 131 页那族「判据在、观察者不在」）",
    apply: (s) => s.replace("gates.filter((g) => !scripts.has(g))", "gates.filter(() => false)"),
    expectFail: "齐的读空、缺的按表序指名",
  },
  {
    id: "head-gate-unread-manifest-counts-as-complete",
    src: "scripts/lib/head-cert-deps.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "取不到料时交一份「空门表、零缺失」⇒ 没尺被读成尺说没问题（规则 92/210 那一族）",
    apply: (s) => s.replace("if (manifestSrc === null || pkgJsonText === null) return null;", "if (manifestSrc === null || pkgJsonText === null) return { gates: [], withoutScript: [] };"),
    expectFail: "三态：任一头没取到 / 数组读不出来 / 坏 JSON ⇒ null（没尺，不许读成「一条不缺」）",
  },
  {
    id: "head-gate-hollow-array-counts-as-complete",
    src: "scripts/lib/head-cert-deps.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "数组读得出、里面一条门名都没收到（排版变了：整表压成一行，或门名全被注释掉）⇒ 「0 道门、0 条缺失」印出来比红更像绿（空载棘轮，规则 129/196）",
    apply: (s) => s.replace("if (gates.length === 0) return null;", "if (gates.length < 0) return null;"),
    expectFail: "排版变了也别说「门表完整」：数组在、里面一条名字都没有 ⇒ 按 null 处置（0 道读起来比红更像绿）",
  },
  {
    id: "head-cert-empty-import-face-reads-as-clean",
    src: "scripts/head-cert.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "import 面取到空（文件 0 或边 0）时照常走进印「悬空 0」的那一支 ⇒ findings 天然为 0，读起来正是「自洽」——这一支的前提是**真读到了东西**",
    apply: (s) => s.replace("importFace !== null && (importFace.headFiles.size === 0 || importFace.edges.length === 0)", "importFace !== null && false"),
    expectFail: "取到**空面**（文件 0 或边 0）与未取同处置：0 条 findings 正好像「自洽」（空载棘轮，规则 129/196）",
  },
  // ---- 09-27 第 146 页：认证树要连**靶子仓库**的依赖一起备齐（干净 HEAD 全量 5 红里有 2 红是环境）----
  {
    id: "depdirs-descends-into-node-modules",
    src: "scripts/lib/head-cert-deps.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "不许走进 node_modules：那里每个包都自带 package.json ⇒ 一进去就把整棵依赖图当成靶子仓库，认证一次要硬链接成百上千个目录（且没有一个是被测的）",
    apply: (s) => s.replace('if (!e.dir || e.name === "node_modules" || e.name.startsWith(".")) continue;', 'if (!e.dir || e.name.startsWith(".")) continue;'),
    expectFail: "node_modules 里那些 package.json 不许算",
  },
  {
    id: "depdirs-depth-cap-dropped",
    src: "scripts/lib/head-cert-deps.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "摘掉深度帽 ⇒ 取料没有边界（今天只有 4 层，将来谁把 monorepo 塞进来就得走穿整棵树）；这一行是「成本有界」的唯一执行点",
    apply: (s) => s.replace("    if (depth >= maxDepth) return;", "    if (false) return;"),
    expectFail: "深度帽：maxDepth 之外的不收",
  },
  {
    id: "head-cert-subdep-loop-dropped",
    src: "scripts/head-cert.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "算出来不接：遍历一个空数组 ⇒ 缺额照报、读数照印，而依赖一个都没补。接线判据因此钉**循环头**而不是函数名（只钉函数名时这条变异会存活）",
    apply: (s) => s.replace("for (const d of subDirs) {", "for (const d of [] as string[]) {"),
    expectFail: "接线：认证流程真的按它补子仓库依赖",
  },

  // ── 第 149 页 · head-cert 进默认门表：共享树上多一个写点，收尾复核是它的前提
  {
    id: "head-cert-drift-check-call-dropped",
    src: "scripts/head-cert.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "复核调用被换成恒不漂 ⇒ 树在中途被别的会话/别的门切走时，这道门照样把旧树的读数当本次认证打印（切树时那次核不到这 90 秒）",
    apply: (s) => s.replace(
      "const drift = readInvalidated(afterRev.status === 0 ? afterRev.out : null, TARGET);",
      "const drift: string | null = null;",
    ),
    expectFail: "复核的对象是**跑完之后**那棵树的 rev，比的是被认证的那一笔（钉整条调用，不只钉函数名）",
  },
  {
    id: "head-cert-drift-not-in-exit-code",
    src: "scripts/head-cert.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "只在汇总里印一行、不进退出码 ⇒ 进了门表也永远不会因为树被切走而红（「出声」不等于「闸住」，规则 210 那一族）",
    // 针脚随实现搬家（第 426 页 #14 把式子抽进 lib）：这一根改钉**调用点那一跳**——作废那一维没交进
    // 共用判决的输入时，lib 那头写得再对也白对。lib 那一头由 cert-exit-code-drift-dim-dropped 各红一条。
    apply: (s) => s.replace(`  treeDrifted: drift !== null,`, `  treeDrifted: false,`),
    expectFail: "作废必须改退出码：只印一行而门照绿 ⇒ 这道门永远不会因为树被切走而红",
  },
  // ── 第 156 页 · head-cert 的「并发判卷」读数：撞窗的红要门里就有归因方向
  {
    id: "concurrency-shape-matched-by-adjacency",
    src: "scripts/lib/head-cert-deps.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "退回「按字面串挨着匹配」那版：真机现行的命令行在 `run` 与 `--config` 中间插了 `--pool` ⇒ 明明有人在跑却读成 0 套。这格读成 0 比读错更糟——它会让人**排除掉一个真实存在的撞窗**（今天我自己就这么漏过一次）",
    apply: (s) => s.replace(
      "  return SUITE_BIN_SHAPE.test(line) && RUN_SHAPE.test(line) && CONFIG_SHAPE.test(line);",
      '  return line.includes("vitest.mjs run --config");',
    ),
    expectFail: "真机现行：`run` 与 `--config` 中间插了 --pool ⇒ 仍然认得出（按字面串匹配的那版在这里读成 0 套）",
  },
  {
    id: "concurrency-watcher-line-counted",
    src: "scripts/lib/head-cert-deps.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "不摘看门那行 ⇒ `pgrep -f vitest.mjs run --config …` 这类监视进程被算成一套判卷（我今天写的等窗循环正是这个形状），于是「有人在跑」变成常态，这格从此没人信",
    apply: (s) => s.replace(
      "  if (WATCHER_SHAPE.test(line)) return false;",
      "  if (false) return false;",
    ),
    expectFail: "看门的那行不算一套：pgrep 自己带着同样的字面（今天我就写了这么一条等窗循环）",
  },
  {
    id: "concurrency-pgid-dedupe-dropped",
    src: "scripts/lib/head-cert-deps.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "按行去重改成按整行 ⇒ 一套判卷的 shell 包装行与 node 子进程行各算一套，「我自己在跑」被读成撞窗，红的时候会把人送去查一个不存在的邻居",
    apply: (s) => s.replace(
      "    groups.add(cols[1]);",
      "    groups.add(line);",
    ),
    expectFail: "一套判卷在 ps 里留两行（shell 包装 + node 子进程）⇒ 数成一套：按行计数会把「我自己在跑」读成撞窗",
  },
  {
    id: "concurrency-malformed-reads-zero",
    src: "scripts/lib/head-cert-deps.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "取料形状不对（少了 pgid 那一列）时把 -1 改成继续数 ⇒ 「没量到」被读成「量到了且是 1 套/0 套」，规则 222 的文本尺老假绿路在这一格重开",
    apply: (s) => s.replace(
      "    if (cols.length < 2 || !NUMERIC_SHAPE.test(cols[1])) return -1;",
      "    if (cols.length < 2) return -1;",
    ),
    expectFail: "取料形状不对（没有 pgid 那一列）⇒ 回 -1 而不是 0：「没量到」不许长成「量到且没问题」",
  },
  {
    id: "concurrency-hint-fires-on-green",
    src: "scripts/lib/head-cert-deps.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "判卷绿也照喊撞窗 ⇒ 一道门喊没人会信的狼，下一次真撞窗时这句话已经没人看了（第 154 页「无差别的旗标＝没观测者」的反面：有旗标但永远举）",
    apply: (s) => s.replace(
      "  if (testStatus === null || testStatus === 0) return null;",
      "  if (testStatus === null) return null;",
    ),
    expectFail: "判卷有红且两端采到别人 ⇒ 那句话给归因方向并点名套数；判卷绿 ⇒ 一声不出",
  },
  {
    id: "concurrency-reading-unknown-collapsed",
    src: "scripts/lib/head-cert-deps.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "「取不到」那一支被摘掉 ⇒ 汇总行把 -1 一路印成「两端独占」，等于把没量到宣称成量过且没问题",
    apply: (s) => s.replace(
      '  if (before < 0 || after < 0) return "并发判卷=取不到（ps 没跑起来 ⇒ 撞窗无从判定，这一格不许读成 0）";',
      '  if (false) return "并发判卷=取不到（ps 没跑起来 ⇒ 撞窗无从判定，这一格不许读成 0）";',
    ),
    expectFail: "汇总行三种「没数」分列印：未采／取不到／独占／撞窗，谁也不许冒充 0",
  },
  {
    id: "concurrency-samples-only-before",
    src: "scripts/head-cert.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "只在起判卷前采一次 ⇒ 判卷这 90 秒里开起来的那套看不见（这半把尺本身就是本笔要修的东西：我的等窗循环就是这么漏的）",
    apply: (s) => s.replace(
      '  psAfter = countConcurrentSuites(run(MAIN, "ps", ["-eo", "pid,pgid,command"]).out);',
      "  psAfter = -1;",
    ),
    expectFail: "起前与跑完各采一次（只采一端的读数是半把尺：中途开起来的那套看不见）",
  },
  {
    id: "concurrency-hint-computed-not-printed",
    src: "scripts/head-cert.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "算出来不接（规则 230 的同一格）：归因方向有了，但没人印 ⇒ 读的人看到的还是一句「exit=1」，仍然得自己去 ps",
    apply: (s) => s.replace(
      "if (hint !== null) say(`⚠️ ${hint}`);",
      "if (false) say(`⚠️ ${hint}`);",
    ),
    expectFail: "读数印进汇总，且 --skip-test 那一路不许伪装成「跑过且独占」",
  },
  {
    id: "concurrency-wired-into-exit-code",
    src: "scripts/head-cert.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "反向哨兵：把并发套数接进退出码 ⇒ 别的会话在跑就让门红，这道门从此是共享树上的随机红（本笔的裁决是「只出声、不闸住」，改判要连着改这一条）",
    apply: (s) => s.replace(`const code = certExitCode(outcome);`, `const code = certExitCode(outcome) === 0 && psBefore === 0 ? 0 : 1;`),
    expectFail: "反向哨兵：并发套数刻意**不进退出码**（别的会话在跑不是我这笔代码错，接进去＝共享树上的随机红）",
  },
  // ── 第 159 页 · head-cert 的未知开关：拼错一次就会去认证另一棵树
  {
    id: "cert-unknown-flag-never-reported",
    src: "scripts/lib/head-cert-deps.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "拒收函数恒回空 ⇒ 未知开关又被静默丢掉：`--tre=` 拼错时脚本会转去建**默认那棵共享树**并跑完整轮，操作者以为在读自己指定的那棵（09-27 实测过一次，探针顺手建了棵树）",
    apply: (s) => s.replace(
      "  return argv.filter((a) => {",
      "  return ([] as string[]).filter((a) => {",
    ),
    expectFail: "拼错的开关（--tre=…）必须被点名拒收：实测它会转去建**默认那棵共享树**并跑完整轮",
  },
  {
    id: "cert-unknown-flag-requires-equals",
    src: "scripts/lib/head-cert-deps.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "取名字时连着 `=值` 一起当名字 ⇒ 所有带值开关（`--at=`／`--tree=`／`--why=`）都被判成未知：这道门从此没人能跑（fail-closed 过头也是一种坏）",
    apply: (s) => s.replace(
      "    const name = (eq === -1 ? a.slice(2) : a.slice(2, eq)).trim();",
      "    const name = (eq === -1 ? a.slice(2) : a.slice(2)).trim();",
    ),
    expectFail: "反向哨兵：合法组合一条都不许被拒（拒了就是把这道门自己关死，门表会红成「没人能认证」）",
  },
  {
    id: "cert-known-list-drops-a-flag",
    src: "scripts/lib/head-cert-deps.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "名单与实际读取漂开（这里是撤掉 `no-borrow`）⇒ 传一条**合法**的开关会被自己的闸拒掉。这类「表与代码各说各话」只有双向对照能同时抓住两头（规则 208）",
    // 针脚改指（2026-10-02 修）：`508538a`（head-cert 回收自己建的认证树，移植到 zcode）
    // 往名单里加了 `keep-tree` ⇒ 旧针脚（第二个元素后就是 `]`）失针。
    // 变异体仍是"撤掉 no-borrow"（desc 说的就是它），只是针脚跟上现在这一行。
    apply: (s) => s.replace(
      'export const CERT_FLAGS: readonly string[] = ["skip-test", "no-borrow", "keep-tree"];',
      'export const CERT_FLAGS: readonly string[] = ["skip-test", "keep-tree"];',
    ),
    expectFail: "名单与脚本真正读的开关双向对得上：漏登记＝自拒，多登记＝那张表是假的",
  },
  {
    id: "cert-unknown-check-computed-not-wired",
    src: "scripts/head-cert.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "算出来不接（规则 230 的同一格）：纯函数有了、main() 里却不拒 ⇒ 拼错的开关照跑，这闸是纸糊的",
    apply: (s) => s.replace(
      "if (badArgs.length > 0) {",
      "if (false) {",
    ),
    expectFail: "接线：main() 真的调它、非空就 exit 2（只写纯函数不接＝没有闸）",
  },
  {
    id: "cert-lock-cell-not-printed",
    src: "scripts/head-cert.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "占到锁这件事不印进汇总 ⇒ 凭证里看不出这次是独占还是抢来的（规则 211/231：读数要印出来，藏在日志里等于没有）",
    apply: (s) => s.replace(
      "认证树锁=${lockCell}",
      "锁=未印",
    ),
    expectFail: "接线形状：head-cert 真调 acquireToolLock 且早于切树，三态那份唯一过程在 tool-lock 里",
  },
  // ── 第 164 页 · 清场读数（任务 #33）＋临时名 wx（任务 #32）＋汇总落盘
  {
    id: "stale-tree-unreadable-reads-as-zero",
    src: "scripts/lib/head-cert-deps.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "取不到 worktree 清单那一支回「常驻残留树=0」⇒ 没尺长得跟「量到且干净」一模一样；而这格存在的理由就是让「忘了收」可见（第 162 页补的凭证正是这么与盘不符的）。空载棘轮同族：规则 129/196/222",
    apply: (s) => s.replace(
      'if (rows === null) return "常驻残留树=未取（git 读不到 worktree 清单 ⇒ 不等于没有残留）";',
      'if (rows === null) return "常驻残留树=0";',
    ),
    expectFail: "那一格三种形态分列印：未取／0 棵／N 棵，未取不许写成 0（空载棘轮同族）",
  },
  {
    id: "stale-tree-ignores-dirty-face",
    src: "scripts/lib/head-cert-deps.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "不看在飞项 ⇒ 把别人正在写的树报成垃圾（AGENTS：保留别的会话的脏改动）。摘掉这一位，判卷里那棵 dirty 树就会出现在名单上——门喊的是「去收它」，最坏的读法",
    apply: (s) => s.replace(
      "if (dirty !== 0) continue;",
      "if (false) continue;",
    ),
    expectFail: "四个条件缺一不可：带分支／有在飞／未入库／是本次那棵认证树，各一条反向（把别人正在用的树喊成垃圾是最坏的读法）",
  },
  {
    id: "stale-tree-no-location-split",
    src: "scripts/lib/head-cert-deps.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "分格那一位不发作 ⇒ 外域树重新混进「可以去收」的名单（第 231 页的现读成因：本机有一棵住在 `.claude/worktrees/…` 的隔壁会话树，" +
      "而那句回收命令就印在它旁边——判卷早就按位置钉过，谓词却没看位置）",
    apply: (s) => s.replace(
      "if (!insideScratchFace(r.path, opt.scratchRoot)) { foreign.push(r.path); continue; }",
      "if (false) { foreign.push(r.path); continue; }",
    ),
    expectFail: "外域那棵进 foreign 而不是 stale，且照样在句子里点名（报成「不存在」＝尺把它吞了）",
  },
  {
    id: "stale-tree-scratch-face-bare-prefix",
    src: "scripts/lib/head-cert-deps.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "目录归属用裸前缀比 ⇒ `/repo/.worktrees-backup/…` 被当自家人，「可以去收」印到别人的树旁边" +
      "（前缀匹配要按位置枚举变体，第十族同一枪）",
    apply: (s) => s.replace(
      'return path === root || path.startsWith(root + "/") || path.startsWith(root + "\\\\");',
      "return path.startsWith(root);",
    ),
    expectFail: "同前缀不是同一面：`.worktrees-backup` 算外域（裸 startsWith 会把别人的树标成可回收）",
  },
  {
    id: "stale-tree-scratch-root-not-wired",
    src: "scripts/head-cert.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "调用方不传那一面 ⇒ 纯函数与措辞都写对了但这一格永远是空的：分格成了死代码，读数照旧把外域树算进残留" +
      "（规则 230/254：只写纯函数不接＝没有读数）",
    apply: (s) => s.replace("scratchRoot: SCRATCH_ROOT,", "scratchRoot: undefined,"),
    expectFail: "没给 scratchRoot 才退回旧行为（全算本仓）——而调用方必须把它接上，否则分格是死代码",
  },
  {
    id: "stale-tree-foreign-not-printed",
    src: "scripts/lib/head-cert-deps.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "分格算了却不印 ⇒ 那一串路径从读数里消失，下一次没人知道还有这么棵树；" +
      "「尺读不到」与「没有问题」不许同形（规则 261/262），这一格同理：分错了也不许静默",
    apply: (s) => s.replace("const foreignTail = foreign.length === 0", "const foreignTail = foreign.length >= 0"),
    expectFail: "外域那棵进 foreign 而不是 stale，且照样在句子里点名（报成「不存在」＝尺把它吞了）",
  },
  {
    id: "stale-tree-main-root-joined-not-resolved",
    src: "scripts/lib/head-cert-deps.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "主树根用 `join` 拼而不是 `resolve` ⇒ `--git-common-dir` 给绝对路径时接出 `<树>//Users/…/.git` 这种假路径，" +
      "于是 linked 树里跑的那一趟把主树的 scratch 面算错、全部判成外域（与 `toolLockPath` 同一课：两份取料会漂）",
    apply: (s) => s.replace(
      "return dirname(resolve(cwdRoot, common));",
      "return join(cwdRoot, common);",
    ),
    expectFail: "主树根两种 git 形状都认：主检出给相对 .git，linked 树给绝对路径；取不到回 null 不猜",
  },
  {
    id: "cert-main-root-empty-guesses-cwd",
    src: "scripts/lib/head-cert-deps.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "`--git-common-dir` 取空时不回 null 而是**猜成脚下这棵** ⇒ 调用方那句「没主树根要出声」永远不响，" +
      "而 scratch 面悄悄变成「当前树/.worktrees」：在 linked 树里跑的那一趟会把主树的树全判成外域（第 233 页 §6 登记的反例，本笔补上）",
    apply: (s) => s.replace(
      'if (common === "") return null;',
      'if (common === "") return cwdRoot;',
    ),
    expectFail: "主树根两种 git 形状都认：主检出给相对 .git，linked 树给绝对路径；取不到回 null 不猜",
  },
  {
    id: "cert-scratch-root-unknown-silent",
    src: "scripts/head-cert.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "取不到主树根时不出声 ⇒ 这一格退化得和「什么都没发生」一模一样（规则 261/262：尺的取不到与没问题不许同形）",
    apply: (s) => s.replace(
      "if (SCRATCH_ROOT === undefined) say(",
      "if (false) say(",
    ),
    expectFail: "接线：主树根取不到时那一格必须出声，不许静默退回「全都算本仓」",
  },
  {
    id: "inflight-args-flag-position-wrong",
    src: "scripts/lib/head-cert-deps.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "把 `--no-optional-locks` 挪到子命令后面 ⇒ git 报 unknown option 退 129 ⇒ 每棵树都「取不到」⇒ 那一格只能印 0，而表上照旧报 ✅。第 165 页实测到的就是这一位；文字钉 `toContain(那串引号)` 看不见位置（规则 239），所以这一针必须由真跑 git 的那条判卷咬",
    apply: (s) => s.replace(
      'return ["--no-optional-locks", "status", "--porcelain"];',
      'return ["status", "--porcelain", "--no-optional-locks"];',
    ),
    expectFail: "行为证人：这对参数交给真 git——跑得出 0、脏树量得出 1 而干净树是 0，并且不碰那棵树的 index",
  },
  {
    id: "inflight-args-drop-the-global-flag",
    src: "scripts/lib/head-cert-deps.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "整对参数能跑但把选项摘掉 ⇒ 读一棵树就刷新那棵树的 index（AGENTS：不许污染别人的在飞态）。与上一条的输入不同之处靠 mtime 那格分开：摘掉选项时 git 仍退 0、脏净仍分得出，只有「index 会不会被动」这一格看得见（规则 226：同拦一件事的两道闸要给各自看得见的输入）",
    apply: (s) => s.replace(
      'return ["--no-optional-locks", "status", "--porcelain"];',
      'return ["status", "--porcelain"];',
    ),
    expectFail: "行为证人：这对参数交给真 git——跑得出 0、脏树量得出 1 而干净树是 0，并且不碰那棵树的 index",
  },
  {
    id: "stale-tree-unmeasurable-dropped-silently",
    src: "scripts/lib/head-cert-deps.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "「取不到在飞数」那棵又被 `continue` 掉（不进 unmeasured）⇒ 名单空、第三态空，那一格重新变成一把只能报 0 的尺。这一格的存在理由就是「没量到不许长成量到且干净」",
    apply: (s) => s.replace(
      "if (dirty === null) { unmeasured.push(r.path); continue; }",
      "if (dirty === null) { continue; }",
    ),
    expectFail: "第四态：在飞数取不到的那棵要单独点名——既不进残留名单，也不许被那个 0 吞掉",
  },
  {
    id: "stale-tree-cell-hides-unmeasured",
    src: "scripts/lib/head-cert-deps.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "谓词数出来了但那一格不说（尾巴恒空）⇒ 读的人看到的还是「常驻残留树=0」。与上一条分开钉：一个错在算，一个错在说，两处的修法不同（规则 210 的两半）",
    apply: (s) => s.replace(
      "const tail = res.unmeasured.length === 0",
      "const tail = true",
    ),
    expectFail: "第四态：在飞数取不到的那棵要单独点名——既不进残留名单，也不许被那个 0 吞掉",
  },
  {
    id: "stale-tree-ignores-branch-face",
    src: "scripts/lib/head-cert-deps.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "不辨 detached ⇒ 带分支的工作支（本仓同时有 doc-layer／goal-plan／r1b 等）也被报成残留。与上一条分开钉：两个条件都往「少报」的方向错，但踩的是不同的人",
    apply: (s) => s.replace(
      "if (!r.detached) continue;",
      "if (false) continue;",
    ),
    expectFail: "四个条件缺一不可：带分支／有在飞／未入库／是本次那棵认证树，各一条反向（把别人正在用的树喊成垃圾是最坏的读法）",
  },
  {
    id: "cert-summary-not-durable",
    src: "scripts/head-cert.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "汇总只走 stdout（`console.log` 到管道是异步排队，而脚本结尾是 `process.exit`）⇒ 凭证的证据本体有被丢尾的风险，且落盘那份一旦没有，红门日志里就只剩逐条子进程日志。规则 214：展示可截，证据不可截",
    apply: (s) => s.replace(
      'writeFileSync(join(logDir, "summary.txt"), spoken.join("\\n") + "\\n");',
      "void spoken.length; // 只印不落盘",
    ),
    expectFail: "汇总要同步落盘：stdout 只是展示，summary.txt 才是证据（本脚本结尾是 process.exit）",
  },
  {
    id: "read-invalidated-missing-rev-reads-clean",
    src: "scripts/lib/head-cert-deps.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "复核本身跑不起来（git 读不到那棵树）被读成「没漂」⇒ 把「没量到」记成「量过且没问题」（规则 92 三态里最贵的那一格）",
    apply: (s) => s.replace(
      '  if (afterRev === null) return "收尾复核没跑起来（git 读不到那棵树）⇒ 本次读数不可归因于代码，也不能算已认证";',
      "  if (afterRev === null) return null;",
    ),
    expectFail: "复核本身没跑起来（git 读不到那棵树）⇒ 同样不算通过（「没量到」不许读成「量过且没问题」）",
  },
  {
    id: "read-invalidated-drops-trim",
    src: "scripts/lib/head-cert-deps.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "不 trim 直接比 ⇒ `git rev-parse` 的行尾换行让每一次都「漂」，一道天天假红的门会被关掉而不是被修（假红的代价由下一个读数的人付）",
    apply: (s) => s.replace("  const got = afterRev.trim();", "  const got = afterRev;"),
    expectFail: "跑完还在同一笔 ⇒ 不作废（尾部换行是 git 的常态，要 trim）",
  },

  // ── 第 150 页 · 读数仪的成对字段：合并读数会同时藏住"有"和"没有"（规则 231⑷）
  {
    id: "cache-unreported-merged-back",
    src: "scripts/replay/run-scorecard.ts",
    test: "tests/replay-run-scorecard.test.ts",
    desc: "两半又加回一个数（哪怕塞进其中一格）⇒「读侧全在场、写侧全缺席」与「反过来」印成同一句话，本次就是被这个形状骗出一条错批语",
    apply: (s) => s.replace(
      "cacheUnreported: { read: allUsage.cacheReadUnreported, write: allUsage.cacheWriteUnreported },",
      "cacheUnreported: { read: allUsage.cacheReadUnreported + allUsage.cacheWriteUnreported, write: 0 },",
    ),
    expectFail: "两条各缺一侧 ⇒ 两半各记 1（合并成一个数就只能报「缺报 2」，谁缺的说不清）",
  },
  {
    id: "cache-line-drops-write-half",
    src: "scripts/replay/run-scorecard.ts",
    test: "tests/replay-run-scorecard.test.ts",
    desc: "那一行只印读侧 ⇒ 写侧整列缺席（今天真实的情况）没人说出口，看的人以为自己那半有数",
    apply: (s) => s.replace(
      '" 条 · 写侧 " + String(un.write) + " 条"',
      '" 条"',
    ),
    expectFail: "「读侧全在场、写侧全缺」与反过来，必须印成两句不同的话（这就是本次缺陷的正反两格）",
  },
  {
    id: "cache-line-prints-sum-for-both",
    src: "scripts/replay/run-scorecard.ts",
    test: "tests/replay-run-scorecard.test.ts",
    desc: "两半都印同一个合计 ⇒ 分列印只剩排版，「读侧 0 · 写侧 3」与「读侧 3 · 写侧 0」又印成一件事（恒真的仪表比没有仪表更贵）",
    apply: (s) => s.replace(
      'String(un.read) + " 条 · 写侧 " + String(un.write)',
      'String(un.read + un.write) + " 条 · 写侧 " + String(un.read + un.write)',
    ),
    expectFail: "「读侧全在场、写侧全缺」与反过来，必须印成两句不同的话（这就是本次缺陷的正反两格）",
  },
  // ── 第 249 页补⑵ · 任务 #1 的外域树现场撞出来的四处：位置口径／两条排除／建父目录不许崩
  {
    id: "cert-tree-abs-args-swapped",
    src: "scripts/lib/head-cert-deps.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "`certTreeAbs(main, tree)` 两个参数写反 ⇒ 绝对 `--tree=` 被算成主树底下（或整串被吃掉），" +
      "existsSync 读的是不存在的那一面、`node_modules` 硬链进仓内假目录。" +
      "⚠️ killer 指针第一次指错：钉的是同文件里那条 canonical 判卷（它不调这个函数）⇒ 变异**真的存活**过一轮；" +
      "现指的那条才是吃 `certTreeAbs` 返回值的（规则 224：指针能解析≠它在守这一格，只有跑一遍看得见）",
    apply: (s) => s.replace(
      "  return resolve(mainRoot, treeArg);",
      "  return resolve(treeArg, mainRoot);",
    ),
    expectFail: "相对按主树展开，绝对原样采纳，穿越写法先归一",
  },
  {
    id: "stale-self-exclusion-not-canonical",
    src: "scripts/lib/head-cert-deps.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "排除自己那棵时不过 canonical ⇒ macOS 上主树/认证树以 `/private/tmp` 回报而参数是 `/tmp`，" +
      "两条读数说反话：上一行刚印「回收这棵树」，下一行把它喊成「不是本仓建的，别删」",
    apply: (s) => s.replace(
      "  const self = canon(opt.selfPath);",
      "  const self = opt.selfPath;",
    ),
    expectFail: "「是不是我自己这棵」要按同一个口径比：`worktree list` 报 `/private/tmp` 而 `--tree=` 给 `/tmp`（第 249 页现读到的）",
  },
  {
    id: "stale-certtree-exclusion-not-canonical",
    src: "scripts/lib/head-cert-deps.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "同上，另一-half：本次刚认证完那棵没被排除 ⇒ `foreign` 虚高一条。两条分开钉是因为" +
      "「self 过 canonical、cert 不过」在只测一棵树的输入上完全看不出来（同族：两半要各红一条）",
    apply: (s) => s.replace(
      "  const cert = canon(opt.certTree);",
      "  const cert = opt.certTree;",
    ),
    expectFail: "「是不是我自己这棵」要按同一个口径比：`worktree list` 报 `/private/tmp` 而 `--tree=` 给 `/tmp`（第 249 页现读到的）",
  },
  {
    id: "head-cert-wiring-recertifies-other-path",
    src: "scripts/head-cert.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "排除名单里填 `MAIN` 而不是本次那棵 `treeAbs` ⇒ 判卷全绿而**现读**把认证树报成外域残留：" +
      "纯函数对、接线错，这是「值交给别人用」那一族的第二个副本（第十三族）",
    apply: (s) => s.replace(
      "  certTree: treeAbs,",
      "  certTree: MAIN,",
    ),
    expectFail: "接线：head-cert 用这一个函数，且排除名单里那棵就是被切走的那棵",
  },
  {
    id: "head-cert-mkdir-parent-throws",
    src: "scripts/head-cert.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "补父目录那一步把 catch 换成抛 ⇒ `--tree=/dev/null/x` 这类哨兵写法直接崩（栈里没有归因），" +
      "而那两条判卷要的正是「走到了切树那一步、由 git 出声」。旧口径 join 把它指到仓内假目录所以从不失败——修了口径就得补这道容忍",
    apply: (s) => s.replace(
      "catch { /* 交给下一行的 git：它知道该怎么抱怨 */ }",
      'catch { throw new Error("父目录建不动"); }',
    ),
    expectFail: "反向哨兵：没有锁文件 ⇒ 不许以「锁面不存在」为由拒跑，照常走到切树那一步",
  },
  {
    id: "prompt-fixed-cost-rows-use-prompt-only",
    src: "scripts/replay/prompt-fixed-cost.ts",
    test: "tests/prompt-cost.test.ts",
    desc: "逐档面算出来了、也印了，但摊给每条流时实参仍递提示那份（「算出来不接」第四次，这次在成本尺）⇒"+
      "汇总里那些固定 token 全部偏小一个数量级，而头部几行看着完全正确",
    apply: (s) => s.replace(
      "const rows = promptCostRows(perFile, { promptChars: billed.totalChars, factor });",
      "const rows = promptCostRows(perFile, { promptChars: billed.promptChars, factor });",
    ),
    expectFail: "分子被换掉就破",
  },
  {
    id: "replay-exec-unmatched-swallowed",
    src: "scripts/replay/verify-cause-mix.ts",
    test: "tests/replay-verify-cause-exec.test.ts",
    desc: "join 不上 tool_call 的红拍不再计数 ⇒ exec 面的分母少一块而读数看着完整。" +
      "与 gate-outcomes 同一条纪律、同一族老事故（2026-09-21 那片零假读数就是从这儿丢的）：" +
      "「差值就是尺」，本条红 = 那个差值从此没人印（规则 258/261）",
    apply: (s) => s.replace("t.unmatched++;", "t.unmatched += 0;"),
    expectFail: "绿拍不进红拍分母；join 不上的单独计数，两边都不当没有",
  },
  {
    id: "replay-exec-nonshell-in-denominator",
    src: "scripts/replay/verify-cause-mix.ts",
    test: "tests/replay-verify-cause-exec.test.ts",
    desc: "分母不再限 shell 家族 ⇒ 一条 read_file 的失败也被算进「exec 可归因占比」。" +
      "面划错之后，同一句读数说的已经不是同一件事（第十三族：同一条判据在主面／worker 面代价各量一遍）",
    apply: (s) => s.replace("    if (!SHELL_FAMILY.has(tool)) continue;", "    if (false) continue;"),
    expectFail: "非 shell 的红拍（read_file／edit_file）绝不进分母，哪怕它带着 127",
  },
  {
    id: "replay-exec-no-structure-read-as-code",
    src: "scripts/replay/verify-cause-mix.ts",
    test: "tests/replay-verify-cause-exec.test.ts",
    desc: "结构字段两只都不在时不再报「读不到」，而是落到产品谓词的缺省那一格 ⇒ " +
      "「尺读不到」与「量到了、就是代码错」同形（规则 261 的正面），分子当场虚高、占比永远好看",
    apply: (s) => s.replace("if (!hasCode && !hasTimeout)", "if (false)"),
    expectFail: "占比分子＝正证五类，且环境类是它的子集",
  },
  {
    // 第 221 页（#39）：本尺曾比产品谓词多一格（`exitCode:null + timedOut:false`）。那一态补进谓词后
    // 尺不再自己判 ⇒ 旧的「本尺多出来的那一格」针脚随之消失，这一条改指**收敛本身**：尺必须继续 delegate。
    // 摘掉 delegate 就红，且红在那条「两边同形」的用例上——它才是「一把尺而不是两把」的证人（规则 302 的收敛那一半）。
    id: "replay-exec-struct-stops-delegating",
    src: "scripts/replay/verify-cause-mix.ts",
    test: "tests/replay-verify-cause-exec.test.ts",
    desc: "结构栏不再走产品那一只谓词、自己回退成一份表 ⇒ 同一个输入两边各说一个原因，" +
      "而读数印的是尺那份。第十三族在本尺身上的最后一处残留：判据抄第二份就会各漂宽度",
    apply: (s) => s.replace("return classifyVerifyFailure({ timedOut: e.timedOut === true", "return \"code\" || classifyVerifyFailure({ timedOut: e.timedOut === true"),
    expectFail: "两边同形",
  },
  {
    id: "replay-exec-not-run-out-of-attributable",
    src: "scripts/replay/verify-cause-mix.ts",
    test: "tests/replay-verify-cause-exec.test.ts",
    desc: "分子名单少这一类 ⇒ 占比把「取消」算回模型的头上，而读数看着仍然完整。" +
      "「有正证」的口径是字段**明说**过：exitCode:null + timedOut:false 就是明说，不是「别都不是所以猜它是」",
    apply: (s) => s.replace("\"pkg-manager\", \"code\", \"not-run\"]", "\"pkg-manager\", \"code\"]"),
    expectFail: "占比分子＝正证五类",
  },
  {
    id: "replay-call-index-type-check-dropped",
    src: "scripts/replay/corpus.ts",
    test: "tests/replay-verify-cause-exec.test.ts",
    desc: "join 索引不再只看 tool_call ⇒ 任何带 id 的事件（审批两型真带）都能把工具名覆成空，" +
      "那条红拍就从分母里静默消失。取料层共用一只函数之后，这一格是**全族**的，不只 exec 面",
    apply: (s) => s.replace("if (e.type === \"tool_call\" && typeof e.id === \"string\")", "if (typeof e.id === \"string\")"),
    expectFail: "join 键只认 tool_call：同 id 的审批事件（也带 id）不许把工具名覆成空",
  },

  /* ── 第 222 页（#44）：环境线索的匹配器从三处收成一份。每条锚点各盯一处「又能各写一遍」的退路。 ── */
  {
    // 原针脚 `T_EXIT_127 = /^` 随收敛一起消失（那一行现在从取料层取），本条改指**表本身**的锚定。
    id: "replay-exec-text-anchor-lost",
    src: "scripts/replay/corpus.ts",
    test: "tests/replay-verify-cause-exec.test.ts",
    desc: "把表里那条 127 线索的行首锚摘掉 ⇒ 被跑命令自己的正文成为第二个注入面（它打印一句" +
      "「见 [exit code: 127] 一节」就算环境红）。规则 264 在这一族的落点：三个读数面共用一只表，" +
      "锚定也就只有一处可改——改这里，exec 面、verify 面、cascade 占比分子一起红（第 219 页那条锚点的同型，指针随收敛改指）",
    apply: (s) => s.replace("re: /^\\[exit code: 127\\]/mu }", "re: /\\[exit code: 127\\]/mu }"),
    expectFail: "同一段文字缩进／引用在正文中间 ⇒ 不许算线索",
  },
  {
    id: "replay-textual-kind-drops-shared-table",
    src: "scripts/replay/verify-cause-mix.ts",
    test: "tests/replay-cascade-traffic.test.ts",
    desc: "verify 面的文案栏不再吃取料层那只表 ⇒ 三个面里的一支回退成私有判据。" +
      "本条红在**跨面那条用例**上（一条输入、三个出口），不是红在措辞上（规则 304）",
    apply: (s) => s.replace('return firstEnvTextCue(r.output ?? "") ?? "code-or-unknown";', 'return "code-or-unknown";'),
    expectFail: "文案支接的是取料层那一只表",
  },
  {
    id: "replay-cascade-drops-command-sentinel",
    src: "scripts/replay/cascade-traffic.ts",
    test: "tests/replay-cascade-traffic.test.ts",
    desc: "「没有可验面」那一格不再按 command 判 ⇒ 这一面的分子少一类（旧写法只在正文里找 `(none)`，" +
      "而那串字面量任何命令都可能打印——两头都是错的，本条钉对的那一头）",
    apply: (s) => s.replace("r.command === NO_SURFACE_COMMAND || firstEnvTextCue(", "firstEnvTextCue("),
    expectFail: "哨兵那一格按 command 判",
  },
  {
    id: "replay-cascade-drops-cue-table",
    src: "scripts/replay/cascade-traffic.ts",
    test: "tests/replay-cascade-traffic.test.ts",
    desc: "占比分子不再看文案线索 ⇒ 「换贵档再红一次」的上界被算低。这条读数是**做决策用的**" +
      "（它对着一次模型往返的钱），少一类比多一类更坏：多算只是保守，少算会裁掉本该修的那一格。" +
      "指针第 222 页补⑵ 改过一次：原先指着「反向那一半」那条负控——摘掉判据时负控**照旧绿**（它要的就是不抓），" +
      "于是这条锚点当场存活（选择子只跑期望那格，别的格红了不算）。真正的 killer 是正向那格",
    apply: (s) => s.replace('|| firstEnvTextCue(String(r.output ?? "")) !== null;', "|| false;"),
    expectFail: "文案支接的是取料层那一只表",
  },
  {
    id: "replay-exec-pkg-cue-recopied",
    src: "scripts/replay/verify-cause-mix.ts",
    test: "tests/env-cue-single-source.test.ts",
    desc: "把包管理器那行的正则**再抄一遍**而不是 import 产品那一只 ⇒ 普查尺的定义位点从 0 变 1。" +
      "行为完全等价（两条正则同字），所以只能由这把普查尺抓（规则 259 点名的那类「突变不可观察」）",
    apply: (s) => s.replace("const T_PKG = PKG_MANAGER_OWN_ERROR_LINE;", "const T_PKG = /^[ \\t]*\\[?ERR_PNPM_[A-Z0-9_]+\\]?/m;"),
    expectFail: "包管理器那一行由产品谓词说话",
  },

  /* ── 第 224 页（#36）：认证面自己跑门。四格各钉一处——少钉任何一处，"cert exit=0" 就又能替红门背书。 ── */
  {
    id: "cert-gate-face-not-spawned",
    src: "scripts/head-cert.ts",
    test: "tests/cert-gate-face.test.ts",
    desc: "把跑门那一行的 spawn 目标换掉 ⇒ 认证只印读数不跑门，`cert exit=0` 退回「只代表判卷」。" +
      "这一格立起来的理由就是那条并存（规则 292）：门表被**数**过不等于门被**跑**过",
    apply: (s) => s.replace('"scripts/gates.ts", "--only=" + only', '"--version"'),
    expectFail: "跑门那一行、名单来源、退出码里的门红三项都在语句开头",
  },
  {
    id: "cert-gate-absence-only-warns",
    src: "scripts/lib/head-cert-deps.ts",
    test: "tests/cert-gate-face.test.ts",
    desc: "某道门没跑到被降成出声 ⇒ 「跑丢了」与「跑了且绿」同形（规则 261）。" +
      "gates 的进程被换掉、名单漂了、`--only` 拼错——三种成因今天都会变成绿认证",
    apply: (s) => s.replace("reds.push(`${g.name} 没跑到", "warns.push(`${g.name} 没跑到"),
    expectFail: "缺席＝红",
  },
  {
    id: "cert-gate-overbudget-turns-red",
    src: "scripts/lib/head-cert-deps.ts",
    test: "tests/cert-gate-face.test.ts",
    desc: "把「超预算」接进判定 ⇒ 认证这道门开始押在时钟上：本机负载、隔壁在跑、CI 抢核都会把绿判成红。" +
      "规则 256 在这一格的形状——**秒数只能出声，不能翻判定**（名单里的预算是给人看的成本读数）",
    apply: (s) => s.replace("if (row.ms > g.budgetMs) warns.push(", "if (row.ms > g.budgetMs) reds.push("),
    expectFail: "超预算只出声，不改判定",
  },
  {
    id: "cert-gate-shape-drift-reads-as-absent",
    src: "scripts/lib/head-cert-deps.ts",
    test: "tests/cert-gate-face.test.ts",
    desc: "名单在而形状变了（排版一改就抽不出条目）被读成「这一笔还没有这一格」⇒ 门面**无声消失**，" +
      "而这正是本格子要消灭的那件事。三态里 broken 必须与 absent 分开（规则 239/261）",
    apply: (s) => s.replace("!/export const CERT_GATES\\b/.test(manifestSrc)", "!/export const NEVER_MATCHES\\b/.test(manifestSrc)"),
    expectFail: "格子在而形状变了",
  },
  {
    id: "replay-exec-blocked-column-not-counted",
    src: "scripts/replay/verify-cause-mix.ts",
    test: "tests/replay-verify-cause-exec.test.ts",
    desc: "尺不吃生产端那一列 ⇒ ⚠️ 那格的成因② 退回「三种成因分不开」，而 0 条会被读成「这趟没有闸拦」。" +
      "新字段落地时只接生产端不接读数面，本仓已数过两次（规则 298 的 consumer 那一半）",
    apply: (s) => s.replace("t.blockedAll++;\n      bump(t.blockedMix, e.blockedBy);", "t.blockedAll++;"),
    expectFail: "被闸拦的红拍按 `blockedBy` 计数",
  },

  /* ── 第 267 页（任务 #12）：认证趟**自己**报墙钟。这一格的动因不是美学——第 265/266 两笔凭证都写着
     「整趟墙钟没实测」，因为我两次都在后台命令里忘了包 `/usr/bin/time`：靠人记住的修法不是修法，
     被度量者没记下来，那一格就永远缺一只来源（规则 245/250）。四支各钉一种坏法：
     只取收尾那半／精度抹成整秒／算出来不印／起跑那步被钉成常数。第五支接第 266 页那一族：
     新严格式没登记进抽取表 ⇒ 门报的这格进不了对账面，凭证里那句还是手抄。 ── */
  {
    id: "wallclock-drops-the-start-operand",
    src: "scripts/lib/head-cert-deps.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "只取收尾那半 ⇒ 把进程之前的时间也算进我这趟，读数与这趟干了多少活无关（恒真那一族的另一张脸）",
    apply: (s) => s.replace("const ms = Number((finishedNs - startedNs) / BigInt(1_000_000));", "const ms = Number(finishedNs / BigInt(1_000_000));"),
    expectFail: "读数只由两头之差给出，且亚秒不许被抹平",
  },
  {
    id: "wallclock-precision-rounded-to-whole-seconds",
    src: "scripts/lib/head-cert-deps.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "精度退化成整秒 ⇒ 短趟被印成 0s 或 2s：这一格第一次上账就撒谎，而 0 与「快得可以忽略」同形（规则 242）",
    apply: (s) => s.replace(".toFixed(2)", ".toFixed(0)"),
    expectFail: "读数只由两头之差给出，且亚秒不许被抹平",
  },
  {
    id: "wallclock-cell-computed-but-never-spoken",
    src: "scripts/head-cert.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "汇总那一行不再印它（换成一句「未实测」）⇒ 函数、判卷、接线全在，读数却从门脸上消失；" +
      "这一族我记过两次「只算不印／只印不接」，这次是第三种：印了一句假话",
    apply: (s) => s.replace("say(`  ${wallClockCell(CERT_STARTED_AT_NS, process.hrtime.bigint())}`);", 'say("  本趟墙钟（未实测）");'),
    expectFail: "接线：起跑真取 hrtime、汇总真印、退出码真不读它（只出声不判，规则 256/309）",
  },
  {
    id: "wallclock-start-marker-pinned-to-zero",
    src: "scripts/head-cert.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "起跑那步钉成 BigInt(0) ⇒ 报出来的是进程自己的单调时钟总量，不是这趟的时长：数看着像读数，实际什么都不是",
    apply: (s) => s.replace("const CERT_STARTED_AT_NS = process.hrtime.bigint();", "const CERT_STARTED_AT_NS = BigInt(0);"),
    expectFail: "接线：起跑真取 hrtime、汇总真印、退出码真不读它（只出声不判，规则 256/309）",
  },
  {
    id: "timing-rows-unparseable-read-as-zero-rows",
    src: "scripts/lib/head-cert-deps.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "判卷 json 坏了／形状不认识 ⇒ 返回空表而不是 null ⇒ 汇总行会印成「0 条里 0 条」，把「这一格压根没量到」报成「没有用例贴帽」（第 262 页；规则 261/262 那一族）。",
    apply: (s) => s.replace("if (jsonText === null) return null;", "if (jsonText === null) return [];"),
    expectFail: "取料：树路径配不上前缀时按 tests/ 取尾，不许整表掉进「预算没落到」",
  },
  {
    id: "timing-rows-unreadable-wording-dropped",
    src: "scripts/lib/head-cert-deps.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "汇总行里「没量到」那一支被摘掉 ⇒ 三态塌成两态，红的时候没人知道是量不了还是没问题（第 262 页）。",
    apply: (s) => s.replace('if (c.state === "unreadable")', 'if (c.state === "no-such-state")'),
    expectFail: "取料：json 取不到（null）与「0 条用例」是两件事，两态各印各的话",
  },
  {
    id: "budget-title-escape-lookup-dropped",
    src: "scripts/lib/head-cert-deps.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "「取标题时改回逐字拼引号＋标题＋引号」⇒ 判卷里写的是带转义的字面量（反斜杠转义的双引号、反斜杠本身），跑出来的标题是解了转义的那一份 ⇒ 真机因此误归 11 条（第 262 页；与变异表「松钉指针」同族）。",
    apply: (s) => s.replace("text.indexOf(JSON.stringify(title))", 'text.indexOf("${title}")'),
    expectFail: "预算四档各自成形：位置式／选项式／没写／取不到，且带转义的标题也要认得（真机 11 条栽在这一格）",
  },
  {
    id: "budget-nonliteral-merged-into-implicit",
    src: "scripts/lib/head-cert-deps.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "非字面量标题那一档被并进「没写预算」⇒ 114 条的成因说不出名字，下一次改判卷的人就找不到自己那条为什么读不到（第 262 页）。",
    apply: (s) => s.replace('return { kind: "nonliteral", fileHas: shape };', 'return { kind: "implicit" };'),
    expectFail: "非字面量标题：归因到自己那一条的形状，不许拿同一文件里第一条命中顶名（真机错过一次）",
  },
  {
    id: "near-cap-ignores-per-case-budget",
    src: "scripts/lib/head-cert-deps.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "有效预算改成一律用缺省 ⇒ 自带 15_000 的那几条被按 5000 判，名单会把「本来就慢的用例」和「撞帽的用例」混成一堆（第 262 页动因那一格）。",
    apply: (s) => s.replace('const eff = lookup.kind === "explicit" ? lookup.ms : opts.defaultBudget.ms;', "const eff = opts.defaultBudget.ms;"),
    expectFail: "贴帽判定按每条自己的有效预算，不按全局缺省；无预算那条也按缺省进同一张名单",
  },
  {
    id: "near-cap-threshold-loosened",
    src: "scripts/lib/head-cert-deps.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "贴帽阈值 0.8 改成 0.08 ⇒ 名单里塞进一堆离帽还远的用例，「点名」就失去了意义（同一条判卷里那句 ratio 断言就是拦这个的）。",
    apply: (s) => s.replace("if (row.ratio >= 0.8) near.push(row);", "if (row.ratio >= 0.08) near.push(row);"),
    expectFail: "真机整表：把留档的那一次全量 json 喂进去，档位计数与逐行重数必须同分母",
  },
  {
    id: "not-resolved-counted-as-implicit",
    src: "scripts/lib/head-cert-deps.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "「预算没落到」的计数并进「按缺省算」⇒ 取料坏了与正常态同形，那一格再也不会响（第 262 页；规则 239 三态分开印）。",
    apply: (s) => s.replace("notResolved += 1;", "implicit += 1;"),
    expectFail: "汇总行：三态分开印、名单要点名，且缺省帽的出处必须印在行里（不印就像本仓定的尺）",
  },
  {
    id: "default-budget-config-zero-accepted",
    src: "scripts/lib/head-cert-deps.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "config 里 `testTimeout: 0` 被当成有效缺省 ⇒ 每条用例的分母变 0，这一格整片读成 0 条（第六型「一片 0 先怀疑量法」）。",
    apply: (s) => s.replace("? { ms, source: `缺省＝config 里的 testTimeout=", "? { ms: VITEST_DEFAULT_TIMEOUT_MS, source: `缺省＝config 里的 testTimeout="),
    expectFail: "缺省帽是谁说了算：config 写了就用它，没写才是 vitest 的缺省，写了 0 也算没写（三态出处各不相同）",
  },
  {
    id: "cert-timing-reads-main-checkout-not-tree",
    src: "scripts/head-cert.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "贴帽读数的取料从被认证的那棵树改回脚下这份工作树 ⇒ 量的就不是那一笔（第 259 页同一格踩过，规则 244/254）。",
    apply: (s) => s.replace('try { return readFileSync(join(TREE, rel), "utf8"); } catch { return null; }', 'try { return readFileSync(join(MAIN, rel), "utf8"); } catch { return null; }'),
    expectFail: "接线：head-cert 真开了 json 出口、真算这一格、真印进汇总，而且取料在被认证的那棵树里",
  },
  {
    id: "cert-timing-cell-not-spoken",
    src: "scripts/head-cert.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "算出来了但不印 ⇒ 这一格永远听不到，下次容量红还是靠人再花三分钟复跑归因（第 262 页的动因本体）。",
    apply: (s) => s.replace("if (timingReading !== null) say(", "if (false && timingReading !== null) say("),
    expectFail: "接线：head-cert 真开了 json 出口、真算这一格、真印进汇总，而且取料在被认证的那棵树里",
  },
  {
    id: "timing-slowest-list-dropped",
    src: "scripts/lib/head-cert-deps.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "贴帽名单为空时那一串「离帽余量」不算出来 ⇒ 这一格每趟只印一个「无」，等于开了张却没有读数" +
      "（第 264 页：两趟认证实测都是 0 条贴帽，写这一档就是为了那个空态）",
    apply: (s) => s.replace("slowest: ratios.slice(0, opts.slowLimit ?? 3),", "slowest: [],"),
    expectFail: "贴帽名单为空时也要给读数：离帽余量最近的三条要印出来、按占比降序（第 264 页）",
  },
  {
    id: "timing-slowest-tail-not-printed",
    src: "scripts/lib/head-cert-deps.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "算出来却不印（守卫写成恒假）⇒ 与没算同形；而它正是「谁在往帽上爬」唯一被看见的地方（第 264 页）",
    apply: (s) => s.replace("const slack = (c.near.length === 0 || c.near.length < c.slowest.length) && c.slowest.length > 0", "const slack = false"),
    expectFail: "贴帽名单为空时也要给读数：离帽余量最近的三条要印出来、按占比降序（第 264 页）",
  },
  {
    id: "timing-slowest-unsorted",
    src: "scripts/lib/head-cert-deps.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "余量那一档不按占比排 ⇒ 印出来的三条可能都是轻的，最靠近帽的那条反而看不见；" +
      "真机整表那条判卷拿独立重数的最大值对账（同分母），排错就红（第 264 页）",
    apply: (s) => s.replace("ratios.sort(byRatio);", "ratios.sort(() => 0);"),
    expectFail: "真机整表：把留档的那一次全量 json 喂进去，档位计数与逐行重数必须同分母",
  },
  {
    // c438529 的钱轴三条锚点（规则 217：尺与针脚同笔——前两笔把机制和判卷落了就走了）。
    // A 是语义半：costSplit 里那道分流；B/C 是接线半：消费者 loop-eval.ts 用不用它、单列那格印不印。
    // 分开的理由（本仓第 12 次同族）：纯函数有判据 ≠ 汇总行在用它。
    id: "cost-split-face-collapsed",
    src: "scripts/lib/eval-validity.ts",
    test: "tests/eval-validity.test.ts",
    desc: "钱不再按「这趟算不算数」分流（恒真）⇒ validSpend 退化成 paidAll、wasted 恒 0，" +
      "而分母只数算数的趟次 ⇒ 比值又被没算数的趟次撑高（28% 白花／比值高估 39.7%，36 趟实测）",
    apply: (s) => s.replace("    if (runValidity(x.r, x.g.fails).valid) validSpend += cny;", "    if (true) validSpend += cny;"),
    expectFail: "钱也要与分母同面：没算数的趟次花的钱单列，不进「每达标任务」的分子",
  },
  {
    id: "loop-eval-money-numerator",
    src: "scripts/loop-eval.ts",
    test: "tests/eval-validity.test.ts",
    desc: "汇总那行的分子改回全量实付（旧写法）⇒ 机制还在、判卷表里纯函数那条照旧绿，" +
      "而印出来的「每达标任务」重新被没算数的趟次撑高——这条锚点钉的就是这个接缝",
    apply: (s) => s.replace("(money.validSpend / t0.pass).toFixed(4)", "(cny / t0.pass).toFixed(4)"),
    expectFail: "★接线① 汇总那行的分子取的是被留下那些趟的钱，旧的全量写法不许回来",
  },
  {
    id: "loop-eval-wasted-cell-constant",
    src: "scripts/loop-eval.ts",
    test: "tests/eval-validity.test.ts",
    desc: "白花那格印成常数 0 ⇒ 「单列、不藏」变成「单列、藏了」：分面还在但读数永远是 0，" +
      "没人能看见被剔掉的趟次到底花掉多少",
    apply: (s) => s.replace('¥${money.wastedSpend.toFixed(4)}）', '¥0.0000）'),
    expectFail: "★接线② 被剔掉那些趟花的钱要单独印出来（是真钱，修正不等于把它藏起来）",
  },
  {
    // ↓ 任务级那一层（10-22）：独立单位是「任务」而不是「趟次」——同一条任务的 N 遍**不独立**。
    // 这一族三根：两根钉判据（语义半），一根钉接缝（消费半）。分开的理由是本仓第 12 次同族：
    // 纯函数有判据 ≠ 跑器在用它。
    id: "task-rollup-atk-known-flip",
    src: "scripts/lib/eval-validity.ts",
    test: "tests/eval-validity.test.ts",
    desc: "pass@k 的「结局已知」判据翻面 ⇒ 「见着一遍达标就是定局」被读成「见着一遍达标**且**没有不可知遍」，" +
      "于是「1 遍赢＋1 遍未起步」的任务被踢出分母：一条**已经赢过**的任务被算成不可知",
    apply: (s) => s.replace(
      "const atKKnown = e.passed >= 1 || unknown === 0;",
      "const atKKnown = e.passed >= 1 && unknown === 0;",
    ),
    expectFail: "★反向那一格：1 遍赢＋1 遍未起步 ⇒ pass@k 已定局是赢，但 pass^k 不可知",
  },
  {
    id: "task-rollup-passk-known-flip",
    src: "scripts/lib/eval-validity.ts",
    test: "tests/eval-validity.test.ts",
    desc: "pass^k 的「结局已知」判据翻面 ⇒ 「见着一遍不达标就是定局」被读成「见着一遍不达标**且**没有不可知遍」，" +
      "于是「2 遍败＋1 遍未起步」的任务被踢出分母 ⇒ **一次已知的败被藏起来**" +
      "（分母越少比率越高＝不安全的方向，本仓「把红跑藏起来」那一族）",
    apply: (s) => s.replace(
      "const kKnown = e.failed >= 1 || unknown === 0;",
      "const kKnown = e.failed >= 1 && unknown === 0;",
    ),
    expectFail: "★不可知的两面：2 遍败＋1 遍未起步 ⇒ pass@k 不可知，但 pass^k 已定局是败（不许藏）",
  },
  {
    id: "task-rollup-runner-reps-wrong",
    src: "scripts/loop-eval.ts",
    test: "tests/eval-validity.test.ts",
    desc: "跑器把 rep 数传错 ⇒ 任务层的「每条任务应当几遍」全错 ⇒ 每条任务都成缺遍，" +
      "整层读数要么空要么全错，而纯函数那条判卷照旧绿——这条锚点钉的就是这个接缝",
    apply: (s) => s.replace(
      "const tr = taskRollup(rows, REPS);",
      "const tr = taskRollup(rows, REPS + 1);",
    ),
    expectFail: "★接线：跑器必须真的把这两个读数印出来（算出来不接＝没出口）",
  },
  {
    // ↓ 归因键这一族（10-02 第二笔）：基准跑器从前不建盖章器 ⇒ 整条评估链的 usage 没有模型名。
    id: "bench-usage-stamp-dropped",
    src: "scripts/loop-eval.ts",
    test: "tests/usage-attribution.test.ts",
    desc: "跑器不再给 usage 盖模型名 ⇒ readings 里的钱永远定不了「属于哪一档」，" +
      "跨模型 A/B 的差值就被当成提示词的效果（普查那条也会一起红：盖章面少了一个消费者）",
    apply: (s) => s.replace("      usageAttribution.stamp(e);\n      await log.append(e);", "      await log.append(e);"),
    expectFail: "基准跑器：stamp 也在 append 之前，且模型名取 glmDefaultModelName（不许多一份 glm-5.2 副本）",
  },
  {
    id: "model-face-unknown-degrades-to-same",
    src: "scripts/eval/report.ts",
    test: "tests/eval-report.test.ts",
    desc: "缺归因键时退化成「算同面」（fail-open）⇒ 存量语料与未盖章的跑次全被读成同一档，" +
      "这正是本仓点名的「取不到当成通过」那一族",
    apply: (s) => s.replace(
      'if ([...b, ...c].includes("")) return { state: "unknown", baseline: b, candidate: c };',
      'if (false) return { state: "unknown", baseline: b, candidate: c };',
    ),
    expectFail: "★缺归因键 ⇒ unknown，不许退化成 same（取不到＝未证，不是通过）",
  },
  {
    id: "model-face-mixed-arm-blind",
    src: "scripts/eval/report.ts",
    test: "tests/eval-report.test.ts",
    desc: "只看「两臂第一个名字是否相等」⇒ 同一臂内混了档看不见，而那连噪声带的「同配置两次」前提都不成立" +
      "（09-26 跨九条臂池化读数的教训，这一格就是它欠的那道闸）",
    apply: (s) => s.replace(
      'if (b.length !== 1 || c.length !== 1) return { state: "differs", baseline: b, candidate: c };',
      'if (false) return { state: "differs", baseline: b, candidate: c };',
    ),
    expectFail: "同一臂内混了档 ⇒ 也是 differs（那连「同配置两次」这个噪声带前提都不成立）",
  },
  {
    id: "model-face-not-printed",
    src: "scripts/eval/report.ts",
    test: "tests/eval-report.test.ts",
    desc: "算出归因面却不印 ⇒ 对账表照常出数，没人看得见两臂其实不同档（与没算同形）",
    apply: (s) => s.replace('  process.stdout.write(renderModelFace(face) + "\\n\\n");\n', ""),
    expectFail: "接线：CLI 把归因面打在表之前，且吃的是**全部**基线文件而不是第一份",
  },
  {
    // 第 447 页补（第 440 页 §7 欠的那条）：这一格此前**一条针脚都没有**——摘掉下面那行，
    // 纯函数那些用例照绿（`exitCodeOf` 自己的四态用例会红，但那是同一份模块的自证），
    // 真正没人钉的是「没盖章的存量语料会被印成一张可信表」这条端到端后果。
    id: "exit-code-identity-branch-dropped",
    src: "scripts/eval/report.ts",
    test: "tests/eval-report.test.ts",
    desc: "身份闸那一支不映射到出口码（`!identity.ok ⇒ 3` 被摘掉）⇒ 没有身份键的存量语料照旧印成「表可信」，调用方拿不到「这份表不能被当结论」这个信号",
    apply: (s) => s.replace("  if (!identity.ok) return 3;\n", ""),
    expectFail: "存量语料（读数里一个身份键都没有）⇒ 出口码 3，不是 5 也不是 0",
  },
  {
    // 第 483 页补：`outcomeGate` 是这张表唯一的误读面（2026-10-05 实跑那一次：成功率 70.8% ⇒ 5.6%，
    // 而 token 与墙钟同时"降"，逐指标各判各的就把一次跑废了印成"改动有效"）。此前 7 条
    // report.ts 锚点里**没有一条**打它——闸的判据松了，变异表照旧全绿。
    // 打的是 `blocked` 那一行的合取本身（退化项为空也放行），不是某一种指标的方向。
    id: "outcome-gate-conjunction-dropped",
    src: "scripts/eval/report.ts",
    test: "tests/eval-report.test.ts",
    desc: "结果类超带退化不再拦表（`blocked = degraded.length > 0` 被换成恒 false）⇒ 跑废的那一趟"
      + "凭成本类「变好」被整表读成改善，而这张表从来只有这一个误读面",
    apply: (s) => s.replace("  const blocked = degraded.length > 0;", "  const blocked = false && degraded.length > 0;"),
    expectFail: "故意退化的候选 ⇒ 出口码 4（合取闸咬），且禁止改善那一句必须印出来",
  },

  // ── 逐名判卷面（第 640 页补）：`ok` 把「该转绿的没绿」与「该保住的坏了」压成同一个 false ──
  // 三条各钉一半：no-face 不许算绿／unreadable 不许并进 fail／CLI 算出来必须印。
  {
    id: "named-set-no-face-counted-as-pass",
    src: "scripts/eval/report.ts",
    test: "tests/eval-report.test.ts",
    desc: "没有 judge 规格的任务（no-face）被并进 pass 桶 ⇒「没有尺」读成「绿了」；"
      + "存量语料与 2026-10-22 之前的所有基准都落在这一桶，于是这一格从此恒绿",
    apply: (s) => s.replace(
      `  if (typeof v !== "object" || v === null) return "no-face";
  const state = (v as Record<string, unknown>)["state"];`,
      `  if (typeof v !== "object" || v === null) return "pass";
  const state = (v as Record<string, unknown>)["state"];`,
    ),
    // 指向**真标题**（`mutate-anchor-titles` 那把尺逐字比 expectFail 与判卷源文本）：
    // 「没盖 ⇒ no-face」这一半正是那条用例的标题。写「取不到 ≠ 没问题」会 drift——
    // 那句话只出现在同一条用例的断言消息里，不是标题。
    expectFail: "parseReadings 读得出这一格；没盖（存量语料）⇒ no-face，不抛",
  },
  {
    id: "named-set-unreadable-folded-into-fail",
    src: "scripts/eval/report.ts",
    test: "tests/eval-report.test.ts",
    desc: "尺接了线却没接住料（unreadable）被并进 fail ⇒ 两种修法并成一种："
      + "真相在取料面（输出认不出/派生不完整），修的人却被指去改模型",
    apply: (s) => s.replace(
      `  return state === "pass" || state === "fail" || state === "unreadable" ? state : "no-face";`,
      `  return state === "pass" || state === "unreadable" ? state : "fail";`,
    ),
    expectFail: "判据自己也要被审：盖了但形状不对 ⇒ no-face，不是 pass/fail 任何一桶",
  },
  {
    id: "named-set-face-not-printed",
    src: "scripts/eval/report.ts",
    test: "tests/eval-report.test.ts",
    desc: "CLI 算出了逐名面却不喂进成表那次调用 ⇒ 与没算同形（本仓「能力发货、入口不通」那一族）",
    // 针脚里那个 `\n` 必须写成**转义序列**（模板串中的两个字符），不是真换行——
    // 写成真换行时 `replace` 找不到源文本 ⇒ 突变未生效（no-effect），锚点缴械。
    apply: (s) => s.replace(
      `  process.stdout.write(renderReport(cmp, bandSource, { namedSet }) + "\\n");`,
      `  process.stdout.write(renderReport(cmp, bandSource) + "\\n");`,
    ),
    expectFail: "接线：CLI 把逐名面喂进成表那次调用（算出来不印 ＝ 与没算同形）",
  },
  {
    // ↓ 钱的**出处**（10-02 第二族第三次命中：09-23 闸与回执分叉、09-27 usage 无归因键、这次是缺省价替所有人猜）。
    id: "price-face-missing-blind",
    src: "scripts/lib/eval-validity.ts",
    test: "tests/eval-validity.test.ts",
    desc: "不再记录缺的是哪一边 ⇒ 「不给价」这条路重新被走成「看起来能算」，" +
      "而操作者拿到的一句笼统的不可知没法修（判卷按 why 里必须点到的那两个名字来红）",
    apply: (s) => s.replace(
      '  if (!rawIn) missing.push("EVAL_PRICE_IN");\n  if (!rawOut) missing.push("EVAL_PRICE_OUT");',
      "  void missing;",
    ),
    expectFail: "价目只认操作者给全的那两个：缺一边＝不可知，而不是拿缺省凑",
  },
  {
    id: "price-face-negative-ok",
    src: "scripts/lib/eval-validity.ts",
    test: "tests/eval-validity.test.ts",
    desc: "只查是不是数、不查非负 ⇒ 负单价算出负「实付」，比值与白花两格一起变成负数（那已经不是读数，是噪声）",
    apply: (s) => s.replace(
      "if (!Number.isFinite(inPerM) || !Number.isFinite(outPerM) || inPerM < 0 || outPerM < 0) {",
      "if (!Number.isFinite(inPerM) || !Number.isFinite(outPerM)) {",
    ),
    expectFail: "坏价目也判不可知：非数、负数、空串（0 是合法价——免费档就该报得出 ¥0）",
  },
  {
    id: "money-text-unknown-degrades",
    src: "scripts/lib/eval-validity.ts",
    test: "tests/eval-validity.test.ts",
    desc: "不可知也照印 ¥0.0000 ⇒ 正是复测登记的那条「0 而不是不可知」：读者会把「这轮免费」当成实测结论",
    apply: (s) => s.replace("return Number.isFinite(v) ? `¥${v.toFixed(4)}` : PRICE_UNKNOWN;", "return `¥${v.toFixed(4)}`;"),
    expectFail: "★不可知的钱印成「价不可知」那一档，不许印成 ¥0.0000（0 是最容易被读成「没花钱」的形状）",
  },
  {
    id: "bench-price-face-bypassed",
    src: "scripts/loop-eval.ts",
    test: "tests/eval-validity.test.ts",
    desc: "跑器绕开 priceFace、把那两个缺省价写回常量 ⇒ 任何档位的 token 都会被印成同一把 ¥，" +
      "而 readings 里的 model 明明说这不是同一档（接线判卷按「真的调了 priceFace」这一句红）",
    apply: (s) => s.replace(
      "const PRICE = priceFace(process.env.EVAL_PRICE_IN, process.env.EVAL_PRICE_OUT);",
      'const PRICE = { known: true, inPerM: 0.8, outPerM: 2.8, caveat: "" };',
    ),
    expectFail: "★接线③ 跑器真的用 priceFace，旧的缺省价写法不许回来",
  },
  {
    // ↓ 重拨那一格（10-02，能力 4「失败能重试、换路径，而不是卡死」落在度量台上的那一半）。
    id: "retry-retries-model-failure",
    src: "scripts/lib/eval-retry.ts",
    test: "tests/eval-retry.test.ts",
    desc: "非 provider 打断也重拨 ⇒ 模型自己干坏事（改了判卷面、verify 没过）拿到第二次机会刷分，" +
      "而分母那一头仍然判它「算数」⇒ 同一趟在两处得到相反处理（本仓最忌的形状）",
    apply: (s) => s.replace(
      '    return { retry: false, why: "不是 provider 侧打断 ⇒ 那是被度量的行为，重拨等于给它第二次机会刷分" };',
      '    return { retry: true, waitMs: RETRY_BASE_MS, why: "探针：坏行为也再拨" };',
    ),
    expectFail: "★模型自己干坏事 ⇒ 不重拨（这是被度量的行为，不是故障）",
  },
  {
    // ↓ 白名单少一枚（2026-10-13）：`cn:hy3` × B1 那趟模型诊断对了、方案批了，写盘前被 60s
    //   静默掐断；而这张表不认 `停滞超时` ⇒ 那一趟既被算成「模型没做到」又不重拨。
    //   两处是同一个洞（`retryVerdict` 与 `runValidity` 共用 `providerInterruptOf`）⇒ 一条锚点杀两处。
    id: "provider-interrupt-whitelist-drops-stall",
    src: "scripts/lib/eval-validity.ts",
    test: "tests/eval-validity.test.ts",
    desc: "白名单摘掉「停滞超时」⇒ 被对端静默掐断的趟次重新被算成「模型没做到」进分母" +
      "（同一枚洞的另一半：`retryVerdict` 也不再重拨它）",
    apply: (s) => s.replace("socket hang up|停滞超时/iu", "socket hang up/iu"),
    expectFail: "起步后被「停滞超时」打断",
  },
  {
    id: "retry-wait-cap-dropped",
    src: "scripts/lib/eval-retry.ts",
    test: "tests/eval-retry.test.ts",
    desc: "去掉等待帽 ⇒ 日配额那种「要等到明天」也被当成抖动，跑器真的坐在那里等，" +
      "外层超时把它杀掉时读数一条都不剩（比不重拨更坏）",
    apply: (s) => s.replace("  if (waitMs > waitCapMs) {", "  if (false) {"),
    expectFail: "★日配额（reset 在明天）⇒ 判不重拨，并把要等多久说出口",
  },
  {
    id: "retry-max-attempts-blind",
    src: "scripts/lib/eval-retry.ts",
    test: "tests/eval-retry.test.ts",
    desc: "判据不看帽（只剩执行壳那一道闸）⇒ 纯函数这一头永远说「再拨」，" +
      "而「拨了几趟」的账要由跑器自己数——两处不同面时就没人知道试到了第几趟",
    apply: (s) => s.replace("  if (attempt >= maxAttempts) {", "  if (false) {"),
    expectFail: "到帽就停，并把帽印出来（不靠永远试下去把跑器挂死）",
  },
  {
    id: "bench-retry-not-wired",
    src: "scripts/loop-eval.ts",
    test: "tests/eval-retry.test.ts",
    desc: "跑器把判据换成恒不重拨 ⇒ 机制与判卷全绿，而真跑一次都没重试过" +
      "（第 12 次同族：判据在、接线这头零观测）",
    apply: (s) => s.replace(
      '      (res, n) => retryVerdict([...grade(res, t).fails, res.exitError ?? ""], n, { nowMs: Date.now() }),',
      '      (res, n) => retryVerdict(grade(res, t).fails, n, { nowMs: Date.now() }),',
    ),
    expectFail: "接线：跑器真的走 withProviderRetry，判据吃的除了那份 fails 还要带上全文 exitError",
  },
  {
    id: "retry-reset-read-from-truncated-face",
    src: "scripts/lib/eval-retry.ts",
    test: "tests/eval-retry.test.ts",
    desc: "reset 只从「打断那一条」里找 ⇒ 而判卷那条被 `grade` 截到 60 字、reset 在 150 字往后" +
      "（36 趟实测：fails 里带 reset 0 条，exitError 里 33 条）⇒ 等不起就不等那一档变成死代码，" +
      "跑器照样为日配额坐等两轮",
    apply: (s) => s.replace("const reset = resetEpochMs(fails.join(\" \"));", "const reset = resetEpochMs(interrupt);"),
    expectFail: "★真语料的形状：打断那条被截到 60 字，reset 只在另一条全文里 ⇒ 仍然判不重拨",
  },
  /* ---- held-out（隐藏验收面）这一族的针脚 ----
   * 这一面的病不是「跑不出来」，是「跑出来了但判据不说话」：装了一半照跑、没有面当成过、
   * 红的当成绿、expects 没点名也去判——四种都能把「模型哄绿了可见测试」写成「模型过了基准」。
   * 所以十条里六条钉判卷分支，两条钉数据层的收口（没给≠给坏、src 不许住在靶子里），
   * 一条钉跑器的安装闸门，最后一条把安装块**真的搬到改动清单之前**——那是唯一没人守的顺序不变量。 */
  {
    id: "heldout-dest-escape-both-guards-off",
    src: "scripts/lib/eval-heldout.ts",
    test: "tests/eval-heldout.test.ts",
    desc: "隐藏文件的 dest 越界检查两道一起关掉 ⇒ 装隐藏题变成往副本外写盘" +
      "（单关一道杀不掉：resolve 后 containment 那道会兜住，这条因此一次改两处——" +
      "「同一判据两份副本」要红就得两份一起拆，否则量到的是防御纵深不是缺陷）",
    apply: (s) => s
      .replace('  if (parts.some((p) => p === "..")) return "含 .. 的越界路径";', "  if (false) return null;")
      .replace("    if (!resolve(to).startsWith(resolve(workDir) + \"/\")) {", "    if (false) {"),
    expectFail: "dest 越界 ⇒ 一条错误，且绝不先写出去",
  },
  {
    id: "heldout-no-face-counted-green",
    src: "scripts/lib/eval-heldout.ts",
    test: "tests/eval-heldout.test.ts",
    desc: "任务集没配隐藏面时判成绿 ⇒ 「没有尺」被读成「这一格过了」，" +
      "基准的通过率凭空涨一档（本仓 0 而不是不可知 那一族）",
    apply: (s) => s.replace(
      '  if (spec === undefined) return { state: "no-face", reason: "没有 held-out 验收面（任务集没给 heldOut ⇒ 这条判不了，不算通过）" };',
      '  if (spec === undefined) return { state: "green", reason: "" };',
    ),
    expectFail: "六种状态各就各位（顺序：没面 → 没装齐 → 没跑 → 跑不起 → 红 → 绿）",
  },
  {
    id: "heldout-red-counted-green",
    src: "scripts/lib/eval-heldout.ts",
    test: "tests/eval-heldout.test.ts",
    desc: "隐藏套件退出码非 0 也判绿 ⇒ 这一面唯一的用途（分开「修对根因」与「哄绿可见测试」）消失，" +
      "而读数看起来比从前更好",
    apply: (s) => s.replace("  if (!run.ok) {", "  if (false) {"),
    expectFail: "点名了 ⇒ 五种状态各给一条**互不相同**的原因，绿的返回空",
  },
  {
    id: "heldout-expects-gate-dropped",
    src: "scripts/lib/eval-heldout.ts",
    test: "tests/eval-heldout.test.ts",
    desc: "不看 expects 就一律判 held-out ⇒ 内建 I1…I4 与所有没配隐藏面的条目集体 FAIL，" +
      "把「这一格没人要求」写成「模型做不到」（方向相反的同一格：判卷不该自己扩大范围）",
    apply: (s) => s.replace("  if (!expects.includes(HELD_OUT_EXPECT)) return [];", "  if (false) return [];"),
    expectFail: "expects 没点名要它 ⇒ 一条都不判（内建任务不受影响）",
  },
  {
    id: "heldout-output-cap-dropped",
    src: "scripts/lib/eval-heldout.ts",
    test: "tests/eval-heldout.test.ts",
    desc: "隐藏验收的原始输出不设帽 ⇒ 整条读数被 JSON.stringify 进 readings.json，" +
      "一条超时命令能把读数文件灌成几十万字（外界文本有界性那一族的第 N 格）",
    apply: (s) => s.replace(
      "  return { ran: true, ok: r.ok, exitCode, output: capHeldOutOutput(output) };",
      "  return { ran: true, ok: r.ok, exitCode, output };",
    ),
    expectFail: "输出有帽：整条读数会被 JSON.stringify 进 readings.json，不许灌进几十万字",
  },
  {
    id: "heldout-partial-install-runs",
    src: "scripts/loop-eval.ts",
    test: "tests/eval-heldout.test.ts",
    desc: "隐藏文件装了一半也照跑 ⇒ 半份验收跑出的绿被当成整份过了" +
      "（装齐那道闸一变真，这一格的分子就比实际验证过的多）",
    apply: (s) => s.replace(
      "    if (heldOutInstallErrs.length === 0) heldOutRun = await runHeldOut(work, t.spec.heldOut, EVAL_EXEC);",
      "    heldOutRun = await runHeldOut(work, t.spec.heldOut, EVAL_EXEC);",
    ),
    expectFail: "装不全就不跑：半份隐藏验收得出的绿是假绿",
  },
  {
    id: "heldout-install-before-change-list",
    src: "scripts/loop-eval.ts",
    test: "tests/eval-heldout.test.ts",
    desc: "把安装块整段搬到改动清单**之前** ⇒ 我装的隐藏文件落进 tests/ 下，" +
      "被 `touchedJudge` 当成模型改了判卷面、被 `onlySrcChanged` 当成越界，" +
      "两种假红都算在模型头上（这条只能用「真的搬一次」来钉：位置不变量没法靠改一个字表达）",
    apply: (s) => {
      const start = s.indexOf("  /* held-out 验收：");
      const end = s.indexOf("\n  // 先显式摘掉软链");
      const anchor = "  const orig = (await listFiles(appDir))";
      if (start < 0 || end < 0 || s.indexOf(anchor) < 0) return s + "\n/* 探针：锚点找不到 ⇒ 本条不生效，判卷会红 */";
      const block = s.slice(start, end);
      return (s.slice(0, start) + s.slice(end)).replace(anchor, block + "\n" + anchor);
    },
    expectFail: "installHeldOut 的位置在 touchedJudge / onlySrcChanged 之后、副本删除之前",
  },
  /* ---- head-import-face 的「模板字面量是数据」那一半（2026-10-02 我自己被它假红过一次）----
   * 两个方向都要钉：涂白没了 ⇒ 判卷里嵌的源码片段变成假悬空（假红，认证树红一道门）；
   * 涂白过头 ⇒ 真边/真导出被一起涂掉（**假绿**，比假红坏得多——第一版用裸 scanner 就真炸出过这一侧，
   * 它把正则字面量里的引号读成字符串起点，缺失符号从 1 条炸成 300+ 条）。 */
  {
    id: "hif-blank-spans-noop",
    src: "scripts/head-import-face.ts",
    test: "tests/head-import-face.test.ts",
    desc: "涂白整个失效 ⇒ `String.raw` 里那段假源码重新算成真边，" +
      "判卷自己写的靶子内容把 HEAD 判成悬空（假红：认证树红一道门，而没人改错任何东西）",
    apply: (s) => s.replace("  if (ranges.length === 0) return text;", "  if (true) return text;"),
    expectFail: "模板字面量里的源码不算边，字面量外的真语句照旧算",
  },
  {
    id: "hif-imports-read-raw-text",
    src: "scripts/head-import-face.ts",
    test: "tests/head-import-face.test.ts",
    desc: "只把 `parseImportStatements` 的一半改回读原文（另一半还涂着）⇒ 同一判据两份副本、宽度不同" +
      "（本仓第十三族）：模块那一半重新假红，符号那一半安静如常，读的人只会看到一个莫名其妙的悬空",
    apply: (s) => s.replace("  for (const m of code.matchAll(STATEMENT)) {", "  for (const m of text.matchAll(STATEMENT)) {"),
    expectFail: "模板字面量里的源码不算边，字面量外的真语句照旧算",
  },
  {
    id: "hif-exports-read-raw-text",
    src: "scripts/head-import-face.ts",
    test: "tests/head-import-face.test.ts",
    desc: "导出那一半不涂白 ⇒ 模板字面量里那句 `export function cheat() {}` 被当成这份文件真导出了它，" +
      "缺失符号于是被读成存在（**假绿**——第 131 页那笔事故剩下的正是符号那一半）",
    apply: (s) => s.replace(
      "  // 不涂就会把这个名字当成这份文件真导出了它 ⇒ 缺失符号被读成存在（**假绿**，比假红坏）。\n  const code = blankDataSpans(text);",
      "  // 不涂就会把这个名字当成这份文件真导出了它 ⇒ 缺失符号被读成存在（**假绿**，比假红坏）。\n  const code = text;",
    ),
    expectFail: "导出一半也不认模板里的假源码（那一侧的后果是假绿：缺失符号被读成存在）",
  },
  /* ---- 基准装配面（2026-10-02 立项，能力 5 那一格的**测量有效性**；2026-10-06 第 407 页补装配裁决那一半）----
   * 动因：`scripts/loop-eval.ts` 自称「装配 = 生产同款」，实际递给 runLoop 的参数里
   * 一枚产品缺省开的开关都没有 ⇒ 盘上 49 趟跑批的 `autoVerifyBeat` 全是 false，
   * 被读成「模型从不自己验证」。这 14 条钉的是**表态表与真参数不许分叉**：
   * 表说装了 ⇒ 参数里得真装着；表没表态 ⇒ 不许出数；缺省那副**就是**产品同档（业主 2026-10-05 裁决）。 */
  {
    id: "asm-default-face-not-same",
    src: "scripts/lib/eval-assembly.ts",
    test: "tests/eval-assembly.test.ts",
    desc: "把 `BENCH_KNOBS.autoVerify` 的缺省表态从 `same` 抄回 `off-here` ⇒ 业主那半裁决（只补装配、不授权花钱）" +
      "被静默撤回：跑器照旧不装闸，而 `autoVerifyBeat:false` 又会在新留档里被读成「模型不自己验证」",
    apply: (s) => s.replace('    face: "same",\n    why: "收束闸在 loop.ts:573', '    face: "off-here",\n    why: "收束闸在 loop.ts:573'),
    expectFail: "缺省那副：闸与产品同档 ⇒ 递出去的参数里真装着 autoVerify（2026-10-05 补的装配裁决）",
  },
  {
    id: "asm-projection-always-on",
    src: "scripts/lib/eval-assembly.ts",
    test: "tests/eval-assembly.test.ts",
    desc: "投影不看 face 只要键名对就装 ⇒ 摘闸那副（对照臂）也会给 runLoop 塞 autoVerify，" +
      "「两臂的读数长得一样」正是这一族最贵的形状：下一次裁决要的就是这两副的差值",
    apply: (s) => s.replace('r.key === key && (r.face === "same" || r.face === "on-here")', 'r.key === key'),
    expectFail: "摘闸那副（--no-auto-verify）：表说没装 ⇒ runLoop 收不到 autoVerify（对照臂的真形状）",
  },
  {
    id: "asm-projection-never-on",
    src: "scripts/lib/eval-assembly.ts",
    test: "tests/eval-assembly.test.ts",
    desc: "投影恒返空对象 ⇒ 表说装了、参数里却什么都没有，读数与装配第二次分叉" +
      "（本案原始形状的反向：从前是表不存在，现在是表说谎而参数照旧）",
    apply: (s) => s.replace("...(autoVerify ? { autoVerify: true as const } : {}),", "...(false ? { autoVerify: true as const } : {}),"),
    expectFail: "带 --auto-verify 那副：表改口成 same ⇒ 递出去的参数里真装着 autoVerify",
  },
  {
    id: "asm-default-filter-widened",
    src: "scripts/lib/eval-assembly.ts",
    test: "tests/eval-assembly.test.ts",
    desc: "筛选从「缺省为真」放宽成「键在场」⇒ 表格混进 provider/model/帽值这些根本不该表态的东西，" +
      "少装计数虚高，而缺省关的键被当成缺陷登记",
    apply: (s) => s.replace("filter(([, v]) => v === true)", "filter(([, v]) => v !== undefined)"),
    expectFail: "缺省关的键不进这张表",
  },
  {
    id: "asm-undeclared-detector-neutered",
    src: "scripts/lib/eval-assembly.ts",
    test: "tests/eval-assembly.test.ts",
    desc: "查无表态的探测器恒返空 ⇒ 谁翻一枚缺省而没写表，装配面照样印得整整齐齐，" +
      "登记表自己烂掉而读数照印（本仓对登记表一律要求 stale 也要红）",
    apply: (s) => s.replace(
      'export function undeclaredKnobs(rows: readonly AssemblyRow[]): AssemblyRow[] {\n  return rows.filter((r) => r.face === "undeclared");',
      'export function undeclaredKnobs(rows: readonly AssemblyRow[]): AssemblyRow[] {\n  return rows.filter(() => false);',
    ),
    expectFail: "缺省新开一枚键而表里查无 ⇒ 判成 undeclared 并指回登记处",
  },
  {
    id: "asm-override-flag-ignored",
    src: "scripts/lib/eval-assembly.ts",
    test: "tests/eval-assembly.test.ts",
    desc: "`--no-auto-verify` 进了命令行却不改口 ⇒ 对照臂成了装饰：带它跑出来的读数与不带它一模一样，" +
      "而下一次裁决「准确率 vs 每成功任务花多少」要的就是这两副对照",
    apply: (s) => s.replace("  if (noAutoVerify) {", "  if (false) {"),
    expectFail: "少装计数：缺省三枚、摘闸那副四枚，且差的正是 autoVerify 那一枚",
  },
  {
    id: "asm-face-render-dropped",
    src: "scripts/lib/eval-assembly.ts",
    test: "tests/eval-assembly.test.ts",
    desc: "渲染串整个返空 ⇒ 读数行、日志、feasibility 三处的装配面同时变成空白，" +
      "`autoVerifyBeat:false` 又回到没有解释的那种形状",
    apply: (s) => s.replace(
      '  return rows.map((r) => `${r.key}:${r.face}`).join(" ");',
      '  return "";',
    ),
    expectFail: "渲染串逐枚带 key:face，顺序稳定（同一副装配两次要一模一样）",
  },
  {
    id: "asm-eval-override-not-passed",
    src: "scripts/loop-eval.ts",
    test: "tests/eval-assembly.test.ts",
    desc: "算了 overrides 却没递进 assemblyRows（第三个实参写没）⇒ 旗标改了口而表没跟上；" +
      "本仓「算出来不接」那一族在这里的形状是少一个入参",
    apply: (s) => s.replace(
      "assemblyRows(DEFAULT_SETTINGS, undefined, assemblyOverrides(AUTO_VERIFY, AUTO_VERIFY_REPAIR, NO_AUTO_VERIFY))",
      "assemblyRows(DEFAULT_SETTINGS)",
    ),
    expectFail: "缺省表与旗标改口是同一条调用算出来的",
  },
  {
    id: "asm-conflict-flag-refusal-dropped",
    src: "scripts/loop-eval.ts",
    test: "tests/eval-assembly.test.ts",
    desc: "两枚互相矛盾的旗标（--auto-verify 与 --no-auto-verify）不再拒跑 ⇒ 后一枚悄悄赢，" +
      "两副装配混进同一趟读数，而这张表唯一在防的就是「读数不知道自己跑在哪副装配上」",
    apply: (s) => s.replace("if (AUTO_VERIFY && NO_AUTO_VERIFY) {", "if (false) {"),
    expectFail: "两枚矛盾的旗标一起带 ⇒ 拒跑退 2，且排在第一趟跑批之前",
  },
  {
    id: "asm-no-auto-verify-flag-unparsed",
    src: "scripts/loop-eval.ts",
    test: "tests/eval-assembly.test.ts",
    desc: "命令行里的 --no-auto-verify 没被解析（常量 false 顶上去）⇒ 用户说了摘闸、跑器照旧装着，" +
      "对照臂在命令行上不存在了而读数行仍写着 autoVerify:same",
    apply: (s) => s.replace(
      'const NO_AUTO_VERIFY = argv.includes("--no-auto-verify");',
      "const NO_AUTO_VERIFY = false;",
    ),
    expectFail: "摘闸旗标真的解析进这次调用：三枚旗标不许只吃前两枚",
  },
  {
    id: "asm-eval-runloop-knob-not-spread",
    src: "scripts/loop-eval.ts",
    test: "tests/eval-assembly.test.ts",
    desc: "投影算出来了、`runLoop({...})` 里却没摊开它 ⇒ 能力 5 的收束闸依旧不装，" +
      "读数行上一句「装了」变成纯文案（正是 49 趟那批读数的成因）",
    apply: (s) => s.replace("      ...BENCH_RUNLOOP_KNOBS,\n      provider:", "      provider:"),
    expectFail: "递给 runLoop 的是投影结果，不是第二个 if",
  },
  {
    id: "asm-eval-guard-disabled",
    src: "scripts/loop-eval.ts",
    test: "tests/eval-assembly.test.ts",
    desc: "未表态的键只印不拦 ⇒ 分母不完整照样出数，而每一行读数都带着一个没人解释过的 false；" +
      "拒绝出数这一条与 `--tasks` 解析报错同一口径",
    apply: (s) => s.replace("if (ASSEMBLY_UNDECLARED.length > 0) {", "if (false) {"),
    expectFail: "未表态 ⇒ 在第一趟跑批之前退，且退出码是 1",
  },
  {
    id: "asm-eval-feasibility-print-dropped",
    src: "scripts/loop-eval.ts",
    test: "tests/eval-assembly.test.ts",
    desc: "零花费那条路不印装配面 ⇒ 决定「要不要花钱跑」的人只看得到可跑几条，" +
      "看不到跑出来的是哪副装配，钱花完了才发现这一格",
    apply: (s) => s.replace(
      '  console.log("[feasibility] 装配面（产品缺省开的键 ↔ 本跑器）：" + ASSEMBLY_FACE);',
      "  // 这行没接",
    ),
    expectFail: "零花费那条路（--feasibility）也印装配面，且印在退出之前",
  },
  {
    id: "asm-eval-reading-face-dropped",
    src: "scripts/loop-eval.ts",
    test: "tests/eval-assembly.test.ts",
    desc: "读数格里的装配面写成空串 ⇒ 日志那一行不在 readings.json 里，" +
      "事后拿 JSON 做 A/B 的人只剩一个孤零零的 `autoVerifyBeat:false`（归因面与读数面分家那一族）",
    apply: (s) => s.replace("    assembly: ASSEMBLY_FACE,", "    assembly: \"\","),
    expectFail: "读数每一格自带装配面：JSON 里不许只剩 autoVerifyBeat 一个孤零零的 false",
  },
  /* ---- 第二拍（返修）与闸补拍的计数（10-02 第二簇，任务 #12）---- */
  {
    id: "asm-pairing-rule-dropped",
    src: "scripts/lib/eval-assembly.ts",
    test: "tests/eval-assembly.test.ts",
    desc: "摘闸那一副也把它写进表 ⇒ 读数行上一枚没人承诺过的 `on-here`，而闸根本没装——" +
      "配对从「闸在不在」被放宽成「旗标带没带」，而缺省装了闸以后这两者已经不是一个东西",
    apply: (s) => s.replace("  if (!noAutoVerify && autoVerifyRepair) {", "  if (autoVerifyRepair) {"),
    expectFail: "缺省关而这一趟装了 ⇒ 进表记 on-here（看的是闸在不在，不是旗标带没带）",
  },
  {
    id: "asm-projection-pairing-failopen",
    src: "scripts/lib/eval-assembly.ts",
    test: "tests/eval-assembly.test.ts",
    desc: "投影这一头的配对保护摘掉 ⇒ 表自相矛盾（有返修、没闸）时照样把 `autoVerifyRepair` 递进 runLoop，" +
      "而 loop 那一边那一拍永远走不到（递了一个没对象的键）",
    apply: (s) => s.replace('...(autoVerify && installed("autoVerifyRepair") ?', '...(installed("autoVerifyRepair") ?'),
    expectFail: "投影不给没闸的返修：只有闸也装着时才递 autoVerifyRepair",
  },
  {
    id: "asm-on-here-not-counted-as-installed",
    src: "scripts/lib/eval-assembly.ts",
    test: "tests/eval-assembly.test.ts",
    desc: "投影只认 `same` ⇒ `on-here` 那一枚（对照臂）永远装不上：表上写着装了、参数里没有，" +
      "而读数会被当成对照臂引用——方向与本簇第一格相反的分叉",
    apply: (s) => s.replace('(r.face === "same" || r.face === "on-here")', '(r.face === "same")'),
    expectFail: "两枚旗标都带 ⇒ 投影出的参数两枚都装着（对照臂的真实形状）",
  },
  {
    id: "asm-beats-count-truthy",
    src: "scripts/lib/eval-validity.ts",
    test: "tests/eval-validity.test.ts",
    desc: "计数从 `=== true` 放宽成 truthy ⇒ 脏值（1、「true」这类）被算成闸补的一拍，" +
      "而生产者只会写 `true`——这一格多出来的分子没有对应的事件",
    apply: (s) => s.replace("n + (r.auto === true ? 1 : 0)", "n + (r.auto ? 1 : 0)"),
    expectFail: "脏值不算一拍：生产者只会写 true，truthy 判定会把 1／「true」收进分子",
  },
  {
    id: "asm-beats-count-not-wired",
    src: "scripts/loop-eval.ts",
    test: "tests/eval-assembly.test.ts",
    desc: "计数算出来却把读数那位写成常数 0 ⇒ 「算出来没出口」原样复发（规则 245 那一族）：" +
      "JSON 里那一格永远 0，≥2 拍这条链路有没有走通再一次变成说法",
    apply: (s) => s.replace("autoVerifyBeat: harnessBeats > 0, autoVerifyBeats: harnessBeats,", "autoVerifyBeat: harnessBeats > 0, autoVerifyBeats: 0,"),
    expectFail: "Reading 两格都从同一个值来：布尔位与计数不许各读各的",
  },
  {
    id: "asm-beats-second-producer",
    src: "scripts/loop-eval.ts",
    test: "tests/eval-assembly.test.ts",
    desc: "跑器里请回旧的那份 `some(auto===true)` 自己折算 ⇒ 同一谓词两份副本、宽度不同（第十三族）：" +
      "lib 改了口径而跑器照旧，读数和判卷各说各话",
    apply: (s) => s.replace("const harnessBeats = autoVerifyBeats(verifies);", "const harnessBeats = verifies.some((v) => v.auto === true) ? 1 : 0;"),
    expectFail: "旧的那份 some(auto) 判定不许回来：同一谓词两份副本迟早宽度不同",
  },
  /* ── 第 334 页 · #41：认证那一趟的「温度」要落进工件（四枚各钉一侧）──────────────── */
  {
    id: "cert-provenance-unknown-branch-dropped",
    src: "scripts/lib/head-cert-provenance.ts",
    test: "tests/head-cert-provenance.test.ts",
    desc: "摘掉 `measured` 那一半 ⇒ `--skip-test` 那趟并发面根本没采，却被读成「起前 0／跑完 0 ⇒ 独占 ⇒ 可引用」。"
      + "「没取到」与「取到 0」是两个数（规则 196/239），这一格错了就是把负载态的秒数盖了章",
    apply: (s) => s.replace("  if (!measured || before < 0 || after < 0) return \"unknown\";", "  if (before < 0 || after < 0) return \"unknown\";"),
    expectFail: "三态各自出声：两端独占／有别人在跑／取不到（不可知不许由 0 顶成独占）",
  },
  {
    id: "cert-provenance-doc-temperature-line-dropped",
    src: "scripts/lib/head-cert-provenance.ts",
    test: "tests/head-cert-provenance.test.ts",
    desc: "把头部那行温度摘掉 ⇒ 文件照样落盘、读数照样原样，但它回答不了唯一要回答的问题"
      + "（「这趟的秒数能不能引用」），于是又回到靠人记——这一格存在的全部理由就是那一行",
    apply: (s) => s.replace("    `- ${citableLine(o.citable)}`,", "    ``,"),
    expectFail: "正文是**原样交回**那些行：不吞行、不摘要、顺序不动；出处两格（rev 与收尾复核）都在头部",
  },
  {
    id: "cert-provenance-wiring-hardcoded",
    src: "scripts/head-cert.ts",
    test: "tests/head-cert-provenance.test.ts",
    desc: "温度写死成 citable（算出来不接＝规则 230 那一格）⇒ 每一次负载态认证都留下一份"
      + "「看起来被背书」的读数文件，而凭证页最爱引的恰恰是这些秒数",
    apply: (s) => s.replace("  const citable = citableOf(psBefore, psAfter, testStatus !== null);", "  const citable = \"citable\" as const; void citableOf;"),
    expectFail: "★接线：认证真把这份文档写出去，而且写在 `process.exit` 之前；失败要出声",
  },
  {
    id: "cert-provenance-stamp-colon-back",
    src: "scripts/lib/head-cert-provenance.ts",
    test: "tests/head-cert-provenance.test.ts",
    desc: "把冒号放回目录名 ⇒ 又造出 `head-cert-…-15:55/` 这种路径（不同平台/后续 grep 都要引号兜着）。"
      + "这一枚钉的是**本页真跑抓到的那个缺陷**：判卷喂格式良好的串看不见调用方怎么拼时间戳，"
      + "只有端到端那一趟露头——所以把它抽成纯函数之后，还要留一条「不许含冒号」的断言钉住形状",
    apply: (s) => s.replace("return m === null ? \"未知时刻\" : `${m[1]}-${m[2]}${m[3]}`;", "return m === null ? \"未知时刻\" : `${m[1]}-${m[2]}:${m[3]}`;"),
    expectFail: "时间戳：分钟精度、结果里不许有冒号（第一版把这段写在调用方，冒号漏进目录名，只有真跑一次才看得见）",
  },
  {
    id: "cert-provenance-head-stamp-line-dropped",
    src: "scripts/lib/head-cert-provenance.ts",
    test: "tests/head-cert-provenance.test.ts",
    desc: "摘掉头部的生成时刻那一行 ⇒ 时刻只剩目录名里那一串，而它到底是 UTC 还是本地没人说（本笔冒烟实测：目录名写 "
      + "`2026-10-03-1614`，台账页的本地日期已经是次日凌晨）。这份工件存在的理由就是「出处」，"
      + "时刻没有口径＝页上引它的人只能靠猜",
    apply: (s) => s.replace("`- 生成时刻=${o.stamp}（UTC", "`（UTC"),
    expectFail: "头部自带生成时刻与时区口径（那串数字从前只长在目录名里，打开文件也要读得到它是 UTC）",
  },
  /* ── 第 325 页 · 返修那一格（能力 5 的分子：红过之后那枚绿算谁的账）──────────────── */
  {
    id: "eval-recovery-counts-greens-before-first-red",
    src: "scripts/lib/eval-validity.ts",
    test: "tests/eval-validity.test.ts",
    desc: "把「只看第一枚红之后的绿」放宽成全表找绿 ⇒ 红之前那枚绿顶了账，"
      + "于是「先验一次（绿）→ 改坏了（红）→ 没收住」这种趟次被记成一次成功返修",
    apply: (s) => s.replace("  const greens = beats.slice(firstRed + 1).filter((b) => b.ok);", "  const greens = beats.filter((b) => b.ok);"),
    expectFail: "只数**第一枚红之后**的绿：红之前那枚绿不能顶账",
  },
  {
    id: "eval-recovery-harness-green-credited-to-model",
    src: "scripts/lib/eval-validity.ts",
    test: "tests/eval-validity.test.ts",
    desc: "丢掉归属这一半（只要红后有绿就算模型返修）⇒ 收束闸替模型补的那一拍被记到模型头上，"
      + "而「闸补的绿」正是这一格存在的理由（旧布尔位 autoVerifyBeat 把两者压成同一个 true）",
    apply: (s) => s.replace('  if (greens.some((b) => b.by === "model")) return "modelRecovery";', '  if (greens.length > 0) return "modelRecovery";'),
    expectFail: "★红过、绿了，但那几枚绿全是闸补的 ⇒ harnessOnly：账记 harness，不记模型",
  },
  {
    id: "eval-recovery-unknown-attribution-guesses-model",
    src: "scripts/lib/eval-validity.ts",
    test: "tests/eval-validity.test.ts",
    desc: "归属读不出时倒向「模型」那一侧（把「没量到」当「量到了且没问题」）⇒ 三态里的 unknown 退化，"
      + "旧归档（既没 auto 键也 join 不上）会被整批读成真返修",
    apply: (s) => s.replace('  return "attributionUnknown";', '  return "modelRecovery";'),
    expectFail: "归属读不出的一拍在场时不许猜 ⇒ attributionUnknown（宁可说不出，也不替模型认账）",
  },
  {
    id: "eval-recovery-criterion-reads-last-green-only",
    src: "scripts/lib/eval-expects.ts",
    test: "tests/eval-validity.test.ts",
    desc: "判据名接上了、取值却退回「最后一拍绿没绿」⇒ 这一格又变回 verifyOk 的同义反复，"
      + "而读数行与汇总行照印，没人看得出来（规则 228：判据要站在被度量那件事的决策点上）。"
      + "第 327 页这一支从跑器搬进分支表 ⇒ 针脚跟着搬家，判卷那半边同时把旧位置钉死",
    apply: (s) => s.replace('r.verifyRecovery !== "modelRecovery"', "r.verifyOkLast !== true"),
    expectFail: "★接线① 那一支吃的是这一格，不是「最后一拍绿没绿」（旧口径不许藏在同一支里当第二把尺）",
  },
  {
    id: "eval-recovery-sentinel-string-recopied",
    src: "scripts/loop-eval.ts",
    test: "tests/eval-validity.test.ts",
    desc: "消费端抄第二份哨兵字符串（不跟生产端改名）⇒ 生产端改那天起，闸补的那一拍全被 join 成「模型自调」，"
      + "返修分子凭空上涨而没有任何一格会红（第十一族「去名字化是幻觉」的反面）",
    apply: (s) => s.replace("verifyBeatFace(v, verifyCallIds, HARNESS_VERIFY_CALL_ID)", 'verifyBeatFace(v, verifyCallIds, "harness-auto-verify")'),
    expectFail: "★接线③ 归属判定吃的是生产端导出的那枚哨兵，且谓词只有 `verifyBeatFace` 一份",
  },
  {
    id: "eval-expect-branch-table-key-drifts",
    src: "scripts/lib/eval-expects.ts",
    test: "tests/eval-task-set.test.ts",
    desc: "登记表里那一枚还有、分支表里少了它 ⇒ 名字合法、解析放行，但那格**没人判**，"
      + "读数照印——两支各写一份就会漂（这一页的修法就是让它们键集相等且由判卷核）",
    apply: (s) => s.replace('  wroteTest: (r) => (!r.wroteTests ? "没补测试" : null),', "  // 漂：wroteTest 的分支被摘掉"),
    expectFail: "★两支键集相等：登记的每一枚都有分支，分支里的每一枚都登记（抄两份清单＝各写各的）",
  },
  {
    id: "eval-expect-unregistered-name-silent-at-entry",
    src: "scripts/lib/eval-expects.ts",
    test: "tests/eval-task-set.test.ts",
    desc: "入口对没登记的名字返回 null（＝判过了、过了）⇒ 内建任务那一路不经解析器，写错名字就永远绿，"
      + "而这一格唯一的出口就是那句出声",
    apply: (s) => s.replace("  if (!h) return `判据名「${name}」既不在登记表、也没有判定分支 ⇒ 这一格根本没判（绕过了任务集解析）`;", "  if (!h) return null;"),
    expectFail: "绕过解析（内建任务写错名）也要出声：入口自己那一支兜住",
  },
  {
    id: "eval-expect-judge-untouched-branch-never-fails",
    src: "scripts/lib/eval-expects.ts",
    test: "tests/eval-task-set.test.ts",
    desc: "某一枚分支恒 null（这里拿 `judgeUntouched` 试）⇒ 那一格退化成正则里没人看的装饰，"
      + "而任务书、读数、汇总都会照印「这条判据在」；「全违规的面每枚都要出声」那条就是钉这一格",
    apply: (s) => s.replace('judgeUntouched: (r) => (r.touchedJudge ? "改了判卷面" : null),', "judgeUntouched: () => null,"),
    expectFail: "两向证人·出声：枚举的面里每一枚判据至少开口一次（恒 null 的分支＝那一格没在判）",
  },
  {
    id: "eval-expect-branch-always-speaks",
    src: "scripts/lib/eval-expects.ts",
    test: "tests/eval-task-set.test.ts",
    desc: "某一枚分支改成恒出事（这里拿 `clarify` 试）⇒ 那一格没有任何任务能满足它，"
      + "合法跑批会被整批判成失败——与恒 null 是同一格的两侧，所以各配一台造红、各红一条用例",
    apply: (s) => s.replace('clarify: (r) => (r.clarified < 1 ? "没 clarify（歧义靠猜）" : null),', 'clarify: () => "恒出事",'),
    expectFail: "两向证人·闭嘴：枚举的面里每一枚判据至少过一次（恒出事的判据会把合法任务全判死）",
  },
  {
    id: "eval-grade-bypasses-branch-table",
    src: "scripts/loop-eval.ts",
    test: "tests/eval-task-set.test.ts",
    desc: "跑器不再问那张表、每枚都返回 null ⇒ 登记表与分支表还在、判卷那两条键集/出声的也还绿，"
      + "但**没有任何一格真的在判**（规则 228：判据要与被度量那件事站在同一个决策点上）",
    apply: (s) => s.replace("const why = expectFailReason(e, face);", "const why = null;"),
    expectFail: "★接线 跑器不再自己判每一枚名字（旧那串 if 不许回来）",
  },
  {
    id: "eval-heldout-face-drops-one-observation",
    src: "scripts/loop-eval.ts",
    test: "tests/eval-heldout.test.ts",
    desc: "搬家只搬了一半：三枚观测里少交一枚（这里摘掉「装齐没有」那一枚）⇒ 分支静默拿到 `undefined`，"
      + "held-out 落进「没有面」那一档，读起来像「这条没判」而不是「跑器没交」——第 327 页补这一格就是因为判卷只钉了 lib 那一半",
    apply: (s) => s.replace("    heldOutInstallErrs: r.heldOutInstallErrs,\n", ""),
    expectFail: "判卷把 spec 与观测分别交给 lib（跑器不许自己比一次 ok）",
  },
  {
    id: "eval-run-identity-keys-rehardcoded",
    src: "scripts/eval/report.ts",
    test: "tests/eval-report.test.ts",
    desc: "配对那一层的身份键再从字面量抄一遍、且漏掉身份闸那三枚 ⇒ headSha 缺章的读数照样成对，"
      + "「不同提交的读数互相当同分母」那条老路复活（#90 的动因；派生式没了就是两份表）",
    // 第 455 页同步：面键多了 `PROVIDER_FACE_KEY` 那一枚，改法文本要跟着走（否则这条针脚变成**空改**——
    // 它 replace 的那串在源里已经不存在了，`mutate-needles-check` 会把它判成「钉在飞文本/未命中」）。
    apply: (s) => s.replace(`export const RUN_IDENTITY_KEYS = [...IDENTITY_KEYS, ...PAIR_EXTRA_IDENTITY_KEYS, PROVIDER_FACE_KEY] as const;`,
      `export const RUN_IDENTITY_KEYS = ["maxSteps", "reps", "arm"] as const;`),
    expectFail: "★ 只缺一枚**基三键**（headSha）而其余五枚齐 ⇒ 仍落 unknown-face（配对键必须从身份闸那三枚派生）",
  },
  {
    // 第 455 页新增（#90 那一族的第二次命中，形状换了个入口）：`providerFace` 不进面键 ⇒
    // `--scripted=` 合成批（`arm` 缺省同样是 `base`）与真会话批在同一 commit 上**逐字同一张脸**，
    // 合成批那 0 宽噪声带于是被当成机器的抖动底 ⇒ 真跑的任何微小改善都被判 `beyond-noise`（假阳性改善）。
    // 它不是 `eval-run-identity-keys-rehardcoded` 的重复：那边摘的是「派生式」，这边只摘**它那一枚**。
    id: "eval-provider-face-not-in-pair-keys",
    src: "scripts/eval/report.ts",
    test: "tests/eval-report.test.ts",
    desc: "providerFace 不进面键 ⇒ arm 同为 base 时合成臂与真会话臂配成同一面，" +
      "构造出来的 0 宽噪声带被当成抖动底 ⇒ 真跑的微小改善全被读成超带改善",
    apply: (s) => s.replace(
      `export const RUN_IDENTITY_KEYS = [...IDENTITY_KEYS, ...PAIR_EXTRA_IDENTITY_KEYS, PROVIDER_FACE_KEY] as const;`,
      `export const RUN_IDENTITY_KEYS = [...IDENTITY_KEYS, ...PAIR_EXTRA_IDENTITY_KEYS] as const;`,
    ),
    expectFail: "★ 合成批与真会话批即使五枚调用面键全同也不许同面（providerFace 是第六枚面键）",
  },
  {
    id: "eval-rows-not-stamped-with-identity",
    src: "scripts/loop-eval.ts",
    test: "tests/loop-eval-invocation-face.test.ts",
    desc: "身份章只盖 run.json 旁证、逐条读数不盖 ⇒ 报告读到的是「有旁证的空身份行」，"
      + "整批落进 unknown-face，配对那一格等于没接上写侧",
    // 第 455 页同步：身份章那一行现在多盖 `providerFace`，改法文本要跟着走（同上，不然是空改）。
    apply: (s) => s.replace(
      `  r: { ...x.r, headSha, ranAt, maxSteps: MAX_STEPS, reps: REPS, arm: ARM, providerFace: SCRIPTED === "" ? "真会话" : "剧本" },`,
      `  r: { ...x.r },`,
    ),
    expectFail: "写 readings.json 时逐条盖 headSha／ranAt／maxSteps／reps／arm（不是只盖 run.json 那一份旁证）",
  },
  {
    id: "eval-unknown-sentinel-read-as-identity",
    src: "scripts/eval/report.ts",
    test: "tests/eval-report.test.ts",
    desc: "读侧不再收「取不到」哨兵 ⇒ headSha 与 model 上那枚字面量 unknown 被读成有身份，"
      + "两趟「各自取不到 sha」的读数于是并成同一枚 sha ⇒ **不同代码被当成同分母**（#63 那枚哨兵在 #90 新面里的复活形状）",
    apply: (s) => s.replace(`  return typeof v === "string" && !isUnidentified(v) ? v : "";`,
      `  return typeof v === "string" && v !== "" ? v : "";`),
    expectFail: "★ 写侧那枚 unknown 哨兵在读侧仍算缺章（headSha／model 两枚都试）",
  },
  {
    id: "bench-passes-hardcoded-verdict-to-keeper",
    src: "scripts/loop-eval.ts",
    test: "tests/failed-trace-keep.test.ts",
    desc: "跑器把每行自己的裁决递给付费留档器这一接线被改回**写死一个值** ⇒ 留档器逻辑全对、"
      + "盘上一份都不落（或全落），而读数仍然说「这一跳走了」——第 4 形态（用例在标题里承诺了≠正文在判）",
    apply: (s) => s.replace(`    await retainStagedRuns(STAGED.splice(stagedMark), verdict, traceKeeps);`,
      `    await retainStagedRuns(STAGED.splice(stagedMark), "PASS", traceKeeps);`),
    expectFail: "跑器每行都递 verdict 给留档器，且临时目录不再在 runOnce 里就地删",
  },
  /* 第 418 页（能力 10）：逐名判卷的那位读者。它把「该转绿的没绿」与「该保住的坏了」从同一枚退出码里
   * 分出来；三根针分别盯它的三种死法：噪音折进裁决（装了尺永远说不出话）、第三态折成过（没有尺读成没问题）、
   * 接线取错拍（两枚读数在比两趟不同的事）。 */
  {
    id: "namedsets-noisy-command-folded-into-verdict",
    src: "scripts/lib/eval-named-sets.ts",
    test: "tests/eval-named-sets.test.ts",
    desc: "取料编排把「没接住任何测试名」的命令也折进证据面 ⇒ 一拍里混了 lint／typecheck 的多命令靶子"
      + "**恒判不可读**：这一格装了尺、却保证它永远说不出话（假阴），且它把真红一起抹掉",
    apply: (s) => s.replace(`    const carried = parsed.tests.length > 0;`, `    const carried = true;`),
    expectFail: "没接住测试名的命令（lint／噪音）不参与裁决，也不抹掉那条红",
  },
  {
    id: "namedsets-unreadable-read-as-pass",
    src: "scripts/lib/eval-named-sets.ts",
    test: "tests/eval-named-sets.test.ts",
    desc: "拦路谓词把第三态放行 ⇒ 「没有尺」在评分里长得和「过了」一模一样，"
      + "而这一格买来的东西就是这两件事分列（SWE-bench 那两半的读法全压在这里）",
    apply: (s) => s.replace(`  if (r.state === "pass") return null;`, `  if (r.state === "pass" || r.state === "unreadable") return null;`),
    expectFail: "逐名全对上、结尾那行汇总没了 ⇒ unreadable，且不许算过",
  },
  {
    id: "namedsets-wired-to-first-verify-beat",
    src: "scripts/loop-eval.ts",
    test: "tests/eval-named-sets.test.ts",
    desc: "接线取**第一拍**的逐名料 ⇒ 返修那一拍（真正决定结局的那一拍）从不进裁决，"
      + "而 `verifyOkLast` 取的是最后一拍——两枚读数在比两趟不同的事，正是本仓点名的第 4 形态（用例在、口径不对）",
    apply: (s) => s.replace(`verifies.length > 0 ? verifies[verifies.length - 1]!.results : []`, `verifies.length > 0 ? verifies[0]!.results : []`),
    expectFail: "跑器调读者，且吃的是**最后一次** verify 拍的 results 与 `t.spec?.judge`",
  },
  /* 第 422 页（能力 10＋9）：离线合成面。三根各盯这一格的一种死法：分岔被摘（剧本永远不接）、
   * 有效性那一判没接到 face（合成趟被「未起步」剔光）、等号写法的旗标被丢（用户以为在跑离线，实则在花钱）。 */
  {
    id: "synthetic-provider-face-not-swapped",
    src: "scripts/loop-eval.ts",
    test: "tests/loop-eval-synthetic-chain.test.ts",
    desc: "分岔被摘 ⇒ 带了 `--scripted` 也照样去建真会话 provider：离线那一格名义存在、实际零流量，"
      + "而这正是本仓反复登记的形状（机制全在、生产零流量）。它不会报错——它会安静地什么都不出",
    apply: (s) => s.replace(`      provider: SCRIPTED === ""`, `      provider: "" === ""`),
    expectFail: "剧本那一趟：逐名报全绿、提供者报剧本，取料面带格式与条数",
  },
  {
    id: "synthetic-validity-face-unwired",
    src: "scripts/lib/eval-validity.ts",
    test: "tests/loop-eval-synthetic-chain.test.ts",
    desc: "「0 次请求」不分装配就一律判未起步 ⇒ 剧本那一趟被剔出分母，合成面永远「拒绝出数」；"
      + "反面同样要紧：真会话那侧的限流/鉴权必须照旧被剔（摘掉这一判就是让花钱跑不成的趟次进分母刷分）",
    apply: (s) => s.replace(`  if (run.requests <= 0 && run.providerFace !== "剧本") {`, `  if (run.requests <= 0) {`),
    expectFail: "剧本那一趟不许被「未起步」剔出分母：请求=0 是构造如此，不是跑不成",
  },
  {
    id: "scripted-flag-equals-form-dropped",
    src: "scripts/loop-eval.ts",
    test: "tests/loop-eval-synthetic-chain.test.ts",
    desc: "`pick` 只认「旗标 空格 值」⇒ `--scripted=<剧本>` 被静默丢掉，脚本带着「我在跑离线」的信念**去打真会话**；"
      + "有 key 的那台机器上这是一次花钱的误会，方向与「读不到 ≠ 安全」同一条（本跑器不拒未知旗标，所以这一判没有第二道门）。"
      + "历史：这一条迁过两次针脚。① 原先 apply 打在**死代码**上（原实现自己 find 一遍 --scripted=，"
      + "与 pick 的结果恒等）⇒ 磨掉它行为一字不变、判卷全绿；改为直接打 pick 的取键处。"
      + "② 第 492 笔恢复 scriptedEq 判别式（pick 分不出「旗标缺席」与「给了却是空」，而空值闸守的正是这个区别），"
      + "针脚再次离位 ⇒ 报 no-effect；现改打等号取值那一支。"
      + "⚠️ 中间还试过打 `SCRIPTED` 的整行赋值 ⇒ **变异存活**：`pick` 自己第一条就吃等号写法"
      + "（`argv.find(a => a.startsWith(flag + \"=\"))`），所以 scriptedEq 在**取值**上与 pick 恒等，"
      + "磨掉它行为一字不变——正是这个锚点①里记过的同一个坑，换了个入口又踩一次。"
      + "教训：**针脚要打在判别式/取值那一支上，不是打在「某一种写法」上**。"
      + "另记一笔未补的洞：判别式 `scriptedEq !== undefined` 那一支（旗标缺席 ⇒ 不许落空值闸）"
      + "今天没有任何判卷钉它——eae8eaed 那次回归能活下来，缺的就是这个证人。",
    apply: (s) => s.replace(`scriptedEq.slice("--scripted=".length)`, `""`),
    expectFail: "两种旗标写法走到同一个值：等号写法必须真的拿到剧本，且空值闸同样开口",
  },
  {
    id: "scripted-flag-absent-not-empty-value",
    src: "scripts/loop-eval.ts",
    test: "tests/loop-eval-scripted-flag-absent.test.ts",
    desc: "旗标**缺席**被读成「给了 `--scripted=` 却是空」⇒ 空值闸恒真 ⇒ **真会话那条路变成死代码**，"
      + "一份真模型读数都产不出来，而判卷全绿。eae8eaed（第 483 页）正是这么活的：守卫被并成 "
      + "`pick(\"--scripted\",\"\") + if (SCRIPTED === \"\")`，而 pick 在旗标缺席时同样返回 \"\"。"
      + "与 `scripted-flag-equals-form-dropped` 是同一道闸的两半：那半管「给了却空必须退」，"
      + "这半管「没给必须放行」——只有前半时，第 483 页那种回归照样能活。"
      + "判据是行为格（问缺席时走到哪），不是形状格（不问源码长什么样）。",
    apply: (s) => s.replace(`if (scriptedEq !== undefined && SCRIPTED === "") {`, `if (SCRIPTED === "") {`),
    expectFail: "旗标缺席 ⇒ 不许掉进空值闸（eae8eaed 那次回归的形状：缺席被读成「给了空剧本」）",
  },
  {
    id: "cert-exit-code-drift-dim-dropped",
    src: "scripts/lib/head-cert-provenance.ts",
    test: "tests/head-cert-exit-code-cell.test.ts",
    desc: "判决里摘掉「读数作废」那一维 ⇒ 收尾复核发现树被切走时门退 0，"
      + "而汇总那行明明写着「作废」——第三态被折成绿（规则 92/232 那一格的正身）",
    apply: (s) => s.replace(`  return certFailingDims(o).length === 0 && !o.treeDrifted ? 0 : 1;`, `  return certFailingDims(o).length === 0 ? 0 : 1;`),
    expectFail: "③ 收尾复核发现树被切走 ⇒ 判决必须给 1（这一条只看判决函数）",
  },
  {
    id: "cert-exit-code-gate-threshold-loosened",
    src: "scripts/lib/head-cert-provenance.ts",
    test: "tests/head-cert-exit-code-cell.test.ts",
    desc: "认证门面那一维从「有红就算」挪成「红满 3 道才算」⇒ 单道门红不再进判决，"
      + "而门表正是这次认证要担保的那 23 道",
    apply: (s) => s.replace(`  if (o.gateRedCount > 0) out.push(`, `  if (o.gateRedCount > 2) out.push(`),
    expectFail: "⑭ 认证门面那一维的阈值是 0：红一道就算红（不许挪成 ≥2）",
  },
  {
    id: "cert-exit-code-cell-decodes-its-own-verdict",
    src: "scripts/lib/head-cert-provenance.ts",
    test: "tests/head-cert-exit-code-cell.test.ts",
    desc: "读数行自己另算一遍（这里直接写死 0）⇒ 判决说 1、页上引的那句说 0，"
      + "而凭证页引用的恰恰是落盘的那份——两件事各算一次就是本仓点名的形状",
    apply: (s) => s.replace(`  const code = certExitCode(o);`, `  const code = 0;`),
    expectFail: "⑦ cell 报的码必须等于 certExitCode 的返回值（八张面各问一次）",
  },
  {
    id: "cert-exit-code-decision-inlined-at-call-site",
    src: "scripts/head-cert.ts",
    test: "tests/head-cert-exit-code-cell.test.ts",
    desc: "调用点把合取式重写一遍（这里只留 typecheck 与门表两维）⇒ 纯函数与门各有一套判据，"
      + "以后加一维只会改一处，而另一处静默不认——第二份事实源",
    apply: (s) => s.replace(`const code = certExitCode(outcome);`, `const code = tc.status === 0 && gateReds.length === 0 ? 0 : 1;`),
    expectFail: "⑩ 退出码只有一条算式，且它调的是那份共用函数（不许留第二条 `&&` 串）",
  },

  // ── 逐名判卷规格的取料与配平（2026-10-22：`fixtures/bench/` 12/12 条一条 judge 都没有那笔债）
  // 四条各钉一半：两列谁进谁（判据反了 ⇒ 恒真）／没料不许出规格（空尺）／
  // 半份料不许出规格（把读不到的按缺席算成该保住）／门必须真的比内容而不只比形状。
  {
    id: "bench-judge-columns-inverted",
    src: "scripts/lib/bench-judge-spec.ts",
    test: "tests/bench-judge-spec.test.ts",
    desc: "两列判据反过来（把本来就绿的列进 failToPass）⇒ 这一格恒真：它们不用改也是绿的，"
      + "「该转绿的没绿」从此永远报 pass，而形状谓词看不出这种自造绿（两列仍不重叠、仍非空）",
    apply: (s) => s.replace(
      `  const failToPass = parsed.tests.filter((t) => t.outcome !== "passed").map((t) => t.name);\n  const passToPass = parsed.tests.filter((t) => t.outcome === "passed").map((t) => t.name);`,
      `  const failToPass = parsed.tests.filter((t) => t.outcome === "passed").map((t) => t.name);\n  const passToPass = parsed.tests.filter((t) => t.outcome !== "passed").map((t) => t.name);`,
    ),
    // 期望用例名必须同时满足两把尺，而它们比的面**不同**：
    //  · `mutate-anchor-titles`（标题体检）比的是**判卷源文本** ⇒ 要写模板串 `$rel $t.id：…`；
    //  · `killerAttributionOk`（归因）比的是 **vitest 输出里红掉的标题** ⇒ 那已是渲染后的具体串。
    // 同一枚 expectFail 喂不进两张面 ⇒ 这条锚点另配一个**不插值**的观测者：
    // `tests/bench-judge-spec.test.ts` 里那条「三支分开」的用例标题是字面量，两张面都认。
    // 观测者是**字面量标题**那条（`it.each` 那条比不出来：两把尺各比源文本与 vitest 输出，
    // 而 expectFail 只有一枚 ⇒ 会 misattributed）。它手工复现「两列对调」并断言判据咬得住。
    expectFail: "两列判据反过来 ⇒ 恒真（该转绿的那一列里全是本来就绿的）",
  },
  {
    id: "bench-judge-empty-parse-not-refused",
    src: "scripts/lib/bench-judge-spec.ts",
    test: "tests/bench-judge-spec.test.ts",
    desc: "「一条逐名都没读到 ⇒ 拒出规格」那一支恒假 ⇒ 交一份空两列出去，"
      + "下游会把空尺读成「没有该转绿的」或更糟的恒过——「没解析到」≠「没问题」",
    apply: (s) => s.replace(`  if (parsed.tests.length === 0) {`, `  if (false) {`),
    // 观测者是那条「三支分开」的判据：它喂三种输入，断言第二种**只**触发这一支
    // （另两支的话不许出现）。指向个别的空计划线用例会 misattributed——那条用例只查
    // 「成因含这句话」，而另两支被改坏时它照样绿（三个分支的成因会同时出现）。
    expectFail: "三个 fail-closed 分支各有一个**只走它自己**的坏输入（否则改坏任一条，另一条会替它红 ⇒ 突变存活）",
  },
  {
    id: "bench-judge-incomplete-not-refused",
    src: "scripts/lib/bench-judge-spec.ts",
    test: "tests/bench-judge-spec.test.ts",
    desc: "「派生不完整 ⇒ 拒」那一支恒假 ⇒ 拿半份料分列，读不到的那些按缺席算进 PASS_TO_PASS，"
      + "而没人喊——半份尺比没有尺更坏（它看起来在守）",
    apply: (s) => s.replace(`  if (!parsed.complete) reasons.push`, `  if (false) reasons.push`),
    expectFail: "三个 fail-closed 分支各有一个**只走它自己**的坏输入（否则改坏任一条，另一条会替它红 ⇒ 突变存活）",
  },
  {
    id: "bench-judge-check-compares-shape-only",
    src: "scripts/bench-judge-spec.ts",
    test: "tests/bench-judge-spec.test.ts",
    desc: "`--check` 门改成只比「有没有 judge」不比内容 ⇒ 漂掉的那一列（加了条幻影测试名、"
      + "或两列互换）照样退 0；这道门就只剩一道形状闸，而形状恰恰看不出恒真那种漂",
    apply: (s) => s.replace(
      `  if (sameSpec(t.judge, r.spec)) {\n      out.push(t);\n      continue;\n    }\n    drift += 1;`,
      `  if (t.judge !== undefined) {\n      out.push(t);\n      continue;\n    }\n    drift += 1;`,
    ),
    expectFail: "漂一份副本 ⇒ 门退 1 并点名（比的是内容，不是「有没有 judge」）",
  },
];
