/** 「判卷面的在飞取料」这把尺的判卷面（第 87 页）。
 *  两条要点各自有用例：① 取料**不许同源**——import 闭包与路径字面量是两把独立的尺；
 *  ② 空集**不许读成"确认没人垫"**——必须说"未记"并给出未记原因（规则 82）。 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { attributeInputs, importClosureOf, pathLiterals, repoPathIn } from "../scripts/lib/judge-input-face";
import type { Graph } from "../scripts/lib/reach-graph";

const ROOT = resolve(__dirname, "..");
const stubGraph = (edges: Record<string, string[]>): Graph => ({
  files: [...new Set(Object.keys(edges).flatMap((k) => [k, ...edges[k]!]))],
  edges: new Map(Object.entries(edges).map(([k, v]) => [k, { value: v, type: [] }])),
});

describe("repoPathIn / pathLiterals：认路径这一步先要认对", () => {
  it("真形状都能抽出，且 **`.json` 不会被交替截成 `.js`**（第 82 页那条教训的直接形状）", () => {
    const text = [
      'const tableText = read("scripts/mutate-verify.mjs");',
      'for (const known of ["src/agent/prune.ts", "src/tools/output-ring.ts"]) {}',
      'const t = read("tests/x.test.ts");',
      'readFileSync(join(ROOT, "package.json"), "utf8");',
      // 这条字面量**故意拼出来**而不是直写：D-3 判据会拦源码里的 `*.md:行号` 指针，
      // 而这里要测的正是"抽取时能剥掉行号尾巴"。
      "指针写成 \"" + "docs/CODE-WIKI.md" + ":" + "12" + "\" 也认（行号尾巴要能剥掉）",
      '`fixtures/mock/rounds.json`',
      '那面在 "AGENTS.md" 里也记过',
    ].join("\n");
    expect(pathLiterals(text)).toEqual([
      "AGENTS.md", "docs/CODE-WIKI.md", "fixtures/mock/rounds.json",
      "package.json", "scripts/mutate-verify.mjs", "src/agent/prune.ts",
      "src/tools/output-ring.ts", "tests/x.test.ts",
    ]);
  });

  // 边界（我第一版 fixture 就把这两条写成不带引号的，尺"没抽到"其实是设计）：
  // 这把尺只吃**代码里的字符串字面量**；散文里的 `file:行号` 指针归 D-3 那面判，各管各的层。
  it("不带引号的散文提及**不算**字面量——那是 D-3 指针判据的面，不在这把尺的取料层", () => {
    expect(pathLiterals("见 src/main/updater.ts:88 与 AGENTS.md 里那条")).toEqual([]);
  });

  it("不像仓内面的东西一律不抽：模块说明符、URL、带空格的句子、`@scope/pkg`", () => {
    const text = [
      'import { x } from "node:fs";',
      'import { y } from "./reach-graph";',
      'const u = "https://example.com/a.json";',
      'const s = "please read the file src/main/agent runner.ts now";',
      'const p = "@vitest/coverage-v8";',
      'const e = "";',
    ].join("\n");
    expect(pathLiterals(text)).toEqual([]);
  });

  it("仓内前缀白名单之外的扩展名命中也不算（`.worktrees/x/y.ts` 是别人的树）", () => {
    expect(repoPathIn(".worktrees/mut-full-0926/src/a.ts")).toBeNull();
    expect(repoPathIn("src/a.ts")).toBe("src/a.ts");
  });
});

describe("attributeInputs：两把尺分开标，空集说「未记」", () => {
  const g = stubGraph({ "tests/a.test.ts": ["src/impl.ts", "src/helper.ts"] });

  it("import 闭包命中在飞 ⇒ via 是 import（硬边）", () => {
    const r = attributeInputs("tests/a.test.ts", { graph: g, text: "", inFlight: new Set(["src/impl.ts"]) });
    expect(r.hits).toEqual([{ file: "src/impl.ts", via: "import 闭包" }]);
    expect(r.note).toContain("硬边");
  });

  it("两条尺同时命中同一文件 ⇒ 只留更强的那条（不许把一条依赖数成两条）", () => {
    const text = 'const t = read("src/impl.ts");';
    const r = attributeInputs("tests/a.test.ts", { graph: g, text, inFlight: new Set(["src/impl.ts"]) });
    expect(r.hits.map((h) => h.via)).toEqual(["import 闭包"]);
  });

  it("只有文本指针命中 ⇒ 必须标成提示级、要人工复判（规则 177）", () => {
    const text = 'const table = read("scripts/mutate-verify.mjs");';
    const r = attributeInputs("tests/a.test.ts", { graph: g, text, inFlight: new Set(["scripts/mutate-verify.mjs"]) });
    expect(r.hits.map((h) => h.file)).toEqual(["scripts/mutate-verify.mjs"]);
    // 收**整条 `via`**，不收 `note` 里的短片段：「提示级」这三个字在 `via` 与 `note` 两处都有（顶包候选），
    // 改另一处它照样绿；而"这一格凭什么算提示级"的真相就是那条 `via`（结构字段，不是措辞）。
    expect(r.hits.map((h) => h.via)).toEqual(["路径字面量（提示级，不是证明）"]);
  });

  it("两把尺都没命中 ⇒ 不许读成「确认没人垫」", () => {
    const r = attributeInputs("tests/a.test.ts", { graph: g, text: "没有路径", inFlight: new Set(["src/unrelated.ts"]) });
    expect(r.hits).toEqual([]);
    // 整句前缀逐字比，不 `toContain("未记")`：那两个字在本仓有 4 处副本（规则 183：两把尺不许同源）。
    expect(r.note.startsWith("**取料面未记**＝没查到在飞依赖，不等于确认没人垫")).toBe(true);
  });

  it("该文件根本不在 import 图里 ⇒ 未记原因要点名这条（`.mts` 读数脚本就是这种）", () => {
    const r = attributeInputs("outputs/x/01-scan.mts", { graph: g, text: "", inFlight: new Set(["src/impl.ts"]) });
    expect(r.hits).toEqual([]);
    expect(r.note).toContain("不在 import 图里");
  });

  it("importClosureOf：图里没有的返回 null 而不是空数组（空数组会被读成「查过，没有」）", () => {
    expect(importClosureOf("outputs/x/y.mts", g)).toBeNull();
    expect(importClosureOf("tests/a.test.ts", g)).toContain("src/helper.ts");
  });
});

describe("活例负控：这把尺不许是空载的", () => {
  it("第 86 页那条真红：`tests/mutate-verify-gates.test.ts` 的字面量必须点出 `scripts/mutate-verify.mjs`", () => {
    /* 2026-10-17 拆表后，`mutate-anchor-titles.test.ts` 不再点名母脚本（表文本改走 `mutation-table`），
       这条活例负控换成仍然**真读母脚本壳**的那份判卷——它仍是「判卷把生产脚本当输入」的真样本。
       `inFlight` 只放一条 ⇒ 多出来的路径字面量不会进 hits，`toEqual` 的严格性不降。 */
    const text = readFileSync(resolve(ROOT, "tests/mutate-verify-gates.test.ts"), "utf8");
    expect(pathLiterals(text)).toContain("scripts/mutate-verify.mjs");
    const r = attributeInputs("tests/mutate-verify-gates.test.ts", {
      graph: stubGraph({}),
      text,
      inFlight: new Set(["scripts/mutate-verify.mjs"]),
    });
    expect(r.hits.map((h) => h.file)).toEqual(["scripts/mutate-verify.mjs"]);
  });
});
