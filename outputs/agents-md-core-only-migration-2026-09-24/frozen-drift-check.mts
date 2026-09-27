/** 一次性对照：`frozenCoverageDrift` 的扫描区里到底有没有 `fixtures/no-progress`？
 *  为什么单独跑它：整表里 gate-check 那条红有**两种**读法——「新 worktree 天生没有 .jsonl（环境）」
 *  与「表里有、扫描区没有 ⇒ 无论文件在不在都红（判据恒真）」。两者的修法完全相反，
 *  而分辨只要一次函数调用 + 两棵树（主树的 .jsonl 确实在盘上）。 */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { frozenCoverageDrift } from "../../src/frozen";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const trees: Array<[string, string]> = [
  ["主树（.jsonl 在盘上）", ROOT],
  ["隔离树（新 worktree，无 ignored 语料）", join(ROOT, ".worktrees", "head-audit-0924")],
];
for (const [label, root] of trees) {
  const d = await frozenCoverageDrift(root);
  console.log(`${label}: inTableNotOnDisk=${d.inTableNotOnDisk.length} onDiskNotInTable=${d.onDiskNotInTable.length}`);
  for (const x of d.inTableNotOnDisk.slice(0, 3)) console.log(`   · ${x}`);
}
