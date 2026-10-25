// CX-02/CX-03：主会话与 worker 共用同一 model registry / capability map / provider adapter 路由。
// 本模块只做选择与只读描述；网络调用仍由 providers/registry.ts 的 toWorkerModel 承担。
import { envKeyOf, type EnvKeyedProvider } from "../providers/env-keys";
import { modelsForCurrentTable, type ProviderModelInfo } from "../providers/models";
import {
  PROVIDER_IDS,
  effectiveModelTable,
  findSpecByNameOrId,
  freeformModelId,
  installedCustomProviders,
  isKnownProviderId,
  lookupModel,
  type ModelSpec,
} from "../providers/registry";
import type { ProviderKind } from "./settings";

// ProviderModelInfo / ProviderInfo 的事实形状已收到 src/providers/models.ts（pi-mono 式 Models 面），
// 这里只做 re-export 以保持既有 import 路径（settings-handlers / SettingsPanel / ipc-protocol）不变。
export type { ProviderModelInfo } from "../providers/models";

export interface ProviderInfo {
  kind: ProviderKind;
  /** 已知 provider 清单（内置 + 已装自定义）：设置页的下拉与选择器据此渲染，不再写死在渲染层。 */
  providers: { id: string; label: string; custom: boolean }[];
  provider: string;
  /** Provider wire model name. Demo keeps the historical explicit fixture label. */
  model: string;
  /** Stable registry id; demo has none. */
  modelId: string | null;
  /** Every real model exposed by the one shared worker/main registry. */
  models: ProviderModelInfo[];
  /** Whether the selected real provider's mapped key env is present. Never includes the value. */
  keyConfigured: boolean;
}

/** 主会话可用的 provider id：内置四家有字面量提示，自定义家是运行时才知道的字符串
 *  （`(string & {})` 保留字面量提示的同时允许任意 id —— 静态上无法枚举别人写在配置里的家）。 */
export type MainProviderId = EnvKeyedProvider | (string & {});

/** 一次 run 的模型选择。
 *
 *  为什么自定义家单开一支 `kind: "custom"` 而不是把 `kind` 直接放宽成 string：
 *  联合类型靠**字面量**辨识，`string` 会把 `"demo"` 吞掉 ⇒ `selection.kind === "demo"` 再也窄化不了，
 *  全仓 20 多处 `selection.spec` 会集体变成「可能 undefined」。所以标识符保持字面量可辨识，
 *  自定义家的 id 放在 `providerId` 里，由 `selectionProviderId()` 统一取出。 */
export type MainModelSelection =
  | { kind: "demo" }
  | { kind: EnvKeyedProvider; spec: ModelSpec; modelExplicit: boolean }
  | { kind: "custom"; providerId: string; spec: ModelSpec; modelExplicit: boolean };

/** 这次选择实际要拨哪一家（demo 也原样返回）。取 provider id 只许走这里，别处别再拆 kind。 */
export function selectionProviderId(selection: MainModelSelection): string {
  return selection.kind === "custom" ? selection.providerId : selection.kind;
}

/** 自进化「便宜档偏置」（闭环 v2 · 批次 A4）：上一轮读数说贵 ⇒ 主会话拨号向便宜方向降一档。
 *
 *  刻意的三条边界（每条都是「偏置不许越权」的一格）：
 *  · **显式选择不动**：`modelExplicit`（用户在设置/请求里点名了模型）或 demo ⇒ 原样返回——
 *    偏置只降「按缺省表选出来的」那一档，用户点名的档不归它管；
 *  · **只降不升、只降一档**：沿 strong→standard→cheap 方向退一步，不跳档、绝不升档
 *    （升档有自己的路：级联升级的客观判据，见 routing/cascade.ts）；
 *  · **同家内找**：只在同一 provider（`selectionProviderId`）的档位表里找目标档 spec——
 *    跨家换拨号是配置层的事，偏置不越这个权；目标档无 spec（该家没有更便宜的档）⇒ 原样返回。 */
export function preferCheapSelection(selection: MainModelSelection): MainModelSelection {
  if (selection.kind === "demo") return selection;
  if (selection.modelExplicit) return selection;
  const order: readonly ModelSpec["tier"][] = ["strong", "standard", "cheap"];
  const idx = order.indexOf(selection.spec.tier);
  if (idx < 0 || idx === order.length - 1) return selection; // 已是 cheap 或未知档：不动
  const targetTier = order[idx + 1]!;
  const demoted = effectiveModelTable().find(
    (s) => s.tier === targetTier && s.provider === selectionProviderId(selection),
  );
  if (demoted === undefined) return selection;
  return selection.kind === "custom"
    ? { kind: "custom", providerId: selection.providerId, spec: demoted, modelExplicit: false }
    : { kind: selection.kind, spec: demoted, modelExplicit: false };
}

