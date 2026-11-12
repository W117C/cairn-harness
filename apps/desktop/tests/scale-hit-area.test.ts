// 双轴缩放走查与最小命中区 · 判卷（2026-11-08 第 1050 页）
//
// 一手依据：`scale-audit.cjs` 用**真档位属性**驱动 5 组合 × 8 视口，量出最小尺寸档
// （--size-scale 0.833）有 8 个按钮缩到 20×20 / 22 / 23px，低于第 1045 页「可见按钮 ≥24×24」。
// 修法沿用 `.md-copy` 的「视觉可小、命中区不能小」：只在 step1 档给 min-* 兜底。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(fileURLToPath(new URL("../src/renderer/styles.css", import.meta.url)), "utf8");
const tokens = readFileSync(fileURLToPath(new URL("../src/renderer/tokens.css", import.meta.url)), "utf8");
const audit = readFileSync(fileURLToPath(new URL("../scripts/scale-audit.cjs", import.meta.url)), "utf8");

describe("双轴真档位（不伪造 CSS 变量）", () => {
  it("文字轴 sm / lg 与尺寸轴 step1..5 的值来自 tokens.css", () => {
    expect(tokens).toContain('html[data-text-size="sm"] { --rem-scale: 0.92; }');
    expect(tokens).toContain('html[data-text-size="lg"] { --rem-scale: 1.08; }');
    for (const [step, scale] of [["1", "0.833"], ["2", "1"], ["3", "1.167"], ["4", "1.333"], ["5", "1.667"]]) {
      expect(tokens).toContain(`html[data-ui-size="${step}"] { --size-scale: ${scale}; }`);
    }
  });

  it("走查脚本按真的 data-* 属性驱动，并自证两个 scale 的 computed 值", () => {
    expect(audit).toContain("h.dataset.textSize = ");
    expect(audit).toContain("h.dataset.uiSize = ");
    expect(audit).toContain("parseFloat(root.getPropertyValue('--rem-scale'))");
    expect(audit).toContain("parseFloat(root.getPropertyValue('--size-scale'))");
    expect(audit).toContain('label: "max"');
    expect(audit).toContain('label: "min"');
    expect(audit).toContain("const WIDTHS = [1440, 1200, 1080, 960, 880, 760, 640, 620]");
  });

  it("验伪：单行 ellipsis 是设计省略，不算文字裁切缺陷", () => {
    expect(audit).toContain('getComputedStyle(e).textOverflow === "ellipsis"');
    expect(audit).toContain(".filter((x) => !(x.ellipsis && x.nowrap))");
  });
});

describe("最小尺寸档的命中区兜底（第 1050 页）", () => {
  it("只在 html[data-ui-size=\"1\"] 作用域，不污染默认档", () => {
    const block = css.slice(css.indexOf("第 1050 页 · 双轴缩放的最小命中区"));
    expect(block.length).toBeGreaterThan(0);
    expect(block).toContain("min-height: 24px");
    expect(block).toContain("min-width: 24px");
    expect(block).not.toContain("button { min"); // 不写全局 button 兜底
    // 11 条选择器（7 个 min-height + 4 个 min-width）都带 step1 前缀
    const selectorLines = block.split("\n").filter((l) => l.trim().startsWith('html[data-ui-size="1"]'));
    expect(selectorLines).toHaveLength(11);
  });

  it("覆盖真机抓到的 7 个高度不足 + 4 个宽高都不足的类", () => {
    const block = css.slice(css.indexOf("第 1050 页 · 双轴缩放的最小命中区"));
    for (const cls of [".iconbtn.sm", ".tb-btn", ".tb-title", ".group-toggle", ".attach-btn", ".ctl", ".usage-ring"]) {
      expect(block).toContain(`html[data-ui-size="1"] ${cls}`);
    }
  });

  it("默认档基础规则原样：按钮仍由 --h-btn-* / --h-row 驱动", () => {
    expect(css).toContain(".iconbtn.sm { width: var(--h-btn-sm); height: var(--h-btn-sm); }");
    expect(css).toContain("width: var(--h-btn-sm); height: var(--h-btn-sm); border-radius: var(--radius-sm)");
    expect(css).toContain("height: var(--h-row); padding: 0 var(--space-xs) 0 var(--space-sm)");
  });

  it("硬判据：baseline 与 min 两档都不许有小靶面", () => {
    expect(audit).toContain('combo.label === "baseline" || combo.label === "min"');
    expect(audit).toContain("命中区 ≥24px 不随尺寸轴缩水");
    expect(audit).toContain("r.overflow || !r.composerInView");
  });
});
