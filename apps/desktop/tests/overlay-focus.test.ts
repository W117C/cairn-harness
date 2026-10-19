import { afterEach, describe, expect, it, vi } from "vitest";
import { scheduleAfterOverlayDismissal } from "../src/renderer/components/overlay-focus";

describe("scheduleAfterOverlayDismissal", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("先让已排队的 Radix 关闭任务恢复触发器，再执行后续表单聚焦", () => {
    vi.useFakeTimers();
    const order: string[] = [];
    const cancel = scheduleAfterOverlayDismissal(() => { order.push("focus-form"); });
    setTimeout(() => { order.push("radix-restore"); }, 0);

    vi.runAllTimers();

    expect(order).toEqual(["radix-restore", "focus-form"]);
    cancel();
  });
});
