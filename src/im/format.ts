// 发送格式化（2026-11-17 · 通道线）：会话转录的 markdown→纯文本折算与分片。纯函数，判卷直接钉。
//
// 折法取最保守的一路：**去格式保内容**——代码栅栏只留内容、行内 code 去反引号、
// 标题/强调/链接去装饰但保留链接文本，列表/引用保留标记语义的最小形。

const CODE_FENCE = /^(```|~~~)/;

/** markdown → 纯文本（IM 语域）。逐行处理，不跨行配对。 */
export function toPlainText(input: string): string {
  const out: string[] = [];
  let inFence = false;
  for (const rawLine of input.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (CODE_FENCE.test(line.trim())) {
      inFence = !inFence;
      out.push("");
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }
    let line2 = line;
    // 链接 [text](url) → text (url)；图片 ![alt](url) → alt (url)
    line2 = line2.replace(/!?\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, text: string, url: string) =>
      text.trim() === "" ? url : `${text} (${url})`);
    // 标题去 #；列表标记换 •；引用保留
    line2 = line2.replace(/^\s{0,3}#{1,6}\s+/, "");
    line2 = listMarker(line2);
    // 行内 code 与强调去装饰
    line2 = line2.replace(/`([^`]+)`/g, "$1");
    line2 = line2.replace(/\*\*([^*]+)\*\*/g, "$1");
    line2 = line2.replace(/__([^_]+)__/g, "$1");
    out.push(line2);
  }
  // 三连空行压成两连
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** 列表标记 → •（引用行不动）。 */
function listMarker(line: string): string {
  if (/^\s*>\s?/.test(line)) return line;
  const m = line.match(/^(\s*)([-*+])\s+/);
  if (m === null) return line;
  return `${m[1]}• ${line.slice(m[0].length)}`;
}

/** 按字数上限分片：按行聚合，单行超限才硬切，切点不落代理对中间。 */
export function chunkText(input: string, limit: number): string[] {
  if ([...input].length <= limit) return [input];
  const chunks: string[] = [];
  let held = "";
  for (const line of input.split("\n")) {
    const candidate = held === "" ? line : `${held}\n${line}`;
    if ([...candidate].length <= limit) {
      held = candidate;
      continue;
    }
    if (held !== "") {
      chunks.push(held);
      held = "";
    }
    const arr = [...line];
    for (let i = 0; i < arr.length; i += limit) {
      chunks.push(arr.slice(i, i + limit).join(""));
    }
  }
  if (held !== "") chunks.push(held);
  return chunks.length > 0 ? chunks : [""];
}
