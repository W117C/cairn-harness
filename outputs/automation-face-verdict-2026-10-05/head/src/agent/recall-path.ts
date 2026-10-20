// 「这份原文的位置，模型自己够得着吗」——全仓唯一一份判定（#33，第 71 页）。
//
// 为什么只留一份：两处发射点（skill 尾注、prune 打桩）都要回答同一个问题，而答错的代价一样——
// 把模型指去一条走不通的路（`read_file` 只收工作区相对路径，绝对路径与越界的相对路径都被拒）。
// 同一判断抄两份迟早漂，漂了就是**假承诺**（本仓反复点名的同族病：同一条判据各抄一份）。
// 两句人话仍各自写（第 66 页那条纪律：共用文案里的"下一步"要在每个消费者自己的形状上重测），
// 这里只回答可达性。
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { realpathSync } from "node:fs";

const tryRealpath = (p: string): string | null => {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
};

/**
 * 把绝对路径写成**模型的工具真能用**的形式：工作区内的相对路径；否则 `null`。
 *
 * 走 realpath 而不是词面比较：软链工作区（macOS 的 `/var`、`/tmp` 都指回 `/private/var`）按词面会被判成区外，
 * 那是把一条**做得到的**承诺误吞掉——与递假地址同样是缺陷，两个方向都要测。
 * `null` 时调用方必须改口成"模型侧读不到"，不许把原绝对路径递出去。
 */
export function workspaceUsablePath(absPath: string, workspace?: string): string | null {
  if (workspace === undefined) return null; // 不知道工作区 = 无法证明可取 ⇒ fail-closed
  const wsReal = tryRealpath(workspace);
  if (wsReal === null) return null;
  // 目标文件**此刻可能还没落盘**（prune 的形状是先算投影、之后才写附件），而 `realpathSync` 对不存在的路径抛错
  // ⇒ 沿路径向上取最近的已存在祖先，再把我们自己构造的那几段拼回去。
  // 真正的越界读写仍由 `read_file` 自己的 `assertRealContainment` 在打开那一刻兜底（防御纵深）。
  const tail: string[] = [];
  let cur = absPath;
  let base: string | null = null;
  for (;;) {
    const r = tryRealpath(cur);
    if (r !== null) { base = r; break; }
    const parent = dirname(cur);
    if (parent === cur) return null;
    tail.unshift(basename(cur));
    cur = parent;
  }
  const rel = join(relative(wsReal, base), ...tail);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return null;
  return rel;
}
