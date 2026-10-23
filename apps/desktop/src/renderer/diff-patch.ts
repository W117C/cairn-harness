// 统一 diff（git `worktreeDiff` 的 patch）→ DiffView 的 hunk 视图（纯函数，可单测）。
//
// 作用：worker 改动预览原本把整段 patch 塞进 <pre>；这里只做**解析**，渲染仍交给既有
// DiffView（色盲冗余、行号、截断语义都在那一处）。解析不出来的输入返回 []，调用方回落原文，
// 绝不把「没解析」说成「没有差异」。
import type { DiffHunkView } from "../../../../src/main/change-diff";

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/u;

/** worker diff 预览的 UI 帽：core 侧 worktreeDiff 允许到 32MB，整段进 DOM/解析会把渲染层卡死。
 *  200k 字符足够看多数改动；超帽只截显示，**不假装完整**（界面必须标 truncated）。 */
export const DIFF_VIEW_CHAR_CAP = 200_000;
export function clipDiff(text: string, cap = DIFF_VIEW_CHAR_CAP): { text: string; truncated: boolean } {
  if (text.length <= cap) return { text, truncated: false };
  return { text: text.slice(0, cap), truncated: true };
}

export function parseUnifiedPatch(patch: string): DiffHunkView[] {
  const out: DiffHunkView[] = [];
  let cur: DiffHunkView | null = null;
  let oldNo = 0;
  let newNo = 0;
  for (const raw of patch.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    const m = HUNK.exec(line);
    if (m !== null) {
      cur = { header: line, lines: [] };
      out.push(cur);
      oldNo = Number(m[1]);
      newNo = Number(m[3]);
      continue;
    }
    if (cur === null) continue; // 文件头（diff --git / --- / +++ / index）不进 hunk
    if (line.startsWith("\\ No newline")) continue;
    if (line.startsWith("+")) {
      cur.lines.push({ kind: "add", text: line.slice(1), oldNo: null, newNo: newNo++ });
      continue;
    }
    if (line.startsWith("-")) {
      cur.lines.push({ kind: "del", text: line.slice(1), oldNo: oldNo++, newNo: null });
      continue;
    }
    if (line.startsWith(" ")) {
      cur.lines.push({ kind: "ctx", text: line.slice(1), oldNo: oldNo++, newNo: newNo++ });
    }
  }
  return out;
}
