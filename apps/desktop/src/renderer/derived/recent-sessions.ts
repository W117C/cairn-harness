// 空屏下半区承接的数据面（2026-11-08 第 1048 页）：从真实会话里挑最近 3 条。
// 派生层纯函数：不碰 IPC、不碰 React；无标题 / 已归档 / 别的工作区一律不进结果。
// 不放假数据——空数组交回给 EmptyContext 时整块不渲染（不摆空壳）。
import type { WorkspaceSession } from "../sessions-view";

export interface RecentSessionItem {
  id: string;
  title: string;
  workspace: string;
}

export function pickRecentSessions(
  sessions: readonly WorkspaceSession[],
  workspace: string | null,
): RecentSessionItem[] {
  return sessions
    .filter((s) => (workspace === null || s.workspace === workspace)
      && (s.title ?? "").trim() !== "" && s.archived !== true)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, 3)
    .map((s) => ({ id: s.id, title: (s.title ?? "").trim(), workspace: s.workspace }));
}
