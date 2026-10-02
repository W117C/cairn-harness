// 尺的自检口径（正哨兵 / 负控）。放这里的唯一理由：让"退出码对不对"这件事有秒级判卷，
// 而不是只有把整把尺跑一遍（`probe-locate-recall` 一次要建几十张地图）才知道。
//
// 立案动因（10-02 现读）：locate-recall 的正哨兵（枢纽文件 `src/main/settings.ts`）**连着几轮在所有预算档 MISS**，
// 而脚本一直**退 0** ⇒ 那天的能力复测把「A 臂 4/16」当成能力 1 的分数写进了报告，
// 没有人被迫去看"哨兵失败 ⇒ 整张表的命中率不可引用"这句话。尺不响，比尺没刻度更坏。

/** 两格都不满足时**先报负控**：命中定义太松意味着"变好的那些读数"也一并作废，
 *  而哨兵 MISS 只说明分子偏低——两者修法相反，所以先说更坏的那个。 */
export function rulerSelfCheck(posHit: boolean, controlHit: boolean): { ok: boolean; why: string } {
  if (controlHit) return { ok: false, why: "负控命中 ⇒ 命中定义太松（同一张表的所有命中率作废，包括变好的那些）" };
  if (!posHit) return { ok: false, why: "正哨兵在所有预算档都 MISS ⇒ 图里真没有那个枢纽文件，命中率这一列不可引用（先修取料面或排序，别先报分数）" };
  return { ok: true, why: "" };
}
