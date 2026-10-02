// 分组：同键的**累积**成数组（不是覆盖）
export function groupBy(xs, f) { const out = {}; for (const x of xs) out[f(x)] = [x]; return out }
