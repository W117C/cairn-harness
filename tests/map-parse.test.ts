// M2b 任务 1 验收（解析层）：四语言各抽到至少一个 def 与一个 ref；语法错误文件不抛、返回空 tags。
import { describe, expect, it } from "vitest";
import { fileTags, __resetLangCache, __resetQueryCache, __setWts } from "../src/agent/map/parse.js";

const SAMPLES: { ext: string; src: string }[] = [
  {
    ext: "ts",
    src: `export function computeTotal(items: string[]): number { return items.length; }\nclass Repo { save() { return 1; } }\nconst helper = computeTotal;\ncomputeTotal([]);`,
  },
  {
    ext: "tsx",
    src: `export function Badge(props: { label: string }) { return null; }\nconst other = Badge;\nBadge({ label: "x" });`,
  },
  {
    ext: "js",
    src: `function main() { helper(); }\nfunction helper() {}\nmain();`,
  },
  {
    ext: "py",
    src: `def run_job(name):\n    return helper(name)\n\ndef helper(x):\n    return x\n\nrun_job("a")`,
  },
];

describe("map parse（任务 1）", () => {
  it("四语言各抽到至少一个 def 与一个 ref", async () => {
    for (const s of SAMPLES) {
      const tags = await fileTags(s.src, s.ext);
      expect(tags.some((t) => t.kind === "def"), `${s.ext} 应有 def`).toBe(true);
      expect(tags.some((t) => t.kind === "ref"), `${s.ext} 应有 ref`).toBe(true);
      expect(tags.every((t) => Number.isInteger(t.line) && t.line >= 1), "行号 1-based").toBe(true);
      expect(tags.every((t) => t.name.length > 0), "名字非空").toBe(true);
    }
  });

  it("语法错误文件不抛、返回空 tags；坏扩展名不抛；grammar 加载失败向上抛（build 层降级）", async () => {
    const broken = "function {{{ nope";
    await expect(fileTags(broken, "ts")).resolves.toEqual([]);
    // 不认识的后缀 → 空
    await expect(fileTags("anything", "rs")).resolves.toEqual([]);
    // grammar 加载失败 → 抛（由 buildMap 捕获并静默降级为空地图）
    __resetLangCache();
    __resetQueryCache();
    __setWts({
      Parser: Object.assign(function () { throw new Error("boom"); }, { init: () => Promise.resolve() }),
      Language: { load: () => Promise.reject(new Error("bad grammar")) },
      Query: class {},
    } as never);
    await expect(fileTags("function ok() {}", "ts")).rejects.toThrow("bad grammar");
    __setWts(null);
    __resetLangCache();
    __resetQueryCache();
  });

  it("行号指向声明/引用所在行（1-based）", async () => {
    const src = [
      "a = 1",
      "",
      "def target():",
      "    pass",
      "",
      "target()",
    ].join("\n");
    const tags = await fileTags(src, "py");
    const def = tags.find((t) => t.kind === "def" && t.name === "target");
    const ref = tags.find((t) => t.kind === "ref" && t.name === "target");
    expect(def?.line).toBe(3);
    expect(ref?.line).toBe(6);
  });
});
