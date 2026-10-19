// agent-subsystems 域的变异配置条目（2026-10-17 从 scripts/mutate-verify.mjs 按域拆出，见 PROGRESS 第 501 页）。
// 每条 = 一处语义突变 + 期望被它杀死的具体用例标题。追加条目时放进对应域的文件；
// **组间顺序不影响任何判据**（每条独立），同一文件内保持原顺序以便 diff。
export const MUTATIONS = [
  // ---- 能力 10 的评测数据层（src/agent/eval/task-set）：外部基准条目的"不许静默丢" ----
  // 这一族唯一的失败方式就是**分母悄悄地少了**：跑出来的成功率照样是个数，没人能看出它量的是半份数据集。
  {
    id: "taskset-unknown-field-ignored",
    src: "src/agent/eval/task-set.ts",
    test: "tests/eval-task-set.test.ts",
    desc: "认不出的字段被静默忽略 ⇒ 数据集作者写了 verifier 却拼成 verifior，任务照常收进分母但没有判卷",
    apply: (s) => s.replace("    if (!TASK_FIELDS.has(k)) errors.push(", "    if (false) errors.push("),
    expectFail: "认不出的字段名（如把 verifier 拼成 verifior）必须报错，不许静默忽略",
  },
  {
    id: "taskset-dup-id-silently-kept",
    src: "src/agent/eval/task-set.ts",
    test: "tests/eval-task-set.test.ts",
    desc: "重复 id 不再报也不丢 ⇒ 同一实例被数两次，分母与成功率同时失真",
    apply: (s) => s.replace("    if (n > 1) {", "    if (false) {"),
    expectFail: "重复 id 必须点名（静默去重会让分母骗人）",
  },
  {
    id: "swebench-empty-judge-accepted",
    src: "src/agent/eval/task-set.ts",
    test: "tests/eval-task-set.test.ts",
    desc: "只看 FAIL_TO_PASS 存不存在、不看它是不是空数组 ⇒ 空判卷的实例进来，跑完变成\"没坏就算过\"",
    apply: (s) => s.replace("if (failToPass === null || failToPass.length === 0) {", "if (failToPass === null) {"),
    expectFail: "FAIL_TO_PASS 是空数组也算没有判卷（只查 PASS_TO_PASS 会静默变成'没坏就算过'）",
  },
  {
    id: "impact-closure-glob-broken",
    src: "src/agent/impact/index.ts",
    test: "tests/impact-admission.test.ts",
    desc: "波及闭包的入面从 glob 匹配退化成整串相等（目录型 resources 声明\n 再也算不出波及）。第 306 页把这段循环抽成 " +
      "`closureFilesOf` 之后，针脚跟着搬到 `affectedFilesOf` 的入面那一行（**不是**退回旧写法讨好门）",
    apply: (x) => x.replace("graph.files.filter((file) => globs.some((g) => globMatchesPath(g, file)))", "graph.files.filter((file) => globs.includes(file))"),
    expectFail: "目录 glob 把整个子树的波及并进来",
  },
  // ---- 能力 10 落盘那一跳：失败轨迹 ⇒ 靶场草稿（此前只有手工 CLI 会调，盘上恒 0 条）----
  {
    id: "gym-draft-hop-dropped-from-distill",
    src: "src/agent/memory/distill.ts",
    test: "tests/gym-draft-wiring.test.ts",
    desc: "沉淀轮里这一跳换成 stub ⇒ 红轨迹永远不进靶场：草稿面只剩手工 CLI，「从失败轨迹学习」又回到零读数",
    apply: (s) => s.replace("const drafted = await writeDraftFromFailedSession({", 'const drafted = await Promise.resolve({ skipped: "stub" }); if (false) await writeDraftFromFailedSession({'),
    expectFail: "⑥ runSessionEndDistill 跑一条失败会话 ⇒ fixtures/gym/drafts/<会话 id> 真出现",
  },
  // ---- 靶场装配探针（fdc1e7b）----
  {
    id: "probe-all-system-counted-static",
    src: "src/agent/gym/probe.ts",
    test: "tests/gym-probe.test.ts",
    desc: "把全部 system 块都算成可缓存前缀（记忆/地图逐轮变化被当成静态段 → A1 的收益与成本全被高估）",
    apply: (s) => s.replace("if (!seenSystem) { firstSystemBytes = b; seenSystem = true; } else volatileSystemBytes += b;", "firstSystemBytes += b; seenSystem = true;"),
    expectFail: "可缓存 = 首条 system + 工具 schema；易变 system 与历史各归各段",
  },
  {
    id: "probe-tool-schema-not-counted",
    src: "src/agent/gym/probe.ts",
    test: "tests/gym-probe.test.ts",
    desc: "装配账里漏掉工具 schema（实测占短任务 prompt 的九成——漏掉它，探针就专门量不到最贵的那一块）",
    apply: (s) => s.replace('const toolsJson = tools && tools.length > 0 ? JSON.stringify(tools) : "";', 'const toolsJson = "";'),
    expectFail: "没有工具 ⇒ 工具面 0 字节（可缓存段只剩基础提示）",
  },
  {
    id: "probe-delta-sign-reversed",
    src: "src/agent/gym/probe.ts",
    test: "tests/gym-probe.test.ts",
    desc: "装配 A/B 差分前后颠倒（省了报成多花、多花报成省了——这张表就是为这个判断存在的）。针脚要吃到 cacheableBytes 那行才唯一：diffLongReplay 的头两条字段与这里逐字相同。",
    apply: (s) => s.replace(
      "    totalPromptBytes: after.totalPromptBytes - before.totalPromptBytes,\n    peakPromptBytes: after.peakPromptBytes - before.peakPromptBytes,\n    cacheableBytes: after.cacheableBytes - before.cacheableBytes,",
      "    totalPromptBytes: before.totalPromptBytes - after.totalPromptBytes,\n    peakPromptBytes: before.peakPromptBytes - after.peakPromptBytes,\n    cacheableBytes: before.cacheableBytes - after.cacheableBytes,",
    ),
    expectFail: "A/B：只读档工具面更小 ⇒ 可缓存前缀变小（差分表能报出这次装载省了多少）",
  },
  {
    id: "probe-long-replay-delta-sign-reversed",
    src: "src/agent/gym/probe.ts",
    test: "tests/gym-long-replay.test.ts",
    desc: "长时程差分的「Δ总 prompt」符号反过来 ⇒ gym-long 印给读者那一列读反。复认针脚歧义时才发现这一支此前**零观察者**：A/B 用例只断言了原始账单（on < off），没读差分字段。",
    apply: (s) => s.replace(
      "    requests: after.requests - before.requests,\n    totalPromptBytes: after.totalPromptBytes - before.totalPromptBytes,",
      "    requests: after.requests - before.requests,\n    totalPromptBytes: before.totalPromptBytes - after.totalPromptBytes,",
    ),
    expectFail: "摊销开关在同一条链上真省：压缩次数不更多、作废前缀严格更少（A/B 可复跑）",
  },
  {
    id: "probe-script-shape-check-removed",
    src: "src/agent/gym/script.ts", // 2026-09-19 剧本装载随切轮重构搬进 script.ts，锚点同迁
    test: "tests/gym-probe.test.ts",
    desc: "剧本出现非模型产出类型时不报错继续跑（装配账照发，但回放的是残缺剧本 = 假数）",
    apply: (s) => s.replace("else throw new Error(`装配探针剧本只接受", "else void (`装配探针剧本只接受"),
    expectFail: "剧本形状不合（非 assistant/tool_call）⇒ 显式抛错，不静默少装",
  },
  {
    id: "probe-assembly-not-returned",
    src: "src/agent/gym/runner.ts",
    test: "tests/gym-probe.test.ts",
    desc: "runCase 算出装配账却不带回结果（CLI 与基线永远看不到那一行——探针退化成只有单测能碰的死码）",
    apply: (s) => s.replace("return probe ? { ...result, assembly: probe.report() } : result;", "return result;"),
    expectFail: "runCase 的 probe 档把装配账带出来（CLI 走的就是这条路，不是只测纯函数）",
  },
  {
    id: "probe-ranking-drops-separators",
    src: "src/agent/gym/probe.ts",
    test: "tests/gym-probe.test.ts",
    desc: "拆账漏掉数组分隔符（排行相加 ≠ 工具面总字节 → 「砍掉这条省 1710B」算少一截，决策账目不闭合）",
    apply: (s) => s.replace("        + (i < n - 1 ? 1 : 0), // 与下一项之间的 \",\"", "        + 0, // 与下一项之间的 \",\""),
    expectFail: "排行相加恰等于工具 schema 总字节（含括号与逗号，不留结构开销当糊涂账）",
  },
  {
    id: "probe-ranking-sort-reversed",
    src: "src/agent/gym/probe.ts",
    test: "tests/gym-probe.test.ts",
    desc: "排行改成升序（CLI 前三名打成最便宜的三条 → 照着表砍错刀）",
    apply: (s) => s.replace(".sort((a, b) => b.bytes - a.bytes);", ".sort((a, b) => a.bytes - b.bytes);"),
    expectFail: "排行相加恰等于工具 schema 总字节（含括号与逗号，不留结构开销当糊涂账）",
  },
  {
    id: "probe-ranking-not-attached",
    src: "src/agent/gym/probe.ts",
    test: "tests/gym-probe.test.ts",
    desc: "报告不带排行（函数正确但没人拿得到 → CLI 那一行永远不打印）",
    apply: (s) => s.replace("report: () => ({ ...summarizeAssembly(opts.caseId, turns), toolRanking: rankToolSpecs(tools) }),", "report: () => summarizeAssembly(opts.caseId, turns),"),
    expectFail: "probe 报告带排行；工具面字节的和 = 可缓存前缀里的工具部分",
  },
  {
    id: "gym-round-boundary-never-matches",
    src: "src/agent/gym/script.ts",
    test: "tests/gym-script.test.ts",
    desc: "轮边界判据永不成立（一次请求吐完整条剧本 = 靶场退回单次请求会话，逐轮机制再次没有样本）",
    apply: (s) => s.replace("    if (script[i].type === \"tool_call\") {\n", "    if (script[i].type === \"never-tool-call\") {\n"),
    expectFail: "一轮 = 文本 + 它那一个 tool_call（tool_call 含在本轮内）",
  },
  {
    id: "gym-round-cursor-stalls",
    src: "src/agent/gym/script.ts",
    test: "tests/gym-script.test.ts",
    desc: "轮边界处游标不前进（同一条 tool_call 每轮重吐：模型反复执行同一次写入，事件流与判卷全被污染）",
    apply: (s) => s.replace("      i += 1; // 这一轮到 tool_call 为止，剩下的下轮再给\n", "      // 游标停在 tool_call 上，不前进\n"),
    expectFail: "切到剧本跑完不丢条、不重复：逐轮串起来恰等于原剧本",
  },
  // ↓ 第 470 页：靶场剧本面加 `round_end` 哨兵（把「跑过 shell 之后模型收工」那一拍
  //   钉成确定性输入，`autoVerifyRepair` 才有可复跑的分歧）。三枚针各钉一跳：
  //   靶场这一侧的模式开关、共享切轮函数的边界判定、以及取值旗标的等号形（写这笔时踩到的静默降级）。
  {
    id: "gym-script-round-end-mode-dropped",
    src: "src/agent/gym/script.ts",
    test: "tests/gym-script.test.ts",
    desc: "靶场这一侧不再按哨兵切轮（带哨兵的剧本退回旧口径）⇒ 中间那个纯文本轮不存在：" +
      "`--scripted=` 面又写不出「收工那一拍」，修复臂的分歧不可再见",
    apply: (s) => s.replace("  if (script.some(isRoundEnd)) return takeMarkedRound(script, cursor);", "  if (false) return takeMarkedRound(script, cursor);"),
    expectFail: "中间那个纯文本轮单独成轮",
  },
  {
    id: "gym-probe-transport-drains-all",
    src: "src/agent/gym/probe.ts",
    test: "tests/gym-rounds-e2e.test.ts",
    desc: "探针 transport 绕过切源、一次吐完（装配账把 10 轮会话记成 1 次请求，成本面当场少算一个数量级）",
    apply: (s) => s.replace(
      "    const round = takeRound(script, cursor);\n    cursor = round.next;\n    for (const output of round.outputs) yield output;\n",
      "    while (cursor < script.length) yield script[cursor++];\n",
    ),
    expectFail: "probe 档逐轮装配：轮号递增、同一输入下账不变、尾部跑完即空",
  },
  {
    id: "impact-note-symbols-uncapped",
    src: "src/agent/impact/index.ts",
    test: "tests/impact-note-bounds.test.ts",
    desc: "无调用点分支的符号清单取消每文件帽 ⇒ 这条是**最常见**分支，大文件上百个定义（含局部名）整串进每次写入的 tool_result",
    apply: (s) => s.replace("const cap = IMPACT_CONTEXT_SYMBOLS_PER_FILE;", "const cap = Number.MAX_SAFE_INTEGER;"),
    expectFail: "300 个定义只列前 4 个，并如实报出总数与全量位置",
  },
  {
    id: "impact-note-count-lies",
    src: "src/agent/impact/index.ts",
    test: "tests/impact-note-bounds.test.ts",
    desc: "计数尾写死帽值 ⇒ 「等 4 个」与只列 4 个自相矛盾，模型据此以为文件里就这几个定义（少字节的前提是如实报数）",
    apply: (s) => s.replace(" 等 ${String(r.symbols.length)} 个（全量在 impact_report 事件）", " 等 ${String(cap)} 个（全量在 impact_report 事件）"),
    expectFail: "300 个定义只列前 4 个，并如实报出总数与全量位置",
  },
  {
    id: "mem-budget-unit-chars",
    src: "src/agent/memory/inject.ts",
    test: "tests/memory-inject-token-budget.test.ts",
    desc: "记忆注入的总预算又按字符帽收（tokenBudget×4）⇒ 中文一字≈一 token，6K 预算实到 14K+，而这块每轮重送",
    apply: (s) => s.replace("if (runningWeight > tokenBudget) {", "if (runningWeight > tokenBudget * CHARS_PER_TOKEN) {"),
    expectFail: "纯 ASCII 会话：换口径不收紧（字符帽仍是那条线，两套读数同值）",
  },
  {
    id: "mem-weight-ascii-count",
    src: "src/agent/memory/inject.ts",
    test: "tests/memory-inject-token-budget.test.ts",
    desc: "丢掉了「按字符类别登记字重」（totalWeight 退回 length×0.25）⇒ 估算器对中文低估 4 倍，预算形同虚设",
    apply: (s) => s.replace("(n, s) => n + weightText(s.header) + s.lines.reduce((m, l) => m + weightText(l) + 0.25, 0), 0);", "(n, s) => n + s.header.length * 0.25 + s.lines.reduce((m, l) => m + l.length * 0.25 + 0.25, 0), 0);"),
    expectFail: "中文语料超预算：整块按字重收进声明预算内，且如实报 truncated",
  },
  {
    id: "mem-drop-cursor-ascii",
    src: "src/agent/memory/inject.ts",
    test: "tests/memory-inject-token-budget.test.ts",
    desc: "删行游标的扣减口径与 totalWeight 脱钩（按 length×0.25 扣）⇒ 中文段一路多删几倍行，预算没超但信息丢了",
    apply: (s) => s.replace("runningWeight -= weightText(sec.lines[drop]!) + 0.25;", "runningWeight -= sec.lines[drop]!.length * 0.25 + 0.25;"),
    expectFail: "中文语料超预算：整块按字重收进声明预算内，且如实报 truncated",
  },
  {
    id: "mem-metadata-tokens-missing",
    src: "src/agent/memory/inject.ts",
    test: "tests/memory-inject-token-budget.test.ts",
    desc: "元数据行不再报 tokens_current/tokens_limit ⇒ 块里只剩字符帽那把尺，模型自我收敛收敛到错的口径",
    apply: (s) => s.replace("+ \" tokens_current=\" + String(tokensCurrent) + \"/tokens_limit=\" + String(tokenBudget));", ");"),
    expectFail: "元数据行两套口径都报，tokens_limit 就是声明的预算（不拿字符帽冒充预算）",
  },
  {
    id: "mem-tokens-reported-ascii",
    src: "src/agent/memory/inject.ts",
    test: "tests/memory-inject-token-budget.test.ts",
    desc: "自报的 tokens 回到 chars/4 ⇒ 判定按字重、读数按英文口径，同一模块两副口径（本仓「估算与执行两套口径」病）",
    apply: (s) => s.replace("    tokens: tokensCurrent,", "    tokens: Math.ceil(charsCurrent / CHARS_PER_TOKEN),"),
    expectFail: "元数据行两套口径都报，tokens_limit 就是声明的预算（不拿字符帽冒充预算）",
  },
  {
    id: "arch-outline-cap-ignores-source-size",
    src: "src/agent/memory/inject.ts",
    test: "tests/memory-arch-outline-cap.test.ts",
    desc: "大纲帽回到写死 4096 字符 ⇒ 4KB–16KB 的中文文档命中 shapeDoc 的逐字返回支，「只注大纲」静默不生效",
    apply: (s) => s.replace("Math.min(ARCH_OUTLINE_MAX_CHARS, Math.floor(raw.length / 2))", "ARCH_OUTLINE_MAX_CHARS"),
    expectFail: "中文文档（>4KB 字节、字符数 <4096）注的确实是大纲，不是整份原文",
  },
  {
    id: "arch-outline-cap-loses-abs-ceiling",
    src: "src/agent/memory/inject.ts",
    test: "tests/memory-arch-outline-cap.test.ts",
    desc: "只按原文一半收、丢掉 4096 的绝对帽 ⇒ 大文档的大纲可以比原来大得多，注入预算被单个段落撑爆",
    apply: (s) => s.replace("Math.min(ARCH_OUTLINE_MAX_CHARS, Math.floor(raw.length / 2))", "Math.floor(raw.length / 2)"),
    expectFail: "英文大文档仍按 4096 字符帽（不变小、不变大）",
  },
  {
    id: "mem-eviction-not-named",
    src: "src/agent/memory/inject.ts",
    test: "tests/memory-eviction-notice.test.ts",
    desc: "整段抽干了哪几段不点名 ⇒ 模型看到一目录条目却不知道架构/决策被省了，只能重新 grep 或以为项目没架构",
    apply: (s) => s.replace("    if (evicted.length > 0) lines.push(\"[omitted: \"", "    if (evicted.length > 0 && false) lines.push(\"[omitted: \""),
    expectFail: "成熟记忆集在缺省预算下抽干了 ARCHITECTURE 与 DECISIONS ⇒ 提示点名这两段并给 read_file 通道",
  },
  {
    id: "mem-eviction-had-recorded-after-drop",
    src: "src/agent/memory/inject.ts",
    test: "tests/memory-eviction-notice.test.ts",
    desc: "「原有几行」改记成 0 ⇒ 事后永远判不出谁被抽干（就地 splice 之后再量必然全 0），点名静默失效",
    apply: (s) => s.replace("had: s.lines.length, block: \"project\" as const", "had: 0, block: \"project\" as const"),
    expectFail: "成熟记忆集在缺省预算下抽干了 ARCHITECTURE 与 DECISIONS ⇒ 提示点名这两段并给 read_file 通道",
  },
  // ---- 高熵候选的边界（security/scan.ts，2026-09-22）----
  {
    id: "entropy-candidate-eats-assignment-label",
    src: "src/agent/security/scan.ts",
    test: "tests/redact.test.ts",
    desc: "候选字符集含 `=` ⇒ `SESSION=<高熵>` 整串成为候选，mask() 只留前 4 字符，键名连同值一起吃掉（掩码产物读起来像原文被改坏了）",
    apply: (s) => s.replace("/[A-Za-z0-9+/_-]{16,}={0,2}/g", "/[A-Za-z0-9+/=_-]{16,}/g"),
    expectFail: "赋值式：值掩掉、键名逐字留着",
  },
  {
    id: "entropy-path-veto-removed",
    src: "src/agent/security/scan.ts",
    test: "tests/redact.test.ts",
    desc: "去掉绝对路径否决 ⇒ 字符集含 `/`，一条 tmpdir 整段成为候选（实测 `/var/folders/…` 落成 `/var****`），落流与归档两面的路径全毁",
    apply: (s) => s.replace("    if (looksLikePath(token)) continue;\n", ""),
    expectFail: "刻意接受的口子（钉住，不是遗漏）：以 / 开头的 base64 串不再由熵分支覆盖",
  },
  {
    id: "tags-version-map-face-dead",
    src: "src/agent/map/build.ts",
    test: "tests/tags-extract-version.test.ts",
    desc: "map 侧不再比对抽取版本 ⇒ 改了 .scm pattern 后，未变更的文件仍从盘上读回旧判据抽出的 tags，" +
      "新判据看起来「改了没反应」——这个假象会把一次正确的修法骗人回滚掉",
    apply: (s) => s.replace("if (e.v !== TAGS_EXTRACT_VERSION) return null; // 抽取判据换过", "if (false) return null; // 抽取判据换过"),
    expectFail: "map 侧：版本不符 ⇒ 该文件重解析（同一条缓存改回正确版本又能命中）",
  },
  {
    id: "tags-version-impact-face-dead",
    src: "src/agent/impact/index.ts",
    test: "tests/tags-extract-version.test.ts",
    desc: "impact 这张图独立于 map 抄了一份缓存读取面 ⇒ 只修 map 那一支时，影响面照旧吃旧 tags。" +
      "两支同值才成立的不变量，变异必须各自废一次（上一支锚点测不到这一支）",
    apply: (s) => s.replace("if (e.v !== TAGS_EXTRACT_VERSION) return null; // 判据换过", "if (false) return null; // 判据换过"),
    expectFail: "impact 侧：版本不符 ⇒ 重解析并计数（两份缓存不共用读取代码，各判一次）",
  },
  {
    id: "tags-version-ignores-patterns",
    src: "src/agent/map/parse.ts",
    test: "tests/tags-extract-version.test.ts",
    desc: "版本号不再把 pattern 文本算进去（只留手写 REV）⇒ 改判据而版本不动，" +
      "缓存作废链整条失效，且没有任何一处会红——手写常量当版本就是下一处漂移磁铁",
    apply: (s) => s.replace("return createHash(\"sha1\").update(EXTRACT_LOGIC_REV + \"\\n\" + patterns.join(\"\\n\"))", "return createHash(\"sha1\").update(String(EXTRACT_LOGIC_REV))"),
    expectFail: "改一条 pattern ⇒ 版本必须变；同一组 pattern ⇒ 版本稳定",
  },
  {
    id: "tags-version-hardcoded-literal",
    src: "src/agent/map/parse.ts",
    test: "tests/tags-extract-version.test.ts",
    desc: "导出的版本被写成字面量 ⇒ 派生函数还在、测试①还绿，但真机上那张图用的已不是它算出来的值。" +
      "这一格只有「常量 === 按现网 pattern 算出来的值」这条断言能看见",
    apply: (s) => s.replace("export const TAGS_EXTRACT_VERSION = tagsExtractVersion(PATTERNS);", "export const TAGS_EXTRACT_VERSION = \"000000000000\";"),
    expectFail: "导出的常量确实等于按现网 pattern 算出来的值（不是抄下的字面量）",
  },
  {
    id: "impact-local-var-gate-dropped",
    src: "src/agent/map/parse.ts",
    test: "tests/map-parse.test.ts",
    desc: "局部变量又算跨文件符号 ⇒ 函数体里的 `const target = …` 会与另一个文件里同名变量的调用连一条边" +
      "（实测 14,312 个定义里 10,184 个是这种；`i` 有 187 个「定义」、`p` 有 119 个），" +
      "于是「改它会波及谁」的回答里掺进一堆凭名字撞上的假边",
    apply: (s) => s.replace("if (c.name === \"def\" && isLocalVariableBinding(c.node)) continue;", "if (false && c.name === \"def\") continue;"),
    expectFail: "函数体里的变量声明不算定义，模块作用域的同名变量照算",
  },
  {
    id: "impact-local-var-gate-dropped-graph-face",
    src: "src/agent/map/parse.ts",
    test: "tests/impact.test.ts",
    desc: "同一条判据的**消费面**：抽取漏了闸，最终坏在「两个同名局部变量的文件之间出现一条边」这件事上。" +
      "一支锚点只认一支判卷 ⇒ 图侧那组断言若哪天只看图不看 tags，就得有这条替它盯着",
    apply: (s) => s.replace("if (c.name === \"def\" && isLocalVariableBinding(c.node)) continue;", "if (false && c.name === \"def\") continue;"),
    expectFail: "两个文件各有一个同名局部变量 ⇒ 零条边（旧判据会连一条出去，因为局部变量也进了符号表）",
  },
  {
    id: "impact-module-scope-climb-accepts-nested",
    src: "src/agent/map/parse.ts",
    test: "tests/map-parse.test.ts",
    desc: "作用域上溯不再认「嵌套执行作用域的容器」⇒ 每个节点都能走到 program，" +
      "于是所有声明都被判成模块级，那道闸变成空操作（第一次量这个数时就是这样：1,666/1,666 全判模块级）",
    apply: (s) => s.replace("if (NESTED_SCOPES.has(n.type)) return false;", "if (false) return false;"),
    expectFail: "函数体里的变量声明不算定义，模块作用域的同名变量照算",
  },
  {
    id: "impact-node-identity-compare-in-gate",
    src: "src/agent/map/parse.ts",
    test: "tests/map-parse.test.ts",
    desc: "字段比对退回**节点对象身份**：tree-sitter 每次取节点都新建外壳，`childForFieldName(...) === c.node` 恒 false" +
      " ⇒ 闸静默地永不放行，读数只少 16 个定义（本次真踩过，是复测边数 96,990 不等于预期 49,049 才暴露的）",
    apply: (s) => s.replace("if (!nm || nm.startIndex !== nameNode.startIndex || nm.endIndex !== nameNode.endIndex) return false;", "if (nm !== nameNode) return false;"),
    expectFail: "函数体里的变量声明不算定义，模块作用域的同名变量照算",
  },
  {
    id: "impact-local-gate-over-applied",
    src: "src/agent/map/parse.ts",
    test: "tests/map-parse.test.ts",
    desc: "闸从「只管 variable_declarator」扩到所有定义 ⇒ 类里的方法、嵌套的函数声明一起被抹掉。" +
      "本仓的取证只支持前者（87% 的变量定义是局部的），超出证据的收窄会把还有价值的那半边一起赔进去",
    apply: (s) => s.replace("if (!p || p.type !== \"variable_declarator\") return false;", "if (!p) return false;"),
    expectFail: "已知代价钉住：方法定义照进表，但 obj.m() 不产生引用 ⇒ 方法调用连不上定义文件",
  },
  {
    id: "impact-property-ref-patterns-restored",
    src: "src/agent/map/parse.ts",
    test: "tests/map-parse.test.ts",
    desc: "三条属性式 ref pattern 被「顺手补回来」（它们看起来像漏抽）⇒ `console.log` 又与某个文件的 " +
      "`const log = …` 相连，单个 `log` 就产 45,160 条假边。删它们是有读数的取舍，不是遗漏",
    apply: (s) => s.replace("  \"(call_expression function: (identifier) @ref)\",", "  \"(call_expression function: (identifier) @ref)\",\n  \"(call_expression function: (member_expression property: (property_identifier) @ref))\","),
    expectFail: "属性式调用不抽引用：console.log / obj.m() / new NS.Ctor() 都不算引用",
  },
  {
    id: "gym-draft-failed-write-counted-as-change",
    src: "src/agent/gym/draft.ts",
    test: "tests/gym-draft.test.ts",
    desc: "写失败的笔次也算进「候选必改集」⇒ 一条半途而废的会话会被固化成『这些文件必须改』，" +
      "而那份尺子的判据来自一次没做完的尝试（草稿面最容易犯的错：把「发生过」读成「应该发生」）",
    apply: (s) => s.replace("        if (e.ok) written.add(p);\n        else failedWrites++;", "        written.add(p);"),
    expectFail: "写失败的那笔不进候选集，且点名「先确认这条轨迹值不值得固化」",
  },
  {
    id: "gym-draft-worker-writes-as-parent",
    src: "src/agent/gym/draft.ts",
    test: "tests/gym-draft.test.ts",
    desc: "worker 子流的写盘算进 parent 的候选集 ⇒ case 的「必改文件」里出现一批 parent 从没碰过的路径" +
      "（#8 那族归因缺陷的第四面：事件带 agent_id 却不看它的消费方）",
    apply: (s) => s.replace("if (e.agent_id !== undefined) { workerWrites++; break; }", "if (false) { workerWrites++; break; }"),
    expectFail: "worker 子流的写盘与验证都不算 parent 的（agent_id 在场即排除，并出声）",
  },
  {
    id: "gym-draft-worker-verify-as-parent",
    src: "src/agent/gym/draft.ts",
    test: "tests/gym-draft.test.ts",
    desc: "同上一条的另一格：**验证**证据的归因。worker 验绿会被写成 parent 的 mustPassVerify=true ⇒ " +
      "一条 parent 从未验证过的轨迹拿到一份「必须验绿」的判据",
    apply: (s) => s.replace("        if (e.agent_id !== undefined) break;\n        verifyAttempts++;", "        verifyAttempts++;"),
    expectFail: "worker 子流的写盘与验证都不算 parent 的（agent_id 在场即排除，并出声）",
  },
  {
    id: "gym-draft-worker-result-as-parent-failure",
    src: "src/agent/gym/draft.ts",
    test: "tests/gym-draft.test.ts",
    desc: "同一条不变量的**第三面**：agent_id 只在 tool_call 与 verify_result 上挡，tool_result 不挡。" +
      "provider 缺省 callId 是**流内序号**（openai 两处 `c.id ?? \`call-${index}\``、gemini `gemini-call-${seq++}`）⇒ " +
      "BYOK 的端点不给 id 时，parent 与每个 worker 都从 call-0 开始，worker 的失败结果会命中 parent 的 callPath，" +
      "凭空给这条轨迹加上「写盘失败 ⇒ 不值得固化」（真流量样本 0 撞号：那条 GLM 自带 id，所以这是取料面补全，不是现状修复）。" +
      "2026-09-23 改指：半截轨迹那三行插在了闸与 `callPath` 之间，旧的两行针脚不再相邻",
    apply: (s) => s.replace("        if (e.agent_id !== undefined) break;\n        const left = (pending.get(e.callId) ?? 0) - 1;", "        const left = (pending.get(e.callId) ?? 0) - 1;"),
    expectFail: "callId 撞名（provider 缺省 id 是流内序号）：worker 的失败结果不算 parent 写坏，parent 自己的仍算",
  },
  {
    id: "gym-draft-emits-expect-despite-unknown-verify",
    src: "src/agent/gym/draft.ts",
    test: "tests/gym-draft.test.ts",
    desc: "会话没验过时也产 expect ⇒ mustPassVerify 落成一个猜的值（null/false）。" +
      "「不知道」写成「不通过」与写成「通过」同样是伪造判据，差别只在方向",
    apply: (s) => s.replace("  if (d.verifyOk !== null) {", "  if (true) {"),
    expectFail: "verify 未知 ⇒ 不产 expect.candidate.json；验过 ⇒ 产，且文件名带 candidate",
  },
  {
    id: "gym-case-path-guard-dropped",
    src: "src/agent/gym/case.ts",
    test: "tests/gym-draft.test.ts",
    desc: "索引条目「必须落在 cases/ 内」这道守卫被删 ⇒ 一条指向 ../drafts/x 的条目会以判据身份被跑，" +
      "而 A3 的 sha256 冻结只 walk cases ⇒ 改它没人发现（未跟踪的草稿伪装成已冻结的尺子）",
    apply: (s) => s.replace("    if (bad !== null) throw new Error(", "    if (false) throw new Error("),
    expectFail: "loadGymIndex 遇到逃逸条目直接抛（fail-loud，不静默跳过）",
  },
  {
    id: "gym-draft-repo-prefix-by-substring",
    src: "src/agent/gym/draft.ts",
    test: "tests/gym-draft.test.ts",
    desc: "「有靶子」按子串配而不是按路径段配 ⇒ 一份叫 `repo-notes.md` 的散文件就把整条核对判成齐件，" +
      "人照着提示去 promote 一条没有靶子的 case（消费端最容易犯的错：把「看着像」读成「是」）",
    apply: (s) => s.replace('if (!relPaths.some((p) => p.startsWith("repo/")))', 'if (!relPaths.some((p) => p.startsWith("repo")))'),
    expectFail: "`repo-notes.md` 不算靶子：前缀按路径段配，不按子串（漏了斜杠会把同名散文件读成已齐件）",
  },
  {
    id: "gym-draft-candidate-wording-collapsed",
    src: "src/agent/gym/draft.ts",
    test: "tests/gym-draft.test.ts",
    desc: "「只有自动候选、还没人核」与「连候选都没有」共用一句 ⇒ 人分不清这条是**等我核**还是**上游没跑过**，" +
      "两种下一步动作完全相反（前者去比对 expect.candidate.json，后者回去生成草稿）",
    apply: (s) => s.replace('      ? "expect.json：只有自动出的候选集，还没人把它核成判据"', '      ? "expect.json：既没有判据也没有候选集"'),
    expectFail: "只有自动候选时点名「还没人把它核成判据」，而不是与「什么都没有」共用一句",
  },
  {
    id: "gym-draft-negative-exempt",
    src: "src/agent/gym/draft.ts",
    test: "tests/gym-draft.test.ts",
    desc: "A2 反例控制从核对表里免检 ⇒ 「尺子能判失败」这件事重新变回没人查；一条只有正例的 case 可以一路 promote 进冻结面",
    apply: (s) => s.replace('  if (!set.has("negative.json")) out.push(', '  if (false) out.push('),
    expectFail: "negative.json 缺席必须点名——没有反例的尺子证不了自己能量到失败",
  },
  {
    id: "gym-draft-ready-ignores-expect",
    src: "src/agent/gym/draft.ts",
    test: "tests/gym-draft.test.ts",
    desc: "expect 面整个不查 ⇒ 只有 task.md + repo/ 的目录被判成「可 promote」，而判卷文件还在候选状态" +
      "（放行侧那条「四件齐 ⇒ 零 blocker」的用例保证这里不是靠「凡目录都报缺」蒙绿）",
    apply: (s) => s.replace('  if (!set.has("expect.json")) {', '  if (false) {'),
    expectFail: "只有自动候选时点名「还没人把它核成判据」，而不是与「什么都没有」共用一句",
  },
  {
    id: "map-haserror-drops-whole-file",
    src: "src/agent/map/parse.ts",
    test: "tests/map-parse.test.ts",
    desc: "退回「hasError ⇒ 整文件一票否决」⇒ 合法 TS 只要有一处 grammar 误报（类型位置里的 " +
      "`import(\"pkg\").T`、`vi.mock` 里 `importOriginal<typeof import(...)>()`、含双斜杠的正则字面量）" +
      "就在符号图里**完全不存在**：实测本仓 4 个合法文件如此（含 parse.ts 自己），召回从 0.9991 掉回 0.9863，" +
      "而读端只会说「这张图里没有这个符号」",
    apply: (s) => s.replace("    const query = await queryFor(lang, loaded);", "    if (tree.rootNode.hasError) return [];\n    const query = await queryFor(lang, loaded);"),
    expectFail: "真仓库里那四个曾被一票否决的文件，如今每个都有定义入图（回归现场比合成夹具更硬）",
  },
  // ---- 半截轨迹（2026-09-23，在唯一一条真·持久化会话上量到：`run_shell` 那一笔没有结果，
  //      而草稿当时的清单对这一格一字未提）。同一条 agent_id 闸现在**同时**守着两支消费：
  //      callPath 归因与 pending 配对 ⇒ 按规则 69，改这一行必须两条锚点各点一个名，
  //      否则将来谁删了其中一支用例，另一支会静默失去守门人。
  {
    id: "gym-draft-half-open-pairing-ignores-agent-id",
    src: "src/agent/gym/draft.ts",
    test: "tests/gym-draft.test.ts",
    desc: "结果侧那道 agent_id 闸被摘 ⇒ worker 的结果去销 parent 的账。缺省 callId 是流内序号，" +
      "两边都有 `call-0`：一条被切断的 parent 轨迹会被子流「答」成完整，那条「半截」永远不报",
    apply: (s) => s.replace("        if (e.agent_id !== undefined) break;\n        const left = (pending.get(e.callId) ?? 0) - 1;", "        const left = (pending.get(e.callId) ?? 0) - 1;"),
    expectFail: "撞号时 worker 的结果不许把 parent 的调用**假答**掉（配对面的 agent_id 闸）",
  },
  {
    id: "gym-draft-half-open-counts-worker-calls",
    src: "src/agent/gym/draft.ts",
    test: "tests/gym-draft.test.ts",
    desc: "调用侧不再区分父子流 ⇒ worker 没结果的那几笔被算成 parent 的半截。" +
      "后果是把「worker 还在跑」读成「这条轨迹断在半路」，而 parent 其实一行不差地走完了",
    apply: (s) => s.replace("        if (e.agent_id === undefined) pending.set(e.id, (pending.get(e.id) ?? 0) + 1);", "        pending.set(e.id, (pending.get(e.id) ?? 0) + 1);"),
    expectFail: "worker 子流自成一对 ⇒ 不算 parent 的半截（同一支闸的另一侧）",
  },
  {
    id: "gym-draft-half-open-blocker-dropped",
    src: "src/agent/gym/draft.ts",
    test: "tests/gym-draft.test.ts",
    desc: "「有 N 次工具调用没有结果」这条不出现在「还缺」清单里 ⇒ 半截轨迹与完整轨迹在草稿面上同形，" +
      "而被冻结成 case 之后每次回放都在学一个不存在的终局",
    apply: (s) => s.replace("if (unansweredCalls > 0) missing.push(", "if (false) missing.push("),
    expectFail: "末笔调用没有结果 ⇒ 点名「半截」并带笔数（真实形状：run_shell 无结果）",
  },
  {
    id: "lr-growth-invented-not-from-script",
    src: "src/agent/gym/probe.ts",
    test: "tests/gym-long-replay.test.ts",
    desc: "增长内容退回我编的字数 ⇒ 所有 case 量出同一张表，读数却写着 case 名（第一版真的这样跑通过）",
    apply: (s) => s.replace("  const growth = await scriptGrowthText(opts.scriptPath);", "  const growth = \"的\".repeat(2048);"),
    expectFail: "仪器读的是 case，不是我塞的字数：两条 case 的账单必须不同",
  },
  {
    id: "lr-empty-script-silently-accepted",
    src: "src/agent/gym/probe.ts",
    test: "tests/gym-long-replay.test.ts",
    desc: "剧本没正文时静默拼空串 ⇒ 长时程读数变成「只长了我塞的分隔符」",
    apply: (s) => s.replace("  if (joined === \"\") {", "  if (false) {"),
    expectFail: "剧本里没有可用正文时**拒绝跑**（宁可不量，也不拿编造内容当某条 case 的读数）",
  },
  {
    id: "lr-head-survival-claims-perfect-append",
    src: "src/agent/gym/probe.ts",
    test: "tests/gym-long-replay.test.ts",
    desc: "头部存活比恒报 1 ⇒ 「一次压缩作废 42 万字符」这类读数从此消失，摊销也就无从判有无效果",
    apply: (s) => s.replace("      headSurvival: reading ? reading.share : null,", "      headSurvival: reading ? 1 : null,"),
    expectFail: "续长的会话真的会被反复装配：requests = longTurns、历史在涨、且至少压一次（否则样本无分辨力）",
  },
  {
    id: "lr-compaction-count-ignores-evidence",
    src: "src/agent/gym/probe.ts",
    test: "tests/gym-long-replay.test.ts",
    desc: "压缩次数拿「抖了几次」冒充而不是数事件流 ⇒ 与 PC5/PC6 的认账口径分家，两个数从此互相矛盾",
    apply: (s) => s.replace("    compactions: compactionEvents,", "    compactions: 0,"),
    expectFail: "续长的会话真的会被反复装配：requests = longTurns、历史在涨、且至少压一次（否则样本无分辨力）",
  },
  {
    id: "verify-exit-distill-env-blind",
    src: "src/agent/memory/distill.ts",
    test: "tests/verify-attribution-exits.test.ts",
    desc: "沉淀那格恒假 ⇒ 环境红进「N 次验证失败」（并顺带被同拍的 tool_result 记成工具失败），下一次会话的模型会读到「我在这个靶子上会失败」这种假经验",
    apply: (s) => s.replace("      if (isEnvVerifyCause(e.cause)) {", "      if (false) {"),
    expectFail: "出口③：环境拍不进失败轨迹，改成 harness 侧的一笔（两个取料面都挡）",
  },

  // ── 第 4 档 guided（judgment-layer §7 第 1 步）：政策表的每一格都要有「废掉它必须有名字红」的锚
                            {
    id: "distill-gate-whitelist-unlabeled",
    src: "src/agent/memory/distill.ts",
    test: "tests/distill.test.ts",
    desc: "沉淀轮的白名单拒绝不带留痕 ⇒ §7 的可标分母少一格（受管调用发生了、判定也发生了，只是没人记）",
    apply: (s) => s.replace(', gate: DISTILL_GATE.whitelist }', ' }'),
    expectFail: "白名单挡下非 remember 工具 ⇒ gate = X-distill / denied（没问过人，不是人的答复）",
  },
  {
    id: "distill-gate-merged-verdict-collapse",
    src: "src/agent/memory/distill.ts",
    test: "tests/distill.test.ts",
    desc: "把「人说不」记成「门拦的」（rejected → denied）⇒ 最稀缺的正例静默消失，而读数看起来总条数没变",
    apply: (s) => s.replace('unapproved: { layer: "X-distill", verdict: "rejected" },', 'unapproved: { layer: "X-distill", verdict: "denied" },'),
    expectFail: "合并审批被拒 ⇒ gate = X-distill / rejected（问过人才算正例，不许记成门自己拦的）",
  },

  // ── 第 183 页：影响面覆盖面自述带上**分母**（`ImpactGraph.candidates` = 帽切之前的全量候选数）
  // 这一支的取料本来就先数全量再切片 ⇒ 分母免费；缺了它，「图非全量」是一句没有量的话。
  {
    id: "impact-candidates-count-post-cap",
    src: "src/agent/impact/index.ts",
    test: "tests/impact-query.test.ts",
    desc: "图自报的候选数取成**切片后**的长度 ⇒ 分母恒等于收录数，覆盖面自述在任何仓上都闭嘴"+
      "（`candidates <= files` 永真）——比旧的「非全量但不说几个」更坏：那句子至少还在",
    apply: (s) => s.replace("candidates: candidates.length,", "candidates: files.length,"),
    expectFail: "图外还有几个候选要说得出数",
  },
  {
    id: "impact-graph-candidates-not-carried-through-report",
    src: "src/agent/impact/index.ts",
    test: "tests/impact-query.test.ts",
    desc: "分母没穿过 fileImpact ⇒ 只有 symbol 支带数、file 支回到旧句子"+
      "（三支各组装一次覆盖面，少接一层就是那一支静默不一致，规则 239）",
    apply: (s) => s.replace("graphCandidates: graph.candidates,", "graphCandidates: graph.files.length,"),
    expectFail: "file 支的同一个数要穿过 fileImpact",
  },
  {
    id: "impact-coverage-denominator-constant-zero",
    src: "src/agent/impact/coverage.ts",
    test: "tests/impact-query.test.ts",
    desc: "覆盖面句里的漏报数写死 0 ⇒ 句子形状还在、数永远假（「另有 0 个候选没进图」），"+
      "模型据此认为图基本全量"+
      "（09-30：这两把纯函数从 tools 挪到 impact/coverage.ts，因为回注摘要与语义租约要说同一句 ⇒ 针脚坐标跟着挪）",
    apply: (s) => s.replace(
      "`另有 ${String(candidates - files)} 个候选文件没进这张图（帽外或被跳过）⇒ 图非全量，`",
      "`另有 0 个候选文件没进这张图（帽外或被跳过）⇒ 图非全量，`",
    ),
    expectFail: "部分覆盖时报出实数，收全时闭嘴",
  },
  {
    id: "impact-coverage-trigger-reverts-to-cap-compare",
    src: "src/agent/impact/coverage.ts",
    test: "tests/impact-query.test.ts",
    desc: "阳性一侧不接共用判据、退回旧的 `files < cap` ⇒ 两个方向同时错：候选正好等于帽时**误报**非全量（模型白重问一次），"+
      "而有文件被读/解析失败跳过时（files < cap 但候选更多）**漏报**（模型以为问全了）",
    apply: (s) => s.replace('  if (!graphIsPartial(files, candidates)) return "";', "  if (files < cap) return \"\";"),
    expectFail: "旧判据在这里误报",
  },
  {
    id: "impact-cap-cause-judgement-diverges-from-coverage",
    src: "src/agent/impact/coverage.ts",
    test: "tests/impact-query.test.ts",
    desc: "阴性一侧的成因判据不接共用判据、与阳性一侧分家 ⇒ 同一张图一边说「另有 N 个没进图」、"+
      "另一边说「与帽无关」，两句话互相拆台（共用同一判据是这条政策的形状）",
    apply: (s) => s.replace("  return graphIsPartial(files, candidates)", "  return files >= cap"),
    expectFail: "capCauseNote 与它同判据",
  },
  // ── 第 204 页：文件帽从「覆盖面政策」改成「成本安全阀」（待办 #21 笔1）
  // 四条锚点各钉一个决策点：帽的缺省值／候选次序的第二级／租约的出声／回注的自述。
  // 单价见本表尾行的分母（判卷宿主 = impact-cap-policy.test.ts，冷建 405 个文件那一格最贵）。
  {
    id: "impact-cap-default-reverts-to-mtime-slice",
    src: "src/agent/map/cap.ts",
    test: "tests/impact-cap-policy.test.ts",
    desc: "缺省帽退回 400 ⇒ 覆盖面重新变成「这台机器最近动过的 400 个」：同一份代码在 worktree 里"+
      "由 rg 遍历顺序决定谁进图，实测两棵树入图集合差 21–28%、确证口径 88 条查询答不同",
    apply: (s) => s.replace("export const MAX_FILES_DEFAULT = MAX_FILES_CEILING;", "export const MAX_FILES_DEFAULT = 400;"),
    expectFail: "缺省帽不再按机器状态切覆盖面：405 个候选全进图",
  },
  {
    id: "impact-candidate-order-nondeterministic",
    src: "src/agent/map/build.ts",
    test: "tests/impact-cap-policy.test.ts",
    desc: "排序摘掉第二级（同秒按路径字典序）⇒ 只剩 mtime：`git worktree add` 出来的树里所有文件同一个秒，"+
      "「谁进图」改由 rg 的目录遍历顺序决定。本机实测该顺序是乱序（`y a e d x c z b m`），所以这一刀可观察",
    apply: (s) => s.replace("out.sort(compareCandidates);", "out.sort((a, b) => b.mtimeMs - a.mtimeMs);"),
    expectFail: "同 mtime 的候选按路径字典序排，边界不再由 rg 决定",
  },
  {
    id: "impact-lease-partial-graph-silent",
    src: "src/agent/impact/index.ts",
    test: "tests/impact-cap-policy.test.ts",
    desc: "语义租约在图非全量时不出声 ⇒ orchestrator 拿到空波及就当「无冲突」，连审批卡都不发；"+
      "对照：钩子抛错那一支会 warn＝故障出声、缺料不出声（第 201 页两面实测：缺省臂冲突 0 条＝放行）",
    apply: (s) => s.replace("  if (graphIsPartial(graph.files.length, graph.candidates)) {\n", "  if (false) {\n"),
    expectFail: "语义租约在图非全量时出声，空波及不当结论",
  },
  {
    id: "impact-hook-note-loses-coverage",
    src: "src/agent/impact/index.ts",
    test: "tests/impact-cap-policy.test.ts",
    desc: "write/edit 后那句回注不再带覆盖面自述 ⇒「波及 2 个文件」与「图只扫了 3 个文件」同形，"+
      "模型以为问全了（读端工具早自述、注入面从不自述＝同族只硬化一支）",
    apply: (s) => s.replace("  const cov = coverageNote(r.graphFiles, r.graphCap, r.graphCandidates);\n", "  const cov = \"\";\n"),
    expectFail: "注入摘要带上同一句覆盖面自述（图全量时逐字不变）",
  },
  // ── 第 206 页：仓库地图那两半（#33）——覆盖面自述 + 降级出声。
  // 四条各钉一个决策点：追加那一句／分母从帽前来／ok:false 那一支出声／构建器抛出来那一支出声。
  // 后两条为什么必须分开：地图有两个失败出口（内部 catch 给 ok:false、外面抛给调用方），
  // 只守一个就会让另一个静默回到「读不到」与「没有问题」同形（规则 261）。
  {
    id: "map-self-report-dropped",
    src: "src/agent/map/build.ts",
    test: "tests/map-self-report.test.ts",
    desc: "地图正文不再追加覆盖面自述 ⇒ 模型看到一张少了 4 个文件的图而以为问全了"+
      "（读端工具早自述、地图这一支从不自述＝同族只硬化一支）",
    apply: (s) => s.replace("  return built.text + coverageNote(built.graphFiles, built.cap, built.candidates);", "  return built.text;"),
    expectFail: "地图非全量时正文带同一句覆盖面自述",
  },
  {
    id: "map-candidates-denominator-lost",
    src: "src/agent/map/build.ts",
    test: "tests/map-self-report.test.ts",
    desc: "分母退回「切片之后的文件数」⇒ graphFiles 与 candidates 恒等 ⇒ 自述永远不会开口，而帽子那一刀照咬"+
      "（句子形状还在、数永远假，与 impact-coverage-denominator-constant-zero 同方向）。"+
      "针脚带 10 格缩进＋行尾换行 ⇒ 只咬**新构建那一支**（缓存命中那一支缩进 12 格，不在此面）——"+
      "不这么写会命中 2 处、给针脚体检留一条常驻「待复认」。10-02 起这一支多了一行 `retrievedFiles`，"+
      "针脚跟着长一行：只钉到 `candidates` 那行的写法会被它自己的换行判 0 命中（空操作）。",
    apply: (s) => s.replace("          candidates: candidates.length,\n          retrievedFiles: retrieved.length,\n        };", "          candidates: files.length,\n          retrievedFiles: retrieved.length,\n        };"),
    expectFail: "地图非全量时正文带同一句覆盖面自述",
  },
  {
    id: "rank-tiebreak-removed",
    src: "src/agent/map/rank.ts",
    test: "tests/map-rank.test.ts",
    desc: "排名只比分数、同分就退回**插入序** ⇒ 同一份仓库换个遍历/缓存次序就给出两份地图正文，而这两份在模型眼里" +
      "是同一句「仓库长这样」。扫描层的同秒兜底（mtime 降序＋rel 升序）在 #21 笔1 已经补过，这一支是同一条判据没铺到的接缝。" +
      "判卷刻意把两个同形文件**倒着插**（z 在前）⇒ 只有次级键才看得见正确次序；本仓当前实测没撞到同分（冷/热缓存与隔 95s 重建逐字相同），" +
      "所以这条钉的是**潜在**偏差，不是现行读数" +
      "（09-30 第 214 页：从前那句「地图随相对年龄漂」是我把「自己正在改仓库」读成了时钟，已被快照自证的探针撤掉）",
    apply: (s) => s.replace(".sort((a, b) => (b.r - a.r) || byStr(a.node.file, b.node.file) || byStr(a.node.name, b.node.name) || byStr(a.node.kind, b.node.kind))", ".sort((a, b) => b.r - a.r)"),
    expectFail: "同分节点按 file→name→kind 升序，而不是按插入序",
  },
  /* 第 476 页：`mapUnavailableText` 那个 200 字帽此前**没有观测者**——真失败那条用例的错误串只有
     一百多字，摘掉帽它照样绿。下面这一支配的是同页新补的纯函数那一格（长原因）。 */
  {
    id: "map-degrade-reason-cap-removed",
    src: "src/agent/map/build.ts",
    test: "tests/map-self-report.test.ts",
    desc: "降级说明里的原因**不再截断** ⇒ 模型面多出一段长度不受控的**外部文本**（那是异常消息，"
      + "不是我们承诺的长度）。这一支盯的是「帽还在不在」，与 `map-degradation-ok-false-silent`"
      + "（盯「这一支有没有出声」）方向相反、各红一条不同断言",
    apply: (s) => s.replace("${why.slice(0, 200)}", "${why}"),
    expectFail: "降级那句是**有界**的：原因再长也只带前 200 字（帽有观测者，且不随路径长短变）",
  },
  {
    id: "map-degradation-ok-false-silent",
    src: "src/agent/map/build.ts",
    test: "tests/map-self-report.test.ts",
    desc: "ok:false 那一支不出声（回到从前只走 console.debug）⇒ 模型读到「这轮没有地图」，"+
      "与「这仓库没有结构」同形；它据此放弃结构化定位、开始乱 grep",
    apply: (s) => s.replace('  if (!built.ok) return mapUnavailableText(built.error ?? "未记原因");', "  if (!built.ok) return null;"),
    expectFail: "地图降级要出声，并且不许被读成「仓库没有结构」",
  },
  {
    id: "heldout-absent-spec-treated-as-broken",
    src: "src/agent/eval/task-set.ts",
    test: "tests/eval-task-set.test.ts",
    desc: "把「没给 heldOut」也走畸形分支 ⇒ 12 条任务里 10 条没有隐藏面的全报错，" +
      "而跑器见任何一条解析错就拒绝出数（整批归零）。这是本轮真实踩过的坑，钉住它不许回来",
    apply: (s) => s.replace("  if (v === undefined) return { errors: [] };", "  if (v === null) return { errors: [] };"),
    expectFail: "没给 heldOut ⇒ 零报错、字段缺省（这条决定整份任务集能不能出数）",
  },
  {
    id: "heldout-src-inside-seed-allowed",
    src: "src/agent/eval/task-set.ts",
    test: "tests/eval-task-set.test.ts",
    desc: "不查隐藏文件的 src 是否落在本任务靶子里 ⇒ 它被 seed 一起拷进副本，" +
      "模型 `ls tests/` 第一遍就读到答案，「held-out」退化成「可见测试」，而分数照常绿",
    apply: (s) => s.replace("        if (seedPath !== null && (f.src === seedPath || f.src.startsWith(seedPath + \"/\"))) {", "        if (false) {"),
    expectFail: "src 落在本任务靶子里 ⇒ 报错：隐藏题会被拷进副本，模型第一遍就看见答案",
  },
  {
    id: "heldout-spec-without-expect-silent",
    src: "src/agent/eval/task-set.ts",
    test: "tests/eval-task-set.test.ts",
    desc: "给了 heldOut 却不要求判它 ⇒ 隐藏测试装了、跑了、没人看，" +
      "数据集作者以为这一格生效了（与「拼错的字段名静默忽略」同一种病）",
    apply: (s) => s.replace("  if (ho.heldOut !== undefined && !expects.includes(HELD_OUT_EXPECT)) {", "  if (false) {"),
    expectFail: "给了却不判它 ⇒ 报错：装了跑了没人看，属静默不生效",
  },
  /* ---- 候选面的载荷目录排除（10-02 第三簇，任务 #14 的前半）----
   * 三条各钉一态：谓词形状、接线在不在、以及"用绝对路径 glob 去做同一件事"这种错法。
   * 第三条最要紧：它证明这把排除没有把**拿夹具当工作区**的靶子掏空——那是边集真值判卷的取料面。 */
  {
    id: "map-payload-first-segment-lost",
    src: "src/agent/map/build.ts",
    test: "tests/map-build.test.ts",
    desc: "谓词拿整条相对路径去比第一段名单 ⇒ 只有 `fixtures/x.ts` 这种一级命中，" +
      "`fixtures/mini/app.ts` 安静放行——真仓里载荷全是深层的，等于排除整个失效而不报错",
    apply: (s) => s.replace(
      "return PAYLOAD_ROOT_DIRS.includes(slash === -1 ? rel : rel.slice(0, slash));",
      "return PAYLOAD_ROOT_DIRS.includes(rel);",
    ),
    expectFail: "纯谓词只看 workspace 相对路径的第一段",
  },
  {
    id: "map-payload-filter-not-wired",
    src: "src/agent/map/build.ts",
    test: "tests/map-build.test.ts",
    desc: "谓词写好了却没接进候选面的 filter ⇒ 地图预算照旧被靶子与证据目录吃掉 67%，" +
      "而尺的读数一格都没变——本仓「算出来不接」那一族在地图这一侧的现行样本",
    apply: (s) => s.replace(
      "      if (isPayloadPath(rel)) return false; // 载荷目录：地图与影响面都只该看\"在改的代码\"（出处见上面注释）\n",
      "",
    ),
    expectFail: "仓库根视角：fixtures 与 outputs 被排掉，src 与同名深层目录留下",
  },
  {
    id: "map-payload-exclusion-as-abs-glob",
    src: "src/agent/map/build.ts",
    test: "tests/map-build.test.ts",
    desc: "把同一件事改成往 rg 的 glob 里塞 fixtures 模式（看起来更省事）⇒ rg 拿绝对路径、按绝对路径匹配，" +
      "于是**把夹具当工作区**的那些靶子被整个掏空：边集真值判卷从此在空图上打分（假绿，比红坏）",
    apply: (s) => s.replace(
      'const NOISE_GLOBS = ["**/.git/**"',
      'const NOISE_GLOBS = ["**/.git/**", "**/fixtures/**",',
    ),
    expectFail: "反向那一半：把夹具自己当工作区时，它不被掏空（绝对路径 glob 那种错法在这里红）",
  },
  /* ---- import 面 → 精确边（10-02 第四簇，任务 #14 后半；与 #8②／#9 同根）----
   *  七条各钉一格：解析算了不接／类型边被并进来／只用不 import 的节点／缓存两支的口径／
   *  取料面接没接 imports／export 那档图案／语句级 type 的判据。
   *  这一簇的收益是可引用的：locate-recall 的正哨兵从「三档全 MISS」变成第 34 位命中，A 臂 4/16 → 6/16。 */
  {
    id: "map-import-precise-edge-not-consulted",
    src: "src/agent/map/rank.ts",
    test: "tests/map-import-edge.test.ts",
    desc: "解析器跑了、pinned 也填了，但成边那一支不查它 ⇒ 图照旧同名全连，" +
      "枢纽文件依旧拿不到 rank mass，而「不连 decoy」这一格永远无人拦（本仓「算出来不接」的现行样本）",
    apply: (s) => s.replace("    const pinnedTo = pinned.get(k);", "    const pinnedTo = undefined as string | undefined;"),
    expectFail: "A 从 b 取 Thing 而 decoy c 也定义 Thing ⇒ 只连 b，不连 c（#9 歧义在这一格闭合）",
  },
  {
    id: "map-import-type-edge-pooled",
    src: "src/agent/map/rank.ts",
    test: "tests/map-import-edge.test.ts",
    desc: "把 `import type` 当运行边使 ⇒ 2026-09-23 那条裁决（先分类型边／运行边并在读端分开呈现）被绕过，" +
      "刚清出去的「同名不同实体假边」以另一副面孔回来；且 typeOnlySkipped 归零，读数再也看不出吞了多少",
    apply: (s) => s.replace("      if (ir.typeOnly) {", "      if (false && ir.typeOnly) {"),
    expectFail: "类型导入不入图：没有边，且它在计数里单独可见（不许静默吞掉）",
  },
  {
    id: "map-import-unused-ref-node-dropped",
    src: "src/agent/map/rank.ts",
    test: "tests/map-import-edge.test.ts",
    desc: "只建边不建节点 ⇒ 那条边在 nodes 里没有端点，幂迭代扫的是 nodes，于是「import 了但没用」这一整类" +
      "依赖对排名完全不起作用（adj 里看得见、单测里 edgeWeight 也查得到，偏偏差距一格）",
    apply: (s) => s.replace("      ensure(f.file, local, \"ref\", ir.line);", "      void ir;"),
    expectFail: "import 了但本地没用 ⇒ 仍建出 ref 节点，PageRank 才有可流的边",
  },
  {
    id: "map-import-cache-imports-guard-dropped",
    src: "src/agent/map/build.ts",
    test: "tests/map-import-edge.test.ts",
    desc: "读缓存只核 tags 不核 imports ⇒ 老仓里那些「版本号恰好没变、条目里没有 imports」的条目继续命中，" +
      "热缓存那支给出**没有 import 边的另一张图**，现象是「同样的代码两台机器两张地图」",
    apply: (s) => s.replace(
      " && Array.isArray(e.imports)",
      "",
    ),
    expectFail: "缺 imports 字段的旧条目按 miss 处理（版本没变也要重解析，否则老仓永远没边）",
  },
  {
    id: "map-import-cold-path-not-wired",
    src: "src/agent/map/build.ts",
    test: "tests/map-import-edge.test.ts",
    desc: "冷建那一支解析出了 imports 却没递给图（只接了热缓存那一支）⇒ 首次建图与后续建图不同形，" +
      "而「首轮注入地图」恰恰是冷的那一次",
    // 针脚只拔 `imports` 那一格，不钉整行字面量：10-02 那行加了第三个出口（summary），
    // 钉整行的针脚当场变成 0 命中的空操作——而它红不起来的样子恰恰是「接线还在」。
    apply: (s) => s.replace(
      "imports: sym.imports, ",
      "",
    ),
    expectFail: "冷建与热缓存两支都把 imports 递给图（只接其中一支＝同族只硬化一支）",
  },
  {
    id: "map-import-export-pattern-dropped",
    src: "src/agent/map/parse.ts",
    test: "tests/map-import-edge.test.ts",
    desc: "只捕 import_statement、不捕 export_statement ⇒ re-export 那一整档依赖静默消失" +
      "（`export { X } from \"./y\"` 在索引层文件里很常见），而图案列表少一行没有任何别的症状",
    apply: (s) => s.replace(
      'const IMPORT_PATTERNS = ["(import_statement) @imp", "(export_statement) @exp"];',
      'const IMPORT_PATTERNS = ["(import_statement) @imp"];',
    ),
    expectFail: "import 与 export 两档图案都在（re-export 也是一种跨文件依赖）",
  },
  {
    id: "map-import-statement-level-type-ignored",
    src: "src/agent/map/parse.ts",
    test: "tests/map-import-edge.test.ts",
    desc: "只看 specifier 自己的 `type` 令牌、不看语句级那个 ⇒ `import type { T }` 与 `export type { T } from` " +
      "整类被当运行边（第一版探针就在 export type 那档漏了，靠这条判据才抓到）",
    apply: (s) => s.replace("typeOnly: stmtType || specType,", "typeOnly: specType,"),
    expectFail: "五档形状各判一次：语句级 type 与行内 type 都要认（缺一个就漏一类）",
  },
  {
    id: "map-retrieve-javadoc-only-first-line",
    src: "src/agent/map/retrieve.ts",
    test: "tests/map-retrieval.test.ts",
    desc: "跨行块注释只吃首行（`inBlock` 不置真）⇒ 全仓那些 JSDoc 风格（星号续行）写的文件摘要恒空，" +
      "词面检索对这些文件永远「问什么都不命中」，而症状与「这文件没写注释」同形（读数一片 0 那一族）",
    apply: (s) => s.replace(
      "inBlock = true;",
      "inBlock = false;",
    ),
    expectFail: "跨行的 JSDoc 块**整段吃完**——只读首行的话，这类文件的摘要恒空，与「没写注释」同形",
  },
  {
    id: "map-retrieve-summary-not-returned",
    src: "src/agent/map/parse.ts",
    test: "tests/map-retrieval.test.ts",
    desc: "第三个出口算出来却没交（`fileSymbols` 回空 summary）⇒ 冷建与热缓存两支同时「检索面为空」，" +
      "而地图正文照旧、typecheck 照绿——只有命中率那条尺会红",
    apply: (s) => s.replace(
      "summary: commentSummary(src)",
      'summary: ""',
    ),
    expectFail: "带问句 ⇒ 检索行在正文**最前**且 retrievedFiles>0；不带 ⇒ 正文与 tokens 逐字不变（零回归哨兵）",
  },
  {
    id: "map-retrieve-corpus-not-from-inputs",
    src: "src/agent/map/build.ts",
    test: "tests/map-retrieval.test.ts",
    desc: "检索语料接成空串（图谱那份 inputs 里的 summary 被绕开）⇒ 地图建得起来、检索一行都不出，" +
      "现象是「加了这一维没有任何可观察差别」——算出来不接的本形",
    apply: (s) => s.replace(
      'summary: i.summary ?? ""',
      'summary: ""',
    ),
    expectFail: "检索语料取自**图谱那份 inputs**（另建一份摘要表就是第二套取料面）",
  },
  {
    id: "map-retrieve-budget-not-deducted",
    src: "src/agent/map/build.ts",
    test: "tests/map-retrieval.test.ts",
    desc: "把检索行加进注入而不从预算里扣 ⇒ 总注入量**悄悄超帽**（帽是承诺过的：模型输入上限/8），" +
      "而正文看起来一切正常，只有把两态放在一起比才看得出多出来那一截",
    apply: (s) => s.replace(
      "budgetAfterRetrievalLine(budget, prefix)",
      "budget",
    ),
    expectFail: "渲染那一半吃的是**扣减后的余额**（总注入量不许靠扣减之外的默契）",
  },
  {
    id: "map-retrieve-line-not-prepended",
    src: "src/agent/map/build.ts",
    test: "tests/map-retrieval.test.ts",
    desc: "算出了检索行也扣了预算，但拼接那一步把它丢了 ⇒ 白花预算、模型一个字都看不见，" +
      "而 `retrievedFiles` 读数照旧好看（两个出口分家的形状）",
    apply: (s) => s.replace(
      "const text = prefix + rendered.text;",
      "const text = rendered.text;",
    ),
    expectFail: "注入正文＝**前缀＋排名正文**（检索行不许被算出来就丢掉）",
  },
  {
    id: "map-retrieve-query-not-in-fingerprint",
    src: "src/agent/map/build.ts",
    test: "tests/map-retrieval.test.ts",
    desc: "问句不入指纹 ⇒ 渲染缓存那一格按「同一张图」复用，换一个问题命中的还是上一题的候选，" +
      "最长滞后 recomputeEvery(10) 轮（E6 那格同一个洞的第二条来路）",
    apply: (s) => s.replace(
      "merged.contextFiles, merged.queryText)",
      "merged.contextFiles)",
    ),
    expectFail: "换一个问句 ⇒ 指纹与正文都跟着变（不进货就变成「问什么都是同一张图」）",
  },
  {
    id: "map-retrieve-cache-summary-guard-dropped",
    src: "src/agent/map/build.ts",
    test: "tests/map-retrieval.test.ts",
    desc: "读缓存只核 tags/imports、不核 summary ⇒ 老条目命中后给出一张「有边、没语料」的图，" +
      "现象是同一份代码在两台机器上一个有检索行一个没有（本仓第十族：只硬化一支）",
    apply: (s) => s.replace(
      ' && typeof e.summary === "string"',
      "",
    ),
    expectFail: "缓存条目缺 summary ⇒ 整条按 miss 重解析（只核 tags/imports 的话，热缓存那支「问什么都不命中」）",
  },
  {
    id: "map-retrieve-stopword-gate-never-drops",
    src: "src/agent/map/retrieve.ts",
    test: "tests/map-retrieval.test.ts",
    desc: "停用词门槛退化成 `n`（谁都不滤）⇒ 「模型」「文件」这种到处都有的词也开始给分，" +
      "检索行从「这题相关的文件」变成「仓库里最吵的文件」，命中读数看着更满却更没信息",
    apply: (s) => s.replace(
      "Math.max(3, Math.floor(n * ratio))",
      "Math.max(3, n)",
    ),
    expectFail: "df 门槛就是 max(3, floor(N×ratio))：df=4 在 N=10 时被滤，df=3 时留着",
  },
  /* 波及面的**归属判据**（第 305 页，任务 #9）。14 枚针脚＝判据三态各一枚、措辞两格各两枚、
     三个消费点（边构造/upward/downward）各一枚、回注接线一枚、取料与两层缓存各一枚、版本号一枚——
     没有两枚红在同一条用例上（ killer 全部指向 tests/impact-attribution.test.ts 的不同标题）。
     刻意不钉的那一格见同页 readings.md：`IMPACT_INDEX_SCHEMA_VERSION` 从 2 退回 1 没有任何可观察差别
     （老 artifact 缺新字段，fail-closed 那支已经拦死），给它配针脚就是造一条恒真尺。 */
  {
    id: "impact-attribution-no-evidence-read-as-kept",
    src: "src/agent/impact/attribution.ts",
    test: "tests/impact-attribution.test.ts",
    desc: "「没有 import 面可判」被读成「正证成立」⇒ 全局脚本仓库与老缓存条目一起被算成" +
      "**已核实无归属**，措辞里那句「保守计入」失去意义（本仓反复判死的那件事：读不到与没有同形）",
    apply: (s) => s.replace('if (!binding.known) return "no-evidence";', 'if (!binding.known) return "kept";'),
    expectFail: "「无证据」优先于任何 sources：不能因为带了名字表就把没判的文件算成排除",
  },
  {
    id: "impact-attribution-positive-proof-ignored",
    src: "src/agent/impact/attribution.ts",
    test: "tests/impact-attribution.test.ts",
    desc: "正证那一支被摘掉 ⇒ 只要这个名字被任何 import 绑过，连「恰好就从定义那份文件来的」也一起判死，" +
      "清单从此**只剩没 import 面的文件**（真枢纽全被自己排除）",
    apply: (s) => s.replace('if (binding.sources.includes(defFile)) return "kept";', ""),
    expectFail: "四种输入各给一个答案：无 import 面／没有绑定证据／正证在此／反证在别处",
  },
  {
    id: "impact-attribution-only-first-source-counted",
    src: "src/agent/impact/attribution.ts",
    test: "tests/impact-attribution.test.ts",
    desc: "一个名字从两份文件绑进来时只看第一份 ⇒ 第二份定义的调用点被当成假阳性摘掉，" +
      "而多来源恰恰是最常见的形状（同一文件 re-export 两个模块）",
    apply: (s) => s.replace("binding.sources.includes(defFile)", "binding.sources[0] === defFile"),
    expectFail: "多来源里有 defFile 就留（一个名字从两份文件绑进来的形状不许整条判死）",
  },
  {
    id: "impact-attribution-reverse-proof-never-drops",
    src: "src/agent/impact/attribution.ts",
    test: "tests/impact-attribution.test.ts",
    desc: "反证那一支回落到 kept ⇒ 整条规则变成只数不删，第 304 页那两个大户（`writeFile` 140／`readFile` 114）" +
      "一个调用点都不掉，而三态读数里的 dropped 还在动（读着像在工作）",
    apply: (s) => s.replace('  return "dropped";', '  return "kept";'),
    expectFail: "四个引用方各归各位：真 import 的留、外部包与第三方绑定的摘、不 import 的留",
  },
  {
    id: "impact-attribution-note-dropped-only-gauge",
    src: "src/agent/impact/attribution.ts",
    test: "tests/impact-attribution.test.ts",
    desc: "空串闸门只核 dropped ⇒ noEvidence 单独非零时整句闭嘴，「这张图有 M 处压根没判」这个事实消失，" +
      "模型把保守计入的清单当成已收紧的清单",
    apply: (s) => s.replace('if (stats.dropped === 0 && stats.noEvidence === 0) return "";', 'if (stats.dropped === 0) return "";'),
    expectFail: "两格分别出声：dropped 说「另有出处」，noEvidence 说「保守计入」，各不带对方那句话",
  },
  {
    id: "impact-attribution-note-prints-zeros",
    src: "src/agent/impact/attribution.ts",
    test: "tests/impact-attribution.test.ts",
    desc: "闸门整条拆掉 ⇒ 每次写入的回注都多一截「；归属判定：」（parts 全空时只留个冒号），" +
      "零回归哨兵那一格（接这维之前逐字相同）当场作废——字节省在没人看的地方就不是省的",
    apply: (s) => s.replace('if (stats.dropped === 0 && stats.noEvidence === 0) return "";', 'if (false) return "";'),
    expectFail: "全 0 ⇒ 空串（不许印「排除 0 处」这种噪声）",
  },
  {
    id: "impact-edges-not-filtered-by-attribution",
    src: "src/agent/impact/index.ts",
    test: "tests/impact-attribution.test.ts",
    desc: "判据算了、三态也数了，唯独边没摘（本仓「算出来不接」那一族的正形）⇒ 事件流里的 impact_report " +
      "与语义租约看到的仍是按名字连的满图，只有读端文案里的 dropped 在动",
    apply: (s) => s.replace('if (verdict === "dropped") continue;', ""),
    expectFail: "边构造吃判据：三态计数各有一行，且摘边只看 verdict",
  },
  {
    id: "impact-upward-attribution-not-applied",
    src: "src/agent/impact/index.ts",
    test: "tests/impact-attribution.test.ts",
    desc: "只硬化边构造、`upward` 不吃判据 ⇒ `impact_query` 的符号支继续给出 140 处的满清单，" +
      "而同一张图的边集已经缩了（三支共用一把判据是这条政策的形状，第十三族）",
    apply: (s) => s.replace(
      "!defFiles.has(r.file) && attributableSomewhere(graph, r.file, symbol, defFiles)",
      "!defFiles.has(r.file)",
    ),
    expectFail: "无证据那一支：手工把 nameSources 抹掉 ⇒ 清单回到按名字图（一条不摘，且计数进 noEvidence）",
  },
  {
    id: "impact-downward-attribution-not-applied",
    src: "src/agent/impact/index.ts",
    test: "tests/impact-attribution.test.ts",
    desc: "`downward` 不回落到同一把判据 ⇒「我在调用谁」把 node:fs 的那个同名函数报成仓内的定义，" +
      "模型顺着这条边跳去改仓内文件（与 upward 两个方向各错一次，修法相反）",
    apply: (s) => s.replace('if (attributeRefToDef(binding, d.file) === "dropped") continue;', ""),
    expectFail: "downward 按 def 逐条判：otherdef.ts 看不到 ledger.ts 那份，consumer.ts 看得到",
  },
  {
    id: "impact-attribution-note-not-wired",
    src: "src/agent/impact/index.ts",
    test: "tests/impact-attribution.test.ts",
    desc: "判据接进了图而回注摘要没接 ⇒ 摘了多少没人说（模型看到「波及 73 个文件」不知道那 73 已经是判过的），" +
      "读端工具与注入面又各说各的（同族「只硬化一支」）",
    apply: (s) => s.replace("+ attributionNote(r.attribution)", '+ ""'),
    expectFail: "歧义句与归属句彼此独立：只有归属计数没有歧义时，归属句照样出",
  },
  {
    id: "impact-tags-cache-imports-guard-dropped",
    src: "src/agent/impact/index.ts",
    test: "tests/impact-attribution.test.ts",
    desc: "读缓存只核 tags ⇒ 老条目命中后 imports 是 undefined，归属判据整层拿不到取料，" +
      "现象＝「加了规则，在自己机器上一点没变」（第十族：缓存那一支不生效）",
    apply: (s) => s.replace("Array.isArray(e.tags) && Array.isArray(e.imports)", "Array.isArray(e.tags)"),
    expectFail: "tags 条目同时带 tags 与 imports；把 imports 抠掉的老条目按 miss 重解析",
  },
  {
    id: "impact-imports-exit-not-eaten",
    src: "src/agent/impact/index.ts",
    test: "tests/impact-attribution.test.ts",
    desc: "`fileSymbols` 的第二个出口算出来没接（回空数组）⇒ 每个文件都「有 import 面、一条绑定都没有」，" +
      "于是**处处判 kept**，规则看着接上了却处处不摘，且读数不是 noEvidence 而是 kept",
    apply: (s) => s.replace("imports = sym.imports;", "imports = [];"),
    expectFail: "解析走 fileSymbols（第三个出口），不回退到 fileTags 薄壳",
  },
  {
    id: "impact-index-artifact-namesources-not-saved",
    src: "src/agent/impact/persist.ts",
    test: "tests/impact-attribution.test.ts",
    desc: "取料面只在内存图里，落盘 artifact 没带 ⇒ 命中索引的那一次建图判据**整层失忆**，" +
      "同一份代码在「有索引」与「没索引」两种仓上给出不同清单（缓存层与建图分层各抄一份的那族）",
    apply: (s) => s.replace(
      "nameSources: [...graph.nameSources.entries()]",
      "nameSources: ([] as [string, Map<string, string[]>][])",
    ),
    expectFail: "索引 artifact 带上 nameSources 与 attribution；缺任何一格或版本不对都按 miss",
  },
  {
    id: "impact-index-artifact-version-not-checked",
    src: "src/agent/impact/persist.ts",
    test: "tests/impact-attribution.test.ts",
    desc: "字段齐全但版本号不符的 artifact 被照吃 ⇒ 判据换过时老图整层复活，" +
      "而字段完整性检查看不出任何异常（它只答「有没有这一格」，答不出「哪一版写的」）",
    apply: (s) => s.replace(
      "if (a.schemaVersion !== IMPACT_INDEX_SCHEMA_VERSION) return null;",
      "if (false) return null;",
    ),
    expectFail: "版本号不符的 artifact 即使字段齐全也按 miss（只加字段不认号＝老图整层复活）",
  },
  {
    id: "impact-lease-closure-bypasses-attribution",
    src: "src/agent/impact/index.ts",
    test: "tests/impact-attribution.test.ts",
    desc: "波及闭包（＝spawn 准入那把语义租约的冲突预测器）绕过 `upward` 直接吃名字图 ⇒ " +
      "读端与注入面已经按归属收窄，租约那条支继续把 `node:fs` 的同名调用方算成冲突源：" +
      "同一张图在三个消费者身上给出三种宽窄（第十三族「只硬化一支」的第四个实例）",
    apply: (s) => s.replace(
      "for (const site of upward(graph, sym)) out.add(site.file);",
      "for (const site of graph.refs.get(sym) ?? []) out.add(site.file);",
    ),
    expectFail: "闭包只算归得到的引用方：绑到外部包的那一处掉出，真 import 与没有任何绑定的都留着（宽窄两臂同一张图）",
  },
  {
    id: "impact-mixed-sites-not-counted",
    src: "src/agent/impact/index.ts",
    test: "tests/impact-attribution.test.ts",
    desc: "读端不再数「这一处只归得到别处那份定义」⇒ 那句「清单里可能混有无关文件」永远只能停在猜测，" +
      "而判据明明就在同一层手里（模型于是继续照着整份清单去动那些与本次编辑无关的文件）",
    apply: (s) => s.replace('if (attributeRefToDef(binding, normalized) === "dropped") sitesOnlyToOtherDef++;', ""),
    expectFail: "fileImpact 数得出「有几处只归得到别处那份定义」：正证的与拿不出反证的都不许算进来",
  },
  {
    id: "impact-mixed-sites-not-in-note",
    src: "src/agent/impact/index.ts",
    test: "tests/impact-attribution.test.ts",
    desc: "分母算出来了却没进注入那一句（本仓「算出来不接」那一族的最新一例）⇒ 报告字段看着完整、" +
      '判卷读字段也全绿，只有模型实际读到的那句话仍在说「可能混有」——字段与文案分家',
    apply: (s) => s.replace('+ mixed + attributionNote(r.attribution);', "+ attributionNote(r.attribution);"),
    expectFail: "分母句只在真混进时出，且出来时只多那一句（其余字节一字不动）",
  },
  {
    id: "impact-mixed-note-prints-zeros",
    src: "src/agent/impact/attribution.ts",
    test: "tests/impact-query.test.ts",
    desc: "分母句的 0 闸门拆掉 ⇒ 每次查询/回注都多一句「本次清单里 0 处只归得到别处」，" +
      "而「0 处」在两处文案里读起来像「这份清单全是别处的」——噪声还会挤掉真正有信息的那一句",
    apply: (s) => s.replace("if (count <= 0) return \"\";", "if (false) return \"\";"),
    expectFail: "那句分母只有一处文字：混进 0 就空串；两处各写一遍的话改一处忘一处会静默说谎",
  },
  /* 第 312 页：`evidence-line:` 在而行内**为空**是「没有那行」的兄弟支，此前没人判。
     修之前它一路走到 `lessonLine` 才抛，而三个生产调用点都把注入异常静默吞掉
     ⇒ 一句坏数据让整段跨会话教训消失且无人知道。这两枚各钉一道闸的一侧。 */
  {
    id: "lesson-empty-evidence-gate-dropped",
    src: "src/agent/memory/lessons.ts",
    test: "tests/memory-lessons.test.ts",
    desc: "把「空指针也不合格」那道闸摘掉 ⇒ 解析层又交回 evidence 为空串 的半合格条目，"
      + "注入侧要么抛（整段消失）要么得自己再判一次——同一道门在两处各判一遍正是本仓最忌的形状",
    apply: (s) => s.replace('  if (evidence === "") return null;\n', ""),
    expectFail: "指针行在、内容为空 ⇒ 与「没有那行」走同一道门（不合格，不是半合格）",
  },
  {
    id: "lesson-inject-fabricates-empty-digest",
    src: "src/agent/memory/inject.ts",
    test: "tests/memory-lessons.test.ts",
    desc: "注入侧给解析不出来的条目**现造**一份 digest（只按抬头筛）⇒ 空指针被拼成「〔证据: 〕」那一行，"
      + "那句「无出处的条目不会出现在这里」当场成假话；这条 killer 钉的是**行为**（段还在不在、形状对不对），"
      + "不是文案形状",
    apply: (s) => s.replace(
      '    const d = parseLessonDigest(body);\n    if (d === null) continue; // 无证据指针 ⇒ 不注入',
      '    const d = parseLessonDigest(body) ?? { headline: (body.split("\\n")[0] ?? "").trim(), evidence: "", session: "" };\n    if (!d.headline) continue; // 只看抬头',
    ),
    expectFail: "一条坏数据不许吃掉整段 LESSONS（注入侧那句「无出处的条目不会出现在这里」的真正内容）",
  },
  {
    id: "eval-feasibility-no-verifier-branch-silent",
    src: "src/agent/eval/task-set.ts",
    test: "tests/eval-task-set.test.ts",
    desc: "把「压根没有判卷命令」那一支摘掉 ⇒ 只剩「有判卷命令但本机跑不起来」那一句，"
      + "而这两件事的出路完全不同：缺的是尺（该补判卷），不是缺 pytest（装依赖就行）——读数会被指去修错的那一格",
    apply: (s) => s.replace(
      "if (task.verifier === undefined) {",
      "if (false) {",
    ),
    expectFail: "没有判卷命令那一支也要出声：blocker 说的是「没有判卷命令」，不许与工具链缺失混成一句",
  },
  {
    id: "memory-degraded-exit-swallows-again",
    src: "src/agent/memory/inject.ts",
    test: "tests/memory-degradation.test.ts",
    desc: "把出口退回静默（unavailable 恒 null）⇒ 三个消费者拿到的都是空壳且无人吭声。"
      + "触发点第 316 页换过一次（坏 lesson 文件名现在只丢那一份，见 lesson-*-isolation 那几枚），"
      + "这一枚咬的是「@引用决议写不进全局目录」那条**真抛出**的路；验的是「点名到能查的位置」"
      + "——只说「注入失败」等于让人再去 grep 一遍",
    apply: (s) => s.replace(
      "unavailable: memoryUnavailableText(err instanceof Error ? err.message : String(err))",
      "unavailable: null",
    ),
    expectFail: "真触发：外部引用的决议写不进全局目录 ⇒ 交回 unavailable，原因里带着失败的那条路径",
  },
  /* 第 316 页：一份读不动的 lesson 文件该丢那一份，不该丢整段。五枚各钉一格：
     隔离本身、槽位（先筛后切）、点名行、点名的有界性、谓词与抛出共用同一个决策点。 */
  {
    id: "lesson-unreadable-name-sinks-whole-batch",
    src: "src/agent/memory/inject.ts",
    test: "tests/memory-lesson-isolation.test.ts",
    desc: "退回「不筛，直接把整批交给 readTopicBody」⇒ 一个 lesson-中文命名.md 又让同批三条好教训一起消失"
      + "（第 315 页只是把这件事变得可见，这一枚钉的是它别再发生）",
    apply: (s) => s.replace(
      "const { keep, skipped } = splitLessonCandidates(topics, limit, isCompliantTopic);",
      "const keep = topics.slice(0, limit);\n    const skipped: string[] = [];",
    ),
    expectFail: "真触发：一份坏名字 ＋ 三条好教训 ⇒ 好教训全在、unavailable 为 null，点名行说出那一份坏文件",
  },
  {
    id: "lesson-slot-eaten-by-unreadable-name",
    src: "src/agent/memory/inject.ts",
    test: "tests/memory-lesson-isolation.test.ts",
    desc: "先切后筛（topics.slice 在 canRead 之前）⇒ 读不动的那一份占掉一个 limit 槽位，"
      + "最近 N 条静默少一条；这条只有槽位用例分辨得出来（同批条数少时点名行照样绿）",
    apply: (s) => s.replace(
      "return { keep: readable.slice(0, Math.max(0, limit)), skipped };",
      "return { keep: topics.slice(0, Math.max(0, limit)).filter((t) => canRead(t.topic)), skipped };",
    ),
    expectFail: "槽位：坏文件排在最新（modified 最大）时也不许吃掉 limit 的槽位 ⇒ limit=3 仍交回三条好教训",
  },
  {
    id: "lesson-skip-note-dropped",
    src: "src/agent/memory/inject.ts",
    test: "tests/memory-lesson-isolation.test.ts",
    desc: "隔离了却不点名 ⇒ 一份坏文件从此彻底看不见（比第 315 页那一格更静：连「断过」都不再有人知道）；"
      + "批里只剩坏名字时段还会整个消失（返回 null），所以这一枚同时钉住「条数 0 也要出声」",
    apply: (s) => s.replace(
      "const note = lessonSkipNote(skipped);",
      "const note: string | null = null;",
    ),
    expectFail: "整批只有坏名字 ⇒ 段还在、条数 0、点名行说话（旧写法在这里整段返回 null）",
  },
  {
    id: "lesson-skip-note-name-whitespace-unfolded",
    src: "src/agent/memory/inject.ts",
    test: "tests/memory-lesson-isolation.test.ts",
    desc: "点名前不折空白 ⇒ 一个带换行的文件名把一行点名撑成多行——本块按行做预算与丢弃，"
      + "行结构被外界文件名改掉就等于让它冒充一行段落（indexLine 那支早就折过同样的东西）",
    apply: (s) => s.replace('n.replace(/\\s+/gu, " ")', "n"),
    expectFail: "点名有帽：名字里的空白折成单空格、每条截到帽内，整行长度有上限（文件名是外界文本）",
  },
  {
    id: "topic-compliance-predicate-decoupled-from-validator",
    src: "src/agent/memory/store.ts",
    test: "tests/memory-lesson-isolation.test.ts",
    desc: "把写入口的判定换成另一份内联正则（本仓最常见的那件事：同一规矩抄两份、各自漂）⇒ 注入器按谓词筛、"
      + "写入口按那份正则抛，两份口径在 with/slash 与 65 个 l 上分家。反例读数：放宽**谓词**这一支杀不动这条用例——"
      + "两边共用一支时它们永远同答（放宽后红的是那四条真盘用例：坏名字变成读得动，整条 lesson 被当教训注入）",
    apply: (s) => s.replace(
      "if (!isCompliantTopic(topic)) {",
      "if (!/^[A-Za-z0-9]/u.test(String(topic))) {",
    ),
    expectFail: "同一个决策点：topic 谓词与 validateTopic 的抛出对同一批输入必须同答（注入器筛的就是谓词，抄两份迟早漂）",
  },
  {
    id: "cap-way-out-arms-swapped-at-ceiling",
    src: "src/agent/impact/coverage.ts",
    test: "tests/impact-query.test.ts",
    desc: "把「是否顶到上限」的两支对调 ⇒ 缺省调用（缺省＝上限）反而教模型去调大 maxFiles，"
      + "拧不动的旋钮又被指了一遍（第 51 页那族死参数式文案）；间接经 graphAbsenceNote 的那条用例只看片段，认不出整句",
    apply: (s) => s.replace("return capAtCeiling(cap)", "return !capAtCeiling(cap)"),
    expectFail: "出路那支纯函数两侧都钉：未到顶给「调大 maxFiles 后重问」，顶到上限给「调不上去⇒直读或拆仓」",
  },
  {
    id: "cap-cause-note-negative-arm-drops-other-causes",
    src: "src/agent/impact/coverage.ts",
    test: "tests/impact-query.test.ts",
    desc: "阴性臂只说「与帽无关」不说其余成因 ⇒ 模型把「没在图里」读成「仓库里没有」，"
      + "而真实成因可能是后缀不支持/被忽略规则挡掉（本仓政策的后半句：图里没有 ≠ 仓库里没有）",
    apply: (s) => s.replace("（被忽略规则/噪声目录排除、后缀不支持仍然成立）", "。"),
    expectFail: "覆盖面自述的阴性臂也要出声：与帽无关时点名其余成因，且不许留一句「调大」的假出路",
  },
  /* ── 第 326 页 · #19 裁「不改口径」之后留下的那一格出口（attributableToDef）──────────── */
  {
    id: "impact-attributable-to-def-same-file-shortcut-dropped",
    src: "src/agent/impact/index.ts",
    test: "tests/impact-attribution.test.ts",
    desc: "摘掉「引用方自己就是那份定义 ⇒ 一律 kept」这一步 ⇒ 反证型规则反过来把自己的定义摘掉"
      + "（b.ts 里的 f 从 a.ts import 过东西，于是 b.ts 里那份定义反而不归 b.ts）；这一步从前散在两个调用方，收口到这里之后只剩一处",
    apply: (s) => s.replace('  if (refFile === defFile) return "kept";', '  if (false && refFile === defFile) return "kept";'),
    expectFail: "引用方自己就是那份定义 ⇒ 一律 kept，哪怕它把这个名字绑去了别处",
  },
  {
    id: "impact-attributable-somewhere-recopies-binding",
    src: "src/agent/impact/index.ts",
    test: "tests/impact-attribution.test.ts",
    desc: "并集那一支不走共享出口、自己再构造一份 binding ⇒ 三态里「没有那张表」这一档在并集口径下先消失，"
      + "而逐份口径还在按它保守留（第十三族：同一谓词两份副本宽度不同，最宽那份才是对的——这回反过来了）",
    apply: (s) => s.replace(
      "    if (attributableToDef(graph, refFile, symbol, defFile) !== \"dropped\") return true;",
      "    if (attributeRefToDef({ known: true, sources: [] }, defFile) !== \"dropped\") return true;",
    ),
    expectFail: "★接线 并集那一支吃的是这一份出口，不在 `attributableSomewhere` 里再构造一次 binding",
  },
  /* ── 第 327 页 · #35：`expects` 的判据名也要 fail-closed（登记表 ↔ 分支表）──────────── */
  {
    id: "eval-expect-registry-typo-accepted-silently",
    src: "src/agent/eval/task-set.ts",
    test: "tests/eval-task-set.test.ts",
    desc: "把「哪些名字没登记」算成恒空 ⇒ 拼错的判据名安静地不生效，那条任务照旧进分母——"
      + "与这一层文件头明令禁止的「静默忽略拼错字段名」是同一种病，只是从前只管了字段那一半",
    apply: (s) => s.replace("  return expects.filter((e) => !EXPECT_SET.has(e));", "  return [];"),
    expectFail: "解析期拒收：带未登记判据名的那条任务**不进分母**，且错误里点名那一枚",
  },
  /* 第 418 页自偿第 414—415 页那簇欠的三根（当时 `scripts/mutate-verify.mjs` 在别人手里在飞，
   * 「尺与针脚同笔」交不出去，页上明写着欠）。三根各钉那簇的一种死法：数据层不产出规格、
   * 字段登记表不收这一枚、第三态被蒙成绿。 */
  {
    id: "swebench-judge-face-not-emitted",
    src: "src/agent/eval/task-set.ts",
    test: "tests/eval-task-set.test.ts",
    desc: "SWE-bench 构造路径不再产出 `judge` 两列 ⇒ 逐名规格整条断供：解析器与读者都还在、"
      + "却永远收不到料，读数退回同一枚退出码（「没做」伪装成「做了但没触发」）",
    apply: (s) => s.replace(`      judge: { failToPass, passToPass },\n`, ""),
    expectFail: "PASS_TO_PASS 是空数组的一份：命令少一枚 id，judge.passToPass 也照实是空（不编一份保住清单出来）",
  },
  {
    id: "task-fields-registry-drops-judge",
    src: "src/agent/eval/task-set.ts",
    test: "tests/eval-task-set.test.ts",
    desc: "字段登记表不收 `judge` ⇒ 任务集文件里写了它却被判「认不出的字段」，而内建四格一条都不带它 ⇒ "
      + "整批出不了数。与上一根各红一条：那根断产出、这根断装载（同一件事的两半，缺一半就没人知道）",
    apply: (s) => s.replace(`"seed", "verifier", "heldOut", "judge", "expects"`, `"seed", "verifier", "heldOut", "expects"`),
    expectFail: "合法一份：两列逐字落地，且与 verifier.command 各是各的（一个答退出码、一个答逐名）",
  },
  {
    id: "namedsets-unmatched-folds-to-green",
    src: "src/agent/eval/test-results.ts",
    test: "tests/eval-test-results.test.ts",
    desc: "规格里的名字在任何逐名结果里都对不上号时不落第三态 ⇒ 「压根没读到那条用例」被报成「读到了且是绿」，"
      + "而 SWE-bench 那种跨框架名字口径（TAP 标题 vs python nodeid）正是最容易整批对不上的形状",
    apply: (s) => s.replace(`  else if (unmatched.length > 0) {`, `  else if (false && unmatched.length > 0) {`),
    expectFail: "名字对不上 ⇒ 逐一点名并落第三态，绝不算成绿",
  },
  {
    id: "spec-summary-section-double-counted",
    src: "src/agent/eval/test-results.ts",
    test: "tests/eval-test-results.test.ts",
    desc: "spec 输出末尾 `✖ failing tests:` 那段**诊断复述**被当成第二份结果清单 ⇒ 逐名多数两条"
      + "（汇总标题本身 + 重复列的那条），与 `ℹ tests N` 对不上 ⇒ complete=false。"
      + "真实命中：`tests/loop-eval-synthetic-chain.test.ts` 的「靶子自己的口径」断言 3 对、实得 5 对，"
      + "head-cert 在 d6be184 与 a0850d0 两趟都因此红——而主树带着未入库的修复时全绿，"
      + "同一个仓库两个面读成两个数。修法是在见到第一条 ℹ trailer 后关掉结果行扫描。",
    apply: (s) => s.replace(`    if (summaryStarted) continue;\n`, ``),
    expectFail: "失败详情段里的汇总标题和重复失败行不再双计",
  },
  {
    id: "memory-external-ref-corrupt-silent-again",
    src: "src/agent/memory/store.ts",
    test: "tests/memory-store-pure.test.ts",
    desc: "损坏态退回静默（缺失/损坏同路）⇒ 用户批准过的 @path 无声蒸发、拒绝记录一并丢，而盘上没有任何出声",
    apply: (s) => s.replace("if ((err as NodeJS.ErrnoException)?.code !== \"ENOENT\") {", "if (false) {"),
    expectFail: "状态文件损坏 ⇒ 空态 + onCorrupt 显式告警（fail-visible，不再静默蒸发）",
  },
  {
    id: "memory-external-ref-shape-unchecked",
    src: "src/agent/memory/store.ts",
    test: "tests/memory-store-pure.test.ts",
    desc: "字段形状校验被摘 ⇒ 合法 JSON 里的字符串 approved 会变成 `includes` 的子串匹配面（批准 A 等于批准含 A 的任意引用）",
    apply: (s) => s.replace("if (!Array.isArray(raw.approved) || !Array.isArray(raw.declined)) {", "if (false) {"),
    expectFail: "形状畸形（合法 JSON、字段不是数组）同样告警且按空态返回——不许把字符串漏成 `includes` 的隐式子串匹配",
  },
];
