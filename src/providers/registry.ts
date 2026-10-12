// M5b/M6 provider 档位表（§m5-proposal 步骤 6 + M6 白名单）：多 provider 多档位。
// 四个 adapter 的 worker/main-session 共同路由面；两处必须调用同一个 toWorkerModel，
// 禁止各自维护模型目录或 provider 分支。
// 档位模型名与价格为**占位**——需联网实测校准（m5-acceptance C5：provider 可用性抽样 + 价格核实）。
import { streamGlm, type GlmMessage, type GlmToolSpec } from "./glm";
import { streamOpenAI, type OpenAiOptions } from "./openai";
import { streamAnthropic } from "./anthropic";
import { streamGemini } from "./gemini";
import type { ModelOutput, ProviderCall, ProviderMessage, ProviderToolSpec } from "./index";
import { installCustomEnvKeys } from "./env-keys";
import { reasoningDirective } from "./reasoning";
import type { ThinkingEffort } from "./capabilities";
import type { DerivedCustomProvider } from "./provider-config";

export type ModelTier = "cheap" | "standard" | "strong";

export interface ModelSpec {
  id: string;
  provider: string;
  model: string;
  tier: ModelTier;
  ctxWindow: number;
  /** 上游自述的输入模态（`["text","image"]`）；缺席 = 上游没说。识图能力的唯一证据来源。 */
  inputModalities?: readonly string[];
  /** 上游支持的推理档位（与 provider-config 的 reasoning 同源，进 capability 判定）。 */
  reasoningEfforts?: readonly string[];
}

/** Worker/main shared provider whitelist. */
export const PROVIDER_IDS = ["glm", "openai", "anthropic", "gemini"] as const;

/* ---- 运行期自定义 provider（`.agent/providers.json` 派生出来的那些）--------------------------------
   为什么状态落在这里而不是另开一个模块：档位表、白名单、传输层三样都住在本文件，而它们必须**同时**
   看见自定义 provider（按 id 查模型、能力表校验、`toWorkerModel` 选适配器）。另开模块要么造成
   registry → 新模块 → registry 的环，要么让三处各拿一份。所以：本文件持有，别人来问。

   `DerivedCustomProvider` 走**类型**导入 ⇒ 运行时没有 registry → provider-config 这条边
   （arch-cycle 只数运行边），因此不构成环。

   缺省为空 ⇒ 没装自定义 provider 时全仓行为与改造前逐字一致 —— 这是本设计的前提：零装配 = 零改变。 */
let customProviders: readonly DerivedCustomProvider[] = [];

/** 装一批自定义 provider（进程内一次性；重复调用覆盖）。传空数组 = 回到纯内置行为。
 *  **同时**把它们的 env 名推给 env-keys（叶子模块，见那边的注释）：装一次、处处生效，
 *  调用方不可能只装一半 —— 那正是本仓「能力发货、入口不通」的历史形态。 */
export function installCustomProviders(list: readonly DerivedCustomProvider[]): void {
  customProviders = list;
  installCustomEnvKeys(Object.fromEntries(list.map((p) => [p.id, p.apiKeyEnv])));
}

export function installedCustomProviders(): readonly DerivedCustomProvider[] {
  return customProviders;
}

/** 按 id 找自定义 provider（内置 id 不会出现在这里：配置校验已禁止占用内置名字）。 */
export function customProviderById(id: string): DerivedCustomProvider | undefined {
  return customProviders.find((p) => p.id === id);
}

/** 这个 provider id 是不是**已知**的（内置四家，或已装的自定义家）。
 *  它是「未知 provider 一律 fail-visible」这条纪律的唯一判据 —— 别处不要再抄一份白名单。 */
export function isKnownProviderId(id: string): boolean {
  return (PROVIDER_IDS as readonly string[]).includes(id) || customProviderById(id) !== undefined;
}

/** 某个档位 id 自述支持的推理档位（上游档位名，**未映射**）。
 *  没有自述 ⇒ 空数组。它是能力表开门的唯一证据来源：没证据就不许报 supported（同 abilities 的纪律）。 */
export function reasoningEffortsForModel(id: string): readonly string[] {
  for (const provider of customProviders) {
    const declared = provider.reasoning[id];
    if (declared !== undefined) return declared;
  }
  return [];
}

/** 有效档位表 = 内置 + 已装自定义。所有「按 id 查模型」「按名字查档位」都该用这一张。 */
export function effectiveModelTable(): readonly ModelSpec[] {
  if (customProviders.length === 0) return DEFAULT_MODEL_TABLE;
  return [...DEFAULT_MODEL_TABLE, ...customProviders.flatMap((p) => p.specs)];
}

