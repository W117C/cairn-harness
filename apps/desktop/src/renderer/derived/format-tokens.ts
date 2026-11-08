// 用量数字格式化（第 921 页从 `components/format-tokens.ts` 搬到派生层）：
// 它有三个消费面——用量环 / 检查器 / 时间线的 usage 步；时间线在派生层，按分层规则够不着组件层，
// 于是它自己抄了一份 `fmtTokens`（还多一档 m）⇒ 同一个 token 数在两个面写法不同
// （1_250_000 在时间线是 `1.3m`、在用量环是 `1250.0k`）。词表只能有一份，落在派生层。

/** 元位数字：过 1000 显 k、过 100 万显 m，都是一位小数；未过 1000 原样。
 *  `999_950…999_999` 这一档按 k 写会得到四位小数 `1000.0k`——那是没过万就撑爆的写法，
 *  一并进位到 m（`1.0m`）。 */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
  if (n >= 1000) {
    const k = (n / 1000).toFixed(1);
    return k === "1000.0" ? `${(n / 1_000_000).toFixed(1)}m` : `${k}k`;
  }
  return String(n);
}
