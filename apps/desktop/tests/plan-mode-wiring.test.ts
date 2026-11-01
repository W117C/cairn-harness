// Plan 模式一等入口（2026-10-25）：RunRequest.planRequired → kernel-host overrides →
// renderer 开关/默认/按轮 ref → run-queue 请求字段。核心方案门语义由 tests/plan-required.test.ts
// 与 cli-surface 既有判据覆盖；真实跃迁由 plan-mode-smoke 验。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { IPC_PROTOCOL_VERSION } from "../../../src/main/ipc-protocol";
import { readRendererFile } from "./helpers/app-surface";

const repo = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

it("协议 v23（现 v51）：RunRequest 有 planRequired，validator 只收布尔并原样保留", () => {
  expect(IPC_PROTOCOL_VERSION).toBe(51);
  const protocol = repo("../../../src/main/ipc-protocol.ts");
  expect(protocol).toContain("planRequired?: boolean;");
  const validator = repo("../../../src/main/run-request.ts");
  expect(validator).toContain('"planRequired",');
  expect(validator).toContain('typeof value.planRequired !== "boolean"');
  expect(validator).toContain("planRequired: value.planRequired as boolean");
});

it("main：两路 run 都把 req.planRequired 透给 handleAgentRun overrides", () => {
  const host = repo("../src/main/kernel-host.ts");
  expect(host).toContain("handleAgentRun(req, req.planRequired !== undefined ? { planRequired: req.planRequired } : {})");
  expect(host).toContain("...(req.planRequired !== undefined ? { planRequired: req.planRequired } : {}),");
});

it("renderer：设置默认 → 开关 override → run-queue 只带显式值", () => {
  const workbench = readRendererFile("state/workbench.ts");
  expect(workbench).toContain("setPlanDefault(s.planRequiredByDefault === true)");
  expect(workbench).toContain("const [planOverride, setPlanOverride] = useState<boolean | null>(null)");
  expect(workbench).toContain("const planRequired = planOverride ?? planDefault");
  expect(workbench).toContain("const changePlanRequired = useCallback");
  expect(workbench).toContain("planRequiredRef: planOverrideRef");
  expect(workbench).toContain("planRequired,\n    onPlanRequiredChange: changePlanRequired");
  const queue = readRendererFile("state/run-queue.ts");
  expect(queue).toContain("planRequiredRef?: MutableRefObject<boolean | null>");
  expect(queue).toContain("...(planRequired !== null ? { planRequired } : {}),");
});

it("Composer：方案开关用 aria-pressed/data-on，文案全出处 STR；设置页说明它是默认值", () => {
  const composer = readRendererFile("components/Composer.tsx");
  expect(composer).toContain('className="ctl plan-ctl"');
  expect(composer).toContain("aria-pressed={props.planRequired === true}");
  expect(composer).toContain("onPlanRequiredChange?.(props.planRequired !== true)");
  expect(composer).toContain("STR.composer.planLabel");
  expect(composer).toContain("STR.composer.planOnTip");
  const settings = readRendererFile("components/settings-sections.tsx");
  expect(settings).toContain("输入框旁的「方案」开关可按轮覆盖");
});
