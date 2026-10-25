// 控件强调色与品牌色分离（2026-10-21 · Claude v3 token 复核）。
//
// Claude v3 的三枚 token 各有明确职责，混用就会把「控件态」读成「品牌态」：
//   --cds-fill-accent  = role-accent-450 (blue-450) → 焦点环 / 实心填充 / 选中边框
//   --cds-text-accent  = role-accent-600 (blue-600) → 强调**文字**（链接、选中项文字）
//   --cds-fill-brand   = clay-emphasized (#c6613f)  → 品牌填充（主按钮）
//
// 因此本仓拆成两枚：
//   --accent-control      = blue-450  → 环 / 填充 / 边框
//   --accent-control-text = blue-600  → 文字（450 当文字在亮底只有约 5.4:1，600 有 14:1+）
//   --accent-brand        = 陶土橙     → 品牌（主按钮、品牌图标、当前会话强调条）
//
// 判据钉的是**分工**（哪一枚用在哪），不是"存在即绿"：把控件蓝换回品牌橙必须红。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(fileURLToPath(new URL("../src/renderer/styles.css", import.meta.url)), "utf8");
const TOKENS = readFileSync(fileURLToPath(new URL("../src/renderer/tokens.css", import.meta.url)), "utf8");

/** 取一条规则体（选择器 → 规则文本）。 */
const block = (selector: string): string => {
  const i = CSS.indexOf(selector);
  expect(i, `未找到规则：${selector}`).toBeGreaterThan(-1);
  return CSS.slice(i, CSS.indexOf("}", i));
};

describe("控件强调色与品牌色分工（Claude v3）", () => {
  it("两枚控件 token 各自钉住 v3 实值（blue-450 / blue-600）", () => {
    expect(TOKENS).toContain("--accent-control: 212.8 67.7% 50.2%;");
    expect(TOKENS).toContain("--accent-control-text: 213.6 72.3% 33.9%;");
    // 品牌陶土橙仍在（主按钮/品牌图标）
    expect(TOKENS).toContain("--accent-brand: 15 63.1% 59.6%;");
  });

  it("焦点环三层用控件蓝（v3 --cds-focus-shadow 用 --cds-fill-accent）", () => {
    const rule = block(":focus-visible {");
    expect(rule).toContain("hsl(var(--accent-control) / 60%)");
    expect(rule).toContain("hsl(var(--accent-control-glow) / 60%)");
    expect(rule).not.toContain("accent-brand");
  });

  it("选中态（chip / 主题选项卡 / 设置档位）用控件蓝，不是品牌橙", () => {
    for (const sel of [".chip.on {", ".theme-opt.on {", ".ss-opt.on {"]) {
      const rule = block(sel);
      expect(rule, sel).toContain("accent-control");
      expect(rule, sel).not.toContain("accent-brand");
    }
  });

  it("焦点环外发光分主题：亮色 blue-100、暗色 blue-800（v3 --cds-bg-accent 两主题相反）", () => {
    // v3 实测：亮色 `--cds-bg-accent` = role-accent-100（blue-100 #cde2fb），
    // 暗色 scope = role-accent-800（blue-800 #032042）——同一枚 token 明暗相反。
    expect(TOKENS).toContain("--accent-control-glow: 210 70.9% 90%;");
    const darkAt = TOKENS.indexOf('[data-theme="dark"] {');
    expect(TOKENS.slice(darkAt)).toContain("--accent-control-glow: 210 82% 13%;");
    expect(block(":focus-visible {")).toContain("hsl(var(--accent-control-glow) / 60%)");
  });

  it("强调文字分主题：亮色 blue-600、暗色 blue-300（v3 暗色 scope 用 role-accent-300）", () => {
    // v3 实测：亮色 `--cds-text-accent` = role-accent-600；暗色 scope 改成 role-accent-300。
    expect(TOKENS).toContain("--accent-control-text: 213.6 72.3% 33.9%;");
    const darkAt = TOKENS.indexOf('[data-theme="dark"] {');
    const darkBlock = TOKENS.slice(darkAt);
    expect(darkBlock).toContain("--accent-control-text: 210 70.9% 51.6%;");
  });

  it("强调文字（链接 / 选中项文字 / 菜单勾）用 blue-600 那一枚", () => {
    for (const sel of [".ap-index-line a {", ".ap-body-line a {", ".menu-item .check {"]) {
      const rule = block(sel);
      expect(rule, sel).toContain("accent-control-text");
      expect(rule, sel).not.toContain("accent-brand");
    }
  });

  it("品牌橙仍留在品牌位（主按钮发送键、品牌图标、当前会话强调条）", () => {
    expect(block(".send-btn {")).toContain("hsl(var(--accent-brand))");
    expect(block(".session.active::before {")).toContain("hsl(var(--accent-brand))");
    expect(block(".empty-greet-mark {")).toContain("hsl(var(--accent-brand))");
  });
});
