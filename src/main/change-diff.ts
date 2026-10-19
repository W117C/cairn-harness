// 变更审阅（桌面 diff 窗格的逐 hunk 数据面）：从 D7 覆盖前快照（`.agent/snapshots/`）与当前文件
// 生成行级差异。纯 Node、electron-free（headless 判卷）。
//
// 口径（宁可说不出，不编——与全仓的诚实纪律同款）：
//   · 快照在场 ⇒ 覆盖前原件；缺席且文件在场 ⇒ 新建（before 为空）；
//   · 二进制（含 NUL 字节）不展示差异，如实报原因；
//   · 单侧超字节帽先截、行数超帽再截，任一发生 truncated=true（永远不假装完整）；
//   · 路径过 resolveInWorkspace（越界即拒——审阅面不许成为任意读通道）；
//   · snapshotId 必须与 path 指向同一文件（形状 + 反解核对，防串文件）。
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { resolveInWorkspace, assertRealContainment, assertNotSensitivePathReal } from "../tools/base";
import { SNAPSHOT_ROOT, snapshotBeforeOverwrite } from "../tools/snapshot";

/** 单侧字节帽（512 KiB）：超过先截再比（truncated=true）。 */
export const MAX_SIDE_BYTES = 512 * 1024;
/** patch 行数帽：超过截断（truncated=true）。 */
export const MAX_PATCH_LINES = 4_000;
/** LCS 中间段保护：中段乘积超过此值退化为"整段替换"（大差异块不必逐行对齐）。 */
const LCS_CELL_CAP = 4_000_000;
/** hunk 上下文行数（与 git 默认同）。 */
const CONTEXT = 3;

export interface DiffLineView {
  kind: "ctx" | "add" | "del";
  text: string;
  /** 1-based 旧文件行号（add 行为 null）。 */
  oldNo: number | null;
  /** 1-based 新文件行号（del 行为 null）。 */
  newNo: number | null;
}

export interface DiffHunkView {
  /** "@@ -a,b +c,d @@"（b/d 为 0 时省略，与 unified 形同）。 */
  header: string;
  lines: DiffLineView[];
}

export type ChangeDiffPayload =
  | {
      ok: true;
      /** workspace 相对路径（与请求一致）。 */
      path: string;
      /** true = 新建（无覆盖前原件）；false = 修改（快照对照）。 */
      created: boolean;
      hunks: DiffHunkView[];
      truncated: boolean;
      bytes: { before: number; after: number };
    }
  | { ok: false; error: string };

/** 文本判定：含 NUL 视为二进制（与常见工具同口径）。 */
export function isTextish(buf: Buffer): boolean {
  return !buf.includes(0);
}

/** 按行切分（"a\nb\n" 与 "a\nb" 同形为两行；空内容为 []）。 */
export function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

type Edit = { kind: "ctx" | "del" | "add"; aIndex: number | null; bIndex: number | null };

/** 行级 LCS 编辑序列（前缀/后缀先剪；中段超保护退化整段替换；结果含两侧行号）。 */
function editScript(a: readonly string[], b: readonly string[]): Edit[] {
  // 公共前缀
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  // 公共后缀
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA -= 1; endB -= 1; }
  const out: Edit[] = [];
  for (let i = 0; i < start; i += 1) out.push({ kind: "ctx", aIndex: i, bIndex: i });
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  if (midA.length + midB.length > 0) {
    if (midA.length * midB.length > LCS_CELL_CAP) {
      // 保护退化：整段替换（不假装逐行对齐）。
      for (let i = 0; i < midA.length; i += 1) out.push({ kind: "del", aIndex: start + i, bIndex: null });
      for (let i = 0; i < midB.length; i += 1) out.push({ kind: "add", aIndex: null, bIndex: start + i });
    } else {
      const n = midA.length;
      const m = midB.length;
      // DP 表（(n+1)×(m+1) Int32；受 LCS_CELL_CAP 保护）。
      const w = m + 1;
      const dp = new Int32Array((n + 1) * w);
      for (let i = n - 1; i >= 0; i -= 1) {
        for (let j = m - 1; j >= 0; j -= 1) {
          dp[i * w + j] = midA[i] === midB[j]
            ? dp[(i + 1) * w + (j + 1)] + 1
            : Math.max(dp[(i + 1) * w + j], dp[i * w + (j + 1)]);
        }
      }
      let i = 0;
      let j = 0;
      while (i < n && j < m) {
        if (midA[i] === midB[j]) {
          out.push({ kind: "ctx", aIndex: start + i, bIndex: start + j });
          i += 1; j += 1;
        } else if (dp[(i + 1) * w + j] >= dp[i * w + (j + 1)]) {
          out.push({ kind: "del", aIndex: start + i, bIndex: null });
          i += 1;
        } else {
          out.push({ kind: "add", aIndex: null, bIndex: start + j });
          j += 1;
        }
      }
      while (i < n) { out.push({ kind: "del", aIndex: start + i, bIndex: null }); i += 1; }
      while (j < m) { out.push({ kind: "add", aIndex: null, bIndex: start + j }); j += 1; }
    }
  }
  // 公共后缀
  for (let k = 0; k < a.length - endA; k += 1) {
    out.push({ kind: "ctx", aIndex: endA + k, bIndex: endB + k });
  }
  return out;
}

