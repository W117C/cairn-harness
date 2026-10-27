// 声明式自定义 provider：让用户**不改源码**就能接自己的模型端点。
//
// 形状照 OpenAI Codex 的 `[model_providers.<id>]` 裁剪（2026-10-06 调研：Codex 那段有 16 个字段，
// 我们只抄需要的四个 —— base_url / env_key / wire_api / 模型清单；其余如 http_headers、
// stream_idle_timeout_ms 我们先不接，**不接的字段一律拒绝**而不是收下不用，否则用户会以为自己配上了）。
//
// 三条安全线（与调研里的同行对齐，写进校验而不是写进文档）：
//   ① 默认只许 https；要连本地/内网必须显式 `allowLocalEndpoint: true`
//      （Gemini CLI 的同款规定：base URL 必须 HTTPS，除非指向 localhost）；
//   ② key 只写**变量名**，绝不写值 —— 出现 apiKey/key/token 这类字段直接判错，不静默忽略；
//   ③ 不认识的字段一律判错（收下不用 = 让用户以为生效了）。
//
// 本文件是纯逻辑：读文件、发请求、注入环境变量都不在这里（那是接线层的事）。判卷直接喂 JSON。

import { isIP } from "node:net";
import { MODEL_ID_RE, RESERVED_PROVIDER_IDS } from "./provider-identifiers";
export { isValidModelId, RESERVED_PROVIDER_IDS } from "./provider-identifiers";
import { DEFAULT_MODEL_TABLE, type ModelSpec, type ModelTier } from "./registry";
import type { CatalogPricing } from "./catalog";
import { DISCOVERY_PROTOCOLS, type DiscoveryProtocol } from "./discovery";

/** 用户侧配置文件名（工作区级，与 `.agent/config.json` / `.agent/lsp.json` 同族先例）。 */
export const CUSTOM_PROVIDERS_RELATIVE_PATH = [".agent", "providers.json"] as const;

/** 目录里能替用户填的字段名（与 catalog.ts 的 CATALOG_FILLABLE_MODEL_FIELDS 同族；
 *  这里只用于**报错文案**，别处不要再抄一份）。 */
const MODEL_FIELD_NAMES = ["contextWindow", "maxOutputTokens", "price", "reasoningEfforts", "inputModalities"] as const;

export interface CustomModelConfig {
  /** provider 内唯一的短名；派生出的全局档位 id = `<providerId>-<id>`，除非显式给 `registryId`。 */
  id: string;
  /** 可选：显式指定全局档位 id（要与内置档位表全局唯一）。 */
  registryId?: string;
  /** 上游真实调用名（写进请求体的那个）。 */
  model: string;
  /** 档位：影响路由与折价；缺省 standard。 */
  tier?: ModelTier;
  /** 上下文窗口。**可以不给**，但会退到保守默认值并报警告（见 derive 的 warnings）。 */
  contextWindow?: number;
  maxOutputTokens?: number;
  /** 单价（美元 / 每百万 token）。给不全就不进价表 —— 美元闸对这条模型明写「不生效」。 */
  price?: CatalogPricing;
  /** 上游支持的推理档位（供 thinking 接线用；未接时不生效，但先收下来不丢）。 */
  reasoningEfforts?: readonly string[];
  /** 上游自述的输入模态（`["text","image"]`）；识图能力的唯一证据来源。 */
  inputModalities?: readonly string[];
}

export interface CustomProviderConfig {
  id: string;
  label?: string;
  /** wire 协议：复用现有三支适配器，不新增第四种。 */
  protocol: DiscoveryProtocol;
  baseURL: string;
  /** 提供 key 的**环境变量名**（如 `DEEPSEEK_API_KEY`）。写值即判错。 */
  apiKeyEnv: string;
  /** 显式放行 http / 私网 / 回环端点（本地模型用）；缺省 false。 */
  allowLocalEndpoint?: boolean;
  models: readonly CustomModelConfig[];
}

export interface CustomProvidersFile {
  version: 1;
  providers: readonly CustomProviderConfig[];
}

export interface CustomProviderProblem {
  /** 机器可读的分类（判卷按它断言，不靠文案）。 */
  kind:
    | "shape"
    | "unknown-field"
    | "provider-id"
    | "protocol"
    | "base-url"
    | "insecure-endpoint"
    | "key-field"
    | "api-key-env"
    | "model"
    | "duplicate";
  /** 出错位置（如 `providers[0].models[2].contextWindow`），便于界面直接定位到输入框。 */
  where: string;
  message: string;
}

