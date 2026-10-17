// 变异配置表的**取料面**：2026-10-17 表按域拆在 `./mutations/*.mjs`（结构债审查报告 #5）。
//
// 为什么要有这一支：凡「读表文本」的判据（`extractAnchorNeedles` / `parseAnchors` / `id:` 行计数）
// 都不再读母脚本，而是读这里拼好的全文。文件清单**只此一份**——各判据自己抄一遍十三条路径，
// 下次拆表就会有一处静默少读，而少读的形态恰恰是「锚点看起来都在」。
//
// 顺序与母脚本 `scripts/mutate-verify.mjs` 的拼接顺序**逐字一致**：`--list` 的顺序、以及
// 「表长 = `id:` 行数」这条判据都依赖它。
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const MUTATION_TABLE_FILES = [
  "agent-orchestration",
  "agent-plugins",
  "agent-subsystems",
  "agent-runtime",
  "agent-misc",
  "main",
  "tools",
  "core",
  "scripts-gates",
  "scripts-mutate",
  "scripts-certs-eval",
  "scripts-misc",
  "misc",
] as const;

/** 拼好的表文本（换行分隔）。`root` 是仓库根。 */
export function readMutationTableText(root: string): string {
  return MUTATION_TABLE_FILES
    .map((f) => readFileSync(join(root, "scripts", "lib", "mutations", f + ".mjs"), "utf8"))
    .join("\n");
}
