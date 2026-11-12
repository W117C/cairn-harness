// Provider 目录与 key 状态（第 1096 页从 workbench.ts 拆出）：
// workbench.ts 已到 1198/1200 行帽，任何新增都会破 I4。这里只搬一组自洽状态：
// providerInfo（模型目录）＋ providerKeys（stored ∪ env）＋ 两个刷新函数 ＋ configuredProviders。
// 业务语义逐字保留：providerInfo 失败仍诚实降级 null 并出声；key 状态失败仍落 null（未知，不是空）。
import { useCallback, useMemo, useState } from "react";
import type { ProviderInfo } from "../../../../../src/main/ipc-protocol";

export interface ProviderKeyStatus {
  available: boolean;
  stored: string[];
  envActive: boolean;
  envProviders: string[];
}

export function useProviderCatalog(setLastNotice: (message: string) => void): {
  providerInfo: ProviderInfo | null;
  providerKeys: ProviderKeyStatus | null;
  refreshProviderInfo: () => Promise<void>;
  refreshProviderKeys: () => Promise<void>;
  configuredProviders: Set<string> | undefined;
} {
  const [providerInfo, setProviderInfo] = useState<ProviderInfo | null>(null);
  // key 状态（stored ∪ env 在场）：ModelPicker 据此过滤内置模型（没配 key 的不显示，而非置灰）。
  const [providerKeys, setProviderKeys] = useState<ProviderKeyStatus | null>(null);

  const refreshProviderInfo = useCallback(() => {
    // 「静默丢弃要出声」：provider-info 解析失败仍诚实降级 null + 一条可见通知。
    return window.agent.getProviderInfo().then(setProviderInfo).catch((err: unknown) => {
      setProviderInfo(null);
      setLastNotice(`主会话模型目录不可用：${err instanceof Error ? err.message : String(err)}`);
    });
  }, [setLastNotice]);

  const refreshProviderKeys = useCallback(() => {
    return window.agent.providerKeyStatus().then(setProviderKeys).catch(() => setProviderKeys(null));
  }, []);

  // 已配 key 的 provider 集合（stored ∪ env 在场）：ModelPicker 据此过滤内置模型。
  const configuredProviders = useMemo(
    () => (providerKeys === null ? undefined : new Set<string>([...providerKeys.stored, ...providerKeys.envProviders])),
    [providerKeys],
  );

  return { providerInfo, providerKeys, refreshProviderInfo, refreshProviderKeys, configuredProviders };
}
