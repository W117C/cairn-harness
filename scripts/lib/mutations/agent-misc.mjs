// agent-misc 域的变异配置条目（2026-10-17 从 scripts/mutate-verify.mjs 按域拆出，见 PROGRESS 第 501 页）。
// 每条 = 一处语义突变 + 期望被它杀死的具体用例标题。追加条目时放进对应域的文件；
// **组间顺序不影响任何判据**（每条独立），同一文件内保持原顺序以便 diff。
export const MUTATIONS = [
  {
    id: "clarify-submit-unknown",
    src: "src/agent/gates.ts",
    test: "tests/clarify.test.ts",
    desc: "提交到无人等待的 callId 误返回 true（误挂/误改状态）",
    apply: (s) => s.replace("    if (!resolve) return false;\n    this.pending.delete(callId);\n    resolve(answers);",
                            "    this.pending.delete(callId);\n    resolve(answers);"),
    expectFail: "提交到无人等待的 callId → 返回 false（不误挂）",
  },
  // ---- 经济性裁剪与可信进度边界（tests/economics.test.ts 零锚点：省钱这条线自己那套判据）----
  {
    id: "econ-hard-window-threshold-off-by-one",
    src: "src/agent/economics.ts",
    test: "tests/economics.test.ts",
    desc: "余量阈值从 >= 改成 > ⇒ 正好落在阈值上那一拍不再受硬窗保护，而这一拍恰恰是必爆的那一拍",
    apply: (s) => s.replace("      input.contextTokens >= input.windowTokens - (valid(c.windowReserveTokens)", "      input.contextTokens > input.windowTokens - (valid(c.windowReserveTokens)"),
    expectFail: "hard window overrides every economic decline at exact reserve threshold",
  },
  {
    id: "econ-unknown-cost-faked-as-zero",
    src: "src/agent/economics.ts",
    test: "tests/economics.test.ts",
    desc: "成本未知时按 0 计 ⇒ 压缩看起来永远免费，break-even 恒成立（不编数这条规矩的反面）",
    apply: (s) => s.replace("const rebuildCostTokens = write === null || ratio === null ? null :", "const rebuildCostTokens = write === null || ratio === null ? 0 :"),
    expectFail: "does not fake unknown costs, debt, saving or prices; ratio below one floors incremental cost",
  },
  {
    id: "econ-plan-coverage-check-vacuous",
    src: "src/agent/economics.ts",
    test: "tests/economics.test.ts",
    desc: "「批准过的文件都写完了」这道判定直接返回真 ⇒ 计划只做一半就在边界处剪掉前面的证据",
    apply: (s) => s.replace("  const planCovered = () => plan === null ||", "  const planCovered = () => true ||"),
    expectFail: "will not cut an unfinished plan/pair, failed write, stale verify, or worker pair",
  },
  {
    id: "econ-empty-verify-counts-as-proof",
    src: "src/agent/economics.ts",
    test: "tests/economics.test.ts",
    desc: "去掉 results.length>0 ⇒ 空 results 的 every 真空成立，一次没跑任何命令的 verify 也能关边界",
    apply: (s) => s.replace("      const ok = e.ok && e.results.length > 0 && e.results.every((r) => r.ok);", "      const ok = e.ok && e.results.every((r) => r.ok);"),
    expectFail: "ignores assistant completion claims, failed/orphan verification, and empty evidence",
  },
  {
    id: "econ-pre-approval-write-credited",
    src: "src/agent/economics.ts",
    test: "tests/economics.test.ts",
    desc: "覆盖登记不再看批准时刻 ⇒ 批准前那次写被算作计划已完成，用户没批的动作替计划交差",
    apply: (s) => s.replace("          if (e.ok && pair.at > plan.approvedAt) plan.covered.add(path);", "          if (e.ok) plan.covered.add(path);"),
    expectFail: "does not credit pre-approval writes or retain coverage after a failed rewrite",
  },
  {
    id: "econ-duplicate-tool-call-id-ignored",
    src: "src/agent/economics.ts",
    test: "tests/economics.test.ts",
    desc: "重复 tool_call id 不再判畸形 ⇒ 一条结果能同时给两次调用收口（复用旧证据=造边界）",
    apply: (s) => s.replace("      if (usedIds.has(e.id)) { malformed = true; continue; }", "      if (false) { malformed = true; continue; }"),
    expectFail: "supports verify evidence after result but rejects duplicate IDs and stale reused proof",
  },
  {
    id: "skill-suffix-not-charged-to-budget",
    src: "src/agent/text-budget.ts",
    test: "tests/skill-body-cap.test.ts",
    desc: "取回提示不计入预算 ⇒ 「总量 ≤ 预算」这句承诺被提示自己撑破（与 run_shell 的 SHELL_NOTICE_RESERVE 同族坑）",
    apply: (s) => s.replace("return cutToWeight(text, Math.max(0, tokenBudget - weightText(notice))) + notice;", "return cutToWeight(text, tokenBudget) + notice;"),
    expectFail: "超限时提示自己不得撑破预算（总量 ≤ 预算，且提示完整保留）",
  },
  {
    id: "clamp-marker-label-hardcoded",
    src: "src/agent/text-budget.ts",
    test: "tests/worker-role-budget.test.ts",
    desc: "提示措辞写死成「skill 正文」⇒ 角色块被截时模型看到的是别的面的名字（单位/来源不如实，本仓反复踩过的口径谎言）",
    apply: (s) => s.replace("const marker = \"\\n[\" + label + \"超 \"", "const marker = \"\\n[skill 正文超 \""),
    expectFail: "超限时留头部，总量精确 ≤ 预算，且提示用的是调用方给的 label",
  },
  {
    id: "cjk-weight-collapsed-to-quarter",
    src: "src/agent/text-budget.ts",
    test: "tests/text-budget-cjk.test.ts",
    desc: "退回「一律 chars/4」⇒ 中文段被低估四倍，「≤ 2000 token」的角色块实际能到 6k+，且纯英文测试完全测不出",
    apply: (s) => s.replace("return isWideAt(code) ? 1 : 0.25;", "return 0.25;"),
    expectFail: "中文一字计一 token（旧口径会把它记成 1/4，等于预算被低估四倍）",
  },
  {
    id: "cjk-han-range-narrowed",
    src: "src/agent/text-budget.ts",
    test: "tests/text-budget-cjk.test.ts",
    desc: "常用汉字区间被写窄 ⇒ 绝大多数中文正文仍走 1/4 权重（区间表写错比不写更难查：只有生僻字面才露馅）",
    apply: (s) => s.replace("(code >= 0x4e00 && code <= 0x9fff) ||", "(code >= 0x4e00 && code <= 0x4e00) ||"),
    expectFail: "中文一字计一 token（旧口径会把它记成 1/4，等于预算被低估四倍）",
  },
  {
    id: "clamp-cut-by-chars-not-weight",
    src: "src/agent/text-budget.ts",
    test: "tests/text-budget-cjk.test.ts",
    desc: "估算器按类别计数、取点却仍按字符数 ⇒ 中文正文截完仍超预算（估算与执行两套口径，本仓反复踩的同族）",
    apply: (s) => s.replace("return cutToWeight(text, Math.max(0, tokenBudget - weightText(notice))) + notice;", "return text.slice(0, Math.max(0, tokenBudget * 4 - notice.length)) + notice;"),
    expectFail: "中文正文截完仍然 ≤ 预算（旧实现按 chars/4 取点，这里会溢出近四倍）",
  },
  {
    id: "shape-doc-head-not-charged-to-cap",
    src: "src/agent/shape.ts",
    test: "tests/shape-doc-cap.test.ts",
    desc: "[开头] 又无条件追加 ⇒ 一个长段落就把 maxChars 撑穿，而同族 shapeCode/shapeLog 都严格切帽（调用方按帽记账）",
    apply: (s) => s.replace("  if (shaped.length + head.length <= maxChars) shaped += head;", "  shaped += head;"),
    expectFail: "大纲很短、开头段落很长：合计仍不得越过 maxChars",
  },
  {
    id: "shape-doc-head-always-dropped",
    src: "src/agent/shape.ts",
    test: "tests/shape-doc-cap.test.ts",
    desc: "把「装得下才补」写成永不补 ⇒ 大纲丢掉开头上下文（信息更少并不更安全），零回归侧必须拦住它",
    apply: (s) => s.replace("  if (shaped.length + head.length <= maxChars) shaped += head;", "  if (shaped.length + head.length <= 0) shaped += head;"),
    expectFail: "装得下时照旧补 [开头]（零回归：不加也不少加）",
  },
  {
    id: "tail-clamp-keeps-head",
    src: "src/agent/text-budget.ts",
    test: "tests/text-budget-cjk.test.ts",
    desc: "留尾一支退化成留头 ⇒ 错误日志的结论行（N failed / stack 末行）整段丢失，注入的正文改无可改",
    apply: (s) => s.replace("  return text.slice(start);\n}", "  return text.slice(0, start);\n}"),
    expectFail: "超限时保留尾部原文，提示行在前且自己计入预算",
  },
  {
    id: "tail-clamp-marker-free",
    src: "src/agent/text-budget.ts",
    test: "tests/text-budget-cjk.test.ts",
    desc: "提示行不计入预算 ⇒「≤ 预算」这句承诺被自己的提示撑破（NOTICE_RESERVE 同族坑，这座帽是跨轮重送的）",
    apply: (s) => s.replace("return marker + cutToWeightTail(text, Math.max(0, tokenBudget - weightText(marker)));", "return marker + cutToWeightTail(text, tokenBudget);"),
    expectFail: "超限时保留尾部原文，提示行在前且自己计入预算",
  },
  {
    id: "join-credits-worker-verify-to-parent",
    src: "src/agent/tool-choice.ts",
    test: "tests/tool-choice.test.ts",
    desc: "读数侧不再按归因摘 worker 的验证 ⇒ 「写过盘没验」在开了 worker 自动验证的会话上假绿（分子被悄悄清掉）",
    apply: (s) => s.replace("if (!hasWorkerAttribution(e)) mainVerifyPass = true;", "mainVerifyPass = true;"),
    expectFail: "写盘与验证都只算主会话侧：worker 的 verify 通过不替父会话销账",
  },
  // ---- 观察账本构造同源 + 会话数据真删盘（2026-09-20 零引用扫描分诊补）----
  {
    id: "observation-ledger-write-side-id-drift",
    src: "src/agent/solpi-runtime.ts",
    test: "tests/solpi-runtime.test.ts",
    desc: "写入侧自己另起一个 sessionId 构造账本 ⇒ 回取侧/撤销侧按同名打开的是另一个空账本，删会话与 obs_recall 都摸不到刚归档的脱敏文本",
    apply: (s) => s.replace("    if (flags.observationPack || flags.evidenceReceipts) this.ledger = createObservationLedger(directory);", "    if (flags.observationPack || flags.evidenceReceipts) this.ledger = new ObservationLedger({ sessionDataDir: directory, sessionId: \"obs-other\", enabled: true });"),
    expectFail: "removePrivateSessionData 撤销的是写入侧那个账本：删除前读得到、删除后目录与对象都没了",
  },
  {
    id: "private-session-data-not-unlinked",
    src: "src/agent/solpi-runtime.ts",
    test: "tests/solpi-runtime.test.ts",
    desc: "撤销了清单却把目录留在盘上 ⇒ 「删会话」删的是引用不是内容，脱敏文本仍在应用数据目录里",
    apply: (s) => s.replace("  await ledger.deleteSession();\n  await rm(directory, { recursive: true });", "  await ledger.deleteSession();"),
    expectFail: "removePrivateSessionData 撤销的是写入侧那个账本：删除前读得到、删除后目录与对象都没了",
  },
  {
    id: "evidence-receipt-reports-known-completeness-as-unknown",
    src: "src/agent/solpi-runtime.ts",
    test: "tests/solpi-receipt-integration.test.ts",
    desc: "收据的完整性回条写死 unknown ⇒ 系统明明把每条引文逐字对过原文却报「不知道」，模型只能白召回一次或重跑同一条命令",
    apply: (s) => s.replace("quotes_verified=${String(receipt.evidence.length)}", "completeness=unknown"),
    expectFail: "restores genuine receipts after two sends and full source on invalidation (observationPack=true)",
  },
  {
    id: "ms-tail-drop-became-middle-splice",
    src: "src/agent/model-surface.ts",
    test: "tests/model-surface.test.ts",
    desc: "丢工具时从前往后找 ⇒ 变成「中间摘」：可缓存前缀被切断，且丢的次序不再等于数组尾序",
    apply: (s) => s.replace("for (let i = working.length - 1; i >= 0; i--) {", "for (let i = 0; i < working.length; i++) {"),
    expectFail: "尾丢 ⇒ 保留表是原表的位置前缀（中间摘会把可缓存前缀切断）",
  },
  {
    id: "ms-core-tier-ignored",
    src: "src/agent/model-surface.ts",
    test: "tests/model-surface.test.ts",
    desc: "core 身份判定失效 ⇒ 降配梯开始砍基础工具（便宜的废会话），帽越紧越危险",
    apply: (s) => s.replace("if (coreNames.has(name)) return \"core\";", "if (false) return \"core\";"),
    expectFail: "core 永不被自动砍：帽紧到装不下时报 unresolvable 交人裁决",
  },
  {
    // 本条曾是「去掉未超预算原样返回支」——实测**变异存活**，因为那一支是快路径而非语义分支：
    // 梯级对未超帽输入本来就是 no-op（丢不动、压不着、note 为空）。留着它图的是每轮少两次全量序列化，
    // 别为它再造针脚。这里换成真正有分辨力的两条：梯级次序、以及基础提示是否计进账。
    id: "ms-ladder-order-inverted",
    src: "src/agent/model-surface.ts",
    test: "tests/model-surface.test.ts",
    desc: "梯级 A 整个跳过（不压描述）⇒ 明明「压一压就装得下」的场景被白丢几把工具（降配序是本模块的主张，不是实现细节）",
    apply: (s) => s.replace("  const tightened = input.specs.map((s) => {\n    const name = s.function.name;\n    if (surfaceTierOf(name, input.coreNames) === \"core\") return s as T;", "  const tightened = input.specs.map((s) => {\n    const name = s.function.name;\n    if (true) return s as T;"),
    expectFail: "梯级 A（压描述）在 B（丢工具）之前：刚好超一点时一把都不丢",
  },
  {
    id: "ms-fixed-face-forgets-system",
    src: "src/agent/model-surface.ts",
    test: "tests/model-surface.test.ts",
    desc: "固定面只算工具规格、漏掉基础提示 ⇒ 账与逐件排行对不上，帽按虚低的面判",
    apply: (s) => s.replace("  const fixedChars = input.systemChars + toolSpecChars;", "  const fixedChars = toolSpecChars;"),
    expectFail: "逐件排行相加恰等于总账（对不上账的排行表不能拿去决定砍谁）",
  },
  {
    id: "pc-serialize-layer-keeps-closing-bracket",
    src: "src/agent/prefix-churn.ts",
    test: "tests/prefix-churn.test.ts",
    desc: "序列化留着数组尾那个右方括号 ⇒ 纯追加永远差一个括号，PC1 整条判据失灵",
    apply: (s) => s.replace("  return JSON.stringify(items).slice(0, -1);", "  return JSON.stringify(items);"),
    expectFail: "serializeLayer 去掉数组尾 ⇒ 纯追加时上一轮整串就是本轮的前缀",
  },
  {
    id: "pc-pure-append-always-true",
    src: "src/agent/prefix-churn.ts",
    test: "tests/prefix-churn.test.ts",
    desc: "纯追加判定恒真 ⇒ 中段重写（prune 改写历史中段那一族）再也判不出红",
    apply: (s) => s.replace("    pureAppend: stableChars === prevLayer.length,", "    pureAppend: stableChars >= 0,"),
    expectFail: "PC1 纯追加真、中间摘假、无相邻对时判红（无分辨力不许当通过）",
  },
  {
    id: "pc-volatile-changed-conjunct-dropped",
    src: "src/agent/prefix-churn.ts",
    test: "tests/prefix-churn.test.ts",
    desc: "只看「可缓存面没变」不看「易变块真的变了」⇒ 什么都不动的样本也能报通过（本仓最忌的真空通过）",
    apply: (s) => s.replace("    ok: faces.size === 1 && volatileChanged,", "    ok: faces.size === 1,"),
    expectFail: "PC2 的「无分辨力」本身判红：易变块整轮不变时不许报通过",
  },
  {
    id: "pc-face-change-named-shortcut",
    src: "src/agent/prefix-churn.ts",
    test: "tests/prefix-churn.test.ts",
    desc: "「有没有出声」直接当真 ⇒ 工具面静默变化这一族从判据里消失",
    apply: (s) => s.replace("    const named = (now.faceNote ?? \"\").length > 0 || (before.faceNote ?? \"\").length > 0;", "    const named = true;"),
    expectFail: "--self-test 全造得红，且**每条规则都有自己的反向对照**（加规则不加对照即红）",
  },
  {
    id: "pc-determinism-count-hardcoded",
    src: "src/agent/prefix-churn.ts",
    test: "tests/prefix-churn.test.ts",
    desc: "降配抖动计数写死成 1 ⇒ 每轮重写一遍前缀的代价再也量不出来",
    apply: (s) => s.replace("  const distinct = new Set(faces).size;", "  const distinct = 1;"),
    expectFail: "PC4 同一份超限面装配多次必须逐字同一；遍历顺序一抖就红",
  },
  {
    id: "pc-attribution-ignores-evidence",
    src: "src/agent/prefix-churn.ts",
    test: "tests/prefix-churn.test.ts",
    desc: "「抖了但没有认账来源」不再算静默重写 ⇒ 压缩/裁剪只要发生就一律放过，证据链失去意义",
    apply: (s) => s.replace("    silentRewrite: !reading.pureAppend && fired.length === 0,", "    silentRewrite: false,"),
    expectFail: "churnIsAttributed 四个象限：要求抖/不抖 × 有证据/无证据",
  },
  {
    id: "pc-first-rewrite-index-flattened",
    src: "src/agent/prefix-churn.ts",
    test: "tests/prefix-churn.test.ts",
    desc: "重写点一律报第 0 条 ⇒ 读数再也指不出「是哪一条被改」，而这条判据的全部价值就是定位",
    apply: (s) => s.replace("    firstRewriteIndex: reading.pureAppend ? -1 : indexOfOffset(offsets, reading.stableChars),", "    firstRewriteIndex: reading.pureAppend ? -1 : 0,"),
    expectFail: "attributeChurn：纯追加时不报重写点；中段改写时指到**被改的那一条**",
  },
  {
    id: "pc-silent-check-dropped-from-expect-rewrite",
    src: "src/agent/prefix-churn.ts",
    test: "tests/prefix-churn.test.ts",
    desc: "要求抖的那一支只看「抖没抖」不看证据 ⇒ PC5/PC6 退化成一条存在性断言",
    apply: (s) => s.replace("  const ok = expectRewrite ? rewrote.length > 0 && silent.length === 0 : rewrote.length === 0;", "  const ok = expectRewrite ? rewrote.length > 0 : rewrote.length === 0;"),
    expectFail: "churnIsAttributed 四个象限：要求抖/不抖 × 有证据/无证据",
  },
  {
    // 本条原盯 `differsOnlyByWallClock` 的开头那句提前返回——实测**变异存活**，因为那句是**冗余**：
    // 去掉后靠「替换毫秒后比对字符串」仍给出同值。那是快路径不是语义分支（与 ms-zero-regression 同族），
    // 别为它造针脚。这里改盯真正会被做错的判定：「条目没被用到」永远报成没问题 ⇒ 白名单只增不减。
    id: "rp-stale-debt-check-always-silent",
    src: "src/agent/reproducibility.ts",
    test: "tests/reproducibility.test.ts",
    desc: "登记债永远不算过期 ⇒ 白名单只增不减，清偿了也没人来删，下一条泄漏会顺手继承一个能吸收它的条目",
    apply: (s) => s.replace("    staleDebts: debts.filter((x) => !hitDebts.has(x.id)).map((x) => x.id),", "    staleDebts: [],"),
    expectFail: "requireDebtHit 只对「复查登记表」那条开——干净状态不该因为没踩到债而红",
  },
  {
    id: "rp-strip-observation-keeps-ts",
    src: "src/agent/reproducibility.ts",
    test: "tests/reproducibility.test.ts",
    desc: "观测字段没被剥掉 ⇒ 两次跑必然因 ts 不同而判红，门自己变成假红源",
    apply: (s) => s.replace("  return rest as T;", "  return event as T;"),
    expectFail: "stripObservation 只剥观测字段，判卷字段一个不动",
  },
  {
    id: "rp-debt-prefix-not-checked",
    src: "src/agent/reproducibility.ts",
    test: "tests/reproducibility.test.ts",
    desc: "债条目不看路径前缀 ⇒ 任何字段上的毫秒都被某条登记债吸收，「白名单只管登记过的位置」失效",
    apply: (s) => s.replace("    const debt = debts.find((x) => d.path.startsWith(x.pathPrefix) && differsOnlyByWallClock(d.left, d.right));", "    const debt = debts.find(() => differsOnlyByWallClock(d.left, d.right));"),
    expectFail: "白名单只管登记过的前缀；别处的毫秒一律算泄漏",
  },
  {
    id: "rp-clean-state-reads-red",
    src: "src/agent/reproducibility.ts",
    test: "tests/reproducibility.test.ts",
    desc: "「条目没被用到」的复查对所有判据开 ⇒ 干净的 HEAD（没有快照代码）被读成红——会冤枉好状态的判据比没有更糟",
    apply: (s) => s.replace("  const staleProblem = opts.requireDebtHit === true && finding.staleDebts.length > 0;", "  const staleProblem = finding.staleDebts.length > 0;"),
    expectFail: "requireDebtHit 只对「复查登记表」那条开——干净状态不该因为没踩到债而红",
  },
  /* ---------- 能力 14：无进展检测（stagnation）的判据锚点 ---------- */
  /* ---------- 能力 15：成本 ÷ 前进（cost-per-progress）---------- */
  {
    id: "cpp-worker-into-numerator",
    src: "src/agent/cost-per-progress.ts",
    test: "tests/cost-per-progress.test.ts",
    desc: "归属拆分把 worker 的 usage 也算进主面 ⇒ 分母（只算主面的前进边界）不变、分子变大，fanout 那种形状上比值直接翻 4 倍（本轮实测就是这么抓出来的）",
    apply: (s) => s.replace("      workerTokens += t;", "      mainTokens += t;"),
    expectFail: "worker 的 usage 一律落在 workerTokens/byAgent，绝不进 mainTokens",
  },
  {
    // 第 486 页补：acceptance-sampler.ts 是本页两个缺陷的所在文件、13 条用例，而变异表里
    // **一条锚点都没有** ⇒ 整份采样器是「有判据、无分辨力」状态，恰是本仓点名的那一族。
    // 打分母口径：没红过的轮不进分母。它是这个文件最贵的一条不变量——把没红过的轮也算进去，
    // 读数会随「任务有多难」漂移，而不是反映「修得有多好」，而那种漂移**看起来完全合理**。
    id: "heal-rate-denominator-includes-clean-rounds",
    src: "src/agent/acceptance-sampler.ts",
    test: "tests/acceptance-sampler.test.ts",
    desc: "分母把没红过的轮也算进来 ⇒ 自愈率随任务难度漂移（难题一堆红灯拉低、简单题一堆绿灯抬高），"
      + "而那种漂移读起来完全像「修得好不好」，没有任何别的地方能看出它错了",
    // 打的是「把这道闸整个删掉」⇒ 每一轮都进分母（含没红过的）。不是换成 return;——
    // 那样 closeRound 一次都不计数，读出来是「全不可测」，与这里要证的那条漂移不是同一件事。
    apply: (s) => s.replace("    if (!roundHadRed) return;\n", ""),
    expectFail: "没红过的轮不进分母（否则读数随任务难度漂移，而不是反映修得有多好）",
  },
  {
    // 同一页第二条：join 键是本页修的那个真缺陷（按字段读 vs 按 agent_id 配对）。
    // 之所以值得一条锚点：**两种读法在合成语料上都能全绿**——只有真语料能分开它们
    // （真语料里 routing_decision 是独立事件，字段读法恒 0）。钉住它，下次有人"简化"回字段读法会红。
    id: "routing-coverage-joins-by-field-not-agent-id",
    src: "src/agent/acceptance-sampler.ts",
    test: "tests/acceptance-sampler.test.ts",
    desc: "覆盖率退回「读 spawn 事件上的 routing_decision 字段」⇒ 生产侧那是独立事件、按 agent_id 一对一，"
      + "字段读法在真实语料里恒读 0，而读出来的是形状错、不是「路由没上场」",
    apply: (s) => s.replace("  const withDecision = spawns.filter((e) => decided.has(e.agent_id));",
      "  const withDecision = spawns.filter((e) => (e as { routing_decision?: unknown }).routing_decision !== undefined);"),
    // 指名的必须是**真能杀它**那条：第一版我指的是「决策与 spawn 按 agent_id 对上…」，
    // 而那条断言的是 0/1——字段读法同样读出 0/1（spawn(false) 两个读法都没有那个字段）⇒ 恒真。
    // 真正分开两种读法的是「同一 id 多条决策只算一次」（1/1）：字段读法下它读 0/1。
    expectFail: "同一 id 多条决策只算一次（分母是 spawn 数，不是事件数）",
  },
  {
    id: "cpp-zero-boundary-ratio-zero",
    src: "src/agent/cost-per-progress.ts",
    test: "tests/cost-per-progress.test.ts",
    desc: "零前进被写成「每边界 0 token」⇒ 读起来像「没花钱」，而真实红跑花了 68,535。针脚吃到上一行的 `mainTokens: split.mainTokens` 才唯一：no-usage 那一支有一条逐字相同的行（原先 replace 落在**它**身上 ⇒ 声明的 killer 用例读的是另一支，杀它的其实是隔壁那条 no-usage 断言）。",
    apply: (s) => s.replace(
      "      userBoundaries: boundaries.length, mainTokens: split.mainTokens,\n      excludedWorkerTokens: split.workerTokens, tokensPerBoundary: null,",
      "      userBoundaries: boundaries.length, mainTokens: split.mainTokens,\n      excludedWorkerTokens: split.workerTokens, tokensPerBoundary: 0,",
    ),
    expectFail: "真实红跑：零 verified ⇒ 不可测（不是 0 也不是 Infinity），整笔主面就是死跑成本",
  },
  {
    id: "cpp-no-usage-ratio-zero",
    src: "src/agent/cost-per-progress.ts",
    test: "tests/cost-per-progress.test.ts",
    desc: "没有 usage 时也把比值写成 0 ⇒ 「没记账」被读成「每边界 0 token」（同一格的另一支，与上一条只差在针脚落在哪个 return）",
    apply: (s) => s.replace(
      "      userBoundaries: boundaries.length - verified.length, mainTokens: 0,\n      excludedWorkerTokens: split.workerTokens, tokensPerBoundary: null,",
      "      userBoundaries: boundaries.length - verified.length, mainTokens: 0,\n      excludedWorkerTokens: split.workerTokens, tokensPerBoundary: 0,",
    ),
    expectFail: "没有 usage：不可测且原因是 no-usage，不许把「没记账」读成「没花钱」",
  },
  {
    id: "cpp-dead-spend-hidden",
    src: "src/agent/cost-per-progress.ts",
    test: "tests/cost-per-progress.test.ts",
    desc: "零前进时死跑成本归 0 ⇒ stop-policy 最想切的那一段（最后一次前进之后还在花）恰恰读不到",
    apply: (s) => s.replace("      spendAfterLastBoundary: split.mainTokens, lastBoundaryEventId: null,", "      spendAfterLastBoundary: 0, lastBoundaryEventId: null,"),
    expectFail: "真实红跑：零 verified ⇒ 不可测（不是 0 也不是 Infinity），整笔主面就是死跑成本",
  },
  {
    id: "cpp-skipped-not-named",
    src: "src/agent/cost-per-progress.ts",
    test: "tests/cost-per-progress.test.ts",
    desc: "均值把不可测样本静默丢掉而不点名 ⇒ 「每前进一份花多少」成了编的（读者无从知道分母是谁）",
    apply: (s) => s.replace("  const skipped = rows.filter((r) => !r.cost.measurable).map((r) => r.id + \":\" + String(r.cost.reason));", "  const skipped: string[] = [];"),
    expectFail: "跳过项点名且 used 只数可测的",
  },
  {
    id: "cpp-coverage-toothless",
    src: "src/agent/cost-per-progress.ts",
    test: "tests/cost-per-progress.test.ts",
    desc: "分母体检只看「有没有成功跑」，不看「取不取得到边界」⇒ 全空的分面会被读成健康",
    apply: (s) => s.replace("  const ok = green.length >= 2 && withBoundary.length >= 1 && redWithout.length >= 1;", "  const ok = green.length >= 2;"),
    expectFail: "分母体检要有分辨力：成功跑全取不到边界、或没有零前进的失败样本，都判红",
  },
  {
    id: "np-green-verify-filtered-away",
    src: "src/agent/no-progress.ts",
    test: "tests/no-progress.test.ts",
    desc: "先把绿的那次 verify filter 掉再走序列 ⇒ 「红-绿-红」被读成连续两次红：中间曾经成功过一次这件事被抹掉（本仓测例当场抓住的真 bug）",
    apply: (s) => s.replace("    if (cur.ok) { run = 0; lastRed = null; continue; }", "    if (cur.ok) { continue; }"),
    expectFail: "绿一次再红 ⇒ 序列被截断",
  },
  {
    id: "np-write-suppression-ignored",
    src: "src/agent/no-progress.ts",
    test: "tests/no-progress.test.ts",
    desc: "不许抑制条件失效：两次红之间只要落过盘，那就是「换个路子再试」，归既有 verify 上限管——把它读成停滞就是误伤（针脚随 14d2736 新加的 userSpokeSinceLast 那一位搬过家：整行式针脚一改就 0 命中）",
    apply: (s) => s.replace("!cur.wroteSinceLast && ", ""),
    expectFail: "中间有成功的写 ⇒ 不报",
  },
  {
    id: "np-signature-drops-failing-line",
    src: "src/agent/no-progress.ts",
    test: "tests/no-progress.test.ts",
    desc: "签名只剩命令名（把归一化后的失败行丢掉）⇒ 「修好 a.test.ts 又撞上 b.test.ts」成了同一条结论连红：归一化抹太狠的那一侧",
    apply: (s) => s.replace("    keys.push(command + \"#\" + normalizeFailureLine(bad));", "    keys.push(command);"),
    expectFail: "六条规则全绿（复用门里同一只判据，测例不另搭一套）",
  },
  {
    id: "np-unmeasured-rule-escalated",
    src: "src/agent/no-progress.ts",
    test: "tests/no-progress.test.ts",
    desc: "把真实语料上零触发（既没证明有用也没证明无害）的往返规则提到 escalate ⇒ 分级不再由测量决定，外部那种「重 grep 被判环直接 exit 1」的错法就回来了",
    apply: (s) => s.replace('    promote("note", "alternating_thrash", signals.thrash.evidence);', '    promote("escalate", "alternating_thrash", signals.thrash.evidence);'),
    expectFail: "停滞 ⇒ escalate；action-shaped ⇒ directive；只有往返 ⇒ note；全静 ⇒ silent",
  },
  {
    id: "np-evidence-not-named",
    src: "src/agent/no-progress.ts",
    test: "tests/no-progress.test.ts",
    desc: "报警不指名（只说「卡住了」不说卡在哪一件）⇒ 模型无从换路，检测器等于装饰",
    apply: (s) => s.replace("cur.named.join(\"；\").slice(0, 400)", "String(run)"),
    expectFail: "真实红录制：报，且证据里点名了那条 pnpm 命令与错误码",
  },
  {
    id: "supervise-ring-credential-dropped",
    src: "src/agent/supervisor.ts",
    test: "tests/supervise-ring-verdict.test.ts",
    desc: "决策输入里去掉绿凭据那一支 ⇒ 无 verdict 行的环仍被判无判据（散文优先复活）",
    apply: (s) => s.replace("  if (ctx.evidence === \"verified\") return \"pass\";", "  if (false) return \"pass\";"),
    expectFail: "写过盘且凭据绿（verified）⇒ pass，报告里没有 verdict 行也成立——今日实现在这一格必然 escalate",
  },
  {
    id: "supervise-ring-stale-trusted",
    src: "src/agent/supervisor.ts",
    test: "tests/supervise-ring-verdict.test.ts",
    desc: "过期证据不再短路 ⇒ 绿拍之后又写了盘，那份绿被当成有效凭据（或直接回落到散文自述）",
    apply: (s) => s.replace("  if (ctx.evidence === \"stale\") return null;", "  if (false) return null;"),
    expectFail: "凭据过期（stale）⇒ null：绿拍之后又写了盘，那份证据已失效，不静默猜",
  },
  {
    id: "supervise-ring-forbidden-overridden",
    src: "src/agent/supervisor.ts",
    test: "tests/supervise-ring-verdict.test.ts",
    desc: "禁改面违反不再先于凭据 ⇒ 触碰 forbidden 的环只要verify绿就被 accept（契约让位于测试颜色）",
    apply: (s) => s.replace("  if (ctx.forbiddenViolated) return \"fail\";", "  if (false) return \"fail\";"),
    expectFail: "禁改面被触碰：即使凭据是 verified 也判 fail（forbidden 硬闸不被凭据顶掉）",
  },
  {
    // 这支钉的是**删除**：`RingVerdict` 里的「error」从未有生产者（`ringVerdict`/`parseVerdict` 都产不出），
    // 旧守卫却让它与 fail 同路走 retry ⇒ 读起来像「错误有专门通道」。变异 = 把那一支放回去，
    // 越界值重新被吞成 retry，用例必须红。
    id: "supervise-retired-error-verdict-revived",
    src: "src/agent/supervisor.ts",
    test: "tests/supervise-ring-verdict.test.ts",
    desc: "越界判据不再落畸形桶（恢复旧守卫里无生产者的那一支）⇒ 没人造得出的判据换来一次真钱重试",
    apply: (s) => s.replace("if (ctx.verdict !== \"pass\" && ctx.verdict !== \"fail\") {", "if (ctx.verdict !== \"pass\" && ctx.verdict !== \"fail\" && ctx.verdict !== \"error\") {"),
    expectFail: "越界判据（已删的「error」那一支，全仓无生产者）⇒ escalate，不再与 fail 同路烧一次重试",
  },
  // ---- 09-24 写向判据收成一份（`src/agent/write-face.ts`）：四处清单漂移里最贵的两格 ----
  // shell 命令形状这一支决定「经 shell 落盘算不算写过盘」；两个显式名单各是一个**刻意不做的动作**，
  // 按 rule 57 它们必须有名字与锚点，否则下一轮重构会把它们当冗余守卫删掉。
  {
    id: "writeface-shell-blind-as-before",
    src: "src/agent/write-face.ts",
    test: "tests/write-face.test.ts",
    desc: "shell 一律算写向（不收窄命令形状）⇒ 任何 `ls` 都要补一拍目标仓全量测试，收束闸变成免费的性能税",
    apply: (s) => s.replace("    return !isReadOnlyShellCommand(command).ok;", "    return true;"),
    expectFail: "反向一侧（不这么钉，看一次目录就要跑一遍全量测试）：`run_shell` 跑 `ls -la` 与 `git status` ⇒ false",
  },
  {
    id: "writeface-shell-never-writes",
    src: "src/agent/write-face.ts",
    test: "tests/write-face.test.ts",
    desc: "shell 一律不算写向（回到旧的两名字清单）⇒ 经 shell 落盘既不触发收束闸、也不使绿拍过期（假绿复活）",
    apply: (s) => s.replace("    return !isReadOnlyShellCommand(command).ok;", "    return false;"),
    expectFail: "shell 落盘算改盘：`shell_rw` 跑 `printf … >> note.txt` ⇒ true（旧的两名字清单在这一格判 false ⇒ 收束闸与 stale 双双漏）",
  },
  {
    id: "writeface-spawn-agent-counted-as-disk-write",
    src: "src/agent/write-face.ts",
    test: "tests/write-face.test.ts",
    desc: "把 spawn_agent 也当成本工作区的写盘 ⇒ 派一次活就补一拍主仓验证（它写的是自己那块 worktree，改动另走合并控制塔）",
    apply: (s) => s.replace('const NOT_THIS_WORKSPACE: ReadonlySet<string> = new Set(["spawn_agent"]);', "const NOT_THIS_WORKSPACE: ReadonlySet<string> = new Set<string>();"),
    expectFail: "派生 worker 本身不改盘（它写的是自己那块 worktree）⇒ false",
  },
  {
    id: "writeface-shellro-reads-command-shape",
    src: "src/agent/write-face.ts",
    test: "tests/write-face.test.ts",
    desc: "去掉 shell_ro 的静态只读豁免 ⇒ 它的白名单命令也被判成写向，而它按契约永远写不了盘",
    apply: (s) => s.replace("    if (STATICALLY_READONLY_SHELL.has(tool)) return false;", "    if (false) return false;"),
    expectFail: "`shell_ro` 恒 false，且这不是命名照顾而是执行面事实：写到一半的命令会被同一份静态过滤拒掉（ok:false ⇒ 根本没执行）",
  },
  {
    id: "writeface-everything-is-write",
    src: "src/agent/write-face.ts",
    test: "tests/write-face.test.ts",
    desc: "非 shell 一律算写向（绕开门的写向集）⇒ 「只读名单」与真实判据分叉，覆盖性棘轮的反向一侧必须抓到现场",
    apply: (s) => s.replace("  return isWriteCall(tool) && !NOT_THIS_WORKSPACE.has(tool);", "  return !NOT_THIS_WORKSPACE.has(tool);"),
    expectFail: "覆盖性棘轮：工具表里每个名字都必须被显式归类（算改盘 或 在只读名单里）⇒ 新增工具没登记就红",
  },
  {
    id: "worker-usage-borrows-main-tier",
    src: "src/agent/usage-attribution.ts",
    test: "tests/usage-attribution.test.ts",
    desc: "worker 查不到自己的档时回落主会话那一档 ⇒ 本仓 flash 与 standard 差 4 倍、与 strong 差更多，整笔钱按错的档折（2026-09-23 那次 40 倍分叉的同一形状）",
    apply: (s) => s.replace(
      '      const key = e.agent_id === undefined ? getMainModel() : byAgent.get(e.agent_id) ?? "";',
      "      const key = getMainModel();",
    ),
    expectFail: "worker 那一笔取 spawned 留的档，且**不许借主会话那一档**（纪律⑵）",
  },
  {
    id: "usage-attribution-reads-declared-tier",
    src: "src/agent/usage-attribution.ts",
    test: "tests/usage-attribution.test.ts",
    desc: "把归因挂回 `agent_spawned.model`（那个字段记的是申报/路由选中的**档位 id**，且无路由时整个缺席）⇒ 钱按申报档折、按真拨档花，正是第 145 页刚修掉的形状",
    apply: (s) => s.replace(
      "        const model = (e as { usage_model?: unknown }).usage_model;",
      "        const model = (e as { model?: unknown }).model;",
    ),
    expectFail: "归因取「真拨的模型名」，不取 spawned 上那个申报档位",
  },
  {
    id: "usage-stamp-overwrites-producer-model",
    src: "src/agent/usage-attribution.ts",
    test: "tests/usage-attribution.test.ts",
    desc: "不再先看 `e.model` ⇒ 生产者（provider 回执）自己上报的模型名被本地推断覆盖：provider 说得出的比我们猜的准，覆盖等于把最可靠的一格改成最可疑的一格",
    apply: (s) => s.replace(
      "      if (e.type !== \"usage\" || e.model !== undefined) return false;",
      "      if (e.type !== \"usage\") return false;",
    ),
    expectFail: "生产者自己带了 model ⇒ 不覆盖（provider 回执比我们推断权威）",
  },
  {
    id: "prompt-surface-empty-take-material-returns-green",
    src: "src/agent/prompt-surface.ts",
    test: "tests/prompt-surface-check.test.ts",
    desc: "取料为空从「抛」改成「印 0 条发现」⇒ 装配面读不到时这道门给出**绿色读数**，" +
      "而它存在的理由正是「文本承诺了一格、面上没有」（规则 128：非零退出＋零结论＝读数不可信，这里连退出码都变 0）",
    apply: (s) => s.replace(
      'if (allModes.length === 0) throw new Error("工具面一格都没取到 ⇒ 不能把「没读到」读成「没有可达性问题」");',
      "if (allModes.length === 0) return [];",
    ),
    expectFail: "取料坏了要抛，不许印 0",
  },
  {
    id: "prompt-surface-dead-counted-as-odd",
    src: "src/agent/prompt-surface.ts",
    test: "tests/prompt-surface-check.test.ts",
    desc: "把 dead 并进 odd ⇒ 两类修法相反的事合成一个数：dead 要改名／删文案，odd 要拆 per-mode 文本（任务 #16），" +
      "合并后剩下的计数读起来像「只差档没覆盖」，实际是指着不存在的能力（规则 239：三态要分开印）",
    apply: (s) => s.replace(
      'out.push({ token, face: face.name, modes: allModes, kind: "dead" });',
      'out.push({ token, face: face.name, modes: allModes, kind: "odd" });',
    ),
    expectFail: "面上完全没有 ⇒ dead",
  },
  {
    id: "prompt-surface-exempt-leaks-across-modes",
    src: "src/agent/prompt-surface.ts",
    test: "tests/prompt-surface-check.test.ts",
    desc: "豁免键从 `token@mode` 放宽成「这个 token 在任何档被登过就全放过」⇒ 一条 read-only 的存量理由" +
      "会把 default 档新出现的缺席一起消掉，存量水位（只准调低）被静默抬高（规则 238：豁免只能由命中方清空）",
    apply: (s) => s.replace(
      "if (waived.has(`${token}@${m}`)) continue;",
      "if ([...waived].some((k) => k.startsWith(`${token}@`))) continue;",
    ),
    expectFail: "豁免要真能消掉那一条，其他档不许跟着被消",
  },
  {
    id: "prompt-surface-face-scope-ignored",
    src: "src/agent/prompt-surface.ts",
    test: "tests/prompt-surface-check.test.ts",
    desc: "把「这份文本只发给哪几档」的覆盖档丢掉、永远按全局四档判 ⇒ 拆开之后只发给在场档的文本也被牵连报红，" +
      "而写错的档名不再抛（把「那一档的面读不到」静默读成「那一档没承诺」）——按档拆文本这一步就此失去证人",
    apply: (s) => s.replace(
      "const scope = face.modes && face.modes.length > 0 ? [...face.modes].sort() : allModes;",
      "const scope = allModes;",
    ),
    expectFail: "覆盖档参与判定",
  },
  {
    id: "prompt-surface-line-edit-guard-skips",
    src: "src/agent/prompt-surface.ts",
    test: "tests/prompt-surface-check.test.ts",
    desc: "摘掉「落点必须恰好命中」那一格 ⇒ 源文本里那行的开头字一改，这一档的差异就**静默消失**（模型读到别档的承诺而没人红），" +
      "前缀写松了也会连坐邻居行；两种都只能在这一刻报，事后无从分辨",
    apply: (s) => s.replace(
      "if (dropped !== edits.drops.length || replaced !== edits.replacements.length) {",
      "if (false) {",
    ),
    expectFail: "落点 0 命中要抛",
  },
  {
    id: "prompt-surface-namesonly-switch-ignored",
    src: "src/agent/prompt-surface.ts",
    test: "tests/prompt-surface-check.test.ts",
    desc: "把「描述面只认名单」这个开关摘掉（永远走形状）⇒ 参数名／目录名（`old_string`、`node_modules`）整报成死引用，" +
      "门的读数会被噪声淹没，而真承诺（描述点了别档才有的工具）反而没人愿意看（规则 242：读数一坏，整格就失去证人）",
    apply: (s) => s.replace(
      "if (opts?.namesOnly !== true) {",
      "if (false) {",
    ),
    expectFail: "参数名／目录名不当工具承诺",
  },
  /* 第 313 页：换路提示那句「原样重试不会改变结果」是**预测**，而检测器比的是历史
     （错误分支只看 action＋全失败，压根没看 observation）。三枚各钉一处：
     检测器交回的事实、文案里的比对窗口、观察分支不再说"逐字"。 */
  {
    id: "repeat-error-branch-asserts-determinism-again",
    src: "src/agent/stuck.ts",
    test: "tests/loop-repeat-nudge.test.ts",
    desc: "把 `sameObservation` 写死成 true ⇒ 检测器不再交「比过什么」，而是交「希望是什么」："
      + "连败三次而错误各不相同（flaky／超时／竞态）也会被说成「原样重试不会改变结果」，"
      + "而那句话恰好会把该再看一次的那次重试劝掉——能力 5 里最贵的一种错",
    apply: (s) => s.replace(
      "      const sameObservation = window.every((t) => t.observation === first.observation);",
      "      const sameObservation = true;",
    ),
    expectFail: "连败三次而每次错误不同 ⇒ 提示不再断言重试无效，改说最新那条本身就是新信息",
  },
  {
    id: "tool-choice-repeat-window-not-truncated",
    src: "src/agent/tool-choice.ts",
    test: "tests/tool-choice.test.ts",
    desc: "把重复键里的 `stuckObservationOf(e.output)` 换成全串 ⇒ 读数口径变了而印面照旧："
      + "「差在第 201 字」的两次结果不再算一次重复探测，重复探测率被系统性低估。"
      + "这条钉的是**量法**（窗口归谁定），与下面那条钉措辞的各红不同用例（规则 375 不适用：两个观测面）",
    apply: (s) => s.replace(
      'const key = stuckActionOf(call.name, call.args) + "\\n" + stuckObservationOf(e.output);',
      'const key = stuckActionOf(call.name, call.args) + "\\n" + e.output;',
    ),
    expectFail: "窗口边界：两条结果只差在第 201 字 ⇒ 仍算一次重复探测（这就是「前 200 字」的准确含义）",
  },
  {
    id: "tool-choice-printed-label-reverts-to-verbatim",
    src: "src/agent/tool-choice.ts",
    test: "tests/tool-choice.test.ts",
    desc: "打印面退回「逐字相同结果」⇒ 读这屏数的人以为窗口是全文，"
      + "实际两支串都截 200 字（`stuckActionOf` 截参数、`stuckObservationOf` 截结果）。"
      + "与 loop 那句同一种错，只是受众是看读数的人而不是模型，所以修法是同一句话：只声称真比过的那件事",
    apply: (s) => s.replace(
      "（同 action + 结果前 200 字相同，两支都截断）",
      "（同 action + 逐字相同结果）",
    ),
    expectFail: "印面与边界名单按窗口说话，不许再写「逐字」（读这些数的人据此判断重复率准不准）",
  },
  {
    id: "memory-degraded-sidechat-silent-again",
    src: "src/agent/sidechat.ts",
    test: "tests/memory-degradation.test.ts",
    desc: "旁路问答侧不再拼那句 ⇒ 同一件事在第二个消费者身上复活。这一枚与上一枚必须是两个位点："
      + "共用出口只保证「判定只有一份」，出声是每个消费者自己的动作（入口收敛≠出口收敛）",
    apply: (s) => s.replace(
      'if (mem.unavailable) messages.push({ role: "system", content: mem.unavailable });',
      'if (false) messages.push({ role: "system", content: mem.unavailable });',
    ),
    expectFail: "消费者② 旁路问答：同一形状（此前那里是 catch 里一句注释就算跳过）",
  },
  // ---- 2026-10-05 补：#50 的欠账里、台账点过名的那几条候选 ----
  {
    id: "spawn-agent-counted-as-disk-write",
    src: "src/agent/write-face.ts",
    test: "tests/write-face.test.ts",
    desc: "摘掉 `NOT_THIS_WORKSPACE` 那道排除 ⇒ 派生 worker / 快照 / 进程这类"
      + "「写的是别处」的工具被算成改了**本工作区**的盘，方案门与收束闸因此对它们误判",
    apply: (s) => s.replace("  return isWriteCall(tool) && !NOT_THIS_WORKSPACE.has(tool);", "  return isWriteCall(tool);"),
    expectFail: "派生 worker 本身不改盘（它写的是自己那块 worktree）⇒ false",
  },
  {
    id: "tool-choice-blocked-bucket-collapsed",
    src: "src/agent/tool-choice.ts",
    test: "tests/verify-count-by-cause.test.ts",
    desc: "被拒那一档并掉 ⇒ 工具选择账上「模型自己该改的」与「人没批的」又混成一条，"
      + "读那屏数的人无从知道红是怎么来的",
    apply: (s) => s.replace(`        else if (e.cause === "skipped") out.verifyBlocked++;`,
      `        else if (false) out.verifyBlocked++;`),
    expectFail: "tool-choice：skipped 拍不进 verifyFailures，只加 verifyBlocked",
  },
  {
    id: "card-args-digest-drops-trust-values",
    src: "src/agent/fork-cli.ts",
    test: "tests/card-args-digest.test.ts",
    desc: "白名单被清空 ⇒ verify 信任卡在终端上又只印「（repoDir, fingerprint, commands）」——"
      + "人看不到批的是哪个仓、哪几条命令，高风险确认退化成仪式（第 400 页现读的原始缺陷）",
    apply: (s) => s.replace(`const DIGEST_SHOWN_KEYS = ["repoDir", "commands", "url", "name", "pattern", "query"] as const;`,
      `const DIGEST_SHOWN_KEYS: readonly string[] = [];`),
    expectFail: "verify 信任卡的 args ⇒ 摘要点得出仓目录，也点得出要跑的命令（不是一串键名）",
  },
  {
    id: "card-args-digest-dumps-any-key",
    src: "src/agent/fork-cli.ts",
    test: "tests/card-args-digest.test.ts",
    desc: "取值改成遍历**全部**键 ⇒ 「看得见」换成「什么都刷终端」：带凭据的 args（token／apiKey）"
      + "会被印到屏幕上、进录屏、进日志。白名单的意义就是这两支之间的界线",
    apply: (s) => s.replace("  for (const key of DIGEST_SHOWN_KEYS) {", "  for (const key of Object.keys(args)) {"),
    expectFail: "正半边：不在白名单上的键（凭据形状）不许被顺手印出来",
  },
  /* ── 2026-10-11 购入批（§7.3 欠条表 + 当日新修的守卫）──
   * 前七支把优化计划 §7.8/§7.11/§7.12/§7.13 各页**已做过的反向验证**转成常驻锚点
   * （那几次注入原来只活在页面的表格里，没人重跑就等于没有）；后两支守的是当日把
   * `loadExternalRefState` 修成 fail-visible 时新增的判据。九条都先在本树杀过一遍
   * （注入 → 只跑该 killer 用例 → 转红 → 逐字节还原）才写进这张表。 */
  {
    id: "ledger-manifest-per-entry-guard-degenerate",
    src: "src/agent/ledger.ts",
    test: "tests/ledger-manifest.test.ts",
    desc: "逐条守卫退化成恒真（任何 key 都判非法）⇒ 正常 manifest 也被拒；对照组那条用例就是防这个退化形状的",
    apply: (s) => s.replace("!ID.test(id) || !e || !HASH.test(e.sha256)", "true"),
    expectFail: "对照组：原始 manifest 读得回来（守卫不能变成永真）",
  },
  {
    id: "sidechat-symlink-gate-dead",
    src: "src/agent/sidechat.ts",
    test: "tests/sidechat-core.test.ts",
    desc: "文件类型闸失效 ⇒ 工作区内指向别处的软链开始进上下文（外泄面第一道闸，§7.6 实测承重的那半）",
    apply: (s) => s.replace("if (st.isSymbolicLink() || !st.isFile()) return null; // 软链/非常规文件：fail-closed", "if (false) return null; // 软链/非常规文件：fail-closed"),
    expectFail: "软链指向工作区内的普通文件同样拒（sidechat 不收任何软链，不问落点）",
  },
  {
    id: "sidechat-realpath-containment-dead",
    src: "src/agent/sidechat.ts",
    test: "tests/sidechat-core.test.ts",
    desc: "realpath 落点闸失效 ⇒ 父目录软链这一种形状能读到工作区外（§7.6 实测：只有这道挡得住）",
    apply: (s) => s.replace("if (relReal === \"\" || relReal.startsWith(\"..\") || isAbsolute(relReal)) return null; // 软链逃逸出工作区", "if (false) return null; // 软链逃逸出工作区"),
    expectFail: "父目录是软链（ws/sub → 工作区外）⇒ 拒读（只有 realpath 落点那道闸挡得住）",
  },
];
