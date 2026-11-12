// 第 1144 页：空屏项目 chip 复用工具栏的 activeProjectLabel，不再抄一遍 projects.find/回落。
import { describe, expect, it } from "vitest";
import { readAppSurface } from "./helpers/app-surface";

const src = readAppSurface();

describe("工作区显示名单源", () => {
  it("chip 复用 activeProjectLabel", () => {
    expect(src).toContain("<span>{activeProjectLabel ?? STR.empty.pickProject}</span>");
    expect(src).toContain("const activeProjectLabel = useMemo(() => activeWorkspace === null ? null");
  });
});
