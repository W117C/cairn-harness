// 取第 n 页。约定：每页含 size 条（闭区间）。
export function page(items, n, size) {
  const start = n * size;
  return items.slice(start, start + size - 1)
}