export type ParseResult =
  | { ok: true; file: CustomProvidersFile; warnings: readonly string[] }
  | { ok: false; problems: readonly CustomProviderProblem[] };

const PROVIDER_ID_RE = /^[a-z][a-z0-9-]{0,31}$/;
const ENV_NAME_RE = /^[A-Z][A-Z0-9_]*$/;
const TIERS: readonly ModelTier[] = ["cheap", "standard", "strong"];
const PRICE_KEYS = ["inputPerMTok", "outputPerMTok", "cacheReadPerMTok", "cacheWritePerMTok"] as const;
/** 出现这些字段名 = 用户想把 key 值写进文件。不是「忽略」，是**判错**：
 *  静默忽略会让人以为钥匙已经配好了，而实际上一轮真跑会以「没配 key」失败。 */
const FORBIDDEN_KEY_FIELDS = ["apikey", "key", "token", "secret", "apikeyvalue", "bearertoken", "password"];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function posInt(v: unknown): number | undefined {
  return typeof v === "number" && Number.isInteger(v) && v > 0 ? v : undefined;
}

function nonEmpty(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t === "" ? undefined : t;
}

/** 非负有限数；字符串数字也收（用户从定价页抄下来常带引号）。 */
function money(v: unknown): number | undefined {
  const raw = typeof v === "string" ? v.trim() : v;
  if (typeof raw === "string") {
    if (raw === "") return undefined;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  }
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return undefined;
  return raw;
}

/** 私网 / 回环判定（只用于「要不要显式放行」这一件事；真正的出网安全在请求侧另有一道）。 */
export function isLocalHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h === "::1" || h === "0.0.0.0" || h.endsWith(".localhost")) return true;
  const v4 = (s: string): boolean => {
    const parts = s.split(".").map(Number);
    if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
    const [a, b] = parts as [number, number, number, number];
    return a === 0 || a === 10 || a === 127
      || (a === 169 && b === 254)                       // link-local / 云元数据
      || (a === 172 && b >= 16 && b <= 31)              // 172.16/12
      || (a === 192 && b === 168)
      || (a === 100 && b >= 64 && b <= 127);            // 100.64/10 CGNAT
  };
  if (isIP(h) === 4) return v4(h);
  if (isIP(h) === 6) {
    const emb = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(h);
    if (emb !== null) return v4(emb[1]!);
    // ULA (fc00::/7) 与 link-local (fe80::/10)
    if (/^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h)) return true;
  }
  return h.endsWith(".local") || h.endsWith(".internal");
}

/** 未知字段一律判错。allowed 用小写比对（JSON 里大小写是用户自由，但我们要给出确定的拒绝）。
 *
 *  **唯一例外：`_` 开头的键是注释**（2026-10-18）。JSON 没有注释语法，而本仓的
 *  `.agent/config.json` 一直用 `_comment` / `_search` 记录「为什么这么配」；providers.json
 *  却在同一个工作区里把 `_comment` 判成 unknown-field ⇒ 文件自己的说明把整份配置判死
 *  （真机：本仓 `.agent/providers.json` 因此整份 broken，三家 provider 全不生效）。
 *  `_` 前缀按通行约定只作说明、不参与生效字段，所以忽略它不会造成「以为配上了」的假象；
 *  真正的未知字段（如 `stream_idle_timeout_ms`）仍逐字判错。 */
function rejectUnknown(
  obj: Record<string, unknown>,
  allowed: readonly string[],
  where: string,
  problems: CustomProviderProblem[],
): void {
  const allow = new Set(allowed.map((a) => a.toLowerCase()));
  for (const k of Object.keys(obj)) {
    if (k.startsWith("_")) continue;
    if (FORBIDDEN_KEY_FIELDS.includes(k.toLowerCase())) {
      problems.push({
        kind: "key-field",
        where: `${where}.${k}`,
        message: `不许在配置里写 API key 的值（字段 \`${k}\`）：这里只能写**环境变量的名字**（apiKeyEnv）。请把钥匙放进环境变量。`,
      });
      continue;
    }
    if (!allow.has(k.toLowerCase())) {
      problems.push({
        kind: "unknown-field",
        where: `${where}.${k}`,
        message: `不认识的字段 \`${k}\`（本版支持的字段：${allowed.join(" / ")}）。收下不用会让你以为它生效了，所以在这里判错。`,
      });
    }
  }
}

