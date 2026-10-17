// scripts-misc 域的变异配置条目（2026-10-17 从 scripts/mutate-verify.mjs 按域拆出，见 PROGRESS 第 501 页）。
// 每条 = 一处语义突变 + 期望被它杀死的具体用例标题。追加条目时放进对应域的文件；
// **组间顺序不影响任何判据**（每条独立），同一文件内保持原顺序以便 diff。
export const MUTATIONS = [

  // ── 文档预算门 / 耗时账本 / 可判性闸（spec §7；判据全是纯函数，内存字符串进 findings 出）
  {
    id: "docs-budget-comparison-flipped",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "字节预算比较符翻成 >=（恰好踩线的合规文件被判红——本仓自己定过「预算只准调低」，误伤即逼人放宽常量）",
    apply: (s) => s.replace("if (f.bytes > limit) {", "if (f.bytes >= limit) {"),
    expectFail: "恰好等于预算不判红（钉住「严格大于」——比较符翻成 >= 即红在此）",
  },
  {
    id: "docs-budget-empty-file-blind",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "去掉空壳分支（0 字节的 AGENTS.md 是「门没了」而不是「瘦到位了」，静默放行等于自我关闭）",
    apply: (s) => s.replace("} else if (f.bytes === 0) {", "} else if (false) {"),
    expectFail: "零字节判红（文件缺失不是合规，是空壳）",
  },
  {
    id: "docs-citation-exemption-blind",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "行级豁免标记完全不认（逃生舱失效后人们只会去拆字符串绕判据——theme.ts 的 DARK_QUERY 拆行就是本仓归档过的反面样例）",
    apply: (s) => s.replace('if (reason !== "") continue;', 'if (reason === "__never__") continue;'),
    expectFail: "同行带 docs-check:allow + 理由 → 放行",
  },
  {
    id: "docs-citation-exemption-file-scope",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "豁免标记从「保所在行」扩成「保整个文件」（一个标记即可让全文件的行号引用逃逸，闸变成装饰）",
    apply: (s) => s.replace("ALLOW_MARK.exec(line)", "ALLOW_MARK.exec(s.text)"),
    expectFail: "豁免标记只保所在行，不豁免整个文件",
  },
  {
    id: "docs-citation-exemption-unaudited",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "空理由也算豁免（豁免不可审计 = 与没有豁免等价，只是给了静默放行的口子）",
    apply: (s) => s.replace('if (reason !== "") continue;', "continue;"),
    expectFail: "标记后不写理由 → 不豁免（豁免必须可审计）",
  },
  {
    id: "docs-state-rev-existence-blind",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "不再校验 rev 指向的提交是否真存在（伪 sha 过关 = 这条判据退化成纯格式检查）",
    apply: (s) => s.replace("if (!shaExists(sha))", "if (false)"),
    expectFail: "rev 指向不存在的提交 → 红（防伪引用，且 detail 带那个 sha）",
  },
  {
    id: "docs-waiver-stale-blind",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "不再挑 stale 豁免（水位条目烂在表里没人清 = 违规面只会随时间悄悄变大）",
    apply: (s) => s.replace("if ((byKey.get(k) ?? []).length === 0) stale.push(k);", "if (false) stale.push(k);"),
    expectFail: "水位已不再被命中 → 记 stale（豁免烂掉必须被清，不能静默留着）",
  },
  {
    id: "docs-waiver-empty-file-waived",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "空壳 0B 也被水位豁免（水位豁免的是存量违规的量，不是「任何违规免死」）",
    apply: (s) => s.replace("if (v === 0 || v > wa.upTo)", "if (v > wa.upTo)"),
    expectFail: "实测 0B（空壳）不被水位豁免——水位豁免的是存量违规的量，不是免死金牌",
  },
  {
    id: "docs-waiver-count-offbyone",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "条数水位的边界挪一格（i > upTo：水位 2 却连第 3 处也放掉，棘轮少咬一条）",
    apply: (s) => s.replace("if (i >= wa.upTo) kept.push(", "if (i > wa.upTo) kept.push("),
    expectFail: "D-3：水位是**条数**——3 处命中配水位 3 全放，配水位 2 只放行前 2 处",
  },
  {
    id: "facts-ring-cap-dropped",
    src: "scripts/facts.ts",
    test: "tests/facts.test.ts",
    desc: "去掉环形上限（账本只增不减，第三份 PROGRESS.md 就是这么长出来的）",
    apply: (s) => s.replace("runs: runs.slice(Math.max(0, runs.length - cap))", "runs: runs"),
    expectFail: "超过上限时丢最旧的那次，保留最近的",
  },
  {
    id: "facts-maxms-takes-last-sample",
    src: "scripts/facts.ts",
    test: "tests/facts.test.ts",
    desc: "历史最贵退化成「最近一次的 ms」（最贵那次被最近一次覆盖 → 「砍哪道门省时间」这张表读出来是错的）",
    apply: (s) => s.replace("maxMs: Math.max(prev?.maxMs ?? 0, g.ms),", "maxMs: g.ms,"),
    expectFail: "maxMs 取样本里的最大值——「哪道门最贵」直接可读",
  },
  {
    id: "docs-obs-spec-exempt-blind",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "规格值免检整条摘掉（≤1000ms 这类**契约**被判成手抄观测值 ⇒ 人们只好去改判据，判卷纪律最忌的那一步）",
    apply: (s) => s.replace("if (SPEC_CONTEXT.test(line)) continue;", "if (false) continue;"),
    expectFail: "带比较符的规格阈值放行（≤1000ms 是契约不是观测）",
  },
  {
    id: "docs-obs-scope-widened",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "D-2 适用面从「现行层五页」扩到所有页（archive 与 dated spec 里的历史观测值被追溯判红 ⇒ 门变成不可满足，等价于关掉）",
    apply: (s) => s.replace(
      "if (!LIVE_PAGES.includes(p.path)) continue; // archive/、dated specs/、源码不受这条管",
      "if (false) continue; // archive/、dated specs/、源码不受这条管",
    ),
    expectFail: "只有受管现行页参与判定：archive/ 与 specs/ 与源码都不判",
  },
  {
    id: "docs-appendnote-scope-widened",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "D-4 的档案层放行被摘（archive 就是「当日快照不得改写」这类话的唯一归宿，判红等于禁止留历史）",
    apply: (s) => s.replace(
      "if (!LIVE_PAGES.includes(p.path)) continue; // 档案层就是这类字的归宿",
      "if (false) continue; // 档案层就是这类字的归宿",
    ),
    expectFail: "档案层正是这类字的归宿，不判红",
  },
  {
    id: "docs-appendnote-wordlist-as-any-digit",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "追注词表退化成「含数字即追注」（带日期的正常裁决句被判红，误伤一次就会有人整条关掉 D-4）",
    apply: (s) => s.replace("const APPEND_CORRECTION = /上面那句|", "const APPEND_CORRECTION = /\\d|上面那句|"),
    expectFail: "普通叙述不误伤（带日期不等于追注）",
  },
  {
    id: "docs-shots-count-collapsed",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "图片数退化成恒 1（水位 25 变成永远咬不到的摆设，docs/ 可无限塞二进制）",
    apply: (s) => s.replace("    value: hits.length,", "    value: 1,"),
    expectFail: "聚合成一条 finding，value = 文件数",
  },
  {
    id: "typecheck-dirty-set-not-wired",
    src: "scripts/typecheck.ts",
    test: "tests/typecheck-triage.test.ts",
    desc: "取料算得出在飞文件却不传给归因（传个空集）⇒ 四档永远退化成两档，第三格白造（规则 230：接线要钉调用，不钉函数名）",
    apply: (s) => s.replace("triageTypecheck(out, untrackedSet(process.cwd()), dirtyTrackedSet(process.cwd()))", "triageTypecheck(out, untrackedSet(process.cwd()), new Set<string>())"),
    expectFail: "★接线：门把 dirtyTrackedSet 真的传进归因（算出来不接＝恒绿）",
  },
  {
    id: "typecheck-dirty-set-fallback-empty",
    src: "scripts/typecheck.ts",
    test: "tests/typecheck-triage.test.ts",
    desc: "git 失败时退回**空集**而不是 `null` ⇒ 空集在归因里的意思恰是「一个脏文件都没有」，于是每条报错都被记成 HEAD 缺陷；"
      + "这一格与 `untrackedSet` 那一路（空集＝保守按 HEAD）极性相反，因为这里少的是「有没有量到」，不是「为谁开脱」",
    apply: (s) => s.replace("  if (r.status !== 0) return null;", "  if (r.status !== 0) return new Set();"),
    expectFail: "★工作树状态取不到时返回 null，不许退回空集（空集＝向归因谎报「全都干净」）",
  },
  // ---- 终端面板两格（#58）：缺席≠运行中、子流≠父会话跑过（tests/renderer-terminal-liveness.test.ts）----
              /* 切片边界棘轮的两半各钉一条（同一判据由两支共同成立，一条变异只该废掉它负责的那半边）。 */
  {
    id: "slice-boundary-scanner-blind",
    src: "scripts/assertion-health.ts",
    test: "tests/assertion-health-scan.test.ts",
    desc: "尺子变瞎：切片调用里的注释标记不再被认出来 ⇒ 整条棘轮失去分辨力（清单还在，但没人读盘）。" +
      "钉的是「识别」这一半，不是「清单」那一半",
    apply: (s) => s.replace("      if (SLICE_CALLEES.has(name)) {", "      if (false) {"),
    expectFail: "indexOf 的标记是注释文字 ⇒ 报（本闸要抓的那一格）",
  },
  {
    id: "slice-boundary-every-string-is-a-marker",
    src: "scripts/assertion-health.ts",
    test: "tests/assertion-health-scan.test.ts",
    desc: "撤掉「以注释标点开头的才算边界」这道筛 ⇒ 切片调用里的每个字符串（含喂给被测码的 fixture 文本）" +
      "都成标记 ⇒ 快路必然红、且正当用途被逼去写豁免。钉的是「别误伤」那一半",
    apply: (s) => s.replace("&& COMMENT_OPEN.test(a.text)) {", ") {"),
    expectFail: "已跟踪的 tests/ 里不许新增注释文字当边界（边界一律用代码标识）",
  },
  {
    id: "facts-run-scope-guessed-as-full",
    src: "scripts/facts.ts",
    test: "tests/facts.test.ts",
    desc: "「旧账本没记范围」被读成整跑 ⇒ 缺字段这种「信息根本没有」的状态冒充出一个结论；" +
      "`--only=` 的调试跑同样会在页头自称整跑（本轮我就是这样把 1 道门读成整跑 0.0 分钟）",
    apply: (s) => s.replace('  if (!s) return "范围未记（旧账本没这个字段）";', '  if (!s) return "整跑 0 道门";'),
    expectFail: "旧账本没有这个字段 ⇒ 如实说没记，不许猜成整跑",
  },
  {
    id: "silent-green-not-charged",
    src: "scripts/assertion-health.ts",
    test: "tests/gates-scan.test.ts",
    desc: "判据在、组合面没接：一门绿而零输出被算成「没有未证」⇒ 汇总与账本重新对上「全绿」，" +
      "沉默那格退回无人观测（本仓第 10 次「两头断」的形状：机器齐全、调用方断）",
    apply: (s) => s.replace("  return countUnverified(output) + (silentGreenGate(code, output) ? 1 : 0);",
      "  return countUnverified(output);"),
    expectFail: "绿而零输出 ⇒ 计 1（自报数为 0，只有静默格贡献）",
  },
  {
    id: "silent-green-predicate-dead",
    src: "scripts/assertion-health.ts",
    test: "tests/gates-scan.test.ts",
    desc: "恒假判据：机制被换成一句永远说「不静默」的常量 ⇒ 三条正例全绿而真实表现回到旧行为" +
      "（恒假判据永远红，这里是恒假的那一面对红着的用例负责）",
    apply: (s) => s.replace("  return code === 0 && output.trim() === \"\";", "  return false;"),
    expectFail: "绿 + 空输出 ⇒ 判为静默（正例）",
  },
  {
    id: "silent-green-overreach-onto-red",
    src: "scripts/assertion-health.ts",
    test: "tests/gates-scan.test.ts",
    desc: "判据丢掉输出面只看退出码 ⇒ 红门也被计一次未证，「未证」总数被红门污染，" +
      "严格模式下同一件事既算红又算未证（两个口径互相吞）",
    apply: (s) => s.replace("  return code === 0 && output.trim() === \"\";", "  return code === 0;"),
    expectFail: "绿 + 有输出 ⇒ 不判为静默（不误伤正常汇报的门）",
  },
  {
    id: "empty-assert-tail-arg-treated-as-condition",
    src: "scripts/assertion-health.ts",
    test: "tests/assertion-health-scan.test.ts",
    desc: "把条件位判回「最后一个实参是不是 true」（旧正则的形状）⇒ 三参等值签名 check(name, actual, expected) " +
      "那族真断言又被整批判成空断言，而体检命中是判红的：判据越界会把「解释怎么写」变成「门表怎么红」",
    apply: (s) => s.replace("|| (args.length >= 2 && isTrueLit(args[1]!));", "|| isTrueLit(args[args.length - 1]!);"),
    expectFail: "三参等值签名 check(name, actual, true) ⇒ 不报（旧正则把这一族整批判成空断言）",
  },
  {
    id: "empty-assert-detail-form-lost",
    src: "scripts/assertion-health.ts",
    test: "tests/assertion-health-scan.test.ts",
    desc: "条件位收成「只有两参时才算」⇒ label-first 带 detail 的 `check(标签, true, detail)` 回到网外。" +
      "上一版锚点存活就是因为用例挑了三参等值那侧：两条规则只在「true 第二位 + 还有后续实参」这一格分歧",
    apply: (s) => s.replace("|| (args.length >= 2 && isTrueLit(args[1]!));", "|| (args.length === 2 && isTrueLit(args[1]!));"),
    expectFail: "label-first 带 detail 的 check(label, true, detail) ⇒ 报（旧正则要求 true 在尾部，这支原本在网外）",
  },
  {
    id: "empty-assert-label-first-lost",
    src: "scripts/assertion-health.ts",
    test: "tests/assertion-health-scan.test.ts",
    desc: "收窄判定面时把该留的那一半也收掉了 ⇒ label-first 的 check(\"x\", true) 不再报，空断言重新无声通过",
    apply: (s) => s.replace("|| (args.length >= 2 && isTrueLit(args[1]!));", "|| false;"),
    expectFail: "label-first 两参 check(label, true) ⇒ 报（收窄判定面后必须留着的那一半）",
  },
  {
    id: "tautology-left-branch-lost",
    src: "scripts/assertion-health.ts",
    test: "tests/assertion-health-scan.test.ts",
    desc: "恒真式只认右支字面 true（旧正则的形状）⇒ `true || x` 这一支回到网外。加宽判定面必须有用例钉住新那一支，" +
      "否则加宽是无声的",
    apply: (s) => s.replace("&& (b.left.kind === ts.SyntaxKind.TrueKeyword || b.right.kind === ts.SyntaxKind.TrueKeyword);",
      "&& b.right.kind === ts.SyntaxKind.TrueKeyword;"),
    expectFail: "代码里的恒真式仍报：右支字面 true 与新加的左支字面 true",
  },
  {
    // 这条针脚第一次钉在**门里那条规则的 ok** 上，实测存活（`ok: true` 在冻结表与语料一致时
    // 与正确实现逐字同结果）⇒ 换钉到那只纯函数的两个分支上：不判「不在表上」与不判「哈希不符」。
    // 留下这条记录：判"某条规则有没有分辨力"，喂进针脚的必须是**能被观测到的那只函数**。
    id: "np-freeze-missing-entry-ignored",
    src: "scripts/no-progress-check.ts",
    test: "tests/no-progress.test.ts",
    desc: "冻结对账不查「语料文件不在表上」⇒ 悄悄撤掉一条登记（或换一份文件）不会留下任何读数",
    apply: (s) => s.replace("  const drift = rels.filter((rel) => frozen[rel] === undefined || (actuals[rel] !== undefined && frozen[rel] !== actuals[rel]));", "  const drift = rels.filter((rel) => actuals[rel] !== undefined && frozen[rel] !== actuals[rel]);"),
    expectFail: "NP5：不在表上的语料文件必须红（翻标签的门路之一）",
  },
  {
    id: "np-freeze-hash-mismatch-ignored",
    src: "scripts/no-progress-check.ts",
    test: "tests/no-progress.test.ts",
    desc: "冻结对账只查「在不在表上」不查哈希 ⇒ 改一份事件文件（比如把红跑的失败结论改掉）照样全绿",
    apply: (s) => s.replace("  const drift = rels.filter((rel) => frozen[rel] === undefined || (actuals[rel] !== undefined && frozen[rel] !== actuals[rel]));", "  const drift = rels.filter((rel) => frozen[rel] === undefined);"),
    expectFail: "NP5：不在表上的语料文件必须红（翻标签的门路之一）",
  },
  // ---- 09-27 门表护栏自己也得有人验收：登记 head-import-check 时发现 checkGateManifest 零判卷 ----
  {
    id: "manifest-orphan-check-unconditional",
    src: "scripts/gate-manifest.ts",
    test: "tests/gate-manifest.test.ts",
    desc: "跳过「已在 GATES 里」那一判 ⇒ 每张正常门表都被报成孤儿：护栏一旦无差别地喊，读的人只会整条忽略（规则 210）",
    apply: (s) => s.replace("    if (gates.has(name)) continue;", "    if (false) continue;"),
    expectFail: "已在 GATES 里的脚本不许被报成孤儿",
  },
  {
    id: "manifest-gate-without-script-dropped",
    src: "scripts/gate-manifest.ts",
    test: "tests/gate-manifest.test.ts",
    desc: "反向那一半：不再核「门表列了而 scripts 没有」⇒ 一道 spawn 必失败的门可以静默存在（第 145 页认证树量的就是这一格）",
    apply: (s) => s.replace("    if (!scriptNames.has(gate)) {", "    if (false) {"),
    expectFail: "GATES 列了而 package.json 没有同名 script",
  },
  {
    id: "gate-manifest-head-cert-unregistered",
    src: "scripts/gate-manifest.ts",
    test: "tests/gate-manifest.test.ts",
    desc: "脚本在 package.json 里而门表没登记 ⇒ 认证 HEAD 变成一条从不运行的门（provider:check 那个历史实例的同一形状，正由本文件的 orphan 护栏兜住）",
    apply: (s) => s.replace('  "head-cert-check",\n', ""),
    expectFail: "登记面：head-cert-check 进了门表，且用的是**门自己那棵**认证树（任务 #4）",
  },

  // ── 第 150 页 · 台账编号引用的可解析性尺（14 处引用被一笔整树入库同时删死，而全仓没有一把尺喊过）
  {
    id: "blocked-citation-dead-not-reported",
    src: "scripts/lib/blocked-citations.ts",
    test: "tests/blocked-citation-face.test.ts",
    desc: "死指针算出来了却不进违例 ⇒ 台账再被整簇删空一次仍然全绿（第 122 页那次就是这个形状：14 处引用当场变死，没人喊）",
    apply: (s) => s.replace(
      '    out.push({ kind: "dead-pointer", detail: `${d.id}｜用 ${String(d.uses)} 次｜查不到落点：${d.where.join("、")}` });',
      "    void d;",
    ),
    expectFail: "负控 A：只给 `BLOCKED.md`（＝台账被删空那天的现态）⇒ 必须一片死指针并点到文件:行",
  },
  {
    id: "blocked-citation-dead-loses-location",
    src: "scripts/lib/blocked-citations.ts",
    test: "tests/blocked-citation-face.test.ts",
    desc: "只报编号不报 `文件:行` ⇒ 红是红了，但下一位要去自己 grep 一遍才知道改哪里（第 123 页给红门补落点，同一件事要做到判据身上）",
    apply: (s) => s.replace(
      '查不到落点：${d.where.join("、")}',
      "查不到落点",
    ),
    expectFail: "负控 A：只给 `BLOCKED.md`（＝台账被删空那天的现态）⇒ 必须一片死指针并点到文件:行",
  },
  {
    id: "blocked-citation-empty-face-reads-clean",
    src: "scripts/lib/blocked-citations.ts",
    test: "tests/blocked-citation-face.test.ts",
    desc: "引用面 0 处被读成「全部可解析」 ⇒ 取料面坏掉（或引用被人删净）那天，这把尺自己先假绿（规则 222 的三条假绿路之一）",
    apply: (s) => s.replace(
      '    out.push({ kind: "empty-face", detail: "引用面 0 处：要么引用被删了，要么取料面坏掉 ⇒ 两种都不算「全部可解析」" });',
      "    void cites;",
    ),
    expectFail: "空引用面＝没尺，不许读成「全部可解析」（规则 222 那一族）",
  },
  {
    id: "blocked-citation-no-ledger-also-blames-face",
    src: "scripts/lib/blocked-citations.ts",
    test: "tests/blocked-citation-face.test.ts",
    desc: "落点全部读不到时不早退 ⇒ 同一份读数既说「没尺」又说「引用面空」，把取料坏报成「引用被删了」（归因方向错到人身上，规则 218 同族）",
    apply: (s) => s.replace("  if (ledgersRead.length === 0) return out;\n", ""),
    expectFail: "一个落点都读不到 ⇒ 只报「没尺」，不许顺手报 empty-face（那会把取料坏说成引用被删）",
  },
  {
    id: "blocked-citation-join-key-keeps-prefix",
    src: "scripts/lib/blocked-citations.ts",
    test: "tests/blocked-citation-face.test.ts",
    desc: "`待办 #56` 整串去当键 ⇒ 台账里以 `#56` 立项的那条必然查不到 ⇒ 报出一片**假的**死引用（第 122 页自纠过的 join 键形状，做成锚点而不是记在注释里）",
    apply: (s) => s.replace(
      '  return raw.replace(/^待办\\s+/, "").replace(/\\s+/g, " ").trim();',
      '  return raw.replace(/\\s+/g, " ").trim();',
    ),
    expectFail: "join 键的自证：`待办 #56` 的键是 `#56`（带前缀去查必然查不到＝假死引用，第 122 页踩过）",
  },
  // ── 第 243 页 · 页号原子占号：四条各咬一处——脏值进 max／号不单调／被占了还当占到／CLI 不吃这把尺
  {
    id: "page-claim-dirty-values-in-max",
    src: "scripts/lib/page-claim.ts",
    test: "tests/page-claim.test.ts",
    desc: "脏值（小数／NaN）也参与 max ⇒ 号变成 10.5 或 NaN：台账上出现一个小数页号，而占号那一步看起来仍然「成功了」",
    apply: (s) => s.replace(
      "  for (const n of taken) if (Number.isInteger(n) && n > mx) mx = n;",
      "  for (const n of taken) if (!Number.isNaN(n) && n > mx) mx = n;",
    ),
    expectFail: "非整数不参与 max（一个 9.5 或 NaN 都不许把号带到小数／NaN），空面回 start",
  },
  {
    id: "page-claim-not-monotonic",
    src: "scripts/lib/page-claim.ts",
    test: "tests/page-claim.test.ts",
    desc: "回「最小可用号」而不是「max＋1」⇒ 新会话拿回 1，且台账上删过一页就把那个旧号再发一遍。" +
      "这不是等价的：旧号出现在两处比新号撞车更难查（判卷里那条空洞用例就是为这个存在的）",
    apply: (s) => s.replace("  return mx + 1;", "  return start;"),
    expectFail: "连续号回到 max＋1；有空洞也不回填；start 只当**下限**",
  },
  {
    id: "page-claim-exists-treated-as-ok",
    src: "scripts/lib/page-claim.ts",
    test: "tests/page-claim.test.ts",
    desc: "把「已被占」当成「占到了」⇒ 两个会话拿到同一个号而两边都以为自己独占——这正是这把尺要消灭的那件事，" +
      "而它退化后印的还是一句「占号 N」",
    apply: (s) => s.replace('    if (outcome === "ok") {', '    if (outcome !== "error") {'),
    expectFail: "别人抢先占了同一号 ⇒ 让位后**重新 list** 再占一次（拿旧名单里的下一个会把已被占的号再发一遍）",
  },
  {
    id: "page-claim-cli-not-wired",
    src: "scripts/next-page.ts",
    test: "tests/page-claim.test.ts",
    desc: "CLI 不调 claimPage 而自己发一个号 ⇒ 号池永远空、撞号照旧，但那一格读起来像「有工具在管」。" +
      "钉的是接线不是文字：这里 CLI 与被调的 lib 是两个文件，同文件恒真那一族用不上",
    apply: (s) => s.replace(
      "const r = claimPage({",
      "const r = { page: 0, cell: \"\", yielded: 0 }; void claimPage; const _unused = ({",
    ),
    expectFail: "next-page.ts 必须调 claimPage 并在没占到时退 2（只印不占＝号池永远空，撞号照旧）",
  },
  // ── 第 249 页 · 占号这把尺按评审加固：三条各咬一处——「取不到」冒充 0／边界退化成裸前缀／少一个非零出口
  {
    id: "page-claim-unreadable-ledger-prints-zero",
    src: "scripts/lib/page-claim.ts",
    test: "tests/page-claim.test.ts",
    desc: "台账那一维取不到时印「0 个」而不是「取不到」⇒ 调用方读到的是「这仓一个号都没占过」，" +
      "于是可以把很旧的号发出去；本仓最忌讳的就是把「没量到」印成一个实数（规则 261/262）",
    apply: (s) => s.replace(
      'cell: `占号 ${String(candidate)}（台账面 ${ledger === null ? "取不到" :',
      'cell: `占号 ${String(candidate)}（台账面 ${ledger === null ? "0 个" :',
    ),
    expectFail: "台账那一维取不到时要印「取不到」而不是 0，且号池那一维仍然能用",
  },
  {
    id: "page-claim-inside-repo-bare-prefix",
    src: "scripts/lib/page-claim.ts",
    test: "tests/page-claim.test.ts",
    desc: "`insideRepo` 退化成「只要 relative 算得出东西就算在里面」 ⇒ `--file=/etc/passwd`、`/repo/../x`、" +
      "同前缀兄弟目录全被放行（第十族：前缀匹配要按位置枚举变体；这里连前缀都不如）",
    apply: (s) => s.replace(
      '  return rel !== "" && !rel.startsWith("..") && !rel.startsWith("/");',
      '  return rel !== "";',
    ),
    expectFail: "insideRepo：按目录边界判，绝对路径/out/../ 与同前缀兄弟目录都算在外面，空根不算在里面",
  },
  {
    id: "page-claim-cli-exits-1",
    src: "scripts/next-page.ts",
    test: "tests/page-claim.test.ts",
    desc: "四个「没占到」出口里少任何一个 ⇒ CLI 照常打印一句人话然后退 0，调用方把「这一格没量到」读成「号发好了」。" +
      "判卷数的是**个数**（旧的无 g 正则被第一个出口满足，删掉最后一个仍然绿——评审实测两删都过，这次钉成计数）",
    apply: (s) => s.replace(
      "  process.exit(2);\n}\nconsole.log(`✅ 下一页用",
      '  console.log("（这里少了一个非零出口）");\n}\nconsole.log(`✅ 下一页用',
    ),
    expectFail: "next-page.ts 必须调 claimPage 并在没占到时退 2（只印不占＝号池永远空，撞号照旧）",
  },
  // ── 第 257 页 · D-9 的取料目录名不许钉死月份（跨月那天整类凭证静默失检，门照印「红 0」）
  {
    id: "cred-dir-date-pattern-month-locked",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "把日期段退回钉死月份（`-2026-09-\\d{2}`）⇒ 10 月点名的取料目录抽不到，整页被归进「未点名＝未检」，" +
      "而汇总行照印「红 0」——**这一格的失检不产生任何红**，所以必须靠一条喂非 9 月输入的断言来钉（规则 237/242）",
    apply: (s) => s.replace(
      "[A-Za-z0-9._-]+-\\d{4}-\\d{2}-\\d{2}",
      "[A-Za-z0-9._-]+-2026-09-\\d{2}",
    ),
    expectFail: "取料目录名按 `YYYY-MM-DD` 认，月份不许钉死（第 257 页：跨月那天整类凭证静默失检）",
  },
  {
    id: "prompt-surface-faces-not-grouped",
    src: "scripts/prompt-surface-check.ts",
    test: "tests/prompt-surface-check.test.ts",
    desc: "取料面从「按文本相同合并」退化成「一档一面」⇒ 「一份文本对几档」这个信号消失，共用文本对缺席档的承诺永远不会报 odd" +
      "（每档各自成面时，缺席那档的面就是它自己的文本，奇偶性被结构抹平）",
    apply: (s) => s.replace(
      "    if (list === undefined) byText.set(text, [m]);\n    else list.push(m);",
      "    byText.set(text, [m]);",
    ),
    expectFail: "四档各属一面，且没有第五面",
  },
  {
    id: "prompt-surface-description-faces-not-swept",
    src: "scripts/prompt-surface-check.ts",
    test: "tests/prompt-surface-check.test.ts",
    desc: "门的取料退回只喂系统文本 ⇒ 68 份工具描述面不再被扫，`propose_plan` 那一格会重新长回来而门照绿；" +
      "判卷里那条「描述不点名别档工具」自己仍然绿，因为它读的是 descriptionFaces() 而不是门实际喂出去的那份（规则 236：接线要单独钉）。" +
      "09-28 第 178 页重指：四族面收成 `faceFamilies()` 一处组成（`main()` 与判卷读同一份），旧针脚那条 `allFaces()` 拼接送不到这儿了",
    apply: (s) => s.replace(
      "desc: descriptionFaces(), ",
      "",
    ),
    expectFail: "门真的把每一族模型可见文本都喂进去",
  },
  {
    id: "prompt-surface-reminder-faces-not-swept",
    src: "scripts/prompt-surface-check.ts",
    test: "tests/prompt-surface-check.test.ts",
    desc: "续跑提醒那一族不再逐证据态渲染（枚举退化成空）⇒ 门只读到静态的那两族（系统文本与工具描述），" +
      "而**逐轮重发的 goal 提醒**回到没人看的状态——09-24 那次「join 文案命令模型去调不存在的工具」正是在这一族里，" +
      "不在系统提示词里（规则 222：取料面空掉时「0 发现」是最像好消息的假绿）",
    apply: (s) => s.replace(
      "for (const evidence of Object.keys(EVIDENCE_TEXT)) {",
      "for (const evidence of []) {",
    ),
    expectFail: "逐证据态各渲两份",
  },
  {
    id: "prompt-surface-param-faces-not-swept",
    src: "scripts/prompt-surface-check.ts",
    test: "tests/prompt-surface-check.test.ts",
    desc: "门的取料不再把参数描述那一族喂进去（现读 189 份，2026-09-28 第 178 页）⇒ 「参数说明里点了本档拿不到的工具」这一格回到没人看的状态；" +
      "同笔那两条真取料判卷仍然绿，因为它们各自直接调 `paramFaces()`，看不见门实际喂出的那份（规则 236 第三次命中这一形状）。" +
      "与 `description-faces-not-swept` 共用同一条 killer 用例——两条守的是同一行组成的不同成员，用例断言的是「四族都在面里」这个整体",
    apply: (s) => s.replace(
      ", param: paramFaces()",
      "",
    ),
    expectFail: "门真的把每一族模型可见文本都喂进去",
  },
  {
    id: "prompt-surface-param-walk-freezes-path",
    src: "scripts/prompt-surface-check.ts",
    test: "tests/prompt-surface-check.test.ts",
    desc: "走树仍然递归、但不再往下带路径（`collectParamDescriptions(value, path, out)`）⇒ 面数一个不少（189 照样 189），" +
      "只有「两层嵌套那 6 份在不在面里」那条判据看得见：嵌套参数说明全被并成同一个名字，递归这一支失去证人。" +
      "选这个方向而不是「删掉递归」是有意的：后者会让取料数为 0 直接抛，任何判卷都红，分辨不出这一族到底被走没被走（规则 226：要给那道闸造只有它看得见的输入）",
    apply: (s) => s.replace(
      "collectParamDescriptions(value, `${path}.${key}`, out);",
      "collectParamDescriptions(value, path, out);",
    ),
    expectFail: "每把工具的参数 prose 都在面里",
  },
  {
    id: "prompt-surface-coverage-denominator-unfiltered",
    src: "scripts/prompt-surface-check.ts",
    test: "tests/prompt-surface-check.test.ts",
    desc: "覆盖率的分母不再滤掉「没有参数的工具」⇒ `verify`／`automation_list` 以 declared=0 进面，" +
      "分母从 18 涨到 20，覆盖率从此替形状报错（一个从来没有参数的工具被读成「有参数没说明」）。" +
      "读数类判据的分母必须与被度量对象同口径，否则「有 2 把没说明」这句话在骗人（规则 245／257①）",
    apply: (s) => s.replace(
      "if (named.length === 0) continue;",
      "if (named.length < 0) continue;",
    ),
    expectFail: "分母只数「有声明参数的工具」",
  },

  // ── 第 185 页：每请求固定**面**（分子补上工具规格）＋ 占比不许夹住 ＋ 系数自检
  {
    id: "prompt-cost-face-drops-specs",
    src: "scripts/lib/prompt-cost.ts",
    test: "tests/prompt-cost.test.ts",
    desc: "固定面退回只数系统提示 ⇒ 标签还说「面」而分子少了九成（default 档规格 10,131 字符 = 提示的 15.1 倍），"+
      "整条成本尺继续把主要成本当不存在",
    apply: (s) => s.replace("const toolSpecChars = JSON.stringify(input.specs).length;", "const toolSpecChars = 0;"),
    expectFail: "面 = 系统提示 + 序列化工具规格",
  },
  {
    id: "prompt-cost-face-pools-modes",
    src: "scripts/lib/prompt-cost.ts",
    test: "tests/prompt-cost.test.ts",
    desc: "逐档面并成一条（只算第一档）⇒ read-only 的 8 把与 default 的 20 把被并成一个数，"+
      "「只读会话便宜多少」这项决策再没有读数（并集读数不能当「每一档都成立」的证人，规则 255）",
    apply: (s) => s.replace("  return inputs.map((i) => fixedFaceOfMode(i));", "  return [fixedFaceOfMode(inputs[0]!)];"),
    expectFail: "逐档分开数",
  },
  {
    id: "prompt-cost-share-clamp-restored",
    src: "scripts/lib/prompt-cost.ts",
    test: "tests/prompt-cost.test.ts",
    desc: "把 `Math.min(1, …)` 夹住装回来 ⇒ 18/19 条流一起报 100%，那片相同的数正是规则 242 说的「常数签名」；"+
      "夹住之后「系数把成本放大一倍」这件事在读数里彻底消失",
    apply: (s) => s.replace("  return fixedTokens / measuredInputTokens;", "  return Math.min(1, fixedTokens / measuredInputTokens);"),
    expectFail: "占比不夹住",
  },
  {
    id: "prompt-cost-admissible-not-tightest",
    src: "scripts/lib/prompt-cost.ts",
    test: "tests/prompt-cost.test.ts",
    desc: "系数自检取第一条流而不是最紧那条 ⇒ 反解出的「下界」偏小，按它摊仍然估超实测输入"+
      "（自检给出假安心，比没有自检更坏）",
    apply: (s) => s.replace("    if (lo === null || need > lo) lo = need;", "    if (lo === null) lo = need;"),
    expectFail: "取最紧那条流反解",
  },
  {
    id: "prompt-cost-overshoot-not-counted",
    src: "scripts/lib/prompt-cost.ts",
    test: "tests/prompt-cost.test.ts",
    desc: "超界计数写死 0 ⇒ note 还在逐行说，但汇总与「这条尺有几行不成立」这一格变成常数，"+
      "读的人不会再去看那一列（三态要分开印，缺项要单列计数，规则 239/242）",
    apply: (s) => s.replace("    overshoot: shares.filter((s) => s > 1).length,", "    overshoot: 0,"),
    expectFail: "超限行带 note 说破原因",
  },

  /* ── 第 272 页：把 `evidence-typecheck-check` 从「单价线外、交笔时人肉跑」买进认证门面。
   *    两支各钉一半：只钉「在不在名单」，那预算随便填个数也绿；只钉预算，那"这道门被删了"就没人喊。 ── */
  {
    id: "certface-evidence-gate-row-dropped",
    src: "scripts/gate-manifest.ts",
    test: "tests/cert-gate-face.test.ts",
    desc: "把这道门从认证门面里摘掉 ⇒ 覆盖退回到「交笔时手动跑」那句承诺上，而这句话已经在第 268/269/270/271 四笔里连续没成立（规则 292 同族：绿认证与门红并存）",
    apply: (s) => s.replace('  { name: "evidence-typecheck-check", budgetMs: 5300 },', "  "),
    expectFail: "交笔必跑的门按类进门面：",
  },
  {
    id: "certface-evidence-gate-budget-under-measured",
    src: "scripts/gate-manifest.ts",
    test: "tests/cert-gate-face.test.ts",
    desc: "名单里这道门的预算被写到实测两倍以下 ⇒ 这一格变成「拿一次读数当上限」，本机负载一动就红；" +
      "这支钉的是买进门面时那条**单价是真测的**，不是给名单随手填个数占位",
    apply: (s) => s.replace('"evidence-typecheck-check", budgetMs: 5300', '"evidence-typecheck-check", budgetMs: 500'),
    expectFail: "交笔必跑的门按类进门面：",
  },

  /* ── 第 272 页：`scripts/prose-needle-scan.ts` 这支尺今天第一次被突变表看见（现读 `grep -c prose-needle-scan` ＝ 0）。
   *    先钉「在飞/已提交」那一分面：它红的时候，全仓的「这一格属隔壁在飞，不算我的账」的归因都跟着失真。 ── */
  {
    id: "prose-scan-inflight-split-swapped",
    src: "scripts/prose-needle-scan.ts",
    test: "tests/prose-needle-scan.test.ts",
    desc: "把「在飞」与「已提交」两半对调 ⇒ 顶包候选的水位帽开始拿别人的在飞文本判我这一笔，" +
      "而「排除在飞」那套归因话术全部反过来指（第 272 页实测：这一支尺此前在变异表里零条目）",
    apply: (s) => s.replace("(inFlight.has(r.file) ? flying : committed)", "(inFlight.has(r.file) ? committed : flying)"),
    expectFail: "干净文件的账算我的，在飞文件的账不算我的——但两边都要在清单上",
  },

  /* ── 第 276 页：同一把尺再补四格（每格都有**自己的** killer 用例，四条 expectFail 各不相同——
   *    第 275 页刚踩过"两支钉同一条用例"被顶包水位帽抓，这次按格分好再写）。 ── */
  {
    id: "prose-scan-bare-name-length-cap-loosened",
    src: "scripts/prose-needle-scan.ts",
    test: "tests/prose-needle-scan.test.ts",
    desc: "裸名字谓词的长度上限从 12 放宽一格 ⇒ 一句人话开始落进这一族；" +
      "上限是这条谓词唯一的软处（判卷把 12/13 两侧各钉了一格），放宽一格在真仓里也许仍不红，但那条边界从此没人守",
    apply: (s) => s.replace("t.length <= 12 &&", "t.length <= 13 &&"),
    expectFail: "一个名字 ⇒ 是；句子里的一个词 ⇒ 不是（两侧）",
  },
  {
    id: "prose-scan-blank-comments-passthrough",
    src: "scripts/prose-needle-scan.ts",
    test: "tests/prose-needle-scan.test.ts",
    desc: "注释涂白退化成原样返回 ⇒ 注释里的旧文案开始冒充生产者（第 118 页那条『注释不是文案』的判据作废），" +
      "而`drift` 会因此少报——少报比崩更坏：它看起来是干净",
    apply: (s) => s.replace("  return lex(text).code;", "  return text;"),
    expectFail: "长度不变、注释内容读不到、真字面量还在",
  },
  {
    id: "prose-scan-raw-copies-not-reported",
    src: "scripts/prose-needle-scan.ts",
    test: "tests/prose-needle-scan.test.ts",
    desc: "`copies` 交了而 `rawCopies` 交 0 ⇒ 影子排除只留下一个变小了的数，" +
      "『因登记表副本而免计』那几格再没人点数（把判据关小还不说，规则 101 的反向一侧）",
    apply: (s) => s.replace("rawCopies: copyCount(chunks, sought),", "rawCopies: 0,"),
    expectFail: "而 rawCopies=2 一并交出",
  },
  {
    id: "prose-scan-via-collapses-to-direct-only",
    src: "scripts/prose-needle-scan.ts",
    test: "tests/prose-needle-scan.test.ts",
    desc: "本地 helper 那一支的 `via` 被并回『字段直取』⇒ 取料写法分布读数说谎" +
      "（第 95 页以前只认直取、其余整族静默绕过，这三格就是为那时留的形）；料还收着，但『怎么收到的』已经错了",
    apply: (s) => s.replace('via = "本地 helper";', 'via = "字段直取";'),
    expectFail: "三族各收一条",
  },

  /* ── 第 277 页：取料面剩下三格里能钉的都钉上，其中一格是先给它补正向证人再钉的。
   *    规矩是第 276 页那条：落笔前先答「哪条用例为它红」——`unresolved` 从前只被断言为 0，
   *    所以它的锚点必须连着新用例一起交，否则钉上去是一支必存活的假锚点。 ── */
  {
    id: "prose-scan-unresolved-counter-dead",
    src: "scripts/prose-needle-scan.ts",
    test: "tests/prose-needle-scan.test.ts",
    desc: "括号回走走不通那一格不再累加 ⇒ `unresolvedMatcher` 永远读 0，" +
      "「这些断言本面看不见」静默消失（从前这条计数器只被断言为 0，两侧都没证人；" +
      "第 277 页先补三侧合成夹具——收料／走不通／认不出族——再钉这一支）",
    apply: (s) => s.replace("unresolved += 1;", "unresolved += 0;"),
    expectFail: "单列进 unresolved（三侧",
  },
  {
    id: "prose-scan-self-excluded-filter-off",
    src: "scripts/prose-needle-scan.ts",
    test: "tests/prose-needle-scan.test.ts",
    desc: "自排除面不再列出自己的夹具 ⇒ 这把尺重新开始量它自己写的字符串（第 95 页那次假绿的原罪），" +
      "而报告上『排除了哪些』那一格变成空——排除动作还在生效，只是没人能核对它排了谁",
    apply: (s) => s.replace(
      "  const selfExcluded = allTests.filter((p) => SELF_EXCLUDED_TESTS.includes(p));",
      "  const selfExcluded = allTests.filter(() => false);",
    ),
    expectFail: "且排除必须列出来",
  },
  {
    id: "prose-scan-shadow-cleared-predicate-loosened",
    src: "scripts/prose-needle-scan.ts",
    test: "tests/prose-needle-scan.test.ts",
    desc: "影子免计那一格的谓词从『真少了一份副本』放宽成『副本数不大于原数』⇒ " +
      "`shadowCleared` 把**什么都没免计**的行也列进来，读者会把这张长名单读成" +
      "『排除面很有用』，而每一行的差额其实是 0（规则 101 那条『关小判据要能说出差额』的反向）",
    apply: (s) => s.replace(
      "  const shadowCleared = rows.filter((r) => r.rawCopies > 1 && r.copies < r.rawCopies);",
      "  const shadowCleared = rows.filter((r) => r.rawCopies >= 1 && r.copies <= r.rawCopies);",
    ),
    expectFail: "verbatim 那几格还留着生产者",
  },

  /* ── 第 278 页：把「在飞年龄分母」从 `scanRepo` 抽成 `splitAged`，抽出来的同一笔就给它两支证人。
   *    从前这一格买不了锚点——真仓里 `inFlightAgeChecked` 与 `inFlightFiles.length` 同值，
   *    改坏了也没有任何用例能红（规则 340 第三格）；合成夹具能造出"有一个读不到 mtime"那一态之后才谈得上。 ── */
  {
    id: "prose-scan-age-missing-silently-dropped",
    src: "scripts/prose-needle-scan.ts",
    test: "tests/prose-needle-scan.test.ts",
    desc: "读不到 mtime 的那一半从『单列点名』退化成『静默丢弃』⇒ 报告里那句" +
      "「另有 N 个盘上不存在」永远读 0，邻居删掉的在飞文件与从没存在过的文件同形" +
      "（分母那一格不动，所以这条必须有自己的证人，不能靠分母那条用例代答）",
    apply: (s) => s.replace(
      "    if (m === null) { missing.push(f); continue; }",
      "    if (m === null) continue;",
    ),
    expectFail: "不许静默丢弃（混合与全读不到两态）",
  },
  {
    id: "prose-scan-age-checked-uses-whole-list",
    src: "scripts/prose-needle-scan.ts",
    test: "tests/prose-needle-scan.test.ts",
    desc: "年龄分母从『有 mtime 的那一半』改成『整个在飞清单』⇒ `在飞分诊：5 / 19` 那种读数会把" +
      "没有 mtime 的文件也算进分母，而 `stale` 是在另一半里挑的——分子分母不同口径，" +
      "比值从此没有意义（第 113 页立的『只作读数』要读得出它是哪一半）",
    apply: (s) => s.replace(
      "  return { stale: agedInFlight(aged, nowMs), checked: aged.length, missing };",
      "  return { stale: agedInFlight(aged, nowMs), checked: files.length, missing };",
    ),
    expectFail: "分母只数有 mtime 的那一半",
  },

  /* ── 第 279 页：D-10（台账里的源码行号引用要追得到东西）刚立，三支各焊一刀。
   *    判据是纯函数＋注入 tracked 集合，所以三侧证人全是合成夹具（真仓那条只当"今天不红"的兜底）。 ── */
  {
    id: "docscheck-source-cite-existence-welded-shut",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "『路径在 HEAD 跟踪清单里就放行』这一支被换成恒真 ⇒ D-10 从此对任何引用都不出声，" +
      "而第 279 页普查到的那 74 条死指针恰好是最需要它说话的东西（门还在跑、还是绿的、什么都看不见）",
    apply: (s) => s.replace("    if (tracked.has(path)) continue;", "    if (path.length >= 0) continue;"),
    expectFail: "各红一条，同一条只算一次",
  },
  {
    id: "docscheck-source-cite-legacy-exempts-everything",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "存量豁免从『这条引用在登记表里』放宽成『登记表非空就豁免』⇒ 只要还留着一条存量，" +
      "新写的死引用就全都被放行（登记面反过来变成万能豁免，这正是第 335 页那条『能消除红的那个动作要自带反向闸』的形状）",
    apply: (s) => s.replace("    if (legacy.includes(cite)) continue;", "    if (legacy.length > 0) continue;"),
    expectFail: "净零交换（销掉一条存量＋新添一条坏引用）要报两条",
  },
  {
    id: "docscheck-source-cite-stale-branch-dead",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "存量『不再命中就报该删』那一支焊死 ⇒ 登记表只增不减、静默烂在这儿，" +
      "而下一个人读到的是『74 条历史引用』这样一张早已不真实的名单",
    apply: (s) => s.replace("    if (!seen.has(k)) {", "    if (false) {"),
    expectFail: "登记不再命中时要点名该删——只印不判",
  },
  {
    id: "evidence-runner-prefix-line-hardcoded",
    src: "scripts/evidence-typecheck-check.ts",
    test: "tests/evidence-typecheck.test.ts",
    desc: "门那一半把取料前缀写死成「没取到」的形状（接线断）⇒ 归因那行还在、但再也没人说清这豁免是按哪个面取的；" +
      "判卷从上游读 tsconfig 的 include 对一遍，断的就是这条",
    apply: (s) => s.replace(
      'fly.prefixes.length === 0 ? "（清单未取到）" : fly.prefixes.join("、")',
      '"（清单未取到）"',
    ),
    expectFail: "前缀与 tsc 的 include 同源",
  },

  /* ── 第 282 页：`ScanReport` 的观测者普查（`outputs/observer-census-282-2026-10-01/census2.log`）读到
   *    `testFiles` 印在报告第一行、判卷里却零次提及——收料面的**分母**没有证人。补的那条用例用另一把原语
   *    （判卷自己 `git ls-files -- tests` 再挑 `.test.ts`）对账。三支锚点各钉一种坏法，并**标明死在哪条等式上**：
   *    前两支掉在"三者之和＝清单全量"，第三支特意构造给第二条等式（自排除数量）当证人——
   *    否则第二条等式就是一格"两侧同真"的恒真断言（第 272 页第 7 项那条）。 ── */
  {
    id: "prose-scan-self-exclusion-filter-dropped",
    src: "scripts/prose-needle-scan.ts",
    test: "tests/prose-needle-scan.test.ts",
    desc: "收料面把「自己的判卷文件」排除掉的那一支过滤器被焊成恒真 ⇒ 本尺开始量自己写进去的字符串" +
      "（第 105 页实测就是这么多算 3 条顶包候选的），而 `selfExcluded` 那一格照旧非空、看着一切正常。" +
      "掉在第一条等式：多收一支自己的判卷文件，三者之和就比独立枚举大 1",
    apply: (s) => s.replace("allTests.filter((p) => !SELF_EXCLUDED_TESTS.includes(p))", "allTests.filter(() => true)"),
    expectFail: "收料＋自排除＋盘上缺失＝清单全量",
  },
  {
    id: "prose-scan-test-face-extension-widened",
    src: "scripts/prose-needle-scan.ts",
    test: "tests/prose-needle-scan.test.ts",
    desc: "tests 面的扩展名从 `.test.ts` 写成 `.ts` ⇒ 4 支夹具/辅助文件混进收料面" +
      "（现读 `git ls-files -- tests` 里非 `.test.ts` 的 `.ts` 有 4 个），报告第一行那句「扫 N 个 test 文件」的 N 当场虚高。" +
      "判卷那侧按**声明的形状**（`.test.ts`）独立枚举，所以这条差值只能由等式抓到——从前它谁也不是",
    apply: (s) => s.replace(
      'const allTests = trackedFiles(["tests"], [".test.ts"], root);',
      'const allTests = trackedFiles(["tests"], [".ts"], root);',
    ),
    expectFail: "收料＋自排除＋盘上缺失＝清单全量",
  },
  {
    id: "prose-scan-self-excluded-list-reported-empty",
    src: "scripts/prose-needle-scan.ts",
    test: "tests/prose-needle-scan.test.ts",
    desc: "`selfExcluded` 那格被交回空数组（**面没变、只是不再点名**了）⇒ 排除面从『读数』退化成『没有』。" +
      "两条等式都会红：第一条因为『少报的那一支其实没进分母』、第二条就是量这个的。" +
      "留这条锚点是为了让第二等式不当恒真证人（第 272 页第 7 项：两侧同真的配对断言买不了锚点）",
    apply: (s) => s.replace(
      "const selfExcluded = allTests.filter((p) => SELF_EXCLUDED_TESTS.includes(p));",
      "const selfExcluded: string[] = [];",
    ),
    expectFail: "自排除名单要数得着",
  },
  {
    id: "evidence-cred-face-mjs-exemption-dropped",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "取料面把 `.mjs`（探针脚本自己）排除掉这一支被写成恒真 ⇒ 探针里那些**为演示而写**的数字给自己作证，" +
      "D-9 的「原文找到了」从此可以是自供（第 268 页那条『子串身份判据会被自己的探针日志冒充』同形）",
    apply: (s) => s.replace('filter((f) => !f.endsWith(".mjs"))', "filter(() => true)"),
    expectFail: "读不到的文件不许被丢掉",
  },
  {
    id: "evidence-cred-face-missing-dir-returns-empty-face",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "目录不存在时交回空数组而不是 null ⇒ 「取不到」被读成「面可取且为空」：门那边那一档从『未检』变成" +
      "『检了且没找到』，凭证页的读数就能在没有任何证人的情况下过关（规则 239 的三态在本面上的复刻）",
    apply: (s) => s.replace("  if (!existsSync(abs)) return null;", "  if (!existsSync(abs)) return [];"),
    expectFail: "交 null（取不到），不是空数组",
  },
  {
    id: "evidence-cred-face-wiring-not-through-shared-constructor",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "CLI 不走共用构造器（这里换成恒 null）⇒ 函数还活着、单测还绿，但**生产端**的 D-9 再也读不到面；" +
      "这正是这一页立它的理由：形状漂了要红在真门跑的那一侧，而不是红在只有判卷看见的地方",
    apply: (s) => s.replace("(dir) => credFaceFiles(ROOT, dir),", "(dir) => (void dir, null),"),
    expectFail: "门那半真的调这个构造器",
  },

  /* ── 第 285 页：D-11「凭证页点名的 dated 证人必须追得到 HEAD」。立它的两起事故写在 `scripts/docs-check.ts`
   *    那条注释里（第 281 页的日志没随页入库 ⇒ 只有 210s 的认证跑抓得到；第 284 页声称留档的第一版日志被同名覆盖
   *    ⇒ D-9 只抽目录、看不见文件名）。五支各钉一个分支：取料面截断、目录那一半、文件那一半、登记位漂了、接线掉。
   *    判卷全吃**合成输入**（第 272 页第 7 项：两侧同真的配对断言买不了锚点），真仓那一条只当存量哨兵。 ── */
  {
    id: "evidence-witness-pattern-ref-read-as-concrete-file",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "把「带 `*?{}` 的是模式、不是路径」那一支焊死 ⇒ 台账里 `outputs/_audit-*.md` 这种写法被当成一个具体文件去追，" +
      "门为一堆根本不存在的证人喊红。⚠️ 同族另一形状（字符集限成 ASCII ⇒ 带中文的真文件名在第一个汉字处被截断，" +
      "第 285 页普查第一版真犯过）由取料面判卷钉着、这条锚点**没买到**：改成派生正则后针脚要写四层转义才贴得住，" +
      "为它拼一条脆弱针脚不如把形状写在页上（规则 341：注释与散文都不许被读成已闭）",
    apply: (s) => s.replace("if (/[*?{}]/u.test(name)) continue;", "if (false) continue;"),
    expectFail: "模式串跳过",
  },
  {
    id: "evidence-witness-dir-ref-always-resolves",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "目录点名（以 `/` 结尾）那一半改成恒追得到 ⇒ 「整个 dated 目录没随页入库」读成绿：这正是第 281 页的形状，" +
      "而文件那一半照旧——只红目录这一支，说明判据的两半得各买一支",
    apply: (s) => s.replace('if (ref.endsWith("/") ? dirs.has(ref) : tracked.has(ref)) continue;', 'if (ref.endsWith("/") ? true : tracked.has(ref)) continue;'),
    expectFail: "整个目录没入库才红",
  },
  {
    id: "evidence-witness-file-ref-always-resolves",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "文件点名那一半改成恒追得到 ⇒ 页点名的证人不存在也不出声，D-11 退化成「只查目录」；" +
      "反向一侧（同一条从清单里去掉要红一条）当场抓住",
    apply: (s) => s.replace('if (ref.endsWith("/") ? dirs.has(ref) : tracked.has(ref)) continue;', 'if (ref.endsWith("/") ? dirs.has(ref) : true) continue;'),
    expectFail: "同一条从清单里去掉就红一条",
  },
  {
    id: "evidence-witness-stale-registry-silent",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "登记位的「不再命中就该删」那一半焊死 ⇒ 登记表只会越积越多、没人知道自己留的是假存量（第 279 页 D-10 同族：只印不判的那一半也要出声）",
    apply: (s) => s.replace("if (!seenRefs.has(k)) {", "if (!seenRefs.has(k) && false) {"),
    expectFail: "不再命中的登记报 stale",
  },
  {
    id: "evidence-witness-unavailable-reads-as-empty-face",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "把「取不到 HEAD 清单 ⇒ 未检」改成「拿空集合当判据」⇒ 三态被抹平：门会喊 73 条红（假红淹真信号），" +
      "而下一次真取不到清单时它又可能被人顺手改成 `?? new Set()` 的反方向——接线形状要有钉子",
    apply: (s) => s.replace("const witness = ledgerTracked === null ? null : checkWitnessPaths(witnessPages, ledgerTracked);", "const witness = checkWitnessPaths(witnessPages, ledgerTracked ?? new Set<string>());"),
    expectFail: "接线：门真的调这条判据",
  },

  /* ── 第 274 页：把 `scripts/prose-needle-scan.ts` 的帽那一族补齐（第 272 页现读：这支 1100 行的尺此前整支零锚点，
   *    本族四支各钉一种坏法：比较符、加法、按树取帽、把出声那一支焊死）。
   *    这四支都能买，正因为它们的判卷喂的是**合成输入**（第 272 页第 7 项写的那条：clean 树上两侧同为 0 的配对断言买不了锚点）。 ── */
  {
    id: "prose-scan-cap-boundary-ge-not-gt",
    src: "scripts/prose-needle-scan.ts",
    test: "tests/prose-needle-scan.test.ts",
    desc: "把「只准调低」的边界从 `>` 写成 `>=` ⇒ 贴帽那一格当天就红，于是下一次有人为了让它绿而把帽往上调——" +
      "这条线本来是「不许涨」，写成「不许等于」就变成「必须留余量」，两者对不上账",
    apply: (s) => s.replace("return { total, over: total > cap };", "return { total, over: total >= cap };"),
    expectFail: "两半相加＝比的那个数；等于帽不算涨",
  },
  {
    id: "prose-scan-cap-total-minus-flight-half",
    src: "scripts/prose-needle-scan.ts",
    test: "tests/prose-needle-scan.test.ts",
    desc: "两半之和写成「已提交减在飞」 ⇒ 总数看着还在，红却不响了：全格子都在飞的那种输入直接归零，" +
      "帽于是只守已经入库的那一半（第 118 页改的就是这个判据位置）",
    apply: (s) => s.replace("const total = committed + flying;", "const total = committed - flying;"),
    expectFail: "在飞那一半必须算账：全格子都在飞文件里",
  },
  {
    id: "prose-scan-ceiling-ignores-tree-scope",
    src: "scripts/prose-needle-scan.ts",
    test: "tests/prose-needle-scan.test.ts",
    desc: "帽不按树取、写死 `core-only` 那行 ⇒ 含桌面层那棵树拿窄帽量宽面，同一批格子在两种树上给出不同判决，" +
      "而报出来的文案还说「树＝含桌面层」（读数说谎比读数缺失更坏）",
    apply: (s) => s.replace("const cap = SCOPE_CEILINGS[r.scope];", 'const cap = SCOPE_CEILINGS["core-only"];'),
    expectFail: "帽内输入两条都交空串（空串＝没有红，不是缺读数）；帽按 scope 取宽窄两行",
  },
  {
    id: "prose-scan-multi-breach-branch-welded-shut",
    src: "scripts/prose-needle-scan.ts",
    test: "tests/prose-needle-scan.test.ts",
    desc: "把顶包那一支的出声条件焊成 `false` ⇒ CLI 永远不报水位上涨，而判卷剩下的全是合成输入，" +
      "真仓里涨到几格都没人喊（「两处帽比较收成唯一决策点」这件事只剩散文）",
    apply: (s) => s.replace("multi: multi.over", "multi: false"),
    expectFail: "在飞那一半超帽必须出声，且文案交出两半各自的数",
  },

  /* ── 第 286 页（任务 #15）：三格「只在安全值那一侧被断言」的读数改成**合成树上的确切等式**。
    *    真仓的干净树里在飞那一面是空的 ⇒ `stale ⊆ files` 恒真、`sourceFiles > 50` 对任何正数都绿、
    *    `proseHeldBack > 0` 对放宽排除面只会更大——把字段焊死成 0 在这棵树上完全无声（规则 340 的第三种形状）。
    *    六支各钉一个站点：字段接线、收料目录、登记表那一半、`desc:` 那一栏、stale 的接线、年龄分母。
    *    判卷喂的是自己造的树（`mkdtemp` ＋ `git init` ＋ `utimesSync` 把一支拨到 3 天前），所以两侧都能出声。 ── */
  {
    id: "prose-scan-source-files-field-welded-zero",
    src: "scripts/prose-needle-scan.ts",
    test: "tests/prose-needle-scan.test.ts",
    desc: "`sourceFiles` 不接 `sources.length` 而焊成 0 —— 这一支真仓那条 `> 50` 也拦得住，所以它不是新力量；" +
      "留着的理由是合成树上那个**确切 3**：面少收一侧（把 `scripts` 那一档摘掉 ⇒ 3 变 1）在真仓里仍是几百条、" +
      "在等式上立刻红。阈值挡大事故，等式挡小漂移（规则 241：写满为止）",
    apply: (s) => s.replace("sourceFiles: sources.length,", "sourceFiles: 0,"),
    expectFail: "恰好 5 支",
  },
  {
    id: "prose-scan-production-face-includes-tests",
    src: "scripts/prose-needle-scan.ts",
    test: "tests/prose-needle-scan.test.ts",
    desc: "生产侧收料目录多收 `tests` ⇒ 「诊断文案 ↔ 断言收料」这把尺开始把测试自己当生产者，" +
      "顶包候选会莫名变多而 `testFiles` 那格照旧——只有合成树上的等式（3 不是 4）能立刻发现",
    apply: (s) => s.replace('const allSources = trackedFiles(["src", "scripts"], [".ts", ".mts", ".mjs"], root);', 'const allSources = trackedFiles(["src", "scripts", "tests"], [".ts", ".mts", ".mjs"], root);'),
    expectFail: "恰好 5 支",
  },
  {
    id: "prose-scan-heldback-not-limited-to-registry",
    src: "scripts/prose-needle-scan.ts",
    test: "tests/prose-needle-scan.test.ts",
    desc: "散文栏的排除面不再只看「登记表」那一半（把用例表也算进去）⇒ `proseHeldBack` 从 60 变 61：" +
      "用例表的字面量是喂给被测函数的输入，不是任何字段的出处（第 98 页把它分成两族的理由就在这个数上）",
    apply: (s) => s.replace('anchorTables.filter((t) => t.kind === "登记表")', "anchorTables.filter(() => true)"),
    expectFail: "恰好 60 条",
  },
  {
    id: "prose-scan-heldback-counts-every-literal",
    src: "scripts/prose-needle-scan.ts",
    test: "tests/prose-needle-scan.test.ts",
    desc: "「只数 `desc:` 那一栏」被放宽成「这张表里所有字面量」⇒ 散文栏读数从 60 涨到几百，" +
      "而它本来要表达的只是『这些被挡在门外的是给人读的』——数量级一漂，第 98 页那条『散文不许替生产文案作证』就再也数不清",
    apply: (s) => s.replace('extractLiterals(s.path, s.text).filter((c) => DOC_PROSE_KEYS.includes(c.key)).length', "extractLiterals(s.path, s.text).length"),
    expectFail: "恰好 60 条",
  },
  {
    id: "prose-scan-stale-list-welded-empty",
    src: "scripts/prose-needle-scan.ts",
    test: "tests/prose-needle-scan.test.ts",
    desc: "`inFlightStale` 不接 `splitAged` 的输出而焊成 `[]` ⇒ 真仓干净树（在飞为空）里那条子集断言恒真、完全无声；" +
      "合成树里 3 天前那一支必须出现在这一格（第 278 页抽了纯函数，这一支钉的是「输出接没接到字段上」）",
    apply: (s) => s.replace("const inFlightStale = age.stale;", "const inFlightStale: string[] = [];"),
    expectFail: "新鲜那支不进，分母恰好 2",
  },
  {
    id: "prose-scan-age-denominator-is-missing-half",
    src: "scripts/prose-needle-scan.ts",
    test: "tests/prose-needle-scan.test.ts",
    desc: "年龄分母从「盘上真有的那一半」改成「盘上没有的那一半」⇒ 打印出来的 `N / M` 里 M 变成 0，" +
      "于是「有 2 支在飞、2 支算得出年龄」被读成「有 2 支在飞、0 支算得出」——分母写错不等于没跑，但会被读成没跑",
    apply: (s) => s.replace("inFlightAgeChecked: age.checked,", "inFlightAgeChecked: age.missing.length,"),
    expectFail: "新鲜那支不进，分母恰好 2",
  },

  /* ── 第 286 页补⑴（任务 #20）：普查剩下的两格——`viaCounts` 与 `across`。这两格没法在合成树上造出非零数
    *    （那要重造整套收料夹具），所以改成钉**守恒**：三档分类之和必须等于收料总条数、直方图那一档必须等于清单长度。
    *    守恒在合成树上是「0 ＝ 0」也照样挡得住"某一档被凭空 ＋1"；非恒真那一半在真仓那格（现读 123＋6＋6＝135）。 ── */
  {
    id: "prose-scan-via-counts-bucket-inflated",
    src: "scripts/prose-needle-scan.ts",
    test: "tests/prose-needle-scan.test.ts",
    desc: "三档归类里有一档被凭空 ＋1（从前这一族真的漂过：本地 helper 与字段别名两族写法整族看不见）⇒ " +
      "分类不再划分整个收料面，而**总条数**没变、阈值断言全都绿；只有「三档之和＝`needles`」这条守恒会响",
    apply: (s) => s.replace('"本地 helper": needles.filter((n) => n.via === "本地 helper").length,', '"本地 helper": needles.filter((n) => n.via === "本地 helper").length + 1,'),
    expectFail: "两本账必须对得上",
  },
  {
    id: "prose-scan-across-list-detached",
    src: "scripts/prose-needle-scan.ts",
    test: "tests/prose-needle-scan.test.ts",
    desc: "`across` 清单不再从 rows 里筛（交回空表）⇒ 直方图那一档仍有数、清单是空的：" +
      "打印「跨插值 N 条」的那句与「它到底是哪几条」从此各说各话（真仓现读 6 条，这条守恒在非零面上才谈得上分辨）",
    apply: (s) => s.replace('across: rows.filter((r) => r.kind === "across-interpolation"),', "across: [],"),
    expectFail: "同一对账在真仓上跑一遍",
  },
  {
    id: "prose-scan-histogram-skips-across-kind",
    src: "scripts/prose-needle-scan.ts",
    test: "tests/prose-needle-scan.test.ts",
    desc: "直方图少记一类（把 `across-interpolation` 从计数里跳过）⇒ 清单还在、汇总数变小，" +
      "于是「五态各几格」的和不再等于分母，而没人会去加一遍。与上一条正好相反方向：那一支拆清单、这一支拆直方图",
    apply: (s) => s.replace("for (const r of rows) counts[r.kind] += 1;", 'for (const r of rows) if (r.kind !== "across-interpolation") counts[r.kind] += 1;'),
    expectFail: "同一对账在真仓上跑一遍",
  },

  /* ── 第 290 页：HEAD 取料面的中文文件名。`git ls-tree --name-only` 默认把非 ASCII 路径转义成带引号的八进制，
   *    于是本仓那 164 条中文证人**一条都不在清单里**——D-10/D-11 把已入库的工件读成追不到（假红 44 条，
   *    连我自己上一笔的普查都是它给的数）。修法只有一个字：`-z`。 ── */
  {
    id: "head-face-ls-tree-without-z-escapes-cjk-paths",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "摘掉 `ls-tree` 的 `-z` ⇒ 非 ASCII 路径全变成带引号的八进制串：中文证人从清单里消失，" +
      "D-11 把「已入库」读成「追不到」（假红），而目录折成的 `dirs` 也因行首那个引号整条落空。" +
      "这条只能靠真机哨兵抓：合成输入里的文件名一律 ASCII，怎么改都是绿的",
    apply: (s) => s.replace('"ls-tree", "-r", "--name-only", "-z", "HEAD"', '"ls-tree", "-r", "--name-only", "HEAD"'),
    expectFail: "哨兵：盘上真有、HEAD 真有 ⇒ 清单里必须真有（这条不可能靠空面变绿）",
  },
  {
    id: "witness-face-narrowed-back-to-credential-pages",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "把 D-11 的取值域从整本台账退回凭证页 ⇒ 判卷自己那两条（整本 2 条红／凭证面 1 条红）与门里那条分母等式当场红；" +
      "普通页点名的证人从此又没人守——这正是第 289 页宽分面那 15 条老账的来源",
    apply: (s) => s.replace("witnessPages = ledgerPages(ledgerText, ANY_PAGE_HEAD);", "witnessPages = credentialPages(ledgerText);"),
    expectFail: "接线：门真的调这条判据",
  },

  /* ── 第 273 页：把「实测 <1.5s 全进」这条线接成判据（取料＝入库的那趟全表日志）。两支各钉一半。 ── */
  {
    id: "certface-webfetch-gate-row-dropped",
    src: "scripts/gate-manifest.ts",
    test: "tests/cert-gate-face.test.ts",
    desc: "把这道按线买进来的门摘掉 ⇒ 「线内的全进」又变回只对熟门生效的散文，" +
      "而它当初被挡在外面的理由（本轮没量过）已经被那趟跑掉了",
    apply: (s) => s.replace('  { name: "web-fetch-check", budgetMs: 1200 },', "  "),
    expectFail: "实测在这条线内的门不许留在认证门面外",
  },
  {
    id: "certface-webfetch-budget-under-measured",
    src: "scripts/gate-manifest.ts",
    test: "tests/cert-gate-face.test.ts",
    desc: "这道门的预算被写到实测以下（568ms → 400ms）⇒ 认证门面开始拿一次读数当上限，" +
      "本机负载一动就冒出「超预算」的假红；这支钉的是买进门面时那个数是**真测的**、预算按两倍档留",
    apply: (s) => s.replace('"web-fetch-check", budgetMs: 1200', '"web-fetch-check", budgetMs: 400'),
    expectFail: "实测在这条线内的门不许留在认证门面外",
  },

  /* ── 第 227 页（#32）：D-5 的台账 sha 面。四支各钉一种坏法：不查可达、形状修法没接、0 条读成绿、豁免不报 stale。 ── */
  {
    id: "docscheck-ledger-reachability-not-checked",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "可达那一格不查 ⇒ 台账里每一条真 sha 都被报成悬空（红海），而红海的下一站就是「把这条门关掉」。" +
      "这条面存在的意义正是「几百条引用第一次有证人」，它自己必须先不误伤",
    apply: (s) => s.replace("    if (map.get(t.sha) === true) continue;\n", ""),
    expectFail: "可达不报；不可达且没有豁免 ⇒ 红，且 detail 带行号与 sha",
  },
  {
    id: "docscheck-ledger-equals-prefix-shape-dropped",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "`=` 前缀那一格撤掉 ⇒ `--budget-ms=2400000` 这类数字又回到候选里。修法选**形状**而不是往豁免里塞一条：" +
      "豁免名单是「别的种类的对象」，数字不是（把误伤登记进豁免＝下一位读者以为真有假 sha）",
    apply: (s) => s.replace("|[^0-9a-zA-Z=])", "|[^0-9a-zA-Z])"),
    expectFail: "形状修法：跟在 `=` 后面的数字不算候选",
  },
  {
    id: "docscheck-ledger-empty-face-reads-as-green",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "抽到 0 条候选被读成「这一格没问题」⇒ 正则一坏、台账一改名，整条门就静默消失" +
      "（规则 261：尺的「读不到」与「没有问题」不许同形）",
    apply: (s) => s.replace("  if (toks.length === 0) {", "  if (toks.length < 0) {"),
    expectFail: "抽到 0 条候选同样记未检",
  },
  {
    id: "docscheck-ledger-waiver-stale-unreported",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "不再命中的豁免不报 ⇒ 名单会烂在这儿，而下一位读者拿它当「这里曾有假 sha」的证据。" +
      "与 LEGACY_WAIVERS 同规矩：豁免**只准调低**，不再命中就该被点名（规则 235）",
    apply: (s) => s.replace("    if (!found.has(sha)) out.push(", "    if (false) out.push("),
    expectFail: "豁免只挡名单里那三个",
  },

  /* ── 第 228 页（#46）：D-9 凭证页 ↔ 取料面对账。三支各钉一种坏法：数位边界退化成 includes、未检那档被当成"没有豁免要用"、
      「找到」那个判据反过来。 ── */
  {
    id: "docscheck-cred-number-boundary-degrades-to-includes",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "数位边界退化成 `includes` ⇒ 「241」在「2410」里也算找到：本笔第一版就踩了这一格，" +
      "三条本该登记为不可回查的读数被判成「已入库」，于是豁免反被报成 stale——**假红指错了方向**。" +
      "第 266 页把回查端换成语境式集合后，这条针脚跟着实现改指到「判定那一行」（旧写法整段已不在盘上＝阻断，规则 229）；" +
      "危害形状不变，而且现在它还替「散文顶住读数」那一半作证。",
    apply: (s) => s.replace("      const sourced = found.has(num);", "      const sourced = face.includes(num);"),
    expectFail: "数位边界：面里只有 2410 时",
  },
  {
    id: "docscheck-cred-face-keeps-ansi-escape-codes",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "取料面不剥 ANSI ⇒ 真机汇总行（转义序列正夹在关键词与数字之间）被判成悬空：这是假红海，" +
      "而它上一次以相反方向出现过——同一份输出在 TERM=dumb 下绿、在裸跑下红（lib/vitest-summary 的头注释就是证人）",
    apply: (s) => s.replace("  const clean = stripAnsi(face);", "  const clean = face;"),
    expectFail: "回查端与抽取端同一把谓词：带 ANSI 的真汇总行要算找到，散文里出现同一个数不算",
  },
  {
    id: "docscheck-cred-context-reads-whole-match-not-capture",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "把集合里存的东西从捕获组换成整条匹配 ⇒ 面里存的是「Test Files 253 passed」这种整句，" +
      "读数 253 永远不在集合里：这一格从此只会在每条真原文上报红（红海的下一次反应是关掉它）",
    apply: (s) => s.replace("out.add(m[1]!);", "out.add(m[0]);"),
    expectFail: "点了名且数在面里 ⇒ 可比对计数涨、零红",
  },
  {
    id: "docscheck-cred-predicate-computed-but-not-attached",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "谓词算出来了却不接进判定（喂一个空集合）⇒ 每条点名的读数都悬空、每一页都红，" +
      "而『零红』那一半的证人必须在这儿翻过来——只印不接的尺在本仓已咬过两次（规则 230/246）。" +
      "第 269 页把这句从整块文本换成按文件并集，针脚跟着实现走（规则 229），判定语义没变",
    apply: (s) => s.replace("    const found = new Set<string>(perFile.flatMap((f) => [...f.nums]));", "    const found = new Set<string>();"),
    expectFail: "点了名且数在面里 ⇒ 可比对计数涨、零红",
  },

  /* ── 第 269 页：D-9 的回查端从前只问「数在不在面上」，不问「是谁替它作的证」。
     现读把这条差别量出来了：179 个可比对读数里 8 对的证人属于**别的一趟**（第 255 页声称认证 `10bf910`，
     可它点名的目录里唯一的日志印的是 `目标提交：3b3d001`）。六支各钉一种坏法：
     身份比对被恒真／第三态并进弱证／帽比较 off-by-one／身份表少一种形状／页侧 sha 不接／那列被印成常数。 ── */
  {
    id: "docscheck-cred-weak-identity-comparison-cleared",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "把「证人那一趟属不属于本页」的比对换成恒不成立 ⇒ 再也没有弱证，" +
      "别趟的日志只要数值撞对就能替本页作证（这一格从此永远绿，而它防的就是第 255 页那种错指）。" +
      "第 270 页这条判断被提到分支最前面（强证先放行），针脚跟着走（规则 229）",
    apply: (s) => s.replace("        if (identified.some((f) => f.runs.some((r) => p.shas.includes(r)))) {", "        if (false) {"),
    expectFail: "弱证三态：证人身份与本页对上＝强证；对不上＝弱证并点名文件与那一趟；证人没有身份行＝第三态",
  },
  {
    id: "docscheck-cred-weak-no-identity-folded-into-weak",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "把第三态那个条件的 `||` 换成 `&&` ⇒ 「既有别趟原文、又有没印身份的原文」这种混合面从『无从判』掉进弱证，" +
      "帽被非缺陷灌满、真错指反而被淹没（第 270 页现读：8 对里有 3 对是混合面）。" +
      "第 269 页那支钉的是 `weakUnjudged++` 那一行，本行形状变了 ⇒ 针脚跟着走（规则 229）",
    apply: (s) => s.replace("        } else if (identified.length === 0 || witnesses.length > identified.length) {", "        } else if (identified.length === 0 && witnesses.length > identified.length) {"),
    expectFail: "弱证不许过度主张：面上既有别趟的原文、也有没印身份行的原文 ⇒ 这一格算『无从判』",
  },
  {
    id: "docscheck-cred-weak-cap-raised-silently",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "把弱证帽从现调解大（0 → 1）而不新点名任何一条跨趟引用 ⇒ 可比对那一半照旧绿，" +
      "而这把尺从此允许下一页再塞一条" +
      "「数对上了、证人不是那一趟」。降帽必须同时动这条锚点（规则 229：这一格刻意不允许悄悄动）",
    apply: (s) => s.replace("export const CRED_WEAK_WITNESS_CAP = 0;", "export const CRED_WEAK_WITNESS_CAP = 1;"),
    expectFail: "真仓：未点名页数跟着现读走——涨了要红，凭空把帽调低也要红（只有真把页点名了才允许降）",
  },

  /* ── 第 271 页：D-9 的「未点名」那一档拆成两态——可行动（没点名也没登记，受帽管）与已登记（工件当年没入库，逐页带理由）。
     混着一个数写了几十笔，代价是"未检"永远降不到 0：谁都不知道剩下的到底是能补的还是补不了的。
     五支各钉一种坏法：登记没把页挪走／stale 两半之一不查／理由长度不执法／返回体丢格子／那列印成常数。 ── */
  {
    id: "docscheck-cred-page-registration-not-splitting",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "登记表读到了却不分叉（恒走『可行动』那一支）⇒ 9 页登记永远算在未点名帽上，这一格清零之后再也降不回来，" +
      "而下一位只会去把帽调大",
    apply: (s) => s.replace("      if (p.key in pageWaivers) {", "      if (false) {"),
    expectFail: "未点名要拆两态：登记过的页离开『可行动』，没登记的才受帽管",
  },
  {
    id: "docscheck-cred-page-stale-named-not-checked",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "登记页后来自己点名了目录，这条 stale 不查 ⇒ 登记表只进不出，日后变成第二本没人对的旧账（规则 302 双向钉）。" +
      "第 275 页跟着实现改了指针：那一行从 `namedKeys.has(key)` 换成两个计数的等式（同号两页时 Set 会替另一页说话）",
    apply: (s) => s.replace("    if (total > 0 && named === total) {", "    if (false) {"),
    expectFail: "页级登记的两半 stale 都要出声：这页真点名了目录、或整段没了；理由太短也算没登记",
  },
  /* ── 第 275 页：读数面长出「门自己印的那一行」两式，页 key 的 stale 换成按页计数。三支各钉一种坏法。 ── */
  {
    id: "docscheck-cred-face-drops-the-two-new-patterns",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "把新纳的两式之一摘掉 ⇒ 我在凭证里写「可比对 214 → 222 个读数」这类**推出来的分母**又没人查了" +
      "（本笔的动因就是我自己两天里三次把这行的数写成推的：111／222／116，现读 110／221／114）",
    apply: (s) => s.replace("  /可比对 (\\d+) 个读数/u,\n", ""),
    expectFail: "新增那两式要真有分辨力：页里的『可比对 N 个读数』在点名的面上找不到原文就红",
  },
  {
    id: "docscheck-cred-collision-stale-uses-any-named",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "把 stale 条件写成『该 key 下任意一页点了名』⇒ 同号两页时，真凭证页一点名就把落地页那条登记判死，" +
      "而那页压根没点名任何目录——这条登记被删之后，那一页就直接落进受帽管的『未点名页』",
    apply: (s) => s.replace("named === total", "named > 0"),
    expectFail: "同一 key 有两页时，登记只在『每一页都点了名』时才算过期",
  },
  {
    id: "docscheck-cred-page-reason-length-not-enforced",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "理由长度不执法 ⇒ 『逐页带理由』退化成『逐页写个词』，登记就能拿来躲红而不是承认失检",
    apply: (s) => s.replace("    if (reason.trim().length < CRED_PAGE_WAIVER_MIN_REASON_CHARS) {", "    if (false) {"),
    expectFail: "页级登记的两半 stale 都要出声：这页真点名了目录、或整段没了；理由太短也算没登记",
  },
  {
    id: "docscheck-cred-registered-not-returned",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "算出来了却不返回（给空数组与 0）⇒ 门那一步印不到这一格，两态重新混成一个数",
    apply: (s) => s.replace("registeredPages: [...registeredPageKeys], registeredReadings,", "registeredPages: [], registeredReadings: 0,"),
    expectFail: "未点名要拆两态：登记过的页离开『可行动』，没登记的才受帽管",
  },
  {
    id: "docscheck-cred-registered-print-pinned-to-zero",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "汇总行把『已登记不可回查』那列印成常数 0 ⇒ 判定还在跑、登记表烂掉也没人看见（给人看的那一行也要有证人，规则 206/253）",
    apply: (s) => s.replace("｜已登记不可回查 ${String(cred.registeredPages.length)} 页／", "｜已登记不可回查 ${String(0)} 页／"),
    expectFail: "接线：主段把「未点名页」连同帽一起印出来，且判定真拿帽去比（只算不印＝这格永远没人看）",
  },
  {
    id: "docscheck-cred-weak-cap-comparison-offbyone",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "弱证帽的比较从「超出」改成「达到」⇒ 现读那一格永远红，下一位只会去把帽调大或把门关掉",
    apply: (s) => s.replace("  if (weak.length > weakCap) {", "  if (weak.length >= weakCap) {"),
    expectFail: "弱证帽只在超出时出声，且 detail 点名是哪一页、哪个数、哪份证人",
  },
  {
    id: "docscheck-cred-run-sha-tree-form-not-registered",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "身份表里删掉 `已核：TREE=` 那一行 ⇒ 只有汇总行没有「目标提交」的工件一律被读成「没有身份行」，" +
      "弱证那一档当场退化成 0，而这正是第 255 页那类日志的形状",
    apply: (s) => s.replace("  /已核：TREE=([0-9a-f]{7,40})/u,\n", ""),
    expectFail: "身份只认门自己印的两行结构化形状（带 ANSI 也要认）；散文里提到 sha 不算身份",
  },
  {
    id: "docscheck-cred-page-shas-derived-but-not-attached",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "页侧提交号抽出来却不挂进返回的页对象（给空数组）⇒ 每一页的证人身份都「对不上」，" +
      "强证那一半永远没有证人，帽会被自己的存量顶穿（派生完不接线＝第二个注入面，规则 330）",
    apply: (s) => s.replace("    const shas = [...new Set([...body.matchAll(/\\b([0-9a-f]{7,40})\\b/gu)].map((m) => m[1]!.slice(0, 7)))].sort();", "    const shas: string[] = [];"),
    expectFail: "页侧提交号从段体抽：本笔那个要进集合，日期与短 token 不算",
  },
  {
    id: "docscheck-cred-weak-print-pinned-to-zero",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "汇总行把弱证那列印成常数 0 ⇒ 判定还在跑、门照退红，但人读到的那一格永远是「没事」" +
      "（本仓老事故：汇总行不等于退出码，给人看的那一行也要有证人，规则 206/253）",
    apply: (s) => s.replace("｜弱证 ${String(cred.weak.length)} 对（帽", "｜弱证 ${String(0)} 对（帽"),
    expectFail: "接线：主段把「未点名页」连同帽一起印出来，且判定真拿帽去比（只算不印＝这格永远没人看）",
  },
  {
    id: "docscheck-cred-wallclock-form-not-registered",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "新形状没登记进抽取表 ⇒ 门自己报的那一格永远进不了「可比对」，凭证里那句墙钟还是手抄的（第 266 页那支严格式同族）",
    apply: (s) => s.replace("  /本趟墙钟 ([0-9]+(?:\\.[0-9]+)?)s/u,\n", ""),
    expectFail: "严格式认「本趟墙钟」那一档：门自己报的那一格要能进对账面，散文里说墙钟不算（第 267 页）",
  },
  {
    id: "docscheck-cred-unnamed-face-forgets-waivers",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "未点名那一档跳过页却不忘记豁免 ⇒ 迁移前的老页同时落进「未检」与「豁免已不再命中」，" +
      "两句话互相打脸：一边说「这格没看」，一边说「你登记的东西没用了」（规则 239/261）。" +
      "第 271 页那一支从行内长成了带两态分叉的块，`unverifiable()` 单独成行 ⇒ 针脚跟着走（规则 229）",
    apply: (s) => s.replace("      unverifiable();", "      void 0;"),
    expectFail: "页没点名目录＝未检",
  },
  {
    id: "docscheck-cred-found-check-inverted",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "把「在取料面里找到」那个判据反过来 ⇒ 有原文的读数全被报成悬空、没原文的全放过：这条门从此只会喊狼，" +
      "而红海的下一次反应是把它关掉。所以正相那一半（对得上＝零红）必须有独立用例钉。" +
      "第 269 页那句从 `if (sourced) continue;` 长成了带弱证分类的块，针脚跟着实现走（规则 229）",
    apply: (s) => s.replace("      if (sourced) {", "      if (!sourced) {"),
    expectFail: "点了名且数在面里 ⇒ 可比对计数涨、零红",
  },

  /* ── 第 265 页（D-9 第四档）：凭证页「未点名取料目录」按页记名＋帽；以及严格式认 vitest 的列对齐形状。
      这一族要防的事故是**凭证页自己没被核过而门照印红 0**：本会话三笔凭证（262/263/264）各带 8/6/6 条读数、
      落笔只写了裸文件名（`judges-264.log`）⇒ 一整页落在「未检」那一档，页里却引用了「可比对…（红 0）」。
      另一支防的是抽取端的空格形状：vitest 汇总行按列对齐印两个空格，从前正则写死一个 ⇒ 真读数一条抽不到。
      `cred: ReturnType<typeof checkCredentialSources>` 那一格**没有锚点**：它是类型面的账，
      锚点吃不到字节（本笔实现就是这么被 tsc 抓的——vitest 全绿、tsc 报 `unnamedPages` 不存在），观测者＝typecheck 门。 ── */
  {
    id: "docscheck-cred-unnamed-pages-not-collected",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "未点名那一档只累加条数、不记页名 ⇒ 「哪几页没点名」永远查不出来，帽也无从比（本笔之前正是这个形状：三页凭证安静地整页失检）",
    apply: (s) => s.replace("unnamedPageKeys.add(p.key);", "if (false) unnamedPageKeys.add(p.key);"),
    expectFail: "未点名要按页记名：同一页的两个段合成一页，点名的页不许混进这一档",
  },
  {
    id: "docscheck-cred-unnamed-cap-comparison-offbyone",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "把「超出帽」写成「达到帽」⇒ 登记那一格当场红，帽再也无法等于现读；于是唯一的反应是把它调大，棘轮反过来涨",
    apply: (s) => s.replace("if (unnamedPageKeys.size > cap) {", "if (unnamedPageKeys.size >= cap) {"),
    expectFail: "帽只在超出那一格出声：等于现读不红、多一页就红，且 detail 点名是哪一页",
  },
  {
    id: "docscheck-cred-unnamed-cap-raised-silently",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "把帽从现读调大（0 → 1）而不点名任何一页 ⇒ 读数与帽脱钩，这一格从此可以无限装新失检的凭证页。" +
      "历次降帽这条针脚都同笔跟着走：第 268 页 11 → 9（两页真点名）、第 271 页 9 → 0（九页逐页登记）——" +
      "这一格刻意不允许悄悄动，降帽必须同时改这条锚点（规则 229）。",
    apply: (s) => s.replace("export const CRED_UNNAMED_PAGE_CAP = 0;", "export const CRED_UNNAMED_PAGE_CAP = 1;"),
    expectFail: "真仓：未点名页数跟着现读走——涨了要红，凭空把帽调低也要红（只有真把页点名了才允许降）",
  },
  {
    id: "docscheck-cred-strict-space-pinned-to-one",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "严格式把 Test Files 后面的空格写死成一个 ⇒ vitest 真机印的两个空格抽不到数，读数只能靠回查端的裸数位边界偶然兜住（本笔现读：4 条）",
    apply: (s) => s.replace("/Test Files\\s+(\\d+) passed/u,", "/Test Files (\\d+) passed/u,"),
    expectFail: "严格式要认 vitest 的列对齐形状：两个空格与一个空格的汇总行都得抽到数",
  },
  {
    id: "docscheck-cred-return-drops-unnamed-pages",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "算出来了却不返回（从返回体里丢掉这一格）⇒ 门那一步拿到 undefined，按页那一档当场消失，条数那一档照印不误。" +
      "第 269 页返回体长出 weak／weakUnjudged、第 271 页又长出 registeredPages／registeredReadings，" +
      "针脚跟着换行（规则 229）；丢 unnamedPages 这一半的坏法不变",
    apply: (s) => s.replace("return { findings: out, checked, unmatched, unnamed, unnamedPages: [...unnamedPageKeys], registeredPages: [...registeredPageKeys], registeredReadings, weak, weakUnjudged };", "return { findings: out, checked, unmatched, unnamed, registeredPages: [...registeredPageKeys], registeredReadings, weak, weakUnjudged };"),
    expectFail: "未点名要按页记名：同一页的两个段合成一页，点名的页不许混进这一档",
  },
  {
    id: "docscheck-cred-print-drops-cap-column",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "汇总行只印页数、不印帽（或整列不印）⇒ 读数没有对照物，「11 页」到底是存量还是新账没人看得出来（规则 262/291）",
    apply: (s) => s.replace("页（帽 ${String(CRED_UNNAMED_PAGE_CAP)}，只准调低）", "页"),
    expectFail: "接线：主段把「未点名页」连同帽一起印出来，且判定真拿帽去比（只算不印＝这格永远没人看）",
  },
  {
    id: "evidence-runner-missing-config-exits-zero",
    src: "scripts/evidence-typecheck-check.ts",
    test: "tests/evidence-typecheck.test.ts",
    desc: "取不到 `tsconfig.evidence.json` 时退 0 ⇒ 这一格压根没跑被 CI 读成「跑了且干净」；" +
      "而门自己的取料口径如果只存在于 /tmp 的一条命令里，仓内就没有任何证人能发现它没了。" +
      "这一支与上面那支的坏法不同：上面是判定算错，这里是**尺没上架**",
    apply: (s) => s.replace("process.exit(1);", "process.exit(0);"),
    expectFail: "口径文件取不到 ⇒ 出声且非零，不许读成干净",
  },
  {
    id: "evidence-runner-unknown-flag-passed-through",
    src: "scripts/evidence-typecheck-check.ts",
    test: "tests/evidence-typecheck.test.ts",
    desc: "认不出的开关被放行 ⇒ 拿默认口径去量另一件事（本仓 `--budget-ms=` 那一族拒收的同款理由：给了参数却当成没给）。" +
      "门不收参数是**当前**事实，写成拒收是为了将来加参数时不会静默降级；这一支翻红时说明拒收面漏了",
    apply: (s) => s.replace("if (extra.length > 0) {", "if (extra.length > 1) {"),
    expectFail: "拼错的开关 ⇒ 退 2 并点名，不许当成「没给参数」拿默认口径跑",
  },
  {
    id: "map-ruler-exit-not-wired",
    src: "scripts/probe-locate-recall.ts",
    test: "tests/locate-recall-ruler.test.ts",
    desc: "自检算出来了却不接退出码 ⇒ CI 与人都看不见这条红，"
      + "下一次能力复测又会把不可引用的读数写进报告（正是本簇立案时的现行状态）",
    apply: (s) => s.replace("if (!selfCheck.ok) process.exit(1);", "void selfCheck;"),
    expectFail: "尺吃 lib 里那一份判据，且自检不过就退非零",
  },
  {
    id: "map-ruler-only-last-budget",
    src: "scripts/probe-locate-recall.ts",
    test: "tests/locate-recall-ruler.test.ts",
    desc: "命中记录只留最后一档 ⇒ 负控只要在中间某档命中过就采不到（自检对最坏的那种松手视而不见），" +
      "而「任一档命中过」这条口径悄悄变成了「最大档命中过」",
    apply: (s) => s.replace(
      "if (rA > 0 || rC > 0 || rB > 0) hitAnyBudget.set(q.id, true);",
      "if (bi === BUDGETS.length - 1 && (rA > 0 || rC > 0 || rB > 0)) hitAnyBudget.set(q.id, true);",
    ),
    expectFail: "每题的命中记录喂的是 hitAnyBudget，不是某单一档",
  },
  {
    id: "context-signals-probe-mirror-returns",
    src: "scripts/probe-locate-recall.ts",
    test: "tests/context-signals.test.ts",
    desc: "尺那一侧把标识符正则改回自带字面量并把长度档挪一格（{3,}→{4,}）⇒ 镜像复活，" +
      "命中率量的是「尺愿意认的那些词」而不是产品递给地图的那些词",
    apply: (s) => s.replace(
      "const MENTIONED_RE = makeMentionedRe();",
      "const MENTIONED_RE = /[A-Za-z_][A-Za-z0-9_]{4,}/g;",
    ),
    expectFail: "尺那半：从 context-signals 取，且不再自带标识符字面量",
  },
  /* 第 309 页后半簇：那句提示被 `probe-promise-recall` 的措辞网收成一个**面**（字面里含「取回」），
     于是本仓既有的那条纪律把我拦下了——「新加一面必须给判定归属」。这一组钉的是我怎么还这笔账，
     以及我还账时顺手补上的那个洞：登记名打错以前会拿到别人的结论（顶包）。 */
  {
    id: "promise-web-face-left-unregistered",
    src: "scripts/probe-promise-recall.ts",
    test: "tests/promise-recall-inventory.test.ts",
    desc: "撤掉这一面的登记 ⇒ 清单完整性判据必须红（它红才是尺在工作）。" +
      "反过来说明我这次不是「绕过登记表改文案」，而是按它的规矩把判定挂上",
    apply: (s) => s.replace(
      '  "src/tools/output-ring.ts#WEB_CONTENT_TRUNCATION_HINT": "hopWebAnchorClaim",\n',
      "",
    ),
    expectFail: "每一处模型可见的承诺面都有判定归属（新加一句『全文见 X』而不登记 ⇒ 这条先红）",
  },
  {
    id: "promise-runner-name-typo-gets-anothers-verdict",
    src: "scripts/probe-promise-recall.ts",
    test: "tests/promise-recall-inventory.test.ts",
    desc: "把名字核对短路成「永远认识」 ⇒ 未知判定名会 exec 到 ternary 的最后一支，" +
      "于是**别人的**结论被贴到这一面上：登记表看着齐全，那一格其实一次都没判过" +
      "（规则 366 那一族：指针失效比缺指针难发现，这次是顶包）",
    apply: (s) => s.replace(
      "  return RUNNER_NAMES.includes(name);",
      "  return true;",
    ),
    expectFail: "未知判定名不 exec、直接红在这一格（不许拿别的 hop 的结果顶替）",
  },
  /* 第 310 页：把「附件=0 条」这一格拆成三栏分母（调用点形状／只给目录／目录在工作区内）。
     这一组钉的是拆法本身还活着：分类函数一旦 fail-open、第三栏一旦丢掉 workspace、
     报告一旦藏掉一栏、或者那一面一旦没人登记——读数都会变得**比现状好看**。 */
  {
    id: "prune-stub-classifier-fails-open",
    src: "scripts/probe-promise-recall.ts",
    test: "tests/prune.test.ts",
    desc: "把「认不出的措辞」默认判成「带可取路径」 ⇒ 通道从宽报告：一句没登记过的第四种说法会被当成有路，"
      + "而那一格真正的缺陷（没给地址）就此藏住。默认值必须是最低那一档（宁可低报通道）",
    apply: (s) => s.replace('  return "裸占位";', '  return "带可取路径";'),
    expectFail: "三类各占一字且互不相同；认不出的串 fail-closed 落到『裸占位』",
  },
  {
    id: "prune-stub-third-column-drops-workspace",
    src: "scripts/probe-promise-recall.ts",
    test: "tests/prune.test.ts",
    desc: "第三栏丢掉 `workspace` ⇒ 它退化成第二栏的副本，于是「还缺工作区」那一半结论再没人看得见："
      + "三栏看着齐、其实只有两栏，页上那条「修法有两件事」会被读成一件",
    apply: (s) => s.replace(
      'events, attachmentsDir: join(ROOT, ".dsh-hop-attachments"), sessionId: "s1", workspace: ROOT,',
      'events, attachmentsDir: join(ROOT, ".dsh-hop-attachments"), sessionId: "s1",',
    ),
    expectFail: "反向对照：只补 attachmentsDir 仍拿不到可取路径 ⇒ 那句承诺的修法确有两件事",
  },
  {
    id: "prune-stub-report-hides-a-column",
    src: "scripts/probe-promise-recall.ts",
    test: "tests/prune.test.ts",
    desc: "从报告里抽掉一栏 ⇒ 判卷吃结构所以照旧绿，而**人读的那句读数**少了一栏却不多说话。"
      + "这条钉的是「报告与结构同源」：印出去的栏数必须等于量出来的栏数",
    apply: (s) => s.replace(
      '`｜${inWorkspace.label}附件=${String(inWorkspace.wrote)} 条、占位=${inWorkspace.kind}`',
      '""',
    ),
    expectFail: "报告要把三栏都印出来（藏一栏＝读数看着更干净，其实那一格没量）",
  },
  {
    id: "prune-stub-face-left-unregistered",
    src: "scripts/probe-promise-recall.ts",
    test: "tests/promise-recall-inventory.test.ts",
    desc: "撤掉 `agent-runner.ts#body` 这一面的登记 ⇒ 清单完整性判据必须红。"
      + "落这条前先量过前置（`outputs/prune-stub-kinds-2026-10-03/audience-check.mts`）："
      + "那一面受众=model、撤登记后 unjudged 由 0 变 1 ⇒ 针脚命中之外**确有判卷跟着红**（否则就是空操作锚点）",
    apply: (s) => s.replace('  "src/main/agent-runner.ts#body": "hopMapDemo",\n', ""),
    expectFail: "每一处模型可见的承诺面都有判定归属（新加一句『全文见 X』而不登记 ⇒ 这条先红）",
  },
  /* 第 311 页那一簇：模型可见的**能力断言**有没有证人（`scanClaimSites` / `claimWitnessRuns` /
     `claimWitnessCeiling` / 共用 walker 的整句收料 / 受众判定的终端写入那一支）。
     这五枚各自红在不同用例上——其中 A、E 两枚钉的是**本笔自己踩过的两个坑**：
     受众只看最近一层调用（usage 文案被判成模型可见）、整句收下后片段重复计数（分母从 10 涨到 13）。 */
  {
    id: "claim-audience-nearest-call-only",
    src: "scripts/probe-promise-recall.ts",
    test: "tests/promise-recall-inventory.test.ts",
    desc: "把受众判定退回「只看最近那一层调用」⇒ `process.stdout.write(paint(YELLOW, 「…」))` 里最近的一层是 "
      + "`paint(…)`，终端文案被判成模型可见：给人看的一句话开始欠「照那句做一遍」的判定（断言越界）。"
      + "针脚钉整条 parent 链那一步，不钉函数名",
    apply: (s) => s.replace(
      '    if (isTerminalSinkCall(cur)) return "operator";',
      '    if (ts.isCallExpression(cur)) return isTerminalSinkCall(cur) ? "operator" : "model";',
    ),
    expectFail: "受众判定沿整条 parent 链认终端写入——`paint(…)` 包一层也是给运维看的",
  },
  {
    id: "claim-witness-run-threshold-collapsed",
    src: "scripts/probe-promise-recall.ts",
    test: "tests/promise-recall-inventory.test.ts",
    desc: "证人候选段的门槛从 6 字挪到 2 字 ⇒ 「不会」「只能」这类碎片在任何测试里都能撞上，"
      + "欠证人的那格被虚假填平（分母从 29 掉向 0，而这条尺一次都没更严）",
    apply: (s) => s.replace(
      "export function claimWitnessRuns(text: string, min = 6): string[] {",
      "export function claimWitnessRuns(text: string, min = 2): string[] {",
    ),
    expectFail: "证人候选段：插值挖掉、按非中文断开、6 字门槛、去重",
  },
  {
    id: "claim-cap-stale-branch-dropped",
    src: "scripts/probe-promise-recall.ts",
    test: "tests/promise-recall-inventory.test.ts",
    desc: "只留「超帽红」这一半 ⇒ 现读低于帽（有人补了证人却没把帽调下来）不再出声，"
      + "登记表自己烂在这儿。帽的两半要各配一条用例（规则 227/248：收紧与放宽各有一支哨兵）",
    apply: (s) => s.replace(
      "  return { over: read > cap, stale: read < cap, read, cap, margin: cap - read };",
      "  return { over: read > cap, stale: false, read, cap, margin: cap - read };",
    ),
    expectFail: "帽三态各自出声：超帽红、低于帽也红（登记表自己烂掉不许静默）",
  },
  {
    id: "claim-cap-over-branch-dropped",
    src: "scripts/probe-promise-recall.ts",
    test: "tests/promise-recall-inventory.test.ts",
    desc: "另一半：摘掉「超帽红」⇒ 新写一句没人判的能力断言照样绿，而印出来的读数与帽一字不差地骗人。"
      + "它的 killer 是那条**反向对照**（现读 29＝帽 29 正贴线，只有加一条才测得出这一半）",
    apply: (s) => s.replace(
      "  return { over: read > cap, stale: read < cap, read, cap, margin: cap - read };",
      "  return { over: false, stale: read < cap, read, cap, margin: cap - read };",
    ),
    expectFail: "反向对照：往真仓那份源码里凭空加一句无人判的能力断言 ⇒ 帽当场被顶破（证明上一条不是恒真）",
  },
  /* ── 第 331 页 · #34：第四态「尺读不出」从"有名字没账"变成有帽的一档 ───────────────── */
  {
    id: "claim-no-needle-merged-into-unwitnessed",
    src: "scripts/probe-promise-recall.ts",
    test: "tests/promise-recall-inventory.test.ts",
    desc: "把「句里挑不出可判中文」那一档并进欠证人 ⇒ 看似「零容忍更严」，实际是把**尺读不出**谎报成「这句话没人判」。"
      + "两格的修法相反：前者要么改文案要么给观测者，后者要补证人；混在一档里，下一次没人知道该修哪一个（规则 261/239）",
    apply: (s) => s.replace("    if (runs.length === 0) { noNeedle.push(k); continue; }", "    if (runs.length === 0) { unwitnessed.push(k); continue; }"),
    expectFail: "三态各占一格：witnessed／unwitnessed／noNeedle，一条都不许静默归进『没问题』",
  },
  {
    id: "claim-no-needle-cap-raised-one-notch",
    src: "scripts/probe-promise-recall.ts",
    test: "tests/promise-recall-inventory.test.ts",
    desc: "把第四态的帽抬一档（5→6）⇒ 「现读低于帽」那一半当场失去分辨力，"
      + "而这一档存在的全部理由就是「帽等于干净树现读那一档、只准调低」——抬帽不是修尺，是把尺关掉",
    apply: (s) => s.replace("export const CLAIM_NO_NEEDLE_CAP = 5;", "export const CLAIM_NO_NEEDLE_CAP = 6;"),
    expectFail: "★第四态也有账（第 331 页 #34）：「尺读不出」超帽红、低于帽也红，帽＝干净树现读那一档",
  },
  {
    id: "claim-no-needle-cap-computed-not-wired",
    src: "scripts/probe-promise-recall.ts",
    test: "tests/promise-recall-inventory.test.ts",
    desc: "帽算出来了却拿常量去喂读数（印出来永远「正贴线」）⇒ 这一格从「没人管」变成「看着有人管」，"
      + "比原来更坏。接线判卷钉的是**取料那一枚变量**在调用处，不钉函数名（规则 230）",
    apply: (s) => s.replace("claimCountCeiling(cf.noNeedle.length, CLAIM_NO_NEEDLE_CAP)", "claimCountCeiling(0, CLAIM_NO_NEEDLE_CAP)"),
    expectFail: "★接线：探针把第四态的帽印出来并接进红（算出来不接＝这一格还是没人管）",
  },
  {
    id: "claim-whole-sentence-piece-double-count",
    src: "scripts/probe-promise-recall.ts",
    test: "tests/promise-recall-inventory.test.ts",
    desc: "整句收下后不再压掉它自己的 head/tail 片段 ⇒ 同一句话按整句＋每个片段各进一次清单，"
      + "分母虚高（本笔实测：共用 walker 后承诺网从 10 处涨到 13 处，而那句话一个字都没多）。"
      + "这条针脚钉的就是那一步抑制",
    apply: (s) => s.replace(
      "walk(c, (matched || suppress) && isTemplatePart(c))",
      "walk(c, false)",
    ),
    expectFail: "整句收下后不许再按片段重复计数——共用 walker 时虚高会串到对面",
  },
  // 第 314 页开的是三件成立条件，第 317 页加到五件（③点名用例标题、④那条体内用符号、⑤符号区分度）。
  // 一枚一件、各红不同用例——合在一条用例里就是几条没有分辨力的锚点（造红台的 killer 独占性那一格会当场点名）。
  {
    id: "claim-binding-accepts-symbol-absent-from-source",
    src: "scripts/probe-promise-recall.ts",
    test: "tests/promise-recall-inventory.test.ts",
    desc: "摘掉「符号在那句所在源文件里」这一件 ⇒ 随便指一个仓库里存在的常量就能把一格从欠证人移走，"
      + "绑定通道退化成空头支票：帽子降了，而那句话背后其实没有那个开关",
    apply: (s) => s.replace(
      "!hasSymbol(srcText, b.symbol)",
      "false",
    ),
    expectFail: "缺第二件：那句所在的源文件里没有那个符号 ⇒ 仍算欠证人，并点名是这一件没成",
  },
  {
    id: "claim-binding-accepts-symbol-unreferenced-by-judge",
    src: "scripts/probe-promise-recall.ts",
    test: "tests/promise-recall-inventory.test.ts",
    desc: "把「那条用例体内真引用了这个符号」退回**文件级**（旧口径：整份判卷里出现过这个词就算）⇒ "
      + "散文式指认也能销账。反例挑的是旧口径分辨不出的形状：`promoteToMain` 在那份判卷里出现多次（文件级放行），"
      + "而我点名的那条工具表用例根本不调它 ⇒ 判据收到用例体内才会拒收",
    apply: (s) => s.replace(
      "!hasSymbol(body, b.symbol)",
      "!hasSymbol(testText, b.symbol)",
    ),
    expectFail: "缺第四件：符号在那份判卷里**有**、但不在被点名的那条用例**体内** ⇒ 仍算欠证人（旧口径放得过的形状）",
  },
  {
    id: "claim-binding-binds-faces-not-on-the-owed-list",
    src: "scripts/probe-promise-recall.ts",
    test: "tests/promise-recall-inventory.test.ts",
    desc: "摘掉「那一格还在欠证人清单里」这一件 ⇒ 改名、删句、或那格早已拿到原句证人之后，"
      + "登记照样\"生效\"，而绑定数是从空气里多出来的（守恒律被破，帽可以一路降却不解释任何一格）",
    apply: (s) => s.replace(
      "!owed.has(b.face)",
      "false",
    ),
    expectFail: "缺第一件：登记的那一格根本不在欠证人清单里 ⇒ 报成登记表自己的病，而不是悄悄多绑上一格",
  },
  /* 第 317 页新加的三件，各配一枚。这一族的病不是"绑不上"，而是"绑得太宽"：
     宽到文件级、宽到不是一条用例、宽到符号谁都提得到——三种各有一枚，摘掉哪一枚就红在哪一条。 */
  {
    id: "claim-binding-accepts-title-not-a-case",
    src: "scripts/probe-promise-recall.ts",
    test: "tests/promise-recall-inventory.test.ts",
    desc: "把「指的东西必须是一条**用例标题**」这一件放宽成恒真 ⇒ 任何一句注释、任何一个字符串都能充当证人；"
      + "而那条不存在标题的反例照旧放行（它报的会是别的原因，不是这一件）",
    apply: (s) => s.replace(
      "const isTitle = vitestTitles(testText).some((t) => t === b.testCase)\n      || vitestTitlePatterns(testText).some((re) => re.test(b.testCase));",
      "const isTitle = true;",
    ),
    expectFail: "缺第三件：指的那个「用例」在那份判卷里根本不存在 ⇒ 报的是标题找不到，不是符号找不到",
  },
  {
    id: "claim-binding-symbol-specificity-guard-dropped",
    src: "scripts/probe-promise-recall.ts",
    test: "tests/promise-recall-inventory.test.ts",
    desc: "摘掉符号区分度那一件 ⇒ `run`／`note`／`specs` 这类满屏都是的词又能用来配对（现读：run 在 295 份判卷里被 130 份提到）。"
      + "③④ 只是把蒙混的成本降低，⑤ 才把这条路关掉",
    apply: (s) => s.replace(
      "if (colliding > BINDING_SYMBOL_MAX_JUDGE_FILES) {",
      "if (false) {",
    ),
    expectFail: "缺第五件（区分度）：符号在太多份判卷里出现过 ⇒ 直接拒收，哪怕其余四件都成立",
  },
  // 第 318 页：绑定登记表被顶包候选尺数成副本 ⇒ 影子池加第三族（配对行）。六根锚点＝这一族的六个可松口处，
  // 每台在四台造红里各红一条不同用例（红集合见 outputs/pair-row-exemption-2026-10-03/red-machines-5.log）。
  {
    id: "pair-row-exemption-removed-from-producer-pool",
    src: "scripts/prose-needle-scan.ts",
    test: "tests/prose-needle-scan.test.ts",
    desc: "把配对行豁免从生产者池里摘掉 ⇒ 另一把尺的登记表自己替生产文案作证，"
      + "唯一的真生产者被垫成「2 处副本＝顶包」（第 317 页实测：登记 6 条绑定，顶包候选 10→11，把「只准下调」顶红）",
    apply: (s) => s.replace(
      "chunks.filter((c) => !shadowPaths.has(c.path) && c.pairRow !== true)",
      "chunks.filter((c) => !shadowPaths.has(c.path))",
    ),
    expectFail: "整行都挡：匹配键与给人读的说明一起出去，真生产者那一处还在（copies 与 rawCopies 并排）",
  },
  {
    id: "pair-row-face-shape-check-dropped",
    src: "scripts/prose-needle-scan.ts",
    test: "tests/prose-needle-scan.test.ts",
    desc: "形状检查放宽成「叫 face 的字符串都是配对键」⇒ 枚举值那一族被误当登记表。"
      + "现读反例两处：`scripts/lib/eval-assembly.ts` 的 `face: \"off-here\"`、`src/tools/diagnose.ts` 的 `picked.push({ face: \"lint\", command: c })`"
      + "（后者那一行旁边就是发出去的文案）——实测 M2 那台同时红在这条用例与真仓那条上",
    apply: (s) => s.replace(
      "return isFaceRefChunk({ chunk: decodeJs(pa.initializer.getText(source).slice(1, -1)) });",
      "return true;",
    ),
    expectFail: "反向 B：face 的值是枚举词（没有那段「file#fn｜」形状）⇒ 那是取值，不是配对键，行不豁免",
  },
  {
    id: "pair-row-face-value-kind-unchecked",
    src: "scripts/prose-needle-scan.ts",
    test: "tests/prose-needle-scan.test.ts",
    desc: "连「值必须是字符串」这一层一起摘掉 ⇒ 工具规格里 `face: {…}` 那行被认成配对行，"
      + "同一物体里那句 `description`（模型读到的工具说明）就此从副本计数里消失——豁免吃的是真生产者",
    apply: (s) => s.replace(
      "if (k !== ts.SyntaxKind.StringLiteral && k !== ts.SyntaxKind.NoSubstitutionTemplateLiteral) return false;\n    return isFaceRefChunk({ chunk: decodeJs(pa.initializer.getText(source).slice(1, -1)) });",
      "return true;",
    ),
    expectFail: "反向 A：face 的值是**对象**（工具规格那一族）⇒ 行不豁免——行里的 description 是真给模型看的",
  },
  {
    id: "pair-row-exemption-marked-only-on-face-key",
    src: "scripts/prose-needle-scan.ts",
    test: "tests/prose-needle-scan.test.ts",
    desc: "豁免只落在 `face` 那一格、不落到整行 ⇒ 同一行里给人读的 `why` 仍替生产文案作证。"
      + "这一格是第 317 页那笔红②的真凶（`why` 抄了「对照是空的」那句），只挡 face 等于没修",
    apply: (s) => s.replace(
      "out.push(pairRow ? { path, fn, key, chunk, pairRow: true } : { path, fn, key, chunk });",
      "out.push(pairRow && key === FACE_REF_KEY ? { path, fn, key, chunk, pairRow: true } : { path, fn, key, chunk });",
    ),
    expectFail: "只剩配对行当出处时不许读成 verbatim：那格要么漂、要么由测试自己点名（豁免不制造证人）",
  },
  {
    id: "prose-why-key-joined-doc-prose-keys",
    src: "scripts/prose-needle-scan.ts",
    test: "tests/prose-needle-scan.test.ts",
    desc: "图省事按**键名**放宽（把 why 塞进给人读的散文栏名单）⇒ `src/agent/worker-shell-tools.ts:188`"
      + " 与 `scripts/lib/eval-retry.ts:70` 两处真会发出去的 why 一起失去观测。这一台只有那半句名单断言看得见"
      + "（`why` 不在生产者筛选路径上，copies 那一位同答两态 ⇒ 观测者是 `DOC_PROSE_KEYS` 那条 not.toContain）",
    apply: (s) => s.replace(
      'export const DOC_PROSE_KEYS: readonly string[] = ["desc"];',
      'export const DOC_PROSE_KEYS: readonly string[] = ["desc", "why"];',
    ),
    expectFail: "键名不是判据：why 是**会发出去的字段**，不在配对行里的 why 照算生产者（也不许进散文栏名单）",
  },
  {
    id: "pair-row-exemption-widened-to-whole-file",
    src: "scripts/prose-needle-scan.ts",
    test: "tests/prose-needle-scan.test.ts",
    desc: "把豁免从「行」放宽到「文件」（含 `face:` 的文件整个进影子池）⇒ 同一份 probe 里真给受众看的句子被一起放走。"
      + "第 96 页那笔账的形状（「27 比应有的低 1 格」＝豁免开太宽留下的账），所以这条必须有自己的针脚",
    apply: (s) => s.replace(
      "const shadowPaths = new Set(kinds.map((s) => s.path));",
      "const shadowPaths = new Set(kinds.map((s) => s.path).concat(sources.filter((s) => s.text.includes(\"face:\")).map((s) => s.path)));",
    ),
    expectFail: "豁免只到行、不到文件：含配对行的那份文件不许整份进影子池（同文件里的真文案还在面内）",
  },
  /* ── 第 328 页 · #37：「谁在读这段文本」这把尺自己的四态归位 ─────────────────────── */
  {
    id: "text-readers-string-contents-scanned-as-code",
    src: "scripts/lib/text-readers.ts",
    test: "tests/text-readers.test.ts",
    desc: "字符串态不再单独处理 ⇒ 判卷里的**合成源码字符串**（夹具正文）被当成代码扫，"
      + "假读取调用涌进分母（第 328 页现读：全文正则量出 403 处，其中 27 处躺在夹具正文里）⇒ 清单把没读文件的判卷列成「在读」",
    apply: (s) => s.replace('    if (top.kind === "str") {', "    if (false) {"),
    expectFail: "★合成源码字符串里的假调用不算（第 328 页现读：全文正则量出 403 处，其中 27 处躺在夹具正文里）",
  },
  {
    id: "text-readers-template-interpolation-not-code",
    src: "scripts/lib/text-readers.ts",
    test: "tests/text-readers.test.ts",
    desc: "进了模板串就不再看 `${…}` ⇒ 藏在插值里的真读取调用被整段跳过（漏报方向，"
      + "与上一条是相反的那一半：两头都得有人守，只修一头会把另一头量成 0）",
    apply: (s) => s.replace('{ stack.push({ kind: "tmpl-expr", depth: 0 }); i += 2; continue; }', "{ i += 2; continue; }"),
    expectFail: "但模板串插值里的真调用要算——整段跳过会把这一格吞掉",
  },
  {
    id: "text-readers-dynamic-merged-into-unknown",
    src: "scripts/lib/text-readers.ts",
    test: "tests/text-readers.test.ts",
    desc: "把「形状认得出、路径要跑起来才知道」并进「形状不认识」⇒ 帽是 0，这一混这把尺**永远红**，"
      + "而永远红的尺和没有尺是同一件事（规则 261：读不到与没有不许同形）",
    apply: (s) => s.replace('return { shape: "dynamic-identifier", kind: "dynamic", rel: null };', 'return { shape: "unknown", kind: "unknown", rel: null };'),
    expectFail: "运行期路径的每一子形状分开印，且绝不并进「形状不认识」（帽是 0，混一次就永远红）",
  },
  {
    id: "text-readers-target-missing-counted-as-reader",
    src: "scripts/lib/text-readers.ts",
    test: "tests/text-readers.test.ts",
    desc: "字面量指向盘上不存在的文件也当读取者 ⇒ 判卷里的合成路径（形如 `scripts/<不存在>.ts`）进了清单，"
      + "读起来像「有人在读这份文件」而实际没人读它（三态里的「没有」与「读不到」又被并成一格）",
    apply: (s) => s.replace("      if (h.target === null || h.targetMissing) continue;", "      if (h.target === null) continue;"),
    expectFail: "仓外面（node_modules／临时盘）、指不到盘上文件的字面量、判卷读自己——三种都不进清单",
  },
  {
    id: "text-reader-check-cap-guard-dead",
    src: "scripts/text-reader-check.ts",
    test: "tests/text-readers.test.ts",
    desc: "帽那一格算出来却不接退出码 ⇒ 形状表盖不住新写法时这把尺照样退 0，"
      + "而它唯一的价值就是「我开始瞎了要喊」（接线判卷没有锚点指着时，`--check-needles` 看不见，这里再看不见就真的没人看见了）",
    apply: (s) => s.replace("if (unknown > UNKNOWN_CAP) {", "if (false) {"),
    expectFail: "★接线 CLI 吃的是代码态扫描器与那张帽，不是全文正则（旧写法不许回来）",
  },
  /* ── 第 329 页 · #38：第二出口（语料级读取者）的三态与那一栏的接线 ─────────────────── */
  {
    id: "text-readers-corpus-const-not-expanded",
    src: "scripts/lib/text-readers.ts",
    test: "tests/text-readers.test.ts",
    desc: "参数是裸标识符时不去展开同文件的常量定义 ⇒ `readdirSync(REPLAY_DIR)` 被读成「临时盘」，"
      + "而字面量就在另一行。这一格是真踩出来的：那条匹配标识符的正则没有捕获组，取 `bare[1]` 恒为 undefined、"
      + "TS 也不报（按下标取就是 string），于是整条展开静默失效——第一版现读把两份遍历 scripts 的判卷整类漏掉",
    apply: (s) => s.replace("consts.get(bare[0])", "consts.get(\"\")"),
    expectFail: "★参数是裸标识符时要展开同文件的常量定义（现读第一版在这一格静默失效：那条正则没有捕获组）",
  },
  {
    id: "text-readers-corpus-face-not-load-bearing",
    src: "scripts/lib/text-readers.ts",
    test: "tests/text-readers.test.ts",
    desc: "第二出口的名单退化成「有 corpus 命中就点名」、把登记的面丢掉 ⇒ 只遍历 fixtures 的判卷"
      + "也会出现在改了 scripts 的清单里。多列看似安全，但清单变成噪音就没人再看，"
      + "而 `faces` 这一枚字段也随之退化成注释（没人读它＝它错了也没人知道）",
    apply: (s) => s.replace("    for (const face of s.faces) {", "    for (const face of [\"\"] as string[]) {"),
    expectFail: "两向证人·闭嘴：只遍历 fixtures 的那份不许出现在改了 scripts 的清单里（清单变噪音就没人看）",
  },
  {
    id: "text-reader-check-corpus-column-dropped",
    src: "scripts/text-reader-check.ts",
    test: "tests/text-readers.test.ts",
    desc: "第二出口的汇总不印 ⇒ 只剩「改动面级判卷」那几行，读者无从知道这张表的**分母**是多少"
      + "（78 处列目录调用里语料级 16 处），也就无从知道它是「量到了 0」还是「没接上电」",
    apply: (s) => s.replace('console.log("  " + corpusSummary(corpusScans));', "void corpusSummary(corpusScans);"),
    expectFail: "★两栏各印一行：并成一行就分不清是「少了一条」还是「少了一类」",
  },
  {
    id: "text-reader-check-corpus-cap-guard-dead",
    src: "scripts/text-reader-check.ts",
    test: "tests/text-readers.test.ts",
    desc: "语料级那一栏的帽算出来却不接退出码 ⇒ 出现了没登记的遍历写法时这把尺照样退 0，"
      + "而第二出口唯一的用途就是「我开始漏报一类了要喊」",
    apply: (s) => s.replace("const corpusBad = corpusUnknown > CORPUS_UNKNOWN_CAP;", "const corpusBad = false;"),
    expectFail: "★第二出口那一栏的帽要接进退出码（算出来不看＝恒绿）",
  },
  {
    id: "text-reader-check-column-prefix-merged",
    src: "scripts/text-reader-check.ts",
    test: "tests/text-readers.test.ts",
    desc: "把第二栏的「必跑：」改回「要跑：」＝两栏同名 ⇒ 用 grep 取清单的人会把汇总行那一串名字一起抄进来，"
      + "而 vitest 收下不存在的文件名时并不报错（第 330 页自己踩的：清单说 11 份、实际只跑了 4 个文件，还全绿）。"
      + "这条量的不是判卷，是**消费读数的那一步**——读数印得对不代表读得对",
    apply: (s) => s.replace("      必跑：${m.judge}", "      要跑：${m.judge}"),
    expectFail: "★两栏的名单前缀不同字，且第二栏另给一行可直接粘贴的整串",
  },
  {
    id: "readings-baseline-overwritten",
    src: "scripts/lib/readings-archive.ts",
    test: "tests/loop-eval-invocation-face.test.ts",
    desc: "归档掏空 ⇒ 覆盖 readings.json 之前不再存旧的，跑一次就把上一版基线顶掉"
      + "（10-01 那份三行冒烟基线就是这么没的）。#63 的原形状",
    apply: (s) => s.replace("  if (!ops.exists(readingsPath)) return null;", "  return null;"),
    expectFail: "有旧读数 ⇒ 真调一次 rename，且目标名带树号与时刻戳（冒号点号已换成横线）",
  },
  {
    id: "scratch-tree-prefix-becomes-exact",
    src: "scripts/lib/scratch-tree-naming.ts",
    test: "tests/scratch-tree-naming.test.ts",
    desc: "把名字里的 sha 前缀比较从 `startsWith` 改成完全相等 ⇒ `verify-<sha7>`／"
      + "`head-cert-<sha7>` 这一整族（本仓实际使用的短前缀形状）全被判成「名字在说谎」",
    apply: (s) => s.replace("    if (!head.toLowerCase().startsWith(prefix)) {", "    if (head.toLowerCase() !== prefix) {"),
    expectFail: "名字与 HEAD 相符 ⇒ 一条都不许多报（主树与暂存根外的树不参与）",
  },
  {
    id: "trim-token-keeps-trailing-punct",
    src: "scripts/lib/agents-command-face.ts",
    test: "tests/agents-command-face.test.ts",
    desc: "收尾标点不再剥掉 ⇒ `pnpm --filter x test` 那条命令的脚本名被抽成 `test\``（\S+ 把反引号"
      + "一起吃进来），而根 scripts 里当然没有这个名字 ⇒ 一道本来该绿的尺永远喊「脚本不存在」",
    apply: (s) => s.replace("const trimToken = (s: string): string => s.replace(/[`'\"),;:。，；]+$/gu, \"\");", "const trimToken = (s: string): string => s;"),
    expectFail: "命令抽取的形状：--filter 给对，裸 pnpm 不把开关当脚本",
  },
  // ---- 2026-10-05：#61 第二半（台账分页 + dated 目录名）随判卷同笔配的锚点 ----
  {
    id: "ledger-page-seam-back-to-h3-only",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "分页缝退回只认 `^### ` ⇒ 第 308 页起那几十条 `## … 第 N 页` 整段落进上一条 h3 的体里，"
      + "key 还顶着别人的页号（第 350 页现读：一把伪页挂着 118 条 refs，谁的读数都能在别人的面里找到归宿）",
    apply: (s) => s.replace('export const PAGE_HEAD_RE = /^(?:### |## 20\\d\\d-\\d\\d-\\d\\d · 第 \\d+ 页)/u;', 'export const PAGE_HEAD_RE = /^### /u;'),
    expectFail: "h2 两页 ⇒ 两条页（从前只认 `^### ` 时它们整段落进别人的体里，key 还是上一条 h3 的）",
  },
  {
    id: "dated-dir-hhmm-truncated-again",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "dated 目录名的 `-HHMM` 又不要了 ⇒ `head-cert-<rev>-<date>-<HHMM>` 被截断成不含时刻的目录，"
      + "那种目录根本不在盘上 ⇒ 读数退成「取不到」（而红的条数照旧 0，是**假绿**形状，第 349 页那条）",
    // 针脚必须比 `(?:-\d{4})?` 长：那个片段在本文件里命中 2 处（正则一处 ＋ 讲它的注释一处），
    // 单用它就落进「待复认」那一档——本仓的自指族（规则 236），实测当场复现。
    apply: (s) => s.replace("\\d{4}-\\d{2}-\\d{2}(?:-\\d{4})?)/gu", "\\d{4}-\\d{2}-\\d{2})/gu"),
    expectFail: "两种形状各钉一条：普通 `outputs/<主题>-<date>/` 与 `head-cert-<rev>-<date>-<HHMM>`",
  },
  // ---- 2026-10-07 第 413 页：D-13（页号唯一面）随判卷同笔配的锚点 ----
  {
    id: "d13-collision-detector-neutered",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "撞号那一半恒不报 ⇒ 台账再多几十个「同一天两位作者各写一遍第 N 页」，门照印「新撞的 0 个」。" +
      "本条的动因就是现读那 106 个重复号：引用老页时得靠猜是哪一页",
    apply: (s) => s.replace("    if (c <= 1 || legacy.includes(key)) continue;", "    if (true) continue;"),
    expectFail: "两张同名页标题报一条；只有一张时一条不红（别把正常的页也喊成撞）",
  },
  {
    id: "d13-title-anchor-dropped",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "取号式丢掉行首锚定（变成「标题里任何位置出现 第 N 页 都算一页」）⇒ 小节头只要正好顶着页号，" +
      "就既虚增 titles 又凭空造出一个撞号；而 D-13 的存在理由正是「页号是引用单位」这件事不能被段落标签污染",
    apply: (s) => s.replace("const PAGE_TITLE_NUMBER_RE = /^20\\d\\d-\\d\\d-\\d\\d · 第 (\\d+) 页/u;", "const PAGE_TITLE_NUMBER_RE = /第 (\\d+) 页/u;"),
    expectFail: "小节头正好以页号开头不算第二页：按标题形状取号，不吃 key 的退化路径",
  },
  {
    id: "d13-stale-registration-silent",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "登记表不再命中时不出声 ⇒ 有人重编号一页之后登记还留着，水位只减不查就烂在这儿，" +
      "而「净零交换」（销掉一条存量同时新撞一个号）也一起被放过（D-10 为同一件事换成集合登记）",
    apply: (s) => s.replace("  for (const key of legacy) {\n    if ((counts.get(key) ?? 0) > 1) continue;", "  for (const key of []) {\n    if ((counts.get(key) ?? 0) > 1) continue;"),
    expectFail: "登记是集合不是豁免：命中登记不红，登记不再命中要点名该删",
  },
  {
    id: "d13-page-face-not-the-shared-one",
    src: "scripts/docs-check.ts",
    test: "tests/docs-check.test.ts",
    desc: "调用点不再吃 D-11 那批页（传空数组或自己重算一份）⇒ 这把尺的分母与门的分母分家，" +
      "而「面为空照样绿」正是本仓最忌的假绿形状（第 392 页第 9 条同族）",
    apply: (s) => s.replace("pageNum = checkPageNumberUniqueness(witnessPages);", "pageNum = checkPageNumberUniqueness([]);"),
    expectFail: "接线：门吃的是 D-11 那批页（`witnessPages`），不在这里重算一份分页面",
  },
  {
    id: "trace-name-rule-second-source",
    src: "scripts/gym-draft.ts",
    test: "tests/failed-trace-keep.test.ts",
    desc: "留档名 ⇄ 草稿 id 的剥后缀规则被 import 断开 ⇒ 取料口自己再写一遍（两份规则迟早漂，"
      + "漂的结果是「留了档但草稿永远认不出它」这种静默不响应）。"
      + "killer 换过一次（第 406 页）：原来指的那条「基准那种 .events.jsonl 剥干净」直接 import lib 调 `caseIdOfTrace`，"
      + "**不经过被改的文件** ⇒ 摘掉 gym-draft 的 import 它照样绿（规则 325 那一型：指针指向不会红的那条）；"
      + "改指真 spawn 那份脚本的那条——共用规则断线的可观测后果就是它跑不起来",
    apply: (s) => s.replace(`import { caseIdOfTrace, TRACE_SUFFIX } from "./lib/failed-trace-keep";\n`, ""),
    expectFail: "留档文件交给 gym-draft：--out <目录> --apply ⇒ 草稿三件真落盘（闭环走通，不是打印一句话）",
  },
  {
    id: "commit-shape-hygiene-face-not-counted",
    src: "scripts/repo-hygiene-check.ts",
    test: "tests/commit-surface-check.test.ts",
    desc: "认证那一拍算出了红却不并进 failed ⇒ 这道门印 ❌ 而退 0，"
      + "忘了跑提交面那道尺的人就再没有第二道闸（第 230 页「算出来不接」那一族）",
    apply: (s) => s.replace(`  if (shapeBlocking.length > 0) failed++;\n`, ``),
    expectFail: "卫生门那一面：接进 failed 的计数，且失败时点名两种修法",
  },
  {
    id: "commit-shape-cli-exit-hardcoded-zero",
    src: "scripts/commit-surface-check.ts",
    test: "tests/commit-surface-check.test.ts",
    desc: "提交那一刻那道尺退码写回 0 ⇒ 它照印 ❌ 但「绿」这个信号又是恒真的，"
      + "整条流水线里没人会去读那一行小字（这正是第 431 页靠人眼的形状）",
    apply: (s) => s.replace(`process.exit(shapeBlocking.length > 0 ? 1 : 0);`, `process.exit(0);`),
    expectFail: "CLI 那一面：一处取料＋一处判据，退码接的是阻断数（不是恒 0）",
  },

  /* ── 第 472 页：`scripts/prose-needle-scan.ts` 的抽料单价——`enclosingFn` 从「每收一条字面量重扫一遍
   *    前缀」（条数 × 文件长）改成「函数头索引一次 ＋ 二分」。四根针各钉新判据的一个可松处，
   *    四条 expectFail 各指一条**不同的** killer 用例（第 276 页那条规矩：两支钉同一条用例，
   *    等于其中一支没有观测者）。 */
  {
    id: "prose-scan-enclosing-fn-per-call-rescan",
    src: "scripts/prose-needle-scan.ts",
    test: "tests/prose-needle-scan.test.ts",
    desc: "把「函数头索引一次」退回「每收一条字面量重扫一遍前缀」——**语义完全等价**，一个读数都不动，"
      + "只红在单价上：第 472 页实测这一形状在 `scripts/mutate-verify.mjs`（726 KB／12 136 条）上是 4 929 ms，"
      + "索引版 1 ms。没有这一格，第 472 页那种「判据全对、只是慢到超时」的假红会悄悄长回来",
    apply: (s) => s.replace(
      "    const fn = enclosingFn(heads, node.getStart(source));",
      "    const fn = enclosingFn(fnHeadsOf(code.slice(0, node.getStart(source))), node.getStart(source));",
    ),
    expectFail: "505 KB／12 000 条：整份抽料的墙钟在预算内（二次方那版 4 635 ms，索引版不到 1 s）",
  },
  {
    id: "prose-scan-fn-heads-indexed-on-raw-text",
    src: "scripts/prose-needle-scan.ts",
    test: "tests/prose-needle-scan.test.ts",
    desc: "函数头索引建在**未涂白**的原文上 ⇒ 只在注释里出现的函数头开始当代码用，它之后所有字面量都被记到"
      + "那个名字底下（副本数按 `path#fn` 数 ⇒ 错的人名会静默把两处副本并成一处，或反过来）",
    apply: (s) => s.replace("  const heads = fnHeadsOf(code);", "  const heads = fnHeadsOf(text);"),
    expectFail: "索引建在涂白后的文本上：只在注释里的函数头不是一段代码，不许顶掉 (top)",
  },
  {
    id: "prose-scan-enclosing-fn-boundary-exclusive",
    src: "scripts/prose-needle-scan.ts",
    test: "tests/prose-needle-scan.test.ts",
    desc: "右边界从严一格（`end <= at` → `end < at`）⇒ 正好止于字面量起点的那条函数头被丢掉。"
      + "老实现切的是 `slice(0, at)`，被截断的那条匹配**本来就不在切片里** ⇒ 严一格就是换了语义",
    apply: (s) => s.replace("    if (heads[mid]!.end <= at) lo = mid + 1;", "    if (heads[mid]!.end < at) lo = mid + 1;"),
    expectFail: "右边界算进切片：const f = (“…”) 那条字面量归 f，不是 (top)",
  },
  {
    id: "prose-scan-enclosing-fn-picks-first-head",
    src: "scripts/prose-needle-scan.ts",
    test: "tests/prose-needle-scan.test.ts",
    desc: "把「最后一条函数头赢」写成「第一条赢」⇒ 第二支函数之后的字面量全记到第一支名下，"
      + "副本数按错误的分组算（真仓读数不一定当场变——这支钉的是口径本身，不是它的一个读数）",
    apply: (s) => s.replace('  return lo === 0 ? "(top)" : heads[lo - 1]!.name;', '  return lo === 0 ? "(top)" : heads[0]!.name;'),
    expectFail: "六种形状逐条对得上确切函数名（空字面量不落格、外层里嵌内层）",
  },
];
