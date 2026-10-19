// 设置页保存后的 live 回灌（2026-10-18 真机）：Ctrl+Tab 开关只写进 settings，没更新 App 的
// ctrlTabCycle state ⇒ 界面上关掉了，快捷键照旧切会话，重启才生效。凡是快捷键读取的设置，
// 保存回调必须回灌到 live state。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const app = readFileSync(fileURLToPath(new URL("../src/renderer/App.tsx", import.meta.url)), "utf8");

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
