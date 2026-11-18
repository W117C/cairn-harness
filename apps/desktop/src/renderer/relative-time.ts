// 相对时间文案（纯函数，**不**在 derived/ 里）。
//
// 为什么不住派生层：它用 `new Date(tsMs)` 构造本地日期。从**显式时间戳**构造日期并不读当前时钟
// （纯度上没问题），但派生层的 I3 契约是**按 token 静态扫描**的——`new Date` 一律禁。
// 保守读法 ⇒ 它留在渲染层顶层，由 projections.ts 门面转发。判据唯一处：relative-time.ts。
// （另有一个同名函数在 memory-view.ts，参数序不同：那个吃 ISO 串 + now。）
/** 相对时间（语义钉死分界）：<60s "刚刚"；<60m "N 分钟前"；<24h "N 小时前"；<N 天 "N 天前"；
 *  否则本地日期 YYYY-MM-DD。未来时间戳（diff 为负）落入第一档显 "刚刚"，不显负数。
 *
 *  `absoluteAfterDays` 是**唯一**可调的那一格：多早开始改显绝对日期。它必须显式给出而不是各面
 *  自己抄一份分档——2026-11-18 审计实测两份实现已经漂了（会话表 7 天、记忆页 30 天），同一个
 *  「8 天前」在两个页面显示成两种东西。默认 7 天＝会话面口径；记忆页传 30。 */
export function relativeTime(nowMs: number, tsMs: number, absoluteAfterDays = 7): string {
  const diff = nowMs - tsMs;
  if (diff < 60_000) return "刚刚";
  if (diff < 60 * 60_000) return `${String(Math.floor(diff / 60_000))} 分钟前`;
  if (diff < 24 * 60 * 60_000) return `${String(Math.floor(diff / 3_600_000))} 小时前`;
  if (diff < absoluteAfterDays * 24 * 60 * 60_000) return `${String(Math.floor(diff / 86_400_000))} 天前`;
  const d = new Date(tsMs);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${String(d.getFullYear())}-${mm}-${dd}`;
}
