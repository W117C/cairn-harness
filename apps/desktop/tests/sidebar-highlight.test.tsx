// 批 6 附带 #71（总纲阶段 3.5 侧边栏与导航）：侧栏「多项同时高亮」修复——
//   ① 选中态唯一：仅 .session.active 配左侧 2px 强调色条（文件夹行不再参与选中态着色）；
//   ② hover = 更淡底色，且过渡只写在 :hover 规则里 ⇒ 鼠标离开瞬时清除（无离开动画）；
//   ③ 设置页顶栏：.sp-page 不再覆盖 38px 标题栏（顶部让位，去 padding-top 空白带）。
// 真机复现（2026-10-16 隔离实例）：active 行 rgba(29,29,31,.1) 与 hover 行 rgba(29,29,31,.05) 同时在场。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const styles = readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
function block(sel: string): string {
  const i = styles.indexOf(`\n${sel} {`);
  expect(i, sel).toBeGreaterThan(-1);
  return styles.slice(i, styles.indexOf("}", i));
}

describe("#71 侧栏选中态（唯一 + 强调条 + hover 瞬时清除）", () => {
  it("选中行 = 淡底 + 左侧 2px 强调色条（::before，accent-brand）", () => {
    const bar = styles.match(/\.session\.active::before \{[^}]*\}/) ?? [""];
    expect(bar[0]).toContain("position: absolute");
    expect(bar[0]).toContain("width: 2px");
    expect(bar[0]).toContain("hsl(var(--accent-brand))");
  });

  it("hover 底色更淡（--alpha-hover vs --alpha-selected），且过渡只在 :hover 里（离开即瞬时清除）", () => {
    const hover = block(".session:hover");
    expect(hover).toContain("var(--alpha-hover)");
    expect(hover).toContain("transition:");
    expect(block(".session.active")).toContain("var(--alpha-selected)");
    // 基态无 background 过渡 ⇒ 离开 hover 立即回到底色（不拖尾）
    expect(block(".session")).not.toContain("transition: background");
  });

  it("文件夹行不参与选中态着色（data-active 的 g-folder 上色清零——「唯一选中态」）", () => {
    expect(styles).not.toContain('.group[data-active="true"] .g-folder');
  });

  it("设置入口唯一：收在头像菜单里，页脚不再另开一处（业主 2026-10-20 改口径）", () => {
    // 不变量没变：**同一个语义只许一处入口**（批 #128 同款：主页叠两个同名项目 chip）。
    // 变的是这一处在哪：2026-10-20 业主令「点击头像展示设置/外观/用量统计」⇒
    // 页脚那枚常驻「⚙ 设置」撤掉，设置入口收进头像菜单。
    const sidebar = readFileSync(new URL("../src/renderer/components/Sidebar.tsx", import.meta.url), "utf8");
    // 侧栏里有两处 Radix Content（会话行菜单 + 头像菜单）⇒ 用 pop-account 反查定位头像那一处。
    const accAt = sidebar.indexOf("pop-account");
    expect(accAt).toBeGreaterThan(-1);
    const dropStart = sidebar.lastIndexOf("<DropdownMenu.Content", accAt);
    expect(dropStart).toBeGreaterThan(-1);
    const drop = sidebar.slice(dropStart, sidebar.indexOf("</DropdownMenu.Content>", dropStart));
    expect(drop).toContain("STR.footer.about");
    // 头像菜单里就是设置入口（唯一那处）+ 外观 + 用量统计
    expect(drop).toContain("STR.footer.settings");
    expect(drop).toContain("STR.footer.appearance");
    expect(drop).toContain("STR.footer.usage");
    expect(drop).toContain("props.onOpenSettings()");
    // 菜单比通用浮层窄（不然贴着窗口左缘开——侧栏最窄 200px，220 宽的菜单会被裁）
    expect(drop).toContain("pop-account");
    // 页脚不再另开一个设置钮 ⇒ 不存在第二个入口
    expect(sidebar).not.toContain('className="foot-settings"');
    // 样式层也撤净（否则留一条没人用的死规则，读者会以为页脚仍有设置钮）
    const styles = readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
    expect(styles).not.toMatch(/\.foot-settings\s*\{/);
  });

  it("设置页顶栏与主界面一致：不覆盖 38px 标题栏、无 padding-top 空白带", () => {
    const page = block(".sp-page");
    expect(page).toContain("inset: 38px 0 0");
    expect(page).not.toContain("padding-top");
  });
});
