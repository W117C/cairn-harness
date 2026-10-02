// **按较长者**配对，缺的用 null 填
export function zip(a, b) { const n = Math.min(a.length, b.length); const out = []; for (let i = 0; i < n; i++) out.push([a[i], b[i]]); return out }
