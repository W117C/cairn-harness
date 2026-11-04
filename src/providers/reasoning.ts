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

/** 档位 → 思考预算（token）。低→中→高→最高单调递增；max 对应上游自述的最高档（如 DeepSeek）。 */
export const REASONING_BUDGET_TOKENS: Readonly<Record<ActiveReasoningEffort, number>> = {
  low: 1_024,
  medium: 4_096,
  high: 16_384,
  max: 65_536,
};

export interface ReasoningDirective {
  effort: ActiveReasoningEffort;
  budgetTokens: number;
}

/** 我们支持的档位名（顺序即展示顺序；"off" 由调用方另行处理）。 */
export const ACTIVE_REASONING_EFFORTS: readonly ActiveReasoningEffort[] = ["low", "medium", "high", "max"];

/** 档位 → 中立描述；"off" / 未给 ⇒ null（= 请求体里一个字都不加，逐字保持旧行为）。 */
export function reasoningDirective(effort: ThinkingEffort | undefined): ReasoningDirective | null {
  if (effort === undefined || effort === "off") return null;
  return { effort, budgetTokens: REASONING_BUDGET_TOKENS[effort] };
}

/** 上游自述的档位名 → 我们的档位名。认不出的**丢掉**（不猜、不硬塞）。
 *
 *  为什么需要别名表：各家的档位词汇不一样。实测 DeepSeek 的 `/models` 给 `["low","high","max"]`，
 *  OpenRouter 的 `reasoning.supported_efforts` 会给 `minimal|xhigh|max` 之类。我们有五档
 *  （off/low/medium/high/max）：max 是**上游自述的最高档字面量**，原样保留；xhigh 这类
 *  「比 high 更高但没有 max 名字」的仍保守落在 high（**宁可发小一档**：发大了是烧钱与跑偏）。
 *  这张表是唯一映射处，别处不要再抄。 */
const EFFORT_ALIASES: Readonly<Record<string, ActiveReasoningEffort>> = {
  low: "low",
  minimal: "low",
  medium: "medium",
  high: "high",
  xhigh: "high",
  max: "max",
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

/** 一个模型的思考声明：**支持哪些档**（四档里挑，空 = 不支持）+ **首选哪一档**。
 *
 *  为什么合成一处：「哪些名字算数」「首选档怎么定」此前要在配置校验、能力表、设置表单三处各判一次，
 *  那就是三份会漂移的副本。这里规范化一次，三处都调它 —— 「默认值不另拄一份」这条纪律的实现。
 *  · 认不出的档位名**不在这里判错**（原样放进 `unknown`）：配置层拿它出问题单，界面层直接忽略。
 *  · 「off」写进档位列表里 ≡ 没写（它是「不发思考参数」，不是一档能力）；「空列表 = 不支持」照旧。 */
export interface ThinkingDeclaration {
  /** 规范化后的支持档（低→高、去重、不含 "off"）。空数组 = 该模型不支持思考。 */
  levels: ActiveReasoningEffort[];
  /** **生效**的首选档：声明里写了、且确实在 levels 里 ⇒ 用它；否则 "off"（不替用户开花钱的档）。 */
  default: ThinkingEffort;
  /** 声明里那个首选档映射后的值（没写 ⇒ 缺席）；调用方据此区分「没写」与「写了但不在支持集里」。 */
  preferred?: ThinkingEffort;
  /** 认不出的档位名（原样回传，去空白）。 */
  unknown: string[];
}

/** 单个档位名 → 我们的档位名；"off" 单独认（它不是 EFFORT_ALIASES 里的成员）；认不出 ⇒ undefined。 */
function mapLevelToken(raw: unknown): ActiveReasoningEffort | "off" | undefined {
  if (typeof raw !== "string") return undefined;
  const token = raw.trim().toLowerCase();
  if (token === "") return undefined;
  if (token === "off") return "off";
  return EFFORT_ALIASES[token];
}

export function normalizeThinkingDeclaration(levels: readonly unknown[], preferred?: unknown): ThinkingDeclaration {
  const unknown: string[] = [];
  const seen = new Set<ActiveReasoningEffort>();
  for (const raw of levels) {
    const mapped = mapLevelToken(raw);
    if (mapped === undefined) {
      if (typeof raw === "string" && raw.trim() !== "") unknown.push(raw.trim());
      continue;
    }
    if (mapped !== "off") seen.add(mapped);
  }
  const ordered = ACTIVE_REASONING_EFFORTS.filter((e) => seen.has(e));
  const mappedPreferred = mapLevelToken(preferred);
  if (mappedPreferred === undefined && typeof preferred === "string" && preferred.trim() !== "") unknown.push(preferred.trim());
  // 首选档只在「声明了它、且它真在支持集里」时生效：写了 high 却只声明 [low] ⇒ 回 off，不偷偷发更大的档。
  const effective: ThinkingEffort =
    mappedPreferred !== undefined && mappedPreferred !== "off" && ordered.includes(mappedPreferred) ? mappedPreferred : "off";
  return {
    levels: ordered,
    default: effective,
    ...(mappedPreferred !== undefined ? { preferred: mappedPreferred } : {}),
    unknown,
  };
}
