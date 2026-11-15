import { describe, expect, it } from "vitest";
import {
  appPageSnapshotReducer,
  createAppPageSnapshotState,
} from "../src/renderer/state/app-page-snapshot";

describe("AppPageBody snapshot requests", () => {
  it("ignores a late response from the page that was replaced", () => {
    let state = createAppPageSnapshotState("plugins");

    state = appPageSnapshotReducer(state, { type: "start", page: "plugins", generation: 1, workspace: undefined });
    state = appPageSnapshotReducer(state, {
      type: "resolve",
      page: "plugins",
      generation: 1,
      snapshot: { plugins: undefined },
    });
    state = appPageSnapshotReducer(state, { type: "start", page: "memory", generation: 2, workspace: undefined });
    expect(state.snapshot).toBeNull();

    const afterStaleResult = appPageSnapshotReducer(state, {
      type: "resolve",
      page: "plugins",
      generation: 1,
      snapshot: { plugins: undefined },
    });
    expect(afterStaleResult).toBe(state);

    const afterCurrentResult = appPageSnapshotReducer(afterStaleResult, {
      type: "resolve",
      page: "memory",
      generation: 2,
      snapshot: { memory: undefined },
    });
    expect(afterCurrentResult).not.toBe(state);
    expect(afterCurrentResult.page).toBe("memory");
    expect(afterCurrentResult.snapshot).toEqual({ memory: undefined });
  });

  it("同一页手动刷新保留旧内容；换工作区立刻丢（旧行上的动作会写进新项目）", () => {
    let state = createAppPageSnapshotState("memory", "/a");
    state = appPageSnapshotReducer(state, { type: "start", page: "memory", generation: 1, workspace: "/a" });
    state = appPageSnapshotReducer(state, {
      type: "resolve",
      page: "memory",
      generation: 1,
      snapshot: { memory: undefined },
    });

    const refreshing = appPageSnapshotReducer(state, { type: "start", page: "memory", generation: 2, workspace: "/a" });
    expect(refreshing.snapshot).not.toBeNull();

    const switched = appPageSnapshotReducer(state, { type: "start", page: "memory", generation: 3, workspace: "/b" });
    expect(switched.snapshot).toBeNull();
    expect(switched.workspace).toBe("/b");
    expect(switched.loadError).toBeNull();
  });
});