/** 编辑序列 → hunks（上下文 CONTEXT 行；间隔超过 2×CONTEXT 拆 hunk）。 */
export function diffHunks(before: readonly string[], after: readonly string[]): DiffHunkView[] {
  const edits = editScript(before, after);
  const changed: number[] = [];
  edits.forEach((e, idx) => { if (e.kind !== "ctx") changed.push(idx); });
  if (changed.length === 0) return [];
  const hunks: DiffHunkView[] = [];
  let i = 0;
  while (i < changed.length) {
    const from = Math.max(0, changed[i]! - CONTEXT);
    let to = changed[i]!;
    while (i + 1 < changed.length && changed[i + 1]! - to <= 2 * CONTEXT) {
      i += 1;
      to = changed[i]!;
    }
    const until = Math.min(edits.length - 1, to + CONTEXT);
    const lines: DiffLineView[] = [];
    let oldStart: number | null = null;
    let newStart: number | null = null;
    let oldLen = 0;
    let newLen = 0;
    for (let k = from; k <= until; k += 1) {
      const e = edits[k]!;
      if (e.aIndex !== null && oldStart === null) oldStart = e.aIndex + 1;
      if (e.bIndex !== null && newStart === null) newStart = e.bIndex + 1;
      if (e.kind !== "add") oldLen += 1;
      if (e.kind !== "del") newLen += 1;
      lines.push({
        kind: e.kind,
        text: e.kind === "add" ? after[e.bIndex!]! : before[e.aIndex!]!,
        oldNo: e.aIndex === null ? null : e.aIndex + 1,
        newNo: e.bIndex === null ? null : e.bIndex + 1,
      });
    }
    const a0 = oldStart ?? 0;
    const b0 = newStart ?? 0;
    const header = `@@ -${String(a0)},${String(oldLen)} +${String(b0)},${String(newLen)} @@`;
    hunks.push({ header, lines });
    i += 1;
  }
  return hunks;
}

