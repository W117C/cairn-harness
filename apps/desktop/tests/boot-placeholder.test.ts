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

  it("主进程两处 BrowserWindow 都铺同一底色，判据是 settings.json 的 theme", () => {
    const main = read("main", "index.ts");
    expect(main).toContain("bootBackgroundFor(resolveBootTheme(");
    expect(main).toContain("nativeTheme.themeSource = readThemePreference()");
    expect(main).toContain("nativeTheme.themeSource = theme");
    expect(main.match(/backgroundColor:\s*bootBackground\(\)/g)?.length).toBe(2);
  });
});
