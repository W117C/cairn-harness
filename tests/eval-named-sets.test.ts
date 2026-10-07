/* 逐名判卷的**读者**（第 416 页补的下半截）。
 *
 * 前两笔各落了半件事：第 414 页落 `src/agent/eval/test-results.ts`（解析＋裁决，零 IO），
 * 第 415 页让 `task-set.ts` 的 SWE-bench 路径**产出** `TaskSpec.judge`。缺的是中间那位读者 ⇒
 * 于是「机制在、生产零流量」：`judge` 仍然是一条没人读的字段，评测面照旧只印退出码，
 * 「没修好」与「修坏了别的」继续在同一枚 1 上同形。本簇量的就是那位读者**真的在读、而且分得开两态**。
 *
 * 三种能力，每种都配反向证人（本仓成文：「A＝B」型断言旁边必须有「A≠旧值」，否则那条等式恒真）：
 *  ⑴ 同一枚退出码、两种逐名结局 ⇒ 新读数**不同**；
 *  ⑵ 只看退出码的那枚旧读数（跑器拿它当 `verifyOkLast`）在两份输入下**同值**
 *     ——证明新增的是第二格，不是把旧格子换了面；而旧读数仍能分绿／红，那三条等式不是恒真；
 *  ⑶ 逐名全对上但派生不完整 ⇒ **不许算过**（第三态有单独出口，拦路谓词非空）。
 * 取料与裁决一律走生产侧（`parseTestResults`＋`judgeNamedSets`；`lib/eval-named-sets` 只做
 * 「一拍 N 条命令」的编排）；逐名规格本身也从 `fromSweBenchJsonl` 真读出来，不在这里手抄 id 清单。
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { namedSetFailReason, readNamedSets, type NamedSetCommandResult } from "../scripts/lib/eval-named-sets";
import { fromSweBenchJsonl, type TaskSpec } from "../src/agent/eval/task-set";
import type { NamedSets } from "../src/agent/eval/test-results";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const runnerSrc = (): string => readFileSync(join(ROOT, "scripts/loop-eval.ts"), "utf8");
const libSrc = (): string => readFileSync(join(ROOT, "scripts/lib/eval-named-sets.ts"), "utf8");

/* ── 合成料：pytest（SWE-bench 的判卷就是它），两份结局只差在「哪一枚 id 是红的」──────────── */

const SPEC: NamedSets = {
  failToPass: ["sympy/core/tests/test_pow.py::test_pow_negative"],
  passToPass: ["sympy/core/tests/test_pow.py::test_add", "sympy/core/tests/test_pow.py::test_mul"],
};
const ALL_IDS = [...SPEC.failToPass, ...SPEC.passToPass];

/** 一份**派生完整**的 pytest 原文：verbose 行＋`-rA` 短汇总＋结尾那行。
 *  结尾那行只写非零的桶（与真 pytest 同形）——写了 `0 failed` 就等于声称「这一桶提过且为 0」，
 *  那是合成料自己造的差异，不是被度量面的。 */
const pytestReport = (rows: { id: string; status: "PASSED" | "FAILED" }[]): string => {
  const failed = rows.filter((r) => r.status === "FAILED").length;
  const passed = rows.length - failed;
  const trailer = [failed > 0 ? `${String(failed)} failed` : "", passed > 0 ? `${String(passed)} passed` : ""]
    .filter((x) => x !== "").join(", ");
  return [
    "============================= test session starts ==============================",
    `collected ${String(rows.length)} items`,
    "",
    ...rows.map((r, i) => `${r.id} ${r.status}  [${String(Math.round(((i + 1) / rows.length) * 100))}%]`),
    "",
    "=========================== short test summary info ============================",
    ...rows.filter((r) => r.status === "FAILED").map((r) => `FAILED ${r.id} - AssertionError: expected 1 to be 2`),
    `============================== ${trailer} in 0.12s ==============================`,
  ].join("\n");
};

const GREEN = pytestReport(ALL_IDS.map((id) => ({ id, status: "PASSED" as const })));
/** 结局一：该转绿的那枚没绿（其余全绿）。 */
const F2P_RED = pytestReport(ALL_IDS.map((id) => ({ id, status: id === SPEC.failToPass[0] ? "FAILED" : "PASSED" })));
/** 结局二：该保住的那枚坏了（FAIL_TO_PASS 绿了）。 */
const P2P_RED = pytestReport(ALL_IDS.map((id) => ({ id, status: id === SPEC.passToPass[1] ? "FAILED" : "PASSED" })));

