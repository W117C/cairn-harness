// M6 价格表（§m5-proposal §1.3 口径备案升级：bandit 代价项从「token 用量代理」换成真钱）。
// 单价 = USD / 每百万 token（输入/输出分列）。档位间单价差是路由省钱的真实机制。
//
// **标定纪律**：`calibrated: true` 只给当日在**厂商官方页**读到过数字的行；没读到的行保持占位数
// 且不打标 ⇒ `unpricedModels()` 把它列出来。bandit 的代价项直接吃这张表，所以「未标定」
// 不是措辞谨慎，而是「别拿这个数证明省了钱」。
// 官方源（2026-09-19 联网实测，均取 ≤ 上下文阈值的第一档价）：
//   · Anthropic platform.claude.com/docs/en/about-claude/pricing —— Haiku 4.5 $1/$5、
//     Sonnet 5 $2/$10、Opus 5 $5/$25；缓存写 = 输入价 ×1.25、命中读 = 输入价 ×0.1。
//   · OpenAI developers.openai.com/api/docs/pricing —— gpt-4o-mini $0.15/$0.60 cached $0.075、
//     gpt-4o $2/$10 cached $1.25、o3 $2/$8 cached $0.50；写侧价厂商未单列 ⇒ 留 null。
//   · Gemini ai.google.dev/gemini-api/docs/pricing —— 2.5-Flash $0.30/$2.50 cache read $0.03、
//     3.8-Flash $0.75/$3.75 cache read $0.075、2.5-Pro $1.25/$10 cache read $0.125。
//   · 智谱 docs.bigmodel.cn 的定价页是 JS 渲染，**官方数字没抓到** ⇒ GLM 三行仍是占位（未证）。
//     第三方报道的「GLM-5.2 输入 8 元 / 输出 28 元 每百万 tokens」按未证处理，不写进数表。
import { DEFAULT_MODEL_TABLE } from "../providers/registry";

export interface ModelPrice {
  /** USD / 每百万输入 token。 */
  inputPerMTok: number;
  /** USD / 每百万输出 token。 */
  outputPerMTok: number;
  /** 缓存命中读价（USD/百万）。**null = 厂商未公开或未实测**（2026-09-19 裁决：不编数）。
   *  未标定期间按 inputPerMTok **上界**计——宁可高估缓存的成本，也不把命中当免费而误判路由。 */
  cacheReadPerMTok: number | null;
  /** 缓存写入价（USD/百万，Anthropic 显式断点会产生写桶）。同上：null = 未标定，按输入价上界计。 */
  cacheWritePerMTok: number | null;
  /** 输入/输出价当日在厂商官方页读到过。缺省 = 占位口径（`unpricedModels()` 会列出）。 */
  calibrated?: true;
}

/** 未标定缓存价的档位（审计面：待校准清单，不是 folklore）。
 *  ⚠️ 这份清单同时是**代价项偏置的知情记录**：`promptCache` 缺省已开（2026-09-19 裁决），
 *  而这里列出的档位因某个缓存价仍为 null，`costUsd` 把该段按**输入价上界**计 ⇒
 *  bandit 的代价项对这些档位**系统性高估**（不是「缓存省钱了」的证据）。
 *  两条不许走的路：① 为让路由看起来赚了而填一个数——那张表仍须联网实测；
 *  ② 把这条偏置当已通过项——provider 是否真回 `cache_read_input_tokens` 属**未证 ≠ 通过**，
 *  `DSH_STRICT_UNVERIFIED=1` 下相关联网项继红。 */
export function uncalibratedCachePrices(
  table: Readonly<Record<string, ModelPrice>> = DEFAULT_PRICE_TABLE,
): string[] {
  return Object.keys(table).filter((id) => table[id].cacheReadPerMTok === null || table[id].cacheWritePerMTok === null).sort();
}

/** 输入/输出价仍是占位的档位（官方页没读到过数字 ⇒ 路由代价项不可当省钱证据）。 */
export function unpricedModels(
  table: Readonly<Record<string, ModelPrice>> = DEFAULT_PRICE_TABLE,
): string[] {
  return Object.keys(table).filter((id) => table[id].calibrated !== true).sort();
}

