// 字节刻度（第 924 页）：输入框的附件大小（`Composer.formatSize`）与日志窗的大小
// （`SessionLogDialog` 的局部 formatBytes）原本各写一份——同一个 2048 字节，一个写 "2 KB"、
// 另一个写 "2.0 KB"；512 字节在附件行是一个没有单位的裸数 "512"，在日志窗是 "512 B"；
// 两边在 1 MB 门口都会写出四位数（"1024 KB" / "1024.0 KB"）。一份实现放派生层，两个组件都读得到。

/** 字节刻度：B / KB / MB，一位小数；非法与负数返回 null（调用方决定显示什么，不冒充 0）。
 *  `1024.0 KB` 这一档进位到 MB——与 token 那把尺的 `1000.0k` 同一个教训。 */
export function formatBytes(n: number): string | null {
  if (!Number.isFinite(n) || n < 0) return null;
  if (n < 1024) return `${String(Math.round(n))} B`;
  const kb = (n / 1024).toFixed(1);
  if (kb !== "1024.0") return `${kb} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