function parsePrice(raw: unknown, where: string, problems: CustomProviderProblem[]): CatalogPricing | undefined {
  if (!isRecord(raw)) {
    problems.push({ kind: "model", where, message: "price 必须是对象，如 { \"inputPerMTok\": 0.28, \"outputPerMTok\": 0.42 }" });
    return undefined;
  }
  rejectUnknown(raw, PRICE_KEYS, where, problems);
  const out: CatalogPricing = {};
  for (const k of PRICE_KEYS) {
    const v = raw[k];
    if (v === undefined) continue;
    const n = money(v);
    if (n === undefined) {
      problems.push({ kind: "model", where: `${where}.${k}`, message: `${k} 必须是非负数字（美元/每百万 token）` });
      continue;
    }
    out[k] = n;
  }
  return Object.keys(out).length === 0 ? undefined : out;
}

function parseModel(raw: unknown, where: string, problems: CustomProviderProblem[]): CustomModelConfig | undefined {
  if (!isRecord(raw)) {
    problems.push({ kind: "model", where, message: "models 的每一项必须是对象" });
    return undefined;
  }
  const allowed = ["id", "registryId", "model", "tier", "contextWindow", "maxOutputTokens", "price", "reasoningEfforts", "inputModalities"];
  rejectUnknown(raw, allowed, where, problems);
  const id = nonEmpty(raw.id);
  if (id === undefined || !MODEL_ID_RE.test(id)) {
    problems.push({ kind: "model", where: `${where}.id`, message: "id 必填，且只许字母数字与 . _ : / -（最长 128）" });
    return undefined;
  }
  const registryId = raw.registryId === undefined ? undefined : nonEmpty(raw.registryId);
  if (raw.registryId !== undefined && (registryId === undefined || !MODEL_ID_RE.test(registryId))) {
    problems.push({ kind: "model", where: `${where}.registryId`, message: "registryId 给了就必须是合法 id（字母数字与 . _ : / -）" });
  }
  const model = nonEmpty(raw.model);
  if (model === undefined) {
    problems.push({ kind: "model", where: `${where}.model`, message: "model 必填（上游真实调用名，写进请求体的那个）" });
  }
  const tierRaw = raw.tier;
  if (tierRaw !== undefined && !(typeof tierRaw === "string" && (TIERS as readonly string[]).includes(tierRaw))) {
    // 第 447 页：这句进的是模型可见面，而「点得出名字」那把尺要求句里有一段 ≥6 字的连续中文
    // （插值会被挖掉、非中文会断开）⇒ 原文只剩「只能是」三字，被读成「尺读不出」。补一句可点名的措辞。
    problems.push({ kind: "model", where: `${where}.tier`, message: `tier 只能是下列取值之一：${TIERS.join(" / ")}` });
  }
  for (const k of ["contextWindow", "maxOutputTokens"] as const) {
    if (raw[k] !== undefined && posInt(raw[k]) === undefined) {
      problems.push({ kind: "model", where: `${where}.${k}`, message: `${k} 给了就必须是正整数（token 数）` });
    }
  }
  const price = raw.price === undefined ? undefined : parsePrice(raw.price, `${where}.price`, problems);
  let reasoningEfforts: string[] | undefined;
  if (raw.reasoningEfforts !== undefined) {
    if (!Array.isArray(raw.reasoningEfforts)) {
      problems.push({ kind: "model", where: `${where}.reasoningEfforts`, message: "reasoningEfforts 必须是字符串数组" });
    } else {
      const list = raw.reasoningEfforts.map((x) => nonEmpty(x)).filter((x): x is string => x !== undefined);
      if (list.length !== raw.reasoningEfforts.length) {
        problems.push({ kind: "model", where: `${where}.reasoningEfforts`, message: "reasoningEfforts 里每一项都必须是非空字符串" });
      }
      reasoningEfforts = list;
    }
  }
  let inputModalities: string[] | undefined;
  if (raw.inputModalities !== undefined) {
    if (!Array.isArray(raw.inputModalities)) {
      problems.push({ kind: "model", where: `${where}.inputModalities`, message: "inputModalities 必须是字符串数组（如 [\"text\",\"image\"]）" });
    } else {
      const list = raw.inputModalities.map((x) => nonEmpty(x)).filter((x): x is string => x !== undefined);
      if (list.length !== raw.inputModalities.length) {
        problems.push({ kind: "model", where: `${where}.inputModalities`, message: "inputModalities 里每一项都必须是非空字符串" });
      }
      inputModalities = list;
    }
  }
  if (model === undefined) return undefined;
  return {
    id,
    ...(registryId !== undefined ? { registryId } : {}),
    model,
    ...(typeof tierRaw === "string" && (TIERS as readonly string[]).includes(tierRaw) ? { tier: tierRaw as ModelTier } : {}),
    ...(posInt(raw.contextWindow) !== undefined ? { contextWindow: posInt(raw.contextWindow) } : {}),
    ...(posInt(raw.maxOutputTokens) !== undefined ? { maxOutputTokens: posInt(raw.maxOutputTokens) } : {}),
    ...(price !== undefined ? { price } : {}),
    ...(reasoningEfforts !== undefined && reasoningEfforts.length > 0 ? { reasoningEfforts } : {}),
    ...(inputModalities !== undefined && inputModalities.length > 0 ? { inputModalities } : {}),
  };
}

