// v2.17 运行中可沟通：DOM 级判卷（与 render-structure.test.tsx 同法：react-dom/server 出真 HTML）。
// 钉的是用户实际看得见的两件事：
//   ① 运行中 textarea 不再禁用，占位与空闲同款（v7.1 业主裁：不摆「回车排队」常驻提示）；
//   ② 运行中入队按钮**有话说才出现**（空输入只留打断钮，不摆禁用灰钟）；权限档维持
//      「运行中 disabled」；模型选择器 v7.2 业主裁改为**可开**——思考档要能调（模型档位在菜单内锁定）。
// 队列条（SendQueueStrip）的条目形态与队列纯函数另见 send-queue.test.ts。
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Composer } from "../src/renderer/components/Composer";
import { SendQueueStrip } from "../src/renderer/components/SendQueueStrip";
import { STR } from "../src/renderer/strings";

const base = {
  mode: "default" as const,
  activeId: "s1",
  providerInfo: null,
  pickerValue: null,
  usage: { inputTokens: 0, outputTokens: 0, usageCount: 0, cacheReadTokens: 0, lastInputTokens: 0 },
  phaseLabel: "执行工具",
  phase: "tool" as const,
  elapsedSec: 3,
  steps: 2,
  workspaceLabel: null,
  onSend: () => undefined,
  onCancel: () => undefined,
  onModeChange: () => undefined,
  onModelChange: () => undefined,
  onCompact: () => undefined,
};

describe("Composer 运行中可沟通（C-18 / C-22）", () => {
  it("运行中：输入可用，空输入只留打断钮（不摆禁用灰钟），占位不写排队提示", () => {
    const html = renderToStaticMarkup(<Composer {...base} running disabled={false} stopped={false} />);
    const ta = /<textarea[^>]*>/.exec(html)?.[0] ?? "";
    expect(ta).not.toBe("");
    expect(ta).not.toContain("disabled");
    // v7.1：运行中占位与空闲同款（业主裁撤「运行中 · 回车排队…」提示）；P2 重做后文案走 STR。
    expect(ta).toContain(STR.composer.placeholder);
    expect(ta).not.toContain("排队");
    // 空输入：加入队列钮不出现；停止钮在位。
    expect(html).not.toContain(`aria-label="${STR.composer.queueAria}"`);
    expect(html).toContain(`aria-label="${STR.composer.stopAria}"`);
  });

  it("运行中 + 有话说：入队钮出现（判据纯函数钉死；SSR 下草稿恒空、交互态由判据+真机复检兜）", async () => {
    const { showQueueButton } = await import("../src/renderer/components/Composer");
    expect(showQueueButton(true, true)).toBe(true);
    expect(showQueueButton(true, false)).toBe(false);
    expect(showQueueButton(false, true)).toBe(false);
  });

  it("空闲：没有入队按钮，发送按钮在位", () => {
    const html = renderToStaticMarkup(<Composer {...base} running={false} disabled={false} stopped={false} />);
    expect(html).not.toContain('aria-label="加入队列"');
    expect(html).toContain('aria-label="发送"');
  });

  it("运行中：权限档维持禁用；模型选择器可开（v7.2 业主裁——思考档要能调，模型行由菜单内锁定）", () => {
    const html = renderToStaticMarkup(<Composer {...base} running disabled={false} stopped={false} />);
    const modeBtn = /<button[^>]*class="ctl"[^>]*>/.exec(html)?.[0] ?? "";
    const picker = /<button[^>]*aria-label="模型选择"[^>]*>/.exec(html)?.[0] ?? "";
    expect(modeBtn).toContain("disabled");
    expect(picker).not.toContain("disabled");
  });

  it("门槛中（disabled+running=澄清/方案门）：输入禁用，占位「等待你的决定…」，入队钮不在场", () => {
    const html = renderToStaticMarkup(<Composer {...base} running disabled stopped={false} />);
    const ta = /<textarea[^>]*>/.exec(html)?.[0] ?? "";
    expect(ta).toContain("disabled");
    expect(ta).toContain(STR.composer.placeholderGate);
    expect(html).not.toContain(`aria-label="${STR.composer.queueAria}"`);
    expect(html).toContain(`aria-label="${STR.composer.stopAria}"`);
  });
});

describe("SendQueueStrip（队列条）", () => {
  const items = [
    { id: 1, text: "先跑一遍测试", attachments: [] },
    { id: 2, text: "然后把 README 改了", attachments: [{ path: "/tmp/a.md", kind: "file" as const, explicit: true }] },
  ];

  it("空队列不渲染任何东西", () => {
    expect(renderToStaticMarkup(<SendQueueStrip items={[]} running onInterruptSend={() => undefined} onRemove={() => undefined} />)).toBe("");
  });

  it("运行中：每条可移除、可打断并发送；引用数显在场", () => {
    const html = renderToStaticMarkup(
      <SendQueueStrip items={items} running onInterruptSend={() => undefined} onRemove={() => undefined} />,
    );
    expect(html).toContain("先跑一遍测试");
    expect(html).toContain("1 引用");
    expect(html).toContain("本轮结束后自动发送");
    expect(html.match(/打断并发送/g)?.length).toBe(2);
    expect(html).toContain('aria-label="移出队列：先跑一遍测试"');
  });

  it("不在运行中：不渲染「打断并发送」（队列只剩移除操作）", () => {
    const html = renderToStaticMarkup(
      <SendQueueStrip items={items} running={false} onInterruptSend={() => undefined} onRemove={() => undefined} />,
    );
    expect(html).not.toContain("打断并发送");
    expect(html).toContain('aria-label="移出队列：然后把 README 改了"');
  });

  it("恢复态：不运行且有恢复入口时，显示「继续发送」", () => {
    const html = renderToStaticMarkup(
      <SendQueueStrip
        items={items}
        running={false}
        onInterruptSend={() => undefined}
        onRemove={() => undefined}
        onResume={() => undefined}
      />,
    );
    expect(html).toContain('aria-label="继续发送队列"');
    expect(html).toContain("继续发送");
  });
});
