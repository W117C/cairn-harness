// 窗格投影判卷（蓝本 §3.4 先行片）：方案窗格 / 任务窗格 / 变更计数的纯函数面。
// 口径在快照里钉住：提交序与决议配对、worker 四事件归组与"缺席不编"（时长/花费/验证券）、
// 改动文件去重计数。
import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../../../src/events";
import { changedFileCount, projectPlans, projectWorkers } from "../src/renderer/components/panes";

const ev = (e: unknown) => e as AgentEvent;

// ── 方案窗格 ──────────────────────────────────────────────────────

describe("projectPlans：提交序 + 决议配对", () => {
  const plan = (callId: string, goal: string) =>
    ev({ type: "plan_proposed", callId, plan: { goal, files: [{ action: "edit", path: "src/a.ts", summary: "改一行" }], approach: "最小改动", verify: { test: "pnpm test" } } });

  it("两条提案保持提交序；plan_approved 按 callId 配对成 approved/rejected", () => {
    const out = projectPlans([
      plan("c1", "目标一"),
      plan("c2", "目标二"),
      ev({ type: "plan_approved", callId: "c1", approved: true }),
      ev({ type: "plan_approved", callId: "c2", approved: false }),
    ]);
    expect(out.map((p) => p.goal)).toEqual(["目标一", "目标二"]);
    expect(out.map((p) => p.state)).toEqual(["approved", "rejected"]);
  });

  it("未决议保持 pending；孤儿决议（无对应提案）被忽略——不编条目", () => {
    const out = projectPlans([
      plan("c1", "目标一"),
      ev({ type: "plan_approved", callId: "ghost", approved: true }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.state).toBe("pending");
  });

  it("approach/verify 逐字段传递（缺席不留假键）", () => {
    const bare = ev({ type: "plan_proposed", callId: "c9", plan: { goal: "g", files: [] } });
    const out = projectPlans([bare]);
    expect(out[0]?.approach).toBeUndefined();
    expect(out[0]?.verify).toBeUndefined();
  });
});

// ── 任务窗格 ──────────────────────────────────────────────────────

describe("projectWorkers：worker 四事件归组", () => {
  it("完整生命周期：状态/进度/摘要/时长/验证券/花费全就位", () => {
    const out = projectWorkers([
      ev({ type: "agent_spawned", agent_id: "w1", parent_event_id: 1, mode: "write", task: "修 parseDuration", role: "修复工", ts: 1000 }),
      ev({ type: "agent_status", agent_id: "w1", status: "running" }),
      ev({ type: "agent_message", agent_id: "w1", kind: "progress", text: "读 duration.ts" }),
      ev({ type: "agent_message", agent_id: "w1", kind: "progress", text: "跑测试" }),
      ev({ type: "agent_message", agent_id: "w1", kind: "report", text: "改好了" }),
      ev({ type: "agent_status", agent_id: "w1", status: "done", ts: 61000 }),
      ev({ type: "agent_result", agent_id: "w1", status: "done", summary: "4/4 绿", artifacts: { files_changed: ["src/duration.ts"], verified: "verified", spent_usd: 0.12 }, usage: { inputTokens: 1200, outputTokens: 80 } }),
    ]);
    expect(out).toHaveLength(1);
    const w = out[0];
    expect(w?.agentId).toBe("w1");
    expect(w?.role).toBe("修复工");
    expect(w?.status).toBe("done");
    expect(w?.progress).toEqual(["读 duration.ts", "跑测试"]);
    expect(w?.summary).toBe("4/4 绿");
    expect(w?.durationSec).toBe(60);
    expect(w?.verified).toBe("verified");
    expect(w?.spentUsd).toBe(0.12);
    expect(w?.filesChanged).toEqual(["src/duration.ts"]);
  });

  it("缺席不编：无 started 或 ended ⇒ 无时长；无 spent_usd ⇒ undefined（不是 0）", () => {
    const out = projectWorkers([
      ev({ type: "agent_spawned", agent_id: "w2", parent_event_id: 1, mode: "read", task: "调研" }),
      ev({ type: "agent_status", agent_id: "w2", status: "failed", reason: "max_turns" }),
    ]);
    expect(out[0]?.durationSec).toBeUndefined();
    expect(out[0]?.spentUsd).toBeUndefined();
    expect(out[0]?.reason).toBe("max_turns");
  });

  it("孤儿事件（无 spawned 的 status/message/result）被忽略——没有派活记录就没有任务面", () => {
    const out = projectWorkers([
      ev({ type: "agent_status", agent_id: "ghost", status: "done" }),
      ev({ type: "agent_result", agent_id: "ghost", status: "done", summary: "s", artifacts: {} }),
    ]);
    expect(out).toHaveLength(0);
  });

  it("多 worker 各自成项、互不串（按 agent_id 归组）", () => {
    const out = projectWorkers([
      ev({ type: "agent_spawned", agent_id: "a", parent_event_id: 1, mode: "read", task: "甲" }),
      ev({ type: "agent_spawned", agent_id: "b", parent_event_id: 2, mode: "write", task: "乙" }),
      ev({ type: "agent_message", agent_id: "b", kind: "progress", text: "乙的进度" }),
    ]);
    expect(out.map((w) => w.task)).toEqual(["甲", "乙"]);
    expect(out[0]?.progress).toEqual([]);
    expect(out[1]?.progress).toEqual(["乙的进度"]);
  });
});

// ── 变更计数（顶栏徽标）─────────────────────────────────────────────

describe("changedFileCount：去重文件数", () => {
  const write = (callId: string, path: string) =>
    ev({ type: "tool_call", id: callId, seq: 1, ts: 1, name: "edit_file", args: { path } });

  it("同一文件改两次算一个；不同文件累加", () => {
    const n = changedFileCount([
      ev({ type: "user_message", seq: 1, ts: 1, content: "干活" }),
      write("c1", "src/a.ts"),
      ev({ type: "tool_result", callId: "c1", ok: true, output: "", change: "modified" }),
      write("c2", "src/a.ts"),
      ev({ type: "tool_result", callId: "c2", ok: true, output: "", change: "modified" }),
      write("c3", "src/b.ts"),
      ev({ type: "tool_result", callId: "c3", ok: true, output: "", change: "created" }),
    ]);
    expect(n).toBe(2);
  });

  it("无改动 ⇒ 0；只有读工具不计数", () => {
    expect(changedFileCount([])).toBe(0);
    expect(changedFileCount([
      write("c1", "src/a.ts"),
      ev({ type: "tool_result", callId: "c1", ok: true, output: "" }), // 无 change 字段：不是写盘回执
    ])).toBe(0);
  });
});

// ── 行级评注组装（蓝本 §3.6：多处评论一次性提交）─────────────────

describe("composeReviewMessage", () => {
  it("按文件分组、行号升序；组内每条一格（格式稳定）", async () => {
    const { composeReviewMessage } = await import("../src/renderer/components/panes");
    const msg = composeReviewMessage(new Map([
      ["src/a.ts|15", "常量名改大写"],
      ["src/a.ts|3", "这里加注释"],
      ["src/b.ts|8", "删掉这行"],
    ]));
    expect(msg).toContain("行级评论");
    const aAt = msg.indexOf("**src/a.ts**");
    const bAt = msg.indexOf("**src/b.ts**");
    expect(aAt).toBeGreaterThan(-1);
    expect(bAt).toBeGreaterThan(aAt);
    expect(msg.indexOf("- 第 3 行：这里加注释")).toBeLessThan(msg.indexOf("- 第 15 行：常量名改大写"));
    expect(msg).toContain("**src/b.ts**");
    expect(msg).toContain("- 第 8 行：删掉这行");
  });

  it("形状不合解析的键原样保留为兜底条目（不吞任何评论）", async () => {
    const { composeReviewMessage } = await import("../src/renderer/components/panes");
    const msg = composeReviewMessage(new Map([["weird-key", "自由评论"]]));
    expect(msg).toContain("自由评论");
    expect(msg).toContain("weird-key");
  });
});

// ── 拖拽换位（movePane）──────────────────────────────────────────

describe("movePane（拖标题栏换位）", () => {
  it("前移/后移：移动元素落位，其余相对次序不变", async () => {
    const { movePane } = await import("../src/renderer/components/panes");
    expect(movePane(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(movePane(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(movePane(["a", "b", "c"], 1, 2)).toEqual(["a", "c", "b"]);
  });

  it("越界/同位原样（不抛、不吞——同 send-queue 口径）", async () => {
    const { movePane } = await import("../src/renderer/components/panes");
    expect(movePane(["a", "b"], 1, 1)).toEqual(["a", "b"]);
    expect(movePane(["a", "b"], 5, 0)).toEqual(["a", "b"]);
    expect(movePane(["a", "b"], -1, 1)).toEqual(["a", "b"]);
    expect(movePane(["a", "b"], 0, 9)).toEqual(["a", "b"]);
  });
});

// ── 窗格登记表（v7 全量补全批）────────────────────────────────────

describe("PANE_META / PANE_OPENABLE（含 v7 sidechat）", () => {
  it("sidechat 有标签且在开放清单里（⌘; 与 ⋮ 菜单同源消费本表）", async () => {
    const { PANE_META, PANE_OPENABLE } = await import("../src/renderer/components/panes");
    expect(PANE_META.sidechat.label).toBe("旁路");
    expect(PANE_OPENABLE).toContain("sidechat");
  });

  it("开放清单每项都有 meta（不漏配）；无重复", async () => {
    const { PANE_META, PANE_OPENABLE } = await import("../src/renderer/components/panes");
    for (const k of PANE_OPENABLE) expect(PANE_META[k]?.label).toBeTruthy();
    expect(new Set(PANE_OPENABLE).size).toBe(PANE_OPENABLE.length);
  });
});

// ── 站点授权判定（浏览器窗格）────────────────────────────────────

describe("sitePermissionFor", () => {
  it("本地（localhost/回环/*.local）免问；已记住的域放行；其余要问", async () => {
    const { sitePermissionFor } = await import("../src/renderer/components/panes");
    expect(sitePermissionFor("http://localhost:5173/", new Set())).toBe("local");
    expect(sitePermissionFor("http://127.0.0.1:8080/x", new Set())).toBe("local");
    expect(sitePermissionFor("https://box.local/v1", new Set())).toBe("local");
    expect(sitePermissionFor("https://example.com/a", new Set(["example.com"]))).toBe("granted");
    expect(sitePermissionFor("https://example.com/a", new Set())).toBe("ask");
    expect(sitePermissionFor("https://other.com", new Set(["example.com"]))).toBe("ask");
  });

  it("解析失败按「要问」（宁可多问，不静默放行）", async () => {
    const { sitePermissionFor } = await import("../src/renderer/components/panes");
    expect(sitePermissionFor("不是地址", new Set())).toBe("ask");
  });
});
