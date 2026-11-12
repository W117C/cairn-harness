// 第 1104 页：会话行菜单关闭时不为每行预生成项目子菜单条目；打开才按需算。
import { describe, expect, it } from "vitest";
import { readAppSurface } from "./helpers/app-surface";

const src = readAppSurface();

describe("Sidebar 会话菜单按需生成", () => {
  it("projectMenuItems 只在 ctxOpen 时算", () => {
    expect(src).toContain("const menuItems = ctxOpen ? projectMenuItems(s, props.projectOptions) : [];");
    expect(src).not.toContain("const menuItems = projectMenuItems(s, props.projectOptions);");
  });
});
