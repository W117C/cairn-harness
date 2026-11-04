// 工作状态面板判卷（2026-11-04 业主截图右上角）：
//   pill = 「→ 当前任务一行」；点开 = 进程 N/M（todo_write 清单 ✓/○）+ 运行读数。
//   在场条件：运行中 或 有清单；两者皆无 ⇒ 不摆（空仪表不是诚实，是噪音）。
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkStatusPill } from "../src/renderer/components/WorkStatusPanel";
import { todoProjection, currentTodoText } from "../src/renderer/derived/todo";
import { STR } from "../src/renderer/strings";
import type { AgentEvent } from "../../../src/events";

const noop = (): void => undefined;
const todoEvents = [
  { type: "user_message", content: "干活" },
  { type: "todo_updated", callId: "t1", items: [{ text: "退出行为修复", state: "done" }, { text: "侧边栏瘦身", state: "pending" }, { text: "方案自治", state: "pending" }] },
  { type: "todo_updated", callId: "t2", items: [{ text: "退出行为修复", state: "done" }, { text: "侧边栏瘦身", state: "done" }, { text: "方案自治", state: "pending" }] },
] as unknown as AgentEvent[];

describe("todoProjection（纯投影）", () => {
  it("读最后一条 = 当前清单；done 计数对", () => {
    const t = todoProjection(todoEvents)!;
    expect(t.total).toBe(3);
    expect(t.done).toBe(2);
    expect(t.items[2]).toEqual({ text: "方案自治", state: "pending" });
  });

  it("没有清单 ⇒ null；currentTodoText = 首个未完成，全完 ⇒ 末项", () => {
    expect(todoProjection([{ type: "user_message", content: "x" }] as unknown as AgentEvent[])).toBeNull();
    expect(currentTodoText(todoProjection(todoEvents))).toBe("方案自治");
    // 单条清单（1/3 完成）：首个未完成 = 「侧边栏瘦身」
    const mid = todoProjection([todoEvents[1]!] as unknown as AgentEvent[])!;
    expect(currentTodoText(mid)).toBe("侧边栏瘦身");
    const full = todoProjection([
      { type: "todo_updated", callId: "t", items: [{ text: "甲", state: "done" }, { text: "乙", state: "done" }] },
    ] as unknown as AgentEvent[])!;
    expect(currentTodoText(full)).toBe("乙");
  });

  it("子流隔离：worker（非空 agent_id）的 todo_updated 不覆盖主会话清单；空串 agent_id 仍归主会话", () => {
    const withWorker = [
      ...todoEvents,
      { type: "todo_updated", callId: "w-t1", agent_id: "worker-1", items: [{ text: "子任务内部步骤", state: "pending" }] },
    ] as unknown as AgentEvent[];
    const projected = todoProjection(withWorker)!;
    expect(projected.total).toBe(3);
    expect(currentTodoText(projected)).toBe("方案自治");

    const workerOnly = [
      { type: "todo_updated", callId: "w-t1", agent_id: "worker-1", items: [{ text: "子任务内部步骤", state: "pending" }] },
    ] as unknown as AgentEvent[];
    expect(todoProjection(workerOnly)).toBeNull();

    const emptyAgentId = [
      { type: "todo_updated", callId: "m-t1", agent_id: "", items: [{ text: "主会话清单", state: "pending" }] },
    ] as unknown as AgentEvent[];
    expect(todoProjection(emptyAgentId)?.items[0]?.text).toBe("主会话清单");
  });
});

describe("WorkStatusPill（截图右上角）", () => {
  const todos = todoProjection(todoEvents);

  it("运行中 + 无清单：pill 给阶段+耗时；面板给诚实空态 + 运行读数", () => {
    const h = renderToStaticMarkup(
      <WorkStatusPill running phaseLabel="执行工具" elapsedSec={12} steps={3} todos={null} />,
    );
    expect(h).toContain("tb-workpill");
    expect(h).toContain("执行工具 · 12s");
    expect(h).toContain(STR.work.process);
    expect(h).toContain("这轮还没有任务清单。");
    expect(h).toContain(`运行 12s · 3 ${STR.work.stepsUnit}`);
  });

  it("有清单：pill 显示首个未完成项；面板 进程 2/3 + ✓/○ 逐项", () => {
    const h = renderToStaticMarkup(
      <WorkStatusPill running={false} phaseLabel="" elapsedSec={0} steps={0} todos={todos} />,
    );
    expect(h).toContain("方案自治");
    expect(h).toContain(STR.work.process);
    expect(h).toContain("2/3");
    expect((h.match(/lucide-circle-check/g) ?? []).length).toBe(2);
    expect((h.match(/lucide-circle"/g) ?? []).length).toBe(1);
  });

  it("不在运行且无清单 ⇒ 整个 pill 不摆", () => {
    const h = renderToStaticMarkup(
      <WorkStatusPill running={false} phaseLabel="" elapsedSec={0} steps={0} todos={null} />,
    );
    expect(h).toBe("");
  });
});
