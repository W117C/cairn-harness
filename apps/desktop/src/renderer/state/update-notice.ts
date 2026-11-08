// 启动时轻量检查更新（2026-10-30 · 第 810 页）。
//
// 设置页的「检查更新」一直只在用户主动点时才跑；更新源配好的人也要先想起去点。
// 这里在启动时补一次：有 updateManifestUrl 才查，24 小时最多一次，发现新版本用全局 notice 说出来。
// 不下载、不安装，也不把「检查失败」当错误弹窗——手动检查才是详细错误面的入口。
import { useEffect, useSyncExternalStore } from "react";
import type { AgentApi } from "../../../../../src/main/ipc-protocol";

type UpdateCheckResult = Awaited<ReturnType<AgentApi["checkUpdate"]>>;

export const UPDATE_CHECK_STORAGE_KEY = "cairn.update-check.v1";
export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** 上次检查为空/非数/超过 24h（或时钟倒退）⇒ 该查；23h 内不重复打扰。 */
export function shouldCheckForUpdate(lastCheckedAt: number | null, now: number): boolean {
  if (lastCheckedAt === null || !Number.isFinite(lastCheckedAt)) return true;
  if (now < lastCheckedAt) return true;
  return now - lastCheckedAt >= UPDATE_CHECK_INTERVAL_MS;
}

export interface AvailableUpdate {
  version: string;
  url: string;
  notes?: string;
}

/** 全局可用更新：notice 会随会话走，头像上的点不会——两处读同一个 store。 */
let availableUpdate: AvailableUpdate | null = null;
const updateListeners = new Set<() => void>();

export function getAvailableUpdate(): AvailableUpdate | null {
  return availableUpdate;
}

export function setAvailableUpdate(next: AvailableUpdate | null): void {
  availableUpdate = next;
  for (const listener of updateListeners) listener();
}

function subscribeAvailableUpdate(listener: () => void): () => void {
  updateListeners.add(listener);
  return () => { updateListeners.delete(listener); };
}

/** 侧栏头像红点读这个；SSR 固定 null（服务端没有更新检查）。 */
export function useAvailableUpdate(): AvailableUpdate | null {
  return useSyncExternalStore(subscribeAvailableUpdate, getAvailableUpdate, () => null);
}

/** 只有「有可用新版本」才值得打扰；未配置/已最新/出错都静默（详细面在设置页）。 */
export function updateNoticeText(result: UpdateCheckResult): string | null {
  if (result.state !== "available") return null;
  return `发现新版本 ${result.version}——到「设置 → 关于与更新」查看`;
}

function readLastCheck(): number | null {
  try {
    const raw = localStorage.getItem(UPDATE_CHECK_STORAGE_KEY);
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function writeLastCheck(now: number): void {
  try { localStorage.setItem(UPDATE_CHECK_STORAGE_KEY, String(now)); } catch { /* 隐私模式写不了：下次再查，不阻断 */ }
}

/** 启动检查：读设置 → 节流 → checkUpdate → 有更新才 notify。 */
export function useUpdateNotice(notify: (message: string) => void): void {
  useEffect(() => {
    let alive = true;
    const now = Date.now();
    if (!shouldCheckForUpdate(readLastCheck(), now)) return;
    void (async () => {
      const settings = await window.agent.getSettings().catch(() => null);
      if (!alive || settings === null) return;
      if ((settings.updateManifestUrl ?? "").trim() === "") return;
      writeLastCheck(now);
      const result = await window.agent.checkUpdate().catch(() => null);
      if (!alive || result === null) return;
      if (result.state === "available") {
        setAvailableUpdate({
          version: result.version,
          url: result.url,
          ...(result.notes !== undefined ? { notes: result.notes } : {}),
        });
        notify(updateNoticeText(result) as string);
      }
    })();
    return () => { alive = false; };
  }, [notify]);
}
