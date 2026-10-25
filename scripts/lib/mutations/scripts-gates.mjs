// scripts-gates 域的变异配置条目（2026-10-17 从 scripts/mutate-verify.mjs 按域拆出，见 PROGRESS 第 501 页）。
// 每条 = 一处语义突变 + 期望被它杀死的具体用例标题。追加条目时放进对应域的文件；
// **组间顺序不影响任何判据**（每条独立），同一文件内保持原顺序以便 diff。
export const MUTATIONS = [
  {
    // 第 487 页事故的直接产物：那道门当初不存在，所以我把别人 42 行在飞改动连进了 commit。
    // 判据是**增量比**（未声明文件新增 ≥ 我声明那批新增之和 × 2），不是绝对行数——
    // 第一版用绝对行数量不出真事故（271→359 只有 1.3 倍，而其中 42 行是别人的）。
    id: "carried-hunks-ratio-blind",
    src: "scripts/lib/commit-surface.ts",
    test: "tests/commit-surface-check.test.ts",
    desc: "夹带判据的倍数闸失效（>= 换成 >，或阈值乘 100）⇒ 别人没提交的 hunk 又被连进 commit，"
      + "而那一族的后果是「HEAD 上入库的测试 import 不存在的函数」，本地 gates 还全绿",
    apply: (s) => s.replace("export const CARRIED_DELTA_RATIO = 2;", "export const CARRIED_DELTA_RATIO = 200;"),
    expectFail: "未声明文件的新增恰好是我那批的 2 倍 ⇒ 响（判据是 ≥，边界含等号）",
  },
  {
    id: "mutate-gates-judge-file-blind",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "退回「判卷测试文件不在闸内」的旧语义（别人改到一半的 test 会伪装成基线红或变异存活）",
    apply: (s) => s.replace('if (info.testState !== "clean") {', "if (false) {"),
    expectFail: "源文件干净、**判卷测试文件在飞** → unverified（不得冒充变异存活或基线红）",
  },
  {
    id: "needle-hits-treats-empty-as-ok",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-needles-check.test.ts",
    desc: "空针脚不报负值 ⇒ 一条 replace(空串, x) 的锚点看着「命中很多」其实永远改不动目标代码",
    apply: (s) => s.replace("if (needle === \"\") return -2;", "if (needle === \"\") return 1;"),
    expectFail: "空针脚与源文件读不到用负值区分开（两者后果不同，不能都算 0）",
  },
  {
    id: "needle-severity-flattens-warn",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-needles-check.test.ts",
    desc: "多处命中并入阻断 ⇒ 存量条目当场全红，这条门反而变成没人敢修的债；后果不同的两档必须分开",
    apply: (s) => s.replace("return hits > 1 ? \"warn\" : \"blocking\";", "return \"blocking\";"),
    expectFail: "hits=1 通过；>1 只待复认；0/负值是阻断",
  },
  {
    id: "audit-re-reads-source-per-entry",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-needles-check.test.ts",
    desc: "丢掉源文件缓存 ⇒ 220 条逐条重复读文件，秒级门被拖成分钟级（这条门的意义就是秒级可进门禁）",
    apply: (s) => s.replace("if (!cache.has(e.srcRel)) cache.set(e.srcRel, readSrc(e.srcRel));", "cache.set(e.srcRel, readSrc(e.srcRel));"),
    expectFail: "读取次数 = 不同源文件数（全表 220 条指向约 90 个文件，逐条重复读会把秒级门拖成分钟级）",
  },
  {
    id: "audit-reports-clean-needles",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-needles-check.test.ts",
    desc: "把「命中一次」也算问题 ⇒ 门对正常表恒红，于是下一个人的动作是关掉它（假红与假绿同样贵）",
    apply: (s) => s.replace("if (hits !== 1) problems.push({ id: e.id, srcRel: e.srcRel, hits, needle: e.needle });", "if (true) problems.push({ id: e.id, srcRel: e.srcRel, hits, needle: e.needle });"),
    expectFail: "只报命中次数 ≠ 1 的，并按传入顺序",
  },
  {
    id: "classify-unknown-flag-ignored",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-needles-check.test.ts",
    desc: "未知 flag 不再收集 ⇒ 拼错/未合并的 `--check-needles` 被当成无参数，脚本直接开跑全表：在别人的写作窗里就地改源文件几十分钟" +
      "（2026-09-23 改指：`classifyArgs` 为 `--budget-ms <值>` 加了 consumed 分流，旧针脚整行失效）" +
      "（2026-09-28 第二次改指：放行 `--flag=值` 连写时这一行改查 `isKnownMutateFlag`，旧针脚又整行失效——规则 229，这次的「别人」还是我）",
    apply: (s) => s.replace(`const unknown = args.filter((a, i) => !consumed.has(i) && a.startsWith("--") && !isKnownMutateFlag(a));`, "const unknown: string[] = [];"),
    expectFail: "拼错/未实现的 flag 落进 unknown，且不混进 targets",
  },
  {
    id: "classify-flags-counted-as-ids",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-needles-check.test.ts",
    desc: "flag 混进位置参数 ⇒ `--check-needles` 被当成一个条目 id，报「未知 id」而不是执行针脚体检（门从此静默不跑）" +
      "（2026-09-23 改指：同上，分流现在还要跳过被 consumed 吞掉的值位）",
    apply: (s) => s.replace(`const targets = args.filter((a, i) => !consumed.has(i) && !a.startsWith("--"));`, "const targets = [...args];"),
    expectFail: "已知 flag 各归其 mode，位置参数进 targets",
  },
  {
    id: "line-wise-apply-never-recognized",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-needles-check.test.ts",
    desc: "不认逐行式 apply ⇒ 那些「故意改所有匹配行」的锚点长期挂 ⚠️ 假警；假警报攒多了，真警也会被一起忽略。" +
      "针脚随第 153 页的判据搬家（旧针脚指着 `applySource.includes` 那句，已经不在盘上）",
    apply: (s) => s.replace("return LINE_WISE_SHAPE.test(applySource);", "return false;"),
    expectFail: "认得 split/map 式写法，普通单点 replace 不误判",
  },
  {
    id: "line-wise-apply-always-true",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-needles-check.test.ts",
    desc: "一律当成逐行式 ⇒ 普通单点锚点全都不再核针脚，静态检退回「什么都没看」的空门",
    apply: (s) => s.replace("return LINE_WISE_SHAPE.test(applySource);", "return true;"),
    expectFail: "认得 split/map 式写法，普通单点 replace 不误判",
  },
  {
    id: "line-wise-exemption-by-text-shape",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-needles-check.test.ts",
    desc: "退回旧判据「改法文字里含 .split( 」⇒ 免检名单从 4 条涨回 11 条，" +
      "而那 7 条（针脚或替换文字里恰好含 split( 的普通单点改法）再次静默脱离针脚体检——今天不红，等实现搬家那天也不红",
    apply: (s) => s.replace("return LINE_WISE_SHAPE.test(applySource);", "return applySource.includes(\".split(\");"),
    expectFail: "针脚指向含 split( 的实现 ⇒ 不算逐行式（这条豁免是给改写策略的，不是给文字形状的）",
  },
  {
    id: "line-wise-block-branch-dropped",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-needles-check.test.ts",
    desc: "收紧时把「块体第一句才拆开输入」那一支漏掉 ⇒ 4 条真逐行式里最少有一条被拖回针脚体检，" +
      "而它们的改法本来就要在多处命中 ⇒ 静态门凭空造出假红（收紧判据必须配反向哨兵，规则 227）",
    apply: (s) => s.replace("return LINE_WISE_SHAPE.test(applySource);", "return /=>\\s*\\w+\\.split\\(/.test(applySource);"),
    expectFail: "反向哨兵：块体里第一句就把输入按行拆开 ⇒ 仍要认成逐行式（收紧不许把 4 条真豁免砸成假红）",
  },
  {
    id: "typecheck-triage-scratches-into-tracked",
    src: "scripts/lib/typecheck-triage.ts",
    test: "tests/typecheck-triage.test.ts",
    desc: "归因把所有报错都算成 HEAD 内 ⇒ 别人未跟踪的草稿又会被当本仓回归，白开一次 worktree 对照（已发生两次）",
    apply: (s) => s.replace("    if (untracked.has(f)) { scratch.push(f); continue; }", "    if (untracked.has(f)) { head.push(f); continue; }"),
    expectFail: "全在未跟踪草稿：head 空、scratch 列出该文件，并明说 HEAD 类型干净",
  },
  {
    id: "typecheck-parse-trims-at-whitespace",
    src: "scripts/lib/typecheck-triage.ts",
    test: "tests/typecheck-triage.test.ts",
    desc: "解析报错行改回按非空白切路径 ⇒ 目录名带空格（本仓历史目录名 deepseek harness 就带空格）时截出半个路径，整列归因作废",
    apply: (s) => s.replace("const TSC_ERROR_LINE = /^(.+?)\\(\\d+,\\d+\\): error TS\\d+/u;", "const TSC_ERROR_LINE = /^(\\S+?)\\(\\d+,\\d+\\): error TS\\d+/u;"),
    expectFail: "路径含空格也能解析（历史目录名有空格；按空白切会截出半个路径）",
  },
  {
    id: "typecheck-clean-verdict-unearned",
    src: "scripts/lib/typecheck-triage.ts",
    test: "tests/typecheck-triage.test.ts",
    desc: "「HEAD 态类型干净」只看 `head` 一档空 ⇒ 报错全落在**在飞 tracked**（或工作树状态取不到）时照样给这句假绿结论。"
      + "第 330 页补第三档时这条判据的形状跟着变：那句现在要三档都空才许说",
    apply: (s) => s.replace("if (t.head.length === 0 && t.dirtyTracked.length === 0 && t.undetermined.length === 0) {", "if (t.head.length === 0) {"),
    expectFail: "★已跟踪但工作树脏 ⇒ 归「在飞改动中的 tracked」，既不算 HEAD 缺陷也不算草稿（两次现读的都是这一格）",
  },
  {
    id: "typecheck-undetermined-read-as-head-defect",
    src: "scripts/lib/typecheck-triage.ts",
    test: "tests/typecheck-triage.test.ts",
    desc: "工作树状态取不到时把报错并进 `head` ⇒ 谎报「HEAD 内有缺陷」；这一格与「没量到」是两回事（规则 261：读不到与没有不许同形）",
    apply: (s) => s.replace("    if (dirty === null) { undetermined.push(f); continue; }", "    if (dirty === null) { head.push(f); continue; }"),
    expectFail: "零报错不打任何归因行；工作树状态取不到时归「没有归位」，两头结论都不许给",
  },
  {
    id: "anchor-duplicate-id-check-lost",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-needles-check.test.ts",
    desc: "锚点 id 唯一性检查被收成恒不命中 ⇒ 表里两条锚点共用一个 id 时门照样报「全部可判定」，" +
      "而 `mutate-verify <id>` 会同时跑两条、报告两行同 id 不同改法（读不出哪条活着）。" +
      "2026-09-23 我往表尾插锚点时真造成过一次，当时秒级门完全没声音",
    apply: (s) => s.replace("return [...seen].filter(([, n]) => n > 1)", "return [...seen].filter(([, n]) => n > 999)"),
    expectFail: "无重复 ⇒ 空数组；成对与三连都各报一次，count 如实",
  },
  {
    id: "mutate-preflight-refusals-dropped",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "整跑前的拒绝名单收成恒空 ⇒ 门又回到「跑到第 k 条才撞上未跟踪源文件」：实测烧掉 19 分钟，" +
      "抛死后账本里连一条读数都不留（pnpm facts 看不见这次跑过）",
    apply: (s) => s.replace('.filter((x) => x.d.kind === "refused")', '.filter((x) => x.d.kind === "never-refused")'),
    expectFail: "未跟踪与在飞的源文件都进名单，并带上是哪一条与为什么",
  },
  {
    id: "mutate-leftover-backup-blind",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "残留备份检查变成恒空 ⇒ 上一次被 kill 的整跑留下的 `.mutbak` 无人报，" +
      "下一次开跑时被 cpSync 直接覆盖——那份「崩溃前的原始内容」是还原正确的唯一凭证",
    apply: (s) => s.replace(".filter((p) => exists(p));", ".filter(() => false);"),
    expectFail: "路径 = 源文件 + .mutbak，且只报盘上真在的那几个",
  },
  {
    id: "scan-scope-empty-list-silent",
    src: "scripts/lib/scan-scope.ts",
    test: "tests/assertion-health-scan.test.ts",
    desc: "「没拿到清单」与「没有要扫的东西」同形 ⇒ 体检在 git 异常/空清单时静默扫 0 个文件并报零命中（假绿）",
    apply: (s) => s.replace("return files.length === 0 ? null : files;", "return files;"),
    expectFail: "已跟踪清单为空 ⇒ 返回 null（调用方退回磁盘遍历，不静默少判）",
  },
  {
    id: "verdict-takes-last-line-not-conclusion",
    src: "scripts/lib/gate-verdict.ts",
    test: "tests/gates-scan.test.ts",
    desc: "结论行退回「就取最后一行」⇒ vitest 的收尾是 Duration / Start at，计数在它前面，" +
      "汇总页于是显示一句没用的话——取错一行比不取更坏，因为它看起来像结论",
    apply: (s) => s.replace("    if (VERDICT_MARK.test(l)) return clip(l);", "    if (false) return clip(l);"),
    expectFail: "vitest 形态取计数那一行，而不是收尾的 Duration",
  },
  {
    id: "verdict-not-stripping-ansi",
    src: "scripts/lib/gate-verdict.ts",
    test: "tests/gates-scan.test.ts",
    desc: "剥色没吃共用件（各门自己判一次）⇒ 调用者 TERM 带色时结论行里嵌着 \\x1b，" +
      "汇总页打出一串脏码——同一族在 vitest-summary 里已修过一次，这里不能重抄一份漏掉",
    apply: (s) => s.replace("  const lines = stripAnsi(output).split(\"\\n\")", "  const lines = output.split(\"\\n\")"),
    expectFail: "带 ANSI 颜色的输出仍取到干净的结论行（剥色吃共用件）",
  },
  {
    id: "mutate-preflight-refusal-empties-runnable",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "预检退回「有条目被拒 ⇒ 一条都不跑」⇒ 别人一个未跟踪的源文件让整张变异表停摆，" +
      "而红门只报一句『拒绝 1 条』：其余 695 条与在飞改动毫无关系的锚点没人判，读起来像保护还在",
    apply: (s) => s.replace("    runnable: entries.filter((e) => !refusedIds.has(e.id)).map((e) => e.id),", "    runnable: refusedIds.size > 0 ? [] : entries.map((e) => e.id),"),
    expectFail: "一条在飞 ⇒ 只它被跳过，**其余条目必须在 runnable 里**（旧写法这里给空表）",
  },
  {
    id: "mutate-preflight-safety-dropped",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "反过来：为了让表「跑满」而不安全照跑 ⇒ 源文件不在 HEAD 里时崩溃没有回滚兜底，" +
      "别人的在飞改动会被变异中途的写盘永久盖掉。停摆是损失，越权是损坏",
    apply: (s) => s.replace("    runnable: entries.filter((e) => !refusedIds.has(e.id)).map((e) => e.id),", "    runnable: entries.map((e) => e.id),"),
    expectFail: "不安全的一条都不许进 runnable（跳过要真跳过，别只看名单照样跑）",
  },
  // ---- 自愈这条手段自己的判卷（2026-09-23）：`leftoverActionOf` / `budgetMsOf` 决定的是
  // 「要不要拿备份盖掉盘上的源文件」，判错一分支就是**不可逆地覆盖别人的改动** ⇒ 每支都要有反面对手。
  {
    id: "leftover-heal-ignores-is-our-mutant",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "去掉 `isOurMutant` 这道闸 ⇒ 只要「备份 == HEAD 且当前 != HEAD」就自动覆盖，" +
      "而这两条对「备份落盘后别人自己改了同一个文件」同样成立：一次自愈就能把别人的在飞改动抹掉",
    apply: (s) => s.replace("if (current === null || !isOurMutant)", "if (current === null)"),
    expectFail: "反面对手：同样三份内容，但当前那份对不上任何锚点 ⇒ 绝不自动盖（可能是别人的在飞改动）",
  },
  {
    id: "leftover-heal-trusts-non-head-backup",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "去掉「备份必须 == HEAD」这道闸 ⇒ 拿一份对不上 HEAD 的备份去盖源文件。" +
      "备份内容不等于 HEAD 时它可能是别人未提交的原件，这时候连「只删备份」都不该自动做",
    apply: (s) => s.replace("if (backup !== head) return", "if (false && backup !== head) return"),
    expectFail: "备份 != HEAD ⇒ manual（备份里可能是别人未提交的原件，即便当前内容对得上锚点也不许盖）",
  },
  {
    id: "budget-missing-value-silent",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "`--budget-ms` 后面没给值时退化成「不限」且不出声 ⇒ 写的人以为自己给了预算，" +
      "实际在跑全表，正是被外层超时杀在突变那一拍的形状（未知 flag 同族：看不懂不能当缺省）",
    apply: (s) => s.replace("if (i >= 0 && flag === undefined) return { ms: 0,", "if (false && flag === undefined) return { ms: 0,"),
    expectFail: "非法预算不许静默退化成「没设」（写的人以为给了预算）",
  },
  {
    id: "budget-value-slot-treated-as-anchor-id",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "分流不吞带值 flag 的下一个 token ⇒ `--budget-ms 600000` 里的 600000 被当成锚点 id 报「未知 id」，" +
      "于是没人能给这张表设预算（而预算正是别被掐死在突变那一拍的手段）",
    apply: (s) => s.replace("consumed.add(i + 1);", "consumed.add(-1); // 值位没被吞"),
    expectFail: "`--budget-ms 600000` 的值不是锚点 id（旧分流会报「未知 id 600000」，等于没人能设预算）",
  },
  // ---- HEAD 归属两面判据（2026-09-23，追加九–十二）：判据自己也得有分辨力。
  //      接线那两格怎么钉：`.mjs` 不过 tsc（tsconfig 的 include 有 scripts/ 但没开 allowJs），
  //      少喂一支面、少算一支数都不会有编译期信号 ⇒ 把两件事搬进 lib 并让求和处**当场崩**
  //      （`anchorFaces` / `blockingTotalOf`，下面三根针钉它们的失效方式）。
  //      仍然没钉、也不假装已覆盖的一格：接线**不去调用**这两个函数（改回内联手搓）——那要 vm-slice 真跑
  //      `reportNeedles` 才量得到，本仓不用"源码形状断言"充数 ⇒ 留名在任务 #63。
  {
    id: "untracked-face-filter-always-empty",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "把「未被 git 跟踪的锚点面」判成恒空 ⇒ 整条 HEAD 归属判据退化成装饰：主树照旧全绿，" +
      "而锚点守护的代码从未入库（追加九实测：主树阻断 0 / 同 HEAD 隔离树阻断 6）",
    apply: (s) => s.replace("return items.filter((p) => !isTracked(p.path));", "return [];"),
    expectFail: "盘上有、HEAD 里没有 ⇒ 点出来（含 id、路径与是哪一面，能直接照着补提交）",
  },
  {
    id: "untracked-line-judge-face-uses-src-wording",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "判卷面套用被测面的文案 ⇒ 报告说「源文件读不到」，而真因是判卷文件从未入库（干净 HEAD 上连基线都跑不出来，" +
      "却被伪装成「基线不是全绿」）；两面的修法指不同文件，串了就误导",
    apply: (s) => s.replace('const symptom = p.what === "判卷"', 'const symptom = false && p.what === "判卷"'),
    expectFail: "判卷面缺文件说「连基线都跑不出来」并指向判卷文件，不写「源文件读不到」（两面修法指不同文件）",
  },
  {
    id: "untracked-line-judge-fix-points-at-src-file",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "判卷面的修法一句写死成「把那份源文件提交」⇒ 照着做会去提交一份本来就入库了的源文件，" +
      "而缺的那份判卷文件仍然没有进 HEAD（门继续红，且没人知道要提交什么）",
    apply: (s) => s.replace('const target = p.what === "判卷" ? "判卷文件" : "源文件";', 'const target = "源文件";'),
    expectFail: "判卷面缺文件说「连基线都跑不出来」并指向判卷文件，不写「源文件读不到」（两面修法指不同文件）",
  },
  {
    id: "drift-double-reports-disk-problems",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "去掉「盘上已报过就不重复报」⇒ 同一条锚点同时进「针脚失效」与「钉在飞文本」两栏，" +
      "汇总的阻断数被同一件事抬高两次（读的人按数去找缺陷，会多算一半）",
    apply: (s) => s.replace("return head.filter((p) => !reported.has(p.id) && !pathsNotInHead.has(p.srcRel));",
      "return head.filter((p) => !pathsNotInHead.has(p.srcRel));"),
    expectFail: "盘上已经报过的同一条不重复报（一行红只有一个成因，读的人不必对两行）",
  },
  {
    id: "drift-double-counts-untracked-path",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "去掉「路径未入库的归上一条管」⇒ 一个从未入库的文件既进「未入库面」又进「钉在飞文本」，" +
      "两栏各说一种成因、指向两种修法，而它只有一个",
    apply: (s) => s.replace("return head.filter((p) => !reported.has(p.id) && !pathsNotInHead.has(p.srcRel));",
      "return head.filter((p) => !reported.has(p.id));"),
    expectFail: "HEAD 里读不到、且该路径已由「未入库」判据报过 ⇒ 不重复报（同一件事两栏都记 = 数被抬高）",
  },
  {
    id: "anchor-faces-drops-judge-face",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "取料入口少 push 判卷那一支 ⇒ 接线只剩一面在查，未入库的判卷文件从此无人点名" +
      "（干净 HEAD 上那些锚点仍会伪装成「基线不是全绿」，而 lib 单测看不见——它拿到的是手搓 items）",
    apply: (s) => s.replace('    out.push({ id: e.id, path: e.test, what: "判卷" });', "    // 判卷那一支没喂"),
    expectFail: "每条锚点产出两支面（被测面 + 判卷），且两面各一次（少喂一支 = 那一面静默失效）",
  },
  {
    id: "blocking-total-drops-drift-from-sum",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "求和写死成漏掉 drift ⇒ 「钉在飞文本」照旧印在汇总里、却不再决定 exit：" +
      "门报红而全量门禁照样绿（有读数、无后果，正是本仓最忌的形状）。" +
      "指针不写「四支／六支」：BLOCKING_KEYS 每加一维那个数量词就要改标题，写死即静默守旧标题（实测本条红在别的用例上）。",
    apply: (s) => s.replace("return BLOCKING_KEYS.reduce((n, k) => n + parts[k], 0);",
      "return parts.needle + parts.duplicateIds + parts.untracked;"),
    expectFail: "数都给 ⇒ 求和（0 也算数，不许被当成缺项丢掉）",
  },
  {
    id: "blocking-total-swallows-missing-part",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "去掉「缺一支就当场崩」这道闸 ⇒ 接线漏计一支时照样吐出一个数（NaN 也会被 `+` 吞成读数），" +
      "而 `.mjs` 不经 tsc，没有任何东西会替这道门发现它少看了一维",
    apply: (s) => s.replace("if (missing.length > 0) {", "if (false && missing.length > 0) {"),
    expectFail: "缺一支 ⇒ 抛并点名缺哪支（门报红却少算一维 = 这条门唯一的产出被废）",
  },
  {
    id: "head-pointer-filter-ignored",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "HEAD 侧那一遍不再筛『这条锚点在 HEAD 的表里吗／判卷相对 HEAD 动过吗』⇒ 本笔同时改表与改判卷的正常提交会被读成缺陷（假红方向），逼人回去放宽或删掉这一维",
    apply: (s) => s.replace("entries.filter((e) => e.test !== \"\" && opts.inHeadTable(e.id) && opts.judgeDirty(e.test)),", "entries.filter((e) => e.test !== \"\"),"),
    expectFail: "本笔同时改表与改判卷的那条**不判**（那格归同笔规矩）；判卷没动过的也不重复判",
  },
  {
    id: "baseline-red-always-blocking",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "基线红一律算阻断 ⇒ 别人半落库造成的「判卷载不动」重新淹掉这张表唯一的信号（第 141 页 167 条环境红混进 13 条真红那次）",
    apply: (s) => s.replace('return m === null ? { kind: "blocking" } : { kind: "unloadable", module: m[1] ?? "" };', 'return { kind: "blocking" };'),
    expectFail: "判卷载不动 ⇒ 未证，且点名是哪个模块",
  },
  {
    id: "baseline-red-always-unloadable",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "反向那一半：基线红一律算载不动 ⇒ 真把表跑退化（判卷自己坏了）也被洗成「量不了」，门从此不再报退化",
    apply: (s) => s.replace('return m === null ? { kind: "blocking" } : { kind: "unloadable", module: m[1] ?? "" };', 'return { kind: "unloadable", module: "" };'),
    expectFail: "别的原因让基线红（真缺陷）⇒ 仍按阻断，不许把表退化洗成未证",
  },
  {
    id: "attribution-reads-whole-output",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "归因退回「整串输出里找得到那句话」⇒ vitest 把通过的用例也列出来（`✓ …`），一条绿用例就能满足它 ⇒ 锚点声明的 killer 从没红过也照样报 ✅（第 141 页就是这么发现 cpp 那条改在隔壁支的）",
    apply: (s) => s.replace("  return expectFailMatchesTitles(expectFail, failingTestText(vitestOut));", "  return expectFailMatchesTitles(expectFail, vitestOut);"),
    expectFail: "声明的那条只是**通过**了 ⇒ 不算归因（旧判据在这里报真）",
  },
  {
    id: "attribution-fail-face-drops-x-marker",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "失败面只认 `FAIL` 那种写法 ⇒ 逐条列表里的 `×` 行被扔掉，红在期望用例上也被读成「没红在期望用例上」（假警方向：正当的杀被判成误伤，逼人回去放宽判据）",
    apply: (s) => s.replace(".filter((line) => /^\\s*(?:FAIL\\b|[×✕✗])/.test(line))", ".filter((line) => /^\\s*FAIL\\b/.test(line))"),
    expectFail: "红的那条正是声明的那条 ⇒ 认；`FAIL … > 标题` 与 `×` 两种失败面都要认",
  },
  {
    id: "needle-cause-two-states-merged",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-needles-check.test.ts",
    desc: "「git 没答上来」与「这段文字从未在该路径出现过」合成一句 ⇒ 查询坏了会被读成「这条锚点从写下起就没生效过」，而那是两种要办不同事的结论",
    apply: (s) => s.replace('  if (cause === undefined) return " ｜成因未取（git 查不到 ⇒ 不等于没人搬走）";', '  if (cause === undefined) return " ｜这段文字在该路径的历史里从未出现 ⇒ 表写错路径，或这条锚点从写下起就没生效过";'),
    expectFail: "三态分开印，且「没查到」不许被压成「查到没人搬走」",
  },
  {
    id: "needle-cause-printed-for-warn-hits",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-needles-check.test.ts",
    desc: "去掉「只有 hits===0 才谈成因」那道守卫 ⇒ 多处命中的针脚（还活着）也被冠上「谁搬走的」，读的人去查一段根本没消失的代码",
    apply: (s) => s.replace('  if (p.hits !== 0) return "";\n  if (cause === undefined)', '  if (p.hits === -2) return "";\n  if (cause === undefined)'),
    expectFail: "只有 hits===0 才谈成因：warn（多处命中）的针脚还在盘上，查归属只会误导",
  },
  {
    id: "needle-cause-queries-git-for-every-problem",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-needles-check.test.ts",
    desc: "取成因那一侧也不判 hits ⇒ 每条 warn 都发一次 pickaxe：这道门的存在理由就是「秒级」（整跑 36 分钟才是慢的那把），代价先炸给自己",
    apply: (s) => s.replace('  if (p.hits !== 0) return undefined; // 只谈"整段没了"；warn 档的针脚还在盘上', '  // 守卫被摘：每条问题都查'),
    expectFail: "成因取法本身可测：三态由注入的 git 决定（本模块不许自己 spawn 子进程）",
  },
  {
    id: "pointer-audit-treats-unreadable-file-as-fine",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "判卷文件读不到时不报 ⇒ 「指针没问题」被从「没查到」偷来（规则 92/210：三态里最贵的是把未查证说成通过）",
    apply: (s) => s.replace('if (text === null || text === undefined) out.push({ id: e.id, test: e.test, expectFail: e.expectFail, why: "unreadable" });', "if (text === null || text === undefined) continue;"),
    expectFail: "判卷文件读不到 ⇒ unreadable，不许当「指针没问题」（规则 92/210 那一族）",
  },
  {
    id: "pointer-audit-recognizes-anything",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "标题匹配那一支被摘成恒假 ⇒ 「拼出来的标题 / 带转义引号的标题」全被判成指针失效：假红一多，人们关的是门不是修尺（ runner 自己判的是「输出含这段」，运行时它是活的）",
    apply: (s) => s.replace("return vitestTitlePatterns(sourceText).some((re) => re.test(expectFail));", "return false;"),
    expectFail: "带转义引号的标题不许误报（表里存解码值，盘上是源码文字）",
  },
  {
    id: "pointer-vacuous-title-kept",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "整条都是占位符的生成式标题不丢 ⇒ 它编译成一条匹配任何输入的模式，压在那份判卷文件上的**全部**指针体检一起恒真。" +
      "真盘现场：241 个判卷文件里 2 个含这种标题（其中一个的成因是它自己的 fixture 生成器里那段「it( 双引号 美元花括号 t 花括号 」的文字，" +
      "正则取料分不清真标题与字符串里长得像标题的东西），上面 33 条锚点因此缴械；" +
      "本轮那条「四支／六支」死指针正是靠这个洞活到 21 分钟实跑才喊（修法见第 152 页）",
    apply: (s) => s.replace('if (literalOf(body) === "") return null;', "if (false) return null;"),
    expectFail: "生成式标题不许把整份判卷的体检缴械：指向不存在用例的指针仍要报 not-found",
  },
  {
    id: "pointer-vacuous-title-not-trimmed",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "丢的时候不 trim ⇒ 只剩空白的生成式标题（占位符两侧只有空格）仍被当成有字面残迹，恒真模式换个写法就回来了。" +
      "与上一条分开钉：去掉这一位，上面那条用例照样绿（它的残迹是空串），所以这一格没有别的见证。" +
      "针脚只取「join 空串再 trim」那半截、不写整行：整行会带上 split( 字样，被 isLineWiseApply 误认成逐行式而躲过针脚体检（第 152 页实测）",
    apply: (s) => s.replace('.join("").trim();', '.join("");'),
    expectFail: "变体：标题里除了占位符只剩空白 ⇒ 同样缴械，也要丢（不 trim 就漏这一格）",
  },
  {
    id: "pointer-all-dynamic-titles-dropped",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "过修那一侧：把**任何**含占位符的标题都丢掉 ⇒ 参数化标题再也指不到（渲染后的文字盘上本来就没有），" +
      "第 138 页校准出来的那两条（拼出来的标题／带转义引号的标题）一起变假红——假红一多，人关的是门不是修尺",
    apply: (s) => s.replace('if (literalOf(body) === "") return null;', "if (PLACEHOLDER.test(un)) return null;"),
    expectFail: "过修的反面：带字面残迹的标题要**留着**通配（参数化标题仍然认得渲染后的样子）",
  },
  {
    id: "loose-pointer-blind",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "松钉那一格永远数出 0 ⇒ 门照样印「松钉指针 0 条」，看起来比今天更干净，" +
      "而拼接标题／带转义引号那两类指针从此无人知道它们是松的（这一格的用处就是「有读数」，不是阻断）",
    apply: (s) => s.replace("if (!text.includes(e.expectFail) && expectFailMatchesTitles(e.expectFail, text)) out.push(e.id);", "if (false) out.push(e.id);"),
    expectFail: "松钉要单独点名：拼接标题与带转义引号两类算松钉，逐字命中的不算，真断的也不算（那是 not-found）",
  },
  {
    id: "loose-pointer-counts-literal",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "漏掉「逐字认不出」这一半条件 ⇒ 每一根正常指针都被算成松钉（现读 10 变 872），" +
      "水位帽当场失效之外更糟：这个数字不再有意义，读的人据它判断「这表几乎全是松钉」而放弃这一格",
    apply: (s) => s.replace("if (!text.includes(e.expectFail) && expectFailMatchesTitles(e.expectFail, text)) out.push(e.id);", "if (expectFailMatchesTitles(e.expectFail, text)) out.push(e.id);"),
    expectFail: "水位：真表现读松钉只准调低（帽 10，09-27 现读 10）——新增一根要写明为什么",
  },
  // ── 第 161 页 · 认证树的锁：占不到就不动树（任务 #29）
  // 这一组的判卷**真跑子进程**（`--tree=/dev/null/…` 那棵必然建不起来），所以前四条的"杀死"来自行为而不是文字：
  // 拒跑那一支被拆掉后，输出里会出现 `worktree add exit=`＝它已经动过树了。
  {
    id: "cert-lock-held-not-refused",
    src: "scripts/lib/tool-lock.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "读到「别人活着占着」却不拒 ⇒ 照旧切树：这把锁退回第 155/160 页那格「事后才发现撞窗」的读数，共享写点还是没人守（第 163 页：过程收进 lib，这一针现在同时守着 head-cert 与 mutate-verify 两个消费者）",
    apply: (s) => s.replace(
      'if (decision.kind === "held") {',
      'if (decision.kind === "held" && false) {',
    ),
    expectFail: "锁被活人占着 ⇒ exit 2、点名是谁、**没走到切树**，并且不替别人删锁",
  },
  {
    id: "cert-lock-unreadable-silently-overwritten",
    src: "scripts/lib/tool-lock.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "读不出的锁被当「没人占」覆盖（第三态被吞）⇒ 正有人用时一把抢走，而且抢的痕迹只剩一行日志。这条第一版**活过一次**：`exit=2` ＋「点名锁文件路径」那对读数两支拒跑都给 ⇒ 拆掉这一支仍然全绿，判卷要钉本支自己的措辞（规则 233 的零分辨力那一类）",
    apply: (s) => s.replace(
      'if (decision.kind === "unreadable") {',
      'if (decision.kind === "unreadable" && false) {',
    ),
    expectFail: "锁文件读不出 ⇒ exit 2、点名是哪把锁，也不许冒领「被别人占走」那一支的措辞",
  },
  {
    id: "cert-lock-stale-not-unlinked",
    src: "scripts/lib/tool-lock.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "判定可回收却不先摘旧锁 ⇒ 下面那次 `link` 必 EEXIST：崩溃残留永远回收不了，而报错写的是「被别人占走」＝把自己的坑说成别人的（09-27 现跑第一次就撞在这格）",
    apply: (s) => s.replace(
      "try { unlinkSync(lockPath); } catch { /* 别人先摘了也算回收成功 */ }",
      "// 摘旧锁这一步被删了",
    ),
    expectFail: "陈旧锁（pid 已死）⇒ 出声回收并**继续**：不先摘旧锁，抢占那次 link 必 EEXIST＝陈旧锁永远回收不了",
  },
  {
    id: "cert-lock-reclaim-branch-silent",
    src: "scripts/lib/tool-lock.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "回收那一支整支不认（既不印原因也不摘锁）⇒ 自愈还在、读的人却不知道锁被换过手，出事后无从回溯是谁摘的",
    apply: (s) => s.replace(
      'if (decision.kind === "reclaim") {',
      'if (decision.kind === "reclaim" && false) {',
    ),
    expectFail: "陈旧锁（pid 已死）⇒ 出声回收并**继续**：不先摘旧锁，抢占那次 link 必 EEXIST＝陈旧锁永远回收不了",
  },
  {
    id: "cert-lock-alive-always-true",
    src: "scripts/lib/tool-lock.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "探活写成「永远活着」⇒ 崩溃残留要等满帽才回收；一次崩溃之后这道门连续红半小时，而下一个人只会去删文件、不会知道锁在骗人",
    apply: (s) => s.replace(
      "selfPid: process.pid, alive: pidAlive });",
      "selfPid: process.pid, alive: () => true });",
    ),
    expectFail: "陈旧锁（pid 已死）⇒ 出声回收并**继续**：不先摘旧锁，抢占那次 link 必 EEXIST＝陈旧锁永远回收不了",
  },
  {
    id: "cert-lock-release-not-by-identity",
    src: "scripts/lib/tool-lock.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "放锁不认身份（这里换成一个不存在的 pid＝只放别人的不放自己的）⇒ 残留累积成「每次都要先删锁」，而这道门的自愈一旦靠帽，撞窗保护就整段失效（同 `mutate-verify` 的备份身份复核那条纪律）",
    apply: (s) => s.replace(
      "if (shouldReleaseLock(now, process.pid)) {",
      "if (shouldReleaseLock(now, 999_999)) {",
    ),
    expectFail: "反向哨兵：没有锁文件 ⇒ 不许以「锁面不存在」为由拒跑，照常走到切树那一步",
  },
  {
    id: "cert-lock-path-segments-swapped",
    src: "scripts/lib/tool-lock.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "拼锁路径时把 common dir 与目录名调换 ⇒ 路径看着还行、实际落在 `<root>/dsh-cert-locks/.git/…`，每次都在新建的目录里「独占」，别人永远看不见（与 `join` 拼绝对 common dir 同一格：接线读的是错位置）",
    apply: (s) => s.replace(
      'return resolve(root, common, LOCK_DIR_NAME, leaf + ".lock");',
      'return resolve(root, LOCK_DIR_NAME, common, leaf + ".lock");',
    ),
    expectFail: "锁路径：相对 .git 与 linked worktree 的绝对 common dir 必须各自落在**它自己**那一份上",
  },
  {
    id: "cert-lock-pid-zero-accepted",
    src: "scripts/lib/tool-lock.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "只核 typeof pid 是不是数字、不核正负 ⇒ pid 0 也被当持有者：探活对 0 恒真（POSIX 里那是「发信号给整个进程组」），一把坏锁能把这道门永久钉死",
    apply: (s) => s.replace(
      'if (typeof o.pid !== "number" || !Number.isInteger(o.pid) || o.pid <= 0) return null;',
      'if (typeof o.pid !== "number" || !Number.isInteger(o.pid)) return null;',
    ),
    expectFail: "parseToolLock 不许猜 pid：缺字段／pid 不是正整数一律 null（猜出来的 pid 会把活人的锁抢走）",
  },
  {
    id: "mutate-flag-registry-drops-lock-tag",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "脚本读了 `--lock-tag` 而登记表里漏它 ⇒ 带标签的命令被「未知即拒」当场拦下，判卷自己撞死在这道闸上（登记与读取双向对得上：cert 侧那条闸在这里的配对）",
    apply: (s) => s.replace(
      '\nexport const MUTATE_VALUE_FLAGS = ["--budget-ms", "--changed-since", "--lock-tag"] as const;',
      '\nexport const MUTATE_VALUE_FLAGS = ["--budget-ms", "--changed-since"] as const;',
    ),
    expectFail: "`--lock-tag` 两种写法都认、值不进 targets，而隔壁拼错的 `--lock-tx=` 照拒",
  },
  {
    id: "lock-tmp-opened-without-wx",
    src: "scripts/lib/tool-lock.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "临时名不带 `wx` ⇒ 同名文件已存在时这次写会**跟随**它（含符号链接）写到别处去：最小权限那条「只写自己新起的名字」。第 166 页之前这条只有结构钉（判卷读源码里那对花括号），摘掉 wx 之后代码照样跑到下一步、现场看不出来；现在它咬的是行为证人——链接那头被动了一个字节就红",
    apply: (s) => s.replace(
      'const WX: { flag: string } = { flag: "wx" };',
      'const WX: { flag: string } = {}; // 丢掉 wx：缺省写法会跟随已存在的同名文件',
    ),
    expectFail: "临时名上已有一个指向别处的符号链接 ⇒ 链接那头一个字节不许被动，而锁照样占到",
  },
  {
    id: "lock-tmp-eexist-retry-dropped",
    src: "scripts/lib/tool-lock.ts",
    test: "tests/head-cert-deps.test.ts",
    desc: "EEXIST 那一支不再「摘掉重写一次」而是直接抛 ⇒ 上一轮自己留的残骸（名字里就是本进程 pid）把整道门砸死，读起来像抢锁失败。与上一条各咬一支：摘 wx 时这条仍绿（没有 EEXIST 可触发），砸重用时那条也红但归因在这条的标题上（规则 226：同一处两道闸要给各自看得见的输入）",
    apply: (s) => s.replace(
      'if (String((e as NodeJS.ErrnoException).code) !== "EEXIST") throw e;',
      'if (true) throw e; // 把同名残骸当成不可恢复的失败',
    ),
    expectFail: "临时名上是上一轮自己留的普通残骸 ⇒ 摘掉重写一次就占到，不许把整道门砸了",
  },
  {
    id: "changed-since-picks-only-src-face",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "只认被测源这一面 ⇒ 别人改了判卷文件（取料面／标题／断言都算）时派生名单是空的，这条手段正好在它最该出声的那一半上沉默（规则 208 的两半）",
    apply: (s) => s.replace(
      "  const ids = entries.filter((e) => changed.has(e.src) || (e.test !== undefined && changed.has(e.test))).map((e) => e.id);",
      "  const ids = entries.filter((e) => changed.has(e.src)).map((e) => e.id);",
    ),
    expectFail: "改被测源 ⇒ 选中；改判卷文件 ⇒ 也要选中（只认一头＝另一半搬家没人知道）",
  },
  {
    id: "changed-since-total-reported-as-picked",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "分母写成分支自身的长度 ⇒ 印出来永远是「选中 N/N」：选中 0 条也长成「全部验过」的样子（规则 222 那条「0 命中有两条假绿路」在这里的第三种）",
    apply: (s) => s.replace(
      "  return { ids, faceCount: changed.size, pickedCount: ids.length, total: entries.length };",
      "  return { ids, faceCount: changed.size, pickedCount: ids.length, total: ids.length };",
    ),
    expectFail: "两面都不在改动面 ⇒ 一条不选，但把「表多大／面多大」一起交回去（0 条要能被分诊）",
  },
  {
    id: "changed-since-empty-path-counted-as-file",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "git 每行输出尾部那个换行被当成一个文件 ⇒ 改动面分母虚增，而「面 3 个文件、选中 0 条」与「面 2 个、选中 0 条」是两种解释（读数被自己的取料污染）",
    apply: (s) => s.replace(
      '  const changed = new Set(changedPaths.filter((p) => p !== ""));',
      "  const changed = new Set(changedPaths);",
    ),
    expectFail: "git 输出的尾换行不算一个文件；同一锚点两面都改也只选一次",
  },
  {
    id: "changed-since-eq-form-whitens-any-flag",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "为支持 `--flag=值` 而把「带 = 的都放行」⇒ `--list=…`、`--budget-ms=600000` 一起被放过，后者更坏：读取器只认空格写法，给了值却按「不限」跑（静默按缺省，正是这张表开头拒的那类）",
    apply: (s) => s.replace(
      "  return eq > 0 && (MUTATE_EQ_VALUE_FLAGS as readonly string[]).includes(arg.slice(0, eq));",
      "  return eq > 0;",
    ),
    expectFail: "两条反向哨兵：不带值的 flag 硬塞值照样拒；`--budget-ms=600000` 刻意**不**放行",
  },
  // ── 第 167 页 · 成本分母（任务 #37）：每条锚点实际付了几次判卷，必须是读数而不是「次数 × 单价」的模型
  // 六条各咬一处：算错分桶／把「没量」说成 0 秒／撤掉缺项守卫／没跑的条不单列／汇总不真吃账本／时间根本没记。
  {
    id: "cost-nth-samples-pooled-into-one-median",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "把第 1／2／3 拍的中位混成一个平均 ⇒ #37 要量的那个结构（第一拍多付 vite 冷启动、后面几拍复用盘上转换缓存）被抹平，成本又只能靠推",
    apply: (s) => s.replace(
      "medianByNth: [...byNth].sort((a, b) => a[0] - b[0]).map(([idx, vals]) => ({ nth: idx + 1, medianMs: medianOf(vals) })),",
      "medianByNth: [{ nth: 1, medianMs: medianOf(lists.flatMap((l) => l.runs)) }],",
    ),
    expectFail: "早退路径按实际 spawn 次数分桶，且第 1 次与第 2、3 次的中位分开求（第一拍付 vite 冷启动）",
  },
  {
    id: "cost-cell-zero-spawns-printed-as-measured",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "零 spawn 那一支不再走「没有分母」的措辞 ⇒ 一把只能印 0 的尺：把「这次一条没量」洗成「每条 0 秒」（第 166 页那把尺换了载体，同一族）",
    apply: (s) => s.replace("  if (r.spawns === 0) {", "  if (false) {"),
    expectFail: "一次判卷都没 spawn ⇒ 那一格印「没有分母」，不许长得像「每条 0 秒」",
  },
  {
    id: "cost-rollup-tolerates-missing-runs",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "账本缺行不再当场崩而是继续汇总 ⇒ 那条锚点的花费被静默读成 0 次，分母变小、单价看起来更便宜（`.mjs` 没有编译期信号，本文件的做法是崩并点名）",
    apply: (s) => s.replace("  if (unaccounted.length > 0) {", "  if (false) {"),
    expectFail: "账本里缺 runsMs 的行当场崩并点名第几行（接线漏计在 .mjs 里没有编译期信号）",
  },
  {
    id: "cost-never-ran-not-counted",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "没跑的条不再计数 ⇒ 预检跳过／预算用尽那些从句尾消失，「没量到」与「量了且很快」合一（与上面那条各咬一处：那条是措辞，这条是取数）",
    apply: (s) => s.replace("    if (runs.length === 0) neverRan += 1;", "    // 不再单列没跑的条：缺席即视为 0"),
    expectFail: "没跑的条要单列在句尾（并进平均值就是把「没量到」读成「跑得很快」）",
  },
  // ── 第 169 页 · 选择子唯一性（`-t` 精确跑法的前置闸）：四条各咬一处——不报／三态合一／分母／接线
  {
    id: "selector-ambiguity-never-reports",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "命中数不为 1 时不再记录 ⇒ 这一格永远印「全部可选」，真正选不中的那些会在改跑法时被当成能走 -t；而 0 命中不是失败，是 vitest 一条也没跑，基线与突变两拍都白过",
    apply: (s) => s.replace(
      "if (hits !== 1) {",
      "if (false) {",
    ),
    expectFail: "可选率的分母是被数过的条数，不是整表条数（拿整表去除＝把选不中的洗成可选）",
  },
  {
    id: "selector-cell-merges-zero-into-clean",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "零命中不再单独数 ⇒「选不中」并进「没什么问题」，那句 0 会被读成「11 条都正常」（第 166 页那把只能印 0 的尺，同一族换了载体）",
    apply: (s) => s.replace(
      "const zero = problems.filter((p) => p.hits === 0);",
      "const zero: SelectorProblem[] = [];",
    ),
    expectFail: "零命中与多命中分开印，并点名是哪几条（0 命中＝-t 会一条也没跑）",
  },
  {
    id: "selector-inspected-counts-unreadable-judges",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "判卷读不到／指针为空那些条也计入分母 ⇒ 可选率虚高，而「取料坏」被洗成「量过了」（规则 222 的三态：未取 ≠ 空面 ≠ 零命中）",
    apply: (s) => s.replace(
      "if (face === null || face === undefined) { unreadable.push(e.id); continue; }",
      "inspected += 1;",
    ),
    expectFail: "只数被数过的：判卷读不到／指针为空／不是 vitest 文件都不进 inspected",
  },
  {
    id: "selector-blind-file-not-tracked",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "「文件读得到、却一条标题都抽不到」这一态不记账（回到旧实现：与「这文件没锚点问题」同形）⇒ "+
      "抽取器对整份判卷瞎时，普查少一条而读数一个字不说（第 230 页的真仓成因：这一格曾另抄一份只认 it 紧跟引号的窄正则，" +
      "it.each 的标题在它眼里不存在；规则 261/262）",
    apply: (s) => s.replace(
      "      const hit = blindByTest.get(e.test);\n      if (hit) hit.push(e.id);\n      else blindByTest.set(e.test, [e.id]);\n      continue;",
      "      continue;",
    ),
    expectFail: "读得到文件却一条标题都抽不到 ⇒ 第三态要点名（并进「没问题」＝整份判卷被读瞎也无人说）",
  },
  {
    id: "selector-hits-rendered-title-selectable",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "把占位符标题的展开态当「选不中」⇒ 指针本来就等于渲染后那一条、`-t` 恰好选中它，却被判去走整文件跑法" +
      "（单价是 `-t` 的几十倍，第 168/170 页实测）。第 230 页这一格的宽度对齐的是 runner，不是盘上的字节",
    apply: (s) => s.replace("if (re !== null && re.test(pointer)) n += 1;", "if (false) n += 1;"),
    expectFail: "标题是拼出来的（it.each 的 %s）不算选不中：-t 拿渲染后的整条恰好选中一条（第 230 页）",
  },
  {
    id: "selector-hits-template-prefix-not-unique",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "指针只落在模板标题的字面段里就记 1 条 ⇒ 发「唯一命中」的身份给一条会选中全部参数行的选择子" +
      "（`it.each` 的一条标题代表 N 条渲染；并集读数不能当「每一处都成立」的证人，规则 248/255）",
    apply: (s) => s.replace(
      "else if (t.includes(pointer) || unescapeTitle(t).includes(pointer)) n += 2;",
      "else if (t.includes(pointer) || unescapeTitle(t).includes(pointer)) n += 1;",
    ),
    expectFail: "标题是拼出来的（it.each 的 %s）不算选不中：-t 拿渲染后的整条恰好选中一条（第 230 页）",
  },
  {
    id: "selector-hits-plain-title-dropped",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "不带占位符的那一支不计数 ⇒ 模板那条与字面那条同名的判卷只剩 1 条命中，重名这条锚点重新领到「唯一」——" +
      "而 `-t` 那时一次选中两条，红的是哪条说不清",
    apply: (s) => s.replace(
      "if (t.includes(pointer) || unescapeTitle(t).includes(pointer)) n += 1;",
      "if (false) n += 1;",
    ),
    expectFail: "放宽宽度不放过重名：模板那条与字面那条都在同一份判卷里 ⇒ 仍报多命中（并集证人不算守护）",
  },
  {
    id: "selector-extraction-not-shared",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "选择子这一格不走共用的 `vitestTitles` 而是自己给一份标题面 ⇒ 与 `expectFailMatchesTitles` 那把尺说的不是同一件事，" +
      "「整片读不到标题」重新变成尺的瞎而不是盘上没标题（第 230 页收掉的正是这份私有窄抽取，第十三族）",
    apply: (s) => s.replace(
      "cache.set(e.test, text === null ? null : { text, titles: vitestTitles(text) });",
      "cache.set(e.test, text === null ? null : { text, titles: [] });",
    ),
    expectFail: "读得到文件却一条标题都抽不到 ⇒ 第三态要点名（并进「没问题」＝整份判卷被读瞎也无人说）",
  },
  {
    id: "selector-zero-cause-fed-titles-only",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "成因那一格只喂标题面（或不喂文字）⇒ `describe` 与循环变量两种成因永远分不出来，" +
      "读数只能继续把两条好端端的指针说成「多半是用例改了名」（第 233 页实测：它们运行时分别选中 2 条与 1 条）",
    apply: (s) => s.replace(
      "        ? { id: e.id, test: e.test, hits, cause: zeroHitCause(e.expectFail, face.text) }",
      "        ? { id: e.id, test: e.test, hits, cause: zeroHitCause(e.expectFail, \"\") }",
    ),
    expectFail: "零命中分四种成因、各印各的数（0 也印）——从前那句「多半是用例改了名」是在指责任人",
  },
  {
    id: "selector-zero-cause-hides-empty-rows",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "只印非零那几档 ⇒ 「说不清 0」这一档消失，将来多出一条分不出成因的锚点时，这一格看起来和今天一模一样" +
      "（数量不列印＝那一格没有观测者，规则 210；与「三态分开印」239 同一口径）",
    apply: (s) => s.replace(
      'return causes.map((c) => `${ZERO_CAUSE_LABELS[c]} ${String(counts.get(c) ?? 0)}`).join("｜");',
      'return causes.filter((c) => (counts.get(c) ?? 0) > 0).map((c) => `${ZERO_CAUSE_LABELS[c]} ${String(counts.get(c) ?? 0)}`).join("｜");',
    ),
    expectFail: "零命中分四种成因、各印各的数（0 也印）——从前那句「多半是用例改了名」是在指责任人",
  },
  {
    id: "selector-describe-face-not-read",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "不读 `describe` 标题面 ⇒ 指针写在支上的那类被归到「标题由变量给出」或「文件里没这句话」，" +
      "而它的真问题是**这条选择子会选中该支全部用例**（修法是把指针收到具体那条用例上，不是改标题）",
    apply: (s) => s.replace(
      "const descs = describeTitles(sourceText);",
      "const descs: string[] = [];",
    ),
    expectFail: "零命中分四种成因、各印各的数（0 也印）——从前那句「多半是用例改了名」是在指责任人",
  },
  // ── 第 236 页 · id 名单要分桶挂标签：并排印在整行末尾会把唯一的零命中条指成「多命中」的一员
  {
    id: "selector-bucket-list-not-appended",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "多命中那一段不挂自己的名单 ⇒ 名单只剩零命中那半，读的人永远看不到「哪两条重名」。" +
      "这一格从前是有名单的（两个桶并排印在行末），所以本条钉的是退化：把两种坏读数当成一种",
    apply: (s) => s.replace(
      '    many.length === 0 ? "" : `多命中 ${String(many.length)} 条（选择子不唯一）` + selectorBucketList(many),',
      '    many.length === 0 ? "" : `多命中 ${String(many.length)} 条（选择子不唯一）`,',
    ),
    expectFail: "id 名单要挂在各自的桶名下：并排印在行末＝把唯一的零命中条指成「多命中」的一员",
  },
  {
    id: "selector-bucket-lists-swapped",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "零命中那一段挂上多命中的名单 ⇒ 名单还在、责任人换了：读的人会把「-t 一条也选不中」那两条去改用例名，" +
      "而真该改的是那条重名指针（两种坏读数修法相反，所以桶名与名单必须一起挂，规则 261/262）",
    apply: (s) => s.replace(
      "走整文件跑法）` + selectorBucketList(zero),",
      "走整文件跑法）` + selectorBucketList(many),",
    ),
    expectFail: "id 名单要挂在各自的桶名下：并排印在行末＝把唯一的零命中条指成「多命中」的一员",
  },
  {
    id: "selector-cell-hides-blind-count",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "取料记了、措辞却不印那一格 ⇒ 第三态又变回静默（读数与数据分家是本仓点名的假绿形状；"+
      "本条与上一条分开钉：一条管「记没记」，一条管「说没说」）",
    apply: (s) => s.replace(
      "读得到文件却一条标题都抽不到 ${String(blind.reduce((n, b) => n + b.ids.length, 0))}**",
      "读得到文件却一条标题都抽不到 0**",
    ),
    expectFail: "读得到文件却一条标题都抽不到 ⇒ 第三态要点名（并进「没问题」＝整份判卷被读瞎也无人说）",
  },
  // ── 第 170 页 · 按标题选跑法（`-t`）：六条各咬一处——取料坏当 0／把 skipped 当跑过／不转义／共存支／闸门／空格子
  {
    id: "selected-count-treats-missing-summary-as-zero",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "收尾行读不到时回 0 ⇒「这格没量到」与「一条也没选中」合一，两种红的修法相反（前者是取料坏，后者是锚点失效）。第 166 页同一族：0 不许冒充读数",
    apply: (s) => s.replace("  if (line === undefined) return null;", "  if (line === undefined) return 0;"),
    expectFail: "选中条数只从 vitest 真实的收尾行读，两种实测形状给两个数；读不到那行是 null 不是 0",
  },
  {
    id: "selected-count-counts-skipped-as-run",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "把 skipped 也算进「选中几条」⇒ `-t` 一条没选中的那一拍被读成测过了（实测：`Tests 100 skipped (100)`＋退出码 0）。与上一条共用那条判卷用例：同一个谓词的两种失真，各自要一条变异才咬得住（规则 226）",
    apply: (s) => s.replace("  return total - skipped;", "  return total;"),
    expectFail: "选中条数只从 vitest 真实的收尾行读，两种实测形状给两个数；读不到那行是 null 不是 0",
  },
  {
    id: "selector-predicate-accepts-multi",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "selector 那一支从「恰好 1 条」放宽成「只否 0 条与没读到」⇒ 闸与单价格都还在，只是多选的那条永远不出声（放宽分级必须配反向锚点，规则 227）",
    apply: (s) => s.replace(
      '  if (mode === "selector") return selected !== 1;',
      '  if (mode === "selector") return selected === null || selected === 0;',
    ),
    expectFail: "读数闸的判据只有一份：selector 那一拍恰好选中 1 条才算合格，0 条／多条／没读到三种都判坏",
  },
  {
    id: "vacuous-line-merges-empty-into-unreadable",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "把「0 条＝空跑」印成「取料坏」⇒ 两种红的修法相反却被读成同一种（第 166 页那把只能印 0 的尺，同一族换了载体）；判卷要三种措辞互不冒领",
    apply: (s) => s.replace(
      '      ? "0 条用例＝这一拍什么都没测"',
      '      ? "未取到（收尾行没读到＝取料坏）"',
    ),
    expectFail: "三种坏读数印三种不同措辞：取料坏／一条没选中／选中多条，两两不许相同",
  },
  {
    id: "run-mode-cell-silent-when-no-spawns",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "没有 spawn 时那一格不再说「没有分母」而是印出空串 ⇒ 读数缺席被读成「本次不需要成本」（第 163 页 --list 那一格的同一族）",
    apply: (s) => s.replace(
      '  if (rows.length === 0) return "跑法单价：本次没有 spawn ⇒ 这一格没有分母";',
      '  if (false) return "跑法单价：本次没有 spawn ⇒ 这一格没有分母";',
    ),
    expectFail: "跑法单价那一格分开印两种跑法，并把两种跑法各自的「坏拍」数出来——省了多少由它说，不许推算",
  },
  {
    id: "unverified-total-counted-separately",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "未证的总数另起一个口径数（少算一类）⇒ 名单摆着 7 条、汇总只报 5 条，读的人按 5 条决定补跑多少，剩下两条永远不会有人碰。" +
      "第 168 页那句「计数由名单求和」落到这一格才算接线（规则 209/225：两个口径各写一遍必有一处先漂）",
    apply: (s) => s.replace(
      '  const total = rows.length; // 计数＝名单长度之和，同源；不许另起一个 filter 再数一遍\n  const parts: string[] = [];',
      '  const total = rows.filter((x) => x.cls !== "src-in-flight").length;\n  const parts: string[] = [];',
    ),
    expectFail: "未证四类各印各的名单，总数等于名单长度之和",
  },
  {
    id: "run-mode-cell-drops-absent-mode",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "跑法单价只遍历这一趟出现过的模式 ⇒ 另一种跑法 0 拍时整支从行里消失，「这一支没拍到」被读成「这一支不需要成本」" +
      "（09-28 实测：补跑那 30 条全是 selector 拍，whole 那一支整个不见，而汇总行照样印得整齐）。" +
      "全局零 spawn 那格早有兜底，欠的是**子列**这一格（规则 245/241 同族）",
    apply: (s) => s.replace(
      '  const modes: Array<"selector" | "whole"> = ["selector", "whole"];\n  const parts = modes.map((mode) => {',
      '  const modes = [...new Set(rows.map((r) => r.mode))].sort();\n  const parts = modes.map((mode) => {',
    ),
    expectFail: "两种跑法定长列印：这一趟只拍到一种，另一种也要印出没有分母而不是整支消失",
  },
  {
    id: "restore-diff-problem-only-compares-length",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "只比长度不比内容 ⇒ 等长那类突变被原样留在盘上（现读：可解析出两个字面量的 947 对 apply 里有 11 对是等长替换），" +
      "还原检查当场变成恒真，而它正是省下第三次 spawn 所换来的那份更强证据",
    apply: (s) => s.replace(
      '  if (before === after) return null;',
      '  if (before.length === after.length) return null;',
    ),
    expectFail: "字节相同＝到位；长度不同与等长不同要各点名自己的那一格",
  },
  {
    id: "red-kind-guard-silently-skips",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "把「认不出类别就崩」那一格摘掉 ⇒ 没归类的判红不进任何一类却仍算进总数，分类名单读起来比实际少，" +
      "而最贵的「存活」恰恰是最容易被漏掉的那一类（规则 245：把「没记账」读成「记了 0 次」会让分母看起来更干净）",
    apply: (s) => s.replace(
      '    const k = r.kind;\n    if (k === undefined || !FAIL_KINDS.includes(k)) {',
      '    const k = r.kind;\n    if (false) {',
    ),
    expectFail: "判红缺类别／认不出的类别当场崩并点名第几条",
  },
  {
    id: "triage-ignores-structured-kinds-line",
    src: "scripts/lib/mutation-rerun-triage.ts",
    test: "tests/mutation-rerun-triage.test.ts",
    desc: "下游不读 `REDKINDS=` 那一行、只回头猜散文 ⇒ runner 在出口定好类别这件事白做，" +
      "改一句给人看的文案就让归因静默降级（规则 205/213：同一谓词不许两份副本，宽度还各不一样）",
    apply: (s) => s.replace(
      '  const kinds = redKindsOf(stdout);\n  if (kinds !== null) {',
      '  const kinds = null;\n  if (kinds !== null) {',
    ),
    expectFail: "REDKINDS 在场就直接认类别，不再回头猜散文",
  },
  // ── 第 211 页：主检出树闸的两名变异证人（待办 #8 结案：判卷早就齐，缺的是锚点）
  // 两条分钉两半：`mutateTreeGuard` 的判据（git-dir vs common-dir 同指＝主检出），与「判据的结论真的接在退出码上」。
  // 后一条是本仓最贵那一族（门装了不锁）：判卷那五处断言认的是 stderr 里的句子，
  // 把 `if (TREE.kind === "refused")` 摘掉，句子就再也不出现——只有真跑那支能看见，所以必须有一条机器证人。
  {
    id: "tree-guard-main-checkout-accepted",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "「git-dir 与 git-common-dir 同指一处＝主检出」这条判据摘掉 ⇒ 就地改源文件的门可以在用户工作树上跑，" +
      "被外层超时杀掉就留下一地突变体与 .mutbak（这道闸存在的全部理由）。" +
      "针脚钉判据本身而不是钉「主检出」三字：那个词在两条无关错误消息里也各有一次，钉它等于没钉",
    apply: (s) => s.replace("  if (resolve(input.root, g) === resolve(input.root, c)) {", "  if (false) {"),
    expectFail: "主检出拒跑、linked worktree 放行——两支只差一个维度，结论换人",
  },
  {
    id: "pack-degraded-state-collapsed",
    src: "scripts/lib/shard-plan.ts",
    test: "tests/mutate-shards.test.ts",
    desc: "把「给了来源却抽出 0 条」与「根本没给来源」并回一态（`sources === 0` 恒真）⇒ 装箱静默退回按条数，" +
      "而读数同一行末尾还写着 `源=--cost-logs`，两句互相抵消。这不是假想：09-30 我两次把编排器汇总页当分片原文喂进去，" +
      "两趟整表都是在这种情况下跑的，机器自己只印了「没有权重来源」——规则 261（读不到与没有问题不许同形）的现行样本。" +
      "另一半（编排器把显式来源数传给这一格）由 pack-sources-count-not-wired 各咬一条不同用例",
    apply: (s) => s.replace("sources === 0", "sources >= 0"),
    expectFail: "「给了文件但抽出 0 条」不能与「没给」同形——这是我自己两次踩到的退化路径",
  },
  {
    id: "shard-plan-empty-shards-allowed",
    src: "scripts/lib/shard-plan.ts",
    test: "tests/mutate-shards.test.ts",
    desc: "片数按**请求的片数**开而不是按 min(片数, 宿主数) ⇒ 条数少于片数时造出空片，" +
      "空片会被并进「这一片跑了 0 条且判定已杀死」那格——读者以为整表都验过（三态里「没尺」被读成 0，规则 239）",
    apply: (s) => s.replace(
      "const out: string[][] = Array.from({ length: k }, () => []);",
      "const out: string[][] = Array.from({ length: shards }, () => []);",
    ),
    expectFail: "片数上限由宿主数决定而不是由请求的片数决定（不造空片）",
  },
  {
    id: "shard-plan-missing-hardcoded",
    src: "scripts/lib/shard-plan.ts",
    test: "tests/mutate-shards.test.ts",
    desc: "分片自检里 missing 写成常数空数组 ⇒ 「漏跑」这一格永远绿，而「不重不漏」这句话仍然印得出来。" +
      "漏跑是这一层最坏的读数形状：四份日志合起来比表短，读者以为整表跑过",
    apply: (s) => s.replace("    missing: input.filter((it) => !seen.has(it)),", "    missing: [],"),
    expectFail: "少给一条要在 missing 里现身",
  },
  {
    id: "shard-merge-unreadable-as-killed",
    src: "scripts/lib/shard-plan.ts",
    test: "tests/mutate-shards.test.ts",
    desc: "合并时把「读不出」也计入 killedTotal ⇒ 崩掉的那一片被当成跑完且全绿；" +
      "byVerdict 里那一列照印，所以只有拿总数去核对的读者会中招（规则 211：半把尺与没尺要各自看得见）",
    apply: (s) => s.replace(
      'if (r.verdict === "已杀死") killedTotal += r.given;',
      'if (r.verdict === "已杀死" || r.verdict === "读不出") killedTotal += r.given;',
    ),
    expectFail: "不并进「已杀死」的条数",
  },
  {
    id: "shard-merge-empty-table-green",
    src: "scripts/lib/shard-plan.ts",
    test: "tests/mutate-shards.test.ts",
    desc: "allKilled 只写 `rows.every(...)`（丢掉「有一片才算」那一半）⇒ 空表退化成 true，" +
      "编排器就会在**一片都没起**的时候报绿（`every` 对空集为真是这条尺的老坑）",
    apply: (s) => s.replace(
      'allKilled: rows.length > 0 && rows.every((r) => r.verdict === "已杀死"),',
      'allKilled: rows.every((r) => r.verdict === "已杀死"),',
    ),
    expectFail: "空片表 ⇒ allKilled 是**假**",
  },
  {
    id: "shard-speed-null-guard-dropped",
    src: "scripts/lib/shard-plan.ts",
    test: "tests/mutate-shards.test.ts",
    desc: "把「没有串行分母」那格的 `||` 写成 `&&` ⇒ 条件恒假，没分母时也走除法那一支，" +
      "对 null 调 toFixed 直接抛——加速比这一格必须**要么有分母、要么明说没分母**，不许拿 0 顶（规则 206/239）",
    apply: (s) => s.replace("serialSec === null || serialSec <= 0", "serialSec === null && serialSec <= 0"),
    expectFail: "不许印 Infinity 或 0",
  },
  {
    id: "shard-rollup-mismatch-not-printed",
    src: "scripts/lib/shard-plan.ts",
    test: "tests/mutate-shards.test.ts",
    desc: "抽取不符的片数算出来了却不进那行读数 ⇒ 红行名单被静默吃掉时，同一行里的「交出 N 条／判定[...]」" +
      "照旧印，而它们已经不可信（接线要连入参一起钉，规则 230）",
    apply: (s) => s.replace("(m.mismatchShards > 0 ?", "(false ?"),
    expectFail: "抽取对不上的片数要印在行里",
  },
  {
    id: "triage-baseline-prose-not-line-anchored",
    src: "scripts/lib/mutation-rerun-triage.ts",
    test: "tests/mutation-rerun-triage.test.ts",
    desc: "「基线红」那一档的 `m` 旗标摘掉 ⇒ 只有当那句诊断正好落在**整段输出第一行**才认。" +
      "真机把基线诊断印在缩进的分类行上（`   基线就不是全绿（不应发生）:`），摘掉 `m` 就整档失灵，" +
      "于是被污染的判定会被读成「读不出」而不是「基线红」——后者才说得出「别信这一条存活/红的结论」（规则 251 的第二注入面）",
    apply: (s) => s.replace("基线就不是全绿/mu.test(stdout)", "基线就不是全绿/gu.test(stdout)"),
    expectFail: "真的基线红那一行照旧认（缩进在行首，不是任意位置）",
  },
  {
    id: "triage-killed-requires-checkmark-prefix",
    src: "scripts/lib/mutation-rerun-triage.ts",
    test: "tests/mutation-rerun-triage.test.ts",
    desc: "把「已杀死」那一档的可选前缀写成必需 ⇒ 真机那句无后缀的汇总行认不出来。" +
      "第 188 页实测的形状：runner 把每条锚点的 desc **原样**印进 `✅ <id> — <desc>`，" +
      "所以任何不认行首的判据都会把「描述里引用了这句话」读成「机器说了这句话」",
    apply: (s) => s.replace("(?:✅ )?全部变异被正确杀死", "✅ 全部变异被正确杀死"),
    expectFail: "绿跑里有一条 ✅ 描述正好引用了『基线就不是全绿』⇒ 仍判已杀死，不许读成基线红",
  },
  {
    id: "triage-noeffect-prose-not-line-anchored",
    src: "scripts/lib/mutation-rerun-triage.ts",
    test: "tests/mutation-rerun-triage.test.ts",
    desc: "「未生效」那一档摘掉 `m` ⇒ 缩进的分类行不再算，只在整段第一行才认。" +
      "这一档认错的方向是**多做事**：空操作被读成读不出，读者会去重跑一条本来就什么都不改的锚点。" +
      "**第一版判卷杀不掉这条**：样本写成单行字符串，那句本来就在整段开头 ⇒ 有 `m` 没 `m` 同行为（等价突变，第 186 页那一族的第三种表现）。" +
      "现在样本前面垫了一行 `变异验证：1 条`",
    apply: (s) => s.replace("(?:突变|变异)未生效/mu.test(stdout)", "(?:突变|变异)未生效/gu.test(stdout)"),
    expectFail: "未生效那一档也只认行首形状（带 ❌ 判红· 前缀的分类行算，塞在描述中间不算）",
  },
  {
    id: "triage-red-summary-drops-new-wording",
    src: "scripts/lib/mutation-rerun-triage.ts",
    test: "tests/mutation-rerun-triage.test.ts",
    desc: "判红汇总行只认旧措辞（丢掉『|判红』那一支）⇒ 新版 runner 那句「N 条判红（按类别分开数…）」被读成「读不出」。" +
      "更坏的组合在这里：这一档失灵之后，如果某条描述里恰好写着『已杀死』那句原文的逐字形式，" +
      "一次真判红的跑就能从「已杀死」那一支出出去＝**假绿**（现读：表里确有描述含那句原文）",
    apply: (s) => s.replace("条(?:变异存活或误伤|判红)", "条变异存活或误伤"),
    expectFail: "反方向更要紧：红跑的 ✅ 描述里引用了『全部变异被正确杀死』⇒ 不许读成已杀死",
  },
  {
    id: "verify-per-anchor-cost-empty-as-zero",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "空账本印成 `0.0s／0 拍` ⇒ 「这条没被判过」被洗成「这条很便宜」，" +
      "而装箱会把没量过的条优先塞进片里（规则 245：「没跑」是第三态，不许印成 0.0s）",
    apply: (s) => s.replace('if (runsMs.length === 0) return "本机实测 一次没跑 ⇒ 这一格没有分母";', 'if (runsMs.length === 0) return "本机实测 0.0s／0 拍";'),
    expectFail: "逐条那一格：跑了印「N.Ns／K 拍」，一次没跑印「没有分母」，两态不许同形",
  },
  {
    id: "verify-per-anchor-cost-shape-drifted",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "把 `／K 拍` 那一半去掉 ⇒ 读数只剩秒，取料方分不清「一条锚点跑了 1 拍（早退）」与「跑了 3 拍」，" +
      "而这两个形状的单价差一个量级（第 168 页：第 1 拍付 vite 冷启动）。列印形状是下游读法的一部分，改形状要同轮换读者（规则 251/253）",
    apply: (s) => s.replace("return `本机实测 ${secsOf(runsMs.reduce((a, b) => a + b, 0))}s／${String(runsMs.length)} 拍`;", "return `本机实测 ${secsOf(runsMs.reduce((a, b) => a + b, 0))}s`;"),
    expectFail: "取料形状：有分母那一支固定成 秒／拍 两段（#28 的装箱按它读，改形状要同轮换读者）",
  },
  {
    id: "shard-plan-weights-ignored",
    src: "scripts/lib/shard-plan.ts",
    test: "tests/mutate-shards.test.ts",
    desc: "有权重却仍按条数装（把权重那一支换回 `g.ids.length`）⇒ 第 191 页首份现场读出的长尾进不了装箱" +
      "（p90 以上那 10.6% 的条数占掉 36.3% 的时间，最慢一条 17.7s 自己就占 18%），" +
      "整表墙钟继续由最慢那片决定——第 190 页那个 +37% 极差就是这么来的",
    apply: (s) => s.replace("    ? (g: { ids: string[] }) => g.ids.reduce((a, id) => a + (weights.get(id) ?? fallback), 0)\n", "    ? (g: { ids: string[] }) => g.ids.length\n"),
    expectFail: "按条数装与按秒装给出不同的两片（负控：不给权重＝逐字等于旧行为）",
  },
  {
    id: "shard-plan-missing-weight-as-zero",
    src: "scripts/lib/shard-plan.ts",
    test: "tests/mutate-shards.test.ts",
    desc: "缺权重的条按 0 秒装 ⇒ 盲区变成「免费的重物」，装箱会优先把没量过的宿主整组塞进同一片，" +
      "而那一片的真实时长无人知道（规则 245：把「没记账」读成「记了 0」会让单价看起来更便宜，诱人以下算）",
    apply: (s) => s.replace("(weights.get(id) ?? fallback)", "(weights.get(id) ?? 0)"),
    expectFail: "名单里缺权重的条按**已知中位**补，不许当 0 秒（否则盲区优先跑）",
  },
  {
    id: "shard-cost-parser-first-wins",
    src: "scripts/lib/shard-plan.ts",
    test: "tests/mutate-shards.test.ts",
    desc: "同一条多次出现时保留第一次看到的 ⇒ 权重回到「早退那一拍」的量级，" +
      "长尾被静默削平（而装箱正是为长尾才改的）。这一格取最大值是有理由的：低估会把两个重物叠进同一片",
    apply: (s) => s.replace("if (prev === undefined || sec > prev) into.set(current, sec);", "if (prev === undefined) into.set(current, sec);"),
    expectFail: "同一条多次出现取最大值：低估长尾会把两个重物叠进同一片，而墙钟由最慢那片决定",
  },
  {
    id: "shard-cost-parser-unanchored-tail",
    src: "scripts/lib/shard-plan.ts",
    test: "tests/mutate-shards.test.ts",
    desc: "取料正则丢掉行尾锚定 ⇒ 锚点描述里那句引用「｜本机实测 9.9s／2 拍」的散文被当成读数收进表，" +
      "权重表混进不存在的秒。第 188 页同一课换了载体：**被度量者自己的文案是第二个注入面**（规则 264）",
    apply: (s) => s.replace("拍$/u.exec(line)", "拍/u.exec(line)"),
    expectFail: "只认行尾那一格：描述里引用同样字面不算读数（规则 264：散文不许冒充读数）",
  },
  {
    id: "shard-cost-parser-forgets-current-id",
    src: "scripts/lib/shard-plan.ts",
    test: "tests/mutate-shards.test.ts",
    desc: "每读到一条非结果行就把「当前 id」清空 ⇒ 只有 id 与成本格挤在同一行时才配得上。" +
      "整表实测：1018 条抽到 1017 条，缺的那条 `impact-closure-glob-broken` 的 desc 含**真换行**，" +
      "成本格因此落在没有 id 的续行上。desc 换行是被度量者的合法内容（本仓另有 5 条逐行式锚点），" +
      "**不许为了让尺好读去改它** ⇒ 有状态的解析才是那一格的修法；发现手段就是计划行那句「权重 1017/1018」（规则 270/271）",
    apply: (s) => s.replace("    if (head !== null) current = head[1]!;\n", "    if (head !== null) current = head[1]!;\n    else current = \"\";\n"),
    expectFail: "desc 含真换行时，成本格挂在续行上也要记回那条 id（尺自己记住 id，不要求内容迁就尺）",
  },

  /* ── 第 281 页：证据面门的归因分面（未跟踪＝不在 HEAD 的危险码只点名、不进棘轮）。
   *    七支各钉一种坏法：豁免根本不生效 / 豁免写过头 / 面取不到被当成"没有" / 口径没印进读数 /
   *    取料前缀不按 include 现读 / 分面时凭空少一条 / runner 那行接线掉。判卷全部喂合成夹具，
   *    所以这七支都买得起（真仓那一趟两侧同值时配不了锚点，见第 272 页第 7 项）。 ── */
  {
    id: "evidence-fly-exempt-never-fires",
    src: "scripts/lib/evidence-typecheck.ts",
    test: "tests/evidence-typecheck.test.ts",
    desc: "分面条件里的 `flySet.has(file)` 被写成恒假 ⇒ 未跟踪清单白取了，隔壁的草稿照样推动我的棘轮" +
      "（第 281 页要修的就是这一格：主树 `16 条／帽 12` 的红全在两支未入库探针里）",
    apply: (s) => s.replace('flyFace === "ok" && flySet.has(file)', 'flyFace === "ok" && false'),
    expectFail: "隔壁未入库的草稿 ⇒ 不红、点名",
  },
  {
    id: "evidence-fly-exempt-widened-to-all",
    src: "scripts/lib/evidence-typecheck.ts",
    test: "tests/evidence-typecheck.test.ts",
    desc: "分面条件从「在这份未跟踪清单里」放宽成「只要面可取就放行」⇒ 已跟踪的新探针也被当成在飞，" +
      "棘轮从此挡不住任何东西（豁免写成万能豁免＝假绿，与第 279 页那支 legacy 万能豁免同形）",
    apply: (s) => s.replace('flyFace === "ok" && flySet.has(file)', "true"),
    expectFail: "同目录的已跟踪新件照样红",
  },
  {
    id: "evidence-fly-face-unavailable-reads-as-ok",
    src: "scripts/lib/evidence-typecheck.ts",
    test: "tests/evidence-typecheck.test.ts",
    desc: "「面取不到」被当成「面可取且为空」⇒ 空清单配上 ok 态，别人的探针就凭空免了账（三态里的「取不到」" +
      "在本仓第 109/118 页反复出现过：没有 与 取不到 是两个意思，混着说就是把 fail-open 写进文案）",
    apply: (s) => s.replace(
      'input.untracked.unavailable === false ? "ok" : "unavailable"',
      'input.untracked.unavailable === false ? "ok" : "ok"',
    ),
    expectFail: "不许读成「没有未跟踪件」",
  },
  {
    id: "evidence-fly-cell-drops-caliber",
    src: "scripts/lib/evidence-typecheck.ts",
    test: "tests/evidence-typecheck.test.ts",
    desc: "读数里的「HEAD 口径」那半句被去掉 ⇒ 同一个「12 条」再也读不出是仓里的还是整棵树上的" +
      "（第 259 页就是为这两个数吵过：HEAD 31 条／工作树 51 条；口径不进读数，下一个读者只能猜）",
    apply: (s) => s.replace("? `HEAD 口径｜在飞未入库", "? `｜在飞未入库"),
    expectFail: "两种口径不许同数",
  },
  {
    id: "evidence-others-prefix-glob-not-cut",
    src: "scripts/lib/evidence-typecheck.ts",
    test: "tests/evidence-typecheck.test.ts",
    desc: "include 条目不再按通配截到目录为止，原样当 pathspec 交给 git ⇒ 哪天有人把 include 写成 " +
      "`outputs/**` 那种形状，取料面就与 tsc 扫的面不同宽，豁免名单静默失真",
    apply: (s) => s.replace("const seg = (cut === -1 ? e : e.slice(0, cut)).replace", "const seg = e.replace"),
    expectFail: "带通配的取到目录为止",
  },
  {
    id: "evidence-fly-rows-swallowed",
    src: "scripts/lib/evidence-typecheck.ts",
    test: "tests/evidence-typecheck.test.ts",
    desc: "分到「不在我的账」那一半的条数被清成 0（既不留在 HEAD 口径里、也没进 flying）⇒ " +
      "分面变成筛子，读数比真值小而没有任何一格出声（守恒式就是钉这个的）",
    apply: (s) => s.replace("    else trackedFile[file] = now;", "    else trackedFile[file] = 0;"),
    expectFail: "分出去的不许凭空少一条",
  },

  /* ── 第 284 页：把 D-9 的取料面收成共用构造器，并把 TS2353（键被静默丢掉）纳进危险码。
   *    四支各钉一种坏法：新纳的那支码被摘掉 / 排除面写宽（探针脚本给自己作证）/
   *    三态被抹平（"取不到"交成"空面"）/ 接线掉（门不走共用构造器 ⇒ 形状还会再漂一次）。 ── */
  {
    id: "evidence-danger-codes-without-ts2353",
    src: "scripts/lib/evidence-typecheck.ts",
    test: "tests/evidence-typecheck.test.ts",
    desc: "刚纳进来的 `TS2353` 从表尾被摘掉 ⇒ 第 283 页那整条事故（`cacheDir` 被静默丢掉、两支探针量的不是它们承诺的事）" +
      "重新变成没人看的一类形状——码在注释里被讲过、表上却没有它，下一次同样写错键不会红",
    apply: (s) => s.replace('"TS7053", "TS2353"]', '"TS7053"]'),
    expectFail: "TS2353（多给的键被静默丢掉）",
  },

  /* ── 第 259 页（任务 #4）：证据面类型检查门。八支各钉一个**不同的**判卷，且每一支都对应写门时真犯过的错。
   *    这一族最坏的地方是「坏法都长得像绿」：解析取错字段 ⇒ 危险码恒 0；退出码认错 ⇒ 红读成没测；
   *    拒绝分支 fail-open ⇒ 没跑读成跑过。所以钉子全在判定与进程出口上，不在文案上。 ── */
  {
    id: "evidence-parse-code-group-off-by-one",
    src: "scripts/lib/evidence-typecheck.ts",
    test: "tests/evidence-typecheck.test.ts",
    desc: "把 `code` 取到 `m[3]`（列号）⇒ 危险码一条也匹配不上，门从「拦得住」变成「永远绿」。" +
      "这一支钉的是写门时**真犯过的**错：上一版把 `(error)` 也括起来占了一组，`m[4]` 就成了常量 \"error\"；" +
      "而门自带的「解析 N/N 条」自证完全看不出来——它只数行，不看取错字段（规则 324 的镜像）",
    apply: (s) => s.replace("return { file: m[1]!, code: m[4]! };", "return { file: m[1]!, code: m[3]! };"),
    expectFail: "真报错行 ⇒ file 与 code 都取对（code 必须是 TS 码，不是 'error'）",
  },
  {
    id: "evidence-tsc-exit2-read-as-not-run",
    src: "scripts/lib/evidence-typecheck.ts",
    test: "tests/evidence-typecheck.test.ts",
    desc: "只把退出码 1 当「跑过了」⇒ tsc 报出错误时的 2 被归一化成 null，门在**真有料**的那一刻反而出声喊" +
      "「没跑到」：红被读成没测，且这种输出看起来像谨慎。tsc 的码只有 0（无错）与 2（有错）是给了结论的" +
      "（本仓 `scripts/typecheck.ts` 原样转发那个 2）——上一版就是这么错的",
    apply: (s) => s.replace("if (r.status !== 0 && r.status !== 2) {", "if (r.status !== 0 && r.status !== 1) {"),
    expectFail: "仓内 tsconfig.evidence.json 存在，且 tsc 真跑了（退出码 0 或 2，不是「没跑到」）",
  },
  {
    id: "evidence-verdict-status-validation-dropped",
    src: "scripts/lib/evidence-typecheck.ts",
    test: "tests/evidence-typecheck.test.ts",
    desc: "判定层不再自证退出码（放过 1）⇒「跑到了没有」完全押在调用方那一份归一化上；判卷与门都会直接喂 " +
      "`{status:1}`，于是 tsc 用法错/内部崩（我们的取证链就崩过一次）被当成「跑了、0 条危险码」＝干净。" +
      "规则 261/262：取不到不许读成没问题，而且**每个消费点都要自己认这个取不到**",
    apply: (s) => s.replace("(input.tsc.status !== 0 && input.tsc.status !== 2)", "(input.tsc.status !== 0 && input.tsc.status !== 2 && input.tsc.status !== 1)"),
    expectFail: "没跑到／取不到 ⇒ unreadable（既不是红也不是绿）",
  },
  {
    id: "evidence-danger-code-filter-dropped",
    src: "scripts/lib/evidence-typecheck.ts",
    test: "tests/evidence-typecheck.test.ts",
    desc: "删掉危险码筛选那行 ⇒ TS7006（隐式 any：只欠一个标注、不改变取到什么，现存量 30 条）也进分子：" +
      "门第一次跑就从「12 条／帽 12 条」变成「51 条」并红一大片，读数失去含义，门会被人关掉。" +
      "加码要能点名「哪一族会产出假读数」，不能只按「tsc 报了就算」——那是把别人的 30 处算成这一格的债",
    apply: (s) => s.replace("    if (!DANGER_CODES.includes(hit.code)) continue;\n", ""),
    expectFail: "三条真行混合 ⇒ total 与 parsed 相等、perFile 只含危险码那两条",
  },
  {
    id: "evidence-ratchet-equal-counts-as-grew",
    src: "scripts/lib/evidence-typecheck.ts",
    test: "tests/evidence-typecheck.test.ts",
    desc: "把「等于帽」也判成涨 ⇒ 水位门变成常态红：现读 12／帽 12 是**登记存量**的正确状态，" +
      "红了就没人看第二条（存量水位法的用法是「只准调低」，不是「永远不许等于」）。" +
      "这一支钉的是比较号方向：改成 `>=` 后，门在自己登记好的仓里也响",
    apply: (s) => s.replace("if (now > cap) grew.push({ file, now, cap });", "if (now >= cap) grew.push({ file, now, cap });"),
    expectFail: "现读等于帽 ⇒ clean，且不出声喊调低",
  },
  {
    id: "evidence-unregistered-file-cap-default-zero",
    src: "scripts/lib/evidence-typecheck.ts",
    test: "tests/evidence-typecheck.test.ts",
    desc: "未登记文件的默认帽从 0 抬到 1 ⇒ 每加一个新探针都能**白拿一条**危险码，而 `ino` 那一类假读数正好是" +
      "一条就够（读一个不存在的属性）。登记不是入口：新文件带危险码就该红，逼人要么修要么显式登记（规则 235）",
    apply: (s) => s.replace("if (!(file in input.baseline) && now > 0)", "if (!(file in input.baseline) && now > 1)"),
    expectFail: "新文件带危险码 ⇒ 红（帽按 0 算）——登记不是入口，修它才是",
  },

  /* ── 第 260 页（任务 #6）：锚点指针的「接线」那一格。五支钉三种坏法：
   *    ⑴取符号时把 needle 自己那一行切掉（声明行→上一条函数）；⑵函数体里的局部 const 被当成边界；
   *    ⑶源文件读不到却算成 wired（「没尺」读成「尺说没问题」）；⑷分格并成一锅；⑸门那一步被喂空表。
   *    第⑤支的 src 就是本文件（自-hosted）⇒ 针脚里带**真换行**（写成转义的 `\n`），否则 replace 先撞进这张表自己那份引文，
   *    代码一个字没动、报成「变异存活」——本仓为这条立过两次（规则 325 那一案的姊妹形）。 */
  {
    id: "wiring-lineend-drops-needle-line",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "退回「只切到 needle 起点」⇒ 针脚写在**声明行**上时取到的是上一条函数（本仓第 260 页的探针在真文件上逮到的：`certTreeAbs` 被读成 `mainRootFromCommonDir`）。" +
      "这一格坏法的后果是双向的：兄弟用例可能被误判 wired，真接线也可能被误判 suspect——而它看起来像尺在正常工作",
    apply: (s) => s.replace("  for (let i = needleLine; i >= 0; i -= 1) {", "  for (let i = needleLine - 1; i >= 0; i -= 1) {"),
    expectFail: "needle 就写在声明行上时取的是**这一行**的函数名（只切到 needle 起点会把声明行切掉）",
  },
  {
    id: "wiring-scan-stops-at-local-const",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "把函数体里的局部 `const m = …` 当成边界就 return null ⇒ 大量正常锚点全落进「判不了」，" +
      "这一格从读数退化成空读数（比误喊更隐蔽：汇总行看着像「尺很谨慎」）。只有列 0 的数据声明才是边界",
    apply: (s) => s.replace('    if (/^\\S/u.test(line)) return "boundary";\n    return null;', '    return "boundary";\n    return null;'),
    expectFail: "needle 就写在声明行上时取的是**这一行**的函数名（只切到 needle 起点会把声明行切掉）",
  },
  {
    id: "wiring-unreadable-counts-as-wired",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "源文件或判卷读不到时被算成 wired ⇒ 「两面之一压根没上架」读成「接线正确」（规则 261/262 的正是这一格）。" +
      "这一族在本仓的红法一直是「取不到与没问题同形」，写新分时最容易被顺手并进绿的那一侧",
    apply: (s) => s.replace('if (srcText === null || testText === null) { push("unreadable", null); continue; }', 'if (srcText === null || testText === null) { push("wired", null); continue; }'),
    expectFail: "四态各归各位：wired／suspect／no-symbol／unreadable，取不到不许并进 wired 也不许并进 suspect",
  },
  {
    id: "wiring-census-merges-all-kinds",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "分格计数并成一锅 ⇒ 汇总行三个数照样印得出、加总也等于条数（配平那条判卷看的是**和**），" +
      "但「疑空」这一格失去含义：再没人能从数字里看出有多少锚点是真的接上过",
    apply: (s) => s.replace("  for (const r of rows) c[r.kind] += 1;", "  for (const r of rows) c.wired += 1;"),
    expectFail: "分格要配平：wired＋suspect＋四类判不了 ＝ 送进去的条数（漏一条就少一个证人）",
  },
  {
    id: "exits-span-decl-line-length-dropped",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "算函数体终点时少加声明行那一段长度 ⇒ 体被切短、数出来的 return 比实际少（第 263 页我自己就这么写错过一次，" +
      "是判卷把 2 读成 0 才抓住的）；少报出口＝存活提示永远闭嘴",
    apply: (s) => s.replace('let end = from + (lines[declLine] ?? "").length + 1;', "let end = from;"),
    expectFail: "出口计数：一段函数里有几条 return 就报几条；「数不出来」是 null，不许并进 1 条（第 263 页）",
  },
  {
    id: "exits-span-end-boundary-dropped",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "体的收尾认不出列 0 的右花括号 ⇒ 范围一路扩到文件末尾，把后面每条函数的 return 都算进这一格 ⇒ " +
      "「≥2 条出口」对所有锚点一律成立，提示就变成噪声（第 263 页）",
    apply: (s) => s.replace('if (/^\\}/u.test(lines[i] ?? "")) {', 'if (/^\\}\\}\\}/u.test(lines[i] ?? "")) {'),
    expectFail: "出口计数：体范围停在列 0 的收尾——下一条函数的 return 不许算进来（数多了等于这把尺没边界）",
  },
  {
    id: "exits-count-replaced-by-constant",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "return 计数写死成 1 ⇒ 这一格从读数退化成常数（规则 242：一片相同的数不是测量），" +
      "而它正是「存活要不要补输入」那唯一的信息来源（第 263 页）",
    apply: (s) => s.replace("(body.match(/\\breturn\\b/gu) ?? []).length", "1"),
    expectFail: "出口计数·真机：suiteRows 那一格现在自己说得出「几条出口」——第 262 页那条存活要有能印出来的成因",
  },
  {
    id: "exits-null-merged-into-one",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "「数不出包围函数」回 1 条而不是 null ⇒ no-symbol 那一档混进「单出口」，" +
      "读起来像量过了（第 263 页；规则 239/261 三态分开印）",
    apply: (s) => s.replace("if (span === null) return null;", 'if (span === null) return { name: "", returns: 1 };'),
    expectFail: "接线普查：rows 里 returns 跟着 kind 走——no-symbol／no-needle 那两档必须是 null 而不是 0",
  },
  /* ---- 尺自己的哨兵必须能拦住退出码（10-02 第三簇：正哨兵连着 MISS 而脚本一直退 0）---- */
  {
    id: "map-ruler-selfcheck-always-ok",
    src: "scripts/lib/probe-self-check.ts",
    test: "tests/locate-recall-ruler.test.ts",
    desc: "哨兵那一半不拦 ⇒ 整张表的命中率照样退 0 出数，而「图里真没有它」这句话只躺在日志里；" +
      "本仓第 N 次同一形状：判据在场、出口不在",
    apply: (s) => s.replace("  if (!posHit) return { ok: false,", "  if (false) return { ok: false,"),
    expectFail: "正哨兵从没命中过 ⇒ 不 ok，且明说这一列不可引用",
  },
  {
    id: "mutate-gates-unknown-read-as-same-rev",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "摘掉「取不到」那一支 ⇒ gitOk 为假时走到空清单那条出口，喊成「rev 与 HEAD 同一笔、派生必然 0」，"
      + "听起来像诊断，实际是没取到（不可知不许由 0 顶替）",
    apply: (s) => s.replace("  if (!mat.gitOk) {", "  if (false) {"),
    expectFail: "git 取不到清单 ⇒ 报『不可知』，不许读成『派生必然 0』（一次 git 失败不能被写成结论）",
  },
  {
    id: "mutate-gates-ledger-some-instead-of-every",
    src: "scripts/lib/mutate-gates.ts",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "every 改成 some ⇒ 清单里有一个真面也照样喊「必然 0」——这里 over-inclusive 不是安全方向，"
      + "它让人放弃一次本来该跑的复认（与「列目录助手要按能不能点出名字记账」第 329 页同型）",
    apply: (s) => s.replace("  if (files.every(isLedger)) {", "  if (files.some(isLedger)) {"),
    expectFail: "三态分开出声：同一笔／纯台账／含一个真面要闭嘴（混合清单不许被 `some` 读成必然空）",
  },
  /* ---- 2026-10-06 第 404 页：#109 基准失败轨迹 ⇒ 学习环输入（留档器三顶帽 ＋ 跑器接线 ＋ 名字同源）---- */
  {
    id: "keep-archives-non-failure-runs",
    src: "scripts/lib/failed-trace-keep.ts",
    test: "tests/failed-trace-keep.test.ts",
    desc: "「这一行算不算失败」那道闸被摘 ⇒ 绿的那趟也留档：目录从「只有失败」变成「全都要」，"
      + "既撞 repo-hygiene 的 outputs 占比帽，又把学习环的输入混进噪声（留档小的原因是**裁决**，不是帽）",
    apply: (s) => s.replace(`    return none("not-a-failure", "这一行的裁决是「" + i.verdict + "」⇒ 不是失败，不留档");\n`, ""),
    expectFail: "verdict=「PASS」⇒ skipped=not-a-failure，且连 failures/ 目录都不该被造出来",
  },
  {
    id: "keep-count-cap-silent-drop",
    src: "scripts/lib/failed-trace-keep.ts",
    test: "tests/failed-trace-keep.test.ts",
    desc: "条数帽那一格被摘 ⇒ 超帽那几条**静默不写**（本仓点名的形状：少写了没人说），"
      + "而那行读数也就再也说不出「丢弃合计」",
    apply: (s) => s.replace(`    return none("count-cap", `, `    return none("unused-count-cap", `),
    expectFail: "4 条 FAIL / 帽 2 ⇒ 盘上恰好 2 份，读数里「超条数帽 2」与「丢弃合计 2」都在",
  },
  {
    id: "keep-total-bytes-cap-silent-drop",
    src: "scripts/lib/failed-trace-keep.ts",
    test: "tests/failed-trace-keep.test.ts",
    desc: "目录总字节帽被摘 ⇒ 一条跑飞的转录能把留档目录写到无界（留档走的是有人量的那棵树，"
      + "不拦就是把 70% 占比帽交出去）",
    apply: (s) => s.replace(`    return none("total-bytes-cap", `, `    return none("unused-total-bytes-cap", `),
    expectFail: "目录总字节帽：第二条放不进去 ⇒ 点名「超目录总帽 1」而不是少写一条没人说",
  },
  // ---- 第 435 页：提交面的删除形状那道闸（#16，空树提交的机械化）----
  // 这一族守的是同一句话：**「没量到」与「没删」不许同形**，以及**闸不许靠人看见**。
  // 判据只有一份（`scripts/lib/commit-surface.ts`），两个消费者各有一根接线锚点钉着。
  {
    id: "commit-shape-empty-tree-not-blocking",
    src: "scripts/lib/commit-surface.ts",
    test: "tests/commit-surface-check.test.ts",
    desc: "空树那一格从阻断降成只出声 ⇒ 第 431 页那种「3647 支全删、树里 0 支」又能绿着过去，"
      + "而它正是这道闸存在的全部理由（当时靠我看见 stdout 才停）",
    apply: (s) => s.replace(`      kind: "emptyTree",\n      blocking: true,`, `      kind: "emptyTree",\n      blocking: false,`),
    expectFail: "树里 0 支文件 ⇒ 单独一格 emptyTree 并阻断（第 431 页那笔的形状，不与 massDelete 混）",
  },
  {
    id: "commit-shape-null-face-folds-to-zero",
    src: "scripts/lib/commit-surface.ts",
    test: "tests/commit-surface-check.test.ts",
    desc: "把「树文件数取不到」折成 0 ⇒ 没尺被读成「树是空的／没删东西」，"
      + "这道闸最坏的一种失效方向（它会把事故读成干净）",
    apply: (s) => s.replace(`    treeFiles: treeList === null ? null : treeList.length,`, `    treeFiles: treeList?.length ?? 0,`),
    expectFail: "四段全取不到 ⇒ 两个计数都是 `null` 而不是 0（「没量到」与「没删」不许同形）",
  },
  {
    id: "commit-shape-waiver-marker-ignored",
    src: "scripts/lib/commit-surface.ts",
    test: "tests/commit-surface-check.test.ts",
    desc: "备案标记永远认不出（indexOf 写死 -1）⇒ 写了理由的那一笔照样被拦，"
      + "门看起来更严其实把「为什么删」这条审计面关掉了——没人会去写一句换不来放行的事",
    apply: (s) => s.replace(`  const at = message.indexOf(DELETE_WAIVER_MARK);`, `  const at = -1;`),
    expectFail: "有标记有话 ⇒ 认；只有标记／话太短／没标记 ⇒ 都不认",
  },
  {
    id: "commit-shape-cap-raised-without-census",
    src: "scripts/lib/commit-surface.ts",
    test: "tests/commit-surface-check.test.ts",
    desc: "帽从 4 抬到 5（现读近 120 笔的最大值就是 4）⇒ 本仓口径「帽只准调低」被反着走，"
      + "而阈值一旦离开现读出处就成了愿望",
    apply: (s) => s.replace(`export const DELETED_FILE_CAP = 4;`, `export const DELETED_FILE_CAP = 5;`),
    expectFail: "帽的取值有现读出处（4＝近 120 笔里「从树里消失的文件数」的最大值；抬帽要拿新的现读来，不许顺手）",
  },
];
