// 模型发现（BYO 端点）：把各家 `GET /models` 的响应解析成一张**能填表**的清单。
//
// 为什么要有这一层：用户自定义接口时，最费力的不是填 baseURL，是「这家到底有哪些模型、
// 上下文多大、多少钱」——猜错了就是撞远端 400 或者美元闸悄悄失效。上游能自述的部分
// 让上游自己说，用户只做勾选。
//
// 铁的纪律（本文件唯一的主题）：**解析不到的字段一律 undefined — 不猜上下文窗、不猜价、不猜能力。**
// 替上游"补"一个数字，用户就会拿着一份看起来确定、实际是编的配置去跑真任务；留空至少表格上
// 是个空格，而空格是本仓一贯的 fail-visible 形状（同 `capabilities.ts`「不能只因模型可能支持
// 就报 true」）。同样地，认不出的形状**抛错**而不是返回空清单——空清单会被读成"这家一个模型都没有"。
//
// 三个协议的形状是 2026-10-06 对着官方文档 / 真实响应核过的：
//   · DeepSeek  https://api-docs.deepseek.com/api/list-models
//     data[].id / name / context_window / max_output_tokens / input_modalities /
//     output_modalities / effort.supported_levels（reasoning_effort 收的值）；**不带价**。
//   · OpenRouter（公开端点，实测 464 条）
//     data[].id / name / context_length / top_provider.max_completion_tokens /
//     pricing.prompt|completion（**per token 的字符串**，如 "0.000003"）。
//   · Gemini  https://ai.google.dev/api/models  models[].name（带 models/ 前缀）/ displayName /
//     inputTokenLimit / outputTokenLimit / thinking。
//   · Anthropic /v1/models：id / display_name（其余字段官方页未能不带凭据核实 ⇒ 不解析）。
//   · 裸 OpenAI 兼容网关（vLLM / Ollama / 各家中转）：通常**只有 id**——那不是"没参数"，
//     那就是它给出的全部，用户得自己填窗口与价。
// IO 壳（发请求、SSRF 判据、停滞看门狗）不在这里：本文件零依赖、纯函数，判卷只喂 JSON。

/** 从 `GET /models` 里读出来的一条候选模型。除 `id` 外**全部可能缺席**，缺席就是缺席。 */
export interface DiscoveredModel {
  /** 上游真实调用名（就是写进请求体的那个 model 字段）。 */
  id: string;
  /** 人类可读名（DeepSeek `name` / Gemini `displayName` / OpenRouter `name`）。 */
  label?: string;
  /** 上下文窗口（DeepSeek `context_window` / OpenRouter `context_length` / Gemini `inputTokenLimit`）。 */
  contextWindow?: number;
  /** 单次输出上限（`max_output_tokens` / `top_provider.max_completion_tokens` / `outputTokenLimit`）。 */
  maxOutputTokens?: number;
  /** 输入价，美元 / 每百万 token（上游给 per-token 时已换算）。 */
  priceInPerMTok?: number;
  /** 输出价，美元 / 每百万 token。 */
  priceOutPerMTok?: number;
  /** 上游明说的输入模态（`["text","image"]`）；缺席 = 上游没说，不是"只有文本"。 */
  inputModalities?: readonly string[];
  /** 上游明说的推理档位（DeepSeek `effort.supported_levels`）；缺席 = 上游没说支持。 */
  reasoningEfforts?: readonly string[];
}

/** 支持发现的协议 —— 与 `providers/registry.ts` 的 `PROVIDER_IDS` 是两回事：这里是 **wire 形状**，
 *  自定义 provider 只会挑其中一种，不新增第四种适配器。 */
export const DISCOVERY_PROTOCOLS = ["openai", "anthropic", "gemini"] as const;
export type DiscoveryProtocol = (typeof DISCOVERY_PROTOCOLS)[number];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 非空字符串（trim 后）；否则 null —— 认不出就是没有，不给 ""。 */
function nonEmptyString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

/** 正整数；负数 / 0 / 小数 / 字符串（`"8192"` 也算）一律 null。
 *  字符串不算 —— token 上限是**数字字段**，把 `"8192"` 悄悄转成 8192 就是在替上游编类型。 */
function positiveInt(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  if (!Number.isInteger(v) || v <= 0) return null;
  return v;
}

/** 首个可用值（OpenRouter 用 `context_length`、DeepSeek 用 `context_window`，同一语义两种键）。 */
function firstPositiveInt(...vals: unknown[]): number | undefined {
  for (const v of vals) {
    const n = positiveInt(v);
    if (n !== null) return n;
  }
  return undefined;
}

/** per-token 价（数字或字符串）→ 美元/百万 token。非有限、负数、空串、"abc" ⇒ undefined。
 *  `"0"` ⇒ 0：**免费是真实读数**，不是缺失，不许当 undefined 让它掉进"价格未知"。
 *  收字符串是刻意的：OpenRouter 的 `pricing` 就是字符串，与 token 上限那条纪律不冲突
 *  （那边是本该是数字的字段，这边上游契约本来就把钱写成字符串）。 */
export function perMTokFromPerToken(v: unknown): number | undefined {
  const raw = typeof v === "string" ? v.trim() : v;
  if (typeof raw === "string") {
    if (raw === "") return undefined;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return undefined;
    return roundPerMTok(n);
  }
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return undefined;
  return roundPerMTok(raw);
}

