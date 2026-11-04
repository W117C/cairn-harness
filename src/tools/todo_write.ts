// 任务清单工具（2026-11-04 工作状态面板「进程」的数据源）：模型多步任务时用它维护清单，
// 完成一件更新一件。事件 todo_updated 全量替换（整份清单，不是增量补丁）；
// 清单不进模型上下文投影（落空分支）——模型对清单的感知走 tool_result 回执文本。
// 权限面：无用户数据副作用（只写会话日志），不进 SIDE_EFFECT_TOOLS，各档免批直行。
import type { TodoItem, TodoUpdatedEvent } from "../events";
import { ToolError, type Tool, type ToolResult } from "./base.js";

const MAX_ITEMS = 20;
const MAX_TEXT_CHARS = 200;
const STATES = new Set(["pending", "done"]);

/** 校验并规整清单入参；违规一律 ToolError（fail-loud，不静默丢项）。 */
export function parseTodoItems(args: Record<string, unknown>): TodoItem[] {
  if (!Array.isArray(args.items) || args.items.length === 0) {
    throw new ToolError("todo_write: items 必须是非空数组");
  }
  if (args.items.length > MAX_ITEMS) {
    throw new ToolError(`todo_write: items 最多 ${String(MAX_ITEMS)} 项（清单是给人和面板看的，不是任务分解器）`);
  }
  return args.items.map((raw, i) => {
    if (typeof raw !== "object" || raw === null) {
      throw new ToolError(`todo_write: items[${String(i)}] 必须是对象`);
    }
    const o = raw as Record<string, unknown>;
    if (typeof o.text !== "string" || o.text.trim().length === 0) {
      throw new ToolError(`todo_write: items[${String(i)}].text 必须是非空字符串`);
    }
    const text = o.text.trim();
    if (text.length > MAX_TEXT_CHARS) {
      throw new ToolError(`todo_write: items[${String(i)}].text 最多 ${String(MAX_TEXT_CHARS)} 字`);
    }
    const state = o.state === undefined ? "pending" : o.state;
    if (typeof state !== "string" || !STATES.has(state)) {
      throw new ToolError(`todo_write: items[${String(i)}].state 必须是 pending|done`);
    }
    return { text, state: state as TodoItem["state"] };
  });
}

/** 清单的一行回执（工具结果进模型上下文——模型靠它记着自己写到哪了）。 */
export function todoReceipt(items: readonly TodoItem[]): string {
  const done = items.filter((i) => i.state === "done").length;
  const lines = items.map((i) => (i.state === "done" ? "✓ " : "○ ") + i.text);
  return `任务清单已更新（${String(done)}/${String(items.length)} 完成）：\n${lines.join("\n")}`;
}

export const todo_write: Tool = {
  name: "todo_write",
  async run(args, ctx): Promise<ToolResult> {
    if (!ctx.emit || ctx.callId === undefined) {
      throw new ToolError("todo_write: 无事件通道（fail-closed：需要 emit/callId 接线）");
    }
    const items = parseTodoItems(args);
    const event: TodoUpdatedEvent = { type: "todo_updated", callId: ctx.callId, items };
    await ctx.emit(event);
    return { ok: true, output: todoReceipt(items) };
  },
};
