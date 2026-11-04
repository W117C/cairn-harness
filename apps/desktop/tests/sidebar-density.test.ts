// 侧栏密度判卷（2026-10-31，R3）：28px 紧凑档 + 默认舒适 + 坏档回落。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseSidebarDensity, SIDEBAR_DENSITY_KEY } from "../src/renderer/state/sidebar-density";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("侧栏密度：偏好解析", () => {
  it("compact 只认字面量；null/坏值/舒适都回 comfortable", () => {
    expect(SIDEBAR_DENSITY_KEY).toBe("cairn.sidebar.density.v1");
    expect(parseSidebarDensity("compact")).toBe("compact");
    expect(parseSidebarDensity("comfortable")).toBe("comfortable");
    expect(parseSidebarDensity(null)).toBe("comfortable");
    expect(parseSidebarDensity("cozy")).toBe("comfortable");
  });
});

describe("侧栏密度：接线与样式", () => {
  const sidebar = read("../src/renderer/components/Sidebar.tsx");
  const filterMenu = read("../src/renderer/components/SessionFilterMenu.tsx");
  const css = read("../src/renderer/styles.css");

  it("Sidebar 读偏好、写 data-density，筛选菜单提供紧凑视图", () => {
    expect(sidebar).toContain('from "../state/sidebar-density"');
    expect(sidebar).toContain("data-density={density}");
    expect(sidebar).toContain("SIDEBAR_DENSITY_KEY");
    // 文案走 STR.filter.compact（strings.test 禁止组件里写裸中文）。
    expect(sidebar).toContain("<SessionFilterMenu");
    expect(filterMenu).toContain("STR.filter.compact");
  });

  it("紧凑档：28px 行高 + 元信息浮到右侧只留钉形", () => {
    expect(css).toMatch(/\.side\[data-density="compact"\] \.session\s*\{[^}]*min-height:\s*28px/s);
    expect(css).toMatch(/\.side\[data-density="compact"\] \.s-meta\s*\{[^}]*position:\s*absolute/s);
    expect(css).toMatch(/\.side\[data-density="compact"\] \.s-meta > :not\(\.s-pin\)\s*\{[^}]*display:\s*none/s);
  });
});
