// 许可证导入的渲染层接线判卷（2026-10-30 · 第 805 页）。
// 验签与「失败不覆盖」在 core tests/license-import.test.ts；这里钉 UI：按钮走 importLicense、
// 成功后回灌 license 状态、回执上屏，不静默。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { STR } from "../src/renderer/strings";

// 第 1071 页：AboutSection 按区拆分至 settings/，许可证导入接线源文断言随段走（读新文件，不放宽）。
const src = readFileSync(fileURLToPath(new URL("../src/renderer/components/settings/AboutSection.tsx", import.meta.url)), "utf8");
const panel = readFileSync(fileURLToPath(new URL("../src/renderer/components/SettingsPanel.tsx", import.meta.url)), "utf8");

describe("许可证导入 UI 接线", () => {
  it("AboutSection 有「导入许可证…」按钮，走 window.agent.importLicense()", () => {
    // 第 1078 页：文案收编进 STR 后源文只剩键——键形与值锚一起钉（原意不放宽）。
    expect(src).toContain("STR.about.licenseImport");
    expect(STR.about.licenseImport).toBe("导入许可证…");
    expect(src).toContain("window.agent.importLicense()");
    expect(src).toContain("props.onLicenseChanged?.(r.state)");
    expect(src).toContain("STR.about.licenseImported.replace(\"{licensee}\", r.state.licensee)");
    expect(STR.about.licenseImported).toBe("许可证已导入：{licensee}");
  });

  it("导入成功后设置壳回灌 license 状态（标签即时更新）", () => {
    expect(panel).toContain("onLicenseChanged={setLicense}");
  });
});