function parseProvider(raw: unknown, where: string, problems: CustomProviderProblem[]): CustomProviderConfig | undefined {
  if (!isRecord(raw)) {
    problems.push({ kind: "shape", where, message: "providers 的每一项必须是对象" });
    return undefined;
  }
  const allowed = ["id", "label", "protocol", "baseURL", "apiKeyEnv", "allowLocalEndpoint", "models"];
  rejectUnknown(raw, allowed, where, problems);

  const id = nonEmpty(raw.id);
  if (id === undefined || !PROVIDER_ID_RE.test(id)) {
    problems.push({ kind: "provider-id", where: `${where}.id`, message: "id 必填，小写字母开头，只许小写字母数字与 -（最长 32）" });
  } else if ((RESERVED_PROVIDER_IDS as readonly string[]).includes(id)) {
    problems.push({ kind: "provider-id", where: `${where}.id`, message: `\`${id}\` 是内置 provider，不能占用；换一个名字（自定义 id 派生出的档位 id 是 <provider>-<model>）` });
  }

  const protocol = nonEmpty(raw.protocol);
  if (protocol === undefined || !(DISCOVERY_PROTOCOLS as readonly string[]).includes(protocol)) {
    problems.push({
      kind: "protocol",
      where: `${where}.protocol`,
      message: `protocol 必填，且只能是 ${DISCOVERY_PROTOCOLS.join(" / ")}（复用现有适配器，不新增第四种协议）`,
    });
  }

  const baseURL = nonEmpty(raw.baseURL);
  const allowLocal = raw.allowLocalEndpoint === true;
  if (raw.allowLocalEndpoint !== undefined && typeof raw.allowLocalEndpoint !== "boolean") {
    problems.push({ kind: "shape", where: `${where}.allowLocalEndpoint`, message: "allowLocalEndpoint 必须是 true / false" });
  }
  if (baseURL === undefined) {
    problems.push({ kind: "base-url", where: `${where}.baseURL`, message: "baseURL 必填（如 https://api.deepseek.com/v1）" });
  } else {
    let parsed: URL | undefined;
    try {
      parsed = new URL(baseURL);
    } catch {
      problems.push({ kind: "base-url", where: `${where}.baseURL`, message: `baseURL 不是合法 URL：${baseURL}` });
    }
    if (parsed !== undefined) {
      const local = isLocalHostname(parsed.hostname);
      if (parsed.protocol !== "https:") {
        if (parsed.protocol !== "http:" || !(allowLocal && local)) {
          problems.push({
            kind: "insecure-endpoint",
            where: `${where}.baseURL`,
            message: `只允许 https（收到 ${parsed.protocol}//）。要连本地/内网端点，把它写成 http 并显式加 "allowLocalEndpoint": true（只对 localhost / 私网地址放行）。`,
          });
        }
      }
      if (local && !allowLocal) {
        problems.push({
          kind: "insecure-endpoint",
          where: `${where}.baseURL`,
          message: `${parsed.hostname} 是本地/内网地址：确认要走它的话加 "allowLocalEndpoint": true（我们不默认允许把请求发向内网）。`,
        });
      }
    }
  }

  const apiKeyEnv = nonEmpty(raw.apiKeyEnv);
  if (apiKeyEnv === undefined || !ENV_NAME_RE.test(apiKeyEnv)) {
    problems.push({
      kind: "api-key-env",
      where: `${where}.apiKeyEnv`,
      message: "apiKeyEnv 必填：写**环境变量的名字**（大写字母/数字/下划线，如 DEEPSEEK_API_KEY），不是钥匙本身",
    });
  }

  const modelsRaw = raw.models;
  const models: CustomModelConfig[] = [];
  if (!Array.isArray(modelsRaw) || modelsRaw.length === 0) {
    problems.push({ kind: "model", where: `${where}.models`, message: "models 必填且至少一条（没有模型的 provider 没有任何用处）" });
  } else {
    const seen = new Set<string>();
    modelsRaw.forEach((m, i) => {
      const parsedModel = parseModel(m, `${where}.models[${i}]`, problems);
      if (parsedModel === undefined) return;
      if (seen.has(parsedModel.id)) {
        problems.push({ kind: "duplicate", where: `${where}.models[${i}].id`, message: `同一 provider 内模型 id 重复：${parsedModel.id}` });
        return;
      }
      seen.add(parsedModel.id);
      models.push(parsedModel);
    });
  }

  if (id === undefined || protocol === undefined || baseURL === undefined || apiKeyEnv === undefined) return undefined;
  const label = nonEmpty(raw.label);
  return {
    id,
    ...(label !== undefined ? { label } : {}),
    protocol: protocol as DiscoveryProtocol,
    baseURL,
    apiKeyEnv,
    ...(raw.allowLocalEndpoint === true ? { allowLocalEndpoint: true } : {}),
    models,
  };
}

