// 启动占位判卷（2026-10-21）：
// ① renderer 的首帧 HTML 必须在 CSS/React 到达前就有底色与品牌标记（防白闪）；
// ② root 一有子节点就淡出，不靠 JS 手动 remove；
// ③ 主进程窗口底色与占位用同一判据（nativeTheme 深浅），两处窗口都不能漏。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (...parts: string[]): string => readFileSync(join(__dirname, "..", "src", ...parts), "utf8");

describe("启动占位", () => {
  const html = read("renderer", "index.html");

  it("HTML 自带 boot 标记与启动文案，role=status 可被读屏读到", () => {
    expect(html).toContain('id="boot"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("正在启动…");
    expect(html).toContain("boot-mark");
  });

  it("root 非空即淡出；亮暗两套底色与 reduced-motion 都在", () => {
    expect(html).toContain("#root:not(:empty) + #boot");
    expect(html).toContain("visibility: hidden");
    expect(html).toContain("#fcfcfb");
    expect(html).toContain("#151515");
    expect(html).toContain("@media (prefers-color-scheme: dark)");
    expect(html).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("标记逐格加载（2026-10-24 业主）：内联 SVG 上色，图形不转、颜色顺时针逐格点亮", () => {
    // 外链 img 只能整枚同色，逐格必须内联；不再引用 cairn-mark.svg。
    expect(html).not.toContain("cairn-mark.svg");
    expect(html).toContain('<svg class="boot-mark"');
    expect(html).toContain("animation: boot-cell 1.68s linear infinite");
    // 7 格的顺时针位次延时（12 点 → 火花 → 2 点 → … → 10 点，每格 0.24s 时隙）。
    expect(html).toContain("nth-child(1) { animation-delay: 0s; }");
    expect(html).toContain("nth-child(7) { animation-delay: .24s; }");
    expect(html).toContain("nth-child(2) { animation-delay: 1.44s; }");
    // 图形本身不转：整个占位里没有 rotate/transform 型自转。
    expect(html).not.toContain("rotate");
    // reduced-motion：整枚停格为全色，不闪。
    const reduced = html.split("prefers-reduced-motion: reduce")[1] ?? "";
    expect(reduced).toContain("#boot .boot-mark path { animation: none; opacity: 1; }");
    // 线性进度条已整体撤下（2026-10-24 业主）：图标本身就是加载动效，不再要第二套。
    expect(html).not.toContain("boot-line");
    expect(html).not.toContain("boot-slide");
  });

  it("主进程两处 BrowserWindow 都铺同一底色，判据是 settings.json 的 theme", () => {
    const main = read("main", "index.ts");
    expect(main).toContain("bootBackgroundFor(resolveBootTheme(");
    expect(main).toContain("nativeTheme.themeSource = readThemePreference()");
    expect(main).toContain("nativeTheme.themeSource = theme");
    expect(main.match(/backgroundColor:\s*bootBackground\(\)/g)?.length).toBe(2);
  });
});
