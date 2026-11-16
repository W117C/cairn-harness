// Plan 模式自治（2026-11-03 业主「agent 自己决定是否先出方案」）：
// UI 不再有用户武装面（Composer 开关/设置默认值），是否先出方案由 agent 自判
// （系统提示词纪律 2 + propose_plan 工具 + 方案门写禁）。RunRequest.planRequired 与
// 主进程方案门机制保留（协议兼容；深链/判卷/CLI 仍可武装）。核心方案门语义由
// tests/plan-required.test.ts 与 cli-surface 既有判据覆盖；真实跃迁由 plan-mode-smoke 验。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { IPC_PROTOCOL_VERSION } from "../../../src/main/ipc-protocol";
import { readAppSurface, readRendererFile } from "./helpers/app-surface";

const repo = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

it("协议（现 v79）：RunRequest.planRequired 字段与 validator 保留，主进程两路透传不变", () => {
  expect(IPC_PROTOCOL_VERSION).toBe(79);
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
  // 「撤下」= 整个渲染层不许再有，不是某一个文件里恰好没有：读应用面（第 1305 页口径），
  // 否则开关代码搬去 hook/子组件后，单文件否定断言会空过。
  const appSrc = readAppSurface();
  expect(appSrc).not.toContain("onPlanRequiredChange");
  expect(appSrc).not.toContain("plan-ctl");
  expect(appSrc).not.toContain("planOverride");
  expect(appSrc).not.toContain("planRequiredRef");
  expect(appSrc).not.toContain("changePlanRequired");
  // 第 1069 页：权限段已拆到 settings/；第 1072 页：白名单解耦到叶子 provider-assets.ts。
  // 三处同一条禁令（不许重新混入默认值/白名单键），读应用面后不必再按文件各抄一遍。
  expect(appSrc).not.toContain("planRequiredByDefault");
  for (const gone of ["planLabel", "planAria", "planOnTip", "planOffTip", "planOnNotice", "planOffNotice"]) {
    expect(appSrc).not.toContain(gone);
  }
  // 位置敏感：协议字段名 `planRequired` 在 state/workbench.ts:210 还有一行解释性注释，
  // 读应用面会把「注释提到」误判成「又接上了」⇒ 这两处仍按各自文件职责读单文件。
  expect(readRendererFile("components/Composer.tsx")).not.toContain("planRequired");
  expect(readRendererFile("state/run-queue.ts")).not.toContain("planRequired");
  // 正断言仍读白名单所在叶子（值逐字不变）
  expect(readRendererFile("components/settings/provider-assets.ts")).toContain(
    'export const PANEL_PATCH_KEYS = ["provider", "model", "mode", "theme", "locale"] as const;',
  );
});

it("自治判进系统提示词：纪律 2 由 agent 自判是否先出方案（judgment 面非用户开关）", () => {
  // 2026-11-05 全英文 SOTA 重构：字面随 BASE_SYSTEM 迁英文；裁决本身不变——是否提方案由模型
  // 自判（复杂/验收未定 → propose_plan 等批准；明确小改动直接做并 verify），没有用户侧「方案」开关。
  const prompt = repo("../../../src/agent/system-prompt.ts");
  expect(prompt).toContain("自治判");
  expect(prompt).toContain("Multi-file/structural changes or unclear acceptance criteria require propose_plan first for approval");
  expect(prompt).toContain("single clear changes proceed directly with verify");
});
