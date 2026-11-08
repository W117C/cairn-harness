// 会话日志的用量扫描（主进程只读面，2026-10-21 批 131）。
//
// 为什么不复用 `openSession`：那条路会做崩溃恢复、刷新漂移基线、把整份事件读进内存——
// 只为统计数字而动这些状态，等于把「看一眼用量」变成一次写路径副作用。这里只读文件。
//
// 为什么按行流式：历史会话可能很大；只保留 usage / tool_call / user_message 的累计值与
// 日期/模型分桶，不把整份事件留在内存。每行仍要 parse，坏行计数才能覆盖整份日志。
//
// 失败口径：文件读不了由上层的 `skipped` 计数；文件里的坏行记 `badLines`，不静默当成 0。
import { createReadStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import type { AgentEvent } from "../events";
import { emptyUsageTotals, foldUsageEvent, type UsageTotals } from "./usage-ledger";
import { cloneUsageAnalytics, emptyUsageAnalytics, foldUsageAnalytics, usageAnalyticsSnapshot, type UsageFileAnalytics } from "./usage-analytics";

export interface UsageFileScan {
  totals: UsageTotals;
  analytics: UsageFileAnalytics;
  /** 非空、但 JSON 解析失败的行数（日志损坏/半行写入）——面板据此如实提示。 */
  badLines: number;
}

export interface UsageFileCacheEntry extends UsageFileScan {
  size: number;
  mtimeMs: number;
}

export type UsageFileCache = Map<string, UsageFileCacheEntry>;

/** 文件最后一个字节是不是换行。用它区分「坏行」与「正在写入的半行」：
 *  live 会话最后一行没有换行、JSON 解析失败，是正常在飞状态，不该冒充损坏。 */
async function endsWithNewline(file: string, size: number): Promise<boolean> {
  if (size === 0) return true;
  const fh = await open(file, "r");
  try {
    const buf = Buffer.allocUnsafe(1);
    const { bytesRead } = await fh.read(buf, 0, 1, size - 1);
    return bytesRead === 1 && buf[0] === 0x0a;
  } catch {
    return true;
  } finally {
    await fh.close().catch(() => undefined);
  }
}

/** 扫描一个会话 JSONL。cache 以「路径 + size + mtime」为键：重复打开面板不重读未变文件。
 *  2026-10-21 评审修：**每一行都 parse**——只 parse 含关键词的行会把损坏的 assistant 行静默漏掉；
 *  最后一行若文件没有尾换行且解析失败，视为在飞半行，不记 badLines。 */
export async function scanUsageFile(file: string, cache?: UsageFileCache): Promise<UsageFileScan> {
  const st = await stat(file);
  const cached = cache?.get(file);
  if (cached !== undefined && cached.size === st.size && cached.mtimeMs === st.mtimeMs) {
    return { totals: { ...cached.totals }, analytics: cloneUsageAnalytics(cached.analytics), badLines: cached.badLines };
  }

  const totals = emptyUsageTotals();
  const analyticsAcc = emptyUsageAnalytics();
  const trailingNewline = await endsWithNewline(file, st.size);
  let badLines = 0;
  let lastLineBad = false;
  const rl = createInterface({
    input: createReadStream(file, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  try {
    for await (const line of rl) {
      if (line.trim() === "") continue;
      let raw: unknown;
      try {
        raw = JSON.parse(line);
        lastLineBad = false;
      } catch {
        badLines += 1;
        lastLineBad = true;
        continue;
      }
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) continue;
      const event = raw as AgentEvent;
      if (typeof (event as { type?: unknown }).type !== "string") continue;
      foldUsageEvent(totals, event);
      foldUsageAnalytics(analyticsAcc, event);
    }
  } finally {
    rl.close();
  }
  // 在飞半行：文件没有尾换行且最后一行解析失败 ⇒ 这是写入中的半条，不是损坏。
  if (lastLineBad && !trailingNewline) badLines = Math.max(0, badLines - 1);

  const analytics = usageAnalyticsSnapshot(analyticsAcc);
  cache?.set(file, { totals: { ...totals }, analytics: cloneUsageAnalytics(analytics), badLines, size: st.size, mtimeMs: st.mtimeMs });
  return { totals, analytics, badLines };
}
