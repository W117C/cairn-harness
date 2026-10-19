// 相对时间活时钟（2026-10-18）：页面停留时「N 分钟前」要自己走。
// 判卷只钉接线形状（node 环境没有 DOM，真行为由真机等一分钟验证）：
//   · 五个显示相对时间的组件都从 useNow 取 now，不再直接 Date.now()；
//   · useNow 是共享订阅（一条 interval，不是每个标签一条）。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("相对时间活时钟", () => {
  it("显示面用 useNow 的 now，不再各自 Date.now()", () => {
    const files = [
      "../src/renderer/components/Sidebar.tsx",
      "../src/renderer/components/Stream.tsx",
      "../src/renderer/components/TimelinePane.tsx",
      "../src/renderer/components/AppPage.tsx",
      "../src/renderer/components/CommandPalette.tsx",
    ];
    for (const f of files) {
      const src = read(f);
      expect(src).toContain("useNow()");
      expect(src).toMatch(/relativeTime\([^)]*now[^)]*\)/); // 两种参数序都在：projections(now,ts) / memory-view(iso,now)
      expect(src).not.toContain("relativeTime(Date.now(),");
    }
  });

  it("共享一条 interval：订阅集合 + 最后一个退订时清理 + 回前台补一次", () => {
    const src = read("../src/renderer/useNow.ts");
    expect(src).toContain("const listeners = new Set<Listener>()");
    expect(src).toContain("if (timer === null) {");
    expect(src).toContain("if (listeners.size === 0 && timer !== null) {");
    expect(src).toContain('document.addEventListener("visibilitychange", onVisible)');
  });
});
