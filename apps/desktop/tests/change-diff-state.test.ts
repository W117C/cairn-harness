// 变更 diff 状态机（2026-10-18 重构）：Inspector 与变更窗格共用一份懒加载。
// 此前两份实现都没有请求序号守卫——快速点 A 再点 B，A 的迟到响应会覆盖 B 的展开区。
// 判据三层：纯函数（diffCount / 守卫谓词）、双面接线（都用同一 hook，不再各自调 changeDiff）、
// 失败/折叠作废在飞响应（源码锚，node 环境没有 DOM 可驱动）。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { diffCount, isCurrentDiffRequest } from "../src/renderer/change-diff-state";
import type { DiffHunkView, DiffLineView } from "../../../src/main/change-diff";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const state = read("../src/renderer/change-diff-state.ts");
const inspector = read("../src/renderer/components/Inspector.tsx");
const dock = read("../src/renderer/components/PaneDock.tsx");
const css = read("../src/renderer/styles.css");

const line = (kind: DiffLineView["kind"]): DiffLineView => ({
  kind, text: "", oldNo: kind === "add" ? null : 1, newNo: kind === "del" ? null : 1,
});
const hunk = (lines: DiffLineView[]): DiffHunkView => ({ header: "@@ -1 +1 @@", lines });

describe("diffCount", () => {
  it("逐行数 add/del；context 不计；空 hunks = 0", () => {
    const hunks = [
      hunk([line("add"), line("add"), line("ctx")]),
      hunk([line("del"), line("add")]),
    ];
    expect(diffCount(hunks)).toEqual({ add: 3, del: 1 });
    expect(diffCount([])).toEqual({ add: 0, del: 0 });
  });
});

describe("请求守卫谓词", () => {
  it("只认发起时的序号；后来的请求让旧响应作废", () => {
    expect(isCurrentDiffRequest(1, 1)).toBe(true);
    expect(isCurrentDiffRequest(1, 2)).toBe(false);
    expect(isCurrentDiffRequest(2, 2)).toBe(true);
  });
});

describe("双面接线（唯一实现）", () => {
  it("Inspector 与变更窗格都走 useLazyChangeDiff；都不再自己调 changeDiff", () => {
    expect(state).toContain("export function useLazyChangeDiff");
    expect(inspector).toContain("useLazyChangeDiff()");
    expect(dock).toContain("useLazyChangeDiff()");
    expect(inspector).not.toContain(".changeDiff(");
    expect(dock).not.toContain(".changeDiff(");
  });

  it("序号守卫真的接在响应回写处；折叠/撤销会 ++ 作废在飞响应", () => {
    expect(state).toContain("isCurrentDiffRequest(seq, requestSeq.current)");
    expect(state).toContain("requestSeq.current += 1;");
    // 失败回执只有一处拼装（不再两处各写一遍）
    expect(state).toContain("通道无应答（主进程未返回差异数据）");
    expect(state.match(/通道无应答/g)?.length).toBe(1);
  });

  it("变更窗格的展开区也有 +n −m（与 Inspector 同一把尺），样式同源", () => {
    expect(dock).toContain('className="change-diff-stat num"');
    expect(css).toContain(".isp-diff-stat, .change-diff-stat {");
  });
});