/** 缓存价共用「未标定」值：联网实测后按档位逐条覆盖（覆盖一处即该档转精确计价）。 */
const CACHE_UNCALIBRATED = { cacheReadPerMTok: null, cacheWritePerMTok: null } as const;

/** 缺省价格表（key = 档位表 id；打 `calibrated` 的行是厂商官方页实测值，GLM 三行仍是占位）。 */
export const DEFAULT_PRICE_TABLE: Readonly<Record<string, ModelPrice>> = {
  // GLM（智谱）——占位：官方定价页 JS 渲染未取到数（见文件头），三行一律不打 calibrated
  "glm-flash": { inputPerMTok: 0.2, outputPerMTok: 0.2, ...CACHE_UNCALIBRATED },
  "glm-standard": { inputPerMTok: 2.0, outputPerMTok: 2.0, ...CACHE_UNCALIBRATED },
  "glm-strong": { inputPerMTok: 8.0, outputPerMTok: 8.0, ...CACHE_UNCALIBRATED },
  // OpenAI（cached input 实测；写侧价厂商未单列 ⇒ null，仍留在缓存待标定清单里）
  "openai-cheap": { inputPerMTok: 0.15, outputPerMTok: 0.6, cacheReadPerMTok: 0.075, cacheWritePerMTok: null, calibrated: true },
  "openai-standard": { inputPerMTok: 2.0, outputPerMTok: 10.0, cacheReadPerMTok: 1.25, cacheWritePerMTok: null, calibrated: true },
  "openai-strong": { inputPerMTok: 2.0, outputPerMTok: 8.0, cacheReadPerMTok: 0.5, cacheWritePerMTok: null, calibrated: true },
  // Anthropic（写 = 输入 ×1.25、读 = 输入 ×0.1，官方页实测；档位表模型名同步换成现行 id）
  "anthropic-cheap": { inputPerMTok: 1.0, outputPerMTok: 5.0, cacheReadPerMTok: 0.1, cacheWritePerMTok: 1.25, calibrated: true },
  "anthropic-standard": { inputPerMTok: 2.0, outputPerMTok: 10.0, cacheReadPerMTok: 0.2, cacheWritePerMTok: 2.5, calibrated: true },
  "anthropic-strong": { inputPerMTok: 5.0, outputPerMTok: 25.0, cacheReadPerMTok: 0.5, cacheWritePerMTok: 6.25, calibrated: true },
  // Gemini（现行 catalog：2.0-flash 已 shut down ⇒ cheap 换 2.5-flash，strong 换 2.5-pro）
  "gemini-cheap": { inputPerMTok: 0.3, outputPerMTok: 2.5, cacheReadPerMTok: 0.03, cacheWritePerMTok: null, calibrated: true },
  "gemini-standard": { inputPerMTok: 0.75, outputPerMTok: 3.75, cacheReadPerMTok: 0.075, cacheWritePerMTok: null, calibrated: true },
  "gemini-strong": { inputPerMTok: 1.25, outputPerMTok: 10.0, cacheReadPerMTok: 0.125, cacheWritePerMTok: null, calibrated: true },
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

/** 已校准行里**最不利**的输出/输入单价比（PC7 的摊销判据用它）。
 *  为什么不把比值写死在判据里：那样加一档更贵的输出价时判据不会跟着收紧（机制判据挂现状不挂抄本）。
 *  只算 `calibrated: true` 的行——占位数（GLM 三档）按本文件口径不可当省钱证据，宁可让线由已校准行决定。 */
export function worstCalibratedOutputRatio(
  table: Readonly<Record<string, ModelPrice>> = DEFAULT_PRICE_TABLE,
): number {
  let worst = 0;
  for (const p of Object.values(table)) {
    if (!p.calibrated || p.inputPerMTok <= 0) continue;
    worst = Math.max(worst, p.outputPerMTok / p.inputPerMTok);
  }
  return worst;
}

/** 白名单覆盖检查：价格表必须覆盖档位表全部 id（漂移护栏——新增 model 忘配价 = 显式失败）。 */
export function priceCoverage(table: Readonly<Record<string, ModelPrice>> = DEFAULT_PRICE_TABLE): string[] {
  return DEFAULT_MODEL_TABLE.filter((s) => table[s.id] === undefined).map((s) => s.id);
}
