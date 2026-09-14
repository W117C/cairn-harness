// gym case: sum-clamp
// BUG: clampSum 不夹取，sum 超出 [min, max] 时原样返回。
export function clampSum(values, min, max) {
  const sum = values.reduce((s, v) => s + v, 0);
  return sum; // ← BUG：应夹在 [min, max] 区间内
}
