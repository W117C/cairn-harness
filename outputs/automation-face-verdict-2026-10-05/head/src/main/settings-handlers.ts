import {
  deleteProviderKey,
  providerKeyStatus,
  putProviderKey,
} from "./provider-keys";
import { verifyLicenseFile, type LicenseState } from "./license";
import { checkUpdate, type UpdateCheckResult } from "./updater";
import { PROVIDER_KINDS, SettingsStore, type AppSettings, type ProviderKind } from "./settings";
import { DEFAULT_MODEL_TABLE, findSpecByNameOrId } from "../providers/registry";
import { ENV_KEYED_PROVIDERS, envKeyOf } from "../providers/env-keys";
import {
  buildProviderInfo,
  providerKindFromEnv,
  resolveMainModel,
  type ProviderInfo,
} from "./provider-runtime";
import { ONBOARDING_GROUPS, type OnboardingGroup } from "./onboarding-groups";

// ---- M1e：settings 存储 + 会话目录 + Provider 只读信息 ----
// settings 文件与会话目录由 shell（index.ts）按环境初始化：M1E_SETTINGS_PATH / M1E_SESSIONS_DIR
// （验收脚本注入临时目录；electron 壳缺省 userData）。store 惰性建（headless 脚本未初始化时用缺省值）。

/** 本模块不反向依赖 agent-runner（那是装配根）：需要它的两处按回调解耦，由装配根启动时注入。 */
export interface SettingsHostDeps {
  /** 与 run 同源的 provider 判定（runAgent 那套 settings + env 覆盖）。 */
  resolveProviderKind: () => Promise<ProviderKind>;
  /** M4a：scheduleConcurrencyCap 变更 → 调度器即时生效。 */
  onScheduleCapChange: (cap: number) => void;
}
const UNWIRED: SettingsHostDeps = {
  resolveProviderKind: async () => "demo",
  onScheduleCapChange: () => {},
};
let host: SettingsHostDeps = UNWIRED;

/** 装配根注入（未注入 = demo provider + 并发上限不热更新，不静默假装生效）。 */
export function setSettingsHostDeps(deps: SettingsHostDeps): void {
  host = deps;
}

let settingsStore: SettingsStore | null = null;

/** shell 启动时初始化 settings 存储（文件路径）。 */
export function initSettingsStore(filePath: string): void {
  settingsStore = new SettingsStore(filePath);
}

export function store(): SettingsStore {
  if (!settingsStore) settingsStore = new SettingsStore("/tmp/m1e-default-settings.json");
  return settingsStore;
}

export async function getSettings(): Promise<AppSettings> {
  return await store().get();
}

export async function setSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) throw new Error("settings patch 必须是对象");
  if (patch.provider !== undefined && !(PROVIDER_KINDS as readonly string[]).includes(patch.provider)) {
    throw new Error(`未知 provider: ${String(patch.provider)}`);
  }
  if (patch.model !== undefined && patch.model !== "" && !findSpecByNameOrId(DEFAULT_MODEL_TABLE, patch.model)) {
    throw new Error(`未知模型: ${JSON.stringify(patch.model)}`);
  }
  const next = await store().set(patch);
  // 环境转发：gatedTool 读 M1E_SAFE_MODE（M1e 最小语义）；主题/档位由 renderer 持有并随 run 传回
  if (patch.safeMode !== undefined) {
    if (next.safeMode === "off") delete process.env.M1E_SAFE_MODE;
    else process.env.M1E_SAFE_MODE = next.safeMode;
  }
  // M4a：定时并发上限变更 → 调度器即时生效
  if (patch.scheduleConcurrencyCap !== undefined) host.onScheduleCapChange(next.scheduleConcurrencyCap);
  return next;
}

/** §13 引导覆盖面（只读）。向导的数据源只有这一份：渲染层自存副本 = 第二套事实，
 *  七组的增删改会只改一边（commercial-check D1 就是判这张表的）。 */
export async function onboardingGroups(): Promise<OnboardingGroup[]> {
  return [...ONBOARDING_GROUPS];
}

/** Settings/provider read model. It resolves the same selection as a run and exposes only registry rows. */
export async function providerInfo(): Promise<ProviderInfo> {
  const settings = await store().get();
  const selection = resolveMainModel({
    forcedKind: providerKindFromEnv(process.env.M0A_PROVIDER),
    configuredKind: await host.resolveProviderKind(),
    settingsModel: settings.model,
    legacyEnvModel: process.env.CAIRN_MODEL,
  });
  return buildProviderInfo(selection);
}

// ---- M4b：BYOK key（safeStorage）+ license V1 + 更新检查（§2.1/§2.2/§2.3）----
// 装配由 electron 壳（index.ts）注入；headless（未装配）= fail-closed / inactive / unconfigured 显式态。

// injectStoredProviderKey 已抽到 ./provider-key-inject（轻模块——本文件依赖链含 MCP SDK/LSP，
// 单测/启动注入不应被迫导入整条重链）；此处再导出，index.ts 与既有调用方接口不变。
export { injectStoredProviderKey } from "./provider-key-inject";

export async function handleProviderKeySet(provider: string, key: string): Promise<{ ok: boolean; error?: string }> {
  return await putProviderKey(provider, key);
}

export async function handleProviderKeyDelete(provider: string): Promise<{ ok: boolean; error?: string }> {
  return await deleteProviderKey(provider);
}

/** 状态面（设置页徽标 + env 并存提示；不含 key 值）。 */
export async function handleProviderKeyStatus(): Promise<{ available: boolean; stored: string[]; envActive: boolean }> {
  const st = await providerKeyStatus();
  return {
    ...st,
    envActive: ENV_KEYED_PROVIDERS.some((provider) => {
      const envName = envKeyOf(provider);
      return envName !== null && !!process.env[envName];
    }),
  };
}

let licenseFilePath: string | null = null;

/** shell 启动时初始化 license 文件路径（<appData>/license.json）。 */
export function initLicenseStore(filePath: string): void {
  licenseFilePath = filePath;
}

export async function handleLicenseStatus(): Promise<LicenseState> {
  if (!licenseFilePath) return { state: "inactive" };
  return await verifyLicenseFile(licenseFilePath);
}

let appVersion = "0.0.1";

/** shell 启动时注入当前版本（app.getVersion()；headless 缺省 package.json 版本）。 */
export function initUpdateContext(opts: { currentVersion: string }): void {
  appVersion = opts.currentVersion;
}

/** 装配根的状态面（agent:state 的 about 段）读版本号。 */
export function getAppVersion(): string {
  return appVersion;
}

export async function handleUpdateCheck(): Promise<UpdateCheckResult> {
  const manifestUrl = (await store().get()).updateManifestUrl;
  return await checkUpdate({ manifestUrl, currentVersion: appVersion });
}
