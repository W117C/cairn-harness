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
export const MUTATE_FLAGS = ["--list", "--check-needles"] as const;

export interface ArgPlan {
  mode: "list" | "check-needles" | "run";
  /** 认不出来的 flag：非空即应拒绝执行（不静默降级成全跑）。 */
  unknown: string[];
  /** 位置参数 = 要跑的条目 id。 */
  targets: string[];
}

export function classifyArgs(args: readonly string[]): ArgPlan {
  const unknown = args.filter((a) => a.startsWith("--") && !(MUTATE_FLAGS as readonly string[]).includes(a));
  const targets = args.filter((a) => !a.startsWith("--"));
  const mode = args.includes("--list") ? "list" : args.includes("--check-needles") ? "check-needles" : "run";
  return { mode, unknown, targets };
}

/** 逐行式 apply（`s.split("\n").map(...)` 一类）：它**就是**要改所有匹配行，
 *  所以「针脚命中多处」在这里不是风险信号。不认它，静态检就会长期挂着一排假 ⚠️，
 *  而假警报备出来的代价是真警被人一起忽略。 */
export function isLineWiseApply(applySource: string): boolean {
  return applySource.includes(".split(");
}
