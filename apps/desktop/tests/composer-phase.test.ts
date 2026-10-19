// 运行状态条（2026-10-18）：Composer 一直收着 phaseLabel/elapsedSec/steps 三个 prop 却从不渲染——
// 用户只看得到停止键，看不到“等待审批/思考中/已停止”和跑了多久。这条钉住状态条的接线与口径：
// 步数是**会话累计**（countToolSteps 全事件流），所以标“共 N 步”，不冒充本轮步数。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = readFileSync(fileURLToPath(new URL("../src/renderer/components/Composer.tsx", import.meta.url)), "utf8");

describe("运行状态条", () => {
  it("仅运行/已停时出现，读 phaseLabel + elapsedSec + 累计步数", () => {
    expect(src).toContain("{(props.running || props.stopped) && (");
    expect(src).toContain('className="cc-phase" role="status" aria-live="polite"');
    expect(src).toContain("{props.phaseLabel}");
    expect(src).toContain("{(props.runSteps ?? 0) > 0 &&");
    expect(src).toContain("{String(props.runSteps)} 步");
    expect(src).toContain("{String(props.elapsedSec)}s");
  });
});
