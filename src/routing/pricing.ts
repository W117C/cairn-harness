// M6 价格表（§m5-proposal §1.3 口径备案升级：bandit 代价项从「token 用量代理」换成真钱）。
// 单价 = USD / 每百万 token（输入/输出分列）。档位间单价差是路由省钱的真实机制。
// **价格为占位口径**——需联网实测校准（m5-acceptance C5；GLM 实际计价见 M0_API_KEY 环境备注）。
import { DEFAULT_MODEL_TABLE, type ModelSpec } from "../providers/registry";

export interface ModelPrice {
  /** USD / 每百万输入 token。 */
  inputPerMTok: number;
  /** USD / 每百万输出 token。 */
  outputPerMTok: number;
}

/** 缺省价格表（key = 档位表 id；占位价，实施时以各厂商公开价目校准）。 */
export const DEFAULT_PRICE_TABLE: Readonly<Record<string, ModelPrice>> = {
  // GLM（智谱）
  "glm-flash": { inputPerMTok: 0.2, outputPerMTok: 0.2 },
  "glm-standard": { inputPerMTok: 2.0, outputPerMTok: 2.0 },
  "glm-strong": { inputPerMTok: 8.0, outputPerMTok: 8.0 },
  // OpenAI
  "openai-cheap": { inputPerMTok: 0.15, outputPerMTok: 0.6 },
  "openai-standard": { inputPerMTok: 2.5, outputPerMTok: 10.0 },
  "openai-strong": { inputPerMTok: 5.0, outputPerMTok: 15.0 },
  // Anthropic
  "anthropic-cheap": { inputPerMTok: 0.8, outputPerMTok: 4.0 },
  "anthropic-standard": { inputPerMTok: 3.0, outputPerMTok: 15.0 },
  "anthropic-strong": { inputPerMTok: 5.0, outputPerMTok: 25.0 },
  // Gemini
  "gemini-cheap": { inputPerMTok: 0.1, outputPerMTok: 0.4 },
  "gemini-standard": { inputPerMTok: 1.25, outputPerMTok: 10.0 },
  "gemini-strong": { inputPerMTok: 2.0, outputPerMTok: 15.0 },
};

/** 查价；未知 id fail-visible 抛错（不静默按 0 算——价格面缺失必须显式）。 */
export function priceOf(id: string, table: Readonly<Record<string, ModelPrice>> = DEFAULT_PRICE_TABLE): ModelPrice {
  const p = table[id];
  if (!p) throw new Error(`未知 model 价格: ${JSON.stringify(id)}（价格表键：${Object.keys(table).join(", ")}）`);
  return p;
}

/** 真钱成本（USD）：usage tokens × 单价折算。 */
export function costUsd(
  id: string,
  usage: { inputTokens: number; outputTokens: number },
  table: Readonly<Record<string, ModelPrice>> = DEFAULT_PRICE_TABLE,
): number {
  const p = priceOf(id, table);
  return (usage.inputTokens * p.inputPerMTok + usage.outputTokens * p.outputPerMTok) / 1_000_000;
}

/** 档位价格面（纯查询）：某 provider 某档的单价（路由代价项的来源；缺省表）。 */
export function priceOfSpec(spec: ModelSpec, table: Readonly<Record<string, ModelPrice>> = DEFAULT_PRICE_TABLE): ModelPrice {
  return priceOf(spec.id, table);
}

/** 白名单覆盖检查：价格表必须覆盖档位表全部 id（漂移护栏——新增 model 忘配价 = 显式失败）。 */
export function priceCoverage(table: Readonly<Record<string, ModelPrice>> = DEFAULT_PRICE_TABLE): string[] {
  return DEFAULT_MODEL_TABLE.filter((s) => table[s.id] === undefined).map((s) => s.id);
}
