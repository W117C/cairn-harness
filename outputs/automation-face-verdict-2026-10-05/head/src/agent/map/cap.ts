// 文件数帽的两个数（唯一事实源）。为什么单独成一个叶子模块：
// 「帽是多少」与「帽咬下去之后怎么说话」被三处消费者共用（`map/build.ts` 的仓库地图、
// `impact/index.ts` 的影响图与语义租约、`tools/impact-query.ts` 的读端），而**文案模块**
// （`impact/coverage.ts`）也要读这两个数来判断"还能不能往上调"。文案住在 impact/、
// 帽住在 map/build.ts 里 ⇒ 地图要用文案就得 import 回 impact/ ⇒ 环。
// 把常量抽到不 import 任何人的叶子模块，方向就只剩一条：build → cap、coverage → cap、地图/租约/读端 → coverage。
// 这不是为将来留接口，是这一笔（#33）要复用同一句自述时**当场撞上**的那个环。

/** 文件数帽的**唯一事实源**（impact 侧以前各写一个 400 字面量 ⇒ 一处调、另一处静默不跟）。
 *
 *  为什么缺省＝上限（09-30 改）：这一位从前是 **400**，而切片前那份候选是**按 mtime 降序**排的
 *  （`map/build.ts` 的 `compareCandidates` 第一键）⇒ 它的真实语义不是"最重要的 400 个"，
 *  而是"**这台机器最近动过的 400 个**"。实测两棵同一份代码的树：`git worktree add` 出来的树里所有文件同一个 mtime，
 *  入图最旧与图外最新同秒 ⇒ 边界由 `rg` 的遍历顺序决定；把口径换成字典序，入图集合差 21–28%
 *  （读数与复跑命令：`outputs/impact-cap-decision-2026-09-30/`）。同一顶帽还喂着**给模型看的仓库地图**
 *  （`buildMap` 也走这份候选）与**spawn 准入的语义租约**（`affectedFilesOf`），后者把"图外"读成"不相交"。
 *  ⇒ 帽不该是覆盖面政策，只该是**成本安全阀**：正常仓库全收（本仓 512 个候选，实测代价 ＋176ms／次建图，
 *  1071→1247ms、同臂散布 ≤13ms），只有大到 `MAX_FILES_CEILING` 才切——那一刀之后**不再谎称"调大 maxFiles"能救**
 *  （见 `impact/coverage.ts` 的 `capWayOut`：到了上限就把出路换成"按目录拆仓/直读"）。 */
export const MAX_FILES_CEILING = 5000;
export const MAX_FILES_DEFAULT = MAX_FILES_CEILING;
