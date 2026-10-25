// 焦点环口径（2026-10-20 Claude 实测三层结构；2026-10-21 再按 v3 token 把控件焦点从品牌橙拆出）。
// Claude v3 `--cds-focus-shadow` 用的是 `--cds-fill-accent` = blue-450，不是品牌陶土橙；
// 因此这里钉 `--accent-control`（blue-450），主按钮/品牌仍用 `--accent-brand`。
// 实现必须以 token 表达，零字面色值。
//
// 2026-10-20 更正：原单层 `outline: 2px solid` 改为 Claude 实测的 --cds-focus-shadow 三层
//   inset 0 0 0 1px <页面底>   ← 隔离层：把环与元素本体隔开
//   0 0 0 1px <实环>           ← 真正的"环"
//   0 0 6px 1px <外发光>       ← 暗底上也看得见
// 单层 outline 的缺陷：元素与环之间没有隔离层，深色元素上环会糊进本体。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(fileURLToPath(new URL("../src/renderer/styles.css", import.meta.url)), "utf8");
const TOKENS = readFileSync(fileURLToPath(new URL("../src/renderer/tokens.css", import.meta.url)), "utf8");
/** 取出全局 :focus-visible 规则体（到第一个 } 为止）。 */
function focusRule(): string {
  const m = /(?<![\w-]):focus-visible\s*\{([^}]*)\}/.exec(CSS);
  if (m === null) throw new Error("未找到全局 :focus-visible 规则");
  return m[1];
}

describe("焦点环（裁 B：强调色域 · 2026-10-20 三层结构）", () => {
  it("三层 box-shadow：隔离层 + 实环 + 外发光（Claude --cds-focus-shadow 形制）", () => {
    expect(TOKENS).toContain("--accent-control: 212.8 67.7% 50.2%");
    const rule = focusRule();
    // ① 隔离层：inset 1px，用页面底色
    expect(rule).toMatch(/inset\s+0\s+0\s+0\s+1px\s+hsl\(var\(--bg-100\)\)/);
    // ② 实环：1px 强调色
    expect(rule).toMatch(/0\s+0\s+0\s+1px\s+hsl\(var\(--accent-control\)/);
    // ③ 外发光：6px 扩散
    expect(rule).toMatch(/0\s+0\s+6px\s+1px\s+hsl\(var\(--accent-control-glow\)/);
  });

  it("三层顺序不能颠倒（inset 必须在前——它是最内层）", () => {
    const rule = focusRule();
    expect(rule.indexOf("inset")).toBeLessThan(rule.indexOf("0 0 6px 1px"));
  });

  it("零字面色值：三层全部走 token（换主题自动跟随）", () => {
    const rule = focusRule();
    // 规则体内不应出现 hex / rgb() 字面量
    expect(rule).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(rule).not.toMatch(/rgba?\(/);
  });

  it("保留 outline 透明占位（兼容强制颜色模式 / 读屏）", () => {
    expect(focusRule()).toMatch(/outline:\s*2px solid transparent/);
  });
});
