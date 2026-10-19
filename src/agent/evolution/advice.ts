// 跨轮闭环的第二半：把本轮信号翻成**结构化的路由/上下文决策**出口。
//
// 缺口：strategy-patch 的 note 是给人读的整句，路由降档、提前压缩、该停就停三件事
// 揉在同一句里——下游（路由选档、上下文装配）拿不到可判字段，只能再抄一遍措辞。
// 本模块只做「信号 ⇒ 结构化建议」这一段纯函数；阈值与 strategy-patch 同源
// （COST_PER_BOUNDARY_LIMIT 只在那一份定义），不另立第二份口径。
//
// 纪律：**没有依据就不给建议**（全 null + 空 reasons = 不干涉，是缺省面）。
// 建议必须带得出理由（reasons 逐条给读数），与补丁的 note 同一条"无出处不产出"。
// 代词纪律（2026-10-16）：这段是上一轮收尾时写的、这一轮开工时读的 ⇒ 不在正文里用「下一轮」
// 指代读者此刻要干的活，一律「这一轮」；段落自带「（记于 X）」戳（见 recordedAtStamp）。
import type { EvolutionSignals } from "./signal";
import { COST_PER_BOUNDARY_LIMIT, recordedAtStamp } from "./strategy-patch";

export interface EvolutionAdvice {
  /** 路由降档建议；null = 本轮读数不支持任何路由偏好。 */
  preferredTier: "cheap" | null;
  /** 上下文节流动作；null = 不干涉。
   *  `stop-after-boundary` 已于 2026-10-16 撤下：它由"不可测"推导，而不可测不等于无前进
   *  （见 `evolutionAdvice` 里那段说明）。类型成员留着不删，是为了让**盘上旧记录**仍读得出来——
   *  老 evolution.json 里存着这个值，删成员会让它们变成读不回的形状。 */
  contextAction: "compress-early" | "stop-after-boundary" | null;
  /** 每条建议的读数依据（空 = 没给建议）。 */
  reasons: string[];
}

/** 从本轮读数推导建议。纯函数。 */
export function evolutionAdvice(s: EvolutionSignals): EvolutionAdvice {
  if (s.costMeasurable && s.tokensPerBoundary !== null && s.tokensPerBoundary > COST_PER_BOUNDARY_LIMIT) {
    return {
      preferredTier: "cheap",
      contextAction: "compress-early",
      reasons: [
        "每次 verified 前进平均花 " + String(s.tokensPerBoundary) + " token（偏高线 " + String(COST_PER_BOUNDARY_LIMIT) + "）",
      ],
    };
  }
  /* 不可测 ⇒ **不给停跑建议**（2026-10-16 修的机制缺陷）。
   *
   *  从前这里把"没有测量能力"直接读成"没有前进"：verified 边界要求配对的 verify 工具调用，
   *  而 harness 自动补拍的成功验证、产物生成、有效预览都不产生模型侧 verify 调用 ⇒ 边界=0
   *  ⇒ 不可测 ⇒ 只要有 token 消耗就产出「该停就停」。后果是一场真的生成了产物、自动检查也过了的
   *  会话被记成"130535 token 且无新前进 / 死跑复发"，下一轮系统提示词里就带着这句劝退。
   *
   *  纪律还是 `cost-per-progress` 那条原话：**不可测不是 0、也不是 Infinity**。
   *  没有测量能力时唯一诚实的动作是"暂不调整"，任何策略结论（包括"停下"）都是把统计缺口读成事实。
   *  真判"无前进"要的是额外证据——产物没变化、同一错误反复出现、没有任何新证据——
   *  那些判据今天都不在这一层，所以这一层不许代替它们下结论。 */
  return { preferredTier: null, contextAction: null, reasons: [] };
}

/** 有没有可给的建议（空建议不落盘、不渲染——旧记录读起来与从前逐字一致）。 */
export function hasAdvice(a: EvolutionAdvice): boolean {
  return a.preferredTier !== null || a.contextAction !== null;
}

/** 渲染成给模型看的紧凑提示（空建议 ⇒ 空串，零行为）。
 *  recordedAt = 这份建议据的读数是什么时候记的（记录里的 ts）：带上就印「（记于 X）」戳。 */
export function renderAdvice(a: EvolutionAdvice, recordedAt?: number): string {
  const lines: string[] = [];
  if (a.preferredTier === "cheap") lines.push("- 路由：这一轮降一档到便宜模型，把贵档留给真正卡住的环节。");
  if (a.contextAction === "compress-early") lines.push("- 上下文：这一轮提前压缩，别等撞上预算上限。");
  if (lines.length === 0) return "";
  return "\n\n[evolution] 上一次读数推出的决策建议" + recordedAtStamp(recordedAt) + "：\n" + lines.join("\n");
}
