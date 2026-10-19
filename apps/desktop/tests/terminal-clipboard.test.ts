// 终端剪贴板键（2026-10-18）：xterm 默认不把选区写系统剪贴板、也不接管粘贴；终端里选中的字
// 复制不出来是“按键缺失”。这条钉住：主修饰键才拦（macOS ⌘ / 其它平台 Ctrl+Shift），裸 Ctrl+C
// 必须继续透传给 PTY 当 SIGINT。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = readFileSync(fileURLToPath(new URL("../src/renderer/components/PaneDock.tsx", import.meta.url)), "utf8");

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
});
