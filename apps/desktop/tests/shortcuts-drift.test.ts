// 速查表防漂判卷（批 102）：窗格族已由 pane-shortcuts.ts 单源；其余键保留 App switch / Composer
// 的上下文分支（Tab/Enter/Esc 天然属于组件），但**表与 dispatch 必须同场**——新增一行不接实现、
// 或删了实现忘改表，都会在这里红。它不是 keymap 重构，是给「两份手写表」上的防漂锁。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SHORTCUT_GROUPS } from "../src/renderer/shortcuts";
import { PANE_SHORTCUTS } from "../src/renderer/pane-shortcuts";
import { readAppSurface } from "./helpers/app-surface";

const src = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const app = readAppSurface();
const composer = src("../src/renderer/components/Composer.tsx");

/** keys → 证人（文件 + 必须同时出现的片段）。窗格族不在此表：由 PANE_SHORTCUTS 单源生成。 */
const WITNESSES: Record<string, { file: "app" | "composer"; needles: string[] }> = {
  "⌘N": { file: "app", needles: ['case "KeyN"', "h.newSession()"] },
  "⌘O": { file: "app", needles: ['case "KeyO"', "h.openFolder()"] },
  "⌘K": { file: "app", needles: ["h.openPalette()"] },
  "⌘F": { file: "app", needles: ["h.openFind()", "findRef.current?.focus()"] },
  "⌘G / ⇧⌘G": { file: "app", needles: ['case "KeyG"', "h.findStep(shift ? -1 : 1)"] },
  "⌘W": { file: "app", needles: ['case "KeyW"', "STR.shortcut.leftRunning"] },
  F2: { file: "app", needles: ['e.key === "F2"', "h.startRename()"] },
  "Ctrl+Tab / Ctrl+⇧+Tab": { file: "app", needles: ['e.key === "Tab" && e.ctrlKey', "h.cycleSessionOrToast(e.shiftKey ? -1 : 1)"] },
  "⌘⇧] / ⌘⇧[": { file: "app", needles: ['case "BracketRight"', 'case "BracketLeft"', "h.cycleSessionOrToast(1)", "h.cycleSessionOrToast(-1)"] },
  "⌘B": { file: "app", needles: ['case "KeyB"', "h.toggleSidebar()"] },
  "⌘⌥B": { file: "app", needles: ['case "KeyB"', "h.togglePluginSidebar()"] },
  "⌘⌥I": { file: "app", needles: ['case "KeyI"', "h.toggleInspector()"] },
  "⌘⌥M": { file: "app", needles: ['case "KeyM"', "h.togglePluginSidebar()"] },
  "⌘\\": { file: "app", needles: ['case "Backslash"', "h.closeLastPane()"] },
  "⌘⇧S": { file: "app", needles: ['case "KeyS"', "h.requestPickElement()"] },
  "Ctrl+O": { file: "app", needles: ['case "KeyO"', "h.cycleView()"] },
  "⌘⇧I": { file: "app", needles: ['case "KeyI"', 'h.openComposerMenu("model")'] },
  "⌘⇧M": { file: "app", needles: ['case "KeyM"', 'h.openComposerMenu("perm")'] },
  "⌘⇧E": { file: "app", needles: ['case "KeyE"', 'h.openComposerMenu("effort")'] },
  "⌘⌥F": { file: "app", needles: ['case "KeyF"', "h.toggleFocusMode()"] },
  "⌘,": { file: "app", needles: ['case "Comma"', "h.openSettings()"] },
  "⌘/": { file: "app", needles: ['case "Slash"', "h.toggleCheat"] },
  "⌘↑ / ⌘↓": { file: "app", needles: ['case "ArrowUp"', "h.jumpTop()", 'case "ArrowDown"', "h.jumpBottom()"] },
  Tab: { file: "composer", needles: ['e.key === "Tab" && !e.shiftKey', "props.onSuggestNext"] },
  Enter: { file: "composer", needles: ['e.key !== "Enter"', "submit("] },
  "⌘↩": { file: "composer", needles: ["e.metaKey || e.ctrlKey ? { interrupt: true }"] },
  "⌘.": { file: "app", needles: ['case "Period"', "h.cancelRun(h.activeId)"] },
  Esc: { file: "app", needles: ['e.key === "Escape"', "h.cancelRun(h.activeId)"] },
};

const rows = SHORTCUT_GROUPS.flatMap((g) => g.rows);
const paneKeys = new Set(PANE_SHORTCUTS.map((s) => s.keys));

describe("速查表防漂：每一行都有 dispatch 证人", () => {
  it("行表没有重复键", () => {
    expect(new Set(rows.map((r) => r.keys)).size).toBe(rows.length);
  });

  it("新增/残留的行必须在见证表里（窗格族由 pane-shortcuts 单源覆盖）", () => {
    const missing = rows.map((r) => r.keys).filter((k) => !paneKeys.has(k) && WITNESSES[k] === undefined);
    expect(missing).toEqual([]);
  });

  it("每个证人的片段同时在场（表里写了就必须接得上）", () => {
    const bad: string[] = [];
    for (const row of rows) {
      if (paneKeys.has(row.keys)) continue;
      const w = WITNESSES[row.keys];
      if (w === undefined) { bad.push(`${row.keys}（无见证）`); continue; }
      const text = w.file === "app" ? app : composer;
      for (const needle of w.needles) {
        if (!text.includes(needle)) bad.push(`${row.keys} 缺 ${w.file}:${needle}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
