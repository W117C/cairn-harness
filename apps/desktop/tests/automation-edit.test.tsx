// 定时任务编辑（2026-10-18）：抽屉里加「编辑任务」，表单复用创建态并带出整条任务。
// 关键口径：保存走 {...editing, name, prompt, schedule, tier}——未展示字段（enabled/timeZone/
// catchUp/model）原样带回，否则局部 upsert 会把它们重置成默认值。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { scheduleToForm } from "../src/renderer/components/AppPage";
import type { AutomationSchedule } from "../../../src/main/automations";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("scheduleToForm（反向映射）", () => {
  it("四种面板排程往返不丢字段", () => {
    expect(scheduleToForm({ kind: "daily", time: "09:30" } satisfies AutomationSchedule)).toEqual({ kind: "daily", time: "09:30", every: "60", at: "", weekdays: [1] });
    expect(scheduleToForm({ kind: "weekly", weekdays: [1, 3], time: "18:00" } satisfies AutomationSchedule)).toEqual({ kind: "weekly", time: "18:00", every: "60", at: "", weekdays: [1, 3] });
    expect(scheduleToForm({ kind: "interval", everyMinutes: 15 } satisfies AutomationSchedule)).toEqual({ kind: "interval", time: "09:00", every: "15", at: "", weekdays: [1] });
    expect(scheduleToForm({ kind: "once", at: "2026-11-01T09:00:00" } satisfies AutomationSchedule)).toEqual({ kind: "once", time: "09:00", every: "60", at: "2026-11-01T09:00:00", weekdays: [1] });
  });

  it("monthly/custom 不猜，返回 null（面板不把它们降级成近似排程）", () => {
    expect(scheduleToForm({ kind: "monthly", monthDay: 1, time: "09:00" } as AutomationSchedule)).toBeNull();
    expect(scheduleToForm({ kind: "custom", everyDays: 3, time: "09:00" } as AutomationSchedule)).toBeNull();
  });
});

describe("编辑态接线", () => {
  it("抽屉有编辑入口；保存时带整条任务、只覆盖表单字段", () => {
    const src = read("../src/renderer/components/AppPage.tsx");
    expect(src).toContain(">编辑任务</button>");
    expect(src).toContain("const fields = scheduleToForm(selected.schedule);");
    expect(src).toContain("setEditing(selected);");
    expect(src).toContain("...(editing ?? {}),");
    expect(src).toContain('editing === null ? "创建" : "保存"');
    expect(src).toContain("任务已更新（按新排程重算下次触发）");
  });
});
