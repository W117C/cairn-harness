import { open, stat } from "node:fs/promises";

/** H3-P2（审查 B-8）：spawn 血缘定位的增量索引——旧实现每次 spawn 全量读日志逐行 parse。
 *  会话 JSONL append-only：按 (logPath → 字节偏移/已扫行号/callId→行号) 增量解析新尾部。
 *  行号语义与全量版逐位一致：空行/坏行照常占行号，未完整落盘的尾行留待下次（字节偏移只推进完整行）。 */
const callIdIndexCache = new Map<string, { ino: number; offset: number; lines: number; index: Map<string, number> }>();
/** P2-2（审查）：callId 索引缓存容量帽——旧实现只增不减（每条会话日志一项）。淘汰后下次访问重扫
 *  该日志（与 events replayCache 同语义，可接受）。 */
const CALL_ID_INDEX_CACHE_MAX = 32;

/** B8（审查）：共享可变缓存（offset/lines 增量推进）在 await 间隙会被并发 spawn 交错读写，
 *  同一尾部被两路各推进一次 → 行号翻倍。按 logPath 维护在途 Promise 串行队列。 */
const callIdIndexChain = new Map<string, Promise<void>>();

async function advanceCallIdIndex(logPath: string, st: { ino: number; size: number }): Promise<void> {
  let c = callIdIndexCache.get(logPath);
  if (!c || c.ino !== st.ino || c.offset > st.size) {
    // 首访 / 文件被重建（同路径 rm 后新建，inode 变化）/ 被截断 → 全量重扫
    c = { ino: st.ino, offset: 0, lines: 0, index: new Map() };
    // P2-2（审查）：有界——照抄 events replayCache 的淘汰写法（删最早插入的一条）。
    if (callIdIndexCache.size >= CALL_ID_INDEX_CACHE_MAX) {
      const oldest = callIdIndexCache.keys().next().value;
      if (oldest !== undefined) callIdIndexCache.delete(oldest);
    }
    callIdIndexCache.set(logPath, c);
  }
  if (c.offset >= st.size) return;
  const fh = await open(logPath, "r");
  try {
    const len = st.size - c.offset;
    const buf = Buffer.allocUnsafe(len);
    await fh.read(buf, 0, len, c.offset);
    const parts = buf.toString("utf8").split("\n");
    const trailing = parts.pop() ?? ""; // 未以 \n 结尾的半行不计入（append-only 写整行，通常为 ""）
    let consumed = 0;
    let lineNo = c.lines;
    for (const line of parts) {
      lineNo++;
      consumed += Buffer.byteLength(line, "utf8") + 1; // +1 = 换行符
      const t = line.trim();
      if (t === "") continue;
      try {
        const e = JSON.parse(t) as { type?: string; id?: string };
        if (e.type === "tool_call" && typeof e.id === "string") c.index.set(e.id, lineNo);
      } catch {
        /* 坏行跳过（照常占行号） */
      }
    }
    void trailing;
    c.offset += consumed;
    c.lines = lineNo;
  } finally {
    await fh.close();
  }
}

export async function findToolCallEventId(logPath: string, callId: string): Promise<number> {
  const st = await stat(logPath).catch(() => null);
  if (!st) return 0;
  const prev = callIdIndexChain.get(logPath) ?? Promise.resolve();
  const job = prev.catch(() => {}).then(() => advanceCallIdIndex(logPath, st));
  callIdIndexChain.set(logPath, job);
  try {
    await job;
  } finally {
    if (callIdIndexChain.get(logPath) === job) callIdIndexChain.delete(logPath); // 无并发即回收（有界）
  }
  const c = callIdIndexCache.get(logPath);
  return c ? (c.index.get(callId) ?? 0) : 0;
}