/** 按 provider id 造一支选择：内置走字面量分支，自定义走 custom 分支。 */
function selectionFor(provider: string, spec: ModelSpec, modelExplicit: boolean): MainModelSelection {
  return isBuiltinProviderId(provider)
    ? { kind: provider, spec, modelExplicit }
    : { kind: "custom", providerId: provider, spec, modelExplicit };
}

function isBuiltinProviderId(id: string): id is EnvKeyedProvider {
  return (PROVIDER_IDS as readonly string[]).includes(id);
}

const PROVIDER_LABELS: Record<EnvKeyedProvider, string> = {
  glm: "GLM（OpenAI 兼容）",
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Gemini",
  deepseek: "DeepSeek",
};

/** provider 的展示名：内置四家有固定文案，自定义家用自己的 label，兜底回 id。
 *  兜底不抛：label 只影响显示；真正的把关在 `isKnownProviderId`（未知 id 在那一步就拒了）。 */
export function providerLabel(kind: string): string {
  const builtin = (PROVIDER_LABELS as Readonly<Record<string, string | undefined>>)[kind];
  if (builtin !== undefined) return builtin;
  const custom = installedCustomProviders().find((x) => x.id === kind);
  return custom === undefined ? kind : custom.label;
}

/** 内置四家的 id（错误文案里点名用；从标签表派生，避免再抄一份字面量）。 */
const PROVIDER_LABELS_KEYS = Object.keys(PROVIDER_LABELS);

/** Empty env means "no override"; unknown non-empty values fail visibly instead of falling through. */
export function providerKindFromEnv(raw: string | undefined): ProviderKind | undefined {
  if (raw === undefined || raw === "") return undefined;
  if (raw === "demo" || raw === "mock") return "demo";
  if (isKnownProviderId(raw)) return raw;
  throw new Error(
    `未知 M0A_PROVIDER: ${JSON.stringify(raw)}（允许 demo、内置 ${PROVIDER_LABELS_KEYS.join(" / ")}，或已装的自定义 provider：${
      installedCustomProviders().map((p) => p.id).join(" / ") || "无"
    }）`,
  );
}

function defaultModelFor(provider: string): ModelSpec {
  const table = effectiveModelTable();
  const model =
    table.find((spec) => spec.provider === provider && spec.tier === "standard") ??
    table.find((spec) => spec.provider === provider);
  if (!model) throw new Error(`Provider ${provider} 没有注册模型`);
  return model;
}

function legacyModel(raw: string, source: "settings.model" | "CAIRN_MODEL"): ModelSpec {
  const spec = findSpecByNameOrId(effectiveModelTable(), raw);
  if (!spec) {
    throw new Error(`${source} 未登记到模型表: ${JSON.stringify(raw)}`);
  }
  return spec;
}

export interface ResolveMainModelInput {
  /** Non-empty M0A_PROVIDER override, when present. */
  forcedKind?: ProviderKind;
  configuredKind: ProviderKind;
  /** RunRequest.model: stable registry id only. */
  requestModel?: string;
  /** 自由档位的线上模型名（CLI --model）：不在档位表里，合成一条 spec 用。 */
  explicitModel?: string;
  /** CLI --ctx-window：用户申报的 `explicitModel` 真实窗口。只在 explicitModel 在场时有意义。 */
  explicitCtxWindow?: number;
  /** Legacy settings field: stable id or provider model name. */
  settingsModel: string;
  /** Legacy GLM model env; consulted only for a selected GLM run with no explicit/settings model. */
  legacyEnvModel?: string;
}

/** 自由档位（`--model`）的上下文缺省：取档位表里**最小**的那个窗口。
 *  未知模型的真实窗口无从查证，而两侧代价不对称——**低估只导致提前压缩，高估会撞爆上下文**。
 *  同一个取舍 `findSpecByNameOrId` 已经写下（「预算只允许保守，绝不放大」），这里沿用同一侧。
 *
 *  这行以前是硬编码的 `128_000`，而注释写着「取最小的」——两句话靠巧合对上（今天的表恰好最小是 128k），
 *  没有任何东西保证它们继续一致：加一行 64k 档位，注释当场变假且无人报警。现在改成真推导。
 *
 *  ⚠️ 即便如此，**这个缺省对小于它的模型仍然是高估**，而高估那一侧正是上面写的「撞爆上下文」。
 *  `--model` 的存在意义正是够到表外的模型（小窗网关模型、预览版），所以这个洞是它自己的靶心，
 *  靠调缺省堵不死（调低则每个未知模型都提前压缩，白烧一次摘要）。⇒ 真解是让用户自己声明：
 *  `--ctx-window <n>`（`--model` 专用，不给 `--model` 时拒跑而不是静默忽略）。 */
