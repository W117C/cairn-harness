// 无人值守任务的「为什么没跑」必须一眼可读：中文标签的唯一实现在渲染层投影，
// 且空态面板形状必须跟着投影走（历史上加一个字段要改两处，漏一处就是面板整块空掉）。
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { EMPTY_PANEL_DATA, projectPanelData, skipReasonLabel } from "../src/renderer/projections";

const source = readFileSync(new URL("../src/renderer/app.js", import.meta.url), "utf8");

function labelOf(e: Record<string, unknown>): string {
  const context: any = { skipReasonLabel, __out: "" };
  const a = source.indexOf("/** 事件类型 → 一行中文标签");
  const b = source.indexOf("/** 通用记录卡", a);
  expect(a).toBeGreaterThanOrEqual(0);
  expect(b).toBeGreaterThan(a);
  runInNewContext(source.slice(a, b) + "\n__out = eventLabel(" + JSON.stringify(e) + ");", context);
  return context.__out as string;
}

it("跳过一行的标题说清是哪条任务、为什么跳过（不是让人展开 JSON 读 overlap）", () => {
  const t = labelOf({ type: "automation_skipped", task_name: "每晚备份", reason: "overlap" });
  expect(t).toContain("每晚备份");
  expect(t).toContain("重叠");
  expect(t).not.toContain("overlap");
  // worker 状态那半边不许被改坏：failed 仍要一眼看到
  expect(labelOf({ type: "agent_status", status: "failed" })).toBe("worker 状态 · failed");
});

it("四个跳过原因 + 重启中断都有中文标签，未知原因原样透出不静默变空", () => {
  expect(skipReasonLabel("too-old")).toContain("过期");
  expect(skipReasonLabel("catch-up-skip")).toContain("休眠");
  expect(skipReasonLabel("overlap")).toContain("重叠");
  expect(skipReasonLabel("concurrency-cap")).toContain("并发满");
  // main 把注记直接写进 journal 的 interrupted 串里：按前缀认，不抄那句字面量（抄来即漂移磁铁）
  expect(skipReasonLabel("interrupted（重启后无终态记录；V1 不自动重试，可 run_now 兜底）")).toContain("中断");
  expect(skipReasonLabel("something-new")).toBe("something-new");
  expect(skipReasonLabel(undefined)).toBe("");
});

it("空态面板形状 = 投影形状（加字段只改一处就会让面板整块空掉）", () => {
  const shape = Object.keys(projectPanelData([], null)).sort().join(",");
  expect(Object.keys(EMPTY_PANEL_DATA).sort().join(",")).toBe(shape);
});
