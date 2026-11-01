// BYOK key 启动注入（M4b §2.1）：从 agent-runner 抽出为独立轻模块——
// 原实现放在 agent-runner.ts（静态依赖链含 MCP SDK/LSP，测试环境动态导入约 20s），
// provider-keys 单测为测本函数被迫导入整条重链而确定性超时（5s）。
// 本模块只依赖 provider-keys + providers/env-keys：启动注入与测试两侧都不必为重依赖付导入成本。
import { getProviderKey, PROVIDER_IDS } from "./provider-keys";
import { customEnvKeyedProviders, envKeyOf } from "../providers/env-keys";

// Only values injected by Cairn may be refreshed or removed. External env remains authoritative.
const injectedValues = new Map<string, { provider: string; value: string }>();

/** Revoke only this provider's own values, including mappings no longer in the registry. */
export function revokeInjectedProviderKey(provider: string, keepEnv?: string): boolean {
  let revoked = false;
  for (const [envName, owner] of injectedValues) {
    if (owner.provider !== provider || envName === keepEnv) continue;
    injectedValues.delete(envName);
    if (process.env[envName] === owner.value) {
      delete process.env[envName];
      revoked = true;
    }
  }
  return revoked;
}

/** 把已存 key 注入各自 provider 的 env；外部 env 优先，Cairn 自己的旧注入可刷新/撤销。
 *  注入只发生在进程内 env——不落日志、不进事件流（明文零落盘三处纪律）。
 *  **遍历存储白名单**，不再硬编码 `"glm"`：白名单加一家，注入面自动跟上门（原实现是「能力发货、
 *  入口不通」的下半截——存得进、没人读）。缺 env 名映射即崩：那是登记漏了一半，静默跳过会让
 *  用户以为「key 存了就生效」，而 provider 层读不到 key 才是真后果。
 *  `providers` 形参给判卷留缝：判据要能问「白名单是四家时注入面跟不跟得上」，而不只问今天一家。
 *  true 表示读回确认了 Cairn 管理的注入值，或已撤销旧注入；重复刷新仍可确认已生效。 */
export async function injectStoredProviderKey(
  providers: readonly string[] = [...PROVIDER_IDS, ...customEnvKeyedProviders()],
): Promise<boolean> {
  let injected = false;
  for (const provider of providers) {
    const envName = envKeyOf(provider);
    if (envName === null) {
      throw new Error(`provider-key 注入：provider=${JSON.stringify(provider)} 没有 env 名映射（须登记进 src/providers/env-keys.ts）`);
    }
    if (revokeInjectedProviderKey(provider, envName)) injected = true;
    const current = process.env[envName];
    const owner = injectedValues.get(envName);
    const previous = owner?.provider === provider ? owner.value : undefined;
    if (owner !== undefined && current !== owner.value) injectedValues.delete(envName);
    if (current && current !== previous) continue;
    const stored = await getProviderKey(provider);
    // Another refresh or the caller may change env while storage is being read.
    if (process.env[envName] !== current) continue;
    if (!stored) {
      if (previous !== undefined && current === previous) {
        delete process.env[envName];
        injectedValues.delete(envName);
        injected = true;
      }
      continue;
    }
    if (stored === current) { injected = true; continue; }
    process.env[envName] = stored;
    injectedValues.set(envName, { provider, value: stored });
    injected = true;
  }
  return injected;
}
