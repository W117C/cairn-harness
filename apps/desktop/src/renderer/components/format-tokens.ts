// 用量数字格式化的**实现**已搬到 `derived/format-tokens.ts`（第 921 页）：
// 时间线（派生层）与用量环 / 检查器（组件层）必须读同一份，否则同一个 token 数两处两个写法。
// 这里保留同名出口，既有 import（UsageMeter / Inspector / 判卷）不用改路径。
export { formatTokens } from "../derived/format-tokens";