/**
 * 解析并校验 `.agent/providers.json` 的内容。
 * **一次收齐所有问题**（不是遇到第一个就返回）：用户改一次配置想看到全部错，不想改一处跑一次。
 */
export function parseCustomProviders(raw: unknown): ParseResult {
  const problems: CustomProviderProblem[] = [];
  if (!isRecord(raw)) {
    return { ok: false, problems: [{ kind: "shape", where: "", message: "配置顶层必须是对象" }] };
  }
  rejectUnknown(raw, ["version", "providers"], "", problems);
  if (raw.version !== 1) {
    problems.push({ kind: "shape", where: "version", message: "version 必须是 1" });
  }
  const providersRaw = raw.providers;
  const providers: CustomProviderConfig[] = [];
  if (!Array.isArray(providersRaw)) {
    problems.push({ kind: "shape", where: "providers", message: "providers 必须是数组（没有自定义 provider 就写 []）" });
  } else {
    const seen = new Set<string>();
    providersRaw.forEach((p, i) => {
      const parsed = parseProvider(p, `providers[${i}]`, problems);
      if (parsed === undefined) return;
      if (seen.has(parsed.id)) {
        problems.push({ kind: "duplicate", where: `providers[${i}].id`, message: `provider id 重复：${parsed.id}` });
        return;
      }
      seen.add(parsed.id);
      providers.push(parsed);
    });
  }
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, file: { version: 1, providers }, warnings: [] };
}

/** 一条自定义 provider 派生出来的东西：档位行 + 价表行 + key 变量名。 */
export interface DerivedCustomProvider {
  id: string;
  label: string;
  protocol: DiscoveryProtocol;
  baseURL: string;
  apiKeyEnv: string;
  allowLocalEndpoint: boolean;
  /** 可直接并进档位表的行（id 全局唯一）。 */
  specs: readonly ModelSpec[];
  /** 可直接并进价表的行（key = 档位 id）；**没给价的模型不会出现在这里**。 */
  prices: Readonly<Record<string, CatalogPricing>>;
  /** 用户/上游自述的推理档位（key = 档位 id；值是上游的档位名，未映射）。
   *  它是「这个模型支不支持思考」的**证据来源** —— 能力表据此开门，没证据的一律保持关。 */
  reasoning: Readonly<Record<string, readonly string[]>>;
  /** 派生期的提醒（缺窗口用了保守值、缺价导致美元闸不生效这类）。必须显示给用户。 */
  warnings: readonly string[];
}

export interface DeriveOptions {
  /** 内置档位表（默认 `DEFAULT_MODEL_TABLE`）；用于查全局 id 冲突与算保守窗口默认值。 */
  builtinTable?: readonly ModelSpec[];
}

