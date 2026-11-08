// M5b/M6 provider 档位表（§m5-proposal 步骤 6 + M6 白名单）：多 provider 多档位。
// 档位表/查询/自定义 provider 状态在本文件（数据层）；worker/main-session 共同的传输路由面
// 在 ./worker-adapters（toWorkerModel）——2026-11-07 拆出，断掉与 capabilities 的运行环
// （registry 的 effortFor 调 capabilityForModel、capabilities 又查本文件的档位表，互指成环）。
// 档位模型名与价格为**占位**——需联网实测校准（m5-acceptance C5：provider 可用性抽样 + 价格核实）。
import { AsyncLocalStorage } from "node:async_hooks";
import { installCustomEnvKeys, withCustomProviderEnv } from "./env-keys";
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
  /** 声明的首选思考档（必须在 `reasoningEfforts` 里）。缺席 = off：
   *  声明了「支持哪些档」不等于替用户打开一档 —— 首选档要**单独声明**，capability 照抄它。 */
  reasoningDefault?: ThinkingEffort;
}

/** Worker/main shared provider whitelist. deepseek 追加在尾：新增家不许静默改
 *  既有顺序语义（表序 = 档位缺省优先级、ENV_KEYED_PROVIDERS 序 = 面板序）。 */
export const PROVIDER_IDS = ["glm", "openai", "anthropic", "gemini", "deepseek"] as const;

/* ---- 运行期自定义 provider（`.agent/providers.json` 派生出来的那些）--------------------------------
   为什么状态落在这里而不是另开一个模块：档位表、白名单、（拆出前的）传输层都必须**同时**
   看见自定义 provider（按 id 查模型、能力表校验、`toWorkerModel` 选适配器）。状态放本文件，
   消费者（worker-adapters 也在内）来问——另开模块要么造成环，要么让各处各拿一份。

   `DerivedCustomProvider` 走**类型**导入 ⇒ 运行时没有 registry → provider-config 这条边
   （arch-cycle 只数运行边），因此不构成环。

   缺省为空 ⇒ 没装自定义 provider 时全仓行为与改造前逐字一致 —— 这是本设计的前提：零装配 = 零改变。 */
let customProviders: readonly DerivedCustomProvider[] = [];
const runCustomProviders = new AsyncLocalStorage<readonly DerivedCustomProvider[]>();

/** A workspace snapshot shadows the UI registry even when it has no custom providers. */
export function withCustomProviders<T>(
  list: readonly DerivedCustomProvider[],
  keyFor: (provider: DerivedCustomProvider) => string | undefined,
  fn: () => T,
): T {
  const credentials = new Map(list.map((provider) => [
    provider.id, { envName: provider.apiKeyEnv, key: keyFor(provider) },
  ]));
  return runCustomProviders.run(list, () => withCustomProviderEnv(credentials, fn));
}

/** 装一批自定义 provider（进程内一次性；重复调用覆盖）。传空数组 = 回到纯内置行为。
 *  **同时**把它们的 env 名推给 env-keys（叶子模块，见那边的注释）：装一次、处处生效，
 *  调用方不可能只装一半 —— 那正是本仓「能力发货、入口不通」的历史形状。 */
export function installCustomProviders(list: readonly DerivedCustomProvider[]): void {
  customProviders = list;
  installCustomEnvKeys(Object.fromEntries(list.map((p) => [p.id, p.apiKeyEnv])));
}

export function installedCustomProviders(): readonly DerivedCustomProvider[] {
  return runCustomProviders.getStore() ?? customProviders;
}

/** 按 id 找自定义 provider（内置 id 不会出现在这里：配置校验已禁止占用内置名字）。 */
export function customProviderById(id: string): DerivedCustomProvider | undefined {
  return installedCustomProviders().find((p) => p.id === id);
}

/** 这个 provider id 是不是**已知**的（内置家，或已装的自定义家）。
 *  它是「未知 provider 一律 fail-visible」这条纪律的唯一判据 —— 别处不要再抄一份白名单。 */
export function isKnownProviderId(id: string): boolean {
  return (PROVIDER_IDS as readonly string[]).includes(id) || customProviderById(id) !== undefined;
}

/** 某个档位 id 自述支持的推理档位（上游档位名，**未映射**）。
 *  没有自述 ⇒ 空数组。它是能力表开门的唯一证据来源：没证据就不许报 supported（同 abilities 的纪律）。 */
export function reasoningEffortsForModel(id: string): readonly string[] {
  for (const provider of installedCustomProviders()) {
    const declared = provider.reasoning[id];
    if (declared !== undefined) return declared;
  }
  return [];
}

/** 有效档位表 = 内置 + 已装自定义。所有「按 id 查模型」「按名字查档位」都该用这一张。 */
export function effectiveModelTable(): readonly ModelSpec[] {
  const providers = installedCustomProviders();
  if (providers.length === 0) return DEFAULT_MODEL_TABLE;
  return [...DEFAULT_MODEL_TABLE, ...providers.flatMap((p) => p.specs)];
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
  // DeepSeek（2026-10-25 官方 api-docs 实读）：现行调用名只有 deepseek-flash（V4.1-Flash-1017）
  // 与 deepseek-v4-pro（V4-Pro-0813）两个，**没有 standard 档可登**——不造第三行占位。
  // reasoningEfforts / inputModalities 是官方 /models 与文档自述的证据（effort: low/high/max；
  // flash 收图像，pro 只收文本），capability 据此开门（thinking 可选、flash 识图）。
  { id: "deepseek-cheap", provider: "deepseek", model: "deepseek-flash", tier: "cheap", ctxWindow: 1_000_000,
    inputModalities: ["text", "image"], reasoningEfforts: ["low", "high", "max"] },
  { id: "deepseek-strong", provider: "deepseek", model: "deepseek-v4-pro", tier: "strong", ctxWindow: 1_000_000,
    inputModalities: ["text"], reasoningEfforts: ["low", "high", "max"] },
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