function freeformCtxWindow(): number {
  const table = effectiveModelTable();
  return table.length > 0 ? Math.min(...table.map((spec) => spec.ctxWindow)) : 128_000;
}

export function resolveMainModel(input: ResolveMainModelInput): MainModelSelection {
  if (input.forcedKind === "demo") {
    if (input.requestModel !== undefined) throw new Error("RunRequest.model 与 M0A_PROVIDER=demo 不匹配");
    if (input.explicitModel !== undefined && input.explicitModel !== "") {
      throw new Error(`explicitModel=${input.explicitModel} 与 M0A_PROVIDER=demo 不匹配（demo 是预录剧本，不拨号）`);
    }
    return { kind: "demo" };
  }

  if (input.requestModel !== undefined) {
    const spec = lookupModel(effectiveModelTable(), input.requestModel);
    if (!spec) {
      throw new Error(`RunRequest.model 未登记（须用稳定 registry id）: ${JSON.stringify(input.requestModel)}`);
    }
    if (!isKnownProviderId(spec.provider)) throw new Error(`模型 ${spec.id} 的 provider 非法: ${spec.provider}`);
    if (input.forcedKind !== undefined && spec.provider !== input.forcedKind) {
      throw new Error(`RunRequest.model=${spec.id} 与 M0A_PROVIDER=${input.forcedKind} 不匹配`);
    }
    return selectionFor(spec.provider, spec, true);
  }

  // 自由档位：显式给了线上模型名（`--model`），它按定义不在档位表里。
  // 放在 demo 回落**之前**是刻意的：显式点名了要拨哪个模型，就绝不能被静默收敛成预录剧本。
  // 也不进档位表：表是 bandit 代价项与预算折钱的依据，往里塞一个查不到价的行等于让它按假价参与路由。
  if (input.explicitModel !== undefined && input.explicitModel !== "") {
    const provider = input.forcedKind ?? input.configuredKind;
    if (!isKnownProviderId(provider)) {
      throw new Error(`--model 需要一家真实 provider（得到 ${JSON.stringify(provider)}）：demo 是预录剧本，不拨号`);
    }
    return selectionFor(
      provider,
      {
        id: freeformModelId(input.explicitModel),
        provider,
        model: input.explicitModel,
        tier: "standard",
        ctxWindow: input.explicitCtxWindow ?? freeformCtxWindow(),
      },
      true,
    );
  }

  // 缺省通道是 demo；但要区分两种"settings 里有个模型名"：
  //   · `legacyEnvModel`（CAIRN_MODEL 环境变量）：**过期遗留**，不许悄悄复活真 provider —— 这条守卫原样保留；
  //   · `settingsModel`（用户界面里明确选过的）：**必须尊重**。
  // 2026-10-06 用户实测「列表出来了但点不动」的第三处根因就在这里：选择器把选择写进了 settings.model，
  // 而这一行把它连同遗留环境变量一起忽略了 ⇒ 点了跟没点一样（探针实测 switched:false）。
  if (input.configuredKind === "demo" && input.forcedKind === undefined) {
    if (input.settingsModel !== "") {
      const picked = lookupModel(effectiveModelTable(), input.settingsModel);
      if (picked !== undefined && isKnownProviderId(picked.provider)) return selectionFor(picked.provider, picked, true);
    }
    return { kind: "demo" };
  }

  const provider = input.forcedKind ?? input.configuredKind;
  if (!isKnownProviderId(provider)) throw new Error(`未知主会话 provider: ${provider}（内置四家，或在 .agent/providers.json 里声明并已装上的自定义家）`);
  const requested = input.settingsModel !== ""
    ? input.settingsModel
    : provider === "glm" ? input.legacyEnvModel : undefined;
  if (requested !== undefined && requested !== "") {
    const spec = legacyModel(requested, provider === "glm" && input.settingsModel === "" ? "CAIRN_MODEL" : "settings.model");
    if (spec.provider !== provider) {
      // 2026-10-06 自愈（用户实测踩到），但**只在一条线上放宽**：
      //   · settings.model 是**注册 id**（形如 `agnes-ai-agnes-3.0-flash` / `openai-standard`）
      //     ⇒ 那是我们自己的选择器写进去的，id 自带 provider；不一致只说明 settings.provider
      //       是滞后的记账值 ⇒ **认模型自带的那家**（旧行为抛错，后果是整份设置进入
      //       "每次刷新都报错"的死状态，而那个状态正是我们自己的选择器造成的）。
      //   · 其余（写的是**线上模型名**，如 glm 配 gpt-4o —— 遗留或手写）
      //     ⇒ 照旧 fail-loud：命名与 provider 冲突是配置本身有问题，不该被我们悄悄改写。
      const byId = lookupModel(effectiveModelTable(), input.settingsModel);
      if (byId !== undefined) {
        if (!isKnownProviderId(byId.provider)) {
          throw new Error(`模型 ${byId.id} 的 provider 非法: ${byId.provider}`);
        }
        return selectionFor(byId.provider, byId, true);
      }
      throw new Error(`模型 ${spec.id} (${spec.provider}) 与 provider=${provider} 不匹配`);
    }
    return selectionFor(provider, spec, true);
  }
  return selectionFor(provider, defaultModelFor(provider), false);
}

