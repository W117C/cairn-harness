// 思考档位（thinking / reasoning）→ 各协议 wire 参数的**唯一映射处**。
//
// 为什么单独成模块：这条事实在本仓曾经出现过"四个环节都铺好、只差最后一跳"的形态
// （`ipc-protocol` 有 thinking 字段、`agent-runner` 收下并校验、`capabilities` 老实写着 supported=false、
// 渲染层留了一行"推理流未接线"的占位）—— 也就是说参数被收下、校验完、然后**丢掉**。
// 这个文件就是那最后一跳的映射表：档位名 → 每家的数值形态。
//
// 三个协议的形态不同，所以这里只产出**中立描述**，各家适配器自己决定往 body 的哪儿放：
//   · openai 兼容（含 DeepSeek）：body.reasoning_effort = "low"|"medium"|"high"
//   · anthropic：body.thinking = { type: "enabled", budget_tokens: N }（且 max_tokens 必须 > N）
//   · gemini：generationConfig.thinkingConfig.thinkingBudget = N
//
// 数值是**我们自己的**档位刻度，不是任何一家的官方推荐值；它们只保证「低/中/高」单调递增、
// 且高不过常见的单轮输出上限。真要精确对齐某家，应由该家自己的 `/models` 自述（DeepSeek 会给
// `effort.supported_levels`）来决定**有没有**，数值仍取本表 —— 上游给的是档位名，不是 token 数。
import type { ThinkingEffort } from "./capabilities";

/** 真正会发出去的档位（"off" 不在其中：关闭 = 不发这个字段）。 */
export type ActiveReasoningEffort = Exclude<ThinkingEffort, "off">;

/** 档位 → 思考预算（token）。低/中/高单调递增。 */
export const REASONING_BUDGET_TOKENS: Readonly<Record<ActiveReasoningEffort, number>> = {
  low: 1_024,
  medium: 4_096,
  high: 16_384,
};

export interface ReasoningDirective {
  effort: ActiveReasoningEffort;
  budgetTokens: number;
}

/** 我们支持的档位名（顺序即展示顺序；"off" 由调用方另行处理）。 */
export const ACTIVE_REASONING_EFFORTS: readonly ActiveReasoningEffort[] = ["low", "medium", "high"];

/** 档位 → 中立描述；"off" / 未给 ⇒ null（= 请求体里一个字都不加，逐字保持旧行为）。 */
export function reasoningDirective(effort: ThinkingEffort | undefined): ReasoningDirective | null {
  if (effort === undefined || effort === "off") return null;
  return { effort, budgetTokens: REASONING_BUDGET_TOKENS[effort] };
}

/** 上游自述的档位名 → 我们的档位名。认不出的**丢掉**（不猜、不硬塞）。
 *
 *  为什么需要别名表：各家的档位词汇不一样。实测 DeepSeek 的 `/models` 给 `["low","high","max"]`，
 *  OpenRouter 的 `reasoning.supported_efforts` 会给 `minimal|xhigh|max` 之类。我们有四档
 *  （off/low/medium/high），所以：比最低档还低的叫 low，比最高档还高的叫 high（**宁可发小一档**：
 *  发大了是烧钱与跑偏，发小了只是思考少一点）。这张表是唯一映射处，别处不要再抄。 */
const EFFORT_ALIASES: Readonly<Record<string, ActiveReasoningEffort>> = {
  low: "low",
  minimal: "low",
  medium: "medium",
  high: "high",
  xhigh: "high",
  max: "high",
};

export function mapUpstreamEfforts(names: readonly string[]): ActiveReasoningEffort[] {
  const out: ActiveReasoningEffort[] = [];
  for (const raw of names) {
    const mapped = EFFORT_ALIASES[raw.trim().toLowerCase()];
    if (mapped !== undefined && !out.includes(mapped)) out.push(mapped);
  }
  // 按我们自己的顺序稳定输出（低→高），免得配置里的书写顺序影响展示
  return ACTIVE_REASONING_EFFORTS.filter((e) => out.includes(e));
}
