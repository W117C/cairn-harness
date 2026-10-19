// 工作区只读文件通道（file 窗格的数据面）：列目录 + 读文本。
// 纯 Node、electron-free（headless 判卷）。
//
// 口径（与 change-diff 同款：宁可说不出，不编）：
//   · 路径全部过 resolveInWorkspace（越界即拒——浏览面不许成为任意读通道）；
//   · 隐藏条目也列（含 .agent——看得见才是事实），但目录序：目录在前、名字升序；
//   · 条目数超帽截断并如实标注；读文本单侧 512 KiB 帽（超帽 truncated=true）；
//   · 二进制（含 NUL）不预览，如实报原因。
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { resolveInWorkspace, assertRealContainment } from "../tools/base";
import { MAX_SIDE_BYTES, isTextish } from "./change-diff";

/** 单目录条目数帽（超出截断并标 truncated——不假装列全了）。 */
export const MAX_DIR_ENTRIES = 500;

export interface DirEntryView {
  name: string;
  kind: "file" | "dir";
  /** 文件字节数（目录给 null）。 */
  size: number | null;
}

export type ListDirPayload =
  | {
      ok: true;
      /** workspace 相对路径（""=根）。 */
      path: string;
      entries: DirEntryView[];
      truncated: boolean;
    }
  | { ok: false; error: string };

export type ReadTextPayload =
  | { ok: true; path: string; text: string; truncated: boolean; size: number }
  | { ok: false; error: string };

/** 列一层目录（不做递归；树由界面懒加载逐层展开）。 */
export async function listDir(workspace: string, relPath: string): Promise<ListDirPayload> {
  let abs: string;
  try {
    abs = relPath === "" ? workspace : resolveInWorkspace(workspace, relPath, "file-pane");
    if (relPath !== "") await assertRealContainment(workspace, abs, "file-pane");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  try {
    const st = await stat(abs);
    if (!st.isDirectory()) return { ok: false, error: `不是目录：${relPath}` };
  } catch {
    return { ok: false, error: `目录不存在：${relPath}` };
  }
  let names: string[];
  try {
    names = await readdir(abs);
  } catch (err) {
    return { ok: false, error: `无法读取目录：${err instanceof Error ? err.message : String(err)}` };
  }
  const entries: DirEntryView[] = [];
  for (const name of names) {
    try {
      const st = await stat(join(abs, name));
      entries.push({ name, kind: st.isDirectory() ? "dir" : "file", size: st.isDirectory() ? null : st.size });
    } catch {
      // 读不了 stat 的条目（权限/竞态）不吞：列出来但标 size null——宁缺信息不丢条目。
      entries.push({ name, kind: "file", size: null });
    }
  }
  entries.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, "zh") : a.kind === "dir" ? -1 : 1));
  const truncated = entries.length > MAX_DIR_ENTRIES;
  return { ok: true, path: relPath, entries: entries.slice(0, MAX_DIR_ENTRIES), truncated };
}

/** 读一个文本文件（单侧帽 = MAX_SIDE_BYTES；二进制拒）。 */
export async function readTextFile(workspace: string, relPath: string): Promise<ReadTextPayload> {
  let abs: string;
  try {
    abs = resolveInWorkspace(workspace, relPath, "file-pane");
    await assertRealContainment(workspace, abs, "file-pane");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  let buf: Buffer;
  try {
    buf = await readFile(abs);
  } catch {
    return { ok: false, error: `文件不存在或不可读：${relPath}` };
  }
  if (!isTextish(buf)) return { ok: false, error: "二进制文件不预览" };
  const truncated = buf.byteLength > MAX_SIDE_BYTES;
  const body = truncated ? buf.subarray(0, MAX_SIDE_BYTES) : buf;
  return { ok: true, path: relPath, text: body.toString("utf8"), truncated, size: buf.byteLength };
}

export type ResolveEntryPayload =
  | { ok: true; abs: string; isDir: boolean }
  | { ok: false; error: string };

/** v7 路径动作的解析段（§2.3 右键菜单）：workspace 内存在性 + 越界拒绝（与 listDir/readTextFile
 *  同一条 resolveInWorkspace 闸——系统动作（Finder/默认应用）不许成为任意路径触达面）。
 *  纯 Node、electron-free；shell 调用留在壳（desktop main）。 */
export async function resolveEntry(workspace: string, relPath: string): Promise<ResolveEntryPayload> {
  let abs: string;
  try {
    abs = relPath === "" ? workspace : resolveInWorkspace(workspace, relPath, "file-pane");
    if (relPath !== "") await assertRealContainment(workspace, abs, "file-pane");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  try {
    const st = await stat(abs);
    return { ok: true, abs, isDir: st.isDirectory() };
  } catch {
    return { ok: false, error: `路径不存在：${relPath}` };
  }
}
