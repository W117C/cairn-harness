// 「这张图收全了吗」——覆盖面判据与靠它说话的两句话。
//
// 为什么住在 impact 层而不是读端工具里：同一张图有**四个**消费者（`impact_query` 查询、write/edit 后
// 的回注摘要、spawn 准入的语义租约、给模型看的仓库地图）。"图非全量"这一件事在每一侧都得说同一句话，
// 而判据从前只写在 `src/tools/impact-query.ts` 里 ⇒ 另两侧要出声就得再抄一遍谓词
// （本仓第十四族：同一判据 N 份副本，每份宽度不同、最宽那份才是对的）。
// 这里只放**判据 + 文案**，不放取数：分母 `candidates` 由各消费者自己传到建图那一层去拿。
import { MAX_FILES_CEILING } from "../map/build.js";

/** 「图非全量」的唯一判据：**帽前候选数 > 实际收录数**。
 *  为什么不看「收录数 < 帽」（旧判据，2026-09-25 换掉）：切片之外还有「单文件读/解析失败被跳过」
 *  这一支，只看帽会在真的漏了文件时闭嘴；而候选正好等于帽时它又**误报**（一个都没漏，模型白重问一次）。 */
export function graphIsPartial(files: number, candidates: number): boolean {
  return candidates > files;
}

/** 这一顶帽是否已经顶到上限（`maxFiles` 还能不能往上调）。
 *  09-30 起缺省＝上限（见 `map/build.ts` 的 `MAX_FILES_DEFAULT`）⇒ 默认调用下"调大 maxFiles"是
 *  一条走不通的路；文案必须先看这里，否则就成了第 51 页点名的**死参数式文案**。 */
export function capAtCeiling(cap: number): boolean {
  return cap >= MAX_FILES_CEILING;
}

/** 「帽外」那一步的出路（纯函数，三处文案共用一个句子）：没到上限 ⇒ 调大是真动作；
 *  到了上限 ⇒ 直说旋钮拧不动，并换成真做得到的两件（直读 / 按目录拆仓）。 */
export function capWayOut(cap: number): string {
  return capAtCeiling(cap)
    ? `帽 ${String(cap)} 已是上限、maxFiles 调不上去 ⇒ 只能直读（grep/lsp）或按目录拆仓`
    : "调大 maxFiles 后重问";
}

/** 覆盖面自述（纯函数）：图没把候选收全时，**成功**答案也要说清自己量了多大一块。
 *
 *  为什么阳性一侧也要说：本工具的**阴性**结论早就各自带分诊（"无跨文件调用点"、"图里没有这个符号"
 *  都会说"不等于 0"），但一个**成立**的答复原先只报结果不报覆盖面 ⇒ 模型看到"波及 1 个文件"就以为
 *  问全了，而这张图可能只收了仓库的一小截（2026-09-25 本仓实测：451 个候选只收 400）。
 *  这与 grep/glob 那条"阴性要说清扫描面"是同一条政策的后半句。
 *
 *  措辞把"没进图"的两种成因一起点名（帽外 / 被跳过），不只怪帽。 */
export function coverageNote(files: number, cap: number, candidates: number): string {
  if (!graphIsPartial(files, candidates)) return "";
  return `（覆盖度：本图收录 ${String(files)} 个文件＝帽 ${String(cap)}，` +
    `另有 ${String(candidates - files)} 个候选文件没进这张图（帽外或被跳过）⇒ 图非全量，` +
    `图里没有 ≠ 仓库里没有；要更全${capWayOut(cap)}）`;
}

/** 「图里没有它」的成因收敛（纯函数）：把「可能被帽挡在图外」从**恒真**改成**条件真**。
 *
 *  两条阴性出口（符号彻底查不到 / 只有引用没有定义）原先都无条件列着这一成因。
 *  而 `applyFileCap` 只在候选数 > 帽时才切那一刀 ⇒ 在小仓库上"被帽挡"是一句**不可能成立**的假设，
 *  模型照着去调大 `maxFiles` 就是白跑一轮（与第 51 页那条「死参数式文案」同族：文案指向此输入下
 *  不存在的开关）。反过来真到帽时这一类必须留着——否则又回到"把未知说成没有"。
 *  与 `coverageNote` 共用同一判据（`graphIsPartial`），两处不会自相矛盾。 */
export function capCauseNote(files: number, cap: number, candidates: number): string {
  return graphIsPartial(files, candidates)
    ? `本图收录 ${String(files)} 个文件＝帽 ${String(cap)}，另有 ${String(candidates - files)} 个候选没进这张图` +
      `（非全量）⇒ 这一刀可能把它切在图外，${capWayOut(cap)}可排除这一成因`
    : `与帽无关：本图收录 ${String(files)} 个文件，全仓候选 ${String(candidates)} 个 ⇒ 没有文件是被帽切掉的` +
      "（被忽略规则/噪声目录排除、后缀不支持仍然成立）";
}
