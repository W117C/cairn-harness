// 完成通知的纯决策/文案（2026-10-25）。CI 侧能钉的是「发不发、正文怎么取、点击目标」；
// 真实 OS 通知的弹出与点击在离屏 Electron 里造不出来——那一条由 notification-open-smoke
// 只验 renderer 接收后的开会话路径，并在报告里明确未验 OS click。
import { describe, expect, it } from "vitest";
import {
  focusedWindowViewing,
  notificationClickWindow,
  notificationPreview,
  runNotificationCopy,
  runNotificationTarget,
  shouldNotifyRunSettled,
  type NotificationWindowCandidate,
  type RunNotificationInput,
} from "../src/main/run-notification";

const base: RunNotificationInput = {
  sessionId: "s1",
  supported: true,
  anyWindowFocused: false,
  enabled: true,
  viewingTarget: false,
  ok: true,
};

it("用户关掉 / 系统不支持 / 会话 id 为空 ⇒ 一律不发", () => {
  expect(shouldNotifyRunSettled(base)).toBe(true);
  expect(shouldNotifyRunSettled({ ...base, enabled: false })).toBe(false);
  expect(shouldNotifyRunSettled({ ...base, supported: false })).toBe(false);
  expect(shouldNotifyRunSettled({ ...base, sessionId: "   " })).toBe(false);
});

it("「不在看那个会话」：失焦一定发；聚焦时看别的会话要发，正看着它才免打扰", () => {
  // 窗口失焦 ⇒ 无论在看谁（连同一个会话都不在屏幕前）都发。
  expect(shouldNotifyRunSettled({ ...base, anyWindowFocused: false, viewingTarget: true })).toBe(true);
  // 聚焦但正看着这个会话 ⇒ 免打扰。
  expect(shouldNotifyRunSettled({ ...base, anyWindowFocused: true, viewingTarget: true })).toBe(false);
  // 聚焦但在看别的会话 ⇒ 发（旧口径在这里漏通知）。
  expect(shouldNotifyRunSettled({ ...base, anyWindowFocused: true, viewingTarget: false })).toBe(true);
});

it("正文取任务首行、折叠空白、最多 80 码点（不切代理对）", () => {
  expect(notificationPreview("  修复登录页\n第二行不要")).toBe("修复登录页");
  expect(notificationPreview("a   b\tc")).toBe("a b c");
  const long = "🐎".repeat(100);
  const clipped = notificationPreview(long);
  expect([...clipped]).toHaveLength(81); // 80 个码点 + 省略号
  expect(clipped.endsWith("…")).toBe(true);
  expect(notificationPreview(undefined)).toBe("");
});

it("成功/失败文案：带任务摘要；缺摘要与缺原因各有明确兜底", () => {
  const ok = runNotificationCopy({ ...base, message: "修复登录页\n细节" });
  expect(ok.title).toBe("Cairn · 会话完成");
  expect(ok.body).toBe("会话「修复登录页」本轮已收束。");
  const fail = runNotificationCopy({ ...base, ok: false, message: "跑测试", error: "  命令超时 " });
  expect(fail.title).toBe("Cairn · 会话未完成");
  expect(fail.body).toBe("会话「跑测试」本轮未完成：命令超时");
  expect(runNotificationCopy(base).body).toBe("本轮已收束。");
  expect(runNotificationCopy({ ...base, ok: false }).body).toBe("本轮未完成：未知原因");
  expect(runNotificationCopy({ ...base, ok: false, error: "   " }).body).toBe("本轮未完成：未知原因");
});

it("点击目标保留会话与工作区；空/空白 workspace 不塞空串", () => {
  expect(runNotificationTarget({ sessionId: "s1", workspace: "/tmp/ws" })).toEqual({ sessionId: "s1", workspace: "/tmp/ws" });
  expect(runNotificationTarget({ sessionId: "s1", workspace: "  /tmp/ws  " })).toEqual({ sessionId: "s1", workspace: "/tmp/ws" });
  expect(runNotificationTarget({ sessionId: "s1" })).toEqual({ sessionId: "s1" });
  expect(runNotificationTarget({ sessionId: "s1", workspace: "   " })).toEqual({ sessionId: "s1" });
});

