import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { MemorySnapshot } from "../../../src/main/ipc-protocol";
import { memoryRows } from "../src/renderer/memory-view";
import { MemoryPane } from "../src/renderer/components/AppPage";

const topic = (name: string, modified: string, body = "") => ({ topic: name, type: "project", modified, body, bytes: 64 });
const snap: MemorySnapshot = {
  project: { path: "/project", index: null, pendingExternalRefs: [], topics: [
    topic("older", "2026-10-01T00:00:00Z"),
    topic("invalid", "unknown"),
    topic("newer:with:colon", "2026-11-02T00:00:00Z", "Prefer pnpm and preserve drafts."),
  ] },
  global: { path: "/global", index: null, pendingExternalRefs: [], topics: [topic("global", "2026-11-03T00:00:00Z")] },
};

describe("memory list behavior", () => {
  it("recent ordering is real and keeps each scope in one group", () => {
    const html = renderToStaticMarkup(<MemoryPane snap={snap} onError={() => {}} refresh={() => {}} />);
    expect(html.indexOf(">newer:with:colon<")).toBeLessThan(html.indexOf(">older<"));
    expect(html.indexOf(">older<")).toBeLessThan(html.indexOf(">invalid<"));
    expect(html.indexOf(">invalid<")).toBeLessThan(html.indexOf(">global<"));
  });

  it("search finds body content and filters by scope", () => {
    expect(memoryRows(snap, " PNPM ", "all", false).map((r) => r.topic.topic)).toEqual(["newer:with:colon"]);
    expect(memoryRows(snap, "pnpm", "global", false)).toEqual([]);
    expect(memoryRows(snap, "", "global", false).map((r) => r.topic.topic)).toEqual(["global"]);
  });

  it("name ordering preserves scope groups without mutating the snapshot", () => {
    expect(memoryRows(snap, "", "all", true).map((r) => r.topic.topic)).toEqual(["invalid", "newer:with:colon", "older", "global"]);
    expect(snap.project.topics.map((t) => t.topic)).toEqual(["older", "invalid", "newer:with:colon"]);
  });
});
