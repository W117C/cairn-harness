// 视图三档的环逻辑判卷（蓝本 §3.4）：档位构成 / 循环顺序 / 回卷 / 离环收敛。
import { describe, expect, it } from "vitest";
import { nextViewMode, viewModesFor, VIEW_LABEL } from "../src/renderer/view-mode";

describe("视图三档（蓝本 §3.4 · Ctrl+O）", () => {
  it("有思考 ⇒ 三档环；没产出过思考 ⇒ 跳过 Thinking（不摆空档）", () => {
    expect(viewModesFor(true)).toEqual(["normal", "thinking", "verbose"]);
    expect(viewModesFor(false)).toEqual(["normal", "verbose"]);
  });

  it("循环顺序与回卷（两个环各自闭合）", () => {
    expect(nextViewMode("normal", true)).toBe("thinking");
    expect(nextViewMode("thinking", true)).toBe("verbose");
    expect(nextViewMode("verbose", true)).toBe("normal");
    expect(nextViewMode("normal", false)).toBe("verbose");
    expect(nextViewMode("verbose", false)).toBe("normal");
  });

  it("cur 已不在环里（停在 thinking 但本会话已无思考）⇒ 收敛回落，不卡死", () => {
    expect(nextViewMode("thinking", false)).toBe("normal");
  });

  it("toast 文案三档齐全（单一源）", () => {
    expect(Object.keys(VIEW_LABEL).sort()).toEqual(["normal", "thinking", "verbose"]);
    expect(VIEW_LABEL.verbose).toContain("全展开");
  });
});
