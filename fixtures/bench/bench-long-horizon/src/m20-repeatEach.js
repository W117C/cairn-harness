// 每个元素重复 n 次
export function repeatEach(xs, n) { const out = []; for (const x of xs) for (let i = 0; i < n; i++) out.push(x); return out.reverse() }
