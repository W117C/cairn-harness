// 去重且**保持首次出现顺序**
export function unique(xs) { return [...new Set(xs)].sort() }
