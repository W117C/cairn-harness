// 会话日志尾部读取（2026-10-21 批 132）：只读、有界，不把整份历史日志读进内存。
//
// 为什么不直接 readFile：长会话的 JSONL 可能有几十 MB，而「看日志」只看最近的失败上下文。
// 这里从文件尾部读至多 256 KiB，再按行裁到调用方要的行数；从中间切开的那一行（以及可能
// 被切开的 UTF-8 多字节序列）一并丢掉，不把半行/乱码当正文展示。
import { open, stat } from "node:fs/promises";

export interface SessionLogTail {
  /** 尾部正文（已去尾随空行；行间以 \n 连接）。 */
  text: string;
  /** 是否不是整份文件（字节截断或行数截断）。 */
  truncated: boolean;
  /** 文件总字节数（不是读到的字节数）。 */
  bytes: number;
  /** 返回的行数。 */
  lines: number;
}

export const SESSION_LOG_DEFAULT_LINES = 400;
export const SESSION_LOG_MAX_LINES = 2000;
export const SESSION_LOG_MAX_BYTES = 256 * 1024;

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(max, Math.max(min, n));
}

/** 丢掉被字节窗口切开的 UTF-8 续字节（0b10xxxxxx），避免尾部开头出现替换字符。 */
function skipContinuationBytes(buf: Buffer): Buffer {
  let i = 0;
  while (i < buf.length && (buf[i]! & 0xc0) === 0x80) i += 1;
  return i === 0 ? buf : buf.subarray(i);
}

export async function readSessionLogTail(file: string, tailLines?: number): Promise<SessionLogTail> {
  const st = await stat(file);
  const want = clampInt(tailLines, 1, SESSION_LOG_MAX_LINES, SESSION_LOG_DEFAULT_LINES);
  const size = Math.min(st.size, SESSION_LOG_MAX_BYTES);
  const start = st.size - size;
  let truncated = start > 0;
  let raw: Buffer = Buffer.alloc(0);

  if (size > 0) {
    const fh = await open(file, "r");
    try {
      const buf = Buffer.allocUnsafe(size);
      const { bytesRead } = await fh.read(buf, 0, size, start);
      raw = buf.subarray(0, bytesRead);
    } finally {
      await fh.close().catch(() => undefined);
    }
    if (start > 0) {
      const nl = raw.indexOf(0x0a);
      raw = nl >= 0 ? raw.subarray(nl + 1) : skipContinuationBytes(raw);
    }
  }

  const all = raw.toString("utf8").split(/\r?\n/);
  if (all.length > 0 && all[all.length - 1] === "") all.pop();
  let lines = all;
  if (lines.length > want) {
    lines = lines.slice(-want);
    truncated = true;
  }
  return { text: lines.join("\n"), truncated, bytes: st.size, lines: lines.length };
}
