// 架构环判据的判卷（第 338 页，任务 A6）。
// 形状约定（本仓老规矩）：判据本体是纯函数，这里只喂合成输入；真仓那条圈由 CLI 现读，
// 而 CLI 有顶层 await ⇒ **绝不 import 它**（`gates.ts` 那一格的老教训：一 import 就把整把尺跑一遍）。
// 每条断言都要问「生产行变了它会不会红」——分辨力证人按状态枚举，两向各一条（规则 411）。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  adjacencyOf,
  classifyCycles,
  cycleFindings,
  cycleMembersLabel,
  cycleSummary,
  stronglyConnectedComponents,
} from "../scripts/lib/arch-cycles.js";
import { RUNTIME_CYCLE_DEBT } from "../scripts/lib/arch-cycle-debt.js";

const cliSrc = readFileSync(fileURLToPath(new URL("../scripts/arch-cycle-check.ts", import.meta.url)), "utf8");
const debtSrc = readFileSync(fileURLToPath(new URL("../scripts/lib/arch-cycle-debt.ts", import.meta.url)), "utf8");

describe("adjacencyOf：边的规范化", () => {
  it("自环结构性丢弃（自己 import 自己不该被当成圈）", () => {
    const adj = adjacencyOf([["a.ts", "a.ts"], ["a.ts", "b.ts"]]);
    expect([...(adj.get("a.ts") ?? [])]).toEqual(["b.ts"]);
  });
  it("方向保留：a→b 不给 b 出边", () => {
    const adj = adjacencyOf([["a.ts", "b.ts"]]);
    expect(adj.get("b.ts")).toBeUndefined();
  });
  it("同一条边重复出现只算一条", () => {
    const adj = adjacencyOf([["a.ts", "b.ts"], ["a.ts", "b.ts"]]);
    expect([...(adj.get("a.ts") ?? [])]).toEqual(["b.ts"]);
  });
});

describe("stronglyConnectedComponents：只把「互相可达」算成圈", () => {
  it("两文件互 import ⇒ 一条圈，成员字典序", () => {
    const adj = adjacencyOf([["a.ts", "b.ts"], ["b.ts", "a.ts"]]);
    const found = stronglyConnectedComponents(["a.ts", "b.ts"], adj);
    expect(found).toEqual([["a.ts", "b.ts"]]);
  });
  it("链式单向依赖 ⇒ 零圈（这条红了就说明我把可达性当成了环）", () => {
    const adj = adjacencyOf([["a.ts", "b.ts"], ["b.ts", "c.ts"]]);
    expect(stronglyConnectedComponents(["a.ts", "b.ts", "c.ts"], adj)).toEqual([]);
  });
  it("圈外挂的节点不被卷进成员", () => {
    const adj = adjacencyOf([
      ["a.ts", "b.ts"], ["b.ts", "a.ts"], ["a.ts", "c.ts"], ["c.ts", "d.ts"],
    ]);
    expect(stronglyConnectedComponents(["a.ts", "b.ts", "c.ts", "d.ts"], adj)).toEqual([["a.ts", "b.ts"]]);
  });
  it("三个节点串成真圈 ⇒ 一整条，成员三个（不许拆成两两）", () => {
    const adj = adjacencyOf([["a.ts", "b.ts"], ["b.ts", "c.ts"], ["c.ts", "a.ts"]]);
    expect(stronglyConnectedComponents(["a.ts", "b.ts", "c.ts"], adj)).toEqual([["a.ts", "b.ts", "c.ts"]]);
  });
  it("两个互不相干的圈各数一条", () => {
    const adj = adjacencyOf([["a.ts", "b.ts"], ["b.ts", "a.ts"], ["c.ts", "d.ts"], ["d.ts", "c.ts"]]);
    expect(stronglyConnectedComponents(["a.ts", "b.ts", "c.ts", "d.ts"], adj)).toEqual([["a.ts", "b.ts"], ["c.ts", "d.ts"]]);
  });
  it("同图不同边序 ⇒ 读数逐字相同（登记表要比对，非确定性就是假漂）", () => {
    const edges = [["a.ts", "b.ts"], ["b.ts", "c.ts"], ["c.ts", "a.ts"], ["d.ts", "a.ts"]] as const;
    const one = stronglyConnectedComponents(["a.ts", "b.ts", "c.ts", "d.ts"], adjacencyOf(edges));
    const two = stronglyConnectedComponents(["d.ts", "c.ts", "b.ts", "a.ts"], adjacencyOf([...edges].reverse()));
    expect(two).toEqual(one);
  });
  it("深链不吃递归栈：造 600 个节点的长链不抛（迭代版的理由）", () => {
    const n = 600;
    const names = Array.from({ length: n }, (_, i) => `f${String(i).padStart(3, "0")}.ts`);
    const edges: [string, string][] = names.slice(1).map((name, i) => [names[i]!, name]);
    edges.push([names[n - 1]!, names[0]!]);
    const found = stronglyConnectedComponents(names, adjacencyOf(edges));
    expect(found.length).toBe(1);
    expect(found[0]!.length).toBe(n);
  });
});

