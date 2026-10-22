// 窗格快捷键判卷（批 99/100）：七个窗格键位收进 pane-shortcuts.ts 单一事实源。
// 口径：App dispatch 与速查表都从这张表来（表里写了就必须接得上，不会一边改一边忘）；
// 修饰键精确匹配（多按不吞普通键）；⌘F 查找 / ⌘B 侧栏 / ⌘⌥B 检查器仍是各自语义。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PANE_SHORTCUTS, paneShortcutFor, paneShortcutKeys, type PaneKeyMods } from "../src/renderer/pane-shortcuts";
import { PANE_OPENABLE } from "../src/renderer/components/panes";
import { SHORTCUT_GROUPS } from "../src/renderer/shortcuts";
import { readAppSurface } from "./helpers/app-surface";

const app = readAppSurface();
const mods = (p: Partial<PaneKeyMods>): PaneKeyMods => ({ meta: false, ctrl: false, shift: false, alt: false, ...p });
const rows = SHORTCUT_GROUPS.find((g) => g.title === "窗格")?.rows ?? [];

it("窗格 tooltip 的键位只从 PANE_SHORTCUTS 取（不再手抄）", () => {
  expect(paneShortcutKeys("terminal")).toBe("Ctrl+`");
  expect(paneShortcutKeys("changes")).toBe("⌘⇧D");
  expect(paneShortcutKeys("browser")).toBe("⌘⇧B");
  expect(app).not.toContain('title="终端窗格（Ctrl+`）"');
  expect(app).not.toContain('title="变更窗格（⌘⇧D）"');
  expect(app).not.toContain('title="浏览器窗格（⌘⇧B）"');
  expect(app).toContain('paneShortcutKeys("terminal")');
  expect(app).toContain('<span className="sub">{paneShortcutKeys(k)}</span>');
});

describe("PANE_SHORTCUTS：八窗格一表全覆盖", () => {
  it("每个可开窗格恰有一条键位；code + 修饰组合不重复", () => {
    expect([...PANE_SHORTCUTS.map((s) => s.kind)].sort()).toEqual([...PANE_OPENABLE].sort());
    const combos = PANE_SHORTCUTS.map((s) => `${s.code}|${s.mod}|${String(s.shift)}|${String(s.alt)}`);
    expect(new Set(combos).size).toBe(combos.length);
  });

  it("速查表「窗格」组由同一张表生成（另有 ⌘\\ 关闭 与 ⌘⇧S 元素选择两行）", () => {
    const expected = [
      { keys: "⌘\\", what: "关闭最近打开的窗格" },
      ...PANE_SHORTCUTS.map((s) => ({ keys: s.keys, what: s.what })),
      { keys: "⌘⇧S", what: "浏览器：选择页面元素（结果进输入框）" },
    ];
    expect(rows).toEqual(expected);
  });
});

describe("paneShortcutFor：物理键 + 修饰键精确匹配", () => {
  it("⌘⇧D / ⌘⇧P / ⌘⇧T / ⌘⇧F / ⌘⇧B 各落各的窗格（Ctrl 等价也认）", () => {
    expect(paneShortcutFor("KeyD", mods({ meta: true, shift: true }))).toBe("changes");
    expect(paneShortcutFor("KeyD", mods({ ctrl: true, shift: true }))).toBe("changes");
    expect(paneShortcutFor("KeyP", mods({ meta: true, shift: true }))).toBe("plan");
    expect(paneShortcutFor("KeyT", mods({ meta: true, shift: true }))).toBe("tasks");
    expect(paneShortcutFor("KeyF", mods({ meta: true, shift: true }))).toBe("file");
    expect(paneShortcutFor("KeyB", mods({ meta: true, shift: true }))).toBe("browser");
  });

  it("终端只认 Ctrl+`；⌘; 开旁路", () => {
    expect(paneShortcutFor("Backquote", mods({ ctrl: true }))).toBe("terminal");
    expect(paneShortcutFor("Backquote", mods({ meta: true, ctrl: true }))).toBeNull();
    expect(paneShortcutFor("Backquote", mods({ meta: true }))).toBeNull();
    expect(paneShortcutFor("Semicolon", mods({ meta: true }))).toBe("sidechat");
    expect(paneShortcutFor("KeyU", mods({ meta: true, shift: true }))).toBe("plugins");
  });

  it("修饰键多按/少按都不匹配（⌘F 查找、⌘B 侧栏、⌘⌥B 插件侧栏、⌘⌥I 检查器不被抢）", () => {
    expect(paneShortcutFor("KeyF", mods({ meta: true }))).toBeNull();
    expect(paneShortcutFor("KeyB", mods({ meta: true }))).toBeNull();
    expect(paneShortcutFor("KeyB", mods({ meta: true, alt: true }))).toBeNull();
    expect(paneShortcutFor("KeyD", mods({ meta: true, shift: true, alt: true }))).toBeNull();
    expect(paneShortcutFor("KeyS", mods({ meta: true, shift: true }))).toBeNull();
  });
});

describe("App 接线：窗格键不再各写一条 case", () => {
  it("dispatch 走 paneShortcutFor；窗格族五条 case 已移除", () => {
    expect(app).toContain("const paneKind = paneShortcutFor(e.code, { meta: e.metaKey, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey });");
    expect(app).toContain("h.togglePane(paneKind)");
    for (const code of ["KeyD", "KeyP", "KeyT", "Backquote", "Semicolon"]) {
      expect(app, code).not.toContain(`case "${code}":`);
    }
  });

  it("⌘F 查找、⌘B 侧栏、⌘⌥B 插件侧栏、⌘⌥I 检查器的分流仍在", () => {
    expect(app).toMatch(/case "KeyF":[\s\S]{0,400}h\.openFind\(\); findRef\.current\?\.focus\(\)/);
    expect(app).toMatch(/case "KeyB":[\s\S]{0,200}h\.togglePluginSidebar\(\)[\s\S]{0,200}h\.toggleSidebar\(\)/);
    expect(app).toMatch(/case "KeyI":[\s\S]{0,200}h\.toggleInspector\(\)/);
  });
});
