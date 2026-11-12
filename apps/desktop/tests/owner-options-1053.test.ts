// 业主裁「A 轻度 + B 轻度」落地判卷（2026-11-08 第 1053 页）
//
// 样板（第 1052 页）用的是带 !important 的元素覆盖，只负责「看起来会怎样」；
// 落地必须回到语义 token 单源，且不碰亮色、不碰反白文字、不扩大浮层降层范围。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(fileURLToPath(new URL("../src/renderer/styles.css", import.meta.url)), "utf8");
const tokens = readFileSync(fileURLToPath(new URL("../src/renderer/tokens.css", import.meta.url)), "utf8");
const boot = readFileSync(fileURLToPath(new URL("../src/main/boot-theme.ts", import.meta.url)), "utf8");
const bootTest = readFileSync(fileURLToPath(new URL("./boot-theme.test.ts", import.meta.url)), "utf8");
const landed = css.slice(css.indexOf("第 1053 页 · 业主裁"));

describe("A 轻度：暗色表面提亮，仍是语义单源", () => {
  it("落点在 body[data-dsh-claude-style]（html 暗块被 adapter 截断继承）", () => {
    expect(landed).toContain('[data-theme="dark"] body[data-dsh-claude-style] {');
    expect(landed).toContain("--bg-100: 0 0% 10.5%");
    expect(landed).toContain("--surface-card: 60 2.4% 18.4%");
    expect(landed).toContain("--hairline-strong: hsl(var(--text-000) / 20%)");
  });

  it("输入卡 / 浮层读新语义 token，亮色档回退 --bg-000（不回归）", () => {
    expect((css.match(/hsl\(var\(--surface-card, var\(--bg-000\)\)\)/g) ?? []).length).toBe(2);
    // vendor 用更高优先级直接给 [data-composer-card] 设底色，暗色档必须用同等作用域接回同一 token
    expect(landed).toContain('html[data-theme="dark"] body[data-dsh-claude-style] [data-composer-card]');
    expect(landed).toContain("background: hsl(var(--surface-card))");
    // 新 token 只在暗色块定义一次，亮色没有任何定义 ⇒ 回退 / vendor 规则原样生效
    expect((css.match(/--surface-card:/g) ?? []).length).toBe(1);
  });

  it("不改全局 --bg-000：三处反白文字仍拿它当对比色", () => {
    expect((css.match(/color: hsl\(var\(--bg-000\)\)/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(css).not.toMatch(/--bg-000:\s*60 2\.4% 18\.4%/);
  });

  it("html 暗色块既有定值不动（tokens.test.ts 与 cds-parity 仍绿）", () => {
    expect(tokens).toContain("--bg-100: 0 0% 8.2%");
    expect(tokens).toContain("--hairline-strong: hsl(var(--text-000) / 13%)");
  });

  it("启动底色同步到 #1b1b1b，避免首帧色差（同类调用路径一并修）", () => {
    expect(boot).toContain('? "#1b1b1b" : "#fcfcfb"');
    expect(bootTest).toContain('toBe("#1b1b1b")');
  });
});

describe("B 轻度：菜单背景轻降层", () => {
  it("9% 黑、不吃点击、层级低于弹层，且只在暗色（亮色未验证不报绿）", () => {
    expect(landed).toContain('[data-theme="dark"] body:has(.chip-pop.show)::after');
    expect(css).not.toMatch(/^body:has\(\.chip-pop\.show\)::after \{/m);
    expect(landed).toContain("hsl(0 0% 0% / 9%)");
    expect(landed).toContain("pointer-events: none");
    expect(landed).toContain("z-index: 35");
  });

  it("只覆盖样板验证过的项目菜单，不泛化到 stacking context 更低的浮层", () => {
    expect(css).not.toContain("body:has(.pop.show)::after");
    expect(landed).toContain(".zone-composer 只有 11"); // 范围限制的归因写在 CSS 注释里
  });
});

describe("不照搬样板", () => {
  it("落地段落没有 !important（样板覆盖不可进产品）", () => {
    expect(landed.length).toBeGreaterThan(0);
    expect(landed).not.toContain("!important");
  });
});
