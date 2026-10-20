// 快捷键速查表数据判卷：分组非空、键位不重复、覆盖已实现的关键键（蓝本 §3.6「查看全部」）。
// P3-3 追加：SHORTCUTS 核心表（设置页展示 + tooltip 同源的单一事实源，brief 九节口径）。
import { describe, expect, it } from "vitest";
import { SHORTCUTS, SHORTCUT_GROUPS } from "../src/renderer/shortcuts";

describe("⌘/ 速查表（§3.6）", () => {
  it("分组与行都非空（不摆空组）", () => {
    expect(SHORTCUT_GROUPS.length).toBeGreaterThan(0);
    for (const g of SHORTCUT_GROUPS) {
      expect(g.title).not.toBe("");
      expect(g.rows.length).toBeGreaterThan(0);
    }
  });

  it("键位不重复（同一键不做两件事）", () => {
    const keys = SHORTCUT_GROUPS.flatMap((g) => g.rows.map((r) => r.keys));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("速查表自指条目在（⌘/ 自己也要能被查到）", () => {
    const all = SHORTCUT_GROUPS.flatMap((g) => g.rows);
    expect(all.some((r) => r.keys === "⌘/")).toBe(true);
    expect(all.some((r) => r.keys === "⌘W")).toBe(true);
    expect(all.some((r) => r.keys === "Ctrl+O")).toBe(true);
  });

  it("P3-3：新接通的键都已上表（⌘O/⌘K/⌘⌥B/⌘./⌘,——只列已实现的键，接了就得在）", () => {
    const all = SHORTCUT_GROUPS.flatMap((g) => g.rows);
    for (const k of ["⌘O", "⌘K", "⌘⌥B", "⌘.", "⌘,"]) {
      expect(all.some((r) => r.keys === k)).toBe(true);
    }
  });
});

describe("SHORTCUTS 核心表（P3-3 单一事实源 · brief 九节）", () => {
  it("12 项齐：⌘N / ⌘O / ⌘K / ⌘B / ⌘F / ⌘⌥B / ⌘. / ⌘⇧[ ⌘⇧] / ⌘, / ⏎ / ⇧⏎ / ⌘/", () => {
    // 2026-10-18：⌘F 对话内查找进核心表（对照 Claude Edit > Find…；第 513 页）。
    // 2026-10-20：⌘B 开合侧栏进核心表——命令面板的「开合侧栏」曾错指 palette id，
    // 把 ⌘K 当成它的键显示；键位提示必须从本表取，表里没有的 id 不得被引用。
    expect(SHORTCUTS.length).toBe(12);
    const keys = SHORTCUTS.map((s) => s.keys);
    for (const k of ["⌘N", "⌘O", "⌘K", "⌘B", "⌘F", "⌘⌥B", "⌘.", "⌘⇧[ / ⌘⇧]", "⌘,", "⏎", "⇧⏎", "⌘/"]) {
      expect(keys).toContain(k);
    }
  });

  it("keys / id 都唯一；每行 keys 与 label 非空", () => {
    const keys = SHORTCUTS.map((s) => s.keys);
    expect(new Set(keys).size).toBe(keys.length);
    const ids = SHORTCUTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of SHORTCUTS) {
      expect(s.keys).not.toBe("");
      expect(s.label).not.toBe("");
    }
  });
});
