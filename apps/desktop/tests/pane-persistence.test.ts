// 窗格布局跨重启（2026-10-18）：只存 kind 列表；初始化过滤未知/重复；写效应必须在 useState
// 初始化器**之外**（第一版塞进 try 里，paneTabs 在 deps 中 TDZ、被 catch 吞掉 ⇒ key 永远读写不到）。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const app = readFileSync(fileURLToPath(new URL("../src/renderer/App.tsx", import.meta.url)), "utf8");

describe("窗格布局持久化", () => {
  it("启动读 key，过滤未知 kind、去重", () => {
    expect(app).toContain('window.localStorage.getItem("cairn.panes.v1")');
    expect(app).toContain("const valid = new Set<string>(Object.keys(PANE_META));");
    expect(app).toContain("const seen = new Set<string>();");
  });

  it("恢复窗格时检查器保持展开；无窗格才初始收起", () => {
    expect(app).toContain("if (paneTabs.length > 0 || inspectorDefaultOpen) return;");
    expect(app).toContain("恢复了窗格（cairn.panes.v1）时保持展开");
  });

  it("写效应在初始化器之外（不是 try 里的 useHook），依赖 paneTabs", () => {
    expect(app).toContain('window.localStorage.setItem("cairn.panes.v1", JSON.stringify(paneTabs));');
    // 初始化器收口后紧跟写效应
    expect(app).toMatch(/    \} catch \{\n      return \[\];\n    \}\n  \}\);\n  useEffect\(\(\) => \{\n    try \{ window\.localStorage\.setItem\("cairn\.panes\.v1"/);
    expect(app).not.toMatch(/const raw = window\.localStorage\.getItem\("cairn\.panes\.v1"\)[\s\S]{0,400}useEffect/);
  });
});
