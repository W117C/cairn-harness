import { resolve } from "node:path";

/** 某文件相对 HEAD 的状态：干净 / 有工作树改动 / 未跟踪。 */
export type HeadState = "clean" | "dirty" | "untracked";

export interface EntryInfo {
  srcRel: string;
  srcState: HeadState;
  testRel: string;
  testState: HeadState;
}

export interface Disposition {
  kind: "run" | "refused" | "unverified";
  why?: string;
}

/**
 * 变异条目开跑前该做什么。三支分开，是因为它们的**后果不同**：
 * - `refused`：被测源文件不在 HEAD 里或有改动 ⇒ 突变中途崩溃没有 HEAD 可回滚，必须拒绝（调用方保持抛死）。
 * - `unverified`：源文件没问题，但**判卷测试文件**在飞 ⇒ 这条此刻量不出东西。它既不是"变异存活"
 *   （那会误判断言无分辨力）也不是"基线红"（那会误判 HEAD 坏了）——多会话并发下这一支不分开，
 *   真回归信号就会被别人的在飞编辑伪装掉（2026-09-19 实跑踩过：两条正常条目报成一死一红）。
 *   判卷文件只读不写，所以它不需要 refused 级别的兜底。
 * - `run`：两边都干净。
 */
export function entryDisposition(info: EntryInfo): Disposition {
  if (info.srcState !== "clean") {
    const why = info.srcState === "untracked"
      ? `${info.srcRel} 未跟踪（不在 HEAD 里）—— 变异中途崩溃无回滚兜底，拒绝`
      : `${info.srcRel} 相对 HEAD 有改动——属在飞改动集，拒绝变异`;
    return { kind: "refused", why };
  }
  if (info.testState !== "clean") {
    const how = info.testState === "untracked" ? "未跟踪" : "相对 HEAD 有改动";
    return { kind: "unverified", why: `判卷文件 ${info.testRel} ${how}——该条不可判（并发在飞不得伪装成变异表退化）` };
  }
  return { kind: "run" };
}

export interface TreeGuardInput {
  /** 当前这棵树的绝对根。 */
  root: string;
  /** `git rev-parse --git-dir` 的原样输出。 */
  gitDir: string;
  /** `git rev-parse --git-common-dir` 的原样输出。 */
  commonDir: string;
}

export type TreeGuard = { kind: "go" } | { kind: "refused"; why: string };

/**
 * 「这棵树能不能改」——比 `entryDisposition` 更高一层的闸，因为它问的不是某个文件而是**整棵树**。
 *
 * 动因：本门 `verifyEntry` 是**就地改源文件**（`cpSync` 备份 → `apply` 写回），而实测过的收尾手段
 * 拦不住超时——`runTest` 走 `execFileSync` 同步阻塞整个事件循环，外层超时发来的 SIGTERM 进不来，
 * 突变体与 `.mutbak` 一起留在 `src/` 里（verifyEntry 上方「实测边界（09-23）」记的就是这次，
 * 本机也留着一枚 `.worktrees/verify-dd3af4e/scripts/lib/mutate-gates.ts.mutbak` 作证）。主检出那份工作树里
 * 可能是别人正在写的活，也可能是自己没提交的活，两者都经不起「就地改」这一下。
 *
 * 判据只问 git 自己给的两条路径：linked worktree 里 `--git-dir`（`.git/worktrees/<名>`）与
 * `--git-common-dir`（主树那份 `.git`）**不是同一处**；主检出里两者都指 `.git`。
 * 读不出答案按主检出处置（fail-closed）——证明不了自己是一次性的，就不许动盘。
 *
 * 两边都按 root 解析成绝对路径再比：主树给的是**相对** `.git`、链接树给的是绝对路径，
 * 直接比字符串会把「相对 vs 绝对」这个格式差误读成「两棵树」（`toolLockPath` 栽过同一处，
 * 见 tests/head-cert-deps.test.ts 里那条锁路径用例）。
 */
export function mutateTreeGuard(input: TreeGuardInput): TreeGuard {
  const g = input.gitDir.trim();
  const c = input.commonDir.trim();
  if (g === "" || c === "") {
    return {
      kind: "refused",
      why: "取不到这棵树的 git 归属（`git rev-parse --git-dir/--git-common-dir` 读不出）——证明不了它是一次性的树，拒跑（就地改源文件这道风险不许靠猜）",
    };
  }
  if (resolve(input.root, g) === resolve(input.root, c)) {
    return {
      kind: "refused",
      why: `这棵是**主检出**（git-dir 与 git-common-dir 同指 ${c}）——本门就地改源文件，被外层超时杀掉就收不回来，` +
        "突变体与 .mutbak 会留在 src/ 里。改法：去一棵一次性 worktree 跑（`pnpm mutate-verify` 已按此接线，" +
        "它会把本脚本重新 exec 到 .worktrees/ 下的专用树里），或手动 `git worktree add --detach .worktrees/<名> HEAD` 后在那棵树里执行本脚本。",
    };
  }
  return { kind: "go" };
}

/**
 * 整跑前的预检：把全部 `refused` 一次列出来，**一条都不跑**就退出。
 *
 * 动因（2026-09-23 真装 worktree 的 HEAD 整跑实测）：判定原先只在逐条循环里做，于是
 * 跑到第 k 条才撞上「`src/tools/snapshot.ts` 未跟踪」——前面 19 分钟全烧掉，抛死后
 * 账本里连一条读数都不留（`pnpm facts` 看不见这次跑过）。同一份信息在开跑前是免费的。
 * 注意只 `refused` 参与预检：判卷文件在飞（`unverified`）**不该**拦住整跑，
 * 那会让别人的一个未提交测试文件把变异门整体停摆。
 */
export interface PreflightEntry {
  id: string;
  srcRel: string;
  srcState: HeadState;
  testRel: string;
  testState: HeadState;
}

export function preflightRefusals(entries: readonly PreflightEntry[]): Array<{ id: string; why: string }> {
  return entries
    .map((e) => ({
      id: e.id,
      d: entryDisposition({ srcRel: e.srcRel, srcState: e.srcState, testRel: e.testRel, testState: e.testState }),
    }))
    .filter((x) => x.d.kind === "refused")
    .map((x) => ({ id: x.id, why: x.d.why ?? "" }));
}

/** 预检之后**还能跑哪些**与**哪些被跳过**。
 *
 *  为什么要有这个函数（2026-09-23 HEAD 整跑实测）：预检最初被写成「有条目被拒 ⇒ 一条都不跑」，
 *  动机是不烧 19 分钟撞在第 k 条上。但后果是 **别人一个未跟踪的 `src/tools/snapshot.ts`
 *  就把 696 条锚点全部停摆**——那些锚点protecting的是别的、与在飞改动毫无关系的文件。
 *  于是「判据在飞」这段时间里整张变异表在假装守护，而红门只报一句「拒绝 1 条」，
 *  读的人以为保护还在。
 *  正确的形状是**逐条**：不安全的那几条按「未证」记账（与判卷文件在飞同一条通道），
 *  其余照跑；表仍然非零退出/仍然在汇总里出声，未证 ≠ 通过。
 *  安全性一点没让：被跳过的正是「崩溃后无 HEAD 可回滚」的那些 src，一条都不会被写。 */
