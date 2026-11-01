// 发布史判卷（2026-10-30 · 第 829 页）：0.2.0 必须把桌面端从「不在交付面」改成实际能力，
// 且关键数据出口（偏好/记忆/用量/诊断/DMG）不能只活在 README 里。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL("../" + rel, import.meta.url)), "utf8");

describe("CHANGELOG 0.2.0", () => {
  it("桌面端与数据出口都写进版本条目", () => {
    const log = read("CHANGELOG.md");
    expect(log).toContain("## 0.2.0 — 2026-10-30");
    expect(log).toContain("Electron + React 桌面壳");
    for (const word of ["偏好导出/导入/恢复默认", "记忆导出", "用量 CSV", "诊断包", "DMG（含 Applications", "Applications"]) {
      expect(log, word).toContain(word);
    }
    expect(log).toContain("不在本版：Apple 公证、自动下载/安装更新、英文界面");
  });

  it("0.1.0 的历史句不再冒充现状（改指 0.2.0）", () => {
    const log = read("CHANGELOG.md");
    expect(log).toContain("0.1.0 时不在交付面：桌面端");
    expect(log).toContain("桌面端见 0.2.0");
  });
});
