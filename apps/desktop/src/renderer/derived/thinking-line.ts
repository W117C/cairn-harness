// 流式思考 ticker 的取材（2026-11-08 第 1042 页，zcode 3.17.2 ReasoningTrigger 同形）：
// 折叠态要回答的是「它正在想什么」——取最后一个非空行，不是开头 120 字的陈旧摘要。
// key = 行号：同一行续写不换 key（不重滚），新行到来才换 key 滚入。
export function lastThinkingLine(text: string): { key: string; text: string } | null {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim();
    if (line !== "") return { key: String(i), text: line };
  }
  return null;
}