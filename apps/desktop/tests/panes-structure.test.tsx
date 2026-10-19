// 窗格结构判卷（SSR 真 HTML，与 render-structure 同法）：标签行 / 关闭语义 / 三窗格内容 /
// 空态诚实文案。快照口径：无数据即说明（不摆空壳）；花费缺席显式写"价格不可知"（不当 0）。
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AgentEvent } from "../../../src/events";
import type { DiffHunkView } from "../../../src/main/change-diff";
import { PaneDock } from "../src/renderer/components/PaneDock";
import { DiffView } from "../src/renderer/components/DiffView";

const ev = (e: unknown) => e as AgentEvent;
const noop = () => undefined;

const changesEvents: AgentEvent[] = [
  ev({ type: "user_message", seq: 1, ts: 1, content: "修一下" }),
  ev({ type: "tool_call", id: "c1", seq: 2, ts: 2, name: "edit_file", args: { path: "src/duration.ts" } }),
  ev({ type: "tool_result", callId: "c1", ok: true, output: "", change: "modified", snapshotId: "snap-1" }),
];

const workerEvents: AgentEvent[] = [
  ev({ type: "agent_spawned", agent_id: "w1", parent_event_id: 1, mode: "write", task: "修 parseDuration", role: "修复工", ts: 1000 }),
  ev({ type: "agent_status", agent_id: "w1", status: "done", ts: 61000 }),
  ev({ type: "agent_result", agent_id: "w1", status: "done", summary: "4/4 绿", artifacts: { verified: "verified" }, usage: { inputTokens: 1, outputTokens: 1 } }),
];

describe("PaneDock 容器（真 HTML，网格化）", () => {
  it("每个窗格各占一格、标题与关闭钮在场", () => {
    const html = renderToStaticMarkup(
      <PaneDock tabs={["changes", "tasks"]} events={[]} onClose={noop} />,
    );
    expect(html).toContain(">变更<");
    expect(html).toContain(">任务<");
    expect(html).toContain('aria-label="关闭变更窗格"');
    expect(html).toContain('aria-label="关闭任务窗格"');
  });

  it("tabs 为空 ⇒ 空态说明（不静默、不摆假内容）", () => {
    const html = renderToStaticMarkup(
      <PaneDock tabs={[]} events={[]} onClose={noop} />,
    );
    expect(html).toContain("没有打开的窗格");
  });
});

describe("变更窗格", () => {
  it("按轮列改动：动作词 + 路径 + 快照脚注；验证词走五态词表；空则诚实说明", () => {
    const html = renderToStaticMarkup(
      <PaneDock tabs={["changes"]} events={changesEvents} onClose={noop} />,
    );
    expect(html).toContain("第 1 轮");
    expect(html).toContain("修改");
    expect(html).toContain("src/duration.ts");
    expect(html).toContain("快照");
    // 无验证事件 ⇒ 「未验证」词（不是绿）
    expect(html).toContain("未验证");
    const empty = renderToStaticMarkup(
      <PaneDock tabs={["changes"]} events={[]} onClose={noop} />,
    );
    expect(empty).toContain("本会话还没有文件改动");
  });
});

describe("方案窗格", () => {
  it("状态词三态就位（待决/已批准/已拒绝）", () => {
    const events = [
      ev({ type: "plan_proposed", callId: "c1", plan: { goal: "目标一", files: [] } }),
      ev({ type: "plan_proposed", callId: "c2", plan: { goal: "目标二", files: [] } }),
      ev({ type: "plan_approved", callId: "c2", approved: false }),
    ];
    const html = renderToStaticMarkup(
      <PaneDock tabs={["plan"]} events={events} onClose={noop} />,
    );
    expect(html).toContain("待决");
    expect(html).toContain("已拒绝");
    expect(html).not.toContain("已批准");
  });
});

describe("任务窗格", () => {
  it("worker 行：任务/角色/状态/证据词；花费缺席 ⇒「价格不可知」（不当 0）", () => {
    const html = renderToStaticMarkup(
      <PaneDock tabs={["tasks"]} events={workerEvents} onClose={noop} />,
    );
    expect(html).toContain("修 parseDuration");
    expect(html).toContain("修复工");
    expect(html).toContain("完成");
    expect(html).toContain("证据：验证通过");
    expect(html).toContain("价格不可知");
    expect(html).not.toContain("$0.0000");
    const empty = renderToStaticMarkup(
      <PaneDock tabs={["tasks"]} events={[]} onClose={noop} />,
    );
    expect(empty).toContain("本会话还没有派过子任务");
  });
});

