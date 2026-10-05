// 失败轨迹留档（#109，2026-10-05）：基准跑器**只把 FAIL 那几趟的转录**留在有帽的 dated 目录里。
//
// 病灶（现读，不是抄台账）：`package.json:53-57` 那四支 bench 脚本从不传 `--keep`，而
// `scripts/loop-eval.ts` 的临时目录是 `mkdtemp` + `rm(dir)` ⇒ 每趟的 `events.jsonl` 跟着目录一起没。
// `src/agent/gym/draft.ts` 那条「失败轨迹 → 回归样本」的通路是齐的，但它吃的是**事件流原文**
// （`replay(path)` → `draftFromEvents(events)`），原文没了就等于能力 10 在基准这一侧永远拿不到输入。
//
// 为什么留的是**输入**而不是直接落草稿：
//  · 落草稿要写进 `fixtures/gym/drafts/`（未跟踪目录撒进源码树），第 394 页已裁过「这一跳不接」，
//    动因正是它会污染隔壁会话的 hunk 归属读数 —— 本模块不跟那条裁决打架；
//  · 「这趟算不算失败」的裁决只有一份，就是跑器自己印出来的那个 verdict（PASS/FAIL/无效）。
//    `draft.ts` 里那枚 `verifyOk===false` 谓词是**产品会话**的口径（环境红不算失败），
//    基准的 FAIL 还包括「改了判卷面」「没先读就写」这类判据，两者口径不同，谁也不该替谁判。
//  · 留输入 = 一次 copyFile；落草稿 = 把两份口径焊在一起。后者才是"新机器"。
//
// 落点为什么在 `outputs/` 里：`scripts/repo-hygiene-check.ts` 面① 量的就是 `outputs/` 在已跟踪文件里
// 的占比（帽 70%）。留档走那棵树 ⇒ 体量涨在**有人量的那面**上，而不是悄悄长在 fixtures 里。
//
// 三条帽（本仓不吃"just add --keep"那种无限留档）：条数／单条字节／目录总字节。
// 每一条都是**丢弃**而不是截断——截过的转录是一份假草稿输入（`draftFromEvents` 的候选必改集
// 会少掉被切掉那几笔，而那正是草稿要给人的东西）。

import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";

/** 每臂每天最多留几条。12 = 现读一臂的趟次数（bench 12 条任务 × reps 1）。 */
export const TRACE_COUNT_CAP = 12;
/** 单条上限。现读盘上 `--keep` 留下的真转录：3.4 KB–130 KB（48 级链那条 90 KB）⇒ 256 KB 有余量而拦得住跑飞。 */
export const TRACE_FILE_BYTES_CAP = 256 * 1024;
/** 一个 dated 目录的总字节帽：12 × 256 KB = 3 MB 那条最坏账要有人拦（真读数是 ~0.2 MB/臂）。 */
export const TRACE_TOTAL_BYTES_CAP = 1_536 * 1024;
/** 产物目录里那一支子目录的名字，与留档文件的后缀（草稿侧取 id 时吃同一枚后缀，两处一份定义）。 */
export const FAILED_TRACE_SUBDIR = "failures";
export const TRACE_SUFFIX = ".events.jsonl";

/** 留档目录（仓根相对的写法，印给人看的那一份）。 */
export function failedTraceDir(out: string, day: string): string {
  return out.replace(/\/+$/u, "") + "/" + FAILED_TRACE_SUBDIR + "/" + day;
}

/** 留档文件名 ⇄ 草稿 caseId 的唯一互转：`I2-rep1-base` ⇄ `I2-rep1-base.events.jsonl`。
 *  `--keep` 那种 `solo.jsonl` 形状的旧文件也认（剥掉 `.jsonl`），两端共用这一份规则，不各写一遍 basename。 */
export function caseIdOfTrace(path: string): string {
  const base = basename(path);
  const stripped = base.endsWith(TRACE_SUFFIX)
    ? base.slice(0, -TRACE_SUFFIX.length)
    : base.replace(/\.jsonl$/u, "");
  return stripped.replace(/[^A-Za-z0-9._-]/gu, "-").replace(/^-+/u, "") || "session";
}

/** 没留的原因，每一格都要有名字：调用方与判卷都靠它分「不该写」与「写坏了」。 */
export type TraceSkip =
  | "not-a-failure" | "covered-by-keep-all" | "count-cap" | "file-bytes-cap" | "total-bytes-cap"
  | "already-there" | "source-unreadable";

