// 键位提示的引用完整性（2026-11-01 第 910 页）。
// 缘起：`shortcuts.test.ts` 的注释早就写着「表里没有的 id 不得被引用」，但一直没被钉成判卷。
// 于是命令面板「重命名当前会话」那一行直接手抄了 "F2"（表里没有 rename 这一档）——
// 同一枚键位从此有两份事实源：改绑定后速查表与面板会说不一样的话。
// 本判卷把那句注释变成会红的检查：凡是 `keysOf("x")` / `shortcutId: "x"` 引用到的 id，
// 必须存在于 SHORTCUTS；缺一个就是界面上**静默少一枚提示**（不报错、不红，肉眼扫不出来）。
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SHORTCUTS } from "../src/renderer/shortcuts";

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const f = dir + "/" + e.name;
    if (e.isDirectory()) return e.name === ".mimosa" ? [] : sources(f);
    return /\.(tsx|ts)$/.test(e.name) ? [f] : [];
  });
}

describe("键位 id 引用完整性", () => {
  const renderer = fileURLToPath(new URL("../src/renderer", import.meta.url));
  const referenced = new Set<string>();
  for (const f of sources(renderer)) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/keysOf\("([\w-]+)"\)/g)) referenced.add(m[1]);
    for (const m of src.matchAll(/shortcutId: "([\w-]+)"/g)) referenced.add(m[1]);
  }

  it("被引用的 id 全部在表里", () => {
    // 反向自证之一：清点面必须真的扫到了引用，否则这条会恒真。
    expect(referenced.size, "没扫到任何 keysOf/shortcutId 引用，清点面失效").toBeGreaterThan(5);
    expect(referenced.has("rename")).toBe(true);
    const ids = new Set(SHORTCUTS.map((s) => s.id));
    const missing = [...referenced].filter((id) => !ids.has(id));
    expect(missing, "这些被引用的键位 id 不在表里（界面会静默少提示）：" + missing.join(", ")).toEqual([]);
  });

  it("面板不再手抄键位字面量", () => {
    const palette = readFileSync(fileURLToPath(new URL("../src/renderer/components/CommandPalette.tsx", import.meta.url)), "utf8");
    const literals = [...palette.matchAll(/className="cp-keys">([^<{][^<]*)</g)].map((m) => m[1].trim());
    expect(literals, "手抄的键位提示：" + literals.join(" / ")).toEqual([]);
  });
});