describe("classifyCycles：三态各配「有它出声／没它闭嘴」（规则 411）", () => {
  const cycA = ["a.ts", "b.ts"];
  const debt = [cycA];

  it("盘上与登记一致 ⇒ allowed，且不出任何红", () => {
    const v = classifyCycles([cycA], debt);
    expect(v.allowed).toEqual([cycA]);
    expect(v.fresh).toEqual([]);
    expect(v.stale).toEqual([]);
    expect(cycleFindings(v)).toEqual([]);
  });
  it("登记了而盘上没这条圈 ⇒ stale 红（登记表不许空转）", () => {
    const v = classifyCycles([], debt);
    expect(v.stale).toEqual(["a.ts → b.ts"]);
    expect(cycleFindings(v).map((f) => f.detail)).toEqual([expect.stringContaining("已不在盘上")]);
  });
  it("盘上有新圈 ⇒ fresh 红，且 detail 里点名成员与出口建议", () => {
    const v = classifyCycles([["x.ts", "y.ts"]], []);
    expect(v.fresh).toEqual([["x.ts", "y.ts"]]);
    // 成员串用生产那把拼法（cycleMembersLabel）算，不抄整句：抄进断言＝同一句活两处，改渲染要动两处，
    // 而 prose-needle-scan 会把这一格报成顶包候选（第 342 页就是被这条帽撞红的）。
    expect(cycleFindings(v)[0]?.detail).toContain(cycleMembersLabel(["x.ts", "y.ts"]));
    expect(cycleFindings(v)[0]?.detail).toContain("TDZ");
  });
  it("债与新圈同场 ⇒ 各归各，不互相吞（并集读数不能当「每一处都成立」的证人）", () => {
    const v = classifyCycles([cycA, ["x.ts", "y.ts"]], debt);
    expect(v.allowed).toEqual([cycA]);
    expect(v.fresh).toEqual([["x.ts", "y.ts"]]);
    expect(v.stale).toEqual([]);
    expect(cycleFindings(v).length).toBe(1);
  });
  it("成员顺序不同视为同一条圈（登记表按字典序规范化）", () => {
    const v = classifyCycles([["b.ts", "a.ts"]], debt);
    expect(v.allowed).toEqual([["b.ts", "a.ts"]]);
    expect(v.fresh).toEqual([]);
    expect(v.stale).toEqual([]);
  });
  it("空图喂空登记 ⇒ 三态全空（对全部输入同答那一格：尺没瞎）", () => {
    const v = classifyCycles([], []);
    expect([v.allowed.length, v.fresh.length, v.stale.length]).toEqual([0, 0, 0]);
    expect(cycleFindings(v)).toEqual([]);
  });
  it("汇总行三态相加＝分母，且登记面单独印", () => {
    const v = classifyCycles([cycA, ["x.ts", "y.ts"], ["p.ts", "q.ts"]], debt);
    expect(cycleSummary(v)).toBe("环对账：圈 3 条 —— 登记债 1，新圈 2，登记已失效 0｜登记面 1 条");
    expect(1 + 2 + 0).toBe(v.total);
  });
});

