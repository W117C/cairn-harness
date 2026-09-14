// gym case: todo-completed-count
// BUG: completedCount 统计了全部 todo，而不是只统计已完成（done）的。
let nextId = 1;
const todos = [];

export function addTodo(text, defaultDone = false) {
  const todo = { id: nextId++, text, done: defaultDone };
  todos.push(todo);
  return todo;
}

export function toggleTodo(id) {
  const todo = todos.find((t) => t.id === id);
  if (todo) todo.done = !todo.done;
  return todo;
}

export function completedCount() {
  return todos.length; // ← BUG：应只统计 done === true 的
}

export function listTodos() {
  return [...todos];
}
