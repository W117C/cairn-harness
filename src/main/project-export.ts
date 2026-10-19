// 项目导出：把当前项目复制成一个**可带走**的目录。
//
// 产品语义（不是工程语义）：用户要的是「拿走成品」——一个能放进 U 盘、发给朋友、稍后打开的目录。
// 所以：
//   · 不覆盖：目标目录已存在就明确失败并给名字建议，不做「合并/覆盖」这种会吃掉别人数据的事；
//   · 排除可再生与仅本机相关的东西：node_modules / dist / .git / .agent / .DS_Store。
//     静态模板导出后双击 index.html 就能看；React 模板导出后需要 pnpm install（交付卡里写明）。
//   · .cairn/project.json 保留：它让导出目录还能被 Cairn 认出来，重新添加后可继续预览。
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { basename, join } from "node:path";

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
  if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) {
    return { ok: false, reason: "bad-source", message: `要导出的项目目录不存在：${sourceDir}` };
  }
  if (!existsSync(destParentDir) || !statSync(destParentDir).isDirectory()) {
    return { ok: false, reason: "bad-source", message: `导出目标不是一个目录：${destParentDir}` };
  }
  const rawName = opts.name ?? basename(sourceDir);
  const name = rawName.trim() === "" ? basename(sourceDir) : rawName.trim();
  const dest = join(destParentDir, name);
  if (existsSync(dest)) {
    return { ok: false, reason: "dest-exists", message: `目标已存在：${dest}——换一个导出位置，或把已有目录改名后重试` };
  }
  const excluded = new Set<string>(EXPORT_EXCLUDED);
  let created = false;
  try {
    mkdirSync(dest);
    created = true;
    cpSync(sourceDir, dest, {
      recursive: true,
      dereference: false,
      filter: (src) => !excluded.has(basename(src)),
    });
    return { ok: true, dest, copiedFiles: countFiles(dest) };
  } catch (err) {
    if (created) rmSync(dest, { recursive: true, force: true });
    return { ok: false, reason: "copy-failed", message: `导出失败：${err instanceof Error ? err.message : String(err)}（目标目录已清理）` };
  }
}
