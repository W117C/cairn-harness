// 检查器宽度跨重启（2026-10-18）：320–420 内才记（0=收起不记）；拖动防抖 300ms；启动读回并夹紧。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const app = readFileSync(fileURLToPath(new URL("../src/renderer/App.tsx", import.meta.url)), "utf8");

describe("检查器宽度持久化", () => {
  it("启动读 key，320–420 外回 360", () => {
    expect(app).toContain('window.localStorage.getItem("cairn.inspector.width")');
    expect(app).toContain("return Number.isFinite(n) && n >= 320 && n <= 420 ? Math.round(n) : 360;");
    expect(app).toContain("defaultSize={inspectorDefault}");
  });

  it("开合状态：用户显式 ⌘⌥B 时记 1/0；有恢复窗格或上次是开则启动不收起", () => {
    expect(app).toContain('window.localStorage.getItem("cairn.inspector.open.v1") === "1"');
    expect(app).toContain("if (paneTabs.length > 0 || inspectorDefaultOpen) {");
    expect(app).toContain("setInspectorCollapsed(false);");
    expect(app).toContain("setInspectorCollapsed(true);");
    expect(app).toContain('window.localStorage.setItem("cairn.inspector.open.v1", "1");');
    expect(app).toContain('window.localStorage.setItem("cairn.inspector.open.v1", "0");');
  });

  it("resize 后防抖写回；收起（<320）不写", () => {
    expect(app).toContain('if (px < 320 || px > 420) return;');
    expect(app).toContain("inspectorSaveTimer.current = window.setTimeout(() => {");
    expect(app).toContain('window.localStorage.setItem("cairn.inspector.width", String(px));');
    expect(app).toContain("}, 300);");
  });
});
