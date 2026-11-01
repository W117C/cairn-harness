/**
 * 项目目录在场性（2026-10-30 · 第 802 页）。
 *
 * 缺口：注册表只存 canonical path，不存「这个目录现在还在不在」。文件夹被移动/删除后，
 * 侧栏看起来与健康项目一模一样；点下去才得到「未注册的工作区，已拒绝」——一句既不准确
 * （它明明登记过）也不给出路（该去项目菜单重新定位）的话。
 *
 * 本模块把「在场性」与「报错话术」收成纯函数：`exists` 由调用方注入，判卷不碰真实磁盘。
 * missing 是**派生状态**，不写回 registry——路径回来（用户移回文件夹）下一次 list 就自动转正常。
 */
export interface ProjectPathLike {
  path: string;
}

/** 给列表行补 `missing`；顺序与输入一致（侧栏顺序不能因盘点而变）。 */
export async function annotateProjectPresence<T extends ProjectPathLike>(
  records: readonly T[],
  exists: (path: string) => Promise<boolean>,
): Promise<(T & { missing: boolean })[]> {
  const out: (T & { missing: boolean })[] = [];
  for (const record of records) {
    // 盘点本身失败（EACCES 等）按「不在场」处理：宁可标出来让人看一眼，也不读成健康。
    const present = await exists(record.path).catch(() => false);
    out.push({ ...record, missing: !present });
  }
  return out;
}

/** 已登记但目录不在场的报错句；不适用（未登记/读得到）返回 null。 */
export async function missingProjectPathError(
  path: string,
  records: readonly ProjectPathLike[],
  exists: (path: string) => Promise<boolean>,
): Promise<string | null> {
  if (path === "") return null;
  const registered = records.some((record) => record.path === path);
  if (!registered) return null;
  if (await exists(path).catch(() => false)) return null;
  return `项目目录不存在（可能已被移动或删除）：${path}——在侧栏项目菜单里选「更改项目目录…」重新定位`;
}
