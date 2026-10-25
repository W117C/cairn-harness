// 完成通知的纯决策/文案（2026-10-25）。CI 侧能钉的是「发不发、正文怎么取、点击目标」；
// 真实 OS 通知的弹出与点击在离屏 Electron 里造不出来——那一条由 notification-open-smoke
// 只验 renderer 接收后的开会话路径，并在报告里明确未验 OS click。
import { expect, it } from "vitest";
import {
  notificationPreview,
  runNotificationCopy,
  runNotificationTarget,
  shouldNotifyRunSettled,
  type RunNotificationInput,
} from "../src/main/run-notification";

const base: RunNotificationInput = {
  sessionId: "s1",
  supported: true,
  anyWindowFocused: false,
  ok: true,
};

it("只在支持通知、窗口未聚焦、会话 id 非空时发", () => {
  expect(shouldNotifyRunSettled(base)).toBe(true);
  expect(shouldNotifyRunSettled({ ...base, supported: false })).toBe(false);
  expect(shouldNotifyRunSettled({ ...base, anyWindowFocused: true })).toBe(false);
  expect(shouldNotifyRunSettled({ ...base, sessionId: "   " })).toBe(false);
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
