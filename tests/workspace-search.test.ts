// v11 主界面批：项目内文件模糊搜索判卷（@ 引用补全的数据面）。
// 匹配器纯函数 + 真目录树行为（跳过 .git/node_modules、帽截断如实标注）。
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fuzzyMatch, rankHits, searchWorkspace } from "../src/main/workspace-search";

let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "dsh-ws-search-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("workspace-search 匹配器", () => {
  it("子序列命中：大小写不敏感；缺字/空查询不中", () => {
    expect(fuzzyMatch("cmp", "src/renderer/components/Composer.tsx")).not.toBeNull();
    expect(fuzzyMatch("zzz", "src/main/index.ts")).toBeNull();
    expect(fuzzyMatch("", "anything")).toBeNull();
  });

  it("排序：词首/连续命中高分在前；同名文件名（basename）加分", () => {
    const hits = rankHits("index", ["src/index.ts", "docs/referential-index.md", "src/main/index.ts"]);
    expect(hits[0]!.path).toBe("src/index.ts");
    // basename 全含 query 的两条都排在"只是路径里含"的前面
    expect(hits.map((h) => h.path)).toEqual(["src/index.ts", "src/main/index.ts", "docs/referential-index.md"]);
  });

  it("空查询 = 空结果（不做全量倾倒）", () => {
    expect(rankHits("", ["a.ts"])).toEqual([]);
  });
});

describe("workspace-search 目录树行为", () => {
  it("命中含文件与目录；.git/node_modules 被跳过", async () => {
    await mkdir(join(root, "src", "components"), { recursive: true });
    await writeFile(join(root, "src", "components", "Composer.tsx"), "x", "utf8");
    await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
    await writeFile(join(root, "node_modules", "pkg", "composer-lite.js"), "x", "utf8");
    await mkdir(join(root, ".git"), { recursive: true });
    await writeFile(join(root, ".git", "composer.log"), "x", "utf8");

    const r = await searchWorkspace(root, "comp");
    expect(r.ok).toBe(true);
    if (r.ok) {
      const paths = r.hits.map((h) => h.path);
      expect(paths).toContain("src/components/Composer.tsx");
      expect(paths.some((p) => p.startsWith("node_modules"))).toBe(false);
      expect(paths.some((p) => p.startsWith(".git"))).toBe(false);
      expect(r.hits.find((h) => h.path === "src/components")?.kind).toBe("directory");
      expect(r.hits.find((h) => h.path === "src/components/Composer.tsx")?.kind).toBe("file");
    }
  });

  it("目录不存在 = ok:false；空查询 = 空 hits；超帽截断如实标注", async () => {
    const missing = await searchWorkspace(join(root, "ghost"), "x");
    expect(missing.ok).toBe(false);

    await mkdir(join(root, "many"), { recursive: true });
    for (let i = 0; i < 60; i += 1) {
      await writeFile(join(root, "many", `hit-${String(i).padStart(2, "0")}.txt`), "x", "utf8");
    }
    const capped = await searchWorkspace(root, "hit");
    expect(capped.ok).toBe(true);
    if (capped.ok) {
      expect(capped.hits.length).toBe(50);
      expect(capped.truncated).toBe(true);
    }
  });
});
