// 工具返回内容的呈现分档（2026-11-08 第 1042 页，zcode uQe 同规）：
// 短纯文本（≤160 字、单行、非 JSON）是人话结果，穿 pre 代码块外衣会读成终端转储；
// 长/多行/JSON 仍走代码块（对齐与结构不丢）。像 JSON 但 parse 不通 ⇒ 纯文本（不猜结构）。
export const PLAIN_OUTPUT_MAX = 160;

export function isPlainShortOutput(output: string): boolean {
  const t = output.trim();
  if (t.length === 0 || t.length > PLAIN_OUTPUT_MAX) return false;
  if (t.includes("\n")) return false;
  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      JSON.parse(t);
      return false;
    } catch {
      return true;
    }
  }
  return true;
}