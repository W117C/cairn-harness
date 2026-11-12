// 终端剪贴板键（2026-10-18）：xterm 默认不把选区写系统剪贴板、也不接管粘贴；终端里选中的字
// 复制不出来是“按键缺失”。这条钉住：主修饰键才拦（macOS ⌘ / 其它平台 Ctrl+Shift），裸 Ctrl+C
// 必须继续透传给 PTY 当 SIGINT。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = readFileSync(fileURLToPath(new URL("../src/renderer/components/TerminalPane.tsx", import.meta.url)), "utf8");

describe("终端剪贴板键", () => {
  it("全选 / 复制选区 / 粘贴走自有处理", () => {
    expect(src).toContain("t.attachCustomKeyEventHandler((e) => {");
    expect(src).toContain("t.selectAll();");
    expect(src).toContain("const sel = t.getSelection();");
    expect(src).toContain("navigator.clipboard.writeText(sel)");
    expect(src).toContain("navigator.clipboard.readText()");
    expect(src).toContain("t.paste(text);");
  });

  it("只在主修饰键上拦；裸 Ctrl+C 透传（SIGINT）", () => {
    expect(src).toContain("const primary = e.metaKey || (e.ctrlKey && e.shiftKey);");
    expect(src).toContain("if (!primary) return true;");
  });

  // 第 1083 页：复制/粘贴的剪贴板**失败**也要说出来——952/1073/1080/1082 同族。
  // 同 effect 的 terminalResize/terminalWrite 早已 showError（resolve-false＋reject 两路），
  // 唯独 ⌘C 的 writeText.catch 与 ⌘V 的 readText reject 是 () => undefined：用户按了键、
  // 剪贴板没写成/读成（权限拒绝、文档失焦、API 不可用），界面毫无反应＝「点了像没点」。
  it("复制/粘贴失败走 showError，不再静默吞掉", () => {
    expect(src).toContain("navigator.clipboard.writeText(sel).catch((err: unknown) => {");
    expect(src).toContain("showError(`复制失败：${err instanceof Error ? err.message : String(err)}`);");
    expect(src).toContain("showError(`粘贴失败：${err instanceof Error ? err.message : String(err)}`);");
    // 旧静默写法（PaneDock 内仅此两处：⌘C 的 catch、⌘V 的 reject）一处不许留
    expect(src).not.toContain("() => undefined");
  });
});
