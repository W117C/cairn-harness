/** typecheck 报错的**归因**（不改判定，只说清是谁的红）。
 *  tsc 扫的是整棵树，含**未跟踪**文件——于是别人正在写的草稿能把 `pnpm typecheck` 弄红，
 *  而 HEAD 本身是干净的。本仓已为此两次开 HEAD worktree 手工对照
 *  （`tests/observation-capture.test.ts` 缺参数类型那次、`scripts/sidebar-probe.ts` 4 条那次）。
 *  对照要占一整轮且容易被误读成回归，所以把「哪些报错文件在 HEAD、哪些还是在飞草稿」做成一行输出。
 *  ⚠️ 退出码照抄 tsc：这里只归因，不豁免——草稿也是错，只是不该记在 HEAD 账上。 */

export interface TypecheckTriage {
  /** 报错涉及的去重文件数（不是错误条数）。 */
  total: number;
  /** 已被 git 跟踪 ⇒ 属 HEAD 缺陷。 */
  tracked: string[];
  /** 未跟踪 ⇒ 在飞草稿（含被 .gitignore 豁免的都不算，见 untrackedFiles）。 */
  scratch: string[];
}

/** tsc 行形态 `path(12,5): error TS2345: …`。
 *  路径**可以含空格**（本仓目录名就是 "deepseek harness"）⇒ 取路径只能用非贪婪 + 锚定尾部的
 *  `(行,列): error TS`，按空白切会截出半个路径、归因随之全错（这类"解析器恰好对英文目录成立"
 *  的坑与 chars/4 是同族）。 */
const TSC_ERROR_LINE = /^(.+?)\(\d+,\d+\): error TS\d+/u;

export function triageTypecheck(output: string, untracked: ReadonlySet<string>): TypecheckTriage {
  const files = new Set<string>();
  for (const line of output.split("\n")) {
    const m = TSC_ERROR_LINE.exec(line);
    if (m) files.add(m[1]!.trim().replace(/\\/g, "/"));
  }
  const tracked: string[] = [];
  const scratch: string[] = [];
  for (const f of [...files].sort()) {
    if (untracked.has(f)) scratch.push(f);
    else tracked.push(f);
  }
  return { total: files.size, tracked, scratch };
}

export function triageVerdict(t: TypecheckTriage): string[] {
  if (t.total === 0) return [];
  const out = ["[typecheck] 报错文件归因：HEAD 内 " + String(t.tracked.length) + " 个 / 未跟踪草稿 " + String(t.scratch.length) + " 个"];
  if (t.scratch.length > 0) out.push("[typecheck] ⚠️ 未跟踪草稿（不属 HEAD 回归，属在飞改动）: " + t.scratch.join(", "));
  if (t.tracked.length === 0) out.push("[typecheck] 全部报错都在未跟踪草稿里 ⇒ HEAD 态类型干净（同 HEAD 开 worktree 跑 tsc 可复核）");
  return out;
}
