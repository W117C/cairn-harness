// 渲染层给的路径能不能当**落点**用（2026-10-19 独立评审追出的一道门）。
//
//  为什么要有这道门：同一个文件里 `setWorkspaceContext` 早就把工作区上下文限死在"已注册"面上
// （不校验的话 `/` 就成了文件窗格/预览的边界），**唯独几条通道绕过了那道门**——
// 同一个信任边界，一半有门一半没有，那一半就是洞：
//  · `previewStart` → 在该目录跑 `pnpm install` + `pnpm exec vite` ⇒ **vite 会加载并执行该目录的
//    `vite.config.js`**（任意代码执行），且没有审批门；
//  · `projectExport` → 把该目录整份拷到用户选的位置（`~/.ssh` 也拷）。
//
// 口径：
//  · **等于**某个已知根（项目目录本身）⇒ 放行；
//  · **落在**某个已知根之内（工作区里 agent 交付的单文件交付物也要能预览——那是产品明确支持的
//    一路，不能顺手砍掉）⇒ 放行（软链逐段解析后再判：core 的 `assertRealContainment` 正是这件事，
//    词法 relative 挡不住"工作区内软链指向外部"）；
//  · 其余 ⇒ null（由调用方 fail-visible，不静默改用别的路径）。
//
// 单独成文件是为了**能真跑**：这一面在 Electron 主进程里（index.ts 直接 import electron，
// 判卷里起不来），判据本身不该跟着进不去。
import { canonicalWorkspacePath } from "./kernel-host";
import { assertRealContainment } from "../../../../src/tools/base";

/** 已知根 ⇒ 规范路径去重（不可解析的跳过，不放宽）。 */
export function canonicalKnownRoots(roots: readonly (string | null)[]): string[] {
  const out: string[] = [];
  for (const r of roots) {
    if (r === null) continue;
    try { out.push(canonicalWorkspacePath(r)); } catch { /* 不可解析：跳过（不放宽） */ }
  }
  return [...new Set(out)];
}

/** 严格相等版：路径**恰好等于**某个已知根才放行。
 *  `setWorkspaceContext` 要的就是这个：它定的是"文件窗格/预览的**根**"，
 *  落进某个子目录会让边界含糊。 */
export function canonicalKnownProjectPath(p: string, roots: readonly string[]): string | null {
  let canonical: string;
  try { canonical = canonicalWorkspacePath(p); } catch { return null; }
  return roots.includes(canonical) ? canonical : null;
}

/** 包含版：等于某个根**或**落在某个根之内就放行（软链逐段解析后再判）。 */
export async function resolveKnownProjectTarget(p: string, roots: readonly string[]): Promise<string | null> {
  let canonical: string;
  try { canonical = canonicalWorkspacePath(p); } catch { return null; }
  if (roots.includes(canonical)) return canonical;
  for (const root of roots) {
    try {
      await assertRealContainment(root, canonical, "project-path");
      return canonical;
    } catch { /* 不在这个根内：试下一个 */ }
  }
  return null;
}