export function splitRunnable(entries: readonly PreflightEntry[]): {
  runnable: string[];
  refused: Array<{ id: string; why: string }>;
} {
  const refused = preflightRefusals(entries);
  const refusedIds = new Set(refused.map((r) => r.id));
  return {
    runnable: entries.filter((e) => !refusedIds.has(e.id)).map((e) => e.id),
    refused,
  };
}

/** 一条锚点的备份文件名（与调用方 `cpSync(src, `${src}.mutbak`)` 同一个拼法，只此一处）。 */
export function backupPathOf(srcRel: string): string {
  return srcRel + ".mutbak";
}

/**
 * 上一次跑没干净收尾留下的备份。
 * 动因（2026-09-23 实测）：我把一条整跑 `kill` 在中途，工作树里留下 `src/agent/plugins/skills.ts.mutbak`
 * ——源文件被 finally 还原了，但收尾校验查的是 `git status --porcelain -- <精确 src 路径>`，
 * 同名 `.mutbak` 根本不在匹配范围内 ⇒ **残留无人报**。而它下一次会被 `cpSync` 直接覆盖，
 * 那份"崩溃前的原始内容"是唯一能证明还原正确的东西。
 * `exists` 注入而不直接读盘：判卷面（哪些算残留）与 I/O 分开，两支才各自可测。
 */
export function leftoverBackupPaths(srcRels: readonly string[], exists: (rel: string) => boolean): string[] {
  return [...new Set(srcRels.map(backupPathOf))].filter((p) => exists(p));
}

/** 残留 `.mutbak` 该怎么处置。**三条内容都在盘上 ⇒ 可以按证据判**，这是它比信号处理器可靠的原因
 *  （实测 09-23：SIGTERM 打到 node 后 1.5s 内什么都没跑——`runTest` 的 `execFileSync` 阻塞事件循环，
 *  JS 处理器要等子进程结束；等不到就要等 SIGKILL，那时谁都没机会还原）。
 *  - `restore`：备份 == HEAD、当前 != HEAD，**且**当前这份正好等于本表某条锚点作用在备份上产出的突变体
 *    ⇒ 是我们上次没还原的那份。`isOurMutant` 这一步不能省：少了它，「备份之后别人自己改了同一个文件」
 *    会被我一笔盖掉——那正是本仓最忌的越权；
 *  - `drop-backup`：备份 == HEAD 且当前 == HEAD ⇒ 源文件已经是对的，只剩一个过期备份，删掉即可；
 *  - `manual`：其余一切（备份 != HEAD、文件不在 HEAD 里、当前内容对不上任何锚点、源文件不见了）。 */
export type LeftoverAction = "restore" | "drop-backup" | "manual";

/** 纯判据：只说「该自愈」还是「交给人」，盘上的覆盖动作全在调用方（判据要能离线断言）。 */
export function leftoverActionOf(
  head: string | null, backup: string | null, current: string | null, isOurMutant: boolean,
): LeftoverAction {
  if (head === null || backup === null) return "manual"; // 没有 HEAD 基线可比 ⇒ 谁都不许盖
  if (backup !== head) return "manual"; // 备份不是 HEAD 态：里面可能是别人未提交的原件
  if (current === head) return "drop-backup";
  if (current === null || !isOurMutant) return "manual";
  return "restore";
}

/** 自我预算（毫秒）：`--budget-ms <n>` 优先于 env `DSH_MUTATE_BUDGET_MS`；0/缺省 = 不限。
 *  非法值**不静默当「没设」**（`classify-unknown-flag` 同族）：写的人以为自己给了预算，
 *  实际却在跑全表 ⇒ 被外层超时杀在突变那一拍。所以非法值要出声，由调用方打印。 */
export function budgetMsOf(
  args: readonly string[], envValue: string | undefined,
): { ms: number; warning: string | null } {
  const parse = (raw: string | undefined, label: string): { ms: number; warning: string | null } | null => {
    if (raw === undefined || raw === "") return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return { ms: 0, warning: `${label}=${JSON.stringify(raw)} 不是正整数 ⇒ 按「不限」跑` };
    return { ms: Math.round(n), warning: null };
  };
  const i = args.indexOf("--budget-ms");
  const flag = i >= 0 ? args[i + 1] : undefined;
  if (i >= 0 && flag === undefined) return { ms: 0, warning: "--budget-ms 后面没有值 ⇒ 按「不限」跑" };
  return parse(flag, "--budget-ms") ?? parse(envValue, "DSH_MUTATE_BUDGET_MS") ?? { ms: 0, warning: null };
}

// ---- 针脚静态预检：不跑测试就知道某条锚点还摸不摸得到代码 ----
// 动因（2026-09-19 实跑，220 条里揪出 2 条）：把被锚定的实现搬进共用原语（text-budget）后
// 忘了改指锚点 ⇒ needle 不再出现，那条变异变成**空操作**。跑它会得到「突变未生效」的红，
// 但这要等整跑；而整跑常被并发堵几天——于是这段时间里这条锚点在假装守护。
// 静态检是秒级的，因此可以进门禁（mutate-needles-check），把「重构后改指」变成机械要求。

/** 针脚在源文件里逐字出现的次数。特殊值：-1 源文件读不到；-2 空针脚（永远改不动任何东西）。 */
export function needleHits(needle: string, source: string | null): number {
  if (source === null) return -1;
  if (needle === "") return -2;
  return source.split(needle).length - 1;
}

export interface NeedleEntry {
  id: string;
  srcRel: string;
  needle: string;
}

export interface NeedleProblem {
  id: string;
  srcRel: string;
  hits: number;
  needle: string;
}

/** 严重度分两档，因为后果不同：
 *  - `blocking`：hits 0 / 源文件读不到 / 空针脚 ⇒ 这条变异**是空操作**，它在假装守护，必须红。
 *  - `warn`：hits > 1 ⇒ 锚点仍能改到代码，但 `String.replace` 只改第一处，可能改到同名兄弟行；
 *    存量条目里有几条属这种（各自都还能杀测试），不当场判死，但必须**打印出来**让人复认——
 *    静默吞掉它就等于回到「假装守护」。 */
export function needleSeverity(hits: number): "ok" | "blocking" | "warn" {
  if (hits === 1) return "ok";
  return hits > 1 ? "warn" : "blocking";
}

/** 逐条核针脚，返回所有 hits ≠ 1 的（调用方用 needleSeverity 分档处置）。 */
export function auditNeedles(entries: readonly NeedleEntry[], readSrc: (rel: string) => string | null): NeedleProblem[] {
  const cache = new Map<string, string | null>();
  const problems: NeedleProblem[] = [];
  for (const e of entries) {
    if (!cache.has(e.srcRel)) cache.set(e.srcRel, readSrc(e.srcRel));
    const hits = needleHits(e.needle, cache.get(e.srcRel) ?? null);
    if (hits !== 1) problems.push({ id: e.id, srcRel: e.srcRel, hits, needle: e.needle });
  }
  return problems;
}

