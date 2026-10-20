// 写盘的「这次到底动了多少行」。此前 write_file 只报字节数、edit_file 只报处数——
// 两者都不告诉模型（也不告诉人）：这次写盘丢了几行、加了几行、原来的文件有多大。
// 目标里的两条直接挂在这个缺口上：「生成补丁级 diff 而不是重写整个文件」「改动范围最小」。
// 不报数就只能等测试炸了才发现「重抄一遍时漏抄了一个函数」。

/** 行增减：added = 新内容多出的行数，removed = 旧内容消失的行数。 */
export interface LineDelta {
  added: number;
  removed: number;
}

/** 按行切：空串 = 0 行；结尾换行不额外算一行（否则每个文件都凭空多一行空白）。 */
export function contentLines(text: string): string[] {
  if (text === "") return [];
  const arr = text.split("\n");
  if (arr[arr.length - 1] === "") arr.pop();
  return arr;
}

/** 行级增减 = 两份内容的**多重集差**。
 *  为什么不用 LCS：这里要回答的是「这次写盘动了 / 丢了多少行内容」，不是「最小 patch 长什么样」。
 *  多重集差不受行序影响且 O(n)；LCS 在同一段代码被搬位置时会报「全删全加」，
 *  反而把「其实一行内容都没变」说成改了整段。
 *  已知口径差：行序颠倒 / 内容整体换位置时这里记 0（内容确实没丢），git 会报大段改动。 */
export function lineDelta(oldText: string, newText: string): LineDelta {
  const counts = new Map<string, number>();
  for (const l of contentLines(oldText)) counts.set(l, (counts.get(l) ?? 0) + 1);
  let added = 0;
  for (const l of contentLines(newText)) {
    const c = counts.get(l) ?? 0;
    if (c > 0) counts.set(l, c - 1);
    else added++;
  }
  let removed = 0;
  for (const c of counts.values()) removed += c;
  return { added, removed };
}

/** 整份重写但其实只是小改：原文件够大、改动行占比够小 ⇒ 该用 edit_file。
 *  下界 40 行：小文件里重写与补丁的成本差可以忽略，提示就是噪声。 */
export function isNearCopyRewrite(oldLineCount: number, changedLineCount: number): boolean {
  return oldLineCount >= 40 && changedLineCount <= oldLineCount * 0.1;
}
