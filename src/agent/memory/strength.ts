// M7 · 记忆强度模型（纯函数，零 IO）：一条记忆「多容易再被想起来」的算术。
//
// 神经映射（机制出处与整链设计见 consolidate.ts 模块头，这里只放算术）：
// · Ebbinghaus 遗忘曲线 → 检索强度按**半衰期指数衰减**（λ≈0.001/h ≈ 半衰期 29 天，
//   对标 Human-Inspired Memory Architecture（arXiv 2605.08538）实测校准值）；
// · 检索练习效应（testing effect）→ 每次被检索选中并注入正文，强度回升（越弱回升越多），
//   且衰减锚点重置到本次命中——「用过」本身就在巩固；
// · Bjork（新度理论）→ 强度只建「检索强度」一个维度，不另建「存储强度」：
//   正文在盘上永远不丢（存储恒在），强度只决定**要不要占注入预算**与「要不要休眠」。
//
// 算不动的输入（非法 ISO 时间、未知字段）一律**保持原值不衰减**：强度是启发式不是账本，
// 宁可保守（多注一条）也不让一条坏时间戳把整库判死。

/** 一条主题记忆的强度账（存 <memory>/memory-stats.json，与本文件算术分离的 IO 在 store.ts）。 */
export interface MemoryStat {
  topic: string;
  /** 被检索选中（正文注入）的累计次数——检索练习的计数面。 */
  hits: number;
  /** 最近一次被检索选中（ISO8601）。衰减锚点；新建条目缺省取 modified。 */
  lastRetrieved: string;
  /** 检索强度 0..1：1 = 随时可取；只衰减、只回升，永不越界。 */
  strength: number;
  /** 休眠中（墓碑态）：索引行不注、正文不注；词面强命中可唤醒（见 retrieval.ts）。 */
  dormant?: boolean;
}

/** 半衰期（天）。29 天 ≈ λ=0.001/小时的指数衰减，同前述论文的校准值。 */
export const STRENGTH_HALF_LIFE_DAYS = 29;
/** 检索练习一次的回升增益：strength += (1 - strength) × 0.3——越接近 1 升得越慢（有界）。 */
export const REINFORCE_GAIN = 0.3;
/** 衰减到这个强度以下、且超过 DORMANT_AFTER_DAYS 天没被想起过 → 休眠。 */
export const DORMANT_STRENGTH = 0.25;
/** 连续这么多天没有被检索选中（从 lastRetrieved 起算）才允许休眠——刚写的、只是暂时没被
 *  问到的条目不进墓碑：新条目没有命中记录不等于没用（它可能等一个还没来的问题）。 */
export const DORMANT_AFTER_DAYS = 45;
/** 唤醒时强度重置到这里（而不是 1）：一次强命中证明「还有用」，但不证明「常用」。 */
export const WAKE_STRENGTH = 0.6;

/** 两个 ISO 时间戳相差几天（b − a）。解析失败或时钟倒走 → 返回 null（调用方按「算不动」处理）。 */
export function daysBetweenIso(aIso: string, bIso: string): number | null {
  const a = Date.parse(aIso);
  const b = Date.parse(bIso);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  const days = (b - a) / 86_400_000;
  return days < 0 ? null : days;
}

/** 按半衰期衰减（纯函数）。fromIso = 衰减锚点（lastRetrieved）。锚点或当前时间非法 → 原值返回。 */
export function decayStrength(strength: number, fromIso: string, nowIso: string): number {
  const days = daysBetweenIso(fromIso, nowIso);
  if (days === null) return clamp01(strength);
  const decayed = strength * Math.pow(0.5, days / STRENGTH_HALF_LIFE_DAYS);
  // 浮点尾差收口：半衰期整数倍上的 0.5/0.25 应该逐字相等，判卷才好钉。
  return clamp01(Math.round(decayed * 1e6) / 1e6);
}

/** 检索练习回升（纯函数）：越弱升得越多，上限 1。 */
export function reinforceStrength(strength: number): number {
  return clamp01(Math.min(1, strength + (1 - clamp01(strength)) * REINFORCE_GAIN));
}

/** 是否该休眠：**已衰减到阈值以下** 且 **长期没被检索选中**。两个条件缺一不可——
 *  强度低但最近刚命中过的（可能只是衰减锚点刚重置）不休眠；很久没命中但强度还高的
 *  （比如刚写入不久）也不休眠。 */
export function shouldDormant(stat: MemoryStat, nowIso: string): boolean {
  if (stat.dormant === true) return true;
  const days = daysBetweenIso(stat.lastRetrieved, nowIso);
  if (days === null || days <= DORMANT_AFTER_DAYS) return false;
  return decayStrength(stat.strength, stat.lastRetrieved, nowIso) < DORMANT_STRENGTH;
}

/** 一次命中后的落账（纯函数）：先按锚点衰减到「现在」，再回升、清休眠、记数与锚点。
 *  stat === null（从未有过账，条目新建以来第一次被选中）→ 按「初始强度 1、刚写入」建账。 */
export function bumpStat(stat: MemoryStat | null, topic: string, nowIso: string): MemoryStat {
  if (stat === null) {
    // 首次命中建账：hits=1、强度取回升（0.3）——一条只被词面碰过一次的记忆不该拿满强度。
    return { topic, hits: 1, lastRetrieved: nowIso, strength: reinforceStrength(0) };
  }
  const decayed = decayStrength(stat.strength, stat.lastRetrieved, nowIso);
  // 休眠条目被强命中唤醒：强度重置到 WAKE_STRENGTH（不是从衰减值回升——唤醒即重建提取通路）。
  const base = stat.dormant === true ? Math.max(WAKE_STRENGTH, decayed) : decayed;
  return { topic, hits: stat.hits + 1, lastRetrieved: nowIso, strength: reinforceStrength(base), dormant: undefined };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
