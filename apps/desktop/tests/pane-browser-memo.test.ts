// 第 1099 页：PaneDock 的事件流父渲染不应带着 BrowserPane（480 行、且不接 events）一起跑。
// BrowserPane 的 props 只有 active/openTarget/pickSignal/回调，memo 后父级 events 变化直接跳过。
import { describe, expect, it } from "vitest";
import { readAppSurface } from "./helpers/app-surface";

const src = readAppSurface();

describe("BrowserPane memo（第 1099 页）", () => {
  it("BrowserPane 是 memo 组件，且不由事件流 props 驱动", () => {
    expect(src).toContain("const BrowserPane = memo(function BrowserPane(props: {");
    expect(src).toContain("});\n\n/** 方案窗格");
    // 反面对照：旧的裸 function 形态不许回来
    expect(src).not.toContain("\nfunction BrowserPane(props: {");
    expect(src).toContain("const PlanPane = memo(function PlanPane(props: { events: readonly AgentEvent[] }): React.JSX.Element {");
    expect(src).toContain("const TasksPane = memo(function TasksPane(props: { events: readonly AgentEvent[] }): React.JSX.Element {");
  });
});
