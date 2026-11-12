// 第 1107 页：工作树 dirty 状态一次 Map 建索引，不再逐行/确认框重复 find details。
import { describe, expect, it } from "vitest";
import { readAppSurface } from "./helpers/app-surface";

const src = readAppSurface();

describe("WorktreesPane dirty 索引", () => {
  it("dirtyByName 一次建好，行与确认框都查表", () => {
    expect(src).toContain("const dirtyByName = useMemo(() => new Map((props.snap.details ?? []).map((d) => [d.name, d.dirty] as const)), [props.snap.details]);");
    expect(src).toContain("const dirty = dirtyByName.get(name) === true;");
    expect(src).toContain("note={dirtyByName.get(ask) === true");
    expect(src).not.toContain("props.snap.details?.find((d) => d.name === name)");
    expect(src).not.toContain("props.snap.details?.find((d) => d.name === ask)");
  });
});