describe("登记表本体：它是数据，也要有判据", () => {
  it("每条债都 ≥2 个成员、已按字典序规范化（不规范化就与 found 对不上 ⇒ 假 fresh 红）", () => {
    for (const c of RUNTIME_CYCLE_DEBT) {
      expect(c.length).toBeGreaterThanOrEqual(2);
      expect([...c].sort()).toEqual(c);
    }
  });
  it("每条债的成员都是仓里真实存在的路径（改名删文件要当场看见，而不是等 stale）", () => {
    for (const c of RUNTIME_CYCLE_DEBT) {
      for (const rel of c) {
        expect(() => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)))).not.toThrow();
      }
    }
  });
  it("登记面非空时至少带一处页号出处（无出处的登记＝不知道什么时候可以删）", () => {
    if (RUNTIME_CYCLE_DEBT.length === 0) return;
    expect(debtSrc).toMatch(/第 \d+ 页/);
  });
  it("今天这条债就是技术审查 A6 那一条（五支、含 write-face 回到 session-provider 的收口）", () => {
    const A6 = ["src/agent/session-provider.ts", "src/agent/memory/inject.ts", "src/agent/memory/lessons.ts", "src/agent/worker-shell-tools.ts", "src/agent/write-face.ts"];
    // 按规范化后的字符串比：数组实参在 toContain 里是引用相等，那样写这条永远红（尺没错，是我拿错比较器）。
    expect(RUNTIME_CYCLE_DEBT.map((c) => [...c].sort().join(" → "))).toContain(A6.join(" → "));
  });
});

describe("CLI 的接线（不 import 有顶层 await 的那支，改用读源文）", () => {
  it("取料吃地图自己的扫描面与解析器，不是第二份 import 正则", () => {
    expect(cliSrc).toMatch(/\n\s*const scanned = await scanSourceFilesAll\(ROOT\);/u);
    expect(cliSrc).toMatch(/symbols = await fileSymbols\(src, ext\)/u);
    expect(cliSrc).toMatch(/const target = resolveModuleSpecifier\(f\.rel, ir\.spec, known\);/u);
    expect(cliSrc).not.toMatch(/const IMPORT_RE\s*=/u);
  });
  it("类型边单独跳过并计数（A6 的假圈就是这一档：并进同一张图会多 4 个圈）", () => {
    expect(cliSrc).toMatch(/if \(ir\.typeOnly\) \{ typeOnlySkipped\+\+; continue; \}/u);
    expect(cliSrc).toMatch(/类型边跳过 \$\{String\(typeOnlySkipped\)\}/u);
  });
  it("不调用 buildGraph 数圈（那张 adj 混着同名全连的兜底边）", () => {
    // 判的是「有没有被调用」，不是「有没有出现这个词」——CLI 的注释里正要写清为什么不用它，
    // 拿词面当判据会把解释自己行为的说明读成缺陷（规则 253 那一族：改给人看的读数先查谁在用它）。
    expect(cliSrc).not.toMatch(/buildGraph\s*\(/u);
    expect(cliSrc).not.toMatch(/from "\.\/\.\.\/src\/agent\/map\/rank\.js"/u);
  });
  it("三态都接进汇总与退出码：新圈或假存量 ⇒ 退 1，全对上 ⇒ 退 0", () => {
    expect(cliSrc).toMatch(/const verdict = classifyCycles\(found, RUNTIME_CYCLE_DEBT\);/u);
    expect(cliSrc).toMatch(/const findings = cycleFindings\(verdict\);/u);
    expect(cliSrc).toMatch(/process\.exit\(findings\.length === 0 \? 0 : 1\);/u);
  });
  it("grammar 不可用走「未检」那一档（退 2，不许读成通过）", () => {
    expect(cliSrc).toMatch(/grammarBroken = true/u);
    expect(cliSrc).toMatch(/整条未检，不等于通过/u);
    expect(cliSrc).toMatch(/process\.exit\(2\);/u);
  });
  it("CLI 从 lib 取登记表（自己内联一份就有第二张表，判卷对不上盘）", () => {
    expect(cliSrc).toMatch(/import \{ RUNTIME_CYCLE_DEBT \} from "\.\/lib\/arch-cycle-debt\.js";/u);
  });
});
