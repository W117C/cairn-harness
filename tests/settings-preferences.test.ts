// 偏好备份判卷（2026-10-30 · 第 809 页）：
// ① 只搬界面/行为偏好——provider / model / workspace / currentSession / onboarded / layout 不进备份；
// ② 导入严格：任一已知键类型/枚举/范围不对 → 整份拒绝；未知键忽略并回报（新旧版本兼容）。
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../src/main/settings";
import {
  PREFERENCES_FORMAT,
  buildPreferencesExport,
  defaultPreferences,
  parsePreferencesImport,
  pickPreferences,
  readPreferencesFile,
} from "../src/main/preferences";

const dirs: string[] = [];
const fileWith = (content: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "cairn-prefs-"));
  dirs.push(dir);
  const file = join(dir, "prefs.json");
  writeFileSync(file, content, "utf8");
  return file;
};
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

const custom = {
  ...DEFAULT_SETTINGS,
  theme: "dark" as const,
  textSize: "lg" as const,
  autoMemory: false,
  maxBudgetUsd: 12.5,
  provider: "deepseek" as const,
  model: "deepseek-chat",
  workspace: "/tmp/someone-else",
  currentSession: "sess-1",
  onboarded: true,
};

describe("导出：只挑偏好", () => {
  it("不带 provider / model / workspace / currentSession / onboarded / layout", () => {
    const patch = pickPreferences(custom) as Record<string, unknown>;
    for (const key of ["provider", "model", "workspace", "currentSession", "onboarded", "layout"]) {
      expect(patch).not.toHaveProperty(key);
    }
    expect(patch.theme).toBe("dark");
    expect(patch.maxBudgetUsd).toBe(12.5);
  });

  it("build → parse 往返：值不变，format/appVersion/exportedAt 在", () => {
    const payload = buildPreferencesExport(custom, "0.1.0", "2026-10-30T05:00:00.000Z");
    expect(payload.format).toBe(PREFERENCES_FORMAT);
    const parsed = parsePreferencesImport(payload);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.patch).toEqual(pickPreferences(custom));
      expect(parsed.ignored).toEqual([]);
    }
  });
});

describe("导入：严格校验", () => {
  const wrap = (preferences: unknown) => ({ format: PREFERENCES_FORMAT, appVersion: "0.1.0", exportedAt: "T", preferences });

  it("主题/布尔/并发上限的坏值都整份拒绝，且点名键", () => {
    for (const [bad, key] of [
      [{ theme: "neon" }, "theme"],
      [{ autoMemory: "yes" }, "autoMemory"],
      [{ scheduleConcurrencyCap: 0 }, "scheduleConcurrencyCap"],
      [{ maxBudgetUsd: -1 }, "maxBudgetUsd"],
      [{ updateManifestUrl: "http://example.com" }, "updateManifestUrl"],
    ] as const) {
      const r = parsePreferencesImport(wrap(bad));
      expect(r.ok, JSON.stringify(bad)).toBe(false);
      if (!r.ok) expect(r.error).toContain(key);
    }
  });

  it("format 不匹配 / 空偏好 / 不是对象都拒绝", () => {
    expect(parsePreferencesImport({ format: "other", preferences: { theme: "dark" } }).ok).toBe(false);
    expect(parsePreferencesImport(wrap({})).ok).toBe(false);
    expect(parsePreferencesImport(null).ok).toBe(false);
  });

  it("未知键忽略并回报（新版本备份在旧版本上不整份失败）", () => {
    const r = parsePreferencesImport(wrap({ theme: "light", futureKnob: true }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.patch.theme).toBe("light");
      expect(r.ignored).toEqual(["futureKnob"]);
    }
  });
});

describe("readPreferencesFile", () => {
  it("好文件读得出来；坏 JSON / 超限 / 缺文件都拒绝", async () => {
    const good = buildPreferencesExport(custom, "0.1.0", "T");
    expect((await readPreferencesFile(fileWith(JSON.stringify(good)))).ok).toBe(true);
    expect((await readPreferencesFile(fileWith("{bad"))).ok).toBe(false);
    expect((await readPreferencesFile(fileWith("x".repeat(70 * 1024)))).ok).toBe(false);
    expect((await readPreferencesFile(join(tmpdir(), "cairn-no-such-prefs.json"))).ok).toBe(false);
  });
});

describe("默认偏好 patch", () => {
  it("等于默认设置的偏好投影，且仍不含身份/项目/会话/布局", () => {
    const patch = defaultPreferences() as Record<string, unknown>;
    expect(patch).toEqual(pickPreferences(DEFAULT_SETTINGS));
    for (const key of ["provider", "model", "workspace", "currentSession", "onboarded", "layout"]) {
      expect(patch).not.toHaveProperty(key);
    }
  });
});
