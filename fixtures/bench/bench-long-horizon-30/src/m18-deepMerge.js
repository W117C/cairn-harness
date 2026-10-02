// **深**合并（嵌套对象不整个覆盖）
export function deepMerge(a, b) { return { ...a, ...b } }
