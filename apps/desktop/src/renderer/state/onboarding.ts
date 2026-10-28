import { useCallback, useEffect, useState } from "react";
import type { OnboardingGroup } from "../../../../../src/main/onboarding-groups";

/** 首启「设置检查」的数据面与完成出口。
 *  标记（onboarded）由 settings 载入面持有；这里只在 false 时取七组，
 *  并只提供一个完成出口：落 settings.onboarded=true（失败回滚）。 */
export function useOnboardingGroups(
  onboarded: boolean | null,
  setOnboarded: (value: boolean) => void,
  setLastError: (message: string) => void,
): { onboarding: readonly OnboardingGroup[]; dismissOnboarding: () => void } {
  const [onboarding, setOnboarding] = useState<readonly OnboardingGroup[]>([]);

  // 只在还没 onboarded 时取那七组；取不到 ⇒ 空数组 ⇒ 整块不渲染（不摆空壳）。
  useEffect(() => {
    if (onboarded !== false) return;
    let alive = true;
    void window.agent.getOnboarding().then(
      (groups) => { if (alive) setOnboarding(groups); },
      () => { if (alive) setOnboarding([]); },
    );
    return () => { alive = false; };
  }, [onboarded]);

  // 本地先隐藏，写 settings 失败则回滚并留错误；只隐藏不落盘 ⇒ 下次重开又回来。
  const dismissOnboarding = useCallback(() => {
    setOnboarded(true);
    void window.agent.setSettings({ onboarded: true }).catch((err: unknown) => {
      setOnboarded(false);
      setLastError(`首启设置检查保存失败：${err instanceof Error ? err.message : String(err)}`);
    });
  }, [setOnboarded, setLastError]);

  return { onboarding, dismissOnboarding };
}
