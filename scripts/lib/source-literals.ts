// 源码字面量面的两条纯函数——从一份 TS/JS 源码文本里抽出**字符串字面量**，并在其中找记忆面危险引用。
//
// 为什么抽出来（2026-10-04，第 372 页）：
//   `scripts/memory-check.ts` 的 G6「压缩器代码路径无 fs/记忆目录引用」原先是
//   `!src.includes(".agent")`——扫**整份源码文本**。于是 10-03 那次压缩器改版引入的
//   `who(e.agent_id)`（一次与记忆目录毫无关系的属性访问）里 "e.agent" 恰好含子串 ".agent"
//   ⇒ 门红得理直气壮，而代码一行都没碰记忆目录。这是一次**尺坏了**，不是代码有缺陷。
//   判卷侧当天已把口径收紧为「只看字符串字面量」（`tests/memory-runner.test.ts` 的 G6 同名格），
//   门侧漏了同步 ⇒ 门红、判卷绿。本模块把那份口径抽成**单源**，两边引用同一只谓词，
//   以后再改只改这一处。
//
// 覆盖面（收紧到字面量之后，按实测如实写）：
//   **会抓**：字符串字面量与模板串的静态部分——真要读记忆目录必须写 `".agent"`
//   （路径拼接的段就是字面量），真要 import fs 必须写 `"node:fs..."`，两者都是字面量。
//   **不会抓**：行注释、块注释、变量名与属性名（如 `e.agent_id`）。这一档是**有意缩窄**的，
//   理由是它们不是代码路径：注释里提一句 ".agent" 不会让压缩器去读记忆目录。
//   正证不是这条静态代理，而是 `memory-check` 里的 G5——canary 文件逐字未变的**行为**断言。
//
// 抽字面量的正则与判卷那份**逐字同源**（含 `\\.` 转义与「不许提前闭引号」的 tempered 规则），
// 免得两边各写一份、日后漂成两种口径。

/** 从源码文本里抽出全部字符串字面量的内容（不含引号本身）。 */
export function stringLiterals(src: string): string[] {
  return [...src.matchAll(/(["'`])((?:\\.|(?!\1)[\s\S])*)\1/g)].map((m) => m[2] ?? "");
}

/** 记忆面危险引用的四类：fs 导入、记忆目录、记忆文件名。 */
export type MemorySurfaceHit = "node:fs" | "fs/promises" | ".agent" | "MEMORY.md";

/**
 * 在源码的**字符串字面量面**上找记忆面危险引用，返回命中的类别（无命中＝空数组）。
 *
 * `joined` 末尾补一个换行：`node:fs` 那条谓词是 `(^|[^\w])` 收尾的，若命中项恰好是最后一个
 * 字面量就没有后继字符可比，`^` 又因未开 `m` 只认整串开头 ⇒ 会漏。这比判卷那份**更敏感**一档，
 * 方向是安全的（门不得比判卷弱），且不会把当前源码读成红。
 */
export function memorySurfaceHits(src: string): MemorySurfaceHit[] {
  const joined = stringLiterals(src).join("\n") + "\n";
  const hits: MemorySurfaceHit[] = [];
  if (/node:fs(^|[^\w])/u.test(joined)) hits.push("node:fs");
  if (/(^|[^.\w])fs\/promises/u.test(joined)) hits.push("fs/promises");
  if (joined.includes(".agent")) hits.push(".agent");
  if (joined.includes("MEMORY.md")) hits.push("MEMORY.md");
  return hits;
}