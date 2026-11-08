// R3 置顶会话拖排判卷（2026-10-31）：参考库 DraggableSessionList 的 4px 死区 / 落点线 / 乐观重排。
// 纯排序函数在 pinned-order.test.ts；这里钉接线、持久化与视觉契约。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("Sidebar：置顶段拖排接线", () => {
  const sidebar = read("../src/renderer/components/Sidebar.tsx");
  const hook = read("../src/renderer/state/use-pinned-order.ts");
  const css = read("../src/renderer/styles.css");

  it("Sidebar 用 hook 排序并下发 dragAttrs / dragProps / onReorder", () => {
    expect(sidebar).toContain('from "../state/use-pinned-order"');
    expect(sidebar).toContain("const pinnedOrder = usePinnedOrder();");
    expect(sidebar).toContain("pinnedOrder.ordered(list)");
    expect(sidebar).toContain('dragAttrs={!searchOpen && filter === "all" ? pinnedOrder.rowAttrs(s) : {}}');
    expect(sidebar).toContain('dragProps={!searchOpen && filter === "all" ? pinnedOrder.dragProps(s) : undefined}');
    expect(sidebar).toContain('onReorder={!searchOpen && filter === "all" ? (delta) => { pinnedOrder.moveByKeyboard(s, delta); } : undefined}');
  });

  it("SessionRow：置顶行可 Alt+↑/↓ 排序；drag 属性/处理器落在行根上", () => {
    expect(sidebar).toContain("if (s.pinned === true && e.altKey && (e.key === \"ArrowUp\" || e.key === \"ArrowDown\"))");
    expect(sidebar).toContain("{...props.dragAttrs}");
    expect(sidebar).toContain("{...props.dragProps}");
  });

  it("hook：4px 死区 + pointer capture + 同工作区落点 + 拖后吞 click", () => {
    expect(hook).toContain("const DRAG_DEAD_ZONE = 4;");
    expect(hook).toContain("setPointerCapture(e.pointerId)");
    expect(hook).toContain('closest<HTMLElement>("[data-session-key][data-pinned=\'true\']")');
    expect(hook).toContain('key.split("\\u0000")[0] !== drag.workspace');
    expect(hook).toContain('window.addEventListener("click", swallow, { capture: true, once: true })');
    expect(hook).toContain("window.localStorage.setItem(PINNED_ORDER_KEY");
    // 提交基表取 DOM 全部置顶键（只拿 drag+target 会漏项，真机 甲丙乙 回归）。
    expect(hook).toContain("const base = [...new Set([...orderRef.current, ...visual])];");
    expect(hook).toContain("new Set([...orderRef.current, ...keys])");
    expect(hook).toContain("moveInOrder([...new Set([...orderRef.current, ...keys])], key, target");
    expect(hook).toContain("if (typeof window === \"undefined\") return [];");
  });

  it("样式：grab / 拖起半透明 / 前后 2px 落点线", () => {
    expect(css).toMatch(/\.session\[data-pinned="true"\]\s*\{[^}]*cursor:\s*grab/s);
    expect(css).toMatch(/\.session\[data-dragging="true"\]\s*\{[^}]*opacity:\s*\.45/s);
    expect(css).toMatch(/\.session\[data-drop="before"\]\s*\{[^}]*inset 0 2px 0 hsl\(var\(--accent-brand\)\)/s);
    expect(css).toMatch(/\.session\[data-drop="after"\]\s*\{[^}]*inset 0 -2px 0 hsl\(var\(--accent-brand\)\)/s);
  });
});
