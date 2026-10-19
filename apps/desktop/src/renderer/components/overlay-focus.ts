/** Radix 关闭浮层时用零延时任务恢复触发器；后续控件要再等一轮，避免刚聚焦就被抢回。 */
export function scheduleAfterOverlayDismissal(run: () => void): () => void {
  let timer = globalThis.setTimeout(() => {
    timer = globalThis.setTimeout(run, 0);
  }, 0);
  return () => { globalThis.clearTimeout(timer); };
}
