// M2f 安全快筛反例：干净代码（零 findings），用于断言静态快筛不误报。
export interface Todo {
  id: number;
  text: string;
  done: boolean;
}

export function add(a: number, b: number): number {
  return a + b;
}

export const LABEL = "todo list";

export function filterDone(items: Todo[]): Todo[] {
  return items.filter((t) => t.done);
}
