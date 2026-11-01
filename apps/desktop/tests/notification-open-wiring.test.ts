// 完成通知点击接线（2026-10-25；849 起 click 先落到已在看目标的窗口，弹窗也算）：
// main 发 Notification → click 选窗聚焦 + push → preload 转发 → renderer 订阅并打开目标会话。
// 真实 OS 通知点击不在离屏环境验证。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { PUSH_CHANNELS } from "../src/main/channels";
import { IPC_PROTOCOL_VERSION } from "../../../src/main/ipc-protocol";
import { readRendererFile } from "./helpers/app-surface";

const repo = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

it("推送通道与协议版本：v21 增 onNotificationOpen，当前 v51（… / v47 撤销全局经验 / v48 全局冻结开关 / v49 恢复全局经验）", () => {
  expect(PUSH_CHANNELS.onNotificationOpen).toBe("agent:notification-open");
  expect(IPC_PROTOCOL_VERSION).toBe(51);
  const protocol = repo("../../../src/main/ipc-protocol.ts");
  expect(protocol).toContain("export interface RunNotificationPayload");
  expect(protocol).toContain("onNotificationOpen(cb: (p: RunNotificationPayload) => void)");
});

it("main：发通知前过纯函数决策；click 选中目标窗口并把 target 推给 renderer", () => {
  const main = repo("../src/main/index.ts");
  expect(main).toContain("shouldNotifyRunSettled");
  expect(main).toContain("runNotificationCopy");
  expect(main).toContain("runNotificationTarget");
  expect(main).toContain('notification.on("click"');
  expect(main).toContain("notificationClickWindow");
  // 已在看目标的弹窗只需带到前台；只有主窗的 renderer 认识 notification-open。
  expect(main).toContain("win.id === mainId");
  expect(main).toContain("PUSH_CHANNELS.onNotificationOpen");
  expect(main).toContain("app.focus({ steal: true })");
  // run 收束时把任务原文与工作区带进通知（正文可读、点击可精确寻址）。
  expect(main).toContain("typeof request?.workspace === \"string\"");
  expect(main).toContain("typeof request?.message === \"string\"");
  // v32：通知开关读设置（不是恒发）——enabled 由 settings.notifyOnComplete 决定。
  expect(main).toContain("notifyOnComplete");
  expect(main).toContain("enabled: notifyEnabled");
});

it("「不在看那个会话」判据接线：renderer 上报可见会话，main 按 viewingTarget 决策", () => {
  const main = repo("../src/main/index.ts");
  expect(main).toContain("reportViewing: async (sessionId, workspace, owner) =>");
  expect(main).toContain("focusedWindowViewing");
  expect(main).toContain("viewingByWindow");
  expect(main).toContain('if (key === "reportViewing")');
  expect(main).toContain("viewingTarget");
  const workbench = readRendererFile("state/workbench.ts");
  expect(workbench).toContain("window.agent.reportViewing(activeId");
  const popout = readRendererFile("components/PopoutApp.tsx");
  expect(popout).toContain("window.agent.reportViewing");
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
