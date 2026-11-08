// 插件窗格（G1 首个可用落点，2026-10-21）：右列能直接看插件/技能/命令，
// 不再要求离开当前会话去「应用」页；真正的 mod 侧栏仍未做。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (...parts: string[]): string => readFileSync(join(__dirname, "..", "src", "renderer", "components", ...parts), "utf8");
// 窗格登记表（PaneKind / PANE_META / PANE_OPENABLE）已搬到渲染层顶层 pane-registry.ts
// （Phase 2 · 批 2.3：state/ 不许 import components/，而那份是数据不是组件）。
// components/panes.ts 照旧转出同一份导出面 ⇒ 判据改读真身所在的那份文件。
const readTop = (...parts: string[]): string => readFileSync(join(__dirname, "..", "src", "renderer", ...parts), "utf8");

describe("插件窗格", () => {
  it("PaneKind 与顶栏菜单都包含 plugins", () => {
    const panes = readTop("pane-registry.ts");
    expect(panes).toContain('"plugins"');
    expect(panes).toContain('plugins: { label: "插件" }');
    expect(panes).toMatch(/PANE_OPENABLE[^=]*=\s*\[[^\]]*"plugins"/s);
  });

  it("窗格复用 PluginSurface，从 getState 取插件快照，失败可重试", () => {
    const dock = read("PaneDock.tsx");
    const surface = read("PluginSurface.tsx");
    // 2026-10-25：单窗格改常驻挂载后，按 kind 渲染（只切可见性，不卸载内容）。
    expect(dock).toContain("{kind === \"plugins\" && <PluginSurface />}");
    expect(surface).toContain("window.agent.getState()");
    expect(surface).toContain("s.plugins === undefined");
    expect(surface).toContain("<PluginsPane snap={snap}");
    expect(surface).toContain("onError={setError}");
    expect(surface).toContain("{STR.pluginSurface.retry}");
    expect(surface).toContain("const id = ++seq.current");
    expect(surface).toContain("if (id !== seq.current) return");
  });

  it("窄窗格把插件详情抽屉改为单列", () => {
    const css = readFileSync(join(__dirname, "..", "src", "renderer", "styles.css"), "utf8");
    expect(css).toContain(".plugin-pane .ap-split.has-drawer");
    expect(css).toContain("grid-template-columns: minmax(0, 1fr);");
  });
});
