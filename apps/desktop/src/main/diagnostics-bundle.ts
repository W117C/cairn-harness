/**
 * 诊断包（2026-10-30 · 第 807 页）。
 *
 * 页 800 给了主进程日志、页 803 给了可复制的诊断报告，但支持场景仍要用户分别拿两样东西。
 * 这里把两者拼成一份 Markdown：报告在前、日志尾部在后，一个文件就能贴进 issue。
 * 纯拼接 + 有界读尾：不跑模型、不扫工作区，只读 `logs/main.log` 的最后若干行。
 */
import { open, readFile, stat } from "node:fs/promises";

export const DIAGNOSTICS_LOG_MAX_BYTES = 256 * 1024;
export const DIAGNOSTICS_LOG_MAX_LINES = 200;

export interface LogTail {
  text: string;
  /** 是否因字节/行数上限截掉了更早的内容。 */
  truncated: boolean;
  lines: number;
}

/** 读日志尾部：文件不存在 = null（不是错误）；只保留末尾 maxLines 行，读入字节上限 256 KiB。 */
export async function readLogTail(
  file: string,
  opts: { maxBytes?: number; maxLines?: number } = {},
): Promise<LogTail | null> {
  const maxBytes = opts.maxBytes ?? DIAGNOSTICS_LOG_MAX_BYTES;
  const maxLines = opts.maxLines ?? DIAGNOSTICS_LOG_MAX_LINES;
  let info;
  try {
    info = await stat(file);
  } catch {
    return null;
  }
  if (!info.isFile()) return null;
  let text: string;
  let truncated = false;
  try {
    if (info.size > maxBytes) {
      // 只读尾部：日志是追加写的，头部对一次事故的定位价值最低。
      const handle = await open(file, "r");
      try {
        const buffer = Buffer.alloc(maxBytes);
        await handle.read(buffer, 0, maxBytes, Math.max(0, info.size - maxBytes));
        text = buffer.toString("utf8");
      } finally {
        await handle.close();
      }
      truncated = true;
    } else {
      text = await readFile(file, "utf8");
    }
  } catch {
    return null;
  }
  const lines = text.split("\n");
  // 末尾换行会得到一个空段；保留它不影响阅读，但计数时去掉。
  const contentLines = lines[lines.length - 1] === "" ? lines.slice(0, -1) : lines;
  const kept = contentLines.slice(Math.max(0, contentLines.length - maxLines));
  if (kept.length < contentLines.length) truncated = true;
  return { text: kept.join("\n"), truncated, lines: kept.length };
}

/** 报告 + 日志尾部 → 一份 Markdown。`logTail=null` 时明确写「没有日志文件」，不静默省略。 */
export function buildDiagnosticsBundle(input: {
  reportText: string;
  generatedAt: string;
  logTail: LogTail | null;
}): string {
  const out: string[] = [
    "# Cairn 诊断包",
    "",
    `生成时间：${input.generatedAt}`,
    "",
    "## 诊断报告",
    "",
    input.reportText.trimEnd(),
    "",
    "## 主进程日志",
    "",
  ];
  if (input.logTail === null) {
    out.push("（没有日志文件：应用尚未写过 logs/main.log）");
  } else {
    out.push(`末尾 ${String(input.logTail.lines)} 行${input.logTail.truncated ? "（更早内容已截断）" : ""}：`, "", "```text", input.logTail.text, "```");
  }
  return out.join("\n") + "\n";
}
