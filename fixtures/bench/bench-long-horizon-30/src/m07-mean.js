// 平均值（除以个数）
export function mean(xs) { let t = 0; for (const x of xs) t += x; return t / (xs.length - 1) }