/** 一次 verify 拍的取料面（跑器递进来的就是 `verify_result.results[]` 那几枚字段）。 */
const resultsOf = (output: string): NamedSetCommandResult[] => [{ command: "python -m pytest -rA …", output }];
/** 旧读数那一面：退出码 → `verify_result.ok`（跑器把它当 `verifyOkLast` 用）。
 *  它只知道「这一拍有没有非零」，**不知道是哪一枚 id**——那正是这一簇要分开的东西。 */
const exitCodeOf = (output: string): number => (output.split("\n").some((l) => l.startsWith("FAILED")) ? 1 : 0);
const oldOkOf = (output: string): boolean => exitCodeOf(output) === 0;

describe("同一枚退出码、两种逐名结局（这一簇的命根子）", () => {
  it("旧读数（退出码那一枚）在两份输入下**同值**，且它仍能分绿／红（等式不是恒真）", () => {
    expect(exitCodeOf(F2P_RED)).toBe(exitCodeOf(P2P_RED));
    expect(oldOkOf(F2P_RED)).toBe(false);
    expect(oldOkOf(P2P_RED)).toBe(false);
    expect(oldOkOf(F2P_RED)).toBe(oldOkOf(P2P_RED));
    // A≠旧值的另一半：绿的那份旧读数是 true ⇒ 上面那三条同值不是「永远 false」造成的。
    expect(oldOkOf(GREEN)).toBe(true);
  });

  it("逐名面把「该转绿的没绿」与「该保住的坏了」分列成两个**不同**读数", () => {
    const a = readNamedSets(resultsOf(F2P_RED), SPEC);
    const b = readNamedSets(resultsOf(P2P_RED), SPEC);
    expect(a?.state).toBe("fail");
    expect(b?.state).toBe("fail");
    expect(a?.notGreen).toEqual([...SPEC.failToPass]);
    expect(a?.broken).toEqual([]);
    expect(b?.notGreen).toEqual([]);
    expect(b?.broken).toEqual([SPEC.passToPass[1]]);
    expect(a?.unmatched).toEqual([]);
    expect(b?.unmatched).toEqual([]);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
    expect(a?.sources[0]?.format).toBe("pytest");
    expect(a?.sources[0]?.complete).toBe(true);
    // 拦路谓词也给出两句不同的话（措辞归 lib，这里只判「不同／非空」与点到的那枚 id，不抄生产文案）。
    const whyA = namedSetFailReason(a);
    const whyB = namedSetFailReason(b);
    expect(whyA).not.toBeNull();
    expect(whyB).not.toBeNull();
    expect(whyA).not.toBe(whyB);
    expect(whyA).toContain(SPEC.failToPass[0]);
    expect(whyB).toContain(SPEC.passToPass[1]);
  });

  it("全绿的一份 ⇒ pass 且拦路谓词为 null（上面两条不是恒红）", () => {
    const g = readNamedSets(resultsOf(GREEN), SPEC);
    expect(g?.state).toBe("pass");
    expect(g?.notGreen).toEqual([]);
    expect(g?.broken).toEqual([]);
    expect(namedSetFailReason(g)).toBeNull();
  });

  it("没给规格 ⇒ 交 undefined（无面），拦路谓词一条都不加：内建四格的 fails 逐字不变", () => {
    expect(readNamedSets(resultsOf(F2P_RED), undefined)).toBeUndefined();
    expect(namedSetFailReason(undefined)).toBeNull();
    // A≠旧值：给了规格的那一份当场有读数（否则上面那两条 undefined 是恒真）。
    expect(readNamedSets(resultsOf(F2P_RED), SPEC)?.state).toBe("fail");
  });
});