describe("DiffView（真 HTML）", () => {
  const hunks: DiffHunkView[] = [{
    header: "@@ -1,3 +1,4 @@",
    lines: [
      { kind: "ctx", text: "const a = 1;", oldNo: 1, newNo: 1 },
      { kind: "del", text: "let b = 2;", oldNo: 2, newNo: null },
      { kind: "add", text: "let b = 3;", oldNo: null, newNo: 2 },
      { kind: "add", text: "let c = 4;", oldNo: null, newNo: 3 },
    ],
  }];

  it("hunk 头 / 行号 / 符号 / 文本都在；增删靠符号冗余（不只着色）", () => {
    const html = renderToStaticMarkup(<DiffView hunks={hunks} />);
    expect(html).toContain("@@ -1,3 +1,4 @@");
    expect(html).toContain("diff-line del");
    expect(html).toContain("diff-line add");
    expect(html).toContain(">−<");
    expect(html).toContain(">+<");
    expect(html).toContain("const a = 1;");
  });

  it("空 hunks 与截断各自如实说明（不假装完整）", () => {
    expect(renderToStaticMarkup(<DiffView hunks={[]} />)).toContain("没有差异");
    expect(renderToStaticMarkup(<DiffView hunks={hunks} truncated />)).toContain("已截断");
    // 截断且无可显示 hunk：不能说「没有差异」（那会把「没比完」说成「比完了且一样」）。
    const cut = renderToStaticMarkup(<DiffView hunks={[]} truncated />);
    expect(cut).toContain("已截断比对");
    expect(cut).not.toContain("没有差异");
  });
});

describe("DiffView 行级评注（真 HTML）", () => {
  const hunks = [{
    header: "@@ -1,2 +1,2 @@",
    lines: [
      { kind: "ctx" as const, text: "a", oldNo: 1, newNo: 1 },
      { kind: "del" as const, text: "old", oldNo: 2, newNo: null },
    ],
  }];

  it("无 comment api ⇒ 不出现评注按钮（纯展示场景不受影响）", () => {
    const html = renderToStaticMarkup(<DiffView hunks={hunks} />);
    expect(html).not.toContain("dl-comment");
  });

  it("有 comment api ⇒ 行评注按钮在场；已评注的行常显标记（title 带原文）", () => {
    const html = renderToStaticMarkup(
      <DiffView
        hunks={hunks}
        comment={{
          comments: new Map([["src/a.ts|2", "这行保留"]]),
          keyPrefix: "src/a.ts|",
          onComment: () => undefined,
        }}
      />,
    );
    expect(html).toContain('aria-label="评论第 1 行"');
    expect(html).toContain('aria-label="评论第 2 行"');
    expect(html).toContain("dl-has-comment");
    expect(html).toContain("这行保留");
  });
});

describe("窗格弹出与路由", () => {
  it("onPopout 在场 ⇒ 每格有弹出钮（aria 可辨）；缺省不出现", () => {
    const withPop = renderToStaticMarkup(
      <PaneDock tabs={["changes"]} events={[]} onClose={noop} onPopout={noop} />,
    );
    expect(withPop).toContain('aria-label="弹出变更窗格"');
    const without = renderToStaticMarkup(
      <PaneDock tabs={["changes"]} events={[]} onClose={noop} />,
    );
    expect(without).not.toContain("弹出变更窗格");
  });

  it("parsePaneHash：合法形状解析；非该形状/未知 kind 返回 null（不猜）", async () => {
    const { parsePaneHash } = await import("../src/renderer/components/panes");
    expect(parsePaneHash("#pane=tasks")).toEqual({ kind: "tasks", sessionId: null });
    expect(parsePaneHash("#pane=changes&session=s1")).toEqual({ kind: "changes", sessionId: "s1" });
    expect(parsePaneHash("")).toBeNull();
    expect(parsePaneHash("#other=1")).toBeNull();
    expect(parsePaneHash("#pane=ghost")).toBeNull();
  });
});
