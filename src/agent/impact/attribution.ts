// 波及面的**归属判据**（任务 #9，第 304 页的读数定的形状）。
//
// 一句话：`impact` 今天按「同名即引用」连边 ⇒ 一个定义在某个测试文件里的局部 `writeFile`
// 能吸走 140 个文件的调用点（那 140 处用的其实是 `node:fs/promises` 的那个同名函数）。
// 第 304 页把四种收紧切法各数了一遍（`outputs/impact-edge-provenance-2026-10-02/provenance.log`）：
//   B/C「按 import 才连边」摘掉真仓 69.5%／70.4% 的边，但会把**冻结夹具**
//     `fixtures/impact/accuracy-repo` 的 16 条真值边删到剩 1 条——那面登记的设计边界不许我动；
//   D「引用方自己也有同名定义才摘」夹具 16/16 存活、真仓摘 48.8%，但两个大户的
//     「自带同名定义」都是 0 ⇒ 摘得热闹，病还在；
//   E「引用方把这个名字**绑在别处**才摘」夹具 16/16 存活、真仓只摘 6.6%，
//     而 `writeFile` 140 处里 137 处、`readFile` 114 处里 109 处正是这种情况，
//     真枢纽（`createEventLog` 71／`runLoop` 33／`Orchestrator` 23）一处不动。
// ⇒ 买 E。它是**反证型**规则：只有拿得出"这名字另有出处"的证据才摘边，
//   没有 import 面（全局脚本仓库、老缓存条目）就照旧连边——与已登记的合同相容。
//
// 本文件只有判据与措辞，不碰盘、不读图；取料（每个文件的名字→来源表）由 `index.ts` 做。
// 三条状态分开，**绝不把「没证据」读成「没关系」**（规则 261 那一族：读不到与没有不许同形）。

/** 一处 (引用方文件, 名字) 对某个定义文件的可归属性。 */
export type Attribution = "kept" | "dropped" | "no-evidence";

export interface RefBinding {
  /** 这个引用方文件有没有 import 面可判：false ⇒ 一律保守计入（老条目、解析被跳过）。 */
  known: boolean;
  /** 该名字在这个文件里被绑到的来源（仓内 rel，或 `external:<说明符>`）。空数组＝没有任何 import 绑它。 */
  sources: readonly string[];
}

/** 外部包同样是"另有归属"的证据，但要与仓内 rel 分得开 ⇒ 统一在这一处加前缀。 */
export function bindingSourceKey(targetRel: string | null, spec: string): string {
  return targetRel ?? `external:${spec}`;
}

/** 三态判据（唯一决策点；边构造、`upward`、`downward` 三处都吃它——一处改三处跟）。 */
export function attributeRefToDef(binding: RefBinding, defFile: string): Attribution {
  if (!binding.known) return "no-evidence";
  // 没有任何 import 把这个名字绑走 ⇒ 反证不成立，照名字图连（全局脚本形状的仓库全在这一支）。
  if (binding.sources.length === 0) return "kept";
  // 定义就在这个引用方 import 过来的那份文件里：正证。
  if (binding.sources.includes(defFile)) return "kept";
  return "dropped";
}

export interface AttributionStats {
  kept: number;
  dropped: number;
  noEvidence: number;
}

export function emptyAttributionStats(): AttributionStats {
  return { kept: 0, dropped: 0, noEvidence: 0 };
}

/** 三态都要在句子里出现（缺一个数就等于那一格没人看）。全 0 ⇒ 空串：不印噪声。
 *  措辞刻意保守——摘掉的是「这处引用另有出处」，不是「这处调用不存在」。 */
export function attributionNote(stats: AttributionStats): string {
  if (stats.dropped === 0 && stats.noEvidence === 0) return "";
  const parts: string[] = [];
  if (stats.dropped > 0) parts.push(`${String(stats.dropped)} 处已按「同名但另有出处」排除`);
  if (stats.noEvidence > 0) parts.push(`${String(stats.noEvidence)} 处所在文件没有 import 面可判，按名字图保守计入`);
  return "；归属判定：" + parts.join("，");
}