describe("派生完整性与名字口径：第三态有单独出口", () => {
  it("逐名全对上、结尾那行汇总没了 ⇒ unreadable，且不许算过", () => {
    const incomplete = GREEN.split("\n").slice(0, -1).join("\n");
    const r = readNamedSets(resultsOf(incomplete), SPEC);
    expect(r?.state).toBe("unreadable");
    expect(r?.notGreen).toEqual([]);
    expect(r?.broken).toEqual([]);
    expect(r?.unmatched).toEqual([]);
    expect(namedSetFailReason(r)).not.toBeNull();
    // 取料面自己要说清是哪条文没读全（而不是只留一个第三态让人猜）。
    expect(r?.sources[0]?.complete).toBe(false);
    expect(r?.sources[0]?.tests).toBe(ALL_IDS.length);
  });

  it("补回那行汇总 ⇒ pass（差别只在派生完整，不在读到几条）", () => {
    const r = readNamedSets(resultsOf(GREEN), SPEC);
    expect(r?.state).toBe("pass");
    expect(r?.sources[0]?.tests).toBe(ALL_IDS.length);
  });

  it("规格里的名字在任何逐名结果里都对不上 ⇒ unreadable 并逐条点名，绝不算成绿", () => {
    const other = pytestReport(["tests/other.py::test_a", "tests/other.py::test_b"].map((id) => ({ id, status: "PASSED" as const })));
    const r = readNamedSets(resultsOf(other), SPEC);
    expect(r?.state).toBe("unreadable");
    expect([...(r?.unmatched ?? [])].sort()).toEqual([...ALL_IDS].sort());
    expect(namedSetFailReason(r)).not.toBeNull();
  });

  it("读到的红优先于没读全：截断的原文里有确证红 ⇒ 仍是 fail，不被第三态盖掉", () => {
    const truncated = F2P_RED.split("\n").slice(0, -1).join("\n");
    const r = readNamedSets(resultsOf(truncated), SPEC);
    expect(r?.state).toBe("fail");
    expect(r?.notGreen).toEqual([...SPEC.failToPass]);
    expect(r?.sources[0]?.complete).toBe(false);
  });
});

describe("一次 verify 拍里有 N 条命令时的取料编排", () => {
  it("没接住测试名的命令（lint／噪音）不参与裁决，也不抹掉那条红", () => {
    const beat: NamedSetCommandResult[] = [
      { command: "pnpm run lint", output: "> eslint src\nall good\n" },
      { command: "python -m pytest -rA …", output: F2P_RED },
    ];
    const r = readNamedSets(beat, SPEC);
    expect(r?.state).toBe("fail");
    expect(r?.notGreen).toEqual([...SPEC.failToPass]);
    expect(r?.sources.map((s) => s.carried)).toEqual([false, true]);
    expect(r?.sources[0]?.tests).toBe(0);
    // 反向证人：把那条噪音折进裁决就会退化成「恒不可读」——这里必须是 fail 而不是 unreadable。
    expect(r?.state).not.toBe("unreadable");
  });

  it("两半规格分居两条命令 ⇒ 并起来才判得全（单看任何一条都剩 unmatched）", () => {
    const beat: NamedSetCommandResult[] = [
      { command: "pytest f2p", output: pytestReport([{ id: SPEC.failToPass[0], status: "PASSED" }]) },
      { command: "pytest p2p", output: pytestReport(SPEC.passToPass.map((id) => ({ id, status: "PASSED" as const }))) },
    ];
    const merged = readNamedSets(beat, SPEC);
    expect(merged?.state).toBe("pass");
    expect(merged?.unmatched).toEqual([]);
    expect(merged?.sources.filter((s) => s.carried)).toHaveLength(2);
    // A≠旧值：单看第一条确实判不全（p2p 那两枚没料）——并起来才 pass，说明编排不是装饰。
    expect(readNamedSets([beat[0]], SPEC)?.unmatched).toEqual([...SPEC.passToPass]);
  });

  it("坏的那半分居两条命令时也分列：broken 只在它出现的那条里", () => {
    const beat: NamedSetCommandResult[] = [
      { command: "pytest f2p", output: pytestReport([{ id: SPEC.failToPass[0], status: "PASSED" }]) },
      {
        command: "pytest p2p",
        output: pytestReport(SPEC.passToPass.map((id) => ({ id, status: id === SPEC.passToPass[1] ? "FAILED" : "PASSED" }))),
      },
    ];
    const r = readNamedSets(beat, SPEC);
    expect(r?.state).toBe("fail");
    expect(r?.broken).toEqual([SPEC.passToPass[1]]);
    expect(r?.notGreen).toEqual([]);
  });

  it("这一拍一条命令结果都没有 ⇒ unreadable 并说清是「没有料」", () => {
    const r = readNamedSets([], SPEC);
    expect(r?.state).toBe("unreadable");
    expect(r?.sources).toEqual([]);
    expect([...(r?.unmatched ?? [])].sort()).toEqual([...ALL_IDS].sort());
    expect(namedSetFailReason(r)).not.toBeNull();
  });

  it("另一族格式（vitest 的 JSON）也读得动：读者不绑死 pytest", () => {
    const vitestOf = (status: "passed" | "failed"): string => JSON.stringify({
      numTotalTests: 2,
      numPassedTests: status === "passed" ? 2 : 1,
      numFailedTests: status === "passed" ? 0 : 1,
      success: status === "passed",
      testResults: [{
        name: "/repo/tests/fit.test.ts",
        status,
        assertionResults: [
          { ancestorTitles: [], fullName: "运费 券后过线免运费", title: "券后过线免运费", status: "passed" },
          { ancestorTitles: [], fullName: "运费 券后未过线收运费", title: "券后未过线收运费", status },
        ],
      }],
    });
    const spec: NamedSets = { failToPass: ["运费 券后未过线收运费"], passToPass: ["运费 券后过线免运费"] };
    const red = readNamedSets([{ command: "vitest run", output: vitestOf("failed") }], spec);
    expect(red?.notGreen).toEqual(["运费 券后未过线收运费"]);
    expect(red?.sources[0]?.format).toBe("vitest-json");
    expect(readNamedSets([{ command: "vitest run", output: vitestOf("passed") }], spec)?.state).toBe("pass");
  });
});

