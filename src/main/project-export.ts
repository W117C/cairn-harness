// 项目导出：把当前项目复制成一个**可带走**的目录。
//
// 产品语义（不是工程语义）：用户要的是「拿走成品」——一个能放进 U 盘、发给朋友、稍后打开的目录。
// 所以：
//   · 不覆盖：目标目录已存在就明确失败并给名字建议，不做「合并/覆盖」这种会吃掉别人数据的事；
//   · 排除可再生与仅本机相关的东西：node_modules / dist / .git / .agent / .DS_Store。
//     静态模板导出后双击 index.html 就能看；React 模板导出后需要 pnpm install（交付卡里写明）。
//   · .cairn/project.json 保留：它让导出目录还能被 Cairn 认出来，重新添加后可继续预览。
import { cpSync, lstatSync, mkdirSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, unlinkSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";

/** 导出时排除的条目名（任意层级）。这是导出契约的一部分：交付卡文案与这里必须一致。 */
export const EXPORT_EXCLUDED = ["node_modules", "dist", ".git", ".agent", ".DS_Store"] as const;

export type ExportProjectResult =
  | { ok: true; dest: string; copiedFiles: number }
  | { ok: false; reason: "bad-source" | "dest-exists" | "copy-failed"; message: string };

function countFiles(dir: string): number {
  let count = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) count += countFiles(abs);
    else count += 1;
  }
  return count;
}

export function exportProject(sourceDir: string, destParentDir: string, opts: { name?: string } = {}): ExportProjectResult {
  const name = opts.name?.trim() || basename(sourceDir);
  if (name === "" || name === "." || name === ".." || /[/\\\0]/.test(name)) {
    return { ok: false, reason: "bad-source", message: "导出名称必须是单个文件夹名，不能包含路径分隔符或空字符" };
  }
  let source: string;
  let parent: string;
  try {
    source = realpathSync(sourceDir);
    parent = realpathSync(destParentDir);
    if (!statSync(source).isDirectory() || !statSync(parent).isDirectory()) throw new Error("not a directory");
  } catch {
    return { ok: false, reason: "bad-source", message: "项目与导出父目录必须是可访问的现有目录" };
  }
  const dest = join(parent, name);
  if (within(source, dest)) {
    return { ok: false, reason: "bad-source", message: "请在项目目录之外选择导出位置，避免递归复制项目自身" };
  }
  const excluded = new Set<string>(EXPORT_EXCLUDED);
  const links: { path: string; target: string; directory: boolean }[] = [];
  let created = false;
  try {
    try {
      lstatSync(dest); // A dangling symlink is still an existing destination.
      return { ok: false, reason: "dest-exists", message: `目标已存在：${dest}——换一个导出位置，或把已有目录改名后重试` };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    mkdirSync(dest);
    created = true;
    cpSync(source, dest, {
      recursive: true,
      dereference: false,
      verbatimSymlinks: true,
      filter: src => {
        if (src === source) return true;
        if (excluded.has(basename(src))) return false;
        if (lstatSync(src).isSymbolicLink()) {
          const target = realpathSync(src);
          const targetPath = relative(source, target);
          if (!within(source, target) || targetPath.split(sep).some(part => excluded.has(part))) {
            throw new Error(`链接 ${relative(source, src)} 指向项目外或未导出的内容；请改成项目内的实际文件后重试`);
          }
          links.push({ path: relative(source, src), target: targetPath, directory: statSync(target).isDirectory() });
        }
        return true;
      },
    });
    // Map internal links onto the delivered tree, including absolute links and renamed roots.
    for (const link of links) {
      const path = join(dest, link.path);
      unlinkSync(path);
      symlinkSync(relative(dirname(path), join(dest, link.target)) || ".", path, link.directory ? "dir" : "file");
    }
    return { ok: true, dest, copiedFiles: countFiles(dest) };
  } catch (err) {
    let cleanup = "未创建目标目录";
    if (created) {
      try { rmSync(dest, { recursive: true, force: true }); cleanup = "目标目录已清理"; }
      catch { cleanup = `未能清理半成品，请检查：${dest}`; }
    }
    return { ok: false, reason: "copy-failed", message: `导出失败：${err instanceof Error ? err.message : String(err)}（${cleanup}）` };
  }
}

function within(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel));
}
