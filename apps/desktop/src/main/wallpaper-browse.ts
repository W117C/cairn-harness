// 壁纸的**应用内选择器**（不是原生面板）：列目录 → 点文件。
//
// 为什么要有它（两条都是真理由，不只是为了判据）：
//  ① 原生面板在无辅助功能权限的机器上**点选不可自动化**，这一格永远判不绿；
//  ② 用户经常是「知道路径、但翻面板翻半天」——能直接输目录、点一下的应用内选择器更快。
// 口径：只列白名单扩展名（与 `WALLPAPER_PICK_FILTERS` 同一组）、目录排前、不跟符号链接循环。
import { readdir, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { WALLPAPER_PICK_FILTERS } from "./wallpaper-pick";

/** 白名单扩展名（小写，含点）。 */
export const BROWSE_EXTENSIONS: readonly string[] = WALLPAPER_PICK_FILTERS[0].extensions.map((e) => "." + e.toLowerCase());

export interface BrowseEntry {
  name: string;
  path: string;
  kind: "dir" | "file";
}

export interface BrowseResult {
  ok: boolean;
  dir?: string;
  parent?: string | null;
  entries?: BrowseEntry[];
  error?: string;
}

export async function browseDirectory(input: string | null | undefined, deps: {
  readdir?: typeof readdir;
  stat?: typeof stat;
} = {}): Promise<BrowseResult> {
  const read = deps.readdir ?? readdir;
  const statOf = deps.stat ?? stat;
  const raw = (input ?? "").trim();
  if (raw === "") return { ok: false, error: "没有目录" };
  const dir = resolve(raw);
  let names: string[];
  try {
    const info = await statOf(dir);
    if (!info.isDirectory()) return { ok: false, error: "不是目录" };
    names = await read(dir);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  const entries: BrowseEntry[] = [];
  for (const name of names) {
    if (name.startsWith(".")) continue; // 隐藏文件不列（列表干净比「全都给你」重要）
    const full = join(dir, name);
    let info: Awaited<ReturnType<typeof stat>>;
    try {
      info = await statOf(full);
    } catch {
      continue; // 读不到就不列，不假装存在
    }
    if (info.isDirectory()) entries.push({ name, path: full, kind: "dir" });
    else if (info.isFile() && BROWSE_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext))) {
      entries.push({ name, path: full, kind: "file" });
    }
  }
  entries.sort((a, b) => (a.kind === b.kind ? (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) : a.kind === "dir" ? -1 : 1));
  const parent = dirname(dir);
  return { ok: true, dir, parent: parent === dir ? null : parent, entries };
}

/** 面包屑：`/a/b/c` ⇒ [/, /a, /a/b, /a/b/c]（面板点着往上走，不用手打）。 */
export function breadcrumbOf(dir: string): { name: string; path: string }[] {
  const out: { name: string; path: string }[] = [];
  let cur = resolve(dir);
  for (;;) {
    const parent = dirname(cur);
    out.unshift({ name: basename(cur) === "" ? cur : basename(cur), path: cur });
    if (parent === cur) break;
    cur = parent;
  }
  return out;
}
