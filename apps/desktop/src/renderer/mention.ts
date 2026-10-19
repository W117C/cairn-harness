// @文件名 mention（P2-4 改薄）：触发解析 + token 替换 + 面包屑拆分。
// 逐层下钻的旧语义（mentionTarget / mentionCompletion / filterMentionEntries）下架——
// 补全数据面改走 workspaceSearch 通道（main 侧扁平模糊搜索，跳过 .git/node_modules）；
// 目录命中不再本地列举，改为「定范围再搜」（token 变 @目录/ 再发查询）。
// 口径（判据一字未动）：只对「词首 @」触发（邮箱 a@b、代码里 x@y 不误触）；@ 段内出现空白即断。

export interface MentionQuery {
  /** '@' 在文本里的下标。 */
  start: number;
  /** '@' 之后到光标的内容（不含 '@'）。 */
  query: string;
}

/** 光标处解析 mention 触发；null = 无触发。 */
export function parseMentionQuery(text: string, caret: number): MentionQuery | null {
  const pos = Math.max(0, Math.min(caret, text.length));
  const at = text.lastIndexOf("@", pos - 1);
  if (at < 0) return null;
  const seg = text.slice(at + 1, pos);
  if (/[\s@]/.test(seg)) return null; // 空白/又一个 @：段已断
  const prev = at > 0 ? text[at - 1]! : "";
  if (/[A-Za-z0-9_.\-]/.test(prev)) return null; // 词内 @（邮箱/代码标识）不触发
  return { start: at, query: seg };
}

/** 把 [start, caret) 段替换成补全文本（原 applyMention 改名保语义）。
 *  选中文件时 replacement = ""（清 @段，chip 是可视化真相）；
 *  选中目录时 replacement = `@目录/`（定范围继续搜）。 */
export function replaceMentionToken(text: string, start: number, caret: number, replacement: string): string {
  return text.slice(0, start) + replacement + text.slice(caret);
}

/** 相对路径 → 菜单行的面包屑拆分：name = 末段（目录尾斜杠剥掉），dir = 其余（灰字）。 */
export function mentionBreadcrumb(relPath: string): { dir: string; name: string } {
  const trimmed = relPath.endsWith("/") ? relPath.slice(0, -1) : relPath;
  const slash = trimmed.lastIndexOf("/");
  if (slash < 0) return { dir: "", name: trimmed };
  return { dir: trimmed.slice(0, slash), name: trimmed.slice(slash + 1) };
}
