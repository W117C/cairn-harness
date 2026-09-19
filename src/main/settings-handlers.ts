import {
  deleteProviderKey,
  providerKeyStatus,
  putProviderKey,
} from "./provider-keys";
import { verifyLicenseFile, type LicenseState } from "./license";
import { checkUpdate, type UpdateCheckResult } from "./updater";
import { SettingsStore, type AppSettings, type ProviderKind } from "./settings";

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

/** Provider 只读展示（设置页）：与 run 同源（settings + env 覆盖），不读 key 不落日志。
 *  P-1 步骤 2：此前只认 M0A_PROVIDER env ⇒ 设置页永远显示 mock，与「用户其实选了真模型」脱节。 */
export async function providerInfo(): Promise<{ provider: string; model: string; kind: ProviderKind }> {
  const kind = await host.resolveProviderKind();
  if (kind === "glm") {
    const model = (await store().get()).model || process.env.M0_MODEL || "glm-5.2";
    return { provider: "GLM（OpenAI 兼容）", model, kind };
  }
  return { provider: "demo（冻结剧本，非真实模型）", model: "mock-script", kind };
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
  return { ...st, envActive: !!process.env.M0_API_KEY };
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
