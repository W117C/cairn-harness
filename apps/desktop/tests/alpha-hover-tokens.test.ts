// hover / 选中的淡底刻度分主题（2026-10-21 · Claude v3 暗色 scope 实测）。
//
// v3 亮色 scope：`--cds-fill-ghost-hover` = alpha-1（5%）、`--cds-fill-ghost-selected` = alpha-2（10%）。
// v3 暗色 scope：hover 提到 **7.5%**、selected 提到 **15%**——暗底上同样的百分比看不出
// 「浮起」，所以暗色更实。
//
// 本仓原来直接写 `var(--alpha-1)` / `var(--alpha-2)`（固定 5% / 10%），暗底上偏淡。
// 现在改成两枚分主题刻度 `--alpha-hover` / `--alpha-selected`：
//   亮色 5% / 10%（与今天逐像素一致），暗色 7.5% / 15%。
//
// 判据钉的是**刻度值**与**接线**（hover 用 hover 刻度、选中用 selected 刻度），
// 不是「存在即绿」：把暗色覆盖去掉必须红。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(fileURLToPath(new URL("../src/renderer/styles.css", import.meta.url)), "utf8");
const TOKENS = readFileSync(fileURLToPath(new URL("../src/renderer/tokens.css", import.meta.url)), "utf8");

const block = (selector: string): string => {
  const i = CSS.indexOf(selector);
  expect(i, `未找到规则：${selector}`).toBeGreaterThan(-1);
  return CSS.slice(i, CSS.indexOf("}", i));
};

describe("hover / 选中淡底刻度（v3 明暗不同值）", () => {
  it("亮色 5% / 10%，暗色 7.5% / 15%（v3 暗色 scope 实测值）", () => {
    expect(TOKENS).toContain("--alpha-hover: 5%;");
    expect(TOKENS).toContain("--alpha-selected: 10%;");
    const darkAt = TOKENS.indexOf('[data-theme="dark"] {');
    const dark = TOKENS.slice(darkAt);
    expect(dark).toContain("--alpha-hover: 7.5%;");
    expect(dark).toContain("--alpha-selected: 15%;");
  });

  it("hover 规则吃 hover 刻度、选中规则吃 selected 刻度（不许混）", () => {
    expect(block(".session:hover {")).toContain("var(--alpha-hover)");
    expect(block(".session:hover {")).not.toContain("var(--alpha-selected)");
    expect(block(".session.active {")).toContain("var(--alpha-selected)");
    expect(block(".session.active {")).not.toContain("var(--alpha-hover)");
  });

  it("两枚刻度只以百分比进入 hsl()（颜色仍来自 text-000，零字面色值）", () => {
    expect(CSS).toContain("hsl(from hsl(var(--text-000)) h s l / var(--alpha-hover))");
    expect(CSS).toContain("hsl(from hsl(var(--text-000)) h s l / var(--alpha-selected))");
  });
});
