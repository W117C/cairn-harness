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
}

const BLOCKING_KEYS: (keyof BlockingParts)[] = ["needle", "duplicateIds", "untracked", "drift", "expectFail"];

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
export const MUTATE_FLAGS = ["--list", "--check-needles", "--budget-ms"] as const;
/** 带值的 flag：它**下一个** token 是值，不是锚点 id。漏了这条，`--budget-ms 600000` 会把
 *  `600000` 当成一个不存在的锚点 id 报「未知 id」——于是没人能给它设预算（而预算正是
 *  别被外层超时杀在突变那一拍的手段）。 */
export const MUTATE_VALUE_FLAGS = ["--budget-ms"] as const;

export interface ArgPlan {
  mode: "list" | "check-needles" | "run";
  /** 认不出来的 flag：非空即应拒绝执行（不静默降级成全跑）。 */
  unknown: string[];
  /** 位置参数 = 要跑的条目 id。 */
  targets: string[];
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
  const unknown = args.filter((a, i) => !consumed.has(i) && a.startsWith("--") && !(MUTATE_FLAGS as readonly string[]).includes(a));
  const targets = args.filter((a, i) => !consumed.has(i) && !a.startsWith("--"));
  const mode = args.includes("--list") ? "list" : args.includes("--check-needles") ? "check-needles" : "run";
  return { mode, unknown, targets };
}

/** 逐行式 apply（`s.split("\n").map(...)` 一类）：它**就是**要改所有匹配行，
 *  所以「针脚命中多处」在这里不是风险信号。不认它，静态检就会长期挂着一排假 ⚠️，
 *  而假警报备出来的代价是真警被人一起忽略。 */
export function isLineWiseApply(applySource: string): boolean {
  return applySource.includes(".split(");
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

/** 指针与判卷文字之间的比较口径。两件事把「逐字比」打掉了：
 *  ① 表里存的是**解码后的字符串**，判卷文件里那句标题是**带转义的源码文字**（`it("… \"Edit\" …")`）；
 *  ② 标题可以是**拼出来的**：`it("零行为回退：" + label + " → 无 verify_result…")` ⇒ 整句在盘上根本不存在，
 *    而跑起来那刻它是存在的（`auto-verify-default-on` 实测就是这样：静态报失配，变异单跑 ✅ 杀死）。
 *  ⇒ 判据退一步按**片段**比：指针里最长的可辨片段要能在文件里逐字找到。
 *    真改过名的条目（片段全找不到）仍然红；只有片段一个都对不上的畸形短指针放行（宁少报，不假红）。 */
const POINTER_FRAG_SEP = /[\s"“”'‘’（）()、，,：:；;/|｜→⇒…+\-]+/u;

export function expectFailFragments(pointer: string): string[] {
  return pointer
    .split(POINTER_FRAG_SEP)
    .map((t) => t.trim())
    .filter((t) => Array.from(t).length >= 4)
    .sort((a, b) => b.length - a.length);
}

const unescapeForCompare = (s: string): string => s.replace(/\\/g, "");

/** 指针在判卷文字里认不认得（片段口径，见上）。 */
export function expectFailRecognizable(pointer: string, testFileText: string): boolean {
  const hay = unescapeForCompare(testFileText);
  const frags = expectFailFragments(pointer);
  if (frags.length === 0) return true;
  return frags.some((f) => hay.includes(unescapeForCompare(f)));
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
    if (!cache.has(e.test)) cache.set(e.test, readTest(e.test));
    const text = cache.get(e.test);
    if (text === null || text === undefined) out.push({ id: e.id, test: e.test, expectFail: e.expectFail, why: "unreadable" });
    else if (!expectFailRecognizable(e.expectFail, text)) out.push({ id: e.id, test: e.test, expectFail: e.expectFail, why: "not-found" });
  }
  return out;
}

/** 一行可机读的判读（门输出格式：id + 判卷文件 + 原因 + 指针前 60 字）。 */
export function expectFailProblemLine(p: ExpectFailProblem): string {
  const why = p.why === "unreadable"
    ? "判卷文件读不到（不等于指针没问题）"
    : "这条用例标题在该判卷文件里找不到（多半是用例改过名，而指针还写着旧的）";
  return `${p.id} — ${p.test} — ${why}：${JSON.stringify(p.expectFail.slice(0, 60))}`;
}
