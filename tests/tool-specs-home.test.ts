// 工具规格表所有权钉（2026-11-19）：模型可见工具规格表整块（gateToolSpecs / isCoreSurfaceTool /
// READ_ONLY_DESCRIPTIONS / readOnlyDescriptions / OPTIONAL_SURFACE_TOOL_NAMES / CORE_SURFACE_TOOL_NAMES）
// 住在 src/agent/tool-specs.ts；session-provider 只留三行再导出（28 个消费方与判卷的导入面逐字不变）。
// 反向锚点：谁把规格表搬回装配器（session-provider），或把定义挪走却拆了再导出，本判卷当场红。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const provider = readFileSync("src/agent/session-provider.ts", "utf8");
const specs = readFileSync("src/agent/tool-specs.ts", "utf8");

describe("工具规格表单源（tool-specs.ts）", () => {
  it("规格表定义住在 tool-specs.ts，session-provider 源文本不再含 gateToolSpecs 定义", () => {
    expect(specs).toContain("export function gateToolSpecs");
    expect(provider).not.toContain("export function gateToolSpecs");
  });

  it("老地址再导出保持导入面：session-provider 从 tool-specs 再导出 gateToolSpecs/isCoreSurfaceTool", () => {
    expect(provider).toContain('export { gateToolSpecs, isCoreSurfaceTool } from "./tool-specs"');
  });
});
