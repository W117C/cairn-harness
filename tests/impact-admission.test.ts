/* B1 语义合并闸：把 M7 的影响面从「回注给模型看的提示」升级成 spawn 准入判据。
   靶子 = fixtures/impact/mini-repo（已知调用图，判卷文件）；测试只在临时副本上跑，绝不改冻结件。 */
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { affectedFilesOf, globMatchesPath } from "../src/agent/impact/index";
import { globIntersects, semanticConflictsVia } from "../src/agent/orchestrator";

const MINI = fileURLToPath(new URL("../fixtures/impact/mini-repo", import.meta.url));
let ws = "";
let cache = "";

beforeAll(async () => {
  const root = await mkdtemp(join(tmpdir(), "impact-adm-"));
  ws = join(root, "repo");
  cache = join(root, "cache");
  await cp(MINI, ws, { recursive: true });
});
afterEach(async () => { /* 每个 it 独立目录由 beforeAll 共享；结束统一清理 */ });

describe("globMatchesPath（波及闭包的入面）", () => {
  it("** 跨目录、* 段内、? 单字符，正则元字符按字面处理", () => {
    expect(globMatchesPath("src/**", "src/a.ts")).toBe(true);
    expect(globMatchesPath("src/**", "src/x/y.ts")).toBe(true);
    expect(globMatchesPath("**/y.ts", "src/x/y.ts")).toBe(true);
    expect(globMatchesPath("src/*.ts", "src/x/y.ts")).toBe(false);
    expect(globMatchesPath("src/?.ts", "src/ab.ts")).toBe(false);
    expect(globMatchesPath("src/a+b.ts", "src/a+b.ts")).toBe(true); // "+" 不是量词
    expect(globMatchesPath("src/*.ts", "src/ax.tsx")).toBe(false); // 锚定整串，不做子串
  });
});

describe("affectedFilesOf：声明要写哪些 glob ⇒ 实际波及哪些文件", () => {
  it("改 utils.js 会波及它的两个调用方（含自身）", async () => {
    expect(await affectedFilesOf(ws, ["utils.js"], cache)).toEqual(["app.js", "math.js", "utils.js"]);
  });

  it("叶子文件（无人调用）只波及自身；不匹配的 glob 返回空集", async () => {
    expect(await affectedFilesOf(ws, ["metrics.ts"], cache)).toEqual(["metrics.ts"]);
    expect(await affectedFilesOf(ws, ["nope/**"], cache)).toEqual([]);
    expect(await affectedFilesOf(ws, [], cache)).toEqual([]);
  });

  it("目录 glob 把整个子树的波及并进来", async () => {
    const all = await affectedFilesOf(ws, ["**"], cache);
    expect(all).toEqual(["app.js", "math.js", "metrics.ts", "utils.js"]);
  });
});

/* 这就是 B1 的立论：glob 判据看不见语义耦合——两个 worker 各改各的文件，
   但都被 math.js 牵连，合并时照样打架。同一份 impact 数据第二次变现。 */
describe("B1 与 glob 判据的差集（准入升级的实测证据）", () => {
  const hook = (globs: string[]): Promise<string[]> => affectedFilesOf(ws, globs, cache);

  it("utils.js × math.js：glob 不相交，波及集相交 ⇒ 语义闸报冲突", async () => {
    expect(globIntersects("utils.js", "math.js")).toBe(false); // 旧判据：放行并行
    const conflicts = await semanticConflictsVia(hook, ["utils.js"], [{ agentId: "w-2", resources: ["math.js"] }]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.agentId).toBe("w-2");
    expect(conflicts[0]?.resource).toContain("math.js"); // 共同被波及的那个文件
  });

  it("utils.js × metrics.ts：闭包也不相交 ⇒ 不误伤（并行照放）", async () => {
    expect(await semanticConflictsVia(hook, ["utils.js"], [{ agentId: "w-3", resources: ["metrics.ts"] }])).toEqual([]);
  });
});

describe("semanticConflictsVia 的四条边界", () => {
  const fake = (map: Record<string, string[]>) => async (globs: string[]): Promise<string[]> =>
    globs.flatMap((g) => map[g] ?? []);

  it("未接钩子 / 无声明 / 无活跃 worker ⇒ []（既有 spawn 路径零行为）", async () => {
    const w = [{ agentId: "w-1", resources: ["b.ts"] }];
    expect(await semanticConflictsVia(undefined, ["a.ts"], w)).toEqual([]);
    expect(await semanticConflictsVia(async () => ["a.ts"], [], w)).toEqual([]);
    expect(await semanticConflictsVia(async () => ["a.ts"], ["a.ts"], [])).toEqual([]);
  });

  it("波及集为空 ⇒ 不报（宁漏不误伤）", async () => {
    expect(await semanticConflictsVia(async () => [], ["a.ts"], [{ agentId: "w", resources: ["b.ts"] }])).toEqual([]);
  });

  it("钩子抛错 ⇒ 降级为不报（额外探测器不得炸 spawn），每个 worker 只算一次", async () => {
    let calls = 0;
    const boom = async (globs: string[]): Promise<string[]> => { calls++; throw new Error("grammar unavailable: " + globs.length); };
    const warn = console.warn; console.warn = () => {};
    try {
      expect(await semanticConflictsVia(boom, ["a.ts"], [{ agentId: "w", resources: ["b.ts"] }])).toEqual([]);
    } finally { console.warn = warn; }
    expect(calls).toBe(1); // 自己的闭包失败即止，不再逐 worker 白试
  });

  it("每个冲突最多列 6 个共同文件（审批卡给人看，全量在 impact_report 事件里）", async () => {
    const many = Array.from({ length: 9 }, (_, i) => "f" + String(i) + ".ts");
    const conflicts = await semanticConflictsVia(fake({ "a.ts": many, "b.ts": many }), ["a.ts"], [{ agentId: "w", resources: ["b.ts"] }]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.resource.split("、")).toHaveLength(6);
  });
});
