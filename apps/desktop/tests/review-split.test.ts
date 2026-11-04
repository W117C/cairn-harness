// 分栏审阅器判卷（2026-10-28 第 762 页 · 对标 Codex / Claude 的改审阅）
//
// 现状核对（第 761 页）之后落的这一批：变更窗格从「单列手风琴（轮 → 文件 → diff 内联）」
// 改成「**左文件列表 + 右差异**」——Codex / Claude 的改审阅都是这个读法：
// 一屏看见「改了哪些文件」与「这个文件改了什么」。
//
// 判卷钉五件事：
//   ① 分栏结构在（左列表 + 右差异），且左列仍是**按轮折叠**（23 轮全摊开会塞满窗格）；
//   ② 文件行带**动作徽标**（徽标要有文字：a11y 条，不许只靠颜色）；
//   ③ **选中才取差异**：不许预取整会话的全部 diff（既有设计：点开才读快照）；
//   ④ 多条评注的 ⌘Enter 一次性提交**不许退化**（那是 §3.6 明写的条款）；
//   ⑤ 窄容器退成单列（窗格被拖窄时不能硬塞两栏）。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readAppSurface } from "./helpers/app-surface";

// 2026-11-03：变更窗格本体已从 PaneDock 抽至 ChangesPane.tsx（行帽拆分批），判卷锚跟着走。
const src = readFileSync(fileURLToPath(new URL("../src/renderer/components/ChangesPane.tsx", import.meta.url)), "utf8");
const css = readFileSync(fileURLToPath(new URL("../src/renderer/styles.css", import.meta.url)), "utf8");

describe("变更窗格 · 分栏审阅器", () => {
  it("① 左右两栏：左＝文件列表，右＝差异", () => {
    expect(src).toContain('className="pane-list review-files"');
    expect(src).toContain('className="review-diff"');
    expect(src).toContain('className="review-cols"');
    // 左列仍是按轮折叠的手风琴（既有判卷 changes-pane-accordion 钉着它，不许退化成全摊开）
    expect(src).toContain("{openRound === t.round && (");
  });

  it("② 文件行带动作徽标（文字，不只靠颜色）", () => {
    expect(src).toContain('className={"act " + f.change}');
    // 第 942 页：三个词收进 derived/change-labels.ts（单一表），这里钉「徽标仍是文字」。
    expect(src).toContain("changeLabel(f.change)");
  });

  it("③ 选中才取差异：不预取整会话的全部 diff", () => {
    // 取差异只发生在点击某个文件时（toggle 带 path + snapshotId）
    expect(src).toContain("toggle(key, f.path, f.snapshotId)");
    // 渲染差异的地方只在右栏，且只在选中时
    expect(src).toContain("selected === null ? (");
    expect(src).toContain("diff.payload.hunks");
    // 不许出现「一轮全取」的入口（那会把长会话一次拉爆）
    expect(src).not.toMatch(/files\.map\([^)]*\)\s*\.map\([^)]*changeDiff/);
  });

  it("④ 多条评注 ⌘Enter 一次性提交不许退化", () => {
    expect(src).toContain("条评注待提交");
    expect(src).toContain("提交评论（⌘Enter）");
    expect(src).toContain('e.key === "Enter" && (e.metaKey || e.ctrlKey)');
    // 评注按文件路径分键（多文件各评各的，不会串）
    expect(src).toContain("keyPrefix: `${selected.file.path}|`");
  });

  it("⑤ 窄容器退成单列（窗格被拖窄时不硬塞两栏）", () => {
    expect(css).toContain(".review-cols { display: grid; grid-template-columns: minmax(190px, 260px) minmax(0, 1fr);");
    expect(css).toMatch(/@container \(max-width: 620px\)\s*\{[^}]*\.review-cols \{ grid-template-columns: minmax\(0, 1fr\);/);
    expect(css).toContain("container-type: inline-size");
  });

  it("⑥ 接线面：右栏拿的是选中文件的差异（读整个渲染层，不读单文件）", () => {
    const surface = readAppSurface();
    expect(surface).toContain("const selected = (() => {");
    // 右栏的标题用选中文件的路径与动作徽标
    expect(surface).toContain("selected.file.path");
  });
});
