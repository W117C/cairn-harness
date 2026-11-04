// 浏览器窗格放大交互与菜单遮挡的接线判卷（2026-11-03 业主）：
//   「这个侧边栏有问题，然后没有放大，我需要加一个放大交互，然后把对话框覆盖掉」
//   「菜单只剩一条」的根因是原生 WebContentsView 永远压在 DOM 之上（见 PaneDock 的 boundsSync
//   注释），DOM 菜单 z-index 再高也盖不过它 ⇒ 菜单展开期间必须把视图收成零矩形。
//
// 本仓桌面端没有 jsdom，这段是**接线哨兵**：行为证据由真 renderer 探针（Electron）另行给出，
// 这里只钉住「放大的三个结构件都在、菜单让位那条线没被删」。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const src = read("../src/renderer/components/PaneDock.tsx");
const styles = read("../src/renderer/styles.css");

describe("浏览器窗格放大（2026-11-03 业主）", () => {
  it("放大态挂在 pane-workbench 上，CSS 是覆盖工作区的 fixed 层（盖住对话）", () => {
    expect(src).toContain('data-maximized={maximized ? "true" : "false"}');
    const rule = styles.match(/\.pane-workbench\[data-maximized="true"\]\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(rule).toContain("position: fixed");
    expect(rule).toContain("top: 38px"); // 标题栏之下；标题栏仍可拖动/关窗
    expect(rule).toContain("left: var(--pane-max-left, 0px)"); // 只盖中间对话、保留左栏
    expect(rule).toContain("z-index: 2000");
    expect(rule).toContain("background: hsl(var(--bg-100))");
  });

  it("工具栏有放大/还原钮，且只有一个状态源（PaneDock 持有 maximized）", () => {
    expect(src).toContain('"还原浏览器窗格" : "放大浏览器窗格"');
    expect(src).toContain("<Maximize2 size={13} />");
    expect(src).toContain("<Minimize2 size={13} />");
    expect(src).toContain("const [maximized, setMaximized] = useState(false)");
    expect(src).toContain('if (active !== "browser" && maximized) setMaximized(false)');
    expect(src).toContain('if (e.key === "Escape")');
    // 左边界按中心列的真实矩形量（量法在 use-maximized-left hook 里），侧栏拖宽/收起/窗口缩放都要重新贴合。
    const maxHook = read("../src/renderer/components/use-maximized-left.ts");
    expect(maxHook).toContain('data-dsh-claude-part="center-column"');
    expect(maxHook).toContain("setMaxLeft(Math.round(main.getBoundingClientRect().left))");
    expect(src).toContain('"--pane-max-left": `${maxLeft}px`');
  });

  it("浏览器菜单展开时原生视图让位（否则菜单只剩工具栏下一条）", () => {
    expect(src).toContain("onOpenChange={setMenuOpen}");
    expect(src).toContain("if (menuOpen) hideAllViews();");
    expect(src).toContain("else boundsSync();");
  });
});
