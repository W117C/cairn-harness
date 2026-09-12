// M4b 任务 4：新手引导单测——§13 七组覆盖清单（结构性断言：组数 = 7 / id 集合精确 / 步号 1–4 有组）
// + 确认控件映射无缺失 + 4 步 SSR 冒烟（渲染含组标签与控件，零 window 依赖不抛）
// + onboarded 持久化语义（settings 存储缺省 false / 写 true 后重载还原 / 非法值回退）。
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  SettingsStore,
  validateSettings,
} from "../src/main/settings";
import {
  ONBOARDING_GROUPS,
  ONBOARDING_STEP_TITLES,
  OnboardingSteps,
  OnboardingWizard,
  licenseStatusLabel,
  updateResultLabel,
} from "../src/renderer/onboarding";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach } from "vitest";
import type { LicenseState } from "../src/main/license";

const ALL_IDS = ["provider", "permission", "ui", "schedule", "memory", "telemetry", "about"] as const;
const noop = (): void => {};

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "m4b-onboarding-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function wizardProps(step: 1 | 2 | 3 | 4) {
  return {
    open: true,
    onOpenChange: noop,
    settings: { ...DEFAULT_SETTINGS },
    sandbox: { available: true } as NonNullable<import("../src/main/ipc-protocol").StateResponse["sandbox"]>,
    license: { state: "inactive" } as LicenseState,
    providerKeys: { available: true, stored: [], envActive: false } as NonNullable<import("../src/main/ipc-protocol").StateResponse["providerKeys"]>,
    appVersion: "0.0.1",
    onSettings: noop,
    onFinish: noop,
    defaultStep: step,
  };
}

describe("新手引导（§13「走通全部设置项」）", () => {
  it("覆盖清单：恰为 §13 七组，id 集合精确（缺组 = 引导没有走通全部设置项）", () => {
    expect(ONBOARDING_GROUPS).toHaveLength(7);
    expect(new Set(ONBOARDING_GROUPS.map((g) => g.id))).toEqual(new Set<string>(ALL_IDS as readonly string[]));
    expect(ONBOARDING_GROUPS.map((g) => g.label).every((l) => l.length > 0)).toBe(true);
    expect(ONBOARDING_GROUPS.map((g) => g.entry).every((e) => e.length > 0)).toBe(true);
  });

  it("步号结构：1–4 步各有组（4 步向导），步标题 4 条；组分布 = 1/3/3 组无空步", () => {
    expect(ONBOARDING_STEP_TITLES).toHaveLength(4);
    for (const step of [1, 2, 3, 4] as const) {
      expect(ONBOARDING_GROUPS.filter((g) => g.step === step).length, "第 " + String(step) + " 步有组").toBeGreaterThan(0);
    }
    expect(ONBOARDING_GROUPS.filter((g) => g.step === 1)).toHaveLength(1); // 欢迎+BYOK
    expect(ONBOARDING_GROUPS.filter((g) => g.step === 2)).toHaveLength(2); // 权限+UI
    expect(ONBOARDING_GROUPS.filter((g) => g.step === 3)).toHaveLength(3); // 定时+记忆+遥测
    expect(ONBOARDING_GROUPS.filter((g) => g.step === 4)).toHaveLength(1); // 关于/更新
  });

  it("SSR 冒烟 ×4 步：每步渲染含该步组 id 标记 + 组标签，不抛（零 window 依赖；渲染内层 OnboardingSteps——Dialog 走 portal 不进静态标记，坑七十）", () => {
    const byStep = (step: 1 | 2 | 3 | 4): string =>
      renderToStaticMarkup(
        createElement(OnboardingSteps, {
          ...wizardProps(step),
          step,
          setStep: noop,
          keyCtx: { keyInput: "", setKeyInput: noop, keyNote: null, saveKey: noop },
        }),
      );
    for (const step of [1, 2, 3, 4] as const) {
      const html = byStep(step);
      expect(html.length).toBeGreaterThan(0);
      for (const g of ONBOARDING_GROUPS.filter((x) => x.step === step)) {
        expect(html).toContain('data-m4b-onboard-group="' + g.id + '"');
        expect(html).toContain(g.label);
      }
      expect(html).toContain("新手引导");
    }
    // 第 1 步不渲染第 3 步的组（分步覆盖，不是一屏全铺）
    expect(byStep(1)).not.toContain('data-m4b-onboard-group="telemetry"');
  });

  it("关闭态 SSR：open=false 渲染零向导内容（首启前/完成后不弹）", () => {
    const html = renderToStaticMarkup(createElement(OnboardingWizard, { ...wizardProps(1), open: false }));
    expect(html).not.toContain("data-m4b-onboard-group=");
  });

  it("settings.onboarded 状态机：缺省 false（首启必弹）→ 完成 true 重载还原 → 非法值回退 false", async () => {
    expect(DEFAULT_SETTINGS.onboarded).toBe(false); // 缺省 false = 永不再现缺陷的反向锚（缺省 true 即单测红）
    const file = join(dir, "settings.json");
    const a = new SettingsStore(file);
    expect((await a.get()).onboarded).toBe(false);
    await a.set({ onboarded: true });
    expect((await new SettingsStore(file).get()).onboarded).toBe(true); // 重启不再弹
    await import("node:fs/promises").then((m) => m.writeFile(file, JSON.stringify({ onboarded: "yes" }), "utf8"));
    expect((await new SettingsStore(file).get()).onboarded).toBe(false);
    expect(validateSettings({ updateManifestUrl: "https://e/x.json" }).updateManifestUrl).toBe("https://e/x.json");
    expect(validateSettings({ updateManifestUrl: 42 }).updateManifestUrl).toBe("");
    expect(validateSettings({ telemetry: true }).telemetry).toBe(true);
    expect(validateSettings({ telemetry: "yes" }).telemetry).toBe(false);
  });

  it("显式态文案：license 四态 + 更新四态（未配置/错误/最新/有新版）可读", () => {
    expect(licenseStatusLabel({ state: "inactive" })).toContain("未激活");
    expect(licenseStatusLabel({ state: "valid", licensee: "A", expiresAt: null })).toContain("有效");
    expect(licenseStatusLabel({ state: "expired", licensee: "A", expiresAt: "2020-01-01T00:00:00Z" })).toContain("已过期");
    expect(licenseStatusLabel({ state: "invalid", reason: "签名坏" })).toContain("签名坏");
    expect(updateResultLabel({ state: "unconfigured" })).toContain("未配置更新源");
    expect(updateResultLabel({ state: "error", message: "断网" })).toContain("断网");
    expect(updateResultLabel({ state: "up-to-date", currentVersion: "0.0.1", manifestVersion: "0.0.1" })).toContain("已是最新");
    expect(updateResultLabel({ state: "available", currentVersion: "0.0.1", version: "1.0.0", url: "u" })).toContain("1.0.0");
  });
});
