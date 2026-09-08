import { describe, expect, it } from "vitest";
import { addTodo, completedCount, listTodos, toggleTodo } from "../src/todo";

// 注意：模块级 todos 会跨用例累积，以下用例都写成与历史状态无关的形式。
describe("todo", () => {
  it("addTodo 添加新 todo", () => {
    const before = listTodos().length;
    const t = addTodo("买牛奶");
    expect(t.id).toBeGreaterThan(0);
    expect(t.text).toBe("买牛奶");
    expect(t.done).toBe(false);
    expect(listTodos().length).toBe(before + 1);
  });

  it("toggleTodo 切换完成状态", () => {
    const t = addTodo("写周报");
    expect(toggleTodo(t.id)?.done).toBe(true);
    expect(toggleTodo(t.id)?.done).toBe(false); // 再切回未完成，不污染后续用例
  });

  it("completedCount 只统计已完成的 todo", () => {
    const doneBefore = listTodos().filter((t) => t.done).length;
    const a = addTodo("任务A");
    addTodo("任务B");
    toggleTodo(a.id); // 只完成 A
    // 修复后的实现：doneBefore + 1；带 bug 的实现会把 A、B 都数进去，断言失败
    expect(completedCount()).toBe(doneBefore + 1);
  });
});
