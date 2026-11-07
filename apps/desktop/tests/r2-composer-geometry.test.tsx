// R2 输入区几何判卷（2026-10-31）：按 open-claude-ui ChatComposer v2 / AttachmentCard 契约。
// 只钉可见几何与单一源，不重复 composer-rework 的行为面。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("Composer：输入框高度轴", () => {
  const css = read("../src/renderer/styles.css");
  const src = read("../src/renderer/components/Composer.tsx");

  it("14px / 1.5 行高；最小 36px（2026-11-05 对齐 DeepSeek 官方 InputBar），最大 min(40svh, 24rem)", () => {
    expect(css).toMatch(/\.row2 textarea\s*\{[^}]*line-height:\s*1\.5/s);
    expect(css).toMatch(/\.row2 textarea\s*\{[^}]*min-height:\s*calc\(36px \* var\(--size-scale\)\)/s);
    expect(css).toMatch(/\.row2 textarea\s*\{[^}]*max-height:\s*min\(40svh, calc\(24rem \* var\(--size-scale\)\)\)/s);
    // 官方 .card：padding-top 8（卡顶距）
    expect(css).toMatch(/\.composer-card\s*\{[^}]*padding-top:\s*var\(--space-sm\)/s);
  });

  it("自增高仍读 CSS 的 max-height，不写第二份上限", () => {
    expect(src).toContain("getComputedStyle(ta).maxHeight");
    expect(src).not.toContain("calc(8 * 1.7 * var(--fs-body-md))");
  });
});

describe("Composer：下颌与附件磁贴", () => {
  const css = read("../src/renderer/styles.css");

  it("下颌无上分线（官方 InputBar 无分隔）、28px 最小高、控件间距 12px", () => {
    expect(css).toMatch(/\.row3\s*\{[^}]*min-height:\s*calc\(28px \* var\(--size-scale\)\)/s);
    expect(css).toMatch(/\.row3\s*\{[^}]*gap:\s*calc\(12px \* var\(--size-scale\)\)/s);
    expect(css).not.toMatch(/\.row3\s*\{[^}]*border-top/s);
  });

  it("思考档是分段滑轨：6% 中性轨道 + 30px 选中段", () => {
    expect(css).toMatch(/\.th-row\s*\{[^}]*background:\s*hsl\(from hsl\(var\(--text-000\)\) h s l \/ 6%\)/s);
    expect(css).toMatch(/\.th-row button\s*\{[^}]*min-height:\s*calc\(30px \* var\(--size-scale\)\)/s);
  });

  it("斜杠/@ 联想菜单行高 36px，长名/面包屑仍省略", () => {
    expect(css).toMatch(/\.slash-menu \.menu-item,\s*\.mention-menu \.menu-item\s*\{[^}]*min-height:\s*calc\(36px \* var\(--size-scale\)\)/s);
    expect(css).toMatch(/\.slash-menu \.menu-item \.sub,\s*\.mention-menu \.menu-item \.sub\s*\{[^}]*color:\s*hsl\(var\(--text-400\)\)/s);
  });

  it("附件是 128×96 磁贴；删除钮浮右上，主区仍是原按钮", () => {
    expect(css).toMatch(/\.attach-chip\s*\{[^}]*width:\s*calc\(128px \* var\(--size-scale\)\)/s);
    expect(css).toMatch(/\.attach-chip\s*\{[^}]*height:\s*calc\(96px \* var\(--size-scale\)\)/s);
    expect(css).toMatch(/\.attach-chip \.x\s*\{[^}]*position:\s*absolute/s);
    expect(css).toMatch(/\.attach-chip \.x\s*\{[^}]*top:\s*-4px/s);
    // 文件名仍允许两行，不把长名硬压成一条看不清。
    expect(css).toMatch(/\.attach-chip \.ac-name\s*\{[^}]*-webkit-line-clamp:\s*2/s);
  });
});
