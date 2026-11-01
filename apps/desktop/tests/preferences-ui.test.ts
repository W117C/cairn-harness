// 偏好备份 UI 接线判卷（2026-10-30 · 第 809 页）。
// 导出走 exportPreferences；导入走 importPreferences → setSettings（沿用主题/材质热更新）→ 回灌。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("偏好备份 UI 接线", () => {
  it("AboutSection 有导出/导入按钮；导入先读备份、出确认卡，应用时才 setSettings", () => {
    const src = read("../src/renderer/components/settings-sections.tsx");
    expect(src).toContain("导出偏好…");
    expect(src).toContain("导入偏好…");
    expect(src).toContain("window.agent.exportPreferences()");
    expect(src).toContain("window.agent.importPreferences()");
    expect(src).toContain("setPendingImport({ patch: r.patch as Record<string, unknown>, ignored: r.ignored ?? [] })");
    expect(src).toContain("const next = await window.agent.setSettings(pendingImport.patch);");
    expect(src).toContain("props.onPreferencesImported?.(next)");
    expect(src).toContain("{pendingImport !== null && (");
    expect(src).toContain("<ConfirmDialog");
    expect(src).toContain("导入偏好？");
    expect(src).toContain("恢复默认…");
    expect(src).toContain("window.agent.resetPreferences()");
    expect(src).toContain("恢复默认偏好？");
  });

  it("SettingsPanel 导入成功后回灌整份设置", () => {
    expect(read("../src/renderer/components/SettingsPanel.tsx")).toContain("onPreferencesImported={setS}");
  });
});