/** 跑器那一侧「这趟算失败」的唯一令牌：`loop-eval` 印出来的 verdict 三态里的那一枚。
 *  本模块**只认这一个字符串**，不另写一份"什么算失败"——判据表与分母口径都在跑器那边（#109 的要求）。 */
export const FAILED_VERDICT = "FAIL";

export interface TraceKeepInput {
  /** 跑器为这一行印出来的裁决（`PASS`｜`FAIL`｜`无效`）。只有 `FAIL` 留档。 */
  verdict: string;
  /** 仓根（绝对）。 */
  root: string;
  /** 跑器的产物目录（`--out` 那一份，通常是相对的 `outputs/bench`）。 */
  out: string;
  /** `YYYY-MM-DD`：由调用方给（本模块不读钟，一趟只读一次钟是 loop-eval 那条既有纪律）。 */
  day: string;
  /** 临时目录里那份 `events.jsonl`。 */
  sourcePath: string;
  /** `<靶子 id>-rep<n>-<system>`——与 `--keep` 的文件名同一份写法。 */
  caseId: string;
  /** `--keep` 在场：全量已经留在产物目录根了，这里再写一份就是双份字节。 */
  keepAll: boolean;
  countCap?: number;
  fileBytesCap?: number;
  totalBytesCap?: number;
}

export interface TraceKeepOutcome {
  /** 落点（仓根相对）；没写则 null。 */
  relPath: string | null;
  /** 落点（绝对），调用方要删要读都用它；没写则 null。 */
  absPath: string | null;
  /** 写出去的字节数（没写则 0）。 */
  bytes: number;
  skipped: TraceSkip | null;
  /** 为什么没留——人读的一句话，`skipped` 为 null 时是空串。 */
  detail: string;
}

/** 目录里已有的留档（数条数与总字节都用这一份，不分两次取料）。
 *  目录读不到（第一天还没有目录）＝零条零字节，与「有目录但空」同一处理。 */
async function existingTraces(dir: string): Promise<{ names: string[]; bytes: number }> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [] as Dirent[]);
  const names = entries
    .filter((e) => e.isFile() && e.name.endsWith(TRACE_SUFFIX))
    .map((e) => e.name);
  let bytes = 0;
  for (const n of names) {
    const s = await stat(join(dir, n)).catch(() => null);
    if (s !== null && s.isFile()) bytes += s.size;
  }
  return { names, bytes };
}

/** 留下一条失败轨迹（或如实说出为什么没留）。**每一趟都调它**——「绿的那趟不落」这件事
 *  要能在同一行读数里被看见，否则「没有 FAIL」与「留档那一步没接」在盘上同形（#109 沉默四百页的形状）。
 *  返回的 `skipped` 是分派的格子，不是布尔：调用方与判卷都靠它分「不该写」与「写坏了」。 */
