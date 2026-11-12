// 第 949 页：设置页头不许自己抄一份分区名。
// `settings-nav.tsx#SECTIONS` 自称「顺序固定，唯一事实源——导航与命令面板只许从这里取」，
// 但 `SettingsPanel` 的七个页头各写了一遍字面量：导航改名、页头还留旧话。
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SECTIONS, sectionById, sectionLabel } from "../src/renderer/components/settings-nav";
import { resolveValue, SRC_VALUE } from "./helpers/str-source";

const ROOT = join(import.meta.dirname, "..");
const panel = readFileSync(join(ROOT, "src/renderer/components/SettingsPanel.tsx"), "utf8");

describe("设置分区标题只有一个出口（第 949 页）", () => {
  it("sectionLabel 对每个分区都回 SECTIONS 里的那一行", () => {
    for (const s of SECTIONS) expect(sectionLabel(s.id)).toBe(s.label);
    expect(sectionLabel("general")).toBe("通用");
    expect(sectionLabel("about")).toBe("关于与更新");
    expect(sectionLabel("nope" as never)).toBe("nope"); // 认不出的原样返回，不编
    expect(sectionById("general")?.label).toBe("通用");
    expect(panel).toContain("const s = sectionById(id);");
  });

  it("页头不再写字面量，且六个分区都走 sectionLabel", () => {
    expect(panel).not.toContain('SettingsPage title="');
    for (const id of ["general", "provider", "permissions", "shortcuts", "advanced", "about"]) {
      expect(panel).toContain(`<SettingsPage title={sectionLabel("${id}")}>`);
    }
  });

  it("分区内部的段标题不许与分区名同名（页头下再顶一行同名标题）", () => {
    // 第 1066 页：GeneralSection 按区拆分至 settings/，段标题扫描随正文走（monolith + settings/*.tsx）。
    const SETTINGS_DIR = join(ROOT, "src/renderer/components/settings");
    const sections = [
      readFileSync(join(ROOT, "src/renderer/components/settings-sections.tsx"), "utf8"),
      ...readdirSync(SETTINGS_DIR).filter((f) => f.endsWith(".tsx")).sort().map((f) => readFileSync(join(SETTINGS_DIR, f), "utf8")),
    ].join("\n");
    // 第 1075 页：标题收编进 STR 后只剩 {STR.general.appearanceTitle} 这种形状——两种形状都解析回值再判，
    // 否则 GeneralSection 会从扫描面里静默消失（判据空跑成绿就是放低门槛）。
    const titleRe = new RegExp("<SettingsSection title=" + SRC_VALUE, "gu");
    const titles = [...sections.matchAll(titleRe)]
      .map((m) => resolveValue(m[1], m[2]))
      .filter((t): t is string => t !== undefined);
    expect(titles.length).toBeGreaterThanOrEqual(8); // 取不到标题说明正则坏了，不许空跑成绿
    const nav = new Set(SECTIONS.map((s) => s.label));
    const dup = titles.filter((t) => nav.has(t));
    expect(dup, "这些段标题与分区名同名：" + dup.join(" | ")).toEqual([]);
  });

  it("分区名两两不同（同名两个分区，导航里读不出区别）", () => {
    const labels = SECTIONS.map((s) => s.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});
