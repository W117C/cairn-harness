/** 红门的完整输出落盘（第 123 页）。
 *
 *  动机是实测：`pnpm gates` 对失败门只印**输出尾 12 行**，全量既不打印也不落盘 ⇒
 *  `mutate-verify` 报「7 条变异存活或误伤」却给不出那 7 条的名字，要定位只能单独复跑，实测 **1,007s**。
 *  一门红而不可定位，等于把"验证 → 修正"那一半换成一次 17 分钟的复跑。
 *
 *  这是**侧信道**：写失败只出声（返回 error 让调用点印一行），绝不抛、绝不改变任何一道门的结论或退出码
 *  ——同 `gates.ts` 里耗时账本那条纪律。 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** 落盘目录：`.tmp/` 已在 `.gitignore` 里（第 5 行），生成物不会污染工作树。 */
export const FAILURE_DIR = ".tmp/gate-failures";

/** 展示用的尾部行数（落盘写全量，截断只许发生在打印）。 */
export const FAILURE_TAIL_LINES = 12;

/** 门名 → 文件名。门名来自 `gate-manifest.ts`，但**落盘路径不赌上游**：
 *  `/`、`:`、前导点一律压掉，否则清单里漂出一个 `../x` 就把文件写到目录外。
 *  先 `trim()`：纯空白门名要落进 `unnamed`，而不是变成 `___.log` 那种"看着有名字"的文件。 */
export function failureFileName(gate: string): string {
  const cleaned = gate.trim().replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "");
  return (cleaned === "" ? "unnamed" : cleaned) + ".log";
}

export function failureFilePath(root: string, gate: string): string {
  return join(root, FAILURE_DIR, failureFileName(gate));
}

/** 打印行只有一个生成点：路径必须说出口——只说「已落盘」等于没落盘。 */
export function failureFooter(path: string): string {
  return "      完整输出已落盘： " + path + "（这里只贴尾部 " + String(FAILURE_TAIL_LINES) + " 行）";
}

/** 写全量输出。成功返回 `path`；失败返回 `path: ""` ＋ `error`，**不抛**。 */
export function writeFailureLog(
  root: string,
  gate: string,
  output: string,
): { path: string; error?: string } {
  const path = failureFilePath(root, gate);
  try {
    mkdirSync(join(root, FAILURE_DIR), { recursive: true });
    writeFileSync(path, output);
    return { path };
  } catch (e) {
    return { path: "", error: e instanceof Error ? e.message : String(e) };
  }
}