/** 一行可机读的判读结论（门的输出格式：id + 源 + 原因 + 针脚前 60 字）。
 *  `cause` 只影响 hits===0 那一档，其余档印空串（见 `needleMoveCauseSuffix`）。 */
export function needleProblemLine(p: NeedleProblem, cause?: NeedleCause): string {
  const why = p.hits === -1
    ? "源文件读不到"
    : p.hits === -2
      ? "空针脚（改不动任何东西）"
      : p.hits === 0
        ? "针脚已不在源文件里（变异必然不生效——多半是被锚定的实现搬走了，改指它）"
        : `针脚命中 ${String(p.hits)} 处（replace 只改第一处，需人工复认改到的是哪一处）`;
  return `${p.id} — ${p.srcRel} — ${why}：${JSON.stringify(p.needle.slice(0, 60))}${needleMoveCauseSuffix(p, cause)}`;
}

/** 「谁把这段针脚搬走的」的三态。判据保持纯函数（同 `untrackedAnchorPaths` 的 `isTracked` 口径），
 *  git 查询由调用方做完再喂进来——本模块不许偷偷 spawn 子进程。
 *
 *  为什么要这一栏（2026-09-27 实测）：门只报「针脚已不在源文件里」时，读的人会按**文件**猜归属，
 *  于是一批红里有几条被记到别人头上（本仓第 127/128 页就是这么指错人的：`skills.ts` 恰好也是
 *  别人在飞的文件，而那条死针脚其实是我自己两页之前留下的）。
 *  一条 `git log -S<needle> -- <src>` 就把归属变成事实：谁的最后一次提交让这段文字消失，就归谁。 */
export type NeedleCause = { sha: string; subject: string } | null;

/** 三态必须分开印——**"没查" 会被读成 "没人搬走"**（本仓「缺省要出声」那一族）。 */
export function needleMoveCauseSuffix(p: NeedleProblem, cause: NeedleCause | undefined): string {
  if (p.hits !== 0) return "";
  if (cause === undefined) return " ｜成因未取（git 查不到 ⇒ 不等于没人搬走）";
  if (cause === null) return " ｜这段文字在该路径的历史里从未出现 ⇒ 表写错路径，或这条锚点从写下起就没生效过";
  return ` ｜谁搬走的：${cause.sha} ${cause.subject}`;
}

/** 取「谁让这段针脚在该路径上消失」：pickaxe 找最后一次改变其出现次数的提交。
 *  `runGit` 由调用方注入（本模块不许自己 spawn 子进程；同 `untrackedAnchorPaths` 的 `isTracked` 口径），
 *  返回值三态：对象＝查到；`null`＝这段文字在该路径历史里从未出现；`undefined`＝git 没答上来（含报错）。 */
export function needleMoveCause(
  p: NeedleProblem,
  runGit: (args: readonly string[]) => string | null,
): NeedleCause | undefined {
  if (p.hits !== 0) return undefined; // 只谈"整段没了"；warn 档的针脚还在盘上
  const out = runGit(["log", "--format=%h\u001f%s", "-S", p.needle, "-1", "--", p.srcRel]);
  if (out === null) return undefined;
  const line = out.trim().split("\n")[0] ?? "";
  if (line === "") return null;
  const [sha = "", ...rest] = line.split("\u001f");
  return { sha, subject: rest.join(" ").slice(0, 90) };
}



// ---- 锚点的两个文件面在不在版本控制里 ----
// 动因（2026-09-23，#37 的根因）：锚点的 `src` 指向**未跟踪**文件时，主树跑 `--check-needles` 读的是
// 盘上那份 ⇒ 报「全部锚点针脚可判定 ✅」；而同 HEAD 的隔离 worktree 里那个文件根本不存在 ⇒ 同一道门
// 报「源文件读不到」红。⇒ **主树永远看不见这一类缺陷**，而「锚点先落地、被测码从未入库」正是本仓
// 点名过的一种假守护。判据因此挂在 git 的事实上（调用方一次 `git ls-tree HEAD`），不挂在盘上。
// `test` 同族且更阴：判卷文件未入库时，干净 HEAD 上那条锚点连基线都跑不出来（vitest 对不存在的文件
// exit 1「No test files found」），报告却落在「基线就不是全绿（不应发生）」那一句 ⇒ **从未入库被伪装成测试挂了**。
export interface UntrackedAnchorPath {
  id: string;
  path: string;
  /** 哪一面：决定判读行怎么说、修法指哪份文件。 */
  what: "被测面" | "判卷";
}

/** 路径未被 git 跟踪的锚点（按喂入顺序）。判据保持纯函数（可单测）；`isTracked` 由调用方喂真 git 结果。 */
export function untrackedAnchorPaths(
  items: readonly UntrackedAnchorPath[],
  isTracked: (rel: string) => boolean,
): UntrackedAnchorPath[] {
  return items.filter((p) => !isTracked(p.path));
}

/** 一行判读结论：点名「从未入库」，与「实现搬走了」分开——两种红的修法相反（前者提交那份文件，后者改指针脚）。 */
export function untrackedAnchorLine(p: UntrackedAnchorPath): string {
  const symptom = p.what === "判卷"
    ? "干净 HEAD 上这条锚点连基线都跑不出来，报告却写成「基线就不是全绿（不应发生）」"
    : "干净 HEAD 上这条锚点必然「源文件读不到」：它守护的代码从未入库";
  const target = p.what === "判卷" ? "判卷文件" : "源文件";
  return `${p.id} — ${p.what} ${p.path} — 不在 HEAD 的树里（盘上有；未跟踪或只 staged 未提交）⇒ ${symptom}。` +
    `修法是**把那份${target}提交**（或撤这条锚点），不是改针脚。`;
}

// ---- 盘上判得通过、HEAD 那份判不过：锚点钉在**在飞文本**上 ----
// 上一条判据只答得出「文件在不在 HEAD」，答不出「被锚定的那段文字在不在 HEAD」。实跑的差集（2026-09-23，
// 同一天两棵树并排）：主树阻断 7 / 同 HEAD 隔离 worktree 阻断 10，其中 5 条只在隔离树红——锚点行已入库、
// 被锚定的实现改动还在别人工作树里（`src/main/sandbox.ts` 等三个 M 文件）。⇒ 这道门**在主树绿、在干净
// HEAD 红**，而 `pnpm gates` 只在主树跑。修法是同一份 `auditNeedles` 喂两份内容各跑一遍，取差集。
export function headOnlyNeedleProblems(
  disk: readonly NeedleProblem[],
  head: readonly NeedleProblem[],
  pathsNotInHead: ReadonlySet<string>,
): NeedleProblem[] {
  const reported = new Set(disk.map((p) => p.id));
  // 读不到 + 路径未入库的已由上一条报过：一条红只算一处成因，否则汇总数被同一件事抬高两次。
  return head.filter((p) => !reported.has(p.id) && !pathsNotInHead.has(p.srcRel));
}

