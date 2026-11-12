// 第 1105 页：插件目录 shelf 的 entryIds 不再逐 id 扫 props.rows；一次 Map 建索引。
// 2026-11-13：PluginDiscover 的两个 useMemo 曾排在三个早退 return 之后——真实 app 里
// loading→ready 翻转 ⇒ hooks 数量变化 ⇒ React #310 崩掉整屏（design-audit 23-plugins 起
// 15 miss/13 dup、错误边界接住）。判据钉源序：hooks 必须先于任何条件早退。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readAppSurface } from "./helpers/app-surface";

const src = readAppSurface();
const discover = readFileSync(fileURLToPath(new URL("../src/renderer/components/plugins/PluginDiscover.tsx", import.meta.url)), "utf8");

describe("PluginDiscover 行索引", () => {
  it("rowById 一次建好，shelf 渲染 O(entries)", () => {
    expect(src).toContain("const rowById = useMemo(() => new Map(props.rows.map((row) => [row.id, row] as const)), [props.rows]);");
    expect(src).toContain(".map((id) => rowById.get(id))");
    expect(src).not.toContain(".map((id) => props.rows.find((row) => row.id === id))");
  });

  it("hooks 先于条件早退（React #310 防回归钉）", () => {
    const useStateAt = discover.indexOf("const [uninstall, setUninstall] = useState");
    const rowByIdAt = discover.indexOf("const rowById = useMemo");
    const loadingAt = discover.indexOf('if (props.state.catalogStatus === "loading"');
    const errorAt = discover.indexOf('if (props.state.catalogStatus === "error"');
    const unavailableAt = discover.indexOf('if (catalog.status !== "ready"');
    expect(useStateAt).toBeGreaterThan(-1);
    expect(rowByIdAt).toBeGreaterThan(useStateAt);
    // 三个早退必须都排在两个 useMemo 之后：任何一次挪回早退前面，这条当场红。
    expect(loadingAt).toBeGreaterThan(rowByIdAt);
    expect(errorAt).toBeGreaterThan(rowByIdAt);
    expect(unavailableAt).toBeGreaterThan(rowByIdAt);
  });
});

