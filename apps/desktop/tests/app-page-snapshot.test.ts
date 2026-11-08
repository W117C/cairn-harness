import { describe, expect, it } from "vitest";
import {
  appPageSnapshotReducer,
  createAppPageSnapshotState,
} from "../src/renderer/state/app-page-snapshot";

describe("AppPageBody snapshot requests", () => {
  it("ignores a late response from the page that was replaced", () => {
    let state = createAppPageSnapshotState("plugins");

    state = appPageSnapshotReducer(state, { type: "start", page: "plugins", generation: 1 });
    state = appPageSnapshotReducer(state, {
      type: "resolve",
      page: "plugins",
      generation: 1,
      snapshot: { plugins: undefined },
    });
    state = appPageSnapshotReducer(state, { type: "start", page: "memory", generation: 2 });
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
});
