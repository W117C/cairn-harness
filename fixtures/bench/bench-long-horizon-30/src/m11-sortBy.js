// 按**数值**升序（不是字符串序）
export function sortBy(xs, f) { return [...xs].sort((a, b) => String(f(a)) < String(f(b)) ? -1 : 1) }
