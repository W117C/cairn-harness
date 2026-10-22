// 消息操作条 reveal（2026-10-21）：v3 的 actions 是「淡入 + 2px 贴位」，不是硬切。
// 只动 hover/focus 的 reveal，不改「渲染即挂载」的既有约束。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "..", "src", "renderer", "styles.css"), "utf8");

describe("消息操作条 reveal", () => {
  it("隐藏态是淡出 + 下沉 2px，过渡走几何令牌", () => {
    const block = css.slice(css.indexOf(".row-actions {"), css.indexOf("}", css.indexOf(".row-actions {")));
    expect(block).toContain("opacity: 0");
    expect(block).toContain("transform: translateY(2px)");
    expect(block).toContain("transition: opacity var(--t-fast), transform var(--t-fast)");
  });

  it("hover/focus 与保存态都回到原位", () => {
    expect(css).toContain(".row:hover .row-actions, .row:focus-within .row-actions { opacity: 1; transform: none; }");
    expect(css).toContain('.row-actions[data-saving="true"] { opacity: 1; transform: none; }');
  });
});
