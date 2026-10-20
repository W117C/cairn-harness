// 「帮用户填写」的第三段：把探测结果（有什么模型）＋目录参数（窗口/价/推理档位）拼成
// 一份**可粘贴的** `.agent/providers.json`，并明确列出「这几项目录也不知道，得你自己填」。
//
// 为什么这一段值得单独成模块：它是纯函数（输入两段数据、输出一段文本 + 缺口清单），
// 而「缺口清单」正是本仓与同行拉开差距的地方 —— 2026-10-06 调研里，Cline/Roo 对未知模型
// 一律套 contextWindow 128000 / 价 0 的假兜底（Cline 自己的 UI 注释承认会把付费请求记成 $0）。
// 我们宁可把空格留在表上、并打印出来让用户去填。
//
// 走 io 的（发请求、读快照）都在 main/model-discovery.ts 与 main/catalog-store.ts，这里零 IO。

import type { CatalogPricing, CatalogSnapshot, CatalogSuggestion } from "./catalog";
import { suggestFromCatalog } from "./catalog";
import type { DiscoveredModel, DiscoveryProtocol } from "./discovery";
import { RESERVED_PROVIDER_IDS, isValidModelId } from "./provider-identifiers";

/** 模型级字段里「目录可能替我们填」的那几个（与 catalog.ts 的 CATALOG_FILLABLE_MODEL_FIELDS 同义，
 *  这里是给用户看的**配置字段名**：price / contextWindow / maxOutputTokens / reasoningEfforts）。 */
const DRAFT_FILLABLE = ["contextWindow", "maxOutputTokens", "price", "reasoningEfforts"] as const;
export type DraftFillableField = (typeof DRAFT_FILLABLE)[number];

/** 从接口地址推一个 provider id（**建议**，用户可改）。
 *  规则刻意简单可解释：取**可注册域那一段**（`api.deepseek.com` → `deepseek`、`openrouter.ai` → `openrouter`、
 *  `llm.mycompany.com` → `mycompany`），非 [a-z0-9-] 一律折成 `-`。
 *  为什么不取第一段：那一段通常是服务名前缀（`api` / `www`），取它会得到一堆叫 `api` 的 provider。
 *  撞上内置名（openai 等）时加 `-compat` 后缀 —— 直接占用内置名会被配置校验拒掉，先挪开一步。 */
export function suggestProviderId(baseURL: string): { id: string; note?: string } {
  let host = "";
  try {
    host = new URL(baseURL).hostname.toLowerCase();
  } catch {
    return { id: "custom", note: "地址解析不出主机名，先用 custom；请改成你认得出的名字" };
  }
  const labels = host.split(".").filter((x) => x !== "");
  // 可注册域 = 倒数第二段（三段以上）；只有两段时就是第一段；一段（localhost）就那一段。
  const registrable = labels.length >= 3 ? (labels[labels.length - 2] ?? "") : (labels[0] ?? "");
  let id = registrable.replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "");
  if (id === "" || id === "localhost" || /^\d+$/.test(id)) id = "custom";
  if (id.length > 32) id = id.slice(0, 32).replace(/-+$/, "");
  if ((RESERVED_PROVIDER_IDS as readonly string[]).includes(id)) {
    return { id: `${id}-compat`, note: `「${id}」是内置 provider 名，已让开成「${id}-compat」（你可以改）` };
  }
  return { id };
}

/** 从 provider id 推一个 key 环境变量名（建议）：deepseek → DEEPSEEK_API_KEY。 */
export function suggestApiKeyEnv(providerId: string): string {
  return `${providerId.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`;
}

/** 一条要写进草稿的模型。`origin` 只用于展示「这项是哪来的」，不参与配置本身。 */
export interface DraftModel {
  /** 上游调用名（写进 `model` 字段与配置里的 `id`）。 */
  id: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  price?: CatalogPricing;
  reasoningEfforts?: readonly string[];
  inputModalities?: readonly string[];
  origin: "discovery" | "catalog" | "both";
}

export interface ProviderDraftInput {
  providerId: string;
  label?: string;
  protocol: DiscoveryProtocol;
  baseURL: string;
  apiKeyEnv: string;
  models: readonly DraftModel[];
  /** 目录那边的建议（可选）：拿它判断某个字段是不是从目录来的。 */
  suggestion?: CatalogSuggestion;
}

