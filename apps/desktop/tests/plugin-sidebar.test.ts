// mod 侧栏（G1 覆盖式首版，2026-10-21）：⌘⌥M 开合，最小 280px，复用 PluginSurface。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readAppSurface } from "./helpers/app-surface";

const read = (...parts: string[]): string => readFileSync(join(__dirname, "..", "src", "renderer", ...parts), "utf8");

describe("mod 侧栏", () => {
  it("App 接线：状态持久化 + ⌘⌥M + 条件渲染", () => {
    const app = readAppSurface();
    expect(app).toContain('localStorage.getItem("cairn.pluginSidebar")');
    expect(app).toContain("h.togglePluginSidebar()");
    expect(app).toContain("{pluginSidebarOpen && <PluginSidebar width={pluginSidebarWidth} onWidth={setPluginSidebarWidthPersist} onClose={closePluginSidebar} onInvoke={fillPluginCommand} />}");
    expect(app).toContain('aria-label="插件侧栏"');
    expect(app).toContain('aria-controls="mod-sidebar"');
    expect(app).toContain('aria-expanded={pluginSidebarOpen}');
  });

  it("侧栏组件复用 PluginSurface，并有关闭按钮", () => {
    const sidebar = read("components", "PluginSidebar.tsx");
    expect(sidebar).toContain("<PluginSurface");
    expect(sidebar).toContain("STR.pluginSidebar.close");
    expect(sidebar).toContain("aria-label={STR.pluginSidebar.aria}");
    expect(sidebar).toContain("closeRef.current?.focus()");
  });

  it("Esc 优先关闭侧栏，且关闭时写回 localStorage", () => {
    const app = readAppSurface();
    expect(app).toContain("if (h.pluginSidebarOpen) { e.preventDefault(); h.closePluginSidebar(); return; }");
    expect(app).toContain('localStorage.setItem("cairn.pluginSidebar", "0")');
    expect(app).toContain('active.closest(".mod-sidebar")');
    expect(app).toContain("document.querySelector<HTMLElement>('[aria-label=\"插件侧栏\"]')?.focus()");
  });

  it("命令行可「填入」到 Composer，不直接发送", () => {
    const app = readAppSurface();
    const page = read("components", "AppPage.tsx");
    expect(app).toContain("const fillPluginCommand");
    expect(app).toContain("setInjectedText(`/${invoke.replace");
    expect(page).toContain("STR.pluginSurface.fill");
  });

  it("宽度可拖/可键盘调，280–420 持久化", () => {
    const app = readAppSurface();
    const sidebar = read("components", "PluginSidebar.tsx");
    expect(app).toContain('localStorage.getItem("cairn.pluginSidebarWidth")');
    expect(app).toContain('localStorage.setItem("cairn.pluginSidebarWidth"');
    expect(sidebar).toContain('role="separator"');
    expect(sidebar).toContain('aria-valuemin={280}');
    expect(sidebar).toContain('aria-valuemax={420}');
    expect(sidebar).toContain('e.key === "ArrowLeft" ? 10 : -10');
    expect(sidebar).toContain("onDoubleClick={() => { props.onWidth(340); }}");
  });

  it("窄窗覆盖层点外部收起，宽窗不抢点击", () => {
    const sidebar = read("components", "PluginSidebar.tsx");
    expect(sidebar).toContain('document.addEventListener("pointerdown", onDown, true)');
    expect(sidebar).toContain("if (window.innerWidth > 1120) return;");
    expect(sidebar).toContain("props.onClose();");
  });

  it("CSS 是挤窄主栏的布局列，最小 280px", () => {
    const css = read("styles.css");
    const block = css.slice(css.indexOf(".mod-sidebar {"), css.indexOf("}", css.indexOf(".mod-sidebar {")));
    expect(block).toContain("position: relative");
    expect(block).toContain("height: 100%");
    expect(block).toContain("min-width: 280px");
    expect(css).toContain(".shell { display: grid; grid-template-columns: auto minmax(0, 1fr) auto;");
    expect(css).toContain("@media (max-width: 1120px)");
    expect(css).toContain("position: fixed; top: 38px; right: 0; bottom: 0; z-index: 70;");
  });
});
