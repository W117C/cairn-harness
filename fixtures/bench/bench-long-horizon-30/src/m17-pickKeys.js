// 挑出**指定**的键（当前挑反了）
export function pickKeys(o, keys) { const out = {}; for (const k of Object.keys(o)) if (!keys.includes(k)) out[k] = o[k]; return out }