export async function keepFailedTrace(i: TraceKeepInput): Promise<TraceKeepOutcome> {
  const dirRel = failedTraceDir(i.out, i.day);
  const dirAbs = join(i.root, dirRel);
  const targetRel = dirRel + "/" + i.caseId + TRACE_SUFFIX;
  const targetAbs = join(dirAbs, i.caseId + TRACE_SUFFIX);
  const none = (skipped: TraceSkip, detail: string): TraceKeepOutcome =>
    ({ relPath: null, absPath: null, bytes: 0, skipped, detail });
  // 第一道闸：这趟**在跑器那一侧算不算失败**。裁决是人家印出来的那个 verdict，这里只做等值比较，
  // 不重算判据、不把「无效」（未起步/被 provider 打断）当失败——那几趟固化出来的尺子量的是限流器。
  if (i.verdict !== FAILED_VERDICT) {
    return none("not-a-failure", "这一行的裁决是「" + i.verdict + "」⇒ 不是失败，不留档");
  }
  if (i.keepAll) {
    return none("covered-by-keep-all", "--keep 已把这趟的全量转录留在产物目录根 ⇒ 不写第二份");
  }
  const src = await stat(i.sourcePath).catch(() => null);
  if (src === null || !src.isFile()) {
    return none("source-unreadable", "读不到源转录：" + i.sourcePath + "（这一趟等于没留档）");
  }
  // 「已在场」排在帽之前：同日同靶已经留过的那一份不该被算成"被帽丢掉"。
  if (await stat(targetAbs).then((s) => s.isFile()).catch(() => false)) {
    return none("already-there", "同日同靶已有留档 ⇒ 不覆盖（草稿可能已被人补过件，同 draft.ts 第③条）");
  }
  const countCap = i.countCap ?? TRACE_COUNT_CAP;
  const fileCap = i.fileBytesCap ?? TRACE_FILE_BYTES_CAP;
  const totalCap = i.totalBytesCap ?? TRACE_TOTAL_BYTES_CAP;
  const seen = await existingTraces(dirAbs);
  if (seen.names.length >= countCap) {
    return none("count-cap", `该日已有 ${String(seen.names.length)} 条 ⇒ 帽 ${String(countCap)} 条，这条没留`);
  }
  if (src.size > fileCap) {
    return none("file-bytes-cap", `本条 ${String(Math.round(src.size / 1024))} KB > 单条帽 ${String(Math.round(fileCap / 1024))} KB ⇒ 不截断，整条没留`);
  }
  if (seen.bytes + src.size > totalCap) {
    return none("total-bytes-cap", `目录已用 ${String(seen.bytes)} B ＋ 本条 ${String(src.size)} B > 总帽 ${String(totalCap)} B ⇒ 这条没留`);
  }
  try {
    await mkdir(dirAbs, { recursive: true });
    await copyFile(i.sourcePath, targetAbs);
  } catch (err) {
    // 写失败与"没失败可留"是两件事：这里出声并点名是哪一条，读数不许退回 0 冒充安静。
    return none("source-unreadable", "写入失败：" + (err instanceof Error ? err.message : String(err)) + "（靶 " + i.caseId + "）");
  }
  return { relPath: targetRel, absPath: targetAbs, bytes: src.size, skipped: null, detail: "" };
}

/** 一趟跑批的留档读数。`keepFailedTrace` 每趟交一份 outcome，这里汇总成**一行**印出来。 */
export interface TraceFace {
  root: string;
  out: string;
  day: string;
  outcomes: readonly TraceKeepOutcome[];
  countCap: number;
  fileBytesCap: number;
  totalBytesCap: number;
}

const count = (o: readonly TraceKeepOutcome[], s: TraceSkip): number => o.filter((x) => x.skipped === s).length;

/** 那行读数。为什么要**永远**印（一条都没留也印）：
 *  「没有 FAIL 趟次」与「留档这一跳没接」在盘上长得一模一样，而后者正是 #109 沉默了 400 页的形状。
 *  「非失败不写」那一格是这行的**反向证人**——目录小不是因为帽，而是因为绿的本就不该留。 */
export function traceKeepLine(f: TraceFace): string {
  const kept = f.outcomes.filter((x) => x.skipped === null);
  const bytes = kept.reduce((a, x) => a + x.bytes, 0);
  const dirRel = failedTraceDir(f.out, f.day);
  const abs = resolve(f.root, dirRel);
  const rel = isAbsolute(dirRel) ? relative(f.root, abs) : dirRel;
  const inside = rel === "outputs" || rel.startsWith("outputs" + sep);
  const dropped = count(f.outcomes, "count-cap") + count(f.outcomes, "file-bytes-cap") + count(f.outcomes, "total-bytes-cap");
  const kb = (n: number): string => String(Math.round(n / 1024)) + " KB";
  return "[loop-eval] 失败轨迹留档：写出 " + String(kept.length) + " 条 " + kb(bytes) + " → " + rel + "/"
    + "（帽 " + String(f.countCap) + " 条/日·" + kb(f.fileBytesCap) + "/条·" + kb(f.totalBytesCap) + "/目录）"
    + "｜丢弃合计 " + String(dropped)
    + "：超条数帽 " + String(count(f.outcomes, "count-cap"))
    + "·超单条帽 " + String(count(f.outcomes, "file-bytes-cap"))
    + "·超目录总帽 " + String(count(f.outcomes, "total-bytes-cap"))
    + "｜非失败不写 " + String(count(f.outcomes, "not-a-failure"))
    + "｜同日已在场不覆盖 " + String(count(f.outcomes, "already-there"))
    + "·--keep 已留全量而未写 " + String(count(f.outcomes, "covered-by-keep-all"))
    + "·没留成而报错 " + String(count(f.outcomes, "source-unreadable"))
    + "｜取法 node --import tsx scripts/gym-draft.ts " + rel + "/ --apply"
    + (inside ? "" : "｜⚠️ 落点不在 outputs/ 内 ⇒ repo-hygiene 面①量不到它");
}
