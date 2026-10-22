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

/** 新建项目的父目录闸（2026-10-21 批 133）：与 gitClone 的落点门同一条口径。
 *
 *  `createProject` / `projectCreateFromTemplate` 原先直接把渲染层给的 `parentDir` 交给
 *  `mkdirSync` —— 与 gitClone 修掉的那个洞同形（`parentDir:"/Users/me/.ssh"` 就能往那里建项目）。
 *  允许面：**用户真的用系统对话框选过**的目录 ∪ **已知项目根**（当前/最近工作区、注册项目）。
 *  缺省（不传）走 core 的 `~/CairnProjects`，那是应用自己的固定落点，不受渲染层控制。
 *  返回值里的 parentDir 是规范路径，调用方只把**它**交给 core。 */
export type CreateParentGate =
  | { ok: true; parentDir?: string }
  | { ok: false; message: string };

export function resolveCreateParent(
  raw: string | undefined,
  picked: ReadonlySet<string>,
  roots: readonly string[],
): CreateParentGate {
  if (typeof raw !== "string" || raw.trim() === "") return { ok: true };
  let canonical: string;
  try { canonical = canonicalWorkspacePath(raw); } catch { return { ok: false, message: `目标目录不可解析：${raw}` }; }
  if (picked.has(canonical) || roots.includes(canonical)) return { ok: true, parentDir: canonical };
  return {
    ok: false,
    message: `新建项目的目标目录未经选择，已拒绝：${raw}（请用「更改…」选一个目录，或放进已登记的项目里）`,
  };
}

/** 渲染层传进来的 workspace 参数闸（批 133）：只认**已登记的根**，不接受任意路径。
 *
 *  为什么是精确相等而不是包含：这里的 workspace 是「去哪一棵树里读技能/插件/信任」的**根**，
 *  子目录会让侧边菜单读到一个项目里的子目录技能，和界面上的项目语义不一致。
 *  空参数 = 用当前工作区上下文（`setWorkspaceContext` 写入时已校验过）。 */
export type ProvidedWorkspaceGate =
  | { ok: true; workspace: string | null }
  | { ok: false; error: string };

export function resolveProvidedWorkspace(
  raw: unknown,
  roots: readonly string[],
  fallback: string | null,
): ProvidedWorkspaceGate {
  const value = String(raw ?? "");
  if (value === "") return { ok: true, workspace: fallback };
  const exact = canonicalKnownProjectPath(value, roots);
  if (exact === null) return { ok: false, error: `工作区未经登记，已拒绝：${value}` };
  return { ok: true, workspace: exact };
}