/** 自由档位的 id 前缀（`--model <线上模型名>`，如 `freeform/stealth/space-bunny-alpha`）。
 *  这一档**按定义不进 `DEFAULT_MODEL_TABLE`**：表是 bandit 代价项与预算折钱的依据，
 *  往里塞一个查不到价的行等于让它按假价参与路由。
 *  前缀是它唯一的身份标记，所以构造 spec（`main/provider-runtime.ts`）与查 capability
 *  （`providers/capabilities.ts`）两侧都必须走下面这两个函数，不要各自写字面量。 */
export const FREEFORM_MODEL_ID_PREFIX = "freeform/";

export function freeformModelId(model: string): string {
  return FREEFORM_MODEL_ID_PREFIX + model;
}

export function isFreeformModelId(id: string): boolean {
  return id.startsWith(FREEFORM_MODEL_ID_PREFIX);
}

/** 缺省档位表（表序 = 档位默认的 provider 优先级：glm 第一——tier-default 取 direct[0]）。
 *  id 命名：glm 沿用 M5 的 flash/standard/strong；其余用 <provider>-<tier>。
 *  `model` = 厂商调用名。2026-09-19 联网实测按官方 catalog 换过一轮（旧值见各行注）：
 *  Anthropic 现行页已不列 claude-3-5-* / claude-opus-4-*，Gemini 2.0-flash 标注已 shut down
 *  ⇒ **照旧名发请求就是 404/400 级失败**，路由开着就会把整次任务打挂，不是「不够便宜」的小事。
 *  仍以 `⚠️ 未证` 标出的行，是官方页没能直接确认调用名的（不猜、不改，留给带凭据的实测或裁决）。 */
export const DEFAULT_MODEL_TABLE: readonly ModelSpec[] = [
  // GLM（M5 既有，id 不变）
  { id: "glm-flash", provider: "glm", model: "glm-5.3-flash", tier: "cheap", ctxWindow: 1_000_000 }, // 旧 glm-4.5-flash；官方模型页 docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash（上下文 1M）
  { id: "glm-standard", provider: "glm", model: "glm-5.2", tier: "standard", ctxWindow: 1_000_000 }, // 调用名官方页确认；上下文页写 1M（旧值 128k 是拍的）
  { id: "glm-strong", provider: "glm", model: "glm-5.2-pro", tier: "strong", ctxWindow: 256_000 }, // ⚠️ 未证：官方页只确认了 glm-5.2 与 glm-5.3-flash，-pro 后缀没查到
  // OpenAI（M6 白名单；三个调用名都出现在官方 pricing 表上）
  { id: "openai-cheap", provider: "openai", model: "gpt-4o-mini", tier: "cheap", ctxWindow: 128_000 },
  { id: "openai-standard", provider: "openai", model: "gpt-4o", tier: "standard", ctxWindow: 128_000 },
  { id: "openai-strong", provider: "openai", model: "o3", tier: "strong", ctxWindow: 200_000 },
  // Anthropic（M6 白名单；换成官方 Models overview 现行 id）
  { id: "anthropic-cheap", provider: "anthropic", model: "claude-haiku-4-5-20251001", tier: "cheap", ctxWindow: 200_000 },
  { id: "anthropic-standard", provider: "anthropic", model: "claude-sonnet-5", tier: "standard", ctxWindow: 200_000 },
  { id: "anthropic-strong", provider: "anthropic", model: "claude-opus-5", tier: "strong", ctxWindow: 200_000 },
  // Gemini（M6 白名单；2.0-flash 官方标 shut down，2.5-pro-exp 从来不是可调用名）
  // 档位按**单价单调**排：flash 系便宜在前，pro 最贵当 strong
  { id: "gemini-cheap", provider: "gemini", model: "gemini-2.5-flash", tier: "cheap", ctxWindow: 1_000_000 },
  { id: "gemini-standard", provider: "gemini", model: "gemini-3.8-flash", tier: "standard", ctxWindow: 1_000_000 },
  { id: "gemini-strong", provider: "gemini", model: "gemini-2.5-pro", tier: "strong", ctxWindow: 1_000_000 },
];

/** 档位表查询（纯函数）。 */
export function lookupModel(table: readonly ModelSpec[], id: string): ModelSpec | undefined {
  return table.find((s) => s.id === id);
}

/** 按档位取候选（纯函数）。 */
export function specsByTier(table: readonly ModelSpec[], tier: ModelTier): ModelSpec[] {
  return table.filter((s) => s.tier === tier);
}