/** 判读行。**不许**把修法写成「改指针脚」：针脚钉的就是那次在飞改动，改成 HEAD 里的旧写法等于废掉这条锚点。 */
export function headOnlyNeedleLine(p: NeedleProblem): string {
  const why = p.hits === -1
    ? "读不到那份 HEAD 里的文件"
    : p.hits === -2
      ? "是空针脚"
      : p.hits === 0
        ? "针脚 0 处"
        : `针脚命中 ${String(p.hits)} 处`;
  return `${p.id} — ${p.srcRel} — 盘上判得通过，而 HEAD 那份里${why} ⇒ 这条锚点钉的是**在飞文本**` +
    "（锚点行已入库、被锚定的实现改动还没）⇒ 干净 HEAD 上它等价于空操作。修法：等那次实现入库（或撤这条锚点），" +
    "**不要**把针脚改成 HEAD 里的旧写法——那等于把这条锚点要守护的东西废掉。";
}

// ---- 接线的两处缺件保护 ----
// `.mjs` 不过 tsc：`tsconfig.json` 的 include 覆盖 scripts/，但没开 `allowJs` ⇒ 接线里的错（少喂一支面、
// 少算一支数、import 改名）既没有编译期信号也没有测试覆盖。所以把这两件事做成 lib 里的纯函数，
// 并在求和处**当场崩**——"门报红却少算一维"等于这条门唯一的产出被废，静默比崩更坏。
/** 锚点的两个文件面。接线唯一允许的取料入口：少 push 一支 ⇒ 那一面的判据静默失效，而 lib 单测看不见。 */
export function anchorFaces(entries: readonly { id: string; src: string; test: string }[]): UntrackedAnchorPath[] {
  const out: UntrackedAnchorPath[] = [];
  for (const e of entries) {
    out.push({ id: e.id, path: e.src, what: "被测面" });
    out.push({ id: e.id, path: e.test, what: "判卷" });
  }
  return out;
}

export interface BlockingParts {
  needle: number;
  duplicateIds: number;
  untracked: number;
  drift: number;
  expectFail: number;
  /** 锚点行已入库、判卷里那条标题还没 ⇒ HEAD 上指针指不到（第 141 页普查里这一格占了 23 条，只能靠 21.8 分钟实跑发现）。 */
  headPointer: number;
}

const BLOCKING_KEYS: (keyof BlockingParts)[] = ["needle", "duplicateIds", "untracked", "drift", "expectFail", "headPointer"];

/** 阻断总数。缺一支或非有限数 ⇒ 抛并点名（`0` 是合法读数，不许当缺项丢掉）。 */
export function blockingTotalOf(parts: BlockingParts): number {
  const missing = BLOCKING_KEYS.filter((k) => !Number.isFinite(parts[k]));
  if (missing.length > 0) {
    throw new Error(`阻断数缺项：${missing.join("、")} ⇒ 门会报红却少算那一维，宁可当场崩（接线漏计没有编译期信号）`);
  }
  return BLOCKING_KEYS.reduce((n, k) => n + parts[k], 0);
}

// ---- 锚点 id 唯一性 ----
// 动因（2026-09-23 我自己刚造成一例）：往表尾插一条新锚点时，`expectFail` 行匹配点落在了
// 上一条锚点的收尾上，于是两条锚点共用一个 id。表照样跑得动，但 `mutate-verify <id>` 会同时跑两条、
// 报告里两行同 id 不同改法——**读的人分不清哪条活着**，而"某条锚点存活"是这条门唯一的产出。
export interface DuplicateId {
  id: string;
  count: number;
}

/** 出现两次以上的 id（按首次出现顺序）。空数组 = 表没有歧义。 */
export function duplicateIds(ids: readonly string[]): DuplicateId[] {
  const seen = new Map<string, number>();
  for (const id of ids) seen.set(id, (seen.get(id) ?? 0) + 1);
  return [...seen].filter(([, n]) => n > 1).map(([id, n]) => ({ id, count: n }));
}

// ---- 参数分流：未知 flag 必须当场拒 ----
// 动因（2026-09-19 实踩）：一条还没合进 HEAD 的 `--check-needles` 在主树里被当成「无参数」，
// 而该脚本的缺省语义是**跑全表**——它会就地改源文件、跑几十分钟。拼错一个 flag 就等于
// 在别人的写作窗里放火，所以「看不懂」不能退化成「按缺省办」。
export const MUTATE_FLAGS = ["--list", "--check-needles", "--budget-ms", "--changed-since", "--lock-tag", "--in-worktree"] as const;
/** 带值的 flag：它**下一个** token 是值，不是锚点 id。漏了这条，`--budget-ms 600000` 会把
 *  `600000` 当成一个不存在的锚点 id 报「未知 id」——于是没人能给它设预算（而预算正是
 *  别被外层超时杀在突变那一拍的手段）。`--changed-since HEAD~1` 同一个坑：rev 会被当成 id。 */
export const MUTATE_VALUE_FLAGS = ["--budget-ms", "--changed-since", "--lock-tag"] as const;
/** 允许 `--flag=值` 连写的那批。`--budget-ms` **刻意不在这里**：它的读取器 `budgetMsOf` 只解析空格写法，
 *  放行 `--budget-ms=600000` 会变成"给了值却被当成不限"——静默按缺省跑，正是本文件开头要拒的那一类。
 *  新增值 flag 时：先给读取器加上 `=` 解析，再往这张表里加名字，顺序反了就是一条假绿。 */
export const MUTATE_EQ_VALUE_FLAGS = ["--changed-since", "--lock-tag", "--in-worktree"] as const;

/** 这个 token 是不是被认识的 flag（三种写法：裸 flag、`--flag 值`、`--flag=值`）。 */
export function isKnownMutateFlag(arg: string): boolean {
  if ((MUTATE_FLAGS as readonly string[]).includes(arg)) return true;
  const eq = arg.indexOf("=");
  return eq > 0 && (MUTATE_EQ_VALUE_FLAGS as readonly string[]).includes(arg.slice(0, eq));
}

export interface ArgPlan {
  mode: "list" | "check-needles" | "run";
  /** 认不出来的 flag：非空即应拒绝执行（不静默降级成全跑）。 */
  unknown: string[];
  /** 位置参数 = 要跑的条目 id。 */
  targets: string[];
}

/** 一条锚点的"面"＝**被测源 ∪ 它的判卷文件**：只认一头必漏另一头（规则 208 的两半）。
 *
 *  动因（第 161 页）：交笔时"该杀哪几条锚点"是我手抄的名单——手抄只会抄到**我想到的**那几条，
 *  而规则 229 反复喊的是"别人把实现搬走 ⇒ 那些锚点当场变空操作"。改成从改动面派生，
 *  同一个文件上的旧锚点会被自动带进来，不依赖我记得它们存在。
 *
 *  返回结构而不是 id 数组：这一格最容易出的事故不是选错，而是**选了 0 条还被读成"都验过了"**
 *  （空载那一族，规则 129/196）。所以把改动面大小与表大小一起交回去，逼调用方把三个数都印出来。 */
