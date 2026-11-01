// 消息操作条 reveal（2026-10-30 按真机 Claude v3.6556.2 重写）。
//
// 官方 `--cds-message-actions-reveal-*` 实测值：
//   出现 opacity 120ms，delay 100ms；收起 60ms，delay 0；两向同 cubic-bezier(.32,.72,0,1)
//   且 `--cds-message-actions-reveal-scale: none` —— **只动 opacity**，不位移、不缩放。
//
// 旧判据（2026-10-21）钉的是「淡出 + 下沉 2px / 140ms 双向」，那是把官方读错了：
// 主窗 CSS 里 MessageActions 规则只过渡 opacity 与 scale，没有 translate。已作废。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "..", "src", "renderer", "styles.css"), "utf8");
const tokens = readFileSync(join(__dirname, "..", "src", "renderer", "tokens.css"), "utf8");

/** 取一条规则体（选择器 → 到第一个 } 为止）。 */
const block = (selector: string): string => {
  const start = css.indexOf(selector);
  expect(start, `未找到规则：${selector}`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("}", start));
};

describe("消息操作条 reveal", () => {
  it("隐藏态只压 opacity —— 无位移、无缩放（官方 reveal-scale = none）", () => {
    const rule = block(".row-actions {");
    expect(rule).toContain("opacity: 0");
    expect(rule).not.toContain("translate");
    expect(rule).not.toContain("scale(");
  });

  it("收起走 60ms（--t-reveal-out），不是通用微件档 140ms", () => {
    expect(block(".row-actions {")).toContain("transition: opacity var(--t-reveal-out) var(--ease-snap)");
    expect(tokens).toContain("--t-reveal-out: 60ms;");
  });

  it("出现走 120ms + 100ms 延迟，与收起不对称", () => {
    const rule = block(".row:hover .row-actions, .row:focus-within .row-actions {");
    expect(rule).toContain("opacity: 1");
    expect(rule).toContain("transition-duration: var(--t-reveal-in)");
    expect(rule).toContain("transition-delay: var(--t-reveal-in-delay)");
    expect(tokens).toContain("--t-reveal-in: 120ms;");
    expect(tokens).toContain("--t-reveal-in-delay: 100ms;");
  });

  it("键盘可达：focus-within 与 hover 同权", () => {
    expect(css).toContain(".row:hover .row-actions, .row:focus-within .row-actions {");
  });

  it("保存中保持可见", () => {
    expect(css).toContain('.row-actions[data-saving="true"] { opacity: 1; }');
  });
});
