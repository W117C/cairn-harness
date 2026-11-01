/** git URL → 仓库名（`https://host/o/r.git` → `r`；`git@host:o/r` → `r`）。
 *
 *  第 947 页：main 侧 `git-ops.ts` 用它决定**存下来的项目名**，渲染层 `AddProjectMenu` 用它预览
 *  「将克隆到：<父目录>/<名字>」——两处各写一份时，预览与落库就可能说两个名字（改一处就漂）。
 *  只做纯字符串解析、不碰网络与文件系统；命名非法（空、含空白、不匹配白名单）一律 null，不猜。
 */
export function repoNameFromUrl(url: string): string | null {
  const tail = url.replace(/\/+$/, "").split(/[/:]/).pop() ?? "";
  if (tail === "" || /\s/.test(tail)) return null;
  const name = tail.endsWith(".git") ? tail.slice(0, -4) : tail;
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) ? name : null;
}
