// 会话日志查看器判卷（2026-10-21 批 132）：
// 三态、截断提示、路径与复制入口、错误条按钮的在场条件——SSR 直测，不靠真机才看得见。
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ErrorStrip } from "../src/renderer/components/ErrorStrip";
import { SessionLogBody, type SessionLogState } from "../src/renderer/components/SessionLogDialog";

const ready = (over: Partial<Extract<SessionLogState, { status: "ready" }>["data"]> = {}): SessionLogState => ({
  status: "ready",
  data: {
    ok: true,
    path: "/tmp/ws/.agent/sessions/s1.jsonl",
    text: "{\"type\":\"error\",\"message\":\"boom\"}",
    truncated: false,
    bytes: 2048,
    lines: 1,
    ...over,
  },
});

const html = (state: SessionLogState): string => renderToStaticMarkup(
  <SessionLogBody state={state} onRetry={() => undefined} onCopyPath={() => undefined} />,
);

describe("SessionLogBody", () => {
  it("加载与失败各自说清；失败带重试", () => {
    expect(html({ status: "loading" })).toContain("正在读取日志");
    const failed = html({ status: "error", error: "会话不存在: s1" });
    expect(failed).toContain("日志读取失败");
    expect(failed).toContain("会话不存在");
    expect(failed).toContain("重试");
    expect(failed).toContain('role="alert"');
  });

  it("有内容：路径、正文、复制入口、行数/大小都在", () => {
    const h = html(ready());
    expect(h).toContain("/tmp/ws/.agent/sessions/s1.jsonl");
    expect(h).toContain("boom");
    expect(h).toContain("复制路径");
    expect(h).toContain("1 行");
    expect(h).toContain("2.0 KB");
    expect(h).toContain('aria-label="会话日志内容"');
    expect(h).not.toContain("只显示日志尾部");
  });

  it("截断时如实提示（不把尾部冒充整份）", () => {
    expect(html(ready({ truncated: true, lines: 2 }))).toContain("只显示日志尾部");
  });

  it("单行超窗：说清「只有一行且只显示 256 KiB 片段」，不说成尾部多行", () => {
    const h = html(ready({ truncated: true, lines: 1, text: "x".repeat(120_000), bytes: 400_000 }));
    expect(h).toContain("日志只有一行");
    expect(h).toContain("256 KiB");
    expect(h).not.toContain("更早的内容请复制路径");
  });

  it("空日志不摆空 pre", () => {
    const h = html(ready({ text: "", lines: 0, bytes: 0 }));
    expect(h).toContain("还没有日志内容");
    expect(h).not.toContain("<pre");
  });
});

describe("ErrorStrip · 查看日志入口", () => {
  it("有 onViewLog 才摆按钮；无会话时不摆假入口", () => {
    const withLog = renderToStaticMarkup(<ErrorStrip message="跑挂了" onDismiss={() => undefined} onViewLog={() => undefined} />);
    expect(withLog).toContain("查看日志");
    expect(withLog).toContain("查看这次失败的原始日志");
    const without = renderToStaticMarkup(<ErrorStrip message="跑挂了" onDismiss={() => undefined} />);
    expect(without).not.toContain("查看日志");
  });
});
