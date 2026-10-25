// provider → API key 环境变量名的**唯一事实源**。
// 这条事实在本仓曾被写三遍：适配器各自的 `apiKeyEnv ?? "<NAME>_API_KEY"` 字面量、注入面硬编码的
// `CAIRN_API_KEY`、判卷面（providers-check ⑥ 段 DARKS）里的三条 env 字符串——改一处即静默失配
// （本仓点名的「同族出口策略副本」）。注入面与判卷面自此都改读本表；适配器那份字面量是它的
// 缺省值，两者是否一致由 `providers-check` ⑧ 走 `toWorkerModel` 真抛错对账（表写错 tsc 抓不到）。
export const PROVIDER_ENV_KEYS = {
  glm: "CAIRN_API_KEY",
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  gemini: "GEMINI_API_KEY",
  // 追加在尾：表序 = ENV_KEYED_PROVIDERS 序 = PROVIDER_KINDS 序 = 桌面面板序，
  // 与 registry 的 PROVIDER_IDS 逐位对账（tests/main-provider-runtime.test.ts 钉着）。
  deepseek: "DEEPSEEK_API_KEY",
} as const;

export type EnvKeyedProvider = keyof typeof PROVIDER_ENV_KEYS;

/** 有 env 名映射的 provider 清单（表序 = 声明序）。 */
export const ENV_KEYED_PROVIDERS = Object.keys(PROVIDER_ENV_KEYS) as EnvKeyedProvider[];

/** 取某 provider 的 key 环境变量名；未登记 → null（调用方须 fail-visible，不许静默跳过那一家）。 */
export function envKeyOf(provider: string): string | null {
  return (
    (PROVIDER_ENV_KEYS as Readonly<Record<string, string | undefined>>)[provider] ?? customEnvKeys[provider] ?? null
  );
}

/* ---- 自定义 provider 的 env 名（`.agent/providers.json` 的 apiKeyEnv）-----------------------------
   为什么用「注入」而不是让本文件去 import registry：本文件是**叶子**，而 provider-key-inject 的
   头注写明它只依赖叶子模块、就为了不必为重依赖付导入成本（否则 provider-keys 的单测会确定性超时）。
   所以方向反过来：registry 装自定义 provider 时，顺手把 env 名表推到这里。
   —— 这样「装一次，处处生效」，调用方不可能只装一半（BYOK 可达性的四格要求同源）。 */
let customEnvKeys: Readonly<Record<string, string>> = {};

/** 由 registry 的 `installCustomProviders` 调用；传空对象 = 回到纯内置。 */
export function installCustomEnvKeys(map: Readonly<Record<string, string>>): void {
  customEnvKeys = map;
}

/** 已登记的自定义 provider id（判卷与 UI 用；不含内置四家）。 */
export function customEnvKeyedProviders(): readonly string[] {
  return Object.keys(customEnvKeys).sort();
}