export function selectChangedEntries(
  entries: readonly { id: string; src: string; test?: string }[],
  changedPaths: readonly string[],
): { ids: string[]; faceCount: number; pickedCount: number; total: number } {
  const changed = new Set(changedPaths.filter((p) => p !== ""));
  const ids = entries.filter((e) => changed.has(e.src) || (e.test !== undefined && changed.has(e.test))).map((e) => e.id);
  return { ids, faceCount: changed.size, pickedCount: ids.length, total: entries.length };
}

export function classifyArgs(args: readonly string[]): ArgPlan {
  // 先标出「flag + 它的值」这两个下标，后面两个过滤器都不再看它们。
  // 值位又是一个 flag（`--budget-ms --list`）时不吞：让 budgetMsOf 去报「没给值」，--list 照旧生效。
  const consumed = new Set<number>();
  args.forEach((a, i) => {
    if (!(MUTATE_VALUE_FLAGS as readonly string[]).includes(a)) return;
    consumed.add(i);
    if (args[i + 1] !== undefined && !args[i + 1].startsWith("--")) consumed.add(i + 1);
  });
  const unknown = args.filter((a, i) => !consumed.has(i) && a.startsWith("--") && !isKnownMutateFlag(a));
  const targets = args.filter((a, i) => !consumed.has(i) && !a.startsWith("--"));
  const mode = args.includes("--list") ? "list" : args.includes("--check-needles") ? "check-needles" : "run";
  return { mode, unknown, targets };
}

/** 逐行式 apply（`s.split("\n").map(...)` 一类）：它**就是**要改所有匹配行，
 *  所以「针脚命中多处」在这里不是风险信号。不认它，静态检就会长期挂着一排假 ⚠️，
 *  而假警报备出来的代价是真警被人一起忽略。 */
