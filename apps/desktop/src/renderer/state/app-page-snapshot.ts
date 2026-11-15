import type { MemorySnapshot } from "../../../../../src/main/ipc-protocol";
import type { PluginPanelSnapshot } from "../../../../../src/agent/plugins";
import type { ScheduleSnapshot } from "../../../../../src/main/scheduler";
import type { PageId } from "../app-controls";

export type AppPageSnapshot = {
  plugins?: PluginPanelSnapshot;
  schedule?: ScheduleSnapshot;
  memory?: MemorySnapshot;
  worktree?: {
    workspace: string;
    orphans: string[];
    details?: { name: string; dirty: boolean }[];
  };
};

export interface AppPageSnapshotState {
  page: PageId;
  /** 这份快照是按哪个窗口工作区取的：换项目时旧行必须立刻不可再操作（写的是新项目）。 */
  workspace: string | null | undefined;
  generation: number;
  snapshot: AppPageSnapshot | null;
  loadError: string | null;
}

export type AppPageSnapshotAction =
  | { type: "start"; page: PageId; generation: number; workspace: string | null | undefined }
  | { type: "resolve"; page: PageId; generation: number; snapshot: AppPageSnapshot }
  | { type: "reject"; page: PageId; generation: number; message: string };

export function createAppPageSnapshotState(
  page: PageId,
  workspace: string | null | undefined = undefined,
): AppPageSnapshotState {
  return { page, workspace, generation: 0, snapshot: null, loadError: null };
}

export function appPageSnapshotReducer(
  state: AppPageSnapshotState,
  action: AppPageSnapshotAction,
): AppPageSnapshotState {
  if (action.type === "start") {
    // 同一页的手动刷新保留旧内容（不闪）；换工作区不保留——旧清单上的删除 / 信任会写进新项目。
    const sameSurface = state.page === action.page && state.workspace === action.workspace;
    return {
      page: action.page,
      workspace: action.workspace,
      generation: action.generation,
      snapshot: sameSurface ? state.snapshot : null,
      loadError: null,
    };
  }
  if (state.page !== action.page || state.generation !== action.generation) return state;
  if (action.type === "resolve") {
    return { ...state, snapshot: action.snapshot, loadError: null };
  }
  return { ...state, snapshot: null, loadError: action.message };
}
