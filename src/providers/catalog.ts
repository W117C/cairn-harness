// 模型目录（catalog）：把「这家有哪些模型、能装多少字、多少钱、支不支持思考」变成一份可查的表。
//
// 为什么需要这一层（2026-10-06 对 8 个同类产品的调研结论，出处见 docs）：
//   全行业都是三段式——① 问上游 `GET /models` 拿一份**清单**（实测各家都只回 id，DeepSeek 这类才多带
//   窗口与推理档位）；② 拿 id 去一本**公共目录**查参数与价格；③ 查不到就留空让用户填。
//   我们此前只有一张手写的 12 行表，三段里一段都没有。
//
// 本文件是**纯逻辑**：解析上游目录形状 + 查询。发请求、读写缓存、判 SSRF 都不在这里（见 catalog-store）。
//
// 三条纪律：
//   1. **解析不到的字段一律缺省（undefined）**，绝不替上游补一个数字——与 providers/discovery.ts 同源。
//   2. **读数来源必须可分辨**（snapshot / cache / live）：回退到内置快照这件事要说得出来，
//      不许让用户以为表格里的数字是刚拉的。
//   3. 单位统一成「美元 / 每百万 token」。上游各家单位不一样（models.dev 是每百万 token 数字、
//      OpenRouter 是每 token 字符串），换算只许在这里做一次。

/** 一套价格（美元 / 每百万 token）。四个字段各自可能缺席 —— 缺席就是这家没给这个口径。 */
export interface CatalogPricing {
  inputPerMTok?: number;
  outputPerMTok?: number;
  cacheReadPerMTok?: number;
  cacheWritePerMTok?: number;
}

/** 推理档位：上游怎么描述「这个模型能怎么想」。三种形态都见过（models.dev 的 reasoning_options）。 */
export interface CatalogReasoningOption {
  /** `effort` = 传档位名（low/medium/high…）；`toggle` = 只有开/关；`budget_tokens` = 传 token 预算。 */
  type: "effort" | "toggle" | "budget_tokens";
  /** 仅 effort 有：允许的档位值。 */
  values?: readonly string[];
  /** 仅 budget_tokens 有。 */
  min?: number;
  max?: number;
}

/** 目录里的一条模型。除 `id` 外全部可能缺席。 */
export interface CatalogModel {
  /** 上游调用名（写进请求体的那个）。 */
  id: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  pricing?: CatalogPricing;
  inputModalities?: readonly string[];
  /** 上游明说支持推理/思考。缺席 = 没说，不是「不支持」。 */
  reasoning?: boolean;
  reasoningOptions?: readonly CatalogReasoningOption[];
  toolCall?: boolean;
}

/** 目录里的一家 provider。 */
export interface CatalogProvider {
  id: string;
  name?: string;
  /** 这家自述的 OpenAI 兼容 base URL（models.dev 的 `api`，226 家里 200 家有）。 */
  apiBaseURL?: string;
  /** 这家用的 key 环境变量名（models.dev 的 `env`）。 */
  envKeys?: readonly string[];
  models: readonly CatalogModel[];
}

