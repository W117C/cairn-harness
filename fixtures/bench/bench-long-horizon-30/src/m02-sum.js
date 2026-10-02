// 求和（含第一个元素）
export function sum(xs) { let t = 0; for (const x of xs.slice(1)) t += x; return t }
