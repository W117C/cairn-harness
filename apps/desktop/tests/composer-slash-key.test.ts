// 斜杠菜单键盘导航（2026-10-18）：此前只能鼠标点；↑↓ 没有选中态，Enter 会把 "/x" 原样发出去。
// 现在：↑↓ 移动高亮，⏎/Tab 填入并保留焦点；查询变化重置高亮；Esc 仍关闭（上批）。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = readFileSync(fileURLToPath(new URL("../src/renderer/components/Composer.tsx", import.meta.url)), "utf8");
const css = readFileSync(fileURLToPath(new URL("../src/renderer/styles.css", import.meta.url)), "utf8");

describe("斜杠菜单键盘导航", () => {
  it("↑↓ 改变 active；查询变化重置；⏎/Tab 走 chooseSlash", () => {
    expect(src).toContain("const [slashActive, setSlashActive] = useState(0);");
    expect(src).toContain("useEffect(() => { setSlashActive(0); }, [slashQuery]);");
    expect(src).toContain("setSlashActive((i) => (i + 1) % slashHits.length)");
    expect(src).toContain("setSlashActive((i) => (i - 1 + slashHits.length) % slashHits.length)");
    expect(src).toContain("chooseSlash(slashHits[Math.min(slashActive, slashHits.length - 1)]!)");
    expect(src).toContain("const chooseSlash = (item: { invoke: string; desc: string }): void => {");
  });

  it("长描述不撑高菜单：单行截断 + 内滚 + 高亮跟手（2026-10-24）", () => {
    expect(src).toContain("const slashMenuRef = useRef<HTMLDivElement | null>(null);");
    expect(src).toContain('className="slash-menu pop show"');
    // 贴哪边按输入卡上下实测空间定（首页空屏在屏幕中部，向上开会顶出窗）
    expect(src).toContain("const down = below > above;");
    expect(src).toContain('menu.classList.toggle("down", down)');
    expect(css).toMatch(/\.slash-menu\.down\s*{[^}]*top:\s*calc\(100% \+ 6px\)/s);
    expect(css).toMatch(/\.slash-menu\s*{[^}]*max-height:\s*min\(480px,\s*62vh\)[^}]*overflow-y:\s*auto/s);
    expect(css).toMatch(/\.slash-menu \.menu-item \.sub\s*{[^}]*white-space:\s*nowrap[^}]*text-overflow:\s*ellipsis/s);
    expect(css).toMatch(/\.slash-menu \.menu-item > span:first-child\s*{[^}]*text-overflow:\s*ellipsis/s);
  });

  it("待批准标记不进描述、钉在行尾（截断也看得见）", () => {
    expect(src).toContain("s.trust !== undefined && s.trust !== \"trusted\"");
    expect(src).toContain('className="si-trust"');
    expect(css).toMatch(/\.slash-menu \.si-trust\s*{[^}]*flex:\s*none/s);
  });

  it("高亮落在当前项；菜单项仍可点击", () => {
    expect(src).toContain('className={"menu-item" + (idx === Math.min(slashActive, slashHits.length - 1) ? " on" : "")}');
    expect(src).toContain("onClick={() => { chooseSlash(s); }}");
    expect(css).toMatch(/\.slash-menu \.menu-item\.on\s*{[^}]*background:/s);
  });
});
