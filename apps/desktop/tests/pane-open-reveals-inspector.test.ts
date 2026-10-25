// 「开窗格 ⇒ 右栏可见 + 检查器内容让位」判卷（2026-10-24 业主：单窗格占满整条侧栏）。
//
// 旧行为（2026-10-18）：开窗格要 revealInspector() 展开检查器列——当时窗格渲染在检查器
// 下半区，不展开就落在 width 0 的列里。
// 新行为：PaneDock 单窗格占满后，reveal 的职责变成「保证右栏本身可见」（四条开窗格路径
// 保留 revealInspector）；栏内的检查器内容（.isp）由 data-panes-open 隐藏，窗格独占
// 整条侧栏；全关后内容回位。⌘⌥I 的整栏开合语义不变。
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

describe("开窗格的路径都要 reveal 右栏；栏内检查器内容让位", () => {
  it("requestPickElement（⌘⇧S）加 browser 且 reveal", () => {
    const body = bodyOf(appSrc, "const requestPickElement = useCallback");
    expect(body).toContain('"browser"');
    expect(body).toContain("revealInspector()");
  });

  it("openPreview（预览就绪）加 browser 且 reveal（经 ref，TDZ 同解法）", () => {
    const body = bodyOf(appSrc, "const openPreview = useCallback");
    expect(body).toContain('"browser"');
    expect(body).toContain("revealInspectorRef.current?.()");
  });

  it("togglePane / openPane 保持 reveal（不倒退）", () => {
    const toggle = bodyOf(appSrc, "const togglePane = useCallback");
    const open = bodyOf(appSrc, "const openPane = useCallback");
    expect(toggle).toContain("revealInspector()");
    expect(open).toContain("revealInspector()");
  });

  it("让位开关：panesOpen 时 inspector-col 挂 data-panes-open，CSS 隐藏 .isp 让窗格占满", () => {
    expect(appSrc).toContain('data-panes-open');
    const css = readFileSync(fileURLToPath(new URL("../src/renderer/styles.css", import.meta.url)), "utf8");
    expect(css).toMatch(/\.inspector-col\[data-panes-open="true"\] \.isp\s*{\s*display: none;/);
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
