// 最小 todo 模块：内含 1 个已知 bug，等 agent 修复。
export interface Todo {
  id: number;
  text: string;
  done: boolean;
}

let nextId = 1;
const todos: Todo[] = [];

export function addTodo(text: string): Todo {
  const todo: Todo = { id: nextId++, text, done: false };
  todos.push(todo);
  return todo;
}

export function toggleTodo(id: number): Todo | undefined {
  const todo = todos.find((t) => t.id === id);
  if (todo) todo.done = !todo.done;
  return todo;
}

// 已知 bug：completedCount 没有过滤 done，把所有 todo 都数进去了。
export function completedCount(): number {
  return todos.length;
}

export function listTodos(): Todo[] {
  return [...todos];
}
