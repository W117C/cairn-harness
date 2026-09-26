/** `scripts/head-import-face.ts` 的判卷（第 131 页立尺）。
 *  立尺的实测：`834ba3a` 把 4 个新模块留在未跟踪状态就提交了消费者 ⇒ HEAD 从那时起
 *  typecheck 8 条错、干净树 34 个判卷文件红，而**主树全量绿**——主树的判卷永远看不见这件事。
 *  本尺只看提交对象（`git ls-tree` ＋ `git grep <rev>`），所以别人盘上的未提交改动盖不住它。
 *  判卷全部喂假表（存在性注入）⇒ 不依赖真仓内容，除最后两条自证。 */
import { describe, expect, it } from "vitest";
import {
  HEAD_DANGLING_WAIVERS, checkHeadImportFace, collectHeadEdges, findDanglingImports, resolveRelativeSpec,
} from "../scripts/head-import-face";

const FILES = new Set(["src/a.ts", "src/tools/run_shell.ts", "src/util/index.ts", "tests/a.test.ts"]);
const noDisk = (): boolean => false;
const allDisk = (): boolean => true;

describe("resolveRelativeSpec：先要解析得对，才轮得到判悬空", () => {
  it("同目录、跨目录、带后缀三种写法都落到 HEAD 里那个文件", () => {
    expect(resolveRelativeSpec("src/a.ts", "./tools/run_shell", FILES)).toBe("src/tools/run_shell.ts");
    expect(resolveRelativeSpec("tests/a.test.ts", "../src/a", FILES)).toBe("src/a.ts");
    expect(resolveRelativeSpec("src/a.ts", "./tools/run_shell.ts", FILES)).toBe("src/tools/run_shell.ts");
  });

  it("`./x.js` 这种 ESM 写法指向的其实是 x.ts（第二版没做换后缀，凭空 40+ 条假红）", () => {
    expect(resolveRelativeSpec("src/a.ts", "./tools/run_shell.js", FILES)).toBe("src/tools/run_shell.ts");
  });

  it("目录形式落到 index.ts", () => {
    expect(resolveRelativeSpec("src/a.ts", "./util", FILES)).toBe("src/util/index.ts");
  });

  it("裸包名不是仓内边，一律不算（npm 包在 HEAD 文件表里本来就没有）", () => {
    expect(resolveRelativeSpec("src/a.ts", "vitest", FILES)).toBeNull();
    expect(resolveRelativeSpec("src/a.ts", "@electron/remote", FILES)).toBeNull();
  });
});

describe("findDanglingImports ＋ 豁免表", () => {
  it("解析不到的相对路径算悬空，并按引用者数排序（多的先看见）", () => {
    const d = findDanglingImports([
      { from: "src/a.ts", spec: "./missing" },
      { from: "src/tools/x.ts", spec: "../missing2" },
      { from: "src/b.ts", spec: "./missing" },
    ], FILES, noDisk);
    expect(d.map((x) => x.target)).toEqual(["src/missing.ts", "src/missing2.ts"]);
  });

  it("两态分开判：盘上有＝「漏 git add」，盘上也没有＝「引用写错/模块被删」", () => {
    const edges = [{ from: "src/a.ts", spec: "./missing" }];
    expect(findDanglingImports(edges, FILES, allDisk)[0]?.onDisk).toBe(true);
    expect(findDanglingImports(edges, FILES, noDisk)[0]?.onDisk).toBe(false);
    const f = checkHeadImportFace(findDanglingImports(edges, FILES, allDisk), {});
    expect(f[0]?.detail).toContain("漏 `git add`");
    const g = checkHeadImportFace(findDanglingImports(edges, FILES, noDisk), {});
    expect(g[0]?.detail).toContain("盘上也没有");
  });

  it("豁免是双向的：名单内不红；不再悬空则 stale 红（不许静默烂在表里）", () => {
    const edges = [{ from: "src/a.ts", spec: "./missing" }];
    const dang = findDanglingImports(edges, FILES, allDisk);
    expect(checkHeadImportFace(dang, { "src/missing.ts": "示例理由" })).toEqual([]);
    const stale = checkHeadImportFace([], { "src/missing.ts": "示例理由" });
    expect(stale.map((x) => x.kind)).toEqual(["stale-waiver"]);
  });

  it("同一文件指自己不算悬空（副作用式 `import \"./x\"` 会解析回自己）", () => {
    expect(findDanglingImports([{ from: "src/a.ts", spec: "./a" }], new Set(["src/a.ts"]), noDisk)).toEqual([]);
  });
});

describe("真表自证：这把尺不许是空载的，也不许对事故那笔失明", () => {
  it("取料面自证：HEAD 里文件数与 import 边数都在量级上（读空＝没尺，不判）", () => {
    const got = collectHeadEdges();
    expect(got).not.toBeNull();
    expect(got!.headFiles.size).toBeGreaterThan(300);
    expect(got!.edges.length).toBeGreaterThan(1500);
  });

  it("HEAD 现读：悬空集合必须**落在存量名单里**，且 finding 为 0（新增即红；名单里的补好了由 stale 那条逼人来删名）", () => {
    const got = collectHeadEdges();
    if (got === null) return; // 上一条已经红了
    const dang = findDanglingImports(got.edges, got.headFiles, () => true);
    for (const d of dang) expect(Object.keys(HEAD_DANGLING_WAIVERS)).toContain(d.target);
    expect(checkHeadImportFace(dang)).toEqual([]);
  });

  it("换 rev 也能跑（`--at` 的用面）：上一笔的取料结果与 HEAD 不是同一份常量", () => {
    const head = collectHeadEdges();
    const prev = collectHeadEdges("HEAD~1");
    expect(prev).not.toBeNull();
    expect(prev!.edges.length).toBeGreaterThan(1500);
    expect(head!.headFiles.size).toBeGreaterThanOrEqual(prev!.headFiles.size - 20);
  });

  it("存量每条必须带理由且点名是哪一页判的", () => {
    for (const [t, why] of Object.entries(HEAD_DANGLING_WAIVERS)) {
      expect(why.trim(), `${t} 缺理由`).not.toBe("");
      expect(why, `${t} 理由里没写出处`).toMatch(/第 \d+ 页/);
    }
  });
});
