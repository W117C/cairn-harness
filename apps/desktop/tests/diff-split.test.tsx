// R4 Diff 分屏判卷（2026-10-31）：open-claude-ui StreamingDiffViewer 的 unified/split 双模式。
// 配对是纯函数；SSR 只验 DOM 契约；既有 unified 判卷（panes-structure）继续保管默认路径。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DiffView, splitDiffRows } from "../src/renderer/components/DiffView";
import type { DiffHunkView, DiffLineView } from "../../../src/main/change-diff";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const ctx = (text: string, oldNo: number, newNo: number): DiffLineView => ({ kind: "ctx", text, oldNo, newNo });
const del = (text: string, oldNo: number): DiffLineView => ({ kind: "del", text, oldNo, newNo: null });
const add = (text: string, newNo: number): DiffLineView => ({ kind: "add", text, oldNo: null, newNo });

describe("splitDiffRows：unified → 并排配对", () => {
  it("context 两侧同置", () => {
    const rows = splitDiffRows([ctx("a", 1, 1)]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ left: ctx("a", 1, 1), right: ctx("a", 1, 1) });
  });

  it("del 块与紧随的 add 块逐行配对；多出的一侧留空", () => {
    const rows = splitDiffRows([del("old-1", 2), del("old-2", 3), add("new-1", 2), add("new-2", 3), add("new-3", 4)]);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ left: del("old-1", 2), right: add("new-1", 2) });
    expect(rows[1]).toEqual({ left: del("old-2", 3), right: add("new-2", 3) });
    expect(rows[2]).toEqual({ right: add("new-3", 4) });
  });

  it("只有 add 的块左栏空；del 后没有 add 时右栏空", () => {
    expect(splitDiffRows([add("new", 1)])).toEqual([{ right: add("new", 1) }]);
    expect(splitDiffRows([del("old", 1)])).toEqual([{ left: del("old", 1) }]);
  });
});

describe("DiffView：默认统一，显式并排", () => {
  const hunks: DiffHunkView[] = [{
    header: "@@ -1,3 +1,4 @@",
    lines: [ctx("const a = 1;", 1, 1), del("let b = 2;", 2), add("let b = 3;", 2), add("let c = 4;", 3)],
  }];

  it("缺省仍是 unified（既有判卷路径不变）", () => {
    const html = renderToStaticMarkup(<DiffView hunks={hunks} />);
    expect(html).toContain('data-view="unified"');
    expect(html).toContain("diff-line del");
    expect(html).not.toContain("diff-split-row");
  });

  it("initialView=split：双栏、hunk 头、增删符号与行号都在", () => {
    const html = renderToStaticMarkup(<DiffView hunks={hunks} initialView="split" />);
    expect(html).toContain('data-view="split"');
    expect(html).toContain("diff-split-row");
    expect(html).toContain("diff-cell del");
    expect(html).toContain("diff-cell add");
    expect(html).toContain(">−<");
    expect(html).toContain(">+<");
    expect(html).toContain("@@ -1,3 +1,4 @@");
    expect(html).toContain('aria-pressed="true"');
  });

  it("并排里删除行不给评注入口；新增行可评", () => {
    const html = renderToStaticMarkup(
      <DiffView
        hunks={hunks}
        initialView="split"
        comment={{ comments: new Map(), keyPrefix: "a.ts|", onComment: () => undefined }}
      />,
    );
    // 右栏 = ctx(1) + add(2) + add(3) 三个入口；左栏的 del 行不重复给入口。
    expect(html).toContain("评论第 1 行");
    expect(html).toContain("评论第 2 行");
    expect(html).toContain("评论第 3 行");
    expect((html.match(/dl-comment/g) ?? []).length).toBe(3);
  });
});

describe("DiffView：样式契约", () => {
  const css = read("../src/renderer/styles.css");
  it("两栏 grid、增删底色、窄容器横向滚动", () => {
    expect(css).toMatch(/\.diff-split-row\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\)/s);
    expect(css).toContain(".diff-cell.add");
    expect(css).toContain(".diff-cell.del");
    expect(css).toContain("@container (max-width: 640px)");
  });
});