/** `3e-6 × 1e6` 在浮点里是 3.0000000000000004 ⇒ 钉到 6 位小数（钱只到 $0.000001 就有意义）。 */
function roundPerMTok(perToken: number): number {
  return Number((perToken * 1e6).toFixed(6));
}

/** 字符串数组（trim、去空、去非字符串）；空数组 ⇒ undefined（空数组没有信息量）。 */
function stringList(v: unknown): readonly string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: string[] = [];
  for (const item of v) {
    const s = nonEmptyString(item);
    if (s !== null) out.push(s);
  }
  return out.length === 0 ? undefined : out;
}

function unrecognized(protocol: DiscoveryProtocol, payload: unknown): Error {
  const shape = Array.isArray(payload) ? "数组" : payload === null ? "null" : typeof payload;
  return new Error(
    `模型发现：认不出 ${protocol} 的 /models 响应形状（顶层是${shape}，既没有模型清单字段，也不是已知形状）——` +
      "不把它读成空清单（那会被当成「这家一个模型都没有」）；请确认 baseURL 指向的是模型列表端点",
  );
}

/** OpenAI 兼容形状（含 DeepSeek / OpenRouter 的扩展字段）。`data` 不是数组 ⇒ 抛。 */
export function parseOpenAiModels(payload: unknown): DiscoveredModel[] {
  if (!isRecord(payload) || !Array.isArray(payload.data)) throw unrecognized("openai", payload);
  const out: DiscoveredModel[] = [];
  for (const raw of payload.data) {
    if (!isRecord(raw)) continue;
    const id = nonEmptyString(raw.id);
    if (id === null) continue; // 拿不出调用名的条目没有用（拨不出去）
    const label = nonEmptyString(raw.name);
    const contextWindow = firstPositiveInt(raw.context_window, raw.context_length);
    const topProvider = isRecord(raw.top_provider) ? raw.top_provider : {};
    const maxOutputTokens = firstPositiveInt(raw.max_output_tokens, topProvider.max_completion_tokens);
    const pricing = isRecord(raw.pricing) ? raw.pricing : {};
    const priceInPerMTok = perMTokFromPerToken(pricing.prompt);
    const priceOutPerMTok = perMTokFromPerToken(pricing.completion);
    const inputModalities = stringList(raw.input_modalities);
    const effort = isRecord(raw.effort) ? raw.effort : {};
    const reasoningEfforts = stringList(effort.supported_levels) ?? stringList(raw.supported_efforts);
    out.push({
      id,
      ...(label !== null ? { label } : {}),
      ...(contextWindow !== undefined ? { contextWindow } : {}),
      ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
      ...(priceInPerMTok !== undefined ? { priceInPerMTok } : {}),
      ...(priceOutPerMTok !== undefined ? { priceOutPerMTok } : {}),
      ...(inputModalities !== undefined ? { inputModalities } : {}),
      ...(reasoningEfforts !== undefined ? { reasoningEfforts } : {}),
    });
  }
  return out;
}

/** Gemini `models.list` 形状：调用名要去掉 `models/` 前缀（那前缀是资源名，不是模型名）。 */
export function parseGeminiModels(payload: unknown): DiscoveredModel[] {
  if (!isRecord(payload) || !Array.isArray(payload.models)) throw unrecognized("gemini", payload);
  const out: DiscoveredModel[] = [];
  for (const raw of payload.models) {
    if (!isRecord(raw)) continue;
    const name = nonEmptyString(raw.name);
    if (name === null) continue;
    const id = name.startsWith("models/") ? name.slice("models/".length).trim() : name;
    if (id === "") continue;
    const label = nonEmptyString(raw.displayName);
    const contextWindow = firstPositiveInt(raw.inputTokenLimit);
    const maxOutputTokens = firstPositiveInt(raw.outputTokenLimit);
    out.push({
      id,
      ...(label !== null ? { label } : {}),
      ...(contextWindow !== undefined ? { contextWindow } : {}),
      ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
    });
  }
  return out;
}

/** Anthropic `data[]` 形状。官方页只确认了 id / display_name，所以只解析这两个
 *  （`max_input_tokens` 这类字段若哪天出现，加进来之前要带凭据实测一次，不按"应该有"先写）。 */
export function parseAnthropicModels(payload: unknown): DiscoveredModel[] {
  if (!isRecord(payload) || !Array.isArray(payload.data)) throw unrecognized("anthropic", payload);
  const out: DiscoveredModel[] = [];
  for (const raw of payload.data) {
    if (!isRecord(raw)) continue;
    const id = nonEmptyString(raw.id);
    if (id === null) continue;
    const label = nonEmptyString(raw.display_name);
    out.push({ id, ...(label !== null ? { label } : {}) });
  }
  return out;
}

/** 按协议分发；未知协议 fail-visible（不自选一个解析器去猜）。 */
export function parseModelList(protocol: string, payload: unknown): DiscoveredModel[] {
  switch (protocol) {
    case "openai":
      return parseOpenAiModels(payload);
    case "gemini":
      return parseGeminiModels(payload);
    case "anthropic":
      return parseAnthropicModels(payload);
    default:
      throw new Error(
        `模型发现：未知协议 ${JSON.stringify(protocol)}（支持：${DISCOVERY_PROTOCOLS.join(" / ")}）`,
      );
  }
}
