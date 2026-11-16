// 派生层·时长格式化（纯函数）：流面工具耗时与思考计时共用同一份口径。
// 从 components/Stream.tsx 搬来（第 918 页先例：词表下沉派生层，组件层保留同名出口），
// ThinkingLive 直接吃派生层（组件层互相 import 会成环：Stream ↔ ThinkingLive）。
/** 工具耗时文本（P3-1 · 折叠行「图标 + 摘要 + 耗时 + 状态符」的耗时位）：
 *  <1s 毫秒 / <10s 一位小数秒 / <60s 整数秒 / 其余「XmYs」（秒为 0 省「s」）。负值/非数按 0。 */
export function formatDuration(ms: number): string {

  const v = Number.isFinite(ms) && ms > 0 ? ms : 0;
  if (v < 1000) return `${String(Math.round(v))}ms`;
  const s = v / 1000;
  if (s < 10) return `${s.toFixed(1)}s`;
  if (s < 60) return `${String(Math.round(s))}s`;
  const m = Math.floor(s / 60);
  const rs = Math.round(s - m * 60);
  return rs === 0 ? `${String(m)}m` : `${String(m)}m${String(rs)}s`;
}

/** 思考计时口径（秒起步的活钟，与 formatDuration 同族但**不显毫秒位**——计时器从 0s 起步，
 *  不摆「0ms」这种假精度；分钟档与 formatDuration 一致）。入参秒，非数/负值按 0。 */
export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0s";
  if (seconds < 60) return `${String(Math.floor(seconds))}s`;
  const m = Math.floor(seconds / 60);
  const rs = Math.round(seconds - m * 60);
  return rs === 0 ? `${String(m)}m` : `${String(m)}m${String(rs)}s`;
}
