// 偏好备份 UI 接线判卷（2026-10-30 · 第 809 页）。
// 导出走 exportPreferences；导入走 importPreferences → setSettings（沿用主题/材质热更新）→ 回灌。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { STR } from "../src/renderer/strings";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("偏好备份 UI 接线", () => {
  it("AboutSection 有导出/导入按钮；导入先读备份、出确认卡，应用时才 setSettings", () => {
    // 第 1071 页：AboutSection 按区拆分至 settings/，偏好备份接线源文断言随段走（读新文件，不放宽）。
    const src = read("../src/renderer/components/settings/AboutSection.tsx");
    // 第 1078 页：五处按钮/对话框文案收编进 STR——键形＋值锚（原意不放宽）。
    expect(src).toContain("STR.about.exportPreferences");
    expect(STR.about.exportPreferences).toBe("导出偏好…");
    expect(src).toContain("STR.about.importPreferences");
    expect(STR.about.importPreferences).toBe("导入偏好…");
    expect(src).toContain("window.agent.exportPreferences()");
    expect(src).toContain("window.agent.importPreferences()");
    expect(src).toContain("setPendingImport({ patch: r.patch as Record<string, unknown>, ignored: r.ignored ?? [] })");
    expect(src).toContain("const next = await window.agent.setSettings(pendingImport.patch);");
    expect(src).toContain("props.onPreferencesImported?.(next)");
    expect(src).toContain("{pendingImport !== null && (");
    expect(src).toContain("<ConfirmDialog");
    expect(src).toContain("STR.about.importTitle");
    expect(STR.about.importTitle).toBe("导入偏好？");
    expect(src).toContain("STR.about.resetPreferences");
    expect(STR.about.resetPreferences).toBe("恢复默认…");
    expect(src).toContain("window.agent.resetPreferences()");
    expect(src).toContain("STR.about.resetTitle");
    expect(STR.about.resetTitle).toBe("恢复默认偏好？");
  });

  it("SettingsPanel 导入成功后回灌整份设置", () => {
    expect(read("../src/renderer/components/SettingsPanel.tsx")).toContain("onPreferencesImported={setS}");
  });
});
