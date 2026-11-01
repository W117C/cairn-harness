import type { UsageLedgerAnalyticsPayload, UsageLedgerBucketPayload } from "../../../../../../src/main/ipc-protocol";
import { formatTokens } from "../../derived/format-tokens";

export type UsageMetrics = Omit<UsageLedgerBucketPayload, "day" | "model">;
export type UsageDay = UsageMetrics & { day: string; sessions: number; rounds: number; toolSteps: number };
export type UsageModel = UsageMetrics & { model: string | null };

export function emptyUsageMetrics(): UsageMetrics {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, usageCount: 0, workerUsageCount: 0, inputMeasured: 0, outputMeasured: 0, cacheReadMeasured: 0 };
}

export function sumUsageMetrics(rows: readonly UsageMetrics[]): UsageMetrics {
  const total = emptyUsageMetrics();
  for (const row of rows) {
    total.inputTokens += row.inputTokens;
    total.outputTokens += row.outputTokens;
    total.cacheReadTokens += row.cacheReadTokens;
    total.usageCount += row.usageCount;
    total.workerUsageCount += row.workerUsageCount;
    total.inputMeasured += row.inputMeasured;
    total.outputMeasured += row.outputMeasured;
    total.cacheReadMeasured += row.cacheReadMeasured;
  }
  return total;
}

/** Token 数字的展示口径（第 936 页）：与用量环 / 检查器 / 时间线同一把尺（`formatTokens` 的 k/m 档）。
 *  此前这里走 `Intl.NumberFormat` 的中文紧凑记法 ⇒ 同一个 14_000 在用量页写「1.4万」、
 *  在输入框旁的用量环写「14.0k」。缺测（measured === 0）仍是「—」，不折成 0。 */
export function usageTokenLabel(value: number, measured: number): string {
  return measured === 0 ? "—" : formatTokens(value);
}

/** 按扫描器声明的时区确定今天，再做纯日历运算；跨时区/夏令时不移动归日边界。 */
export function usagePeriod(analytics: UsageLedgerAnalyticsPayload, range: number) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: analytics.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(analytics.generatedAt);
  const part = (name: string) => Number(parts.find((value) => value.type === name)?.value);
  const end = new Date(Date.UTC(part("year"), part("month") - 1, part("day")));
  const days: UsageDay[] = Array.from({ length: range }, (_, index) => {
    const date = new Date(end);
    date.setUTCDate(date.getUTCDate() - range + index + 1);
    const day = date.toISOString().slice(0, 10);
    return { ...emptyUsageMetrics(), day, sessions: 0, rounds: 0, toolSteps: 0 };
  });
  const dayMap = new Map(days.map((row) => [row.day, row]));
  const modelMap = new Map<string | null, UsageModel>();
  const selected = analytics.buckets.filter((row) => row.day !== null && dayMap.has(row.day));
  for (const row of selected) {
    const day = dayMap.get(row.day!)!;
    Object.assign(day, sumUsageMetrics([day, row]));
    const previous = modelMap.get(row.model);
    modelMap.set(row.model, { ...sumUsageMetrics(previous ? [previous, row] : [row]), model: row.model });
  }
  for (const row of analytics.activity) {
    const day = row.day === null ? undefined : dayMap.get(row.day);
    if (day) { day.sessions = row.sessions; day.rounds = row.rounds; day.toolSteps = row.toolSteps; }
  }
  return { days, totals: sumUsageMetrics(selected), models: [...modelMap.values()] };
}

/** 用量 CSV（第 825 页）：逐日明细 + 合计行；数值用原始整数，缺测仍写已上报值（与界面口径一致：
 *  「—」只在展示层，CSV 不把缺测伪装成 0）。纯函数，方便粘贴进表格。 */
export function usageCsv(period: ReturnType<typeof usagePeriod>): string {
  const esc = (value: string | number): string => {
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const rows: (string | number)[][] = [
    ["日期", "输入Token", "输出Token", "缓存读取Token", "用量记录", "输入缺测", "输出缺测"],
  ];
  for (const day of period.days) {
    rows.push([day.day, day.inputTokens, day.outputTokens, day.cacheReadTokens, day.usageCount, day.usageCount - day.inputMeasured, day.usageCount - day.outputMeasured]);
  }
  const t = period.totals;
  rows.push(["合计", t.inputTokens, t.outputTokens, t.cacheReadTokens, t.usageCount, t.usageCount - t.inputMeasured, t.usageCount - t.outputMeasured]);
  return rows.map((row) => row.map(esc).join(",")).join("\n") + "\n";
}
