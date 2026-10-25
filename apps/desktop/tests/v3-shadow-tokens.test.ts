// 弹层投影按 v3 两主题实测值（2026-10-21 · Claude v3 CSS 作用域直读）。
//
// v3 `--cds-shadow-popover`：
//   亮色 = 0 8px 24px #0000001f, 0 2px 6px #00000014
//   暗色 = 0 8px 24px #00000052, 0 2px 6px #0003
// 模糊半径两主题相同（24 / 6），只有墨色浓度不同。
//
// 本仓此前是 8px 28px / 2px 8px（模糊更大、墨更淡），与 v3 不符；已改正。
// 判据钉两主题的**四段值**（模糊 + 浓度），改任一段必须红。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const TOKENS = readFileSync(fileURLToPath(new URL("../src/renderer/tokens.css", import.meta.url)), "utf8");

const shadowPop = (block: string): string | undefined =>
  /--shadow-pop:\s*([^;]+);/.exec(block)?.[1]?.trim();

/** 暗色**规则**的起点（不是注释里提到它的那一行）。 */
const darkRuleAt = (): number => {
  const i = TOKENS.indexOf('[data-theme="dark"] {');
  expect(i, "tokens.css 里没有 [data-theme=dark] 规则").toBeGreaterThan(-1);
  return i;
};

describe("弹层投影（v3 shadow-popover 两主题）", () => {
  it("亮色：8px 24px 12% + 2px 6px 8%", () => {
    const darkAt = darkRuleAt();
    const light = shadowPop(TOKENS.slice(0, darkAt));
    expect(light).toBe("0 8px 24px rgb(0 0 0 / 0.12), 0 2px 6px rgb(0 0 0 / 0.08)");
  });

  it("暗色：8px 24px 32% + 2px 6px 20%（v3 #00000052 / #0003）", () => {
    const darkAt = darkRuleAt();
    const dark = shadowPop(TOKENS.slice(darkAt));
    expect(dark).toBe("0 8px 24px rgb(0 0 0 / 0.32), 0 2px 6px rgb(0 0 0 / 0.2)");
  });

  it("两主题模糊半径一致（24 / 6），只有浓度不同", () => {
    const darkAt = darkRuleAt();
    const light = shadowPop(TOKENS.slice(0, darkAt)) ?? "";
    const dark = shadowPop(TOKENS.slice(darkAt)) ?? "";
    const blur = (v: string): string[] => [...v.matchAll(/(\d+)px (?=\d+px)/g)].map((m) => m[1] ?? "");
    expect(blur(light)).toEqual(blur(dark));
    expect(blur(light)).toEqual(["8", "2"]);
  });

  it("卡片投影：亮色单层 1px/2px 5%，暗色两层（1px/2px 6% + 2px/8px 24%）（v3 shadow-sm）", () => {
    // v3 亮色 `--cds-shadow-sm` = 0 1px 2px 0 #0000000d（单层）。
    // v3 暗色 = 0 1px 2px 0 hsl(gray-900 / 6%), 0 2px 8px 0 var(--cds-shadow-color)；
    //   暗色 shadow-color = #0000003d（≈24%），故两层都要，暗底才有浮起感。
    const darkAt = TOKENS.indexOf('[data-theme="dark"] {');
    const light = /--shadow-card:\s*([^;]+);/.exec(TOKENS.slice(0, darkAt))?.[1]?.trim();
    const dark = /--shadow-card:\s*([^;]+);/.exec(TOKENS.slice(darkAt))?.[1]?.trim();
    expect(light).toBe("0 1px 2px rgb(0 0 0 / 0.05)");
    expect(dark).toBe("0 1px 2px rgb(0 0 0 / 0.06), 0 2px 8px rgb(0 0 0 / 0.24)");
  });
});
