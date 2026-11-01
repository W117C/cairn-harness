// 第 949 页：设置页头不许自己抄一份分区名。
// `settings-nav.tsx#SECTIONS` 自称「顺序固定，唯一事实源——导航与命令面板只许从这里取」，
// 但 `SettingsPanel` 的七个页头各写了一遍字面量：导航改名、页头还留旧话。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SECTIONS, sectionLabel } from "../src/renderer/components/settings-nav";

const ROOT = join(import.meta.dirname, "..");
const panel = readFileSync(join(ROOT, "src/renderer/components/SettingsPanel.tsx"), "utf8");

describe("设置分区标题只有一个出口（第 949 页）", () => {
  it("sectionLabel 对每个分区都回 SECTIONS 里的那一行", () => {
    for (const s of SECTIONS) expect(sectionLabel(s.id)).toBe(s.label);
    expect(sectionLabel("general")).toBe("通用");
    expect(sectionLabel("about")).toBe("关于与更新");
    expect(sectionLabel("nope" as never)).toBe("nope"); // 认不出的原样返回，不编
  });

  it("页头不再写字面量，且六个分区都走 sectionLabel", () => {
    expect(panel).not.toContain('SettingsPage title="');
    for (const id of ["general", "provider", "permissions", "shortcuts", "advanced", "about"]) {
      expect(panel).toContain(`<SettingsPage title={sectionLabel("${id}")}>`);
    }
  });

  it("分区内部的段标题不许与分区名同名（页头下再顶一行同名标题）", () => {
    const sections = readFileSync(join(ROOT, "src/renderer/components/settings-sections.tsx"), "utf8");
    const titles = [...sections.matchAll(/<SettingsSection title="([^"]+)"/gu)].map((m) => m[1]!);
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