/**
 * 把校验过的配置变成「接线层能直接用的东西」。
 * 这里做三个决定，每个都要有理由：
 *   · 全局档位 id = `registryId ?? <providerId>-<modelId>`：档位表是**扁平**命名空间，必须全局唯一；
 *   · 没给 contextWindow ⇒ 用档位表里**最小**的窗口（低估只会提前压缩，高估会撞远端 400），并报警告；
 *   · 没给价 ⇒ 不进价表（美元闸对这条模型明写「不生效」，绝不按 $0 烧）。
 */
export function deriveCustomProviders(file: CustomProvidersFile, opts: DeriveOptions = {}): readonly DerivedCustomProvider[] {
  const builtin = opts.builtinTable ?? DEFAULT_MODEL_TABLE;
  const conservativeWindow = builtin.length > 0 ? Math.min(...builtin.map((s) => s.ctxWindow)) : 128_000;
  const taken = new Set(builtin.map((s) => s.id));
  const out: DerivedCustomProvider[] = [];
  // 同一个 apiKeyEnv 被几家共用（用户实测：本地端点收到了另一家的钥匙 ⇒ 上游 401 invalid_api_key）。
  // 钥匙是**按家**存进钥匙串的，注入时却写进同一个环境变量名 ⇒ 后写的盖掉先写的。
  const envUsers = new Map<string, string[]>();
  for (const p of file.providers) {
    const list = envUsers.get(p.apiKeyEnv);
    if (list) list.push(p.id);
    else envUsers.set(p.apiKeyEnv, [p.id]);
  }
  for (const p of file.providers) {
    const specs: ModelSpec[] = [];
    const prices: Record<string, CatalogPricing> = {};
    const reasoning: Record<string, readonly string[]> = {};
    const warnings: string[] = [];
    const sharedWith = (envUsers.get(p.apiKeyEnv) ?? []).filter((id) => id !== p.id);
    if (sharedWith.length > 0) {
      warnings.push(
        `环境变量 ${p.apiKeyEnv} 与 ${sharedWith.join("、")} 共用：钥匙按家存、注入用同一个名字 ⇒ 会互相覆盖，其中一家必然收到错的钥匙。给每家换一个独立的名字。`,
      );
    }
    for (const m of p.models) {
      // 全局 id 打上 provider 前缀（档位表是扁平命名空间）；但模型名已经带了这个前缀就别叠字
      //（"deepseek" + "deepseek-chat" → "deepseek-chat"，而不是 "deepseek-deepseek-chat"）。
      const id = m.registryId ?? (m.id.startsWith(`${p.id}-`) ? m.id : `${p.id}-${m.id}`);
      if (taken.has(id)) {
        warnings.push(`档位 id \`${id}\` 与已有的重复，已跳过这条模型（用 registryId 换一个名字）`);
        continue;
      }
      taken.add(id);
      const ctxWindow = m.contextWindow ?? conservativeWindow;
      if (m.contextWindow === undefined) {
        warnings.push(
          `模型 \`${m.id}\` 没给 contextWindow：按保守值 ${ctxWindow} 处理（低估只会提前压缩，高估会撞远端 400）。建议填真实窗口。`,
        );
      }
      specs.push({
        id,
        provider: p.id,
        model: m.model,
        tier: m.tier ?? "standard",
        ctxWindow,
        ...(m.inputModalities !== undefined && m.inputModalities.length > 0 ? { inputModalities: m.inputModalities } : {}),
        ...(m.reasoningEfforts !== undefined && m.reasoningEfforts.length > 0 ? { reasoningEfforts: m.reasoningEfforts } : {}),
      });
      if (m.reasoningEfforts !== undefined && m.reasoningEfforts.length > 0) reasoning[id] = m.reasoningEfforts;
      if (m.price !== undefined) prices[id] = m.price;
      else warnings.push(`模型 \`${m.id}\` 没给 price：美元闸对 \`${id}\` 不生效（不会按 $0 计算，会明说「价格未知」）。`);
    }
    out.push({
      id: p.id,
      label: p.label ?? p.id,
      protocol: p.protocol,
      baseURL: p.baseURL,
      apiKeyEnv: p.apiKeyEnv,
      allowLocalEndpoint: p.allowLocalEndpoint === true,
      specs,
      prices,
      reasoning,
      warnings,
    });
  }
  return out;
}

/** 字段名清单：供 CLI/UI 的「还得你填这几项」文案复用（不在别处再抄一份）。 */
export function customModelFieldNames(): readonly string[] {
  return MODEL_FIELD_NAMES;
}
