// 「开窗格必须同时展开检查器」判卷（2026-10-18 修的真 bug）。
//
// 缺陷：⌘⇧S（浏览器：选择页面元素）与预览启动这两条路径会往 paneTabs 里加 "browser"，
// 但**没有调 revealInspector()**。而检查器默认收起（inspectorCollapsed 初值 true，
// paneTabs 为 0 时 layoutEffect 也保持收起），PaneDock 又渲染在那个 collapsedSize={0}
// 且 inert 的列里 ⇒ 新开的浏览器窗格宽度 0、不可见、不可交互。
// 用户按 ⌘⇧S 什么也看不见；pick 的失败回执（「本标签页还没有视图」）只渲染在
// 那个不可见窗格内部，连错都看不到。速查表承诺「结果进输入框」，完全落空。
// 对照组：togglePane / openPane 都有 `if (opening) revealInspector()`，这两条漏了。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readAppSurface } from "./helpers/app-surface";

const appSrc = readAppSurface();

/** 抽出某个 useCallback 的函数体（按函数名定位到配平的花括号）。 */
function bodyOf(src: string, decl: string): string {
  const at = src.indexOf(decl);
  if (at === -1) return "";
  const open = src.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return "";
}

describe("开窗格的路径都要展开检查器", () => {
  it("requestPickElement（⌘⇧S）加 browser 后必须 revealInspector", () => {
    const body = bodyOf(appSrc, "const requestPickElement = useCallback");
    expect(body).toContain('"browser"');
    expect(body).toContain("revealInspector()");
  });

  it("openPreview（预览就绪）加 browser 后必须展开检查器", () => {
    const body = bodyOf(appSrc, "const openPreview = useCallback");
    expect(body).toContain('"browser"');
    // 经 ref 调用（revealInspector 在下方声明，TDZ）——与 newSessionRef 同一解法
    expect(body).toContain("revealInspectorRef.current?.()");
  });

  it("togglePane / openPane 两条既有路径保持展开（不倒退）", () => {
    const toggle = bodyOf(appSrc, "const togglePane = useCallback");
    const open = bodyOf(appSrc, "const openPane = useCallback");
    expect(toggle).toContain("revealInspector()");
    expect(open).toContain("revealInspector()");
  });

  it("四条开窗格路径都记打开顺序（⌘\ 靠它找「最近打开」）", () => {
    for (const decl of ["const togglePane = useCallback", "const openPane = useCallback", "const requestPickElement = useCallback", "const openPreview = useCallback"]) {
      expect(bodyOf(appSrc, decl)).toContain("notePaneOpened(");
    }
  });

  it("⌘\\ 无可关窗格时不吞键（空窗格时按了要让键继续外传）", () => {
    const at = appSrc.indexOf('case "Backslash"');
    expect(at).toBeGreaterThan(-1);
    const seg = appSrc.slice(at, appSrc.indexOf("case \"Semicolon\"", at));
    expect(seg).toContain("h.closeLastPane()");
    // preventDefault 必须在「确实关掉了」的分支里，不能无条件执行
    expect(seg).toContain("if (h.closeLastPane()) e.preventDefault();");
    expect(seg).not.toContain("e.preventDefault(); setPaneTabs((tabs) => tabs.slice(0, -1))");
  });
});