export function providerKeyConfigured(
  kind: ProviderKind,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (kind === "demo") return false;
  const envName = envKeyOf(kind);
  if (envName === null) throw new Error(`Provider ${kind} 未登记 env key 映射`);
  const value = env[envName];
  return typeof value === "string" && value.trim() !== "";
}

export function assertProviderKeyConfigured(kind: ProviderKind, env: NodeJS.ProcessEnv = process.env): void {
  if (providerKeyConfigured(kind, env)) return;
  const envName = kind === "demo" ? "无（demo 不需要 key）" : envKeyOf(kind);
  throw new Error(
    `provider=${kind} 未配置 API key（${envName} 缺失）：真实模型通道不可用；` +
      "请配置该 provider 的 key，或显式切换到 demo。不会静默回落其他 provider/demo。",
  );
}

export function buildProviderInfo(
  selection: MainModelSelection,
  env: NodeJS.ProcessEnv = process.env,
): ProviderInfo {
  // demo 是**缺省**通道（`DEFAULT_SETTINGS.provider === "demo"`），所以这一支曾经让模型选择器
  // 在全新安装上永远空着 —— 用户即使在设置里加好了自己的模型，回对话页也看不到它。
  // 现在这里照旧铺**全量真模型**：demo 只表示「没选模型时跑冻结剧本」，不表示「没有模型可选」。
  // 选了真模型就会走 resolveMainModel 的 requestModel 分支（它排在 demo 回落之前），语义自洽。
  if (selection.kind === "demo") {
    return {
      kind: "demo",
      provider: "demo（冻结剧本，非真实模型）",
      model: "mock-script",
      modelId: null,
      models: modelsForCurrentTable().getModelInfos() as ProviderModelInfo[],
      keyConfigured: false,
      providers: knownProviders(),
    };
  }
  // 用**有效**档位表（内置 + 已装自定义）：这样自定义模型会出现在选择器里，
  // 而不是「配上了但界面上选不到」——那正是本仓点名过的「能力发货、入口不通」。
  const models = modelsForCurrentTable().getModelInfos() as ProviderModelInfo[];
  const providerId = selectionProviderId(selection);
  return {
    kind: providerId,
    provider: providerLabel(providerId),
    model: selection.spec.model,
    modelId: selection.spec.id,
    models,
    keyConfigured: providerKeyConfigured(providerId, env),
    providers: knownProviders(),
  };
}

/** 已知的 provider 清单（内置四家 + 已装自定义家）。
 *  为什么要有这一格：设置页的 provider 下拉原先是**渲染层写死的常量**
 *  （`PANEL_PROVIDER_KINDS`），所以用户新加的家里根本选不上它 —— 配了却切不过去，
 *  正是本仓点名过的「能力发货、入口不通」。清单必须跟注册表同源，所以由主进程铺出去。 */
export function knownProviders(): { id: string; label: string; custom: boolean }[] {
  const builtin = (Object.keys(PROVIDER_LABELS) as EnvKeyedProvider[]).map((id) => ({
    id,
    label: PROVIDER_LABELS[id],
    custom: false,
  }));
  const custom = installedCustomProviders().map((p) => ({ id: p.id, label: p.label, custom: true }));
  return [...builtin, ...custom];
}