export interface CatalogSnapshot {
  version: 1;
  /** 数据来源标识（如 "models.dev"）；证明「这份数据是谁给的」。 */
  source: string;
  /** 生成时间（ISO）；内置快照会带，运行时刷新也会带 —— 用户要能看出这份读数有多旧。 */
  generatedAt?: string;
  providers: readonly CatalogProvider[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 非负有限数；字符串数字也收（上游把价格写成字符串是常态），空串/坏串 ⇒ undefined。 */
function num(v: unknown): number | undefined {
  const raw = typeof v === "string" ? v.trim() : v;
  if (typeof raw === "string") {
    if (raw === "") return undefined;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  }
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return undefined;
  return raw;
}

/** 正数字段（token 上限这类）：字符串**不收**——那本该是数字，悄悄转等于替上游编类型。 */
function posInt(v: unknown): number | undefined {
  return typeof v === "number" && Number.isInteger(v) && v > 0 ? v : undefined;
}

function strList(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim());
  return out.length === 0 ? undefined : out;
}

/** models.dev 的 `cost` → 我们的四字段。上游已是「每百万 token 美元」，不做换算。 */
function pricingFromModelsDev(cost: unknown): CatalogPricing | undefined {
  if (!isRecord(cost)) return undefined;
  const p: CatalogPricing = {
    ...(num(cost.input) !== undefined ? { inputPerMTok: num(cost.input) } : {}),
    ...(num(cost.output) !== undefined ? { outputPerMTok: num(cost.output) } : {}),
    ...(num(cost.cache_read) !== undefined ? { cacheReadPerMTok: num(cost.cache_read) } : {}),
    ...(num(cost.cache_write) !== undefined ? { cacheWritePerMTok: num(cost.cache_write) } : {}),
  };
  return Object.keys(p).length === 0 ? undefined : p;
}

function reasoningOptionsFromModelsDev(raw: unknown): CatalogReasoningOption[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: CatalogReasoningOption[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const type = item.type;
    if (type !== "effort" && type !== "toggle" && type !== "budget_tokens") continue;
    const values = strList(item.values);
    const min = num(item.min);
    const max = num(item.max);
    out.push({
      type,
      ...(values !== undefined ? { values } : {}),
      ...(min !== undefined ? { min } : {}),
      ...(max !== undefined ? { max } : {}),
    });
  }
  return out.length === 0 ? undefined : out;
}

function modelFromModelsDev(id: string, m: Record<string, unknown>): CatalogModel {
  const limit = isRecord(m.limit) ? m.limit : {};
  const modalities = isRecord(m.modalities) ? m.modalities : {};
  const pricing = pricingFromModelsDev(m.cost);
  const inputModalities = strList(modalities.input);
  const reasoningOptions = reasoningOptionsFromModelsDev(m.reasoning_options);
  return {
    id,
    ...(posInt(limit.context) !== undefined ? { contextWindow: posInt(limit.context) } : {}),
    ...(posInt(limit.output) !== undefined ? { maxOutputTokens: posInt(limit.output) } : {}),
    ...(pricing !== undefined ? { pricing } : {}),
    ...(inputModalities !== undefined ? { inputModalities } : {}),
    ...(m.reasoning === true ? { reasoning: true } : {}),
    ...(reasoningOptions !== undefined ? { reasoningOptions } : {}),
    ...(m.tool_call === true ? { toolCall: true } : {}),
  };
}

/** 解析 models.dev `api.json`（运行时刷新用）。形状：`{ <providerId>: { id, name, api, env, models: {<id>: {...}} } }`。
 *  认不出的顶层形状**抛**——返回空目录会被读成「这家目录是空的」，比报错更坏（同 discovery.ts 的纪律）。 */
export function parseModelsDevCatalog(payload: unknown): CatalogSnapshot {
  if (!isRecord(payload)) throw new Error("模型目录：认不出 models.dev 响应形状（顶层不是对象）");
  const providers: CatalogProvider[] = [];
  for (const [pid, p] of Object.entries(payload)) {
    if (!isRecord(p)) continue;
    const modelsRaw = isRecord(p.models) ? p.models : {};
    const models: CatalogModel[] = [];
    for (const [mid, m] of Object.entries(modelsRaw)) {
      if (!isRecord(m)) continue;
      const id = typeof m.id === "string" && m.id.trim() !== "" ? m.id.trim() : mid;
      models.push(modelFromModelsDev(id, m));
    }
    if (models.length === 0) continue; // 没有模型的条目对填表毫无用处
    const name = typeof p.name === "string" && p.name.trim() !== "" ? p.name.trim() : undefined;
    const api = typeof p.api === "string" && p.api.trim() !== "" ? p.api.trim() : undefined;
    const envKeys = strList(p.env);
    providers.push({
      id: pid,
      ...(name !== undefined ? { name } : {}),
      ...(api !== undefined ? { apiBaseURL: api } : {}),
      ...(envKeys !== undefined ? { envKeys } : {}),
      models,
    });
  }
  if (providers.length === 0) throw new Error("模型目录：models.dev 响应里没有任何带模型的 provider");
  return { version: 1, source: "models.dev", providers };
}

/** 解析**我们自己的**内置快照（生成脚本产物，字段已是本文件形状）。严格：形状不对就抛。 */
export function parseCatalogSnapshot(raw: unknown): CatalogSnapshot {
  if (!isRecord(raw) || raw.version !== 1 || typeof raw.source !== "string" || !Array.isArray(raw.providers)) {
    throw new Error("模型目录：内置快照形状不对（需要 { version:1, source, providers[] }）");
  }
  const providers: CatalogProvider[] = [];
  for (const p of raw.providers) {
    if (!isRecord(p) || typeof p.id !== "string" || !Array.isArray(p.models)) {
      throw new Error("模型目录：内置快照里的 provider 条目形状不对");
    }
    const models: CatalogModel[] = [];
    for (const m of p.models) {
      if (!isRecord(m) || typeof m.id !== "string" || m.id.trim() === "") {
        throw new Error(`模型目录：provider=${p.id} 里有模型条目缺少 id`);
      }
      models.push(modelFromSnapshot(m));
    }
    providers.push({
      id: p.id,
      ...(typeof p.name === "string" ? { name: p.name } : {}),
      ...(typeof p.apiBaseURL === "string" ? { apiBaseURL: p.apiBaseURL } : {}),
      ...(strList(p.envKeys) !== undefined ? { envKeys: strList(p.envKeys) } : {}),
      models,
    });
  }
  return {
    version: 1,
    source: raw.source,
    ...(typeof raw.generatedAt === "string" ? { generatedAt: raw.generatedAt } : {}),
    providers,
  };
}

/** 快照条目反序列化（与生成脚本的字段一一对应；缺一个就少一个，不补）。 */
function modelFromSnapshot(m: Record<string, unknown>): CatalogModel {
  const pricing = isRecord(m.pricing) ? m.pricing : undefined;
  const pricingOut: CatalogPricing | undefined = pricing
    ? {
        ...(num(pricing.inputPerMTok) !== undefined ? { inputPerMTok: num(pricing.inputPerMTok) } : {}),
        ...(num(pricing.outputPerMTok) !== undefined ? { outputPerMTok: num(pricing.outputPerMTok) } : {}),
        ...(num(pricing.cacheReadPerMTok) !== undefined ? { cacheReadPerMTok: num(pricing.cacheReadPerMTok) } : {}),
        ...(num(pricing.cacheWritePerMTok) !== undefined ? { cacheWritePerMTok: num(pricing.cacheWritePerMTok) } : {}),
      }
    : undefined;
  const inputModalities = strList(m.inputModalities);
  return {
    id: String(m.id).trim(),
    ...(posInt(m.contextWindow) !== undefined ? { contextWindow: posInt(m.contextWindow) } : {}),
    ...(posInt(m.maxOutputTokens) !== undefined ? { maxOutputTokens: posInt(m.maxOutputTokens) } : {}),
    ...(pricingOut !== undefined && Object.keys(pricingOut).length > 0 ? { pricing: pricingOut } : {}),
    ...(inputModalities !== undefined ? { inputModalities } : {}),
    ...(m.reasoning === true ? { reasoning: true } : {}),
    ...(m.toolCall === true ? { toolCall: true } : {}),
  };
}

/** 目录读数 + 它是从哪来的。UI/CLI 必须把 `origin` 一起显示 —— 见文件头的纪律 2。 */
export interface CatalogReadout {
  catalog: CatalogSnapshot;
  origin: "snapshot" | "cache" | "live";
  /** 这份数据的生成时间（有就带上）。 */
  generatedAt?: string;
  /** 为什么落到这个来源（例如「刷新失败：超时，以下为内置快照」）。
   *  回退必须是**说得出理由的**回退，不许静默降级 —— 同本仓 retry.ts 的 onRetry 纪律。 */
  note?: string;
}

/** 归一化 base URL 以便比对：小写、去协议、去尾斜杠、去尾 `/v1`（用户写法与目录写法常差这一层）。 */
export function normalizeBaseURL(url: string): string {
  let s = url.trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "");
  s = s.replace(/\/+$/, "");
  s = s.replace(/\/v1$/, "");
  return s;
}