export interface ProviderDraft {
  /** 可直接粘贴进 `.agent/providers.json` 的文本（`providers` 数组里的一项）。 */
  json: string;
  /** 目录与探测都拿不到、**必须用户自己填**的字段名（去重）。 */
  missing: readonly string[];
  warnings: readonly string[];
}

/** 缺口清单（哪些字段目录与探测都没给）。抽成独立函数是因为**命令行与桌面表单都要用它**，
 *  而两边算出不同的"待填项"就意味着有一个人在说谎。 */
export function draftGaps(models: readonly DraftModel[]): { missing: readonly string[]; warnings: readonly string[] } {
  const missing = new Set<string>();
  const warnings: string[] = [];
  for (const m of models) {
    for (const field of DRAFT_FILLABLE) {
      const value = field === "price" ? m.price : m[field];
      if (value === undefined) missing.add(field);
    }
  }
  const withoutPrice = models.filter((m) => m.price === undefined).length;
  if (withoutPrice > 0) {
    warnings.push(
      `${withoutPrice} 条模型没有价：美元闸对它们不生效（不会按 $0 计算，会明说「价格未知」）。要收紧成本就自己补 price。`,
    );
  }
  const withoutWindow = models.filter((m) => m.contextWindow === undefined).length;
  if (withoutWindow > 0) {
    warnings.push(
      `${withoutWindow} 条模型没给上下文窗口：装配时会按档位表里最小的那个算（低估只会提前压缩，高估会撞远端 400）。`,
    );
  }
  return { missing: DRAFT_FILLABLE.filter((f) => missing.has(f)), warnings };
}

/** 拼一份 provider 草稿。只写拿得到的字段 —— 拿不到的一律不出现在 JSON 里（留空 > 填假数）。
 *  另有一条硬要求：**产出必须能过我们自己的严格校验**。所以 id 不合规的模型在这里就被挡下并点名，
 *  而不是让用户把它粘进配置文件、再被校验器拒一次（那等于我们发了一份自己都不合法的模板）。 */
export function buildProviderDraft(input: ProviderDraftInput): ProviderDraft {
  const warnings: string[] = [];
  const skipped: string[] = [];
  const usable = input.models.filter((m) => {
    if (isValidModelId(m.id)) return true;
    skipped.push(m.id);
    return false;
  });
  if (skipped.length > 0) {
    warnings.push(
      `${skipped.length} 条模型的 id 不合规（只许字母数字与 . _ : / -），已省略：${skipped.join("、")}——如果它们对你有用，改个合规的 id 再加。`,
    );
  }
  const gaps = draftGaps(usable);
  const models = usable.map((m) => {
    return {
      id: m.id,
      model: m.id,
      ...(m.contextWindow !== undefined ? { contextWindow: m.contextWindow } : {}),
      ...(m.maxOutputTokens !== undefined ? { maxOutputTokens: m.maxOutputTokens } : {}),
      ...(m.price !== undefined ? { price: m.price } : {}),
      ...(m.reasoningEfforts !== undefined && m.reasoningEfforts.length > 0
        ? { reasoningEfforts: [...m.reasoningEfforts] }
        : {}),
      ...(m.inputModalities !== undefined && m.inputModalities.length > 0
        ? { inputModalities: [...m.inputModalities] }
        : {}),
    };
  });

  warnings.push(...gaps.warnings);

  const draft = {
    id: input.providerId,
    ...(input.label !== undefined && input.label !== "" ? { label: input.label } : {}),
    protocol: input.protocol,
    baseURL: input.baseURL,
    apiKeyEnv: input.apiKeyEnv,
    models,
  };
  return {
    json: JSON.stringify(draft, null, 2),
    missing: gaps.missing,
    warnings,
  };
}

/** 把探测结果与目录参数合并成「一行一条模型」。
 *
 *  优先级：**探测值优先**。理由是这两份数据的新鲜度与权威性不同——
 *  `/models` 是这家此刻自己说的话（DeepSeek 会带 context_window / max_output_tokens / 推理档位），
 *  而目录是第三方维护的快照（可能落后于厂商改名换代：实测 models.dev 里 DeepSeek 已换成 v4 系列）。
 *  目录只在探测没给这个字段时补上；两边都有就取探测的，并把来源标成 `both` 让人看得见。 */
