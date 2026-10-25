// 用量面板判卷（2026-10-21 批 131）：
// 双口径切换、三态（加载/失败/空）、边界如实标注（读不了/坏行）——全部走静态渲染，不靠真机才能看见。
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UsagePanel, type UsageAllState } from "../src/renderer/components/UsagePanel";

const usage = { inputTokens: 1234, outputTokens: 56, cacheReadTokens: 700, usageCount: 2, toolSteps: 3, rounds: 4 };
const ready = (over: Partial<Extract<UsageAllState, { status: "ready" }>["data"]> = {}): UsageAllState => ({
  status: "ready",
  data: { ok: true, totals: usage, sessions: 5, workspaces: 2, skipped: 0, badLines: 0, ...over },
});

function html(scope: "session" | "all", all: UsageAllState = { status: "idle" }, current: typeof usage | null = usage): string {
  return renderToStaticMarkup(
    <UsagePanel scope={scope} onScopeChange={() => undefined} usage={current} all={all} onRetry={() => undefined} />,
  );
}

describe("UsagePanel", () => {
  it("两个口径都在，且 aria-pressed 指向当前口径", () => {
    const h = html("session");
    expect(h).toContain('aria-pressed="true"');
    expect(h).toContain("当前会话");
    expect(h).toContain("全部会话");
    expect(h).toContain("1.2k");
    expect(h).not.toContain("按各项目的会话日志统计");
  });

  it("全部会话：六维 + 会话/工作区；有读不了/坏行才显示这两行", () => {
    const h = html("all", ready({ skipped: 1, badLines: 2 }));
    expect(h).toContain("1.2k");
    expect(h).toContain("会话");
    expect(h).toContain("工作区");
    expect(h).toContain("无法读取");
    expect(h).toContain("损坏行");
    expect(h).toContain("按各项目的会话日志统计");
  });

  it("全部会话空/加载/失败三态各自说清（失败带重试，不假装 0）", () => {
    const empty = html("all", ready({ sessions: 0, workspaces: 0 }));
    expect(empty).toContain("还没有可统计的会话");
    const loading = html("all", { status: "loading" });
    expect(loading).toContain("正在统计全部会话");
    const failed = html("all", { status: "error", error: "无法读取会话目录" });
    expect(failed).toContain("统计失败");
    expect(failed).toContain("重试");
    expect(failed).toContain('role="alert"');
    // 错误串为空时不能只剩「统计失败：」——如实补「未知原因」。
    const blank = html("all", { status: "error", error: "  " });
    expect(blank).toContain("统计失败：未知原因");
    expect(blank).not.toContain("统计失败：</p>");
  });

  it("当前会话无活动会话时说没有会话，不拿全 0 冒充", () => {
    const h = html("session", { status: "idle" }, null);
    expect(h).toContain("还没有会话");
  });
});
