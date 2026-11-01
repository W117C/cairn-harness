import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { QueueDock } from "../src/renderer/panes/QueueDock";
import type { SendQueueStrip } from "../src/renderer/components/SendQueueStrip";

function harness() {
  const items = [{ id: 1, text: "first", attachments: [] }, { id: 2, text: "second", attachments: [] }];
  const props = {
    activeId: "s", activeWorkspace: "/a", queue: { current: new Map([['["/a","s"]', items]]) },
    running: false, queueLoading: false, queueSaving: false, queueSaveFailed: false,
    pendingSend: false, pendingClarify: null, pendingPlan: null,
    setQueueFor: vi.fn(), cancelRunHeal: vi.fn(), resumeQueueFor: vi.fn(),
  };
  return { props, items };
}

describe("queue save feedback", () => {
  it("saving uses the save status and disables mutations, including while the last head is reserved", () => {
    const { props } = harness(); props.queueSaving = true; props.queue.current.clear();
    const html = renderToStaticMarkup(<QueueDock {...props} />);
    expect(html).toContain("正在保存队列"); expect(html).not.toContain("会话未读取完成");
    expect(html).not.toContain("继续发送");
  });
  it("retry save targets the latest desired queue without dispatching a task", () => {
    const { props, items } = harness(); props.queueSaveFailed = true;
    const strip = QueueDock(props).props as ComponentProps<typeof SendQueueStrip>;
    strip.onRetrySave?.();
    expect(props.setQueueFor).toHaveBeenCalledWith("s", items, "/a");
    expect(props.resumeQueueFor).not.toHaveBeenCalled();
    expect(renderToStaticMarkup(<QueueDock {...props} />)).toContain("重试保存");
  });
  it("an old remove callback cannot remove a different head after async dequeue", () => {
    const { props, items } = harness();
    const oldStrip = QueueDock(props).props as ComponentProps<typeof SendQueueStrip>;
    props.queue.current.set('["/a","s"]', [items[1]!]);
    oldStrip.onRemove(0);
    expect(props.setQueueFor).not.toHaveBeenCalled();
    oldStrip.onEdit?.(1, "edit the same item");
    expect(props.setQueueFor).toHaveBeenCalledWith("s", [{ ...items[1], text: "edit the same item" }], "/a");
  });
});
