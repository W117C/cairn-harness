// 用量 CSV 判卷（2026-10-30 · 第 825 页）：
// 逐日明细 + 合计；原始整数不做「—」美化；缺测列保留已上报值，不把缺测当 0。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { usageCsv } from "../src/renderer/components/settings/usage-dashboard-data";
import { STR } from "../src/renderer/strings";

const period = {
  days: [
    { day: "2026-10-29", inputTokens: 10, outputTokens: 5, cacheReadTokens: 2, usageCount: 3, workerUsageCount: 0, inputMeasured: 2, outputMeasured: 3, cacheReadMeasured: 1, sessions: 1, rounds: 1, toolSteps: 0 },
    { day: "2026-10-30", inputTokens: 20, outputTokens: 7, cacheReadTokens: 0, usageCount: 1, workerUsageCount: 0, inputMeasured: 1, outputMeasured: 1, cacheReadMeasured: 0, sessions: 1, rounds: 1, toolSteps: 0 },
  ],
  totals: { inputTokens: 30, outputTokens: 12, cacheReadTokens: 2, usageCount: 4, workerUsageCount: 0, inputMeasured: 3, outputMeasured: 4, cacheReadMeasured: 1 },
  models: [],
} as unknown as Parameters<typeof usageCsv>[0];

describe("usageCsv", () => {
  it("表头/逐日/合计齐全，整数不做本地化千分位", () => {
    const csv = usageCsv(period);
    const lines = csv.trimEnd().split("\n");
    expect(lines[0]).toBe("日期,输入Token,输出Token,缓存读取Token,用量记录,输入缺测,输出缺测");
    expect(lines[1]).toBe("2026-10-29,10,5,2,3,1,0");
    expect(lines[3]).toBe("合计,30,12,2,4,1,0");
  });

  it("页面有「复制 CSV」动作，调用 usageCsv", () => {
    const src = readFileSync(fileURLToPath(new URL("../src/renderer/components/settings/UsageSection.tsx", import.meta.url)), "utf8");
    expect(src).toContain("navigator.clipboard.writeText(usageCsv(period))");
    // 2026-11-07 strings 整批收编：字面量进 STR.usage.copyCsv（组件源文引 STR；值面钉在这里）。
    expect(src).toContain("STR.usage.copyCsv");
    expect(STR.usage.copyCsv).toBe("复制 CSV");
  });
});
