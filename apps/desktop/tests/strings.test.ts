// P1 主界面重做：文案目录判卷。
// ① 值非空、无占位符（TODO/待定/英文占位）；② 无开发者禁词（自查清单第 2/3 条的机器判卷）；
// ③ 重做面组件源文扫描：字符串字面量里出现 CJK 即红（文案必须来自 STR；注释里可以有中文）。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { STR } from "../src/renderer/strings";

function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) collectStrings(v, out);
  else if (value !== null && typeof value === "object") for (const v of Object.values(value)) collectStrings(v, out);
  return out;
}

const ALL = collectStrings(STR);

describe("STR 文案目录", () => {
  it("值全部非空字符串、无占位符", () => {
    expect(ALL.length).toBeGreaterThan(50);
    for (const s of ALL) {
      expect(s.trim().length).toBeGreaterThan(0);
      expect(s).not.toMatch(/TODO|待定|FIXME|placeholder|XXX/i);
    }
  });

  it("无开发者禁词（RunRequest / attachments / IPC / JSONL / sidecar / worktree / canonical / realpath / 绝对路径）", () => {
    const banned = /RunRequest|attachments|IPC|JSONL|sidecar|worktree|canonical|realpath|绝对路径/;
    for (const s of ALL) expect(s, `文案含禁词：${s}`).not.toMatch(banned);
  });
});

/** 重做面组件源文扫描（随各任务逐步收编；P1-2/P1-3 把侧栏三件套收编；P2 收编空屏与输入区四件；
 *  App 待 P2/P3 全量迁移后收）。
 *  规则：剥注释（// 行注释与块注释）后，字符串字面量（"…" '…' `…`）里出现 CJK 即红。 */
const REWORKED_FILES: readonly string[] = [
  "src/renderer/sessions-view.ts",
  "src/renderer/components/Sidebar.tsx",
  "src/renderer/components/AddProjectMenu.tsx",
  "src/renderer/components/NewProjectDialog.tsx",
  "src/renderer/components/QuickStarts.tsx",
  "src/renderer/components/Composer.tsx",
  "src/renderer/components/ModelPicker.tsx",
  "src/renderer/components/PermissionMenu.tsx",
  "src/renderer/components/ImportDiagnosisCard.tsx",
];

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => {
      const at = line.indexOf("//");
      if (at < 0) return line;
      // 只剥「注释起点不在字符串里」的近似行——本仓这些文件的行注释都在行尾且字符串不含 //
      return line.slice(0, at);
    })
    .join("\n");
}

describe("重做面组件不写裸中文", () => {
  it("字符串字面量里无 CJK（文案一律走 STR）", () => {
    for (const rel of REWORKED_FILES) {
      const src = stripComments(readFileSync(fileURLToPath(new URL("../" + rel, import.meta.url)), "utf8"));
      const literals = [
        ...src.matchAll(/"([^"\n]*)"/g),
        ...src.matchAll(/'([^'\n]*)'/g),
        ...src.matchAll(/`([^`]*)`/g),
      ].map((m) => m[1] ?? "");
      const offenders = literals.filter((t) => /[\u4e00-\u9fff]/.test(t));
      expect(offenders, `${rel} 里有裸中文文案：${offenders.join(" | ")}`).toEqual([]);
    }
  });
});
