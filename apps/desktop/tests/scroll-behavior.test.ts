// 减少动态下的 JS 滚动（2026-10-18）：CSS 的 scroll-behavior 管不到显式 smooth 的 scrollTo/scrollIntoView；
// 回底钮、⌘↑/⌘↓、目录跳转都得跟着降级，否则“减少动态”只关掉了一半。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { scrollBehavior } from "../src/renderer/useStickyScroll";

const app = readFileSync(fileURLToPath(new URL("../src/renderer/App.tsx", import.meta.url)), "utf8");
const hook = readFileSync(fileURLToPath(new URL("../src/renderer/useStickyScroll.ts", import.meta.url)), "utf8");

describe("scrollBehavior", () => {
  it("非 smooth 原样返回；无 matchMedia 环境原样返回", () => {
    expect(scrollBehavior("auto")).toBe("auto");
    expect(scrollBehavior("instant")).toBe("instant");
    const g = globalThis as unknown as { window?: unknown };
    const had = "window" in g;
    const prev = g.window;
    delete g.window;
    expect(scrollBehavior("smooth")).toBe("smooth");
    if (had) g.window = prev;
  });

  it("reduce 时 smooth 降级为 auto；未开启时不降级", () => {
    const g = globalThis as unknown as { window?: { matchMedia: (q: string) => { matches: boolean } } };
    const had = "window" in g;
    const prev = g.window;
    g.window = { matchMedia: () => ({ matches: true }) };
    expect(scrollBehavior("smooth")).toBe("auto");
    g.window = { matchMedia: () => ({ matches: false }) };
    expect(scrollBehavior("smooth")).toBe("smooth");
    if (had) g.window = prev; else delete g.window;
  });

  it("接线：三个滚动方法 + App 的两处 scrollIntoView 都走它", () => {
    expect(hook.match(/behavior: scrollBehavior\(behavior\)/g)?.length).toBe(3);
    expect(app.match(/scrollBehavior\("smooth"\)/g)?.length).toBe(2);
    const find = readFileSync(fileURLToPath(new URL("../src/renderer/components/FindBar.tsx", import.meta.url)), "utf8");
    expect(find).toContain('behavior: scrollBehavior("smooth")');
  });
});