describe("生产闭环：第 415 页产出的规格真的有消费者", () => {
  const sample = readFileSync(join(ROOT, "outputs/eval-benchmark-adapter-2026-09-24/swebench-sample.jsonl"), "utf8");
  const parsed = fromSweBenchJsonl(sample);
  const realSpec = (parsed.tasks[0] as TaskSpec | undefined)?.judge;

  it("真语料读出的 judge 逐字就是裁决吃的规格（不在测试里手抄第二份清单）", () => {
    expect(realSpec).toBeDefined();
    expect(parsed.errors.length).toBeGreaterThan(0); // 那份样本自带一条坏行 ⇒ 只取解析成功的那条
    const ids = [...(realSpec?.failToPass ?? []), ...(realSpec?.passToPass ?? [])];
    expect(ids.length).toBeGreaterThan(1);
    const green = readNamedSets(resultsOf(pytestReport(ids.map((id) => ({ id, status: "PASSED" as const })))), realSpec);
    expect(green?.state).toBe("pass");
    // 命根子那一对，用的是**生产产出的那两列**：同枚退出码、两种结局，读数不同。
    const badF2P = readNamedSets(resultsOf(pytestReport(ids.map((id) => ({ id, status: id === ids[0] ? "FAILED" : "PASSED" })))), realSpec);
    expect(badF2P?.state).toBe("fail");
    expect(badF2P?.notGreen).toEqual([ids[0]]);
    expect(badF2P?.broken).toEqual([]);
    const badP2P = readNamedSets(resultsOf(pytestReport(ids.map((id) => ({ id, status: id === ids[1] ? "FAILED" : "PASSED" })))), realSpec);
    expect(badP2P?.notGreen).toEqual([]);
    expect(badP2P?.broken).toEqual([ids[1]]);
    expect(JSON.stringify(badF2P)).not.toBe(JSON.stringify(badP2P));
    const rawF2P = pytestReport(ids.map((id) => ({ id, status: id === ids[0] ? "FAILED" : "PASSED" })));
    const rawP2P = pytestReport(ids.map((id) => ({ id, status: id === ids[1] ? "FAILED" : "PASSED" })));
    // 旧读数在这一对上是**同一个值**（两条都是「有一枚红 ⇒ 退出码 1」），新读数才是两个。
    expect(oldOkOf(rawF2P)).toBe(oldOkOf(rawP2P));
    expect(oldOkOf(rawF2P)).toBe(false);
    expect(oldOkOf(pytestReport(ids.map((id) => ({ id, status: "PASSED" as const }))))).toBe(true);
  });

  it("那句 verifier.command 仍逐字带着这两列（新增读者不是把旧命令换掉）", () => {
    const cmd = (parsed.tasks[0] as TaskSpec).verifier?.command ?? "";
    for (const id of [...(realSpec?.failToPass ?? []), ...(realSpec?.passToPass ?? [])]) expect(cmd).toContain(id);
  });
});

