// 「问题 → 位置」那两个信号的正则**唯一出处**。
//
// 立案动因：这把尺（`scripts/probe-locate-recall.ts`）从前把生产端的两条正则**逐字镜像**了一份，
// 页上写的是「改了那两行正则而不改这里，A 臂就撒谎」——那是靠注释守的不变量（本仓第三形态）。
// 现在两端都从这里取，镜像那一格结构上就不存在了：尺的 A 臂输入与生产端同一支代码算出来。
//
// 为什么给 builder 而不是给常量 RegExp：`/g` 的 `lastIndex` 是有状态的，同一实例跨调用点复用
// 会串位（`.match(re)` 自己会重置，但哪天有人改成 `re.exec` 循环就踩雷）。宁可每次新建。
/** 路径形状（最近 user_message 里提到的 workspace 相对路径）。 */
export const PATHISH_SOURCE = String.raw`[\w./-]+\.[a-z]{1,5}`;
/** 标识符形状（最后一个 user_message 里提到的符号名；≥4 字符，同从前）。 */
export const MENTIONED_SOURCE = String.raw`[A-Za-z_][A-Za-z0-9_]{3,}`;

export function makePathishRe(): RegExp {
  return new RegExp(PATHISH_SOURCE, "g");
}
export function makeMentionedRe(): RegExp {
  return new RegExp(MENTIONED_SOURCE, "g");
}
