// 专注模式判卷（批 101）：⌘⌥F / 顶栏按钮进入时收起侧栏与检查器，退出回到进入前的开合。
// 口径：专注中改开侧栏/检查器/窗格 = 放弃专注（不还原旧布局），状态与画面不打架。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SHORTCUT_GROUPS } from "../src/renderer/shortcuts";

const app = readFileSync(fileURLToPath(new URL("../src/renderer/App.tsx", import.meta.url)), "utf8");
const rows = SHORTCUT_GROUPS.flatMap((g) => g.rows);

describe("专注模式", () => {
  it("速查表有一行；键位是 ⌘⌥F（不与 ⌘F 查找 / ⌘⇧F 文件窗格相撞）", () => {
    const row = rows.find((r) => r.keys === "⌘⌥F");
    expect(row?.what).toContain("专注");
    expect(rows.filter((r) => r.keys === "⌘⌥F")).toHaveLength(1);
  });

  it("进入时记下侧栏与检查器（含宽度），退出按原样放回", () => {
    expect(app).toContain("const focusRestoreRef = useRef<{ sidebar: boolean; inspector: boolean; inspectorWidth: number | null } | null>(null);");
    expect(app).toMatch(/focusRestoreRef\.current = \{\n\s+sidebar: sidebarCollapsed,\n\s+inspector: !inspectorOpen,\n\s+inspectorWidth: inspectorOpen \? Math\.round\(inspector\.getSize\(\)\.inPixels\) : null,/);
    expect(app).toContain("setSidebarCollapsed(prev?.sidebar ?? false);");
    expect(app).toContain('const restoreDelay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 240;');
    expect(app).toContain("window.setTimeout(() => { ref?.resize(width); }, restoreDelay);");
  });

  it("⌘⌥F 走 toggleFocusMode；顶栏按钮带 aria-pressed 与可读标签", () => {
    expect(app).toMatch(/case "KeyF":[\s\S]{0,160}if \(e\.altKey && !shift\) \{ e\.preventDefault\(\); h\.toggleFocusMode\(\); \}/);
    expect(app).toContain('aria-label={focusMode ? "退出专注模式" : "进入专注模式"}');
    expect(app).toContain("aria-pressed={focusMode}");
    expect(app).toContain("onClick={toggleFocusMode}");
  });

  it("专注中开侧栏/检查器/窗格 = 放弃专注（exitFocusRef 三处接线）", () => {
    expect(app).toMatch(/const toggleSidebar = useCallback\(\(\): void => \{\n\s+exitFocusRef\.current\(\);/);
    expect(app).toMatch(/const revealInspector = useCallback\(\(\): void => \{\n\s+\/\/ 专注模式里打开窗格[\s\S]{0,80}exitFocusRef\.current\(\);/);
    expect(app).toMatch(/const toggleInspector = useCallback\(\(\): void => \{\n\s+exitFocusRef\.current\(\);/);
    // 放弃专注时不还原旧布局（清掉快照即可）
    expect(app).toMatch(/exitFocusRef\.current = \(\) => \{[\s\S]{0,200}focusRestoreRef\.current = null;/);
  });
});
