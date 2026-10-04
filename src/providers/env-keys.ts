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
} as const;

export type EnvKeyedProvider = keyof typeof PROVIDER_ENV_KEYS;

/** 有 env 名映射的 provider 清单（表序 = 声明序）。 */
export const ENV_KEYED_PROVIDERS = Object.keys(PROVIDER_ENV_KEYS) as EnvKeyedProvider[];

/** 取某 provider 的 key 环境变量名；未登记 → null（调用方须 fail-visible，不许静默跳过那一家）。 */
export function envKeyOf(provider: string): string | null {
  return (PROVIDER_ENV_KEYS as Readonly<Record<string, string | undefined>>)[provider] ?? null;
}
