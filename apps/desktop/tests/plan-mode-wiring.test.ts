// Plan 模式自治（2026-11-03 业主「agent 自己决定是否先出方案」）：
// UI 不再有用户武装面（Composer 开关/设置默认值），是否先出方案由 agent 自判
// （系统提示词纪律 2 + propose_plan 工具 + 方案门写禁）。RunRequest.planRequired 与
// 主进程方案门机制保留（协议兼容；深链/判卷/CLI 仍可武装）。核心方案门语义由
// tests/plan-required.test.ts 与 cli-surface 既有判据覆盖；真实跃迁由 plan-mode-smoke 验。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { IPC_PROTOCOL_VERSION } from "../../../src/main/ipc-protocol";
import { readRendererFile } from "./helpers/app-surface";

const repo = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

it("协议（现 v52）：RunRequest.planRequired 字段与 validator 保留，主进程两路透传不变", () => {
  expect(IPC_PROTOCOL_VERSION).toBe(53);
  const protocol = repo("../../../src/main/ipc-protocol.ts");
  expect(protocol).toContain("planRequired?: boolean;");
  const validator = repo("../../../src/main/run-request.ts");
  expect(validator).toContain('"planRequired",');
  expect(validator).toContain('typeof value.planRequired !== "boolean"');
  expect(validator).toContain("planRequired: value.planRequired as boolean");
  const host = repo("../src/main/kernel-host.ts");
  expect(host).toContain("handleAgentRun(req, req.planRequired !== undefined ? { planRequired: req.planRequired } : {})");
  expect(host).toContain("...(req.planRequired !== undefined ? { planRequired: req.planRequired } : {}),");
});

it("renderer 不再有用户武装面：Composer 开关、设置默认值、按轮 override 全部撤下", () => {
  const composer = readRendererFile("components/Composer.tsx");
  expect(composer).not.toContain("planRequired");
  expect(composer).not.toContain("onPlanRequiredChange");
  expect(composer).not.toContain("plan-ctl");
  const workbench = readRendererFile("state/workbench.ts");
  expect(workbench).not.toContain("planOverride");
  expect(workbench).not.toContain("planRequiredRef");
  expect(workbench).not.toContain("changePlanRequired");
  const queue = readRendererFile("state/run-queue.ts");
  expect(queue).not.toContain("planRequired");
  const settings = readRendererFile("components/settings-sections.tsx");
  expect(settings).not.toContain("planRequiredByDefault");
  // patch 白名单同步出列（UI 不再写这个键）
  expect(settings).toContain('export const PANEL_PATCH_KEYS = ["provider", "model", "mode", "theme", "locale"] as const;');
  const strings = readRendererFile("strings.ts");
  for (const gone of ["planLabel", "planAria", "planOnTip", "planOffTip", "planOnNotice", "planOffNotice"]) {
    expect(strings).not.toContain(gone);
  }
});

it("自治判进系统提示词：纪律 2 由 agent 自判是否先出方案（judgment 面非用户开关）", () => {
  // 2026-11-05 全英文 SOTA 重构：字面随 BASE_SYSTEM 迁英文；裁决本身不变——是否提方案由模型
  // 自判（复杂/验收未定 → propose_plan 等批准；明确小改动直接做并 verify），没有用户侧「方案」开关。
  const prompt = repo("../../../src/agent/system-prompt.ts");
  expect(prompt).toContain("自治判");
  expect(prompt).toContain("Multi-file/structural changes or unclear acceptance criteria require propose_plan first for approval");
  expect(prompt).toContain("single clear changes proceed directly with verify");
});
