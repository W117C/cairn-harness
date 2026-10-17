// scripts-mutate 域的变异配置条目（2026-10-17 从 scripts/mutate-verify.mjs 按域拆出，见 PROGRESS 第 501 页）。
// 每条 = 一处语义突变 + 期望被它杀死的具体用例标题。追加条目时放进对应域的文件；
// **组间顺序不影响任何判据**（每条独立），同一文件内保持原顺序以便 diff。
export const MUTATIONS = [
  {
    id: "list-rows-not-flattened",
    src: "scripts/mutate-verify.mjs",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "`--list` 不再把字段压成一行 ⇒ desc 里带换行的那条被拆成两行，行数列数都不对，而吃这份取料面的两把静态尺只是**少读一条**（不报错）。第 141 页实测：表里 833 条，尺只读到 832 条。（第 163 页补⑵：这一支的写法从「逐行 console.log」改成「整块 writeSync」，针脚跟着实现走——旧针脚 `].map(oneLine).join(\\t));` 当场 0 命中，是门喊的，不是我看出来的。）",
    apply: (s) => s.replace('].map(oneLine).join("\\t")).join("\\n")', '].join("\\t")).join("\\n")'),
    expectFail: "真跑：--list 经管道交给读者的行数必须等于表长（少一行＝两把静态尺一起少读一条锚点而不自知）",
  },
  {
    id: "head-pointer-dimension-not-summed",
    src: "scripts/mutate-verify.mjs",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "第 6 维算出来了却没喂进求和 ⇒ 门照跑、汇总照印绿（接线没有编译期信号）。针脚取两行：这条锚点自己的 apply 字面量里也写着那两行文字（同一个文件）。",
    apply: (s) => s.replace(
      "    expectFail: stalePointers.length,\n    headPointer: headPointers.length,",
      "    expectFail: stalePointers.length,",
    ),
    expectFail: "第 6 维（HEAD 侧指针失效）也要喂进求和，且 runner 真去调那把尺",
  },
  {
    id: "baseline-red-triage-call-removed",
    src: "scripts/mutate-verify.mjs",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "分诊算出来了但基线那一支不接 ⇒ lib 单测全绿、门照旧把环境红报成阻断（接线没有编译期信号）。针脚取两行避开本条自指。",
    apply: (s) => s.replace(
      "      const kind = baselineRedKind(baseRun.probe.out);\n      if (kind.kind === \"unloadable\") {",
      "      const kind = baselineRedKind(baseRun.probe.out);\n      if (false) {",
    ),
    expectFail: "接线：基线那一步真调这把分诊尺（不然是拿着读数当结论）",
  },
  {
    id: "runner-attribution-call-removed",
    src: "scripts/mutate-verify.mjs",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "runner 不调这把尺（归因那一步摘掉）⇒ lib 的单测全绿而门照旧印 ✅：接线没有编译期信号。针脚取两行——本条 apply 的字面量里也写着那句调用（同一个文件），单行判据会连「被摘掉那次」也读成还在。",
    apply: (s) => s.replace(
      "    if (!killerAttributionOk(m.expectFail, hit.out)) {\n      const failedFace = failingTestText(hit.out).slice(0, 300);",
      "    if (false) {\n      const failedFace = failingTestText(hit.out).slice(0, 300);",
    ),
    expectFail: "接线：runner 归因那一步真调这把尺，且旧的整串 includes 已经不在",
  },
  {
    id: "anchor-face-count-floor-flip-hits-exact-line",
    src: "scripts/mutate-anchor-titles.ts",
    test: "tests/mutate-anchor-titles.test.ts",
    desc: "帽的比较符翻成 <= ⇒ 现表 798 恰好踩线就红：正在加锚点的人被这条尺打（第 126 页：整块摘除没人出声，补的这条也不能反过来咬新增）",
    apply: (s) => s.replace("if (rows.length < floor) {", "if (rows.length <= floor) {"),
    expectFail: "反向配对：多于下限不许红（否则这条尺会惩罚正在加锚点的人）",
  },
  {
    id: "anchor-face-dead-src-unreported",
    src: "scripts/mutate-anchor-titles.ts",
    test: "tests/mutate-anchor-titles.test.ts",
    desc: "dead-src 那半不发现在册种类 ⇒ 锚点指向面上不存在的文件时无人点名，那条变异就在空转",
    apply: (s) => s.replace('out.push({ kind: "dead-src"', 'out.push({ kind: "unverified-file"'),
    expectFail: "src 指向面上不存在的文件 ⇒ 点名那条锚点（这条变异在空转）",
  },
  {
    id: "anchor-face-zero-review-only-checks-shipping",
    src: "scripts/mutate-anchor-titles.ts",
    test: "tests/mutate-anchor-titles.test.ts",
    desc: "欠条判据收成只看「文件在不在」⇒ 补回锚点或文件被删都不会逼人回来销账（豁免烂在表里没人清的形状）",
    apply: (s) => s.replace("if (shipping && count === 0) continue;", "if (shipping) continue;"),
    expectFail: "欠条：文件在面上且零锚点 ⇒ 不红；补回一条 或 文件消失 ⇒ 都要人来销账",
  },
  {
    id: "anchor-face-src-column-not-parsed",
    src: "scripts/mutate-anchor-titles.ts",
    test: "tests/mutate-anchor-titles.test.ts",
    desc: "抽取面不再抽 `src:` ⇒ 每行的 src 恒为 null，「这个文件零锚点」全是从漏计里读出来的 0（比不判更坏，因为它看着像判过）",
    apply: (s) => s.replace("src: srcLit?.[1] === undefined ? null : decode(srcLit[1]),", "src: null,"),
    expectFail: "取料面自己要先可信：抽取漏了 src 栏 ⇒ 「零锚点」会被虚报，所以每一行都必须抽出 src",
  },
  {
    id: "loose-pointer-computed-not-wired",
    src: "scripts/mutate-verify.mjs",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "尺接在门上但喂空表 ⇒ 印出来的永远是「松钉指针 0 条」（规则 230 的接线课：钉调用点连同它的入参，只钉函数名则「算出来不接」存活）。" +
      "针脚取两行是为绕开自指：单行的话这条 apply 自己就含那句文字，本文件命中 2 处会落进「待复认」",
    apply: (s) => s.replace("  const loosePinned = looseOnlyPointers(pointerEntries,\n    (rel) =>", "  const loosePinned = looseOnlyPointers([],\n    (rel) =>"),
    expectFail: "接线：门自己那一步要真拿整张表去数松钉（只印不数＝这一格永远 0，且永远不红）",
  },
  {
    id: "pointer-block-dimension-not-summed",
    src: "scripts/mutate-verify.mjs",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "新维算出来了却没喂进求和 ⇒ 门照跑、汇总照印绿。针脚取两行是为绕开自指：这条锚点自己的 apply 里也写着那句文字（单行 needle 会在本文件命中 2 处，落进「待复认」那一档）",
    apply: (s) => s.replace("needle: blocking.length, duplicateIds: dup.length, untracked: untracked.length, drift: drift.length,\n    expectFail: stalePointers.length,", "needle: blocking.length, duplicateIds: dup.length, untracked: untracked.length, drift: drift.length,"),
    expectFail: "求和那一行必须把第 5 维喂进去（钉接线：少喂一支＝门照跑、汇总照印绿）",
  },
  // ── 第 163 页 · 同一把锁接到 mutate-verify（任务 #31）：过程收成一份之后，消费者侧各钉三针
  {
    id: "mutate-lock-not-acquired",
    src: "scripts/mutate-verify.mjs",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "占锁那一步换成「自己拼一个空结果」＝算出锁面却不占 ⇒ 同树两个 mutate-verify 照旧并发抢 .mutbak，而 tool-lock 变成第二份没人调的 lib（规则 230 的「算出来不接」同格）。针脚带真换行：这张表就写在同一个文件里，不带换行的针脚会被表里那段转义文字命中，改了表、实现没动（规则 236）",
    apply: (s) => s.replace("\nconst LOCK = acquireToolLock({", "\nconst LOCK = ({"),
    expectFail: "活人占着 ⇒ exit 2、点名是谁、拒在开跑之前，并且不替别人删锁",
  },
  {
    id: "mutate-lock-read-only-face-locked",
    src: "scripts/mutate-verify.mjs",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "把只读的 `--list` 也接去占锁 ⇒ 两条并发 --list 互相拒跑，而吃 `--list` 的那两把静态尺（anchor-titles／gates）会在别人跑表时集体红——这道门不许把**不改盘**的那一半也关死（收紧必须配反向对照，规则 227）。" +
      "**第 186 页重铸**：这条从第 163 页起一直存活，原因不是「场上没人占锁」而是「占错了锁」——旧改法写死 `tree: ROOT`，" +
      "而判卷与变异机都带 `--lock-tag` ⇒ 探针种下的那把锁叫 `mutate-verify-judge-<pid>.lock`，突变体去占的却是 `mutate-verify-<树名>.lock`（没人）⇒ 拿到锁照常跑，行为零差异（等价突变，规则 260 的第二形态：不是判据没有观测者，是**突变挑错了资源**）。" +
      "现在改法与真实占锁那一支用同一个身份表达式（`lockTagRaw.given ? lockTagRaw.value : ROOT`），于是被判卷那颗活人锁当场拦住 ⇒ exit 2 ≠ 0。" +
      "`--check-needles` 那一支仍只由位置比较钉（真跑它一次 ≈7.7s，而挂在本文件的锚点几十条、每条两拍 ⇒ 实测把本判卷抬到 19 分钟，故意不换）",
    apply: (s) => s.replace(
      '\nif (plan.mode === "list") {',
      '\nif (plan.mode === "list") { acquireToolLock({ tool: "mutate-verify", root: ROOT, tree: lockTagRaw.given ? lockTagRaw.value : ROOT, target: "list", commonDirOut: gitCommonDirOut(), harm: "锚点造的：只读面也占锁", say: (line) => console.log(line) });',
    ),
    expectFail: "只读入口不许被这把门锁死：--list 在有人占着时照跑，而 `--check-needles` 与它同一先（按结构钉）",
  },
  {
    id: "mutate-lock-cell-not-printed",
    src: "scripts/mutate-verify.mjs",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "占到没占到锁不进读数 ⇒ 凭证里分不清这次是独占、是没占、还是占锁那一步根本没接（规则 211：半把尺与没尺要各自看得见）",
    apply: (s) => s.replace('\nconsole.log("[mutate-verify] 锁="', '\nconsole.log("[mutate-verify] 锁未印="'),
    expectFail: "反向哨兵：同一入参、没有锁 ⇒ 必须走到「未知 id」，并且占过又放掉（上面那条的红只能来自锁）",
  },
  {
    id: "mutate-lock-tag-ignored",
    src: "scripts/mutate-verify.mjs",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "算出标签却不接进锁身份（`tree` 仍然写死 ROOT）⇒ 判卷带标签也没用，它 plant 的那把与子进程读的那把不是同一文件：三条锁判卷全绿，而机器一跑表它们就集体判「基线不绿」（09-28 实测 46 条，规则 230「算出来不接」第六次）",
    apply: (s) => s.replace(
      "\n  tree: lockTagRaw.given ? lockTagRaw.value : ROOT,",
      "\n  tree: ROOT,",
    ),
    expectFail: "活人占着 ⇒ exit 2、点名是谁、拒在开跑之前，并且不替别人删锁",
  },
  {
    id: "mutate-flush-helper-back-to-async-write",
    src: "scripts/mutate-verify.mjs",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "把「写满为止」那一圈拆掉（`while`→`if`）＝一次 `writeSync` 只交得进内核缓冲那一截，剩下的直接丢：09-28 实测第一版就这么把 920 行的名单砍到几百行，三条吃 `--list` 的判卷一起红。四个出口共用这一圈，所以这一针同时守着名单／残留提示／针脚汇总／本次耗时（规则 214/225）",
    apply: (s) => s.replace(
      "\n  while (off < buf.length) {",
      "\n  if (off < buf.length) {",
    ),
    expectFail: "真跑：--list 经管道交给读者的行数必须等于表长（少一行＝两把静态尺一起少读一条锚点而不自知）",
  },
  {
    id: "mutate-flush-one-site-bypasses-helper",
    src: "scripts/mutate-verify.mjs",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "只把 `--list` 这一处绕开 helper（其余三处照旧）⇒ 四个同步出口数变 3，而表照样印得出来、退出码照样 0：这正是「一处的例外长期活着」的形状。计数按行首语句核，绕开＝少一处",
    apply: (s) => s.replace(
      "\n  emitAndExit(body, 0);",
      "\n  console.log(body.slice(0, -1));\n  process.exit(0);",
    ),
    expectFail: "helper 本体按字节写满、四个出口都经它（一次 writeSync 只交得进内核缓冲那一截）",
  },
  // ── 第 162 页 · `--changed-since`：把「该杀哪几条锚点」从人肉名单改成从改动面派生
  // 这一组里有两条**故意不进表**，写在这里免得下一个人以为是漏做：
  // ① `if (sinceArg === "")` 那一支——它的失败形状是「空 rev 落到缺省语义＝跑整张表」，
  //    把这条 mutation 放进表里会在验它的 30 分钟里就地改遍源文件；那一格改由行为判卷守（真跑 exit 2）。
  // ② 派生读数的 print 本身（`改动面派生：rev=…`）——它只有一处印，删掉它没有可判的行为差；由接线判卷的文字钉守。
  // ③ 这一组钉在 `mutate-verify.mjs` 自己身上的三根针，针脚**一律以真换行开头**：锚点表与实现同一个文件，
  //    表里那两处 `apply` 字面量含同样的文字 ⇒ 不带头一个换行就命中 2 处，而 `replace` 只改第一处＝改到表自己身上
  //    （门当场喊「待复认」，09-28 实测；这是规则 236 那个自指族的第四次，也是本文件第三次）。表里写的是 `\n` 两个字符，凑不出真换行。
  {
    id: "changed-since-list-mode-always-filters",
    src: "scripts/mutate-verify.mjs",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "把「筛过的名单」当默认：没给 `--changed-since` 时「选中 0 条」是**未筛**，一律 filter 会让 `--list` 印 0 行，而吃这条取料的两把静态尺会把整张表读成「表空了」（空面与没取到是两个数，规则 129/196/222）",
    apply: (s) => s.replace(
      "\n  const rows = sinceArg === null ? MUTATIONS : MUTATIONS.filter((m) => derived.ids.includes(m.id));",
      "\n  const rows = MUTATIONS.filter((m) => derived.ids.includes(m.id));",
    ),
    expectFail: "派生可以只看名单不真跑：`--list --changed-since=<rev>` 只印选中的那些，且不碰任何源文件",
  },
  {
    id: "changed-since-derived-not-unioned-into-targets",
    src: "scripts/mutate-verify.mjs",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "算出派生名单却不并进 targets ⇒ 门照跑人手抄那几条，而输出里那句「选中 N/M」仍然印得出来的样子最骗人（规则 230「算出来不接」第四次命中，这次的接线在参数分流处）。第一版判卷写成 `toContain(那行文字)` ⇒ **存活过一次**：表里那份针脚字面替实现背了书（规则 236 第五次），现已改钉带真换行的跨行正则",
    apply: (s) => s.replace(
      "\nconst targets = [...new Set([...plan.targets, ...derived.ids])];",
      "\nconst targets = [...plan.targets];",
    ),
    expectFail: "接线：派生出来的 id 真的并进 targets（只写纯函数不接＝名单还是人手抄的）",
  },
  {
    id: "changed-since-face-passed-as-empty",
    src: "scripts/mutate-verify.mjs",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "把改动面传成空表（这里是最容易写错的一种：变量名打错成字面量）⇒ 派生恒 0 条，而派生行照样印得整整齐齐 ⇒ 「今天没东西要验」被读成「今天改动无关」。第一版**也存活过一次**：那条接线判卷是文字钉，被同文件里表自己的针脚字面满足 ⇒ 现改由 `--list --changed-since=<空树>` 那条行为判卷抓（与空树比＝全部文件都变了 ⇒ 选中必须等于整表）",
    apply: (s) => s.replace(
      "\n    derived = selectChangedEntries(MUTATIONS, changed);",
      "\n    derived = selectChangedEntries(MUTATIONS, []);",
    ),
    expectFail: "接线：派生出来的 id 真的并进 targets（只写纯函数不接＝名单还是人手抄的）",
  },
  {
    id: "changed-since-bad-rev-exits-zero",
    src: "scripts/mutate-verify.mjs",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "git 取不到改动面时退 0（把「取料坏」当成「没有要跑的锚点」）⇒ 一次拼错的 rev 长得像一次全绿；文本尺的三态在这里是 exit 码这一格（规则 222/227）",
    apply: (s) => s.replace(
      "\n    process.exit(2); // 取料坏 ≠ 空面",
      "\n    process.exit(0); // 取料坏 ≠ 空面",
    ),
    expectFail: "真跑：rev 取不到 ⇒ exit 2 并点名那个 rev（「取料坏」不许退化成「选中 0 条」）",
  },
  {
    id: "cost-rollup-not-fed-by-runner",
    src: "scripts/mutate-verify.mjs",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "汇总吃的是写死的空账本而不是 runner 自己那份 runsMs ⇒ 这一格永远印「spawn 0 次／没有分母」，读起来像「本次没跑」而实际跑了几百条。表与实现同文件，所以判卷钉跨行正则而不是 toContain（规则 236）",
    apply: (s) => s.replace(
      "const costRows = results.map((r) => ({ id: r.m.id, runsMs: r.runsMs }));\nconst costLine = costCell(costRollupOf(costRows));",
      "const costRows = results.map((r) => ({ id: r.m.id, runsMs: [] }));\nconst costLine = costCell(costRollupOf(costRows));",
    ),
    expectFail: "接线：汇总那一行吃的是 runner 自己那份 runsMs，且每个出口都带账本（表与实现同文件 ⇒ 钉跨行正则，规则 236）",
  },
  {
    id: "cost-run-test-uninstrumented",
    src: "scripts/mutate-verify.mjs",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "runTest 不再记这一次的时间 ⇒ 每个位置的中位整个消失，#37 的分母退回到「拿文件时长乘次数」那种推（这条咬的是取料源头，上一条咬的是接线出口）",
    apply: (s) => s.replace(
      "  const started = Date.now();\n  // 判卷配置跟着锚点走",
      "  // 判卷配置跟着锚点走",
    ),
    expectFail: "接线：汇总那一行吃的是 runner 自己那份 runsMs，且每个出口都带账本（表与实现同文件 ⇒ 钉跨行正则，规则 236）",
  },
  {
    id: "selector-scan-fed-empty-table",
    src: "scripts/mutate-verify.mjs",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "门那一步喂空表而不是整张锚点表 ⇒ 这一格永远 0/0 且永不红。表与实现同文件，所以判卷钉跨行正则而不是 toContain（规则 236）",
    apply: (s) => s.replace(
      "\n  const selectorScan = selectorAmbiguity(pointerEntries, ",
      "\n  const selectorScan = selectorAmbiguity([], ",
    ),
    expectFail: "接线：门自己那一步真拿整张表去数选择子，并把两份数一起交给措辞（只印不数＝这一格永远 0）",
  },
  {
    id: "run-mode-pattern-not-escaped",
    src: "scripts/mutate-verify.mjs",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "标题原文直接当 `-t` 的正则拼进去 ⇒ 真标题里的 ( ) [ ] . * + 变成通配与量词，选中的可能根本不是那条 killer 用例，而单价读数照旧好看",
    apply: (s) => s.replace(
      '\n  if (typeof pattern === "string" && pattern !== "") args.push("--testNamePattern=" + escapeTitlePattern(pattern));',
      '\n  if (typeof pattern === "string" && pattern !== "") args.push("--testNamePattern=" + pattern);',
    ),
    expectFail: "接线：testNamePattern 这一支要经转义，不许把标题当通配符拼进命令（表与实现同文件 ⇒ 必须行锚定，规则 236）",
  },
  {
    // 整表第一遍（09-28，949/949）唯一一条红就是它：`pc-face-change-named-shortcut` 的指针以 `-` 开头。
    id: "run-mode-dash-value-back-to-space-form",
    src: "scripts/mutate-verify.mjs",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "选择子换回 `-t <值>` 的空格写法 ⇒ 凡指针以 `-` 开头就被 CLI 当成旗标：实测那条 `--self-test …` 的基线一拍根本没跑（收尾行读不到），却退 1——旧读数只会喊「基线不绿」，把「取料坏」伪装成「判卷坏了」。这一条的 killer 必须挂**接线判卷**：第一版挂的是那条行为证人，而它自己同时跑两种写法 ⇒ 改生产行改不到它 ⇒ 实测「变异存活：测试全绿」（规则 236 又一次命中：判卷自己再算一遍＝对生产零分辨力）",
    apply: (s) => s.replace(
      '\n  if (typeof pattern === "string" && pattern !== "") args.push("--testNamePattern=" + escapeTitlePattern(pattern));',
      '\n  if (typeof pattern === "string" && pattern !== "") args.push("-t", escapeTitlePattern(pattern));',
    ),
    expectFail: "接线：testNamePattern 这一支要经转义，不许把标题当通配符拼进命令（表与实现同文件 ⇒ 必须行锚定，规则 236）",
  },
  {
    id: "run-mode-selector-check-dropped",
    src: "scripts/mutate-verify.mjs",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "不分模式一律塞 -t ⇒ 那 13 条「选不中／不唯一」的锚点从此只跑不存在的用例，等于整条保护被换成空转（两种跑法共存是刻意的，见第 169 页未证②）",
    apply: (s) => s.replace(
      '\n  const pattern = mode === "selector" ? String(m.expectFail ?? "") : "";',
      '\n  const pattern = String(m.expectFail ?? "");',
    ),
    expectFail: "接线：只有 selector 模式才塞 -t，其余必须走整文件（两种跑法共存是刻意的）",
  },
  {
    id: "vacuous-run-guard-dropped",
    src: "scripts/mutate-verify.mjs",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "「选中几条」这道闸整个摘掉 ⇒ 这条闸正是 `-t` 上线唯一的安全带：摘掉后一次改名就能让整条锚点永远绿着跑完（vitest 对无匹配的 -t 退 0）",
    apply: (s) => s.replace(
      '\n    if (vacuous === null && runReadingIsBad(mode, r.selected)) {',
      "\n    if (false) {",
    ),
    expectFail: "接线：每一拍都过共用的那道读数闸，闸的拍数与 runTest 调用点相对相等（选不中、选多条都不许读成绿）",
  },
  {
    // 与上一条咬同一处接线、但失真方向不同（规则 226：同一不变量的两种失真各要一条变异）：
    // 上面是「整个摘掉」，这条是「退回只否 0 条」——后者不留任何痕迹，因为 0 条那一半照常红。
    id: "selector-guard-ignores-multi-hit",
    src: "scripts/mutate-verify.mjs",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "闸退回「只有 0 条／没读到才判坏」⇒ 选中 2 条以上的那一拍被读成测过了，可红的未必是本锚点那条 killer 用例：vitest 的 `-t` 匹配整条标题（describe 前缀也算），而体检数的是 it 字面量——两个分母本来就不是一回事",
    apply: (s) => s.replace(
      '\n    if (vacuous === null && runReadingIsBad(mode, r.selected)) {',
      '\n    if (vacuous === null && mode === "selector" && (r.selected === null || r.selected === 0)) {',
    ),
    expectFail: "接线：每一拍都过共用的那道读数闸，闸的拍数与 runTest 调用点相对相等（选不中、选多条都不许读成绿）",
  },
  {
    id: "unverified-list-not-routed-through-exit",
    src: "scripts/mutate-verify.mjs",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "名单不进那条同步写满的出口 ⇒ 几百条 id（几 KB）交给异步队列后就 `process.exit()`，只剩内核缓冲那一截，" +
      "而汇总行照样印「未证 N 条」——读者以为名单发全了，按残缺的名单补跑（规则 241 实测砍过 920 行的 --list）",
    apply: (s) => s.replace(
      '// 用 `console.log` 交给异步队列再 `process.exit()` 就是拿丢掉尾巴的运气当读数（规则 241）。\nemitAndExit(redText + unvText + timing + ',
      '// 用 `console.log` 交给异步队列再 `process.exit()` 就是拿丢掉尾巴的运气当读数（规则 241）。\nemitAndExit(unvText + timing + ',
    ),
    expectFail: "接线：未证名单走同步写满的那条出口，UNVERIFIED 标记只印一次",
  },
  {
    id: "unverified-class-read-from-prose",
    src: "scripts/mutate-verify.mjs",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "按 `why` 的措辞认未证的类别 ⇒ 改一句文案就分错类，「等别人落库」被印成「现在就能补跑」，读者白跑一趟还把那条读成已验；" +
      "分类必须认字段（stopped／unloadable／refused 名单）",
    apply: (s) => s.replace(
      '    id: r.m.id,\n    cls: typeof r.unloadable === "string" ? "judge-unloadable" : r.stopped === true ? "budget-stopped" : "judge-in-flight",',
      '    id: r.m.id,\n    cls: typeof r.unloadable === "string" ? "judge-unloadable" : String(r.why ?? "").includes("预算") ? "budget-stopped" : "judge-in-flight",',
    ),
    expectFail: "接线：未证名单走同步写满的那条出口，UNVERIFIED 标记只印一次",
  },
  {
    id: "restore-byte-check-neutered",
    src: "scripts/mutate-verify.mjs",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "把还原那一格的判据摘掉（换成恒不成立）⇒ 盘上留着半个突变、或被写成别的内容，这条照样算绿；" +
      "而收尾那句 `git diff HEAD --quiet` 只在**整轮跑完**时看总账，看不出「第 517 条还原时写歪了」这一格。" +
      "这一拍换成字节比对本来就是拿「更强的证据」换掉「更贵的一拍」，换弱了就得有人喊",
    apply: (s) => s.replace(
      '    const restoreProblem = restoreDiffProblem(original, readFileSync(srcAbs, "utf8"));\n    if (restoreProblem !== null) return red("restore-mismatch", `还原未逐字节相同：${restoreProblem}`);',
      '    const restoreProblem = restoreDiffProblem(original, readFileSync(srcAbs, "utf8"));\n    if (false) return red("restore-mismatch", `还原未逐字节相同：${restoreProblem}`);',
    ),
    expectFail: "接线：每条锚点只付两拍，还原那一拍不再 spawn 判卷",
  },
  {
    id: "tree-guard-refusal-not-wired",
    src: "scripts/mutate-verify.mjs",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "判据还在、结论不接 ⇒ 拒跑那句话再也不印（五处接线断言都认这个句子，但它们只在真跑那支里跑，" +
      "机器证人缺位时这一格就是「尺与针脚不同笔」的现行样本）。本条同时回答 #8 的前置疑问：" +
      "变异机吃不吃 `scripts/*.mjs` 这一面——它杀得动就是吃得下",
    apply: (s) => s.replace("if (TREE.kind === \"refused\") {\n  console.error(", "if (false) {\n  console.error("),
    expectFail: "主检出里真跑 ⇒ exit 2、说清是主检出、且盘上一个字节都没动",
  },
  {
    id: "pack-sources-count-not-wired",
    src: "scripts/mutate-shards.ts",
    test: "tests/mutate-shards.test.ts",
    desc: "判据在、接线断：编排器不再把**显式给的**来源数传进去 ⇒ 给了坏文件也照印「没有权重来源」。" +
      "只有真跑 CLI 那支用例看得见（纯函数那两支照绿），所以这条与上一条各红一半。" +
      "派生面（上一轮本标签的片原文）刻意不计进这一位：第一次跑它本来就不在盘上，那不是取料坏",
    apply: (s) => s.replace("packingCell(rows, cost.weights, cost.explicitCount)", "packingCell(rows, cost.weights)"),
    expectFail: "真跑 --dry-run：给了 --cost-logs 就说清权重与来源，不给就说没有来源",
  },
  {
    id: "shard-ghost-ids-accepted",
    src: "scripts/mutate-shards.ts",
    test: "tests/mutate-shards.test.ts",
    desc: "不核「给的 id 在这张表上吗」⇒ 拼错的锚点 id 被 filter 静默丢掉，剩下的条数照样分片、照样跑，" +
      "而读者以为那几条验过了（取料坏要说成取料坏，不能退化成「少跑几条」）",
    apply: (s) => s.replace("if (ghost.length > 0) {", "if (false) {"),
    expectFail: "给了不在表上的 id ⇒ 拒",
  },
  {
    id: "shard-host-split-gate-dropped",
    src: "scripts/mutate-shards.ts",
    test: "tests/mutate-shards.test.ts",
    desc: "算出「同一判卷宿主被摊到两片」却不拦 ⇒ 两个真进程并发真跑同一份判卷文件。" +
      "09-29 实测：轮转切法把 `tests/head-cert-deps.test.ts` 摊进四片，其中一片的 `cert-lock-stale-not-unlinked` " +
      "因认证树注册名（按提交 sha 定）撞车，被归进「基线那一档就不绿」，同一条串行复跑 ⇒ `✅` 1.1s（钉调用点要连同它的入参，规则 230）。" +
      "**这句本身也是第 188 页的教训**：文案里原样引用机器那行诊断文字，会被读日志的那把尺当成诊断信号——" +
      "散文不许冒充读数（本条原先写的正是那句，现已改写）。" +
      "**本条第一版存活过一次**：killer 挂的是那条文字接线钉，而 `if (split.length > 0)` → `if (false)` 之后" +
      "正则要的那两行还在原地 ⇒ 测试全绿。现挂**行为证人**：判卷用 `--force-split=roundrobin` 造出同宿主被拆的输入，" +
      "闸门被解除时那一跑会放行 ⇒ 断言当场红（第 186 页同一次课：存活不是没人守，是这个形状没有可达的输入）",
    apply: (s) => s.replace("if (split.length > 0) {", "if (false) {"),
    expectFail: "同一宿主被摊到两片 ⇒ 行为上当场拒（默认切法同输入放行）",
  },
  {
    id: "shard-duplicate-tree-gate-dropped",
    src: "scripts/mutate-shards.ts",
    test: "tests/mutate-shards.test.ts",
    desc: "不去重 `--trees` ⇒ 同一棵树被两片同时就地改源文件、互踩 `.mutbak`，" +
      "还原判据看的是「字节等不等」而不是「是谁写的」，于是两边的收尾复核都能假绿",
    apply: (s) => s.replace("if (distinct.length !== f.trees.length) {", "if (false) {"),
    expectFail: "同一棵树填两遍 ⇒ 拒",
  },
  {
    id: "shard-dirty-tree-accepted",
    src: "scripts/mutate-shards.ts",
    test: "tests/mutate-shards.test.ts",
    desc: "脏树检查算出条数却不回理由 ⇒ 别人在飞的树被当片用，突变就地改它、还原时把别人的改动一起抹掉。" +
      "这条理由与「不是 git 工作树」分两格印，混了就没人知道该去清哪一格",
    apply: (s) => s.replace('if (dirty !== "") return', 'if (dirty !== "" && false) return'),
    expectFail: "放一个在飞文件＝点名条数",
  },
  {
    id: "shard-log-path-not-in-verdict-line",
    src: "scripts/mutate-shards.ts",
    test: "tests/mutate-shards.test.ts",
    desc: "每片原文落了盘，但那行读数不印路径 ⇒ 合并层报「基线红」时读者手上只有结论、没有证据。" +
      "第 187 页落地当场就是靠这句路径才发现：片 1 的原文写着 10/10 全杀，而判定行写着基线红——" +
      "红的是**尺**（描述冒充了诊断行），不是被测面（「算出来」还要「拿得到」，规则 211/241 同族）。" +
      "第 190 页起这句印在**计划行**（开跑前就有），判定行不再重复",
    apply: (s) => s.replace("原文=${logs[i]}", "原文=（未印路径）"),
    expectFail: "每片的原文落到**读者拿得到的路径**",
  },
  {
    id: "shards-cli-space-form-value-leaks-as-id",
    src: "scripts/mutate-shards.ts",
    test: "tests/mutate-shards.test.ts",
    desc: "空格写法收了值却不推进游标 ⇒ 那个值下一轮被当成**锚点 id**。" +
      "第 189 页现场：我照 `mutate-verify` 那份手册敲 `--budget-ms 480000`（机器只认空格写法），" +
      "编排器却只认连写 ⇒ 480000 要么被判「未知 id」要么被筛进名单，而参数看起来是给了的。" +
      "同一扇门两种形状＝第十三族在 CLI 上的样子：包装层的旗标形状要跟被包那层一致",
    apply: (s) => s.replace("else { take(name, argv[i + 1]); i += 1; }", "else { take(name, argv[i + 1]); }"),
    expectFail: "且值不许漏成位置 id",
  },
  {
    id: "shards-cli-missing-value-unflagged",
    src: "scripts/mutate-shards.ts",
    test: "tests/mutate-shards.test.ts",
    desc: "`--budget-ms` 后面缺值时不报错 ⇒ 一路走到 `Number(undefined)＝NaN`，" +
      "报出来的是「值不是数」而不是「旗标漏了值」——读者会去查自己拼没拼对数字，" +
      "而真正少的是那个值（归因守错格，规则 224）。缺值与值坏要两句话",
    apply: (s) => s.replace("if (value === undefined) {", "if (false) {"),
    expectFail: "空格写法后面缺值 ⇒ 点名「后面没有值」，不许退化成 NaN 或「按缺省跑」",
  },
  {
    id: "shards-cli-log-append-dropped",
    src: "scripts/mutate-shards.ts",
    test: "tests/mutate-shards.test.ts",
    desc: "片原文仍然只在跑完后一次性落盘（把逐块 append 摘掉）⇒ 七八分钟的整表跑里读者 tail 不到东西，" +
      "而外层超时把编排器杀掉时四片原文一起丢——机器那一层的突变还原是它自己的事，救不了这里的读数。" +
      "**这一条只有接线证人，没有行为证人**：『边跑边写』与『跑完再写』在同一份最终文件上不可分辨，" +
      "要分辨得去观察中途时刻，那是把判卷押在调度上（规则 256）",
    apply: (s) => s.replace("appendFileSync(logPath, text)", "void logPath"),
    expectFail: "原文是**开跑前就建好、逐块追加**的（不是跑完一次性写），且计划行先印路径",
  },
  {
    id: "shards-cli-shard-log-not-truncated",
    src: "scripts/mutate-shards.ts",
    test: "tests/mutate-shards.test.ts",
    desc: "落盘改成追加却不截断 ⇒ 同一个锁标签跑第二遍时，新原文接在上一遍后面，" +
      "于是 `classify` 会同时看见两跑的汇总行（判红/判绿能互相顶掉），端到端那条证人也会读到上一遍的旧块。" +
      "追加型日志的「一次跑＝一份新文件」是它的计数前提（规则 220：计数类不许留旧账）",
    apply: (s) => s.replace('for (const p of logs) writeFileSync(p, "");', 'for (const p of []) writeFileSync(p, "");'),
    expectFail: "原文是**开跑前就建好、逐块追加**的（不是跑完一次性写），且计划行先印路径",
  },
  {
    id: "verify-per-anchor-cost-not-printed",
    src: "scripts/mutate-verify.mjs",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "逐条结果行不带那一格 ⇒ 整表汇总仍然印「最贵一条」，但「这条锚点值几秒」回到只能推。" +
      "第 190 页实测按条数装箱：四片各 252 条跑出 323.6／391.1／419.9／443.0s（极差 +37%）⇒ 条数不是重量，" +
      "而 #28 要的取料面就是这一格（账本 `runsMs` 一直在记，只是没有出口＝规则 245 那一族）。" +
      "针脚含真换行：表与实现在同一份文件里，单行搜索串会先撞上这张表自己那份引文（规则 247）",
    apply: (s) => s.replace("${m.desc} ｜${anchorCostCell(r.runsMs)}`);\n  if (r.ok !== true)", "${m.desc}`);\n  if (r.ok !== true)"),
    expectFail: "接线：逐条结果那一行真把账本印出去了（表与实现同文件 ⇒ 行锚定，规则 236/247）",
  },
  {
    id: "shard-cli-pack-cell-not-printed",
    src: "scripts/mutate-shards.ts",
    test: "tests/mutate-shards.test.ts",
    desc: "算了权重却不印那一格 ⇒ 读者只能看到「切法=host」，分不清这一轮是按秒装的还是首跑按条数装的，" +
      "而这两者的墙钟期望差 37%（「算出来」还要「拿得到」，规则 211/241 同族；本条由**真跑 --dry-run** 那条证人杀，不是钉文字）",
    apply: (s) => s.replace("${packCell} · 每片一棵树，锁标签", "每片一棵树，锁标签"),
    expectFail: "真跑 --dry-run：给了 --cost-logs 就说清权重与来源，不给就说没有来源",
  },
  {
    id: "wiring-gate-fed-empty-table",
    src: "scripts/mutate-verify.mjs",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "门这一步被喂空表 ⇒ 那一行照印「接上 0／疑空 0／判不了 0」，看起来比不印更干净（第 165 页那条「只印不数＝永远 0」的同款形状）。" +
      "针脚带真换行是自-hosted 的硬性写法：不带就会先改到这张表自己那一行",
    apply: (s) => s.replace("  const wiringRows = auditPointerWiring(entries.map((e) => ({\n", "  const wiringRows = auditPointerWiring([].map((e) => ({\n"),
    expectFail: "接线：门那一步真拿整张表去数，且「变异存活」那条红接得上 wiringHint（只印不接＝这一格永远不响）",
  },
  {
    id: "exits-hint-guard-dropped",
    src: "scripts/mutate-verify.mjs",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "存活提示的出口那一半被摘掉（或阈值挪到 0）⇒ 要么对每条锚点都喊、要么永远不喊，" +
      "而第 262 页那条存活本来能被这句话直接指到成因（规则 329）",
    apply: (s) => s.replace('\n  const exitCell = r !== undefined && typeof r.returns === "number" && r.returns >= 2', '\n  const exitCell = false'),
    expectFail: "接线：门那一行要连着印「可数面／多出口数」，wiringHint 那条守卫的结构不许漂",
  },
  {
    id: "exits-census-not-spoken",
    src: "scripts/mutate-verify.mjs",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "普查行把可数面与多出口那两格印成常数 ⇒ 这把尺开了张却没人读得到真数（第 263 页现读 961／533，" +
      "而 961＋175＋3＝1139 这个同分母等式也就没人核了）",
    apply: (s) => s.replace('\n    `｜出口数可数 ${String(countable.length)} 条，其中针脚长在「≥2 条 return」的函数里 ${String(multiExit.length)} 条` +', '\n    `｜出口数可数 0 条` +'),
    expectFail: "接线：门那一行要连着印「可数面／多出口数」，wiringHint 那条守卫的结构不许漂",
  },
  /* ── 第 333 页 · #40：派生必然为 0 那一格，提示要在开树之前出声 ───────────────── */
  {
    id: "mutate-pre-tree-hint-not-printed",
    src: "scripts/mutate-verify.mjs",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "把主树那句提示的打印摘掉 ⇒ 纯函数还在、派生还是 0 条，但人要等子进程印 `ℹ️ 选中 0 条` 时才知道，"
      + "而那时 worktree add 与 cp -al node_modules 已经付过钱（第 331 页实测：随后整表跑了 2121.7s）",
    apply: (s) => s.replace("prevRev });\n      if (hint !== null) console.log(", "prevRev });\n      if (hint !== null && false) console.log("),
    expectFail: "★接线（顺序那一半）：主树在 `worktree add` **之前**调它——只在子进程里喊＝钱已经付了才响",
  },
  {
    id: "mutate-pre-tree-gitok-hardcoded",
    src: "scripts/mutate-verify.mjs",
    test: "tests/mutate-verify-gates.test.ts",
    desc: "把 gitOk 从 diff 的退出码挪成常量 ⇒ 两个方向都坏：写死 true 时一次 git 失败（rev 拼错、仓外路径）被读成「派生必然 0」，"
      + "写死 false 时这一格永远只报「取不到」＝永远不出声（「没取到」与「已知为空」是两个数，规则 196/239）",
    apply: (s) => s.replace("split(\"\\n\"), gitOk: diff.status === 0", "split(\"\\n\"), gitOk: false"),
    expectFail: "★接线（取料那一半）：gitOk 吃的是 diff 的退出码，不是常量",
  },
];
