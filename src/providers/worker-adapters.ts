// Worker/main session 共同的适配器路由面（M6 白名单）：按 spec.provider 把五支 provider 适配器
// 接到统一调用形状上；两处必须调用同一个 toWorkerModel，禁止各自维护模型目录或 provider 分支。
// 2026-11-07 从 registry.ts 拆出：档位表/查询/自定义 provider 状态留在 registry（数据层），
// 本文件只管传输路由。拆的原因是 arch-cycle-check 点名的新圈——registry 在 effortFor 里调
// capabilityForModel（能力收口），capabilities 又要查 registry 的档位表 ⇒ 运行边互指。
// 现在 registry 不再 import capabilities 的运行面（只剩 type 边），运行环消失。
import { streamGlm, type GlmMessage, type GlmToolSpec } from "./glm";
import { streamDeepSeek } from "./deepseek";
import { streamOpenAI, type OpenAiOptions } from "./openai";
import { streamAnthropic } from "./anthropic";
import { streamGemini } from "./gemini";
import type { ModelOutput, ProviderCall, ProviderMessage, ProviderToolSpec } from "./index";
import { reasoningDirective } from "./reasoning";
import { capabilityForModel, type ThinkingEffort } from "./capabilities";
import { PROVIDER_IDS, customProviderById, installedCustomProviders, type ModelSpec } from "./registry";

export interface RegistryWorkerCallOptions {
  call?: ProviderCall;
  /** GLM/OpenAI non-stream mode used by the legacy compaction summarizer. */
  stream?: boolean;
  /** OpenAI/GLM-compatible request metering. Other native adapters do not expose this option yet. */
  metering?: OpenAiOptions["metering"];
  /** Per-request effort override (quality mode): plan/repair high, execution low.
   *  `undefined` = use the effort bound at assembly time; `"off"` = send nothing. */
  reasoningEffort?: ThinkingEffort;
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
  const openAiEffort = opts.reasoningEffort === "off" ? "off" : directive?.effort;
  /** 逐请求覆盖（质量档）：未给 = 沿用装配时的档；`off` = 本拍不展开；其余按同一张表换算。
   *  单独抽出来是因为四个适配器都要做同一件事——抄四份就会出现「GLM 认、Anthropic 不认」。 */
  const effortFor = (callOptions?: RegistryWorkerCallOptions): string | undefined => {
    const e = callOptions?.reasoningEffort;
    if (e === undefined) return openAiEffort; // 沿用装配时的档
    const mapped = e === "off" ? "off" : reasoningDirective(e)?.effort;
    // 逐请求档（质量档的相位策略）不过装配前的 validateThinkingEffort：这里按模型声明的
    // 能力档收口——声明里没有的档回落到装配时那份（已过验证），不把非法值打上线。
    // off 是「不展开思考」，对任何模型都合法，不参与此检。
    if (mapped !== undefined && mapped !== "off" &&
        !capabilityForModel(spec).thinking.values.includes(mapped as ThinkingEffort)) {
      return openAiEffort;
    }
    return mapped;
  };
  const budgetFor = (callOptions?: RegistryWorkerCallOptions): number | undefined => {
    const e = callOptions?.reasoningEffort;
    const d = e === undefined ? directive : e === "off" ? null : reasoningDirective(e);
    return d?.budgetTokens;
  };
  switch (spec.provider) {
    case "glm":
      return (messages, tools, callOptions) => streamGlm(
        messages,
        {
          model: spec.model,
          ...(fetchImpl ? { fetchImpl } : {}),
          ...(callOptions?.stream !== undefined ? { stream: callOptions.stream } : {}),
          ...(callOptions?.metering ? { metering: callOptions.metering } : {}),
          ...(effortFor(callOptions) !== undefined ? { reasoningEffort: effortFor(callOptions) } : {}),
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
          ...(effortFor(callOptions) !== undefined ? { reasoningEffort: effortFor(callOptions) } : {}),
        },
        toProviderTools(tools),
        callOptions?.call,
      );
    case "deepseek":
      // 档位未给时也显式关思考（DeepSeek V4.1 服务端默认开——见 deepseek.ts 文件头），预设层归一。
      return (messages, tools, callOptions) => streamDeepSeek(
        messages,
        {
          model: spec.model,
          ...(fetchImpl ? { fetchImpl } : {}),
          ...(callOptions?.stream !== undefined ? { stream: callOptions.stream } : {}),
          ...(callOptions?.metering ? { metering: callOptions.metering } : {}),
          // openAiEffort 为 undefined（调用方没表态）时也传 "off"：这家「不表态」≠「不开」
          reasoningEffort: effortFor(callOptions) ?? "off",
        },
        tools,
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
            ...(budgetFor(callOptions) !== undefined ? { thinkingBudget: budgetFor(callOptions) } : {}),
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
            ...(budgetFor(callOptions) !== undefined ? { thinkingBudget: budgetFor(callOptions) } : {}),
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
        ...(openAiEffort !== undefined && custom.protocol === "openai"
          ? { reasoningEffort: openAiEffort }
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
