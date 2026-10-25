// 完成通知点击接线（2026-10-25）：main 发 Notification → click 聚焦主窗 + push →
// preload 转发 → renderer 订阅并打开目标会话。真实 OS 通知点击不在离屏环境验证。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { PUSH_CHANNELS } from "../src/main/channels";
import { IPC_PROTOCOL_VERSION } from "../../../src/main/ipc-protocol";
import { readRendererFile } from "./helpers/app-surface";

const repo = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

it("推送通道与协议版本：v21 增 onNotificationOpen，当前 v24（v24 为编排通道）", () => {
  expect(PUSH_CHANNELS.onNotificationOpen).toBe("agent:notification-open");
  expect(IPC_PROTOCOL_VERSION).toBe(24);
  const protocol = repo("../../../src/main/ipc-protocol.ts");
  expect(protocol).toContain("export interface RunNotificationPayload");
  expect(protocol).toContain("onNotificationOpen(cb: (p: RunNotificationPayload) => void)");
});

it("main：发通知前过纯函数决策；click 聚焦主窗并把 target 推给 renderer", () => {
  const main = repo("../src/main/index.ts");
  expect(main).toContain("shouldNotifyRunSettled");
  expect(main).toContain("runNotificationCopy");
  expect(main).toContain("runNotificationTarget");
  expect(main).toContain('notification.on("click"');
  expect(main).toContain("PUSH_CHANNELS.onNotificationOpen");
  expect(main).toContain("app.focus({ steal: true })");
  // run 收束时把任务原文与工作区带进通知（正文可读、点击可精确寻址）。
  expect(main).toContain("typeof request?.workspace === \"string\"");
  expect(main).toContain("typeof request?.message === \"string\"");
});

it("preload / renderer：薄转发 + 校验载荷 + 同会话不重载 + workspace 只要字符串", () => {
  const preload = repo("../src/preload/index.ts");
  expect(preload).toContain("onNotificationOpen");
  expect(preload).toContain("PUSH_CHANNELS.onNotificationOpen");
  const workbench = readRendererFile("state/workbench.ts");
  expect(workbench).toContain("window.agent.onNotificationOpen");
  expect(workbench).toContain("typeof target.sessionId !== \"string\"");
  expect(workbench).toContain("activeIdRef.current === target.sessionId");
  expect(workbench).toContain("typeof target.workspace === \"string\"");
  expect(workbench).toContain("openSessionRef.current(");
});
