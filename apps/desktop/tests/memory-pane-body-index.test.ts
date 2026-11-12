// 第 1121 页：MemoryPane 详情正文只 split 一次，空态判断与逐行渲染共用 selectedBody。
import { describe, expect, it } from "vitest";
import { readAppSurface } from "./helpers/app-surface";

const src = readAppSurface();

describe("MemoryPane 正文行", () => {
  it("selectedBody 一次计算，不再重复 bodyLines(selected.body)", () => {
    expect(src).toContain("const selectedBody = selected === null ? [] : bodyLines(selected.body);");
    expect(src).toContain("{selectedBody.length === 0 && <div className=\"ap-empty\">此主题暂无正文</div>}");
    expect(src).toContain("{selectedBody.map((line, i) => (");
    expect(src).not.toContain("bodyLines(selected.body).length");
    expect(src).not.toContain("bodyLines(selected.body).map");
    expect(src).toContain("useMemo(() => memoryRows(memory, query, filter, sortByName), [memory, query, filter, sortByName])");
    expect(src).toContain("useMemo(() => sorted.find((row) => row.layer === selLayer && row.topic.topic === selTopic)");
  });
});
