// 窗格布局跨重启（2026-10-18）：只存 kind 列表；初始化过滤未知/重复；写效应必须在 useState
// 初始化器**之外**（第一版塞进 try 里，paneTabs 在 deps 中 TDZ、被 catch 吞掉 ⇒ key 永远读写不到）。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readAppSurface } from "./helpers/app-surface";

const app = readAppSurface();

describe("窗格布局持久化", () => {
  it("启动读 key，过滤未知 kind、去重", () => {
    expect(app).toContain('window.localStorage.getItem("cairn.panes.v1")');
    expect(app).toContain("const valid = new Set<string>(Object.keys(PANE_META));");
    expect(app).toContain("const seen = new Set<string>();");
  });

  it("无显式偏好时恢复窗格才展开；显式关闭优先于恢复内容", () => {
    expect(app).toContain("initialInspectorOpen({");
    expect(app).toContain("paneCount: paneTabs.length,");
    expect(app).toContain("setInspectorCollapsed(false);");
    expect(app).toContain("setInspectorCollapsed(true);");
    expect(app).toContain("显式关掉后带窗格重载必须保持关");
  });

  it("写效应在初始化器之外（不是 try 里的 useHook），依赖 paneTabs", () => {
    expect(app).toContain('window.localStorage.setItem("cairn.panes.v1", JSON.stringify(paneTabs));');
    // 初始化器收口后紧跟写效应
    expect(app).toMatch(/    \} catch \{\n      return \[\];\n    \}\n  \}\);\n  useEffect\(\(\) => \{\n    try \{ window\.localStorage\.setItem\("cairn\.panes\.v1"/);
    expect(app).not.toMatch(/const raw = window\.localStorage\.getItem\("cairn\.panes\.v1"\)[\s\S]{0,400}useEffect/);
  });
});