export interface ProviderURLMatch {
  provider: CatalogProvider;
  /** `exact` = 归一化后完全一致；`host` = 只有主机名一致（路径不同，可能是同一个网关的不同挂载点）。 */
  kind: "exact" | "host";
}

/** 用户填了一个接口地址 → 目录里有哪家对得上。
 *  为什么由我们自己定这个规则：2026-10-06 的调研里，8 个同类产品**没有一家**提供
 *  「自填 URL → 目录条目」的匹配字段或规则（LiteLLM 与 models.dev 的 schema 里都没有）。
 *  返回全部命中而不是取第一个：主机相同路径不同时，那是「可能是同一家」，该由界面让用户确认。 */
export function matchProvidersByBaseURL(catalog: CatalogSnapshot, baseURL: string): ProviderURLMatch[] {
  const target = normalizeBaseURL(baseURL);
  const targetHost = target.split("/")[0] ?? "";
  if (target === "") return [];
  const exact: ProviderURLMatch[] = [];
  const host: ProviderURLMatch[] = [];
  for (const p of catalog.providers) {
    if (p.apiBaseURL === undefined) continue;
    const candidate = normalizeBaseURL(p.apiBaseURL);
    if (candidate === target) exact.push({ provider: p, kind: "exact" });
    else if (targetHost !== "" && candidate.split("/")[0] === targetHost) host.push({ provider: p, kind: "host" });
  }
  return [...exact, ...host];
}

