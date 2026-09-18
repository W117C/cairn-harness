// M6 价格表（§m5-proposal §1.3 口径备案升级：bandit 代价项从「token 用量代理」换成真钱）。
// 单价 = USD / 每百万 token（输入/输出分列）。档位间单价差是路由省钱的真实机制。
// **价格为占位口径**——需联网实测校准（m5-acceptance C5；GLM 实际计价见 M0_API_KEY 环境备注）。
import { DEFAULT_MODEL_TABLE, type ModelSpec } from "../providers/registry";

export interface ModelPrice {
  /** USD / 每百万输入 token。 */
  inputPerMTok: number;
  /** USD / 每百万输出 token。 */
  outputPerMTok: number;
  /** 缓存命中读价（USD/百万）。**null = 待联网实测校准**（2026-09-19 裁决：不编数）。
   *  未标定期间按 inputPerMTok **上界**计——宁可高估缓存的成本，也不把命中当免费而误判路由。 */
  cacheReadPerMTok: number | null;
  /** 缓存写入价（USD/百万，Anthropic 显式断点会产生写桶）。同上：null = 未标定，按输入价上界计。 */
  cacheWritePerMTok: number | null;
}

/** 未标定缓存价的档位（审计面：待校准清单，不是 folklore）。 */
export function uncalibratedCachePrices(
  table: Readonly<Record<string, ModelPrice>> = DEFAULT_PRICE_TABLE,
): string[] {
  return Object.keys(table).filter((id) => table[id].cacheReadPerMTok === null || table[id].cacheWritePerMTok === null).sort();
}

/** 缓存价共用「未标定」值：联网实测后按档位逐条覆盖（覆盖一处即该档转精确计价）。 */
const CACHE_UNCALIBRATED = { cacheReadPerMTok: null, cacheWritePerMTok: null } as const;

/** 缺省价格表（key = 档位表 id；占位价，实施时以各厂商公开价目校准）。 */
export const DEFAULT_PRICE_TABLE: Readonly<Record<string, ModelPrice>> = {
  // GLM（智谱）
  "glm-flash": { inputPerMTok: 0.2, outputPerMTok: 0.2, ...CACHE_UNCALIBRATED },
  "glm-standard": { inputPerMTok: 2.0, outputPerMTok: 2.0, ...CACHE_UNCALIBRATED },
  "glm-strong": { inputPerMTok: 8.0, outputPerMTok: 8.0, ...CACHE_UNCALIBRATED },
  // OpenAI
  "openai-cheap": { inputPerMTok: 0.15, outputPerMTok: 0.6, ...CACHE_UNCALIBRATED },
  "openai-standard": { inputPerMTok: 2.5, outputPerMTok: 10.0, ...CACHE_UNCALIBRATED },
  "openai-strong": { inputPerMTok: 5.0, outputPerMTok: 15.0, ...CACHE_UNCALIBRATED },
  // Anthropic
  "anthropic-cheap": { inputPerMTok: 0.8, outputPerMTok: 4.0, ...CACHE_UNCALIBRATED },
  "anthropic-standard": { inputPerMTok: 3.0, outputPerMTok: 15.0, ...CACHE_UNCALIBRATED },
  "anthropic-strong": { inputPerMTok: 5.0, outputPerMTok: 25.0, ...CACHE_UNCALIBRATED },
  // Gemini
  "gemini-cheap": { inputPerMTok: 0.1, outputPerMTok: 0.4, ...CACHE_UNCALIBRATED },
  "gemini-standard": { inputPerMTok: 1.25, outputPerMTok: 10.0, ...CACHE_UNCALIBRATED },
  "gemini-strong": { inputPerMTok: 2.0, outputPerMTok: 15.0, ...CACHE_UNCALIBRATED },
};

/** 查价；未知 id fail-visible 抛错（不静默按 0 算——价格面缺失必须显式）。 */
export function priceOf(id: string, table: Readonly<Record<string, ModelPrice>> = DEFAULT_PRICE_TABLE): ModelPrice {
  const p = table[id];
  if (!p) throw new Error(`未知 model 价格: ${JSON.stringify(id)}（价格表键：${Object.keys(table).join(", ")}）`);
  return p;
}

/** 真钱成本（USD）：usage tokens × 单价折算。
 *  缓存分块（usage 可选带 `cacheReadInputTokens`/`cacheWriteInputTokens`，口径 = 事件层约定：
 *  `inputTokens` 含缓存，两个分块是其中的一部分）：先剥出未命中段按输入价，缓存段各按自己的价；
 *  价未标定（null）时**回落到输入价上界**——与不传分块时逐字同值（零回归），
 *  标定后自动转精确（缓存段通常远低于输入价）。 */
export function costUsd(
  id: string,
  usage: { inputTokens: number; outputTokens: number; cacheReadInputTokens?: number; cacheWriteInputTokens?: number },
  table: Readonly<Record<string, ModelPrice>> = DEFAULT_PRICE_TABLE,
): number {
  const p = priceOf(id, table);
  const read = Math.max(0, Math.min(usage.cacheReadInputTokens ?? 0, usage.inputTokens));
  const write = Math.max(0, Math.min(usage.cacheWriteInputTokens ?? 0, usage.inputTokens - read));
  const plain = usage.inputTokens - read - write;
  const readRate = p.cacheReadPerMTok ?? p.inputPerMTok;
  const writeRate = p.cacheWritePerMTok ?? p.inputPerMTok;
  return (plain * p.inputPerMTok + read * readRate + write * writeRate + usage.outputTokens * p.outputPerMTok) / 1_000_000;
}

/** 档位价格面（纯查询）：某 provider 某档的单价（路由代价项的来源；缺省表）。 */
export function priceOfSpec(spec: ModelSpec, table: Readonly<Record<string, ModelPrice>> = DEFAULT_PRICE_TABLE): ModelPrice {
  return priceOf(spec.id, table);
}

/** 白名单覆盖检查：价格表必须覆盖档位表全部 id（漂移护栏——新增 model 忘配价 = 显式失败）。 */
export function priceCoverage(table: Readonly<Record<string, ModelPrice>> = DEFAULT_PRICE_TABLE): string[] {
  return DEFAULT_MODEL_TABLE.filter((s) => table[s.id] === undefined).map((s) => s.id);
}
