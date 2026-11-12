// 对话内查找（⌘F，2026-10-18 对照 Claude 桌面端 Edit > Find…）：
//   · 面板关闭不渲染；打开 = 输入框 + 空计数 + 三个按钮（无匹配时翻页禁用）；
//   · App 接线：⌘F 只在有会话时开，Esc 先关查找（早于「Esc 停跑」），切会话/回主页收起；
//   · 快捷键表：⌘F 进速查与会话组（不摆没接的键）。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FindBar, foldedHitSeqs } from "../src/renderer/components/FindBar";
import type { StreamRow } from "../src/renderer/derived/stream";
import { readAppSurface } from "./helpers/app-surface";
import { STR } from "../src/renderer/strings";

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
    const app = readAppSurface();
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
    // 第 926 页：FindBar 多了模型行/折叠集/展开动作三个 props，JSX 从单行变成多行——
    // 这条钉的是「面板挂在这儿、开合绑 findOpen && !showEmpty」，不是行长。
    expect(app).toContain("<FindBar");
    expect(app).toContain("open={findOpen && !showEmpty}");
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
    // 收编后（第 1065 页）：⌘F 核心 label 与会话组两条描述走 STR——源里钉接线，值在 STR 锚定。
    expect(src).toContain('{ id: "find", keys: "⌘F", label: STR.shortcut.find }');
    expect(src).toContain('{ keys: "⌘F", what: STR.shortcutTable.find }');
    expect(src).toContain('{ keys: "⌘G / ⇧⌘G", what: STR.shortcutTable.findNext }');
    expect(STR.shortcut.find).toBe("对话内查找");
    expect(STR.shortcutTable.find).toContain("在对话里查找");
    expect(STR.shortcutTable.findNext).toBe("查找下一个 / 上一个");
  });
});

describe("折叠轮次里的命中（第 926 页）", () => {
  const rows = [
    { kind: "user", text: "旧问题：登录重试", seq: 0, round: 1 },
    { kind: "assistant", text: "旧回答：用指数退避", seq: 1, round: 1, eventId: 2 },
    { kind: "tool", tool: "read_file", summary: "a.ts", seq: 2 },
    { kind: "user", text: "新问题：设置页", seq: 3, round: 2 },
  ] as unknown as StreamRow[];

  it("只把已折叠轮次里的 user/assistant 正文算进来（工具行不参与）", () => {
    const folded = new Set([1]);
    expect(foldedHitSeqs(rows, folded, "登录")).toEqual([0]);
    expect(foldedHitSeqs(rows, folded, "指数退避")).toEqual([1]);
    expect(foldedHitSeqs(rows, folded, "新问题")).toEqual([]); // 第 2 轮没折叠 ⇒ DOM 负责
    expect(foldedHitSeqs(rows, new Set([2]), "新问题")).toEqual([3]);
    expect(foldedHitSeqs(rows, folded, "a.ts")).toEqual([]); // 工具行不参与（与 DOM 选择器同口径）
  });

  it("大小写与空白不影响；空查询不返回任何命中", () => {
    const rows2 = [{ kind: "assistant", text: "Fixed Retry", seq: 5, round: 3, eventId: 6 }] as unknown as StreamRow[];
    expect(foldedHitSeqs(rows2, new Set([3]), "fixed retry")).toEqual([5]);
    expect(foldedHitSeqs(rows2, new Set([3]), "   ")).toEqual([]);
  });

  it("接线：FindBar 收模型行/折叠集/展开动作；命中在折叠轮里先展开再闪", () => {
    const src = read("../src/renderer/components/FindBar.tsx");
    expect(src).toContain("foldedHitSeqs(props.rows ?? [], props.foldedRounds ?? NO_FOLDS, value)");
    expect(src).toContain("props.onExpandRound?.(round);");
    expect(src).toContain("revealFolded(hit.seq, hit.round);");
    expect(src).toContain('querySelector<HTMLElement>(`[data-event-id="${String(seq + 1)}"] .t`)');
    const view = read("../src/renderer/panes/WorkbenchView.tsx");
    expect(view).toContain("rows={streamRows}");
    expect(view).toContain("foldedRounds={foldedRounds}");
    expect(view).toContain("onExpandRound={(round) => { streamActions.onToggleFold?.(round); }}");
  });
});
