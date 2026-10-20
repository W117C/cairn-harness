// 对话内查找（⌘F，2026-10-18 对照 Claude 桌面端 Edit > Find…）：
//   · 面板关闭不渲染；打开 = 输入框 + 空计数 + 三个按钮（无匹配时翻页禁用）；
//   · App 接线：⌘F 只在有会话时开，Esc 先关查找（早于「Esc 停跑」），切会话/回主页收起；
//   · 快捷键表：⌘F 进速查与会话组（不摆没接的键）。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FindBar } from "../src/renderer/components/FindBar";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("FindBar 面板", () => {
  it("关闭时不渲染任何东西", () => {
    const html = renderToStaticMarkup(<FindBar open={false} container={null} onClose={() => undefined} />);
    expect(html).toBe("");
  });

  it("打开：输入框 + 三枚按钮；无查询时计数为空、翻页禁用", () => {
    const html = renderToStaticMarkup(<FindBar open container={null} onClose={() => undefined} />);
    expect(html).toContain('placeholder="在对话中查找"');
    expect(html).toContain('aria-label="上一个匹配"');
    expect(html).toContain('aria-label="下一个匹配"');
    expect(html).toContain('aria-label="关闭查找"');
    expect((html.match(/disabled=""/g) ?? []).length).toBe(2); // 上一个/下一个；关闭恒可用
    expect(html).not.toContain("find-count\">1/");
  });

  it("App 接线：⌘F 有会话才开；Esc 先关查找；切会话收起", () => {
    const app = read("../src/renderer/App.tsx");
    expect(app).toContain('case "KeyF"');
    expect(app).toContain("h.openFind()");
    // 命令面板同一入口（2026-10-18）：不另起炉灶，复用 findRef
    expect(app).toContain('case "find-in-session"');
    expect(app).toContain("findRef.current?.focus();");
    // ⌘G 在查找条关闭时先打开它（2026-10-18）：旧实现此时静默无响应。
    // 2026-10-20：开合/开条口径收进 findStep（菜单「查找下一个/上一个」共用同一出口）。
    expect(app).toContain('case "KeyG"');
    expect(app).toContain("if (h.findStep(shift ? -1 : 1)) e.preventDefault();");
    expect(app).toContain("const findStep = useCallback((dir: 1 | -1): boolean => {");
    // 2026-10-20：两个方向都先开条（旧形状对 dir === -1 静默无响应 ⇒ ⌘⇧G 读成"键坏了"）
    expect(app).toContain("if (activeIdRef.current === null) return false;");
    expect(app).not.toContain("if (dir === -1 || activeIdRef.current === null) return false;");
    expect(app).toContain("if (h.findOpen) { e.preventDefault(); h.closeFind(); return; }");
    expect(app).toContain("<FindBar ref={findRef} open={findOpen && !showEmpty}");
    expect(app).toContain('case "KeyG"');
    expect(app).toContain("findRef.current?.step(dir)");
    expect(read("../src/renderer/components/FindBar.tsx")).toContain("useImperativeHandle(ref");
    expect(app).toContain("useEffect(() => { setFindOpen(false); }, [activeId, showEmpty]);");
    const css = read("../src/renderer/styles.css");
    expect(css).toMatch(/\.find-bar\s*{/);
    expect(css).toMatch(/@keyframes find-hit/);
  });

  it("快捷键表：⌘F 进速查与会话组", () => {
    const src = read("../src/renderer/shortcuts.ts");
    expect(src).toContain('{ id: "find", keys: "⌘F", label: "对话内查找" }');
    expect(src).toContain("在对话里查找");
    expect(src).toContain('{ keys: "⌘G / ⇧⌘G", what: "查找下一个 / 上一个" }');
  });
});
