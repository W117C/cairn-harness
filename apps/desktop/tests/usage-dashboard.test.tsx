import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { UsageLedgerPayload } from "../../../src/main/ipc-protocol";
import { UsageDashboard, usagePeriod, usageTokenLabel } from "../src/renderer/components/settings/UsageSection";

const data: Extract<UsageLedgerPayload, { ok: true }> = {
  ok: true, sessions: 3, workspaces: 2, skipped: 1, badLines: 2,
  totals: { inputTokens: 150, outputTokens: 30, cacheReadTokens: 60, usageCount: 3, rounds: 2, toolSteps: 4 },
  analytics: {
    generatedAt: new Date(2026, 9, 24, 12).getTime(), timeZone: "Asia/Shanghai", sessionsWithUsage: 2, sessionsWithoutUsage: 0,
    buckets: [
      { day: "2026-10-01", model: "older-model", inputTokens: 100, outputTokens: 20, cacheReadTokens: 50, usageCount: 1, workerUsageCount: 0, inputMeasured: 1, outputMeasured: 1, cacheReadMeasured: 1 },
      { day: "2026-10-24", model: "new-model", inputTokens: 40, outputTokens: 8, cacheReadTokens: 10, usageCount: 1, workerUsageCount: 1, inputMeasured: 1, outputMeasured: 1, cacheReadMeasured: 1 },
      { day: null, model: null, inputTokens: 10, outputTokens: 2, cacheReadTokens: 0, usageCount: 1, workerUsageCount: 0, inputMeasured: 1, outputMeasured: 1, cacheReadMeasured: 0 },
    ],
    activity: [{ day: "2026-10-01", sessions: 1, rounds: 1, toolSteps: 1 }, { day: "2026-10-24", sessions: 1, rounds: 1, toolSteps: 3 }],
  },
};

describe("usage dashboard", () => {
  it("filters 7/30/90 day windows without moving unknown dates into today or counting cache twice", () => {
    const short = usagePeriod(data.analytics!, 7);
    expect(short.days).toHaveLength(7);
    expect(short.days[0]?.day).toBe("2026-10-18");
    expect(short.days[6]?.day).toBe("2026-10-24");
    expect(short.totals).toMatchObject({ inputTokens: 40, outputTokens: 8, cacheReadTokens: 10, usageCount: 1, workerUsageCount: 1 });
    expect(short.models.map((m) => m.model)).toEqual(["new-model"]);
    expect(usagePeriod(data.analytics!, 30).totals).toMatchObject({ inputTokens: 140, outputTokens: 28 });
    expect(usagePeriod(data.analytics!, 90).days).toHaveLength(90);
  });

  it("shows absent measurements as unknown while preserving measured zero", () => {
    expect(usageTokenLabel(0, 0)).toBe("—");
    expect(usageTokenLabel(0, 1)).toBe("0");
    expect(usageTokenLabel(150, 1)).toBe("150");
    // 第 936 页：与用量环同一把尺（k/m），不再是中文紧凑写法「1.4万」
    expect(usageTokenLabel(14_000, 1)).toBe("14.0k");
    expect(usageTokenLabel(1_250_000, 1)).toBe("1.3m");
    const src = readFileSync(fileURLToPath(new URL("../src/renderer/components/settings/usage-dashboard-data.ts", import.meta.url)), "utf8");
    expect(src).not.toContain('notation: "compact"');
  });

  it("uses the scanner timezone for the calendar boundary, even if the renderer timezone differs", () => {
    const base = { ...data.analytics!, generatedAt: Date.UTC(2026, 9, 24, 23, 30) };
    const utc = usagePeriod({ ...base, timeZone: "UTC" }, 7);
    const shanghai = usagePeriod({ ...base, timeZone: "Asia/Shanghai" }, 7);
    expect(utc.days[6]?.day).toBe("2026-10-24");
    expect(shanghai.days[6]?.day).toBe("2026-10-25");
  });

  it("renders the actual figures, recovery and coverage disclosures with accessible controls", () => {
    const html = renderToStaticMarkup(<UsageDashboard data={data} refreshing={false} error={null} onRefresh={() => undefined} />);
    expect(html).toContain("180");
    expect(html).toContain("new-model");
    expect(html).toContain("未记录日期");
    expect(html).toContain("未记录模型");
    expect(html).toContain("1 个会话无法读取");
    expect(html).toContain("2 行损坏记录");
    expect(html).toContain('aria-label="统计时间范围"');
    expect(html).toContain('aria-label="最近 30 天的每日用量"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("缓存读取单独展示");
    expect(html).not.toContain("$0");
    const failed = renderToStaticMarkup(<UsageDashboard data={data} refreshing={false} error="无法读取" onRefresh={() => undefined} />);
    expect(failed).toContain('role="alert"');
    expect(failed).toContain("重试");
  });

  it("does not turn sessions without usage or an older payload into measured zero", () => {
    const html = renderToStaticMarkup(<UsageDashboard data={{ ...data, totals: { ...data.totals, usageCount: 0 }, analytics: { ...data.analytics!, buckets: [], activity: [], sessionsWithUsage: 0, sessionsWithoutUsage: 2 } }} refreshing={false} error={null} onRefresh={() => undefined} />);
    expect(html).toContain("尚无用量记录");
    expect(html).toContain("2 个会话没有上报用量");
    const older = renderToStaticMarkup(<UsageDashboard data={{ ...data, analytics: undefined }} refreshing={false} error={null} onRefresh={() => undefined} />);
    expect(older).toContain("详细统计暂不可用");
  });
});
