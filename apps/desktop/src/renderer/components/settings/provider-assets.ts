// 设置页纯函数资产（第 1072 页从 settings-sections.tsx 解耦抽出的叶子模块）——patch 白名单 /
// provider 选项集与缺省 / 凭据状态三件 / 搜索与识图能力状态行。只依赖 ipc-protocol 类型，无 react、
// 不 import 任何段或 monolith：段（ProviderSection）与壳（SettingsPanel）/判卷都从这里或经 monolith 重导出消费，
// 避免 monolith↔段 经重导出成回流环。对外字符串逐字不变。
import type { AppSettings } from "../../../../../../src/main/ipc-protocol";
import { STR } from "../../strings";

/** patch 白名单：UI 只放行这五键，不透传任意 patch。
 *  locale 进白名单修的是实测缺陷：下拉框选了 English、后端也白名单放行，但 panelPatch 把它丢了
 *  ⇒ 显示"已保存"而选项没落库（同族形态：视图说成功、事实没发生）。
 *  方案默认值键出列（2026-11-03 业主）：方案模式不再由用户武装，agent 自判。 */
export const PANEL_PATCH_KEYS = ["provider", "model", "mode", "theme", "locale"] as const;

export function panelPatch(patch: Record<string, unknown>): Partial<AppSettings> {
  const out: Partial<AppSettings> = {};
  for (const key of PANEL_PATCH_KEYS) {
    const value = patch[key];
    if (value !== undefined) (out as Record<string, unknown>)[key] = value;
  }
  return out;
}

/** provider 选项集（同形再推导：settings.ts 拖 node:fs，不能进 renderer bundle；
 *  与 settings.PROVIDER_KINDS 的逐位等值由 settings-panel.test 对账钉死）。 */
export const PANEL_PROVIDER_KINDS: readonly string[] = ["demo", "glm", "openai", "anthropic", "gemini", "deepseek"];

/** 该 provider 是否需要 key（demo 免；未知一律按要 key 判——fail-visible 而不是当 demo 放行）。 */
export function providerNeedsKey(kind: string): boolean {
  return kind !== "demo";
}

/** key 表单的缺省 provider：选项集里第一个需要 key 的。
 *  修复实测缺陷：初值曾写死 "deepseek"，而选项集里根本没有它（干净注册表下后端白名单直接拒收）
 *  ——用户不主动重选就第一次保存必失败。缺省值必须从同一张选项集里推导。 */
export function defaultKeyProvider(kinds: readonly string[] = PANEL_PROVIDER_KINDS): string {
  return kinds.find((k) => providerNeedsKey(k)) ?? kinds[0] ?? "";
}

/** 凭据段状态三件（2026-10-16 模型/通道页重做）：已存 key 由徽章承担（line 不重复摆字）、
 *  env 提示走提示色小字位；safeStorage 不可用 = warn（danger 色），拒存口径照旧不虚报。 */
export interface ProviderStatusParts {
  /** 状态行（已存 key 时为空串——徽章已表达）。 */
  line: string;
  /** 已存 key 清单（徽章数据源）；安全存储不可用时为空。 */
  stored: string[];
  /** 「检测到环境变量，将优先使用」；无则 null。 */
  envHint: string | null;
  tone: "ok" | "warn";
}

export function providerStatusParts(status: { available: boolean; stored: string[]; envActive: boolean }): ProviderStatusParts {
  if (!status.available) {
    return { line: STR.provider.statusStorageBlocked, stored: [], envHint: null, tone: "warn" };
  }
  const envHint = status.envActive ? STR.provider.statusEnvHint : null;
  if (status.stored.length === 0) return { line: STR.provider.statusNoKey, stored: [], envHint, tone: "ok" };
  return { line: "", stored: [...status.stored], envHint, tone: "ok" };
}

/** 凭据段状态行（三态文案唯一出口；由 providerStatusParts 拼回——对外字符串逐字不变）。
 *  批 6（细则 §六）：env 优先规则改一行通俗说明「检测到环境变量，将优先使用」。 */
export function providerStatusLabel(status: { available: boolean; stored: string[]; envActive: boolean }): string {
  const parts = providerStatusParts(status);
  if (!status.available) return parts.line;
  const base = parts.stored.length === 0 ? parts.line : STR.provider.statusStored.replace("{list}", parts.stored.join("、"));
  return parts.envHint !== null ? `${base}；${parts.envHint}` : base;
}

/** 搜索能力状态行（三态文案唯一出口；口径同 CLI --doctor 的 search 那一格）。
 *
 *  为什么值得在设置页占一行：`web_search` 没配端点时**整族不注入**（规格面与执行面同时摘），
 *  模型于是会说「我没有检索能力」。这句话对，但用户此前无从知道原因——doctor 只有 CLI 输出，
 *  桌面端没有那个面。结果是一个**配置缺口被体验成模型缺陷**。
 *  这一行把「没配」说成一句可执行的话，而不是让用户猜。 */
export function searchCapabilityLabel(cap: {
  search: { kind: "unset" } | { kind: "ok" } | { kind: "broken"; message: string };
  searchEndpoint?: string;
}): string {
  if (cap.search.kind === "ok") {
    return cap.searchEndpoint !== undefined ? STR.provider.searchOkWith.replace("{endpoint}", cap.searchEndpoint) : STR.provider.searchOk;
  }
  if (cap.search.kind === "unset") {
    return STR.provider.searchMissing;
  }
  return STR.provider.searchBroken.replace("{reason}", cap.search.message);
}

/** 未配搜索端点时的那句配法。单独一行常量而不是 JSX 里拼 JSON：
 *  JSX 转义出来的引号形状没人读得懂，而这句话是要用户照抄的。 */
export const SEARCH_CONFIG_HINT = STR.provider.searchConfigHint;

/** 识图能力状态行（三态，与 `searchCapabilityLabel` 同一形状的理由）。
 *
 *  2026-10-16 读数：`cn:hy3` 没声明 image 模态，而 render_image 渲出来的图照样进请求体。
 *  于是「工具调用成功」被读成「模型看得懂这张图」——两件事必须分开摆。
 *  三态：declared（配置里声明了 image 模态，仍是配置侧事实，不是上游实测）/
 *  undeclared（没声明 ⇒ 按不支持处理）/ unverified（连选中模型都取不到，不猜）。 */
export function visionCapabilityLabel(cap: {
  vision: { state: "declared" | "undeclared" | "unverified"; modelId: string | null; declaredModalities: readonly string[] };
}): string {
  const v = cap.vision;
  if (v.state === "declared") {
    return STR.provider.visionDeclared.replace("{model}", v.modelId ?? STR.provider.currentModel);
  }
  if (v.state === "undeclared") {
    return STR.provider.visionUndeclared.replace("{model}", v.modelId ?? STR.provider.currentModel);
  }
  return STR.provider.visionUnverified;
}
