// 第 125 页：源码散文点名的 `scripts/<file>` 必须在盘上（或当场承认它已不在）。
//
// 立这条的实测：core-only 迁移落地（`69fbb0d`）删了 4 个被源码点名的脚本，留下 6 处死引用，
// 全仓没有任何门看见过它们（`docs-check` 的 D-3 只检查「`页.md:行号`」这一种指针语法）。
// 这是第 122 页「跨面耦合按指针语法分族」的第三个语法。
import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import {
  collectScriptRefs,
  findDeadScriptRefs,
  refIsLegit,
  scriptRefs,
} from "../scripts/lib/dead-script-refs";

describe("scriptRefs：取一行里的脚本引用", () => {
  it("同一行两处都取（漏计比双报贵）", () => {
    const got = scriptRefs("先跑 scripts/a-check.ts，再跑 scripts/b-check.mjs 对照");
    expect(got).toEqual(["scripts/a-check.ts", "scripts/b-check.mjs"]);
  });

  it("不是脚本的文件名不收（`scripts/` 目录本身、以及非脚本扩展名）", () => {
    expect(scriptRefs("见 scripts/ 目录与 scripts/notes.md")).toEqual([]);
  });
});

describe("refIsLegit：在盘上，或同行承认它不在", () => {
  const live = new Set(["scripts/docs-check.ts"]);
  const ex = (p: string) => live.has(p);

  it("在盘 ⇒ 成立，不必带标记", () => {
    expect(refIsLegit("scripts/docs-check.ts", "跑 `pnpm docs-check`（scripts/docs-check.ts）", ex)).toBe(true);
  });

  it("不在盘且没标记 ⇒ 不成立", () => {
    expect(refIsLegit("scripts/gone-check.ts", "照 scripts/gone-check.ts 的写法", ex)).toBe(false);
  });

  // 放行口径要写死成"当场承认"，否则豁免会静默扩散成第二份 LEGACY_WAIVERS。
  for (const marker of ["已删", "未入库", "不再存在"]) {
    it(`同行带「${marker}」⇒ 放行（登记式，不许静默）`, () => {
      expect(refIsLegit("scripts/gone-check.ts", `scripts/gone-check.ts ${marker}（69fbb0d）`, ex)).toBe(true);
    });
  }
});

describe("findDeadScriptRefs：假表双向", () => {
  it("红相：死引用逐条点名（文件＋行号＋目标）", () => {
    const files = [
      { path: "src/x.ts", text: "line1\n供 scripts/ghost.ts 断言用\n" },
      { path: "scripts/y.ts", text: "// 见 scripts/phantom.mts\n" },
    ];
    const got = findDeadScriptRefs(files, () => false);
    expect(got.map((h) => h.file + ":" + String(h.line) + " ⇒ " + h.target)).toEqual([
      "src/x.ts:2 ⇒ scripts/ghost.ts",
      "scripts/y.ts:1 ⇒ scripts/phantom.mts",
    ]);
  });

  it("反相：目标在盘 ⇒ 零发现（不许把活引用报成死）", () => {
    const files = [{ path: "src/x.ts", text: "跑 scripts/docs-check.ts 就行\n" }];
    expect(findDeadScriptRefs(files, (p) => p === "scripts/docs-check.ts")).toEqual([]);
  });

  it("反相：同行已承认 ⇒ 零发现", () => {
    const files = [{ path: "src/x.ts", text: "scripts/legacy.ts 已删（69fbb0d）\n" }];
    expect(findDeadScriptRefs(files, () => false)).toEqual([]);
  });
});

describe("真仓面：这条判据现在必须绿", () => {
  const face = collectScriptRefs(process.cwd());

  it("取料面两面都有内容、且不含 tests/（面空了就是尺烂了，读到 0 不算通过）", () => {
    // 实测本面 228 个文件；下限写成分面形状而不是抄总数——抄总数会在别人删文件时先红在尺上。
    expect(face.filter((f) => f.path.startsWith("src/")).length).toBeGreaterThan(100);
    expect(face.filter((f) => f.path.startsWith("scripts/")).length).toBeGreaterThan(50);
    expect(face.filter((f) => f.path.startsWith("tests/"))).toEqual([]);
    // 面里必须真有引用可判：否则「零发现」是空集带来的，不是内容的功劳
    expect(face.some((f) => scriptRefs(f.text).length > 0)).toBe(true);
  });

  it("源码散文里没有一处点名盘上不存在的脚本", () => {
    const dead = findDeadScriptRefs(face, (p) => existsSync(p));
    expect(dead.map((d) => d.file + ":" + String(d.line) + " ⇒ " + d.target)).toEqual([]);
  });
});
