// 第 1133 页：SkillsPane 的 rows/selected/scope 按输入记忆，正文加载态不重扫。
import { describe, expect, it } from "vitest";
import { readAppSurface } from "./helpers/app-surface";

const src = readAppSurface();

describe("SkillsPane 行表记忆", () => {
  it("rows/selected/scope 都有 useMemo", () => {
    expect(src).toContain("const rows = useMemo(() => plugins.looseSkills");
    expect(src).toContain("const selected = useMemo(() => sel === null ? null : plugins.looseSkills.find");
    expect(src).toContain("const scope = useMemo(() => selected === null ? undefined : plugins.toolScopes.find");
    expect(src).toContain("输入技能名即可调用。");
    expect(src).not.toContain("在输入框输入技能名即可调用。");
  });
});