/* ── 接线判卷：纯函数有人调才算这一格存在（口径同 `tests/eval-heldout.test.ts` 那一族）────── */

describe("loop-eval 的逐名接线", () => {
  it("跑器调读者，且吃的是**最后一次** verify 拍的 results 与 `t.spec?.judge`", () => {
    const src = runnerSrc();
    expect(src).toContain("readNamedSets(verifies.length > 0 ? verifies[verifies.length - 1]!.results : [], t.spec?.judge)");
    // 规格只有这一处来源：跑器不许自己认格式、也不许在这里现造一份两列清单（第二把尺迟早漂）。
    expect(src).not.toContain("parseTestResults(");
    expect(src).not.toContain("failToPass:");
    expect(src).not.toContain('"-m", "pytest"');
  });

  it("读者自己不再实现任何解析：解析与裁决都从生产侧 import", () => {
    const lib = libSrc();
    expect(lib).toContain("parseTestResults(");
    expect(lib).toContain("judgeNamedSets(");
    expect(lib).not.toMatch(/new RegExp\(|matchAll\(|\.match\(/u);
  });

  it("裁决进 `Reading`，且旧三枚读数的口径逐字没动（新增是第二格，不是换面）", () => {
    const src = runnerSrc();
    expect(src).toContain("namedSets?: NamedSetReading;");
    expect(src).toContain("namedSets,");
    expect(src).toContain("verifyOkLast: verifies.length > 0 ? verifies[verifies.length - 1]!.ok : null,");
    expect(src).toContain("const harnessBeats = autoVerifyBeats(verifies);");
    expect(src).toContain("verifyRecovery: recovery,");
  });

  it("grade 真的拦路，且开口位置在 expects 通道之外", () => {
    const src = runnerSrc();
    const at = src.indexOf("const namedWhy = namedSetFailReason(r.namedSets);");
    expect(at).toBeGreaterThan(-1);
    expect(src.slice(at, at + 300)).toContain("fails.push(namedWhy)");
    // 顺序证人：在 `expects` 那条循环之后、`exitError` 之前——它既没并进 expects，也没被挤到出口之外。
    expect(src.indexOf("for (const e of t.expects)")).toBeLessThan(at);
    expect(at).toBeLessThan(src.indexOf("if (r.exitError) fails.push"));
  });

  it("读数行上真有这枚令牌：它不是旧读数的别名（退出码那种顶包换不掉它）", () => {
    const src = runnerSrc();
    expect(src).toContain("逐名=${r.namedSets === undefined ? NO_NAMED_SET_TOKEN : NAMED_SET_TOKEN[r.namedSets.state]}");
    // 汇总行也有出口（只算不印＝没出口，同 `lib/eval-validity` 那一族的判法）。
    expect(src).toContain("const faces = rows.map((x) => x.r.namedSets);");
    expect(src).toContain('n("unreadable")');
  });

  it("令牌表对 `NamedSetState` 三态穷举（加一态而表没跟上就该在这里红）", () => {
    const src = runnerSrc();
    const head = src.indexOf("const NAMED_SET_TOKEN");
    expect(head).toBeGreaterThan(-1);
    const table = src.slice(head, src.indexOf("};", head));
    for (const s of ["pass", "fail", "unreadable"]) expect(table).toContain(s + ":");
  });

  it("零花费那条路（--feasibility）也报这一格，且印在退出之前", () => {
    const src = runnerSrc();
    const at = src.indexOf("[feasibility] 逐名格");
    expect(at).toBeGreaterThan(-1);
    // 只钉「这串字在文件里」会被 `if (0) console.log(…)` 顶包（反向验证 N8 当场抓到：针还在、没人执行）。
    // ⇒ 钉**调用体本身**：这串字必须紧跟在 `console.log(` 后面，是一条真会执行的语句。
    expect(src.slice(at - 15, at)).toBe("  console.log(`");
    expect(at).toBeLessThan(src.indexOf("process.exit(0)", at));
    expect(src.slice(at, at + 700)).toContain("sumOf(");
  });
});
