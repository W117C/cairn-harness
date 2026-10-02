import { describe, expect, it } from "vitest";
import { clarifyFormValues, planFileLines } from "../src/renderer/components/cards";

describe("卡片纯函数", () => {
  it("clarifyFormValues：单选取 label、多选收集数组、自由项取输入", () => {
    const v = clarifyFormValues(
      [{ question: "Q1", options: [{ label: "A" }, { label: "B" }] }, { question: "Q2", multiSelect: true, options: [{ label: "X" }, { label: "Y" }] }, { question: "Q3" }],
      { Q1: "A", Q2: ["X", "Y"], Q3: "自己写" },
    );
    expect(v).toEqual({ Q1: "A", Q2: ["X", "Y"], Q3: "自己写" });
    expect(() => clarifyFormValues([{ question: "Q", options: [{ label: "A" }] }], {})).toThrow(/必答/);
  });
  it("planFileLines：path+action+summary 组行", () => {
    expect(planFileLines([{ path: "a.ts", action: "edit", summary: "改窗格" }]))
      .toEqual(["edit  a.ts — 改窗格"]);
  });
});
