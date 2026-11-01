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

  it("文件大小走共享字节尺（2.1 KB / 880 B），不摆裸字节数", () => {
    // 第 943 页：`{e.size}` 直接摆 2140，与附件行的 2.1 KB（第 924 页统一的那把尺）两种写法。
    expect(src).toContain('{formatBytes(e.size) ?? "—"}');
    expect(src).not.toContain("{e.size}");
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

// 预览列空态（2026-11-01 第 902 页）：全应用 9 个窗格空态都走 .pane-empty（居中、--space-lg 起），
// 只有这里用贴在左上角的 .fp-note 灰字 + 一句命令式 + 括号里的政策复述。
describe("预览列空态走窗格共用语法", () => {
  it("空态用 .pane-empty，旧的左上角灰字句不回潮", () => {
    expect(src).toContain('<div className="pane-empty">左边选一个文件，这里看内容。');
    for (const gone of ["点文件预览（只读；写入由 agent 走审批）", 'className="fp-note">点文件预览']) {
      expect(src, `这句该留在历史里，不该回到屏上：${gone}`).not.toContain(gone);
    }
  });

  it("只读事实说一句：空态讲一次，打开后由 .fp-readonly 常驻标承担", () => {
    // 空态里出现「只读」一次；预览头部那枚常驻标也还在（两处不同时在场）。
    const emptyNote = src.match(/className="pane-empty">([\s\S]*?)<\/div>/)?.[1] ?? "";
    expect(emptyNote.includes("只读")).toBe(true);
    expect(src).toContain('<span className="fp-readonly">只读</span>');
    expect((src.match(/预览只读/g) ?? []).length).toBe(1);
  });

  it("居中规则只在空态命中，且不许把首行顶出可滚范围", () => {
    const rule = css.match(/\.file-preview:has\(\> \.pane-empty\)\s*\{([^}]*)\}/);
    expect(rule, "预览列没有针对空态的居中规则").toBeTruthy();
    expect(rule![1]).toContain("align-content: safe center");
    // 反向自证：钉的是 :has(> .pane-empty) 而不是整列——常态块流不许被动。
    expect(rule![0]).toContain(":has(> .pane-empty)");
  });
});
