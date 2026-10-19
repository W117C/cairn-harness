// 设置页「高级」段 + 更新源判卷（2026-10-18 补）。
//
// 背景：AppSettings 有 ~28 个字段，界面上只有 7 个有开关。审出来最值得先摆出来的几个
// **默认值就在影响花钱与行为**，用户看不见也改不了：
//   · autoMemory（默认 true）——每轮结束自动把结论写进记忆层，UI 关不掉；
//   · impactAnalysis / promptCache（默认 true）——影响成本与行为，不可见；
//   · maxBudgetUsd / budgetPricePerMTok（默认 0=关）——花费闸，没有入口；
//   · telemetry（默认 false）——没有开关也没有披露；
//   · updateManifestUrl——**界面死胡同**：关于页永远显示「未配置更新源」，用户没地方填。
//
// 两条实现纪律（本判卷钉住）：
// ① 不开 panelPatch 白名单。那份白名单被判卷钉成六键，且它存在的理由（locale 曾被静默
//    丢成 {}）仍然成立——把新键塞进去等于改判据来迁就实现。走 saveSettingKey 单键直调
//    （与既有的 saveCtrlTab 同一条路）。
// ② 数字字段先在校验层拦住。后端 validateSettings 对非法值**静默回退默认**，
//    界面不拦就会出现「显示已保存、实际存的是 0」——正是这个面板要修的那类假象。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseBudgetField } from "../src/renderer/components/settings-sections";
import { SECTIONS } from "../src/renderer/components/settings-nav";

const sectionsSrc = readFileSync(fileURLToPath(new URL("../src/renderer/components/settings-sections.tsx", import.meta.url)), "utf8");
const panelSrc = readFileSync(fileURLToPath(new URL("../src/renderer/components/SettingsPanel.tsx", import.meta.url)), "utf8");

describe("parseBudgetField（界面侧先拦，别让后端静默回退）", () => {
  it("空串 = 0 = 关（与 settings.ts 缺省口径逐字一致）", () => {
    expect(parseBudgetField("", 10000)).toEqual({ ok: true, value: 0 });
    expect(parseBudgetField("   ", 10000)).toEqual({ ok: true, value: 0 });
  });

  it("合法数字原样通过（含小数与 0）", () => {
    expect(parseBudgetField("0", 10000)).toEqual({ ok: true, value: 0 });
    expect(parseBudgetField("5", 10000)).toEqual({ ok: true, value: 5 });
    expect(parseBudgetField("2.5", 10000)).toEqual({ ok: true, value: 2.5 });
    expect(parseBudgetField(" 1.5 ", 10000)).toEqual({ ok: true, value: 1.5 });
  });

  it("非数字 / 负数 / 超上限一律拒绝并说清理由", () => {
    expect(parseBudgetField("abc", 10000)).toEqual({ ok: false, error: "要填一个不小于 0 的数字" });
    expect(parseBudgetField("-1", 10000)).toEqual({ ok: false, error: "要填一个不小于 0 的数字" });
    expect(parseBudgetField("1e999", 10000).ok).toBe(false); // Infinity
    expect(parseBudgetField("999999", 10000)).toEqual({ ok: false, error: "上限是 10000" });
  });

  it("0 是合法值（不是「空」的别名而被拒）", () => {
    // 回归锚点：若把 0 当 falsy 挡掉，用户就永远无法把上限改回「关」
    const r = parseBudgetField("0", 10000);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(0);
  });
});

describe("高级段的字段真的接上了", () => {
  it("五个字段都有控件（autoMemory / impactAnalysis / promptCache / maxBudgetUsd / budgetPricePerMTok / telemetry）", () => {
    for (const key of ["autoMemory", "impactAnalysis", "promptCache", "telemetry"]) {
      expect(sectionsSrc, `${key} 缺控件`).toContain(`props.onSaveKey("${key}", next)`);
    }
    expect(sectionsSrc).toContain('props.onSaveKey("maxBudgetUsd", r.value)');
    expect(sectionsSrc).toContain('props.onSaveKey("budgetPricePerMTok", r.value)');
  });

  it("导航里有「高级」这一节（否则接好了也进不去）", () => {
    expect(SECTIONS.some((s) => s.id === "advanced")).toBe(true);
    expect(SECTIONS.find((s) => s.id === "advanced")?.label).toBe("高级");
  });

  it("面板真的渲染 AdvancedSection 并接 saveSettingKey", () => {
    expect(panelSrc).toContain('section === "advanced"');
    expect(panelSrc).toContain("<AdvancedSection settings={settings} onSaveKey={saveSettingKey} />");
  });

  it("走单键直调，不动 panelPatch 白名单（那份判卷钉死六键）", () => {
    expect(panelSrc).toContain("const saveSettingKey = async");
    expect(panelSrc).toContain("window.agent.setSettings({ [key]: value })");
    // 反向：白名单没有被顺手扩掉
    expect(sectionsSrc).toContain('export const PANEL_PATCH_KEYS = ["provider", "model", "mode", "theme", "planRequiredByDefault", "locale"] as const;');
  });
});

describe("更新源不再死胡同", () => {
  it("关于段给更新源输入框（此前只能改 settings.json）", () => {
    expect(sectionsSrc).toContain("props.onSaveManifest !== undefined &&");
    expect(sectionsSrc).toContain("aria-label={STR.update.manifestLabel}");
  });

  it("未配置时明说（不是留个空框让用户猜）", () => {
    expect(sectionsSrc).toContain("STR.update.manifestEmpty");
  });

  it("面板把 settings.updateManifestUrl 传下去并接单键直写", () => {
    expect(panelSrc).toContain("updateManifestUrl={settings?.updateManifestUrl ?? \"\"}");
    expect(panelSrc).toContain('onSaveManifest={(url) => { void saveSettingKey("updateManifestUrl", url); }}');
  });

  it("只在值真变了才写（避免每次失焦都写一笔 + 骗一次「已保存」）", () => {
    expect(sectionsSrc).toContain("if (next !== (props.updateManifestUrl ?? \"\")) props.onSaveManifest?.(next);");
  });
});
