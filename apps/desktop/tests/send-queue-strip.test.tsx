// 队列条的附件只显示「N 引用」时，用户看不到是哪几个文件（2026-10-18）：标题上补文件名，
// 出队前能核对。SSR 判卷（node 环境，无 DOM）。
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SendQueueStrip } from "../src/renderer/components/SendQueueStrip";
import type { QueuedSend } from "../src/renderer/send-queue";

const item: QueuedSend = {
  id: 1,
  text: "看这两个文件",
  attachments: [
    { path: "/ws/a.txt", kind: "file", explicit: true },
    { path: "/ws/dir", kind: "directory", explicit: true },
  ],
};

describe("队列条附件提示", () => {
  it("「N 引用」的 title 列出文件名", () => {
    const html = renderToStaticMarkup(
      <SendQueueStrip items={[item]} running={false} onInterruptSend={() => {}} onRemove={() => {}} />,
    );
    expect(html).toContain("2 引用");
    expect(html).toContain('title="a.txt\ndir"');
  });
});