/** 逐行式的形状：箭头的**第一个操作**就是 `<入参>.split(`（允许中间隔一句 `const x = ` 的块体开头）。 */
const LINE_WISE_SHAPE = /=>\s*(?:\{\s*(?:const|let)\s+\w+\s*=\s*)?\w+\.split\(/;

/** 「逐行式 apply」＝先把**输入**按行拆开、再逐行改写（这类改法的针脚天生要在多处命中，所以不核针脚）。
 *
 *  判据必须挂在上面那个形状上，不能挂在"改法文字里出现过 `.split(`"——
 *  后者会把两类无关的东西一起放进免检名单：① 针脚**指向**一条含 `split(` 的实现，② **替换文字**里含 `split(`。
 *  09-27 实测（`outputs/line-wise-exemption-2026-09-27/measure.mts`，870 条 apply 全量）：旧判据认 11 条，
 *  其中真逐行式只有 4 条 ⇒ 另 7 条一直在免检，实现搬家后它们会静默变成空操作而表上仍报 ✅。 */
export function isLineWiseApply(applySource: string): boolean {
  return LINE_WISE_SHAPE.test(applySource);
}

// ---- expectFail 这个指针本身可不可用（第 138 页） ----------------------------
// 动因：一条锚点「杀掉」的判据是**测试红在那条用例上**；用例改了标题而 `expectFail` 还写着旧标题时，
// 报告说的是「变异存活或误伤」——听起来像代码没被守住，实际上是**指针断了**。
// 这个 bug 2026-09-23 就咬过一次（表里那条注释），今天是第二次（我自己那条被 #47 改名）。
// 而发现它要付出「跑那条变异」的代价；整张表跑一遍是几十分钟，静态扫是秒级。
// ⇒ 判据挂在盘上的文字事实上：`expectFail` 必须能在它自己那条 `test` 文件里逐字找到。
export interface ExpectFailEntry {
  id: string;
  test: string;
  expectFail: string;
}

export interface ExpectFailProblem {
  id: string;
  test: string;
  expectFail: string;
  /** `unreadable`＝判卷文件读不到（三态：不能当成「指针没问题」）；`not-found`＝文件里找不到这句话。 */
  why: "unreadable" | "not-found";
}

/** 比较口径。**这份标题抽取是从 `scripts/mutate-anchor-titles.ts` 搬进 lib 的**（第 138 页）：
 *  同一判据两处各写一份必然漂宽（第十三族）——我新写的那把先按整句逐字比（一次报 10 条假红），
 *  而旧的那把早就认柯里 `it.each([...])("…%s…")` 与 `$label` 插值。搬过来＝两把尺共用一份实现。
 *  两件事会把「逐字比」打掉：① 表里存的是解码后的字符串，盘上是带转义的源码文字（`it("… \"Edit\" …")`）；
 *  ② 标题可以是拼出来的（`it("零行为回退：" + label + " → …")` ⇒ 盘上没有整句，跑起来才有）。
 *  四支抽取缺一不可：直接 `it("…")` / 模板字面量 / 柯里 `it.each([...])("…")` / 后两者的模板形式。 */
const PLACEHOLDER = /(\$\{[\s\S]*?\}|\$[A-Za-z_]\w*|%[sdijfovc#])/;
const WILDCARD = "@@wildcard@@";

export function vitestTitles(sourceText: string): string[] {
  const MOD = String.raw`(?:\.each|\.skip|\.todo|\.only|\.fails|\.concurrent|\.sequential)?`;
  const SQ = String.raw`"((?:[^"\\]|\\.)*)"`;
  const BQ = "`((?:[^`\\\\]|\\\\.)*)`";
  const EACH_TAIL = String.raw`\((?:[^()]|\([^()]*\))*\)\s*\(\s*`;
  const pats = [
    new RegExp(String.raw`\b(?:it|test)` + MOD + String.raw`\s*\(\s*` + SQ, "g"),
    new RegExp(String.raw`\b(?:it|test)\.each\s*` + EACH_TAIL + SQ, "g"),
    new RegExp(String.raw`\b(?:it|test)` + MOD + String.raw`\s*\(\s*` + BQ, "g"),
    new RegExp(String.raw`\b(?:it|test)\.each\s*` + EACH_TAIL + BQ, "g"),
  ];
  const out: string[] = [];
  for (const re of pats) for (const m of sourceText.matchAll(re)) out.push(m[1]!);
  return out;
}

/** 一条标题去掉通配后剩下的**字面文字**；空 ⇒ 整条都是占位符（生成式标题），不能当模式用。
 *  单独抽出还有一个用处：`isLineWiseApply` 按"改法文字里含 `.split(`"豁免针脚，
 *  判据若与那句 split 写在同一行，锚点会被连带误豁免（第 152 页实测 3 条新锚点中了这一枪）。 */
const literalOf = (body: string): string => body.split(WILDCARD).join("").trim();

/** 标题 → 匹配式：先按占位符切开、只转义字面段、再把通配拼回去（顺序反了 `${…}` 会永远认不出）。
 *  返回的数组**不与** `vitestTitles` 下标对齐（生成式标题会被丢掉），消费者只有 `expectFailMatchesTitles` 的 `.some`。 */
export function vitestTitlePatterns(sourceText: string): RegExp[] {
  return vitestTitles(sourceText).flatMap((lit) => {
    const un = lit.replace(/\\(.)/g, "$1");
    const body = un
      .split(PLACEHOLDER)
      .map((piece) => (PLACEHOLDER.test(piece) ? WILDCARD : piece.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
      .join("");
    // 整条标题都是占位符（`it(\`${t}\`, …)` 这类生成式标题）⇒ 这条模式匹配**任何**输入。
    // 留着它，落在这份判卷文件上的全部 expectFail 指针体检一起变恒真：实测 241 个判卷文件里有 2 个含这种标题，
    // 压在它们上面的 33 条锚点因此缴械（本轮那条「四支／六支」死指针就是靠这个洞活到实跑 21 分钟才喊）。
    // 生成式标题在运行时会被渲染成具体文本，指针本来就点不到它 ⇒ 丢掉，让那格退化成"静态验不了"，而不是"静态永远对"。
    if (literalOf(body) === "") return [];
    return [new RegExp("^[\\s\\S]*" + body.split(WILDCARD).join("[\\s\\S]*?") + "[\\s\\S]*$")];
  });
}

/** `expectFail` 认不认得这份判卷：逐字命中，或整串匹配某条（含占位符的）标题——与 runner 的「输出含这段」同宽。 */
export function expectFailMatchesTitles(expectFail: string, sourceText: string): boolean {
  if (sourceText.includes(expectFail)) return true;
  return vitestTitlePatterns(sourceText).some((re) => re.test(expectFail));
}

const ANSI_SEQUENCE = /\u001b\[[0-9;]*m/g;

/** 判卷输出里**红掉的那些用例**的文字。只有它们能证明「红在了期望用例上」。
 *
 *  动因（第 141 页）。runner 原先的归因判据是 `hit.out.includes(expectFail)`——而 vitest 默认 reporter
 *  会把**通过的**用例一起列出来（`✓ …`）⇒ 一条通过的用例就能满足它。实测踩到：
 *  `cpp-zero-boundary-ratio-zero` 的针脚落在 `no-usage` 那一支（隔壁支），真红的是「没有 usage…」那条，
 *  声明的「真实红跑：零 verified…」那条**是绿的**，而这条锚点照样报 ✅。
 *  ⇒ 「被杀死」从来不需要声明的那条 killer 红——整张表的归因栏都建在这一句松判据上。
 *
 *  失败面认两种写法（缺任何一种就会把真红读成"没红在期望用例上"＝假警）：
 *  `FAIL <file> > <suite> > <title>` 那一行，与逐条列表里的 `× / ✕ / ✗` 行。 */
export function failingTestText(vitestOut: string): string {
  return vitestOut
    .replace(ANSI_SEQUENCE, "")
    .split("\n")
    .filter((line) => /^\s*(?:FAIL\b|[×✕✗])/.test(line))
    .join("\n");
}

/** 「这次变异红在了它声明的那条用例上吗」——与静态那把尺共用同一份宽度（`expectFailMatchesTitles`），
 *  区别只在喂进去的是**失败面**而不是判卷源文件。 */
export function killerAttributionOk(expectFail: string, vitestOut: string): boolean {
  if (expectFail === "") return true; // 没声明 killer 的条目（逐行式那一族）不在这儿判
  return expectFailMatchesTitles(expectFail, failingTestText(vitestOut));
}

export interface JudgeProbe {
  code: number;
  ms: number;
  out: string;
}
export interface JudgeRetryResult {
  probe: JudgeProbe;
  runsMs: number[];
}

/**
 * 跑一次判卷；红了**重试一次**，把最终那一拍连同全部耗时交回调用方。
 *
 * 动因（09-28 整表 936 条实测）：判卷文件里碰真机的用例会**偶发**红（真 git 的 index mtime 负控…），
 * 与本条变异毫无关系，却会同时污染两个观测点——第 ① 步基线（基线看起来红）和第 ④ 步还原（还原看起来没还原好）。
 * 实测那两条失败（`depdirs-descends-into-node-modules` 基线红、`concurrency-hint-fires-on-green` 还原红）
 * 就是同一条负控翻红造成的：一个挂在这个判卷文件上的锚点集体丢认证。
 *
 * 关键取舍：**瞬时红放过、持续红按最终那一拍算**——还原真坏掉时重试也红，两个观测点的保证一点没松。
 * 全部耗时照实交回 `runsMs`，成本分母不白烧。绿的那一拍不重试（白跑一格就是白烧）。
 */
export function judgeWithRetry(run: () => JudgeProbe): JudgeRetryResult {
  const first = run();
  if (first.code === 0) return { probe: first, runsMs: [first.ms] };
  const retry = run();
  return { probe: retry, runsMs: [first.ms, retry.ms] };
}

export interface RestoreVerdict {
  ok: boolean;
  runsMs: number[];
  why?: string;
}

/**
 * 第 ④ 步「还原后必须恢复全绿」的判定，走 `judgeWithRetry` 那个共享重试。
 * 放不放得过由 `killerAttributionOk` 在第 ③ 步定（分辨力在那边），这里只管还原后这一格：
 * 还原后最终那一拍绿 ⇒ 过；红 ⇒ 判失败并点名是哪一拍的输出。
 */
export function restoreCheck(run: () => JudgeProbe): RestoreVerdict {
  const { probe, runsMs } = judgeWithRetry(run);
  return probe.code === 0
    ? { ok: true, runsMs }
    : { ok: false, runsMs, why: `还原后未恢复全绿（重试仍红）:\n${probe.out.slice(-800)}` };
}

/** 纯函数：`readTest` 由调用方注入（单测喂假文件，门喂真盘）。 */
export function auditExpectFails(
  entries: readonly ExpectFailEntry[],
  readTest: (rel: string) => string | null,
): ExpectFailProblem[] {
  const cache = new Map<string, string | null>();
  const out: ExpectFailProblem[] = [];
  for (const e of entries) {
    // 空 expectFail 不是「失效」而是「这条锚点没声明 killer」——那是另一格（表里逐行式的条目就有这种情况），
    // 这里不许把它和指针断裂混成一档。
    if (e.expectFail === "" || e.test === "") continue;
    // 非 vitest 面不判（那一格的口径由 `mutate-anchor-titles` 单独点名；两把尺必须同宽，别在这儿造第二套）。
    if (!e.test.endsWith(".test.ts")) continue;
    if (!cache.has(e.test)) cache.set(e.test, readTest(e.test));
    const text = cache.get(e.test);
    if (text === null || text === undefined) out.push({ id: e.id, test: e.test, expectFail: e.expectFail, why: "unreadable" });
    else if (!expectFailMatchesTitles(e.expectFail, text)) out.push({ id: e.id, test: e.test, expectFail: e.expectFail, why: "not-found" });
  }
  return out;
}

/** 「松钉」＝逐字认不出、只有靠占位符展开的标题模式才认下的指针（拼接标题／带转义引号的那两类必然落在这里）。
 *
 *  这一格要**有读数**：09-27 现读 10／872，且这 10 根所在的 9 个判卷文件对一根假指针全部拒收 ⇒ 松钉本身不是洞。
 *  但没有这个数字的话，下一次"标题改了、指针跟着漂"只会花 21 分钟实跑后以「红了但没红在期望用例」出现——
 *  本轮那条「四支／六支」就是这条来路（它当时逐字也认不出，是被恒真模式放过的）。 */
export function looseOnlyPointers(
  entries: readonly ExpectFailEntry[],
  readTest: (rel: string) => string | null,
): string[] {
  const cache = new Map<string, string | null>();
  const out: string[] = [];
  for (const e of entries) {
    if (e.expectFail === "" || e.test === "" || !e.test.endsWith(".test.ts")) continue;
    if (!cache.has(e.test)) cache.set(e.test, readTest(e.test));
    const text = cache.get(e.test);
    // 读不到 ⇒ 不归这里：那一格由 `auditExpectFails` 报 `unreadable`，两把尺各记各的，不互相顶账。
    if (text === null || text === undefined) continue;
    if (!text.includes(e.expectFail) && expectFailMatchesTitles(e.expectFail, text)) out.push(e.id);
  }
  return out;
}

/** HEAD 侧的指针体检（第 141 页）：锚点行已经入库、判卷里那条标题还没 ⇒ 干净 HEAD 上这条锚点指不到活用例。
 *  普查里这一格占了 23 条，只能靠 21.8 分钟实跑发现；静态能秒级点出来，因为它两头都在盘上。
 *  只查**同时满足两条**的锚点，否则会把"本笔同时改表与改判卷"误判成缺陷（那格由 217 的同笔规矩管）：
 *  ① 这条锚点的 `id` 在 HEAD 那份表里就存在（不是本笔新加的）；
 *  ② 它的判卷文件相对 HEAD 有改动（没改动的判卷，盘上尺与 HEAD 尺读数相同，不必重复取）。
 *  纯函数：两个谓词与取内容都由调用方注入（单测喂假内容，门喂 `git show`）。 */
export function headPointerProblems(
  entries: readonly ExpectFailEntry[],
  opts: { inHeadTable: (id: string) => boolean; judgeDirty: (rel: string) => boolean; readAtHead: (rel: string) => string | null },
): ExpectFailProblem[] {
  return auditExpectFails(
    entries.filter((e) => e.test !== "" && opts.inHeadTable(e.id) && opts.judgeDirty(e.test)),
    opts.readAtHead,
  );
}

/** 基线红的分诊（第 143 页）：判卷**载不动**（`Cannot find module …`）与「基线真的不绿」是两种信号。
 *  前者是**量不了**——第 141 页普查里 167 条这一类全部来自别人半落库（未跟踪的模块、只在盘上的修复），
 *  却被报成「基线就不是全绿（不应发生）」＝阻断，于是这张表唯一的信号（表退化）被环境噪声淹了。
 *  ⇒ 载不动＝未证（仍然红，但要说清是量不了不是没守住）；其余才按阻断。 */
export function baselineRedKind(vitestOut: string): { kind: "unloadable"; module: string } | { kind: "blocking" } {
  const m = /Cannot find module ['"]([^'"]+)['"]/.exec(vitestOut);
  return m === null ? { kind: "blocking" } : { kind: "unloadable", module: m[1] ?? "" };
}

/** 一行可机读的判读（门输出格式：id + 判卷文件 + 原因 + 指针前 60 字）。 */export function expectFailProblemLine(p: ExpectFailProblem): string {
  const why = p.why === "unreadable"
    ? "判卷文件读不到（不等于指针没问题）"
    : "这条用例标题在该判卷文件里找不到（多半是用例改过名，而指针还写着旧的）";
  return `${p.id} — ${p.test} — ${why}：${JSON.stringify(p.expectFail.slice(0, 60))}`;
}

// ---- 选择子唯一性（第 169 页的前置闸）：一条锚点能不能只跑**自己那条** killer 用例 ----
// 动因（09-28 第 168 页的读数）：一条锚点的单价＝**判卷宿主文件时长的 3 倍**（实测 23.1s/条，换一份 1.1s 的宿主就是 20.6×），
// 而它真正要证的只有自己那条用例。要让 `runTest` 改吃 `-t` 的精确跑法，前提是指针能**逐字唯一定位**那条标题：
// 0 命中时 vitest 不会失败，它只是**一条也没跑** ⇒ 基线与突变两拍都白过，这把尺会安静地变成假绿（第 166 页那族）。
// 所以先要有一格读数把「选不中」的条数点名，而不是等 `-t` 上线后才发现名单里混着选不中的。
export interface SelectorProblem {
  id: string;
  test: string;
  /** 逐字命中该指针的 it()/test() 标题条数。0＝只靠占位符展开才认得出；>1＝选择子不唯一。 */
  hits: number;
}

/** 数每条锚点的指针在它自己的判卷文件里逐字命中几条标题。只回 ≠1 的那些（==1 是能走 -t 的那一批）。
 *  判卷文件读不到、或指针为空、或不是 vitest 文件 ⇒ **不数**（那些另有归属：`auditExpectFails` 的 unreadable、结构钉型判卷），
 *  所以 `inspected` 是被数过的条数：拿整表条数去除会以假绿的方式低估可选率。 */
export interface SelectorScan {
  problems: SelectorProblem[];
  inspected: number;
}

const TITLE_RE = /^\s*(?:it|test)(?:\.\w+)?\s*\(\s*(["`'])((?:\\.|(?!\1)[^\\])*)\1/gmu;

export function selectorAmbiguity(
  entries: readonly ExpectFailEntry[],
  readTest: (rel: string) => string | null,
): SelectorScan {
  const cache = new Map<string, string[] | null>();
  const problems: SelectorProblem[] = [];
  let inspected = 0;
  for (const e of entries) {
    if (e.expectFail === "" || !e.test.endsWith(".test.ts")) continue;
    if (!cache.has(e.test)) {
      const text = readTest(e.test);
      cache.set(e.test, text === null ? null : [...text.matchAll(TITLE_RE)].map((m) => m[2] ?? ""));
    }
    const titles = cache.get(e.test);
    if (titles === null || titles === undefined || titles.length === 0) continue;
    inspected += 1;
    const hits = titles.filter((t) => t.includes(e.expectFail)).length;
    if (hits !== 1) problems.push({ id: e.id, test: e.test, hits });
  }
  return { problems, inspected };
}

/** 那一格的措辞：三态分开印，且**不许**把「选不中」并成「没什么问题」。
 *  存量不是 0（现读 13 条），所以这一格走水位法：只准调低，涨了要交代。 */
export function selectorCell(problems: readonly SelectorProblem[], inspected: number): string {
  const zero = problems.filter((p) => p.hits === 0);
  const many = problems.filter((p) => p.hits > 1);
  const parts = [
    `选择子：${String(inspected - problems.length)}/${String(inspected)} 条能逐字唯一定位自己的 killer 用例（其余走整文件跑法）`,
    zero.length === 0 ? "" : `零命中 ${String(zero.length)} 条（标题是拼出来的或已改名 ⇒ -t 会一条也选不中）`,
    many.length === 0 ? "" : `多命中 ${String(many.length)} 条（选择子不唯一）`,
  ].filter((s) => s !== "");
  return parts.join("·") + (problems.length === 0 ? "" : "：" + problems.map((p) => `${p.id}(${String(p.hits)})`).join("、"));
}

// ---- 每条锚点的真实成本（任务 #37：分母必须是读数，不是「次数 × 文件时长」的模型） ----
// 动因（09-28 第 165 页自己打的脸）：那句「裁掉判卷文件 7.7s ⇒ 挂在它上面的每条锚点少付 21s」是按
// 「每条跑三次 × 宿主文件全时长」**推**出来的，同分母实测把它打掉（每条只少 1.4–2.2s）。
// 推不动的根因是这张表从来没记过**每条实际 spawn 了几次判卷、每次多久**：
// 早退路径（基线不绿／突变未生效／还原未绿）本来就只付 1~2 次，把「三条」当「三次」就是把模型当读数。
// 这里把它做成读数：runner 逐次喂 `runsMs`，汇总与列印都只吃这一份（判卷不许自己再算一遍，规则 205/236）。
export interface AnchorCostRow {
  /** 点名用：汇总里那一格要说「最贵的一条是哪条」，否则读数只能指回整张表让人逐条分诊。 */
  id: string;
  /** 这条锚点实际 spawn 判卷的墙钟毫秒，按发生顺序（基线／突变／还原）。
   *  一次没跑要**显式**喂空数组：字段缺席＝接线漏计，`costRollupOf` 当场崩并点名第几行——
   *  「没记账」长成「记了 0 次」的话，汇总就悄悄把那条贵的锚点从分母里摘掉了。 */
  runsMs?: readonly number[];
}

export interface CostRollup {
  anchors: number;
  spawns: number;
  /** 显式记为「一次没跑」的条数（预检跳过／预算用尽）——与「跑了但很快」是两个数。 */
  neverRan: number;
  /** 按每条实际 spawn 次数分桶（升序），例如 `[{runs:1,anchors:7},{runs:3,anchors:46}]`。 */
  perAnchorSpawns: readonly { runs: number; anchors: number }[];
  /** 按**第几次 spawn** 求的中位毫秒。分开求是 #37 的另一半：第一次付 vite 冷启动，
   *  后面几次复用盘上的转换缓存 ⇒ 同一份判卷文件的三个单价不同，混成一个平均就把这个结构抹平了。 */
  medianByNth: readonly { nth: number; medianMs: number }[];
  slowestAnchorMs: number;
  slowestAnchorId: string | null;
}

function medianOf(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/** 成本汇总。缺 `runsMs` 或非有限数 ⇒ 抛并点名（`.mjs` 没有编译期信号，本文件一贯的做法是当场崩）。
 *  局部名刻意不叫 `missing`：那个字面量是 `blockingTotalOf` 那条锚点的针脚，撞名会让它命中两处。 */
export function costRollupOf(rows: readonly AnchorCostRow[]): CostRollup {
  const unaccounted: number[] = [];
  const lists: { id: string; runs: number[] }[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const runs = row?.runsMs;
    if (!Array.isArray(runs) || runs.some((n) => !Number.isFinite(n))) {
      unaccounted.push(i + 1);
      continue;
    }
    lists.push({ id: row?.id ?? "", runs: [...runs] });
  }
  if (unaccounted.length > 0) {
    throw new Error(`成本账本第 ${unaccounted.slice(0, 8).join("、")}${unaccounted.length > 8 ? "…" : ""} 行没有 runsMs（或含非有限数）` +
      " ⇒ 那条锚点付了几次判卷没人知道；宁可当场崩：分母缺项的汇总会被读成「每条就这么贵」");
  }
  const counts = new Map<number, number>();
  const byNth = new Map<number, number[]>();
  let spawns = 0;
  let neverRan = 0;
  let slowestMs = 0;
  let slowestId: string | null = null;
  for (const { id, runs } of lists) {
    spawns += runs.length;
    counts.set(runs.length, (counts.get(runs.length) ?? 0) + 1);
    if (runs.length === 0) neverRan += 1;
    const total = runs.reduce((a, b) => a + b, 0);
    if (total > slowestMs) {
      slowestMs = total;
      slowestId = id;
    }
    runs.forEach((ms, idx) => {
      const bucket = byNth.get(idx);
      if (bucket === undefined) byNth.set(idx, [ms]);
      else bucket.push(ms);
    });
  }
  return {
    anchors: rows.length,
    spawns,
    neverRan,
    perAnchorSpawns: [...counts].sort((a, b) => a[0] - b[0]).map(([runs, anchors]) => ({ runs, anchors })),
    medianByNth: [...byNth].sort((a, b) => a[0] - b[0]).map(([idx, vals]) => ({ nth: idx + 1, medianMs: medianOf(vals) })),
    slowestAnchorMs: slowestMs,
    slowestAnchorId: slowestId,
  };
}

const secsOf = (ms: number): string => (ms / 1000).toFixed(1);

/** 汇总那一行。`spawns === 0` 时不许长得像「每条 0 秒」——这一格**没有**分母，只能这么说。 */
export function costCell(r: CostRollup): string {
  if (r.spawns === 0) {
    return `成本分母：本次判卷 spawn 0 次（${String(r.anchors)} 条里 ${String(r.neverRan)} 条一条没跑）` +
      " ⇒ 这一格没有分母，别按「每条 X 秒」估";
  }
  const dist = r.perAnchorSpawns.map((b) => `${String(b.runs)}×${String(b.anchors)}`).join(" ");
  const perNth = r.medianByNth.map((b) => `第${String(b.nth)}次 ${secsOf(b.medianMs)}s`).join("／");
  const never = r.neverRan === 0 ? "" : `· 另 ${String(r.neverRan)} 条没跑（不等于 0 秒）`;
  const slowest = r.slowestAnchorId === null
    ? `最贵一条 ${secsOf(r.slowestAnchorMs)}s`
    : `最贵一条 ${r.slowestAnchorId} ${secsOf(r.slowestAnchorMs)}s`;
  return `成本分母：判卷 spawn ${String(r.spawns)} 次／${String(r.anchors)} 条（每条次数分布 ${dist}）` +
    `· 单次中位 ${perNth}· ${slowest}${never}`;
}
