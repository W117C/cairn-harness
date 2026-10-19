// 焦点环口径（业主 2026-10-16 裁 B）：:focus-visible 走强调色域（40% 透明）。
// 覆盖第十一遍「蓝→中性」的泛化——那一轮去的是**蓝**（焦点环不是信息强调），不是永禁强调色；
// 本裁把焦点环归入强调色可用区（与选中态/主按钮同域）。实现必须以 token 表达，零字面色值。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("焦点环（裁 B：强调色域）", () => {
  it(":focus-visible = 强调色 40%（tokens 变量表达，无字面色值）", () => {
    const css = readFileSync(fileURLToPath(new URL("../src/renderer/styles.css", import.meta.url)), "utf8");
    expect(css).toContain("outline: 2px solid hsl(var(--accent-brand) / 40%)");
  });
});