export interface DiscoveredRow {
  id: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  price?: CatalogPricing;
  reasoningEfforts?: readonly string[];
  inputModalities?: readonly string[];
  origin: "discovery" | "catalog" | "both";
  /** 上游自述的可读名（有就带上，用于展示）。 */
  label?: string;
}

export interface MergeInput {
  models: readonly DiscoveredModel[];
  catalog: CatalogSnapshot;
  baseURL: string;
  /** 只要这一条（`--model <名字>`）；缺省全要。 */
  only?: string;
  /** 最多返回多少条（缺省 20）。参数填得多的排在前面 —— 一条能填满的比一条空白的更有用。 */
  limit?: number;
}

export interface MergeResult {
  rows: readonly DiscoveredRow[];
  /** 因为 limit 被省略掉的条数（>0 时必须显示出来，别让用户以为只有这些）。 */
  truncated: number;
  /** 目录认出了这家（展示用；认不出不影响探测结果可用）。 */
  matchedProviderId?: string;
  matchedKind?: "exact" | "host";
}

export const DEFAULT_DRAFT_LIMIT = 20;

export function mergeDiscoveredWithCatalog(input: MergeInput): MergeResult {
  const limit = input.limit ?? DEFAULT_DRAFT_LIMIT;
  const only = input.only?.trim();
  const wanted = only === undefined || only === "" ? input.models : input.models.filter((m) => m.id === only);
  const rows: DiscoveredRow[] = [];
  let matchedProviderId: string | undefined;
  let matchedKind: "exact" | "host" | undefined;
  for (const m of wanted) {
    const s = suggestFromCatalog({ catalog: input.catalog, baseURL: input.baseURL, modelId: m.id });
    if (s.provider !== undefined && matchedProviderId === undefined) {
      matchedProviderId = s.provider.id;
      matchedKind = s.matchKind;
    }
    const contextWindow = m.contextWindow ?? s.model?.contextWindow;
    const maxOutputTokens = m.maxOutputTokens ?? s.model?.maxOutputTokens;
    const price = s.model?.pricing;
    const anyDiscovery = m.contextWindow !== undefined || m.maxOutputTokens !== undefined || m.reasoningEfforts !== undefined;
    const anyCatalog = s.model?.contextWindow !== undefined || s.model?.maxOutputTokens !== undefined || price !== undefined;
    const inputModalities = m.inputModalities ?? s.model?.inputModalities;
    rows.push({
      id: m.id,
      ...(m.label !== undefined ? { label: m.label } : {}),
      ...(contextWindow !== undefined ? { contextWindow } : {}),
      ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
      ...(price !== undefined ? { price } : {}),
      ...(m.reasoningEfforts !== undefined ? { reasoningEfforts: m.reasoningEfforts } : {}),
      ...(inputModalities !== undefined ? { inputModalities } : {}),
      origin: anyDiscovery && anyCatalog ? "both" : anyDiscovery ? "discovery" : "catalog",
    });
  }
  // 参数填得多的排前面；同分保持上游顺序（Array.prototype.sort 自 ES2019 起稳定，但仍显式带下标兜底）。
  const scored = rows.map((row, i) => ({
    row,
    i,
    filled: [row.contextWindow, row.maxOutputTokens, row.price, row.reasoningEfforts].filter((x) => x !== undefined).length,
  }));
  scored.sort((a, b) => b.filled - a.filled || a.i - b.i);
  const kept = scored.slice(0, limit).map((x) => x.row);
  return {
    rows: kept,
    truncated: Math.max(0, scored.length - kept.length),
    ...(matchedProviderId !== undefined ? { matchedProviderId } : {}),
    ...(matchedKind !== undefined ? { matchedKind } : {}),
  };
}

/** 把草稿包成完整的 `.agent/providers.json` 文件文本（version + providers 数组）。 */
export function wrapProvidersFile(drafts: readonly string[]): string {
  return `{\n  "version": 1,\n  "providers": [\n${drafts.map((d) => indent(d, 4)).join(",\n")}\n  ]\n}\n`;
}

function indent(text: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => (line === "" ? line : pad + line))
    .join("\n");
}
