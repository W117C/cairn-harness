
import { describe, expect, it } from "vitest";
import { readAppSurface } from "./helpers/app-surface";

const APP = readAppSurface();

describe("Esc 与门卡（不让「关掉卡」变成「杀掉任务」）", () => {
  it("审批/澄清/计划卡在场时，Esc 在取消运行之前短路", () => {
    const escAt = APP.indexOf('if (e.key === "Escape")');
    expect(escAt).toBeGreaterThan(-1);
    const gateAt = APP.indexOf("if (h.gatePending) return;", escAt);
    const cancelAt = APP.indexOf("h.cancelRun(h.activeId)", escAt);
    expect(gateAt).toBeGreaterThan(-1);
    expect(cancelAt).toBeGreaterThan(gateAt);
  });

  it("gatePending 同时覆盖审批 ask、澄清、计划三张卡", () => {
    expect(APP).toContain(
      "gatePending: askForActive !== null || pendingClarify !== null || pendingPlan !== null",
    );
  });
});

describe("键盘浮层关闭后焦点回到输入框", () => {
  it("⌘K 面板 onClose 收起面板并回焦", () => {
    expect(APP).toContain("onClose={() => { setPaletteOpen(false); focusComposer(); }}");
  });

  it("⌘F 查找条与 ⌘/ 速查表走带回焦的统一出口", () => {
    expect(APP).toMatch(/const closeFind = useCallback\(\(\): void => \{\s*setFindOpen\(false\);\s*focusComposer\(\);/s);
    expect(APP).toMatch(/const closeCheat = useCallback\(\(\): void => \{\s*setCheatOpen\(false\);\s*focusComposer\(\);/s);
    expect(APP).toContain("onClose={closeFind}");
  });

  it("回焦落点是 composer 的 textarea，而不是 body", () => {
    expect(APP).toContain('document.querySelector<HTMLTextAreaElement>(".composer-card textarea")?.focus()');
  });
});
