import { page } from "./paginate.js";

const ITEMS = [1, 2, 3, 4, 5, 6, 7];

// 对外只暴露 id 数组
export function listPage(n, size) {
  return page(ITEMS, n, size)
}