/** 按「档位 id 或 provider 模型名」双态解析（纯函数）。
 *  调用方两态都会遇到：settings 存的是 provider 模型名（如 glm-5.2），路由表存的是 id（glm-standard）。
 *  同名多条时取 ctxWindow **最小**者——预算只允许保守，绝不因表内重复而放大。
 *  找不到返回 undefined（调用方走保守缺省；与 resolveModel 的 fail-visible 抛错是两种用途：
 *  路由必须指名要谁，预算只是「能查到就认」）。 */
export function findSpecByNameOrId(table: readonly ModelSpec[], name: string | undefined): ModelSpec | undefined {
  if (!name) return undefined;
  const hits = table.filter((s) => s.id === name || s.model === name);
  if (hits.length === 0) return undefined;
  return hits.reduce((a, b) => (b.ctxWindow < a.ctxWindow ? b : a));
}

/** 按 id 解析；未知 id fail-visible 报错，绝不静默回落（路由策略层的底座纪律）。 */
export function resolveModel(table: readonly ModelSpec[], id: string): ModelSpec {
  const spec = lookupModel(table, id);
  if (!spec) throw new Error(`未知 model id: ${JSON.stringify(id)}（档位表：${table.map((s) => s.id).join(", ")}）`);
  return spec;
}

export interface RegistryWorkerCallOptions {
  call?: ProviderCall;
  /** GLM/OpenAI non-stream mode used by the legacy compaction summarizer. */
  stream?: boolean;
  /** OpenAI/GLM-compatible request metering. Other native adapters do not expose this option yet. */
  metering?: OpenAiOptions["metering"];
}

/** Worker/main shared transport. The optional third argument preserves the old two-argument worker API. */
export type RegistryWorkerModel = ((
  messages: GlmMessage[],
  tools: GlmToolSpec[],
  options?: RegistryWorkerCallOptions,
) => AsyncIterable<ModelOutput>) & {
  /** #22：这个适配器**真拨的模型名**（取自 `spec.model`）。worker 的用量归因键与价格标签据此定档；
   *  注入面（`modelFor`）若不带这个自述位，就会被记到 harness 缺省档上——归因与折价同一变量，
   *  所以两者不会互相打脸，只会一起偏（这正是第 148 页点名的盲区形状）。 */
  usageName?: string;
};

/** GlmToolSpec（openai wire）→ ProviderToolSpec（统一中立面）：照抄 glm.ts 的 unified 映射。 */
export function toProviderTools(tools: GlmToolSpec[] | undefined): ProviderToolSpec[] | undefined {
  return tools?.map((t) => ({
    name: t.function.name,
    ...(t.function.description !== undefined ? { description: t.function.description } : {}),
    parameters: t.function.parameters,
  }));
}

export interface ToWorkerModelOptions {
  /** 测试注入点（各适配器 fetchImpl；缺省全局 fetch）。 */
  fetchImpl?: typeof fetch;
  /** 思考档位（§S8）。未给 / "off" ⇒ 请求体里一个字都不加（逐字旧行为）。
   *  注意它**对内置档位是惰性的**：能力表对内置模型一律 thinking.supported=false，所以
   *  `validateThinkingEffort` 会在装配前就把非 off 的值拒掉 —— 真正能走到这里的是自定义 provider
   *  （用户在自己的配置里声明了 reasoningEfforts，那就是我们唯一有证据的地方）。
   *  这样写而不是"干脆不接内置分支"：等哪天内置模型带凭据实测过、能力表开了门，这一跳已经在了。 */
  reasoningEffort?: ThinkingEffort;
  /** A1 写侧缓存断点：目前**只有 Anthropic 有语义**（显式 cache_control）。
   *  OpenAI/GLM 是自动前缀缓存（无写侧标记，收益受排布约束）；**Gemini 也是自动的**——
   *  2026-10-05 第 387 页订正：原文写「Gemini 要另建 cachedContent 资源」，而官方现行文档写的是
   *  「隐式缓存对 Gemini 2.5 及更新的模型**默认开着**，无需做任何事就能命中」，`cachedContent`
   *  只是**显式缓存**那条路（可自控缓存什么、有保证的折扣）。三家的读侧分块都读得到了
   *  （见 `usage.ts` 侧的 `cacheReadInputTokens`）；这个开关仍旧只对 Anthropic 有行为。 */
  promptCache?: boolean;
}

