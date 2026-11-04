// 任务清单投影（2026-11-04 工作状态面板「进程」）：读**主会话最后一条** todo_updated = 当前清单。
// 全量替换语义 ⇒ 不需要折叠合并，取末条即可；没有清单（没跑过/模型没用 todo_write）⇒ null。
// 子流隔离：worker 子流（非空 agent_id）的 todo_updated 不进主会话工作状态面板。
import type { AgentEvent, TodoItem } from "../../../../../src/events";
import { isWorkerSubflowEvent } from "./session";


export interface TodoProjection {
  items: readonly TodoItem[];
  /** 完成数（state=done）。 */
  done: number;
  total: number;
}

export function todoProjection(events: readonly AgentEvent[]): TodoProjection | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (isWorkerSubflowEvent(e)) continue;
    if (e.type === "todo_updated") {
      const items = e.items ?? [];
      return { items, done: items.filter((x) => x.state === "done").length, total: items.length };
    }
  }
  return null;
}

/** 面板/胶囊的当前任务行：第一个未完成项；全完成 ⇒ 最后一项；没有清单 ⇒ null。 */
export function currentTodoText(t: TodoProjection | null): string | null {
  if (t === null || t.items.length === 0) return null;
  return t.items.find((i) => i.state === "pending")?.text ?? t.items[t.items.length - 1]!.text;
}
