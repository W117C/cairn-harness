// 定时任务的时区可辨性：任务按自己的时区算触发，面板按本机时区显示时刻。
// timeZoneOffsetLabel 此前是零消费者的孤儿（它是随 React 表单归档而失去调用方的），
// 于是「每天 07:00」与「下次 06:00」并排出现时，用户只能猜是不是算错了。
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { scheduleTimeZoneNotes } from "../src/main/scheduler";

const NOW = new Date("2026-01-15T00:00:00Z");   // 固定时刻：偏移不随 DST 漂，断言才可复现

it("只有时区与本机不同（或声明值非法）才给注记，相同的绝不唠叨", () => {
  const notes = scheduleTimeZoneNotes([
    { id: "same", timeZone: "Asia/Shanghai" },
    { id: "diff", timeZone: "America/New_York" },
    { id: "none" },
    { id: "blank", timeZone: "  " },
    { id: "bogus", timeZone: "Mars/Olympus" },
  ], "Asia/Shanghai", NOW);
  expect(Object.keys(notes).sort()).toEqual(["bogus", "diff"]);
  expect(notes["diff"]).toContain("America/New_York");
  expect(notes["diff"]).toContain("UTC-05:00");   // 一月＝EST；偏移取自唯一的那份 helper
  expect(notes["diff"]).toContain("本机 Asia/Shanghai");
  expect(notes["bogus"]).toContain("本机不认");
});

const source = readFileSync(new URL("../src/renderer/app.js", import.meta.url), "utf8");

function schedRows(scheduleCache: unknown): string {
  const context: any = {
    scheduleCache,
    esc: (s: unknown) => String(s),
    schedKindText: (sc: { kind?: string }) => "每天 07:00",
    schedTime: (v: unknown) => "T(" + String(v) + ")",
    skipReasonLabel: (r: unknown) => String(r),
    schedHistFilter: "all",
    HISTORY_STATES: ["all", "queued", "running", "succeeded", "failed", "skipped", "cancelled"],
    HISTORY_STATE_LABELS: { all: "全部状态", queued: "排队中", running: "运行中", succeeded: "成功", failed: "失败", skipped: "跳过", cancelled: "已取消" },
    __out: "",
  };
  const a = source.indexOf("function scheduleViewHTML() {");
  const b = source.indexOf("/* 记忆面板：", a);
  expect(a).toBeGreaterThanOrEqual(0);
  expect(b).toBeGreaterThan(a);
  runInNewContext(source.slice(a, b) + "\n__out = scheduleViewHTML();", context);
  return context.__out as string;
}

const oneTask = { id: "t1", name: "每晚备份", prompt: "p", enabled: true, schedule: { kind: "daily" }, nextRunAt: "2026-01-15T23:00:00Z" };

it("注记上屏：面板不会算完就丢（main 有字段而渲染层不接，等于没有）", () => {
  const withNote = schedRows({ tasks: [oneTask], history: [], running: 0, queued: 0, cap: 2, startupDone: true, tzNotes: { t1: "规则按 America/New_York（UTC-05:00）计时，本机 Asia/Shanghai" } });
  expect(withNote).toContain("规则按 America/New_York");
  expect(withNote).toContain("下次 T(2026-01-15T23:00:00Z)");
  // 无注记（含 tzNotes 缺失的旧快照）不多打一个「 · 」
  for (const cache of [{ tasks: [oneTask], history: [], running: 0, queued: 0, cap: 2, startupDone: true },
    { tasks: [oneTask], history: [], running: 0, queued: 0, cap: 2, startupDone: true, tzNotes: {} }]) {
    const html = schedRows(cache);
    expect(html).not.toContain("规则按");
    expect(html).toContain("每天 07:00 · 下次 T(2026-01-15T23:00:00Z)</div>");
  }
});
