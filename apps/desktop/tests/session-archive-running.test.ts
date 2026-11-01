// 归档运行中会话（2026-10-31）：可逆动作不拦，但确认卡必须前置「本轮继续在后台跑」。
import { expect, it } from "vitest";
import { readRendererFile } from "./helpers/app-surface";

it("归档确认带运行态，卡片前置后台继续跑说明", () => {
  const sessions = readRendererFile("state/sessions.ts");
  expect(sessions).toContain("setArchiveConfirm(runningSet.current.has(runKey(s.workspace, s.id)) ? { ...s, running: true } : s)");
  const scrims = readRendererFile("panes/ConfirmScrims.tsx");
  expect(scrims).toContain("archiveConfirm.running === true");
  expect(scrims).toContain("归档后本轮（含已排队消息）会在后台继续跑，完成后照常通知。");
});