/** 薄适配器：按 spec.provider 路由到对应适配器（M6 白名单）。未知 provider fail-visible 抛错。 */
function pickWorkerModel(spec: ModelSpec, opts: ToWorkerModelOptions): RegistryWorkerModel {
  const fetchImpl = opts.fetchImpl;
  // 档位 → 中立描述（各家自己决定放到 body 的哪儿）；null = 不发这个字段
  const directive = opts.reasoningEffort !== undefined ? reasoningDirective(opts.reasoningEffort) : null;
  switch (spec.provider) {
    case "glm":
      return (messages, tools, callOptions) => streamGlm(
        messages,
        {
          model: spec.model,
          ...(fetchImpl ? { fetchImpl } : {}),
          ...(callOptions?.stream !== undefined ? { stream: callOptions.stream } : {}),
          ...(callOptions?.metering ? { metering: callOptions.metering } : {}),
          ...(directive !== null ? { reasoningEffort: directive.effort } : {}),
        },
        tools,
        callOptions?.call,
      );
    case "openai":
      return (messages, tools, callOptions) => streamOpenAI(
        messages as ProviderMessage[],
        {
          model: spec.model,
          ...(fetchImpl ? { fetchImpl } : {}),
          ...(callOptions?.stream !== undefined ? { stream: callOptions.stream } : {}),
          ...(callOptions?.metering ? { metering: callOptions.metering } : {}),
          ...(directive !== null ? { reasoningEffort: directive.effort } : {}),
        },
        toProviderTools(tools),
        callOptions?.call,
      );
    case "anthropic":
      return (messages, tools, callOptions) =>
        streamAnthropic(
          messages,
          {
            model: spec.model,
            ...(fetchImpl ? { fetchImpl } : {}),
            ...(opts.promptCache === true ? { promptCache: true } : {}),
            ...(directive !== null ? { thinkingBudget: directive.budgetTokens } : {}),
          },
          toProviderTools(tools),
          callOptions?.call,
        );
    case "gemini":
      return (messages, tools, callOptions) =>
        streamGemini(
          messages,
          {
            model: spec.model,
            ...(fetchImpl ? { fetchImpl } : {}),
            ...(directive !== null ? { thinkingBudget: directive.budgetTokens } : {}),
          },
          toProviderTools(tools),
          callOptions?.call,
        );
    default: {
      // 自定义 provider（`.agent/providers.json`）：协议复用现有三支适配器，只换 baseURL / key 变量名。
      // 这是「不改源码就能接自己的模型」真正通电的那一跳 —— 主会话与 worker 都从这里走（同一条传输面）。
      const custom = customProviderById(spec.provider);
      if (custom === undefined) {
        throw new Error(
          `未知 provider: ${JSON.stringify(spec.provider)}（内置：${PROVIDER_IDS.join(", ")}；自定义：${installedCustomProviders()
            .map((p) => p.id)
            .join(", ") || "无"}。自定义 provider 要写在 .agent/providers.json）`,
        );
      }
      const bound = {
        model: spec.model,
        baseURL: custom.baseURL,
        apiKeyEnv: custom.apiKeyEnv,
        label: custom.label,
        ...(fetchImpl ? { fetchImpl } : {}),
        // 自定义家走的就是这三支适配器，思考档位按协议翻译（见 providers/reasoning.ts）
        ...(directive !== null && custom.protocol !== "anthropic" && custom.protocol !== "gemini"
          ? { reasoningEffort: directive.effort }
          : {}),
        ...(directive !== null && custom.protocol !== "openai" ? { thinkingBudget: directive.budgetTokens } : {}),
      };
      switch (custom.protocol) {
        case "openai":
          return (messages, tools, callOptions) =>
            streamOpenAI(
              messages as ProviderMessage[],
              {
                ...bound,
                ...(callOptions?.stream !== undefined ? { stream: callOptions.stream } : {}),
                ...(callOptions?.metering ? { metering: callOptions.metering } : {}),
              },
              toProviderTools(tools),
              callOptions?.call,
            );
        case "anthropic":
          return (messages, tools, callOptions) =>
            streamAnthropic(
              messages,
              { ...bound, ...(opts.promptCache === true ? { promptCache: true } : {}) },
              toProviderTools(tools),
              callOptions?.call,
            );
        case "gemini":
          return (messages, tools, callOptions) => streamGemini(messages, bound, toProviderTools(tools), callOptions?.call);
      }
    }
  }
}

/** 薄包装：**自述名的唯一盖章点**。四支 provider 适配器各写一遍 `usageName = spec.model`
 *  就是第五族那个老形状（同一条解析只硬化一支）——今天 glm 支带了名、明天有人加分支忘了带，
 *  错档不会报错，只会让归因和折价一起偏。 */
export function toWorkerModel(spec: ModelSpec, opts: ToWorkerModelOptions = {}): RegistryWorkerModel {
  const model = pickWorkerModel(spec, opts);
  model.usageName = spec.model;
  return model;
}
