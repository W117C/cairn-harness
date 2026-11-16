// 排队条判卷（2026-11-04 业主截图形制）：
//   行 = 抓手 | 正文（单行省略）+ 附件文件名行 | [↑ 立即] 胶囊 + 编辑 + 移出（+ 悬停显现的上/下移）；
//   头部只在「异常 / 等待恢复」时在场（正常排队时输入框的排队占位句就是状态说明）；
//   「立即」的可用面由 QueueDock 递入（运行中恒可；不运行 = 继续发送同一套门）。
// SSR 判卷（node 环境，无 DOM）。
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SendQueueStrip } from "../src/renderer/components/SendQueueStrip";
import { STR } from "../src/renderer/strings";
import { readRendererFile } from "./helpers/app-surface";
import type { QueuedSend } from "../src/renderer/send-queue";

const item: QueuedSend = {
  id: 1,
  text: "看这两个文件",
  attachments: [
    { path: "/ws/a.txt", kind: "file", explicit: true },
    { path: "/ws/dir", kind: "directory", explicit: true },
  ],
};
const noop = (): void => undefined;

describe("排队条 · 截图形制", () => {
  it("行内三动作：立即（↑ 胶囊）+ 编辑 + 移出；抓手段在场；正文单行省略", () => {
    const html = renderToStaticMarkup(
      <SendQueueStrip items={[item]} running sendNowEnabled onInterruptSend={noop} onRemove={noop} onEdit={noop} onMove={noop} />,
    );
    expect(html).toContain(`>${STR.composer.queueSendNow}</span>`);
    expect(html).toContain('aria-label="立即发送：看这两个文件"');
    expect(html).toContain('aria-label="编辑排队项：看这两个文件"');
    expect(html).toContain('aria-label="移出队列：看这两个文件"');
    expect(html).toContain("q-grip");
    expect(html).toContain("q-text");
    // 重排不丢：上/下移仍在（悬停显现是 CSS 层的事）
    expect(html).toContain('aria-label="上移排队项：看这两个文件"');
    expect(html).toContain('aria-label="下移排队项：看这两个文件"');
  });

  it("附件行 = 文件名本体（截图同形）：单个给名，多个给「首个 等 N 个文件」，title 列全名", () => {
    const html = renderToStaticMarkup(
      <SendQueueStrip items={[item]} running sendNowEnabled onInterruptSend={noop} onRemove={noop} />,
    );
    expect(html).toContain("a.txt 等 2 个文件");
    expect(html).toContain('title="a.txt\ndir"');
    const one: QueuedSend = { id: 3, text: "看这个", attachments: [{ path: "/ws/b.md", kind: "file", explicit: true }] };
    const single = renderToStaticMarkup(
      <SendQueueStrip items={[one]} running sendNowEnabled onInterruptSend={noop} onRemove={noop} />,
    );
    expect(single).toContain("b.md");
    expect(single).not.toContain("等 1 个文件");
  });

  it("头部只在异常/等待恢复时在场：运行中排队无头部（占位句已说明状态）", () => {
    const running = renderToStaticMarkup(
      <SendQueueStrip items={[item]} running sendNowEnabled onInterruptSend={noop} onRemove={noop} />,
    );
    expect(running).not.toContain("queue-head");
    const idle = renderToStaticMarkup(
      <SendQueueStrip items={[item]} running={false} onInterruptSend={noop} onRemove={noop} onResume={noop} />,
    );
    expect(idle).toContain("queue-head");
    expect(idle).toContain("等待恢复发送");
    expect(idle).toContain("继续发送");
  });

  it("「立即」可用面：sendNowEnabled 缺席 = 禁用（QueueDock 的门面，不假装能点）", () => {
    const off = renderToStaticMarkup(
      <SendQueueStrip items={[item]} running={false} onInterruptSend={noop} onRemove={noop} />,
    );
    expect(off).toMatch(/<button class="q-sendnow" disabled/);
    const on = renderToStaticMarkup(
      <SendQueueStrip items={[item]} running sendNowEnabled onInterruptSend={noop} onRemove={noop} />,
    );
    expect(on).toMatch(/<button class="q-sendnow" aria-label="立即发送：看这两个文件"/);
    expect(on).not.toMatch(/class="q-sendnow" disabled/);
  });
});

// 2026-11-16（第 1310 页）：行内动作会卸载焦点所在的控件（移出 / 立即 / 编辑收尾），
// 此前焦点一律掉回 body——键盘用户下一步得从文档头开始 Tab。下面钉住补位规则。
describe("排队条 · 焦点收尾", () => {
  const strip = readRendererFile("components/SendQueueStrip.tsx");
  const dock = readRendererFile("panes/QueueDock.tsx");
  const view = readRendererFile("panes/WorkbenchView.tsx");

  it("行带 id 与焦点序号，补位只在焦点真丢了（body）时发生", () => {
    const html = renderToStaticMarkup(
      <SendQueueStrip items={[item]} running sendNowEnabled onInterruptSend={noop} onRemove={noop} onEdit={noop} />,
    );
    expect(html).toContain('data-queue-id="1"');
    expect(html).toContain("q-edit-btn");
    expect(strip).toContain("if (active !== null && active !== document.body) return;");
    expect(strip).toContain("activeRowRef.current = index");
    expect(strip).toContain('row?.querySelector<HTMLElement>(".q-actions button:not([disabled])")');
  });

  it("编辑收尾回本行；队列被整条移空则交给输入框", () => {
    expect(strip).toContain("editReturnId.current = id;");
    expect(strip).toContain("if (e.relatedTarget === null) editReturnId.current = editingId;");
    expect(strip).toContain(".q-edit-btn, .q-actions button:not([disabled])");
    expect(strip).toContain("else props.onFocusFallback?.();");
  });

  it("接线：QueueDock 递入落点，WorkbenchView 给的是 focusComposer", () => {
    expect(dock).toContain("onFocusFallback?: () => void;");
    expect(dock).toContain("onFocusFallback={props.onFocusFallback}");
    expect(view).toContain("onFocusFallback={focusComposer}");
  });
});
