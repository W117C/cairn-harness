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
  generation: number;
  snapshot: AppPageSnapshot | null;
  loadError: string | null;
}

export type AppPageSnapshotAction =
  | { type: "start"; page: PageId; generation: number }
  | { type: "resolve"; page: PageId; generation: number; snapshot: AppPageSnapshot }
  | { type: "reject"; page: PageId; generation: number; message: string };

export function createAppPageSnapshotState(page: PageId): AppPageSnapshotState {
  return { page, generation: 0, snapshot: null, loadError: null };
}

export function appPageSnapshotReducer(
  state: AppPageSnapshotState,
  action: AppPageSnapshotAction,
): AppPageSnapshotState {
  if (action.type === "start") {
    return {
      page: action.page,
      generation: action.generation,
      snapshot: state.page === action.page ? state.snapshot : null,
      loadError: null,
    };
  }
  if (state.page !== action.page || state.generation !== action.generation) return state;
  if (action.type === "resolve") {
    return { ...state, snapshot: action.snapshot, loadError: null };
  }
  return { ...state, snapshot: null, loadError: action.message };
}
