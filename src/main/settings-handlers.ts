import {
  deleteProviderKey,
  providerKeyStatus,
  putProviderKey,
} from "./provider-keys";
import { verifyLicenseFile, type LicenseState } from "./license";
import { checkUpdate, type UpdateCheckResult } from "./updater";
import { SettingsStore, isPersistableProvider, type AppSettings, type ProviderKind } from "./settings";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { effectiveModelTable, findSpecByNameOrId } from "../providers/registry";
import { ENV_KEYED_PROVIDERS, customEnvKeyedProviders, envKeyOf } from "../providers/env-keys";
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
let fallbackSettingsPath: string | null = null;

/** shell 启动时初始化 settings 存储（文件路径）。 */
export function initSettingsStore(filePath: string): void {
  settingsStore = new SettingsStore(filePath);
}

export function store(): SettingsStore {
  if (!settingsStore) {
    fallbackSettingsPath ??= join(mkdtempSync(join(tmpdir(), "cairn-settings-")), "settings.json");
    settingsStore = new SettingsStore(fallbackSettingsPath);
  }
  return settingsStore;
}

export async function getSettings(): Promise<AppSettings> {
  return await store().get();
}

export async function setSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) throw new Error("settings patch 必须是对象");
  // 2026-10-06 用户实测踩到：这两道闸原先是**只有内置四家的静态清单**，而读设置的通道
  // （settings.ts 的 validateSettings）早就改成「内置 ∪ 已装自定义」了 —— 写读口径不一致，
  // 于是自定义家刚存好、下一步"设为当前通道"就被打回（报 `未知 provider: agnes-ai`）。
  // 现在两边共用同一对判据（isPersistableProvider / effectiveModelTable）。
  if (patch.provider !== undefined && !isPersistableProvider(patch.provider)) {
    throw new Error(`未知 provider: ${String(patch.provider)}`);
  }
  if (patch.model !== undefined && patch.model !== "" && !findSpecByNameOrId(effectiveModelTable(), patch.model)) {
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
export async function handleProviderKeyStatus(): Promise<{ available: boolean; stored: string[]; envActive: boolean; envProviders: string[] }> {
  const st = await providerKeyStatus();
  // env 在场的 provider 清单：renderer 侧「按已配 key 过滤内置模型」需要逐家判断，
  // envActive 是 any 粒度，无法区分是哪一家（注入面会把已存 key 写进 process.env，env 优先）。
  const envProviders = [...ENV_KEYED_PROVIDERS, ...customEnvKeyedProviders()].filter((provider) => {
    const envName = envKeyOf(provider);
    return envName !== null && !!process.env[envName];
  });
  return {
    ...st,
    envActive: envProviders.length > 0,
    envProviders,
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
