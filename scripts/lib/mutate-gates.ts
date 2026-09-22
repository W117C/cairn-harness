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

/** 一行可机读的判读结论（门的输出格式：id + 源 + 原因 + 针脚前 60 字）。 */
export function needleProblemLine(p: NeedleProblem): string {
  const why = p.hits === -1
    ? "源文件读不到"
    : p.hits === -2
      ? "空针脚（改不动任何东西）"
      : p.hits === 0
        ? "针脚已不在源文件里（变异必然不生效——多半是被锚定的实现搬走了，改指它）"
        : `针脚命中 ${String(p.hits)} 处（replace 只改第一处，需人工复认改到的是哪一处）`;
  return `${p.id} — ${p.srcRel} — ${why}：${JSON.stringify(p.needle.slice(0, 60))}`;
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