describe("focusedWindowViewing：按焦点窗口判可见会话", () => {
  const snap = (windowId: number, focused: boolean, sessionId: string | null, workspace: string | null = "/ws"): { windowId: number; focused: boolean; sessionId: string | null; workspace: string | null } => ({ windowId, focused, sessionId, workspace });
  it("焦点窗口在看目标 ⇒ true；后台窗口在看 ⇒ false；看别家 ⇒ false", () => {
    expect(focusedWindowViewing([snap(1, true, "s1")], "s1")).toBe(true);
    expect(focusedWindowViewing([snap(1, false, "s1")], "s1")).toBe(false);
    expect(focusedWindowViewing([snap(1, true, "s2")], "s1")).toBe(false);
  });
  it("同 session 不同 workspace 不误判；workspace 未知的旧上报按 session 兜底", () => {
    expect(focusedWindowViewing([snap(1, true, "s1", "/other")], "s1", "/ws")).toBe(false);
    expect(focusedWindowViewing([snap(1, true, "s1", null)], "s1", "/ws")).toBe(true);
    expect(focusedWindowViewing([snap(1, true, "s1", "/ws")], "s1")).toBe(true);
  });
  it("弹窗和主窗同看一个会话只算一次；空 session 不命中", () => {
    expect(focusedWindowViewing([snap(1, false, "s1"), snap(2, true, "s1")], "s1")).toBe(true);
    expect(focusedWindowViewing([snap(1, true, "")], "")).toBe(false);
  });
});

describe("notificationClickWindow：点击落到已在看目标的窗口", () => {
  const cand = (
    windowId: number,
    o: { focused?: boolean; sessionId?: string | null; workspace?: string | null; alive?: boolean } = {},
  ): NotificationWindowCandidate => ({
    windowId,
    alive: o.alive ?? true,
    focused: o.focused ?? false,
    sessionId: o.sessionId ?? null,
    workspace: o.workspace === undefined ? "/ws" : o.workspace,
  });

  it("弹窗正在看目标 ⇒ 选弹窗而不是主窗", () => {
    const id = notificationClickWindow([cand(1, { sessionId: "s2" }), cand(2, { sessionId: "s1" })], { sessionId: "s1", workspace: "/ws" }, 1);
    expect(id).toBe(2);
  });

  it("多个窗口都在看 ⇒ 焦点者优先", () => {
    const id = notificationClickWindow([cand(1, { sessionId: "s1" }), cand(2, { sessionId: "s1", focused: true })], { sessionId: "s1", workspace: "/ws" }, 1);
    expect(id).toBe(2);
  });

  it("会话或工作区不符 ⇒ 不命中，回主窗", () => {
    expect(notificationClickWindow([cand(1, { sessionId: "s2" }), cand(2, { sessionId: "s1", workspace: "/other" })], { sessionId: "s1", workspace: "/ws" }, 1)).toBe(1);
    expect(notificationClickWindow([cand(1, { sessionId: "s2" }), cand(2, { sessionId: "s3" })], { sessionId: "s1" }, 1)).toBe(1);
  });

  it("旧上报工作区未知按会话兜底；目标不带 workspace 时任意工作区均命中", () => {
    expect(notificationClickWindow([cand(1), cand(2, { sessionId: "s1", workspace: null })], { sessionId: "s1", workspace: "/ws" }, 1)).toBe(2);
    expect(notificationClickWindow([cand(1), cand(2, { sessionId: "s1", workspace: "/other" })], { sessionId: "s1" }, 1)).toBe(2);
  });

  it("主窗已关/不可用 ⇒ 任一存活窗口；全无 ⇒ null；死窗口不参与", () => {
    expect(notificationClickWindow([cand(2), cand(3, { sessionId: "s1", alive: false })], { sessionId: "s1" }, 1)).toBe(2);
    expect(notificationClickWindow([], { sessionId: "s1" }, 1)).toBeNull();
    expect(notificationClickWindow([cand(1, { alive: false }), cand(2)], { sessionId: "s1" }, 1)).toBe(2);
  });
});
