import { addTodo, completedCount, toggleTodo } from "../src/todo.js";

let failures = 0;
const expect = (cond, msg) => {
  if (!cond) {
    failures++;
    console.error("FAIL: " + msg);
  }
};

// 状态无关断言（模块级 todos 会跨用例累积，用例写成与历史无关的形式）
const a = addTodo("任务A");
addTodo("任务B");
toggleTodo(a.id); // 只完成 A

expect(completedCount() === 1, "completedCount 只统计已完成（期望 1，实得 " + completedCount() + "）");

const c = addTodo("任务C"); // 未完成
expect(completedCount() === 1, "新增未完成项后计数仍为 1（实得 " + completedCount() + "）");

toggleTodo(c.id);
expect(completedCount() === 2, "完成 C 后计数为 2（实得 " + completedCount() + "）");

if (failures > 0) {
  console.error(failures + " 项断言失败");
  process.exit(1);
}
console.log("todo-completed-count: all ok");
