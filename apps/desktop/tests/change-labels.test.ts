// 文件改动的三个词只有一张表（第 942 页）：此前 `ChangeSummaryCard` 的 CHANGE_LABEL、
// `Inspector` 的 CHANGE_WORD、`PaneDock` 两处内联三元各写一份——同一套词三份手抄。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { changeLabel, planActionLabel } from "../src/renderer/derived/change-labels";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("文件改动词表", () => {
  it("三个词：新建 / 修改 / 变更；认不出的一律「变更」（不猜）", () => {
    expect(changeLabel("created")).toBe("新建");
    expect(changeLabel("modified")).toBe("修改");
    expect(changeLabel("unknown")).toBe("变更");
    expect(changeLabel("renamed")).toBe("变更");
    expect(changeLabel("")).toBe("变更");
  });

  it("方案动作三个词：新建 / 修改 / 删除；认不出的原样返回", () => {
    expect(planActionLabel("create")).toBe("新建");
    expect(planActionLabel("edit")).toBe("修改");
    expect(planActionLabel("delete")).toBe("删除");
    expect(planActionLabel("rename")).toBe("rename");
  });

  it("三处消费面都读同一份，且不再各自内联三元", () => {
    const card = read("../src/renderer/components/ChangeSummaryCard.tsx");
    expect(card).toContain('from "../derived/change-labels"');
    expect(card).toContain("changeLabel(f.change)");
    expect(card).not.toContain("const CHANGE_LABEL");

    const inspector = read("../src/renderer/components/Inspector.tsx");
    expect(inspector).toContain('from "../derived/change-labels"');
    expect(inspector).toContain("changeLabel(f.change)");
    expect(inspector).not.toContain("const CHANGE_WORD");

    const plan = read("../src/renderer/components/PlanCard.tsx");
    expect(plan).toContain('from "../derived/change-labels"');
    expect(plan).toContain("planActionLabel(f.action)");
    expect(plan).not.toContain("const ACTION_LABEL");

    const dock = read("../src/renderer/components/PaneDock.tsx");
    expect(dock).toContain('from "../derived/change-labels"');
    expect(dock).toContain("changeLabel(f.change)");
    expect(dock).not.toContain('f.change === "created" ?');
    expect(dock).not.toContain('f.action === "create" ? "新建"');
    expect(dock).toContain("planActionLabel(f.action)");
  });
});
