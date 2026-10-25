/** typecheck 报错的**归因**（不改判定，只说清是谁的红）。
 *  tsc 扫的是整棵树，含**未跟踪**文件——于是别人正在写的草稿能把 `pnpm typecheck` 弄红，
 *  而 HEAD 本身是干净的。本仓已为此两次开 HEAD worktree 手工对照
 *  （`tests/observation-capture.test.ts` 缺参数类型那次、`scripts/sidebar-probe.ts` 4 条那次——后者未入库，只是当时的工作草稿）。
 *  对照要占一整轮且容易被误读成回归，所以把「哪些报错文件在 HEAD、哪些还是在飞草稿」做成一行输出。
 *
 *  第 330 页补的第三档（任务 #33，现读两次）：从前只有「tracked／未跟踪」两档，于是**隔壁会话正在改的 tracked 文件**
 *  带着未提交 hunk 被报红时，这一行会读成「HEAD 内 N 个」——而 HEAD 其实是干净的。两次现读同一形状：
 *  第 328 页补那次认证树全量判卷红一条（`dead-script-refs`），第 329 页那次 `scripts/typecheck.ts` 主树红 4 条、
 *  报的却是「HEAD 内 2 个」，而 `git show HEAD:src/agent/loop.ts` 与主树逐文件一比就知道红在飞的那一半。
 *  ⇒ 归因要按「这个文件在不在 HEAD 且干不干净」分，而不是按「在不在索引里」分。
 *  ⚠️ 退出码照抄 tsc：这里只归因，不豁免——草稿也是错，只是不该记在 HEAD 账上；
 *  而「在飞 tracked」那一档**也不许**顺手换成豁免：要证 HEAD 得开干净 worktree，这一格只说清该去找谁。 */

export interface TypecheckTriage {
  /** 报错涉及的去重文件数（不是错误条数）。 */
  total: number;
  /** tracked ∧ 工作树干净 ⇒ 这条报错在 HEAD 上就成立（真缺陷）。 */
  head: string[];
  /** tracked ∧ 工作树脏 ⇒ 分不清是 HEAD 缺陷还是别人未提交的那半个文件（要复认，不给豁免也不记账）。 */
  dirtyTracked: string[];
  /** 未跟踪 ⇒ 在飞草稿（含被 .gitignore 豁免的都不算，见 untrackedFiles）。 */
  scratch: string[];
  /** `git diff HEAD` 取不到 ⇒ **这一格没量到**：不许并进 `head`（那是谎报缺陷），也不许并进 `dirtyTracked`（那是谎报"有归因"）。 */
  undetermined: string[];
}

/** tsc 行形态 `path(12,5): error TS2345: …`。
 *  路径**可以含空格**（本仓历史目录名 "deepseek harness" 就带空格；2026-10-24 已更名 cairn，夹具保留空格路径防回归）⇒ 取路径只能用非贪婪 + 锚定尾部的
 *  `(行,列): error TS`，按空白切会截出半个路径、归因随之全错（这类"解析器恰好对英文目录成立"
 *  的坑与 chars/4 是同族）。 */
const TSC_ERROR_LINE = /^(.+?)\(\d+,\d+\): error TS\d+/u;

/** `dirty === null` ＝ 工作树状态取不到（调用方 git 失败），不是"没有脏文件"。 */
export function triageTypecheck(
  output: string, untracked: ReadonlySet<string>, dirty: ReadonlySet<string> | null,
): TypecheckTriage {
  const files = new Set<string>();
  for (const line of output.split("\n")) {
    const m = TSC_ERROR_LINE.exec(line);
    if (m) files.add(m[1]!.trim().replace(/\\/g, "/"));
  }
  const head: string[] = [];
  const dirtyTracked: string[] = [];
  const scratch: string[] = [];
  const undetermined: string[] = [];
  for (const f of [...files].sort()) {
    if (untracked.has(f)) { scratch.push(f); continue; }
    if (dirty === null) { undetermined.push(f); continue; }
    if (dirty.has(f)) dirtyTracked.push(f); else head.push(f);
  }
  return { total: files.size, head, dirtyTracked, scratch, undetermined };
}

/** 「HEAD 态类型干净」这句只有在**没有任何一条报错落在 tracked 面上**时才许说——
 *  落在「在飞 tracked」或「取不到」那一档都不算证过（那是"没量到"，不是"没有"）。 */
export function triageVerdict(t: TypecheckTriage): string[] {
  if (t.total === 0) return [];
  const assigned = t.head.length + t.dirtyTracked.length + t.scratch.length + t.undetermined.length;
  const out = ["[typecheck] 报错文件归因：HEAD 内 " + String(t.head.length) + "／在飞改动中的 tracked " + String(t.dirtyTracked.length)
    + "／未跟踪草稿 " + String(t.scratch.length) + "／工作树状态取不到 " + String(t.undetermined.length)
    + "（四档相加＝" + String(assigned) + "，与分母 " + String(t.total) + " 不等就是归因坏了）"];
  if (t.scratch.length > 0) out.push("[typecheck] ⚠️ 未跟踪草稿（不属 HEAD 回归，属在飞改动）: " + t.scratch.join(", "));
  if (t.dirtyTracked.length > 0) {
    out.push("[typecheck] ⚠️ tracked 但工作树脏（分不清是 HEAD 缺陷还是隔壁未提交的 hunk ⇒ 要证 HEAD 请开干净 worktree；这一格只归因、不豁免）: "
      + t.dirtyTracked.join(", "));
  }
  if (t.undetermined.length > 0) {
    out.push("[typecheck] ❌ `git diff HEAD` 取不到 ⇒ 这些文件**没有归位**，不等于「HEAD 内」也不等于「在飞」: " + t.undetermined.join(", "));
  }
  if (t.head.length === 0 && t.dirtyTracked.length === 0 && t.undetermined.length === 0) {
    out.push("[typecheck] tracked 面没有报错 ⇒ HEAD 态类型干净（全部报错都在未跟踪草稿里；同 HEAD 开 worktree 跑 tsc 可复核）");
  }
  return out;
}
