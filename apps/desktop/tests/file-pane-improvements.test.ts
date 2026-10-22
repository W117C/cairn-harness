// 文件窗格可恢复性判卷（2026-10-21）：
// 异步请求归属、目录截断如实提示、目录/预览失败可原地重试、目录展开态与文件选中态可读。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readAppSurface } from "./helpers/app-surface";

const src = readAppSurface();
const css = readFileSync(join(__dirname, "..", "src", "renderer", "styles.css"), "utf8");

describe("文件窗格可恢复性", () => {
  it("目录与预览都有请求归属，旧响应不能覆盖新请求", () => {
    expect(src).toContain("const dirSeq = useRef(new Map<string, number>());");
    expect(src).toContain("const previewSeq = useRef(0);");
    expect(src.match(/if \(dirSeq\.current\.get\(rel\) !== seq\) return;/g)?.length).toBe(2);
    expect(src.match(/if \(previewSeq\.current !== seq\) return;/g)?.length).toBe(2);
  });

  it("目录截断如实提示，不静默丢项", () => {
    expect(src).toContain("node.truncated &&");
    expect(src).toContain("目录过大，已截断：只显示前");
  });

  it("目录/预览失败都有原地重试按钮", () => {
    expect(src.match(/className="mini-btn"/g)?.length).toBeGreaterThanOrEqual(2);
    expect(src).toContain("onClick={() => { loadDir(rel); }}");
    expect(src).toContain("onClick={() => { openFile(preview.path); }}");
  });

  it("目录展开态与文件选中态有 aria 表达，预览显示完整路径", () => {
    expect(src).toContain('role="tree"');
    expect(src).toContain('role="treeitem"');
    expect(src).toContain("aria-expanded={open}");
    expect(src).toContain("aria-selected={preview?.path === p}");
    expect(src).toContain('className="fp-preview-path"');
    expect(css).toContain(".fp-preview-path");
  });

  it("键盘树：上下/首尾/左右/Enter 路径都在", () => {
    expect(src).toContain("const onTreeKeyDown");
    expect(src).toContain('e.key === "ArrowDown"');
    expect(src).toContain('e.key === "ArrowUp"');
    expect(src).toContain('e.key === "Home"');
    expect(src).toContain('e.key === "End"');
    expect(src).toContain('e.key === "ArrowRight"');
    expect(src).toContain('e.key === "ArrowLeft"');
    expect(src).toContain("data-kind=\"dir\"");
    expect(src).toContain("tabIndex={focusPath === p");
  });
});
