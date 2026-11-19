// 批 6 附带 #71（总纲阶段 3.5 侧边栏与导航）：侧栏「多项同时高亮」修复——
//   ① 选中态唯一：仅 .session.active 配淡底 + 字重（2026-10-28 第 735 页撤掉 2px 橙条，
//      暗色下它像红色警示轨；文件夹行仍不参与选中态着色）；
//   ② hover = 更淡底色，且过渡只写在 :hover 规则里 ⇒ 鼠标离开瞬时清除（无离开动画）；
//   ③ 设置页顶栏：.sp-page 不再覆盖 38px 标题栏（顶部让位，去 padding-top 空白带）。
// 真机复现（2026-10-16 隔离实例）：active 行 rgba(29,29,31,.1) 与 hover 行 rgba(29,29,31,.05) 同时在场。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readAppSurface } from "./helpers/app-surface";

const styles = readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
const filterCss = readFileSync(new URL("../src/renderer/components/sidebar-filter.css", import.meta.url), "utf8");
const filterMenuSource = readFileSync(new URL("../src/renderer/components/SessionFilterMenu.tsx", import.meta.url), "utf8");
function block(sel: string): string {
  const i = styles.indexOf(`\n${sel} {`);
  expect(i, sel).toBeGreaterThan(-1);
  return styles.slice(i, styles.indexOf("}", i));
}

describe("#71 侧栏选中态（唯一 + 强调条 + hover 瞬时清除）", () => {
  it("筛选浮层挂在漏斗按钮的锚点上（Radix popper 在这里退成 static）", () => {
    // 真机回归（2026-11-01）：Radix Content 在侧栏里退成 position:static，菜单跑到
    // 左缘 x=87 盖住项目名。契约：仓库自己的 Popover 基座 + `right:0` 贴按钮右缘。
    expect(filterMenuSource).toContain('<div className="side-filter-wrap" ref={boxRef}>');
    expect(filterMenuSource).toContain("<Popover");
    expect(filterMenuSource).toContain('className="side-filter-menu"');
    // 2026-11-02 审查补漏：自绘菜单必须自己承担方向键导航（Radix 原本提供，换实现后曾丢失）。
    expect(filterMenuSource).toContain("useMenuKeyboard(open, setOpen, boxRef)");
    expect(filterMenuSource).toContain("onMenuKeys(event)");
    expect(filterCss).toContain(".side-filter-wrap { position: relative");
    expect(filterCss).toContain(".side-filter-menu.down { top: calc(100% + 6px); left: auto; right: 0; }");
    expect(filterCss).toContain("width: 196px");
  });
  it("选中行只靠淡底 + 字重分层，不再挂品牌色左条（暗色下会被读成警示轨）", () => {
    expect(styles).not.toMatch(/\.session\.active::before\s*\{/);
    expect(block(".session.active")).toContain("var(--alpha-selected)");
  });

  it("New 主行是常驻高亮块（ADR 0019 1:1 换钉，官方首屏真机对照 2026-11-19）：不是描边 pill", () => {
    // 官方 New 行形制 = 常驻轻底的行（高亮块），不再是旧头部行的描边胶囊；
    // hover 加深一档（alpha-selected），同族行的 hover 仍是 alpha-hover。
    const rule = block('.app-rail-item[data-row="new"]');
    expect(rule).not.toContain("1px solid var(--hairline)");
    expect(rule).not.toContain("background: transparent");
    expect(rule).toContain("var(--alpha-hover)");
    expect(rule).toContain("hsl(var(--text-000))");
    expect(block('.app-rail-item[data-row="new"]:hover')).toContain("var(--alpha-selected)");
    expect(block(".app-rail-item:hover")).toContain("var(--alpha-hover)");
  });

  it("选中行保持既有淡底刻度，标题字重与项目间距承担层级", () => {
    const hover = block(".session:hover");
    expect(hover).toContain("var(--alpha-hover)");
    expect(hover).toContain("transition:");
    expect(block(".session.active")).toContain("var(--alpha-selected)");
    expect(styles).toMatch(/\.session\.active \.s-title\s*{[^}]*font-weight:\s*var\(--fw-medium\)/s);
    expect(block(".group-head")).toContain("margin-top: 16px");
    // 基态无 background 过渡 ⇒ 离开 hover 立即回到底色（不拖尾）
    expect(block(".session")).not.toContain("transition: background");
  });

  it("文件夹行不参与选中态着色（data-active 的 g-folder 上色清零——「唯一选中态」）", () => {
    expect(styles).not.toContain('.group[data-active="true"] .g-folder');
  });

  it("设置入口唯一：收在全局轨底部的头像菜单里（2026-11-03 业主改口径）", () => {
    // 不变量没变：**同一个语义只许一处入口**。2026-11-03 业主令「设置和偏好挪到左边底下，
    // 和插件他们是一个边框，底部图标是用户头像」⇒ 页脚整块撤掉，入口搬到 AccountMenu。
    const account = readFileSync(new URL("../src/renderer/components/AccountMenu.tsx", import.meta.url), "utf8");
    const accAt = account.indexOf("pop-account");
    expect(accAt).toBeGreaterThan(-1);
    const dropStart = account.lastIndexOf("<DropdownMenu.Content", accAt);
    expect(dropStart).toBeGreaterThan(-1);
    const drop = account.slice(dropStart, account.indexOf("</DropdownMenu.Content>", dropStart));
    expect(drop).toContain("STR.footer.about");
    expect(drop).toContain("STR.footer.settings");
    expect(drop).toContain("STR.footer.appearance");
    expect(drop).toContain("STR.footer.usage");
    expect(drop).toContain("props.onOpenSettings()");
    expect(drop).toContain("pop-account");
    // 侧栏不再有页脚入口，也没有第二个设置钮（读整个应用面：页脚入口搬到别的组件也算回潮）。
    const surface = readAppSurface();
    expect(surface).not.toContain("side-foot");
    expect(surface).not.toContain('className="foot-settings"');
    const styles = readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
    expect(styles).not.toMatch(/\.foot-settings\s*\{/);
  });

  it("设置页顶栏与主界面一致：不覆盖 38px 标题栏、无 padding-top 空白带", () => {
    const page = block(".sp-page");
    expect(page).toContain("inset: 38px 0 0");
    expect(page).not.toContain("padding-top");
  });
});
