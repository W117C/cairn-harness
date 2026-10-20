import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ModalSurface } from "../src/renderer/components/ModalSurface";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("ModalSurface（统一模态边界）", () => {
  it("SSR 输出 dialog / aria-modal / 可聚焦容器与模态标记", () => {
    const html = renderToStaticMarkup(
      <ModalSurface label="测试弹窗" onClose={() => undefined}>
        <button>确定</button>
      </ModalSurface>,
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-label="测试弹窗"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('data-modal-surface="true"');
  });

  it("运行时隔离背景、限制顶层模态的 Tab/Esc、并恢复原焦点", () => {
    const src = read("../src/renderer/components/ModalSurface.tsx");
    expect(src).toContain('setAttribute("inert", "")');
    expect(src).toContain('setAttribute("aria-hidden", "true")');
    expect(src).toContain("MODAL_STACK");
    expect(src).toContain("e.key === \"Escape\"");
    expect(src).toContain("e.key !== \"Tab\"");
    expect(src).toContain("previousFocus?.focus()");
  });

  it("覆盖层卸载后才采集焦点与背景状态，避免 Radix 回抢焦点和残留 aria-hidden", () => {
    const src = read("../src/renderer/components/ModalSurface.tsx");
    const stackAt = src.indexOf("MODAL_STACK.push(surface)");
    const listenerAt = src.indexOf('window.addEventListener("keydown", onKey, true)');
    const activateAt = src.indexOf("const activate = (): void => {");
    const settleAt = src.indexOf("window.setTimeout(() => {", activateAt);
    const runAt = src.indexOf("window.setTimeout(activate, 0)", settleAt);
    const previousFocusAt = src.indexOf("document.activeElement", activateAt);
    const isolateAt = src.indexOf("isolateOutside(surface)", activateAt);
    const focusAt = src.indexOf("first.focus()", activateAt);

    expect(stackAt).toBeGreaterThan(-1);
    expect(listenerAt).toBeGreaterThan(stackAt);
    expect(activateAt).toBeGreaterThan(listenerAt);
    expect(settleAt).toBeGreaterThan(activateAt);
    expect(runAt).toBeGreaterThan(settleAt);
    expect(previousFocusAt).toBeGreaterThan(activateAt);
    expect(isolateAt).toBeGreaterThan(activateAt);
    expect(focusAt).toBeGreaterThan(activateAt);
  });

  it("自动弹出的模型选择窗关闭后回到「选择模型」按钮，而不是 body", () => {
    const modalSrc = read("../src/renderer/components/ModalSurface.tsx");
    const formSrc = read("../src/renderer/components/CustomProviderForm.tsx");

    expect(modalSrc).toContain("returnFocusRef?: RefObject<HTMLElement | null>");
    expect(modalSrc).toContain("returnFocus");
    expect(formSrc).toContain("const pickerButton = useRef<HTMLButtonElement | null>(null)");
    expect(formSrc).toContain("ref={pickerButton}");
    expect(formSrc).toContain("returnFocusRef={pickerButton}");
  });

  it("自定义模态全部走同一边界；App 全局快捷键遇到模态即让路", () => {
    for (const rel of [
      "../src/renderer/components/SettingsPanel.tsx",
      "../src/renderer/components/NewProjectDialog.tsx",
      "../src/renderer/components/Sidebar.tsx",
      "../src/renderer/components/CustomProviderForm.tsx",
      "../src/renderer/App.tsx",
    ]) {
      expect(read(rel), rel).toContain("<ModalSurface");
    }
    // 2026-10-20：这条从「源码里有一行字面量」改成「走共享门」——
    // 判断本身搬进了 src/renderer/command-gate.ts（**行为**判据在 tests/command-gate.test.ts：
    // 真造一个模态面、真把焦点放进输入框），这里钉的是
    // **App 的全局快捷键路径确实走那道门**（键盘与菜单两条入口同源，别再各判各的）。
    expect(read("../src/renderer/App.tsx")).toContain("overlayBlocked(readGateInput(");
  });
});
