// 第 1102 页：模型菜单组内每行不再 flat.indexOf(m) 扫全表（O(n²)），一次 Map 建索引。
import { describe, expect, it } from "vitest";
import { readAppSurface } from "./helpers/app-surface";

const src = readAppSurface();

describe("ModelPicker 模型索引", () => {
  it("flatIndex Map 一次建好，组内行 O(1) 查", () => {
    expect(src).toContain("const flatIndex = useMemo(");
    expect(src).toContain("const indexOfModel = (m: ModelOption): number => flatIndex.get(m) ?? 0;");
    expect(src).not.toContain("flat.indexOf(m)");
    expect(src).toContain("useMemo(() => flattenModels(props.infos), [props.infos])");
    expect(src).toContain("useMemo(() => providerLabelMap(props.infos), [props.infos])");
    expect(src).toContain("useMemo(() => groupModels(filtered), [filtered])");
    expect(src).toContain("const modelInfos = useMemo(() => props.providerInfo ? [props.providerInfo] : [], [props.providerInfo]);");
    expect(src).toContain("infos={modelInfos}");
    expect(src).toContain("const THINKING_BY_ID = new Map<string, (typeof THINKING_LEVELS)[number]>(THINKING_LEVELS.map((level) => [level.id, level] as const));");
    expect(src).toContain("useMemo(() => new Map(flat.map((m, i) => [m, i] as const)), [flat])");
  });
});