describe("行级评注的揭示纪律与图标族（2026-11-01 第 875 页）", () => {
  const css = read("../src/renderer/styles.css");
  const rendererDir = fileURLToPath(new URL("../src/renderer", import.meta.url));
  /** 渲染层源码面（排除 vendor 与注释）：emoji 哨兵读面不读单文件。 */
  function renderSurface(): string {
    const out: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir).sort()) {
        if (name === "vendor" || name === "node_modules" || name === "dist" || name === "dist-electron") continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) { walk(full); continue; }
        if (!/\.(tsx?|ts)$/.test(name)) continue;
        let src = readFileSync(full, "utf8");
        src = src.replace(/\/\*[\s\S]*?\*\//g, "");
        src = src.split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
        out.push(src);
      }
    };
    walk(rendererDir);
    return out.join("\n");
  }

  it("隐藏态不吃指针，且键盘聚焦必须现形（与 .row-actions 同一纪律）", () => {
    const base = css.match(/\.dl-actions\s*\{[^}]*\}/)?.[0] ?? "";
    expect(base).not.toBe("");
    expect(base).toContain("opacity: 0");
    expect(base, "opacity:0 却仍可点 = 幽灵点击").toContain("pointer-events: none");
    const reveal = css.match(/\.diff-line:hover \.dl-actions[^{]*\{[^}]*\}/)?.[0] ?? "";
    expect(reveal, "揭示规则必须同时给键盘一条路（:focus-within）").toContain(":focus-within");
    expect(reveal).toContain("pointer-events: auto");
    // 反向自证：把 focus-within 摘掉，本判卷必须红
    expect(reveal.replace(":focus-within", ":hover-x")).not.toContain(":focus-within");
  });

  it("已评注标记常驻：在 .dl-actions 之外，且不靠色相", () => {
    const marked = css.match(/\.dl-has-comment\s*\{[^}]*\}/)?.[0] ?? "";
    expect(marked, "常驻标记不许挂在 hover 组里").not.toBe("");
    expect(marked).not.toMatch(/opacity:\s*0/);
    expect(marked).toContain("hsl(var(--text-300))");
    const hover = css.match(/\.dl-comment:hover\s*\{[^}]*\}/)?.[0] ?? "";
    expect(hover, "悬停强调走中性对比，不走品牌色相").not.toContain("accent-brand");
  });

  it("标记不是 emoji：与全应用 lucide 图标族一致（图形区 emoji 在渲染面为 0）", () => {
    // 注释里允许写下被换掉的那枚字形（本批改动的说明），所以判**去注释后的代码面**。
    const src = read("../src/renderer/components/DiffView.tsx")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
    expect(src, "评注标记不许再用 emoji").not.toContain("\u{1F4AC}");
    expect(src).toContain("MessageSquare");
    const pict = renderSurface().match(/[\u{1F000}-\u{1FAFF}\uFE0F]/gu) ?? [];
    expect([...new Set(pict)], "渲染面出现图形 emoji：" + [...new Set(pict)].join(" ")).toEqual([]);
  });
});

describe("行级评注的行键带哪一侧（第 922 页）", () => {
  const commentHunks: DiffHunkView[] = [{
    header: "@@ -1,3 +1,4 @@",
    lines: [ctx("const a = 1;", 1, 1), del("let b = 2;", 2), add("let b = 3;", 2)],
  }];
  const render = (comments: Map<string, string>): string =>
    renderToStaticMarkup(
      <DiffView hunks={commentHunks} comment={{ comments, keyPrefix: "src/a.ts|", onComment: () => undefined }} />,
    );
  const segOf = (html: string, text: string): string =>
    html.split('<div class="diff-line ').find((s) => s.includes(text)) ?? "";

  it("删除行与新增行同号不共用一把键：old:2 只挂删除行", () => {
    const html = render(new Map([["src/a.ts|old:2", "这段删掉"]]));
    expect((html.match(/dl-has-comment/g) ?? []).length).toBe(1);
    expect(segOf(html, "let b = 2;")).toContain("dl-has-comment");
    expect(segOf(html, "let b = 3;")).not.toContain("dl-has-comment");
  });

  it("两侧各一条时两条都在（不再互相覆盖）", () => {
    const html = render(new Map([["src/a.ts|old:2", "这段删掉"], ["src/a.ts|new:2", "这行改名"]]));
    expect((html.match(/dl-has-comment/g) ?? []).length).toBe(2);
  });
});
