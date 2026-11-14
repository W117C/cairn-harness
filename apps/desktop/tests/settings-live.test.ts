
import { describe, expect, it } from "vitest";
import { readAppSurface } from "./helpers/app-surface";

const app = readAppSurface();

describe("设置保存的 live 回灌", () => {
  it("onSettingsSaved 回灌 mode / theme / ctrlTabCycle", () => {
    expect(app).toContain("setMode(s.mode);");
    expect(app).toContain("setThemePref(s.theme);");
    expect(app).toContain("setCtrlTabCycle(s.ctrlTabCycle);");
  });

  it("Ctrl+Tab 处理器仍按 live state 让路", () => {
    expect(app).toContain("if (!h.ctrlTabCycle) return;");
    expect(app).toContain("if (e.key === \"Tab\" && e.ctrlKey && !e.metaKey && !e.altKey) {");
  });
});
