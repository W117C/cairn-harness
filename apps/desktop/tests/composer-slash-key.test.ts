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

  it("高亮落在当前项；菜单项仍可点击", () => {
    expect(src).toContain('className={"menu-item" + (idx === Math.min(slashActive, slashHits.length - 1) ? " on" : "")}');
    expect(src).toContain("onClick={() => { chooseSlash(s); }}");
    expect(css).toMatch(/\.slash-menu \.menu-item\.on\s*{[^}]*background:/s);
  });
});
