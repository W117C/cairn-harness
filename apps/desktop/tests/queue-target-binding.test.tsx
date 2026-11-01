import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { QueueDock } from "../src/renderer/panes/QueueDock";
import type { SendQueueStrip } from "../src/renderer/components/SendQueueStrip";

function harness() {
  const a = [{ id: 1, text: "甲一", attachments: [] }, { id: 2, text: "甲二", attachments: [] }];
  const b = [{ id: 3, text: "乙一", attachments: [] }];
  const props = {
    activeId: "same", activeIdRef: { current: "new-active" }, activeWorkspace: "/a",
    queue: { current: new Map([['["/a","same"]', a], ['["/b","same"]', b]]) },
    running: false, queueLoading: false, pendingSend: false, pendingClarify: null, pendingPlan: null,
    setQueueFor: vi.fn(), cancelRunHeal: vi.fn(), resumeQueue: vi.fn(), resumeQueueFor: vi.fn(),
  };
  const strip = () => QueueDock(props).props as ComponentProps<typeof SendQueueStrip>;
  return { props, strip, a, b };
}

describe("队列动作绑定渲染时的会话与工作区", () => {
  it("切换会话后的旧移除回调仍只改原队列，显式携带原工作区", () => {
    const { props, strip, a, b } = harness();
    strip().onRemove(0);
    expect(props.setQueueFor).toHaveBeenCalledWith("same", [a[1]], "/a");
    expect(props.queue.current.get('["/b","same"]')).toEqual(b);
  });
  it("打断并发送把目标工作区同时交给队列写入和取消", () => {
    const { props, strip, a } = harness(); props.running = true;
    strip().onInterruptSend(1);
    expect(props.setQueueFor).toHaveBeenCalledWith("same", [a[1], a[0]], "/a");
    expect(props.cancelRunHeal).toHaveBeenCalledWith("same", "/a");
  });
  it("继续发送显式恢复这条队列，不重新读取全局活动会话", () => {
    const { props, strip } = harness();
    strip().onResume?.();
    expect(props.resumeQueueFor).toHaveBeenCalledWith("same", "/a");
  });
});