/** 在指定 provider 下找一条模型。三级：原名 → 大小写不敏感 → 末段互认。
 *  第三级是给聚合网关用的：那边目录里写 `vendor/model`，而用户手上常常只有裸名（或反过来）。
 *  两侧都取末段再比 —— 只取一侧的话，另一种写法永远匹配不上。末段可能撞名（多个家都有 `gpt-4o`），
 *  所以它排在最后，且调用方要把命中的 id 显示出来让人看见我们解析成了哪一条。 */
export function findCatalogModel(
  catalog: CatalogSnapshot,
  providerId: string,
  modelId: string,
): CatalogModel | undefined {
  const want = modelId.trim();
  if (want === "") return undefined;
  const pool = catalog.providers.filter((p) => p.id === providerId).flatMap((p) => p.models);
  const byId = new Map(pool.map((m) => [m.id, m]));
  const hit = byId.get(want) ?? [...byId.values()].find((m) => m.id.toLowerCase() === want.toLowerCase());
  if (hit !== undefined) return hit;
  const tail = (s: string): string => (s.includes("/") ? s.slice(s.lastIndexOf("/") + 1) : s).toLowerCase();
  const wantTail = tail(want);
  return [...byId.values()].find((m) => tail(m.id) === wantTail);
}

/** 「帮用户填写」的产物：能填的都填上，填不了的**明确列出来**（而不是留个哑的空格）。 */
export interface CatalogSuggestion {
  /** 命中的目录 provider（没有命中就是 undefined —— 这家不在目录里）。 */
  provider?: CatalogProvider;
  /** 命中的模型条目。 */
  model?: CatalogModel;
  /** URL 命中的方式（provider 在场时有意义）。 */
  matchKind?: "exact" | "host";
  /** 这次能自动填上的字段名。 */
  filled: readonly (keyof CatalogModel | "apiBaseURL" | "envKeys")[];
  /** **这次拿不到、需要用户手填**的字段名 —— 界面据此把输入框标出来。 */
  missing: readonly (keyof CatalogModel)[];
}

/** 目录**能替用户填的模型级字段**清单（唯一的枚举处）。
 *  为什么要有这份常量：模型没命中目录时，我们对该模型一无所知 —— 那时 `missing` 必须把这六项全列出来，
 *  而不是空着。空 `missing` 会被界面读成「都填好了」，而真相是「一项都不知道」（2026-10-06 调研里
 *  Cline 用 128000/0 静默兜底，它的 UI 注释自己承认会把付费请求误计为 $0）。 */
export const CATALOG_FILLABLE_MODEL_FIELDS = [
  "contextWindow",
  "maxOutputTokens",
  "pricing",
  "inputModalities",
  "reasoningOptions",
  "toolCall",
] as const satisfies readonly (keyof CatalogModel)[];

/** 三段式的第②段：拿「用户填的地址 + 模型名」去目录里查能填什么、还缺什么。纯函数，判卷直接喂目录。 */
export function suggestFromCatalog(input: {
  catalog: CatalogSnapshot;
  baseURL: string;
  modelId: string;
}): CatalogSuggestion {
  const matches = matchProvidersByBaseURL(input.catalog, input.baseURL);
  const provider = matches[0]?.provider;
  const matchKind = matches[0]?.kind;
  const model = provider !== undefined ? findCatalogModel(input.catalog, provider.id, input.modelId) : undefined;
  const filled: (keyof CatalogModel | "apiBaseURL" | "envKeys")[] = [];
  const missing: (keyof CatalogModel)[] = [];
  if (provider !== undefined) {
    if (provider.apiBaseURL !== undefined) filled.push("apiBaseURL");
    if (provider.envKeys !== undefined) filled.push("envKeys");
  }
  for (const field of CATALOG_FILLABLE_MODEL_FIELDS) {
    if (model?.[field] !== undefined) filled.push(field);
    else missing.push(field);
  }
  return {
    ...(provider !== undefined ? { provider } : {}),
    ...(model !== undefined ? { model } : {}),
    ...(matchKind !== undefined ? { matchKind } : {}),
    filled,
    missing,
  };
}