/** 读快照与当前文件，产出 structured hunks。路径越界/二进制/缺失都走 fail-visible。 */
export async function readChangeDiff(
  workspace: string,
  relPath: string,
  snapshotId?: string,
): Promise<ChangeDiffPayload> {
  let abs: string;
  try {
    abs = resolveInWorkspace(workspace, relPath, "change-diff");
    await assertRealContainment(workspace, abs, "change-diff");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  // 快照配对核对：形状 `<SNAPSHOT_ROOT>/<seg>/<rel>` 且反解出的 rel 必须与请求一致（防串文件）。
  let snapshotAbs: string | null = null;
  if (snapshotId !== undefined && snapshotId !== "") {
    const prefix = SNAPSHOT_ROOT + "/";
    const rest = snapshotId.startsWith(prefix) ? snapshotId.slice(prefix.length) : null;
    const at = rest === null ? -1 : rest.indexOf("/");
    const relBack = rest === null || at < 0 ? null : rest.slice(at + 1);
    if (relBack === null || relBack !== relPath) {
      return { ok: false, error: `快照与路径不配对（snapshotId=${snapshotId}，path=${relPath}）——拒绝张冠李戴` };
    }
    try {
      snapshotAbs = resolveInWorkspace(workspace, snapshotId, "change-diff@snapshot");
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  const readSide = async (p: string | null): Promise<{ buf: Buffer | null; missing: boolean }> => {
    if (p === null) return { buf: null, missing: true };
    try {
      return { buf: await readFile(p), missing: false };
    } catch {
      return { buf: null, missing: true };
    }
  };
  const beforeSide = await readSide(snapshotAbs);
  const afterSide = await readSide(abs);
  if (afterSide.missing) {
    return { ok: false, error: `当前文件不存在：${relPath}（可能已被删除——删除审阅待后续切片）` };
  }
  if (snapshotAbs !== null && beforeSide.missing) {
    // 快照声明在场但真读不到 ⇒「原件取不到」——绝不降级成"全新增"（那会把审阅读成假事实）。
    return { ok: false, error: "覆盖前快照不存在（可能已被清理）——无法展示真实差异" };
  }
  const beforeBuf = beforeSide.buf;
  const afterBuf = afterSide.buf!;
  if (!isTextish(afterBuf) || (beforeBuf !== null && !isTextish(beforeBuf))) {
    return { ok: false, error: "二进制文件不展示差异" };
  }
  let truncated = false;
  const cut = (b: Buffer): Buffer => {
    if (b.byteLength <= MAX_SIDE_BYTES) return b;
    truncated = true;
    return b.subarray(0, MAX_SIDE_BYTES);
  };
  const beforeText = beforeBuf === null ? "" : cut(beforeBuf).toString("utf8");
  const afterText = cut(afterBuf).toString("utf8");
  let hunks = diffHunks(splitLines(beforeText), splitLines(afterText));
  let lineCount = hunks.reduce((n, h) => n + h.lines.length, 0);
  if (lineCount > MAX_PATCH_LINES) {
    truncated = true;
    const kept: DiffHunkView[] = [];
    let used = 0;
    for (const h of hunks) {
      const remain = MAX_PATCH_LINES - used;
      if (remain <= 0) break;
      if (h.lines.length <= remain) {
        kept.push(h);
        used += h.lines.length;
        continue;
      }
      // 单个 hunk 自己就超帽（真机：600 KiB 新建文件 ⇒ 一个 1.4 万行的 hunk）。
      // 旧实现 `break` 把整块丢掉 ⇒ hunks=[]，DiffView 对用户说「没有差异（与快照逐行一致）」——
      // 与事实相反。保留前缀并在 header 标「截断」，让用户看见差异方向；完整内容用本地工具。
      const lines = h.lines.slice(0, remain);
      kept.push({ header: `${h.header}（截断）`, lines });
      used += lines.length;
      break;
    }
    hunks = kept;
  }
  return {
    ok: true,
    path: relPath,
    created: snapshotAbs === null,
    hunks,
    truncated,
    bytes: { before: beforeBuf?.byteLength ?? 0, after: afterBuf.byteLength },
  };
}

/** v11：把覆盖前快照还原回目标文件（检查器「撤销此文件改动」）。
 *  写前先对当前版本拍一张新快照（best-effort，纪律同 snapshotBeforeOverwrite——护栏缺位不改写主路径结论），
 *  撤销本身因此可再撤销。路径与快照配对校验与 readChangeDiff 完全同口径（越界即拒、防串文件）。 */
export async function restoreSnapshot(
  workspace: string,
  relPath: string,
  snapshotId: string,
): Promise<{ ok: boolean; error?: string }> {
  let abs: string;
  try {
    abs = resolveInWorkspace(workspace, relPath, "snapshot-restore");
    await assertRealContainment(workspace, abs, "snapshot-restore");
    await assertNotSensitivePathReal(workspace, abs, "snapshot-restore"); // 软链别名落到 .git/hooks/.env 等
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  // 配对核对（与 readChangeDiff 逐字同式）：快照反解出的 rel 必须与请求一致。
  const prefix = SNAPSHOT_ROOT + "/";
  const rest = snapshotId.startsWith(prefix) ? snapshotId.slice(prefix.length) : null;
  const at = rest === null ? -1 : rest.indexOf("/");
  const relBack = rest === null || at < 0 ? null : rest.slice(at + 1);
  if (relBack === null || relBack !== relPath) {
    return { ok: false, error: `快照与路径不配对（snapshotId=${snapshotId}，path=${relPath}）——拒绝张冠李戴` };
  }
  let snapshotAbs: string;
  try {
    snapshotAbs = resolveInWorkspace(workspace, snapshotId, "snapshot-restore@snapshot");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  const bytes = await readFile(snapshotAbs).catch(() => null);
  if (bytes === null) return { ok: false, error: "覆盖前快照不存在（可能已被清理）——无法还原" };
  // 写前给当前版本留一张新快照（还原可再撤销）；文件不在场（曾被删除后重建的场景）自然跳过。
  await snapshotBeforeOverwrite(workspace, abs, relPath, "undo");
  try {
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, bytes);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
