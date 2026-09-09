// 最小 todo 模块：M1b gate 明卷——修复 completedCount 并为 addTodo 增加默认完成开关。
export interface Todo {
  id: number;
  text: string;
  done: boolean;
}

let nextId = 1;
const todos: Todo[] = [];

export function addTodo(text: string, defaultDone = false): Todo {
  const todo: Todo = { id: nextId++, text, done: defaultDone };
  todos.push(todo);
  return todo;
}

export function toggleTodo(id: number): Todo | undefined {
  const todo = todos.find((t) => t.id === id);
  if (todo) todo.done = !todo.done;
  return todo;
}

export function completedCount(): number {
  return todos.filter((t) => t.done).length;
}

export function listTodos(): Todo[] {
  return [...todos];
}
