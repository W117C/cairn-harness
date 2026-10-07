/* 逐测试名的结果解析（能力 5「证明代码真的能跑」＋能力 10「SWE-bench 那一格」）。
 *
 * 这一簇量的是同一件事的两半：`task-set.ts` 的 SWE-bench 路径从前**只**产出一条把两列拼在一起的
 * `python -m pytest` 命令，退出码 0 就是过——于是「该转绿的没绿」与「该保住的坏了」在同一条读数里
 * 彻底同形。这里给逐名面装尺：三种格式各配合成的绿／红对（同一份夹具改一支而来，两态各钉一次），
 * 再加真料证人（留档的 TAP 与 vitest JSON 报告，都是 HEAD 里已跟踪的文件）。
 *
 * 三条本仓成文纪律在这一份里是有形的：
 *  ⑴ 防空跑判的是**派生完整**（`complete`／`reasons`），不是 `tests.length > 0` 那种数量下界——
 *    数量下界会被「读到 0 条就说没尺、读到 1 条就说全绿」两头同时放过。
 *  ⑵ 「A＝B」型断言旁边必配一条「A≠旧值」，否则那条等式是恒真。
 *  ⑶ 判卷不许自己再算一遍取料：逐名一律走生产侧的 `parseTestResults`／`judgeNamedSets`，
 *    连「逐名规格」本身也是从 `fromSweBenchJsonl` 真读出来的，不是这儿手抄一份 id 清单。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  judgeNamedSets,
  namedSetProblems,
  parseTestResults,
  TAP_RESULT_LINE,
  type NamedSets,
  type ParsedResults,
} from "../src/agent/eval/test-results";
import { fromSweBenchJsonl } from "../src/agent/eval/task-set";
import { suiteRows } from "../scripts/lib/head-cert-deps";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

/* ── 合成夹具：三种格式各一份绿、一份红（红由绿改一支而来，两态只差在同一处）──────────────── */

/** vitest `--reporter=json` 的形状按真档现读对齐（`outputs/judge-timeout-2026-10-01/suite-quiet.json`：
 *  顶层 numTotalTests／numPassedTests／numFailedTests／success，逐名在 testResults[].assertionResults[]，
 *  每枚带 ancestorTitles／fullName／title／status／failureMessages）。 */
type Case = { file: string; suite: string; title: string; status: string };
const vitestJson = (cases: Case[]): string => {
  const byFile = new Map<string, Case[]>();
  for (const c of cases) byFile.set(c.file, [...(byFile.get(c.file) ?? []), c]);
  const testResults = [...byFile.entries()].map(([file, list]) => ({
    name: `/repo/${file}`,
    status: list.some((c) => c.status === "failed") ? "failed" : "passed",
    assertionResults: list.map((c) => ({
      ancestorTitles: [c.suite],
      fullName: `${c.suite} ${c.title}`,
      title: c.title,
      status: c.status,
      duration: 1,
      failureMessages: c.status === "failed" ? ["AssertionError: expected 1 to be 2"] : [],
    })),
  }));
  const passed = cases.filter((c) => c.status === "passed").length;
  const failed = cases.filter((c) => c.status === "failed").length;
  return JSON.stringify({
    numTotalTests: cases.length,
    numPassedTests: passed,
    numFailedTests: failed,
    numPendingTests: cases.length - passed - failed,
    numTodoTests: 0,
    success: failed === 0,
    testResults,
  });
};

const CASES: Case[] = [
  { file: "tests/a.test.ts", suite: "运费计算", title: "券后过线免运费", status: "passed" },
  { file: "tests/a.test.ts", suite: "运费计算", title: "券后未过线收运费", status: "passed" },
  { file: "tests/b.test.ts", suite: "折扣", title: "整单清零仍付运费", status: "passed" },
];
const VITEST_GREEN = vitestJson(CASES);
const VITEST_RED = vitestJson(CASES.map((c) => (c.title === "券后未过线收运费" ? { ...c, status: "failed" } : c)));

/** node --test 的 TAP：`rest` 是结果行 ` - ` 之后的整段（指令 ` # SKIP …` 也从这儿进来）。 */
const tapRow = (n: number, rest: string, fail: boolean): string =>
  (fail ? `not ok ${String(n)} - ${rest}\n` : `ok ${String(n)} - ${rest}\n`) +
  (fail
    ? "  ---\n  duration_ms: 0.5\n  type: 'test'\n" +
      `  location: '/tmp/wk/tests/fit.held.test.js:${String(n)}:1'\n` +
      "  failureType: 'testCodeFailure'\n  error: 'expected 1 to be 2'\n  ...\n"
    : "  ---\n  duration_ms: 0.4\n  type: 'test'\n  ...\n");
const tapDoc = (rows: string[], plan: number, pass: number, fail: number, skipped = 0, todo = 0): string =>
  ["TAP version 13", ...rows, `1..${String(plan)}`, `# tests ${String(plan)}`, `# pass ${String(pass)}`,
    `# fail ${String(fail)}`, "# cancelled 0", `# skipped ${String(skipped)}`, `# todo ${String(todo)}`].join("\n");

const TAP_GREEN = tapDoc([tapRow(1, "券后过线免运费", false), tapRow(2, "券后未过线收运费", false)], 2, 2, 0);
const TAP_RED = tapDoc([tapRow(1, "券后过线免运费", false), tapRow(2, "券后未过线收运费", true)], 2, 1, 1);

/** pytest `-rA` 的两种逐名行（verbose 那条与短汇总那条各写一遍同一枚 nodeid）。 */
const pytestDoc = (statuses: Record<string, string>, trailer: string): string => {
  const ids = Object.keys(statuses);
  const pct = (i: number): string => `[${String(Math.round(((i + 1) / ids.length) * 100))}%]`;
  return [
    "============================= test session starts ==============================",
    "platform darwin -- Python 3.11.9, pytest-8.1.0, pluggy-1.4.0",
    `collected ${String(ids.length)} items`,
    "",
    ...ids.map((id) => `${id} ${statuses[id]} ${pct(ids.indexOf(id))}`),
    "",
    "=========================== short test summary info ============================",
    ...ids.map((id) => `${statuses[id]} ${id}`),
    trailer,
  ].join("\n");
};
const F2P_ID = "tests/test_foo.py::test_pow_negative";
const P2P_A = "tests/test_foo.py::test_add";
const P2P_B = "tests/test_foo.py::test_mul";
const PYTEST_GREEN = pytestDoc({ [F2P_ID]: "PASSED", [P2P_A]: "PASSED", [P2P_B]: "PASSED" },
  "============================== 3 passed in 0.12s ===============================");
const PYTEST_RED = pytestDoc({ [F2P_ID]: "FAILED", [P2P_A]: "PASSED", [P2P_B]: "PASSED" },
  "============================== 1 failed, 2 passed in 0.12s ===============================");
const PYTEST_P2P_RED = pytestDoc({ [F2P_ID]: "PASSED", [P2P_A]: "FAILED", [P2P_B]: "PASSED" },
  "============================== 1 failed, 2 passed in 0.12s ===============================");

const SPEC: NamedSets = { failToPass: [F2P_ID], passToPass: [P2P_A, P2P_B] };

/* ── 真料取料：留档里的 TAP 与 vitest JSON（HEAD 已跟踪）────────────────────────────────── */

/** 从留档 `events.jsonl` 里取**一段**跑器原文（`node --test` 的 TAP 落在 tool_result.output 里）。
 *  选择器只决定「取哪一段」，不决定「读出什么」——读出全部交给生产的 `parseTestResults`；取不到就抛，
 *  不许把证人缺席读成通过。 */
function tapBlock(fileRel: string, pick: (block: string) => boolean): string {
  for (const line of read(fileRel).split("\n")) {
    if (!line.includes("TAP version")) continue;
    let obj: unknown;
    try { obj = JSON.parse(line); } catch { continue; }
    const out = (obj as { output?: unknown }).output;
    if (typeof out === "string" && out.includes("TAP version 13") && pick(out)) return out;
  }
  throw new Error(`留档 ${fileRel} 里取不到满足选择器的 TAP 段 ⇒ 证人缺席，这条判卷没有尺`);
}

const TAP_RED_REAL = tapBlock("../outputs/eval-long30-2026-10-02/L30-long-horizon-rep1-base.events.jsonl", (b) => /^not ok 23 - /m.test(b));
const TAP_GREEN_REAL = tapBlock("../outputs/eval-chain32-2026-10-02/L32-long-chain-rep1-base.events.jsonl", (b) => /# fail 0/.test(b));
/** 逐字取自上面那份留档（下面把它拼回结果行核对，见「取料侧的逐字证人」那一行）。 */
const REAL_RED_NAME = "maxnum：数值最大值（不是字典序）";
const REAL_RED_LINE = "not ok 23 - " + REAL_RED_NAME;

describe("parseTestResults：vitest JSON 的逐名与状态", () => {
  it("绿的一份：格式认对、逐名齐、counts 与顶层计数对得上 ⇒ complete", () => {
    const p = parseTestResults(VITEST_GREEN);
    expect(p.format).toBe("vitest-json");
    expect(p.reasons, p.reasons.join("；")).toEqual([]);
    expect(p.complete).toBe(true);
    expect(p.counts).toEqual({ passed: 3, failed: 0, skipped: 0, todo: 0 });
    expect(p.tests.map((t) => t.name)).toEqual(["运费计算 券后过线免运费", "运费计算 券后未过线收运费", "折扣 整单清零仍付运费"]);
    expect(p.tests[0]!.file).toBe("tests/a.test.ts");
  });

  it("同一份夹具改红一支：那条名字逐字落成 failed，而绿的那一份里同一条是 passed（A≠旧值）", () => {
    const red = parseTestResults(VITEST_RED);
    const green = parseTestResults(VITEST_GREEN);
    expect(red.format).toBe("vitest-json");
    expect(red.counts).toEqual({ passed: 2, failed: 1, skipped: 0, todo: 0 });
    expect(red.tests.filter((t) => t.outcome === "failed").map((t) => t.name)).toEqual(["运费计算 券后未过线收运费"]);
    expect(red.complete, red.reasons.join("；")).toBe(true);
    expect(green.tests.filter((t) => t.outcome === "failed").map((t) => t.name)).toEqual([]);
    expect(red.tests.map((t) => t.outcome)).not.toEqual(green.tests.map((t) => t.outcome));
  });

  it("skipped 与 todo 各归各桶（它们都不是绿，后面判 FAIL_TO_PASS 时算没绿）", () => {
    const p = parseTestResults(vitestJson([
      { file: "tests/c.test.ts", suite: "s", title: "绿的", status: "passed" },
      { file: "tests/c.test.ts", suite: "s", title: "跳的", status: "skipped" },
      { file: "tests/c.test.ts", suite: "s", title: "待写的", status: "todo" },
    ]));
    expect(p.counts).toEqual({ passed: 1, failed: 0, skipped: 1, todo: 1 });
    expect(p.complete, p.reasons.join("；")).toBe(true);
  });

  it("不认识的状态不许静默归零：点名是哪条用例，并把这一格判成派生不完整", () => {
    const p = parseTestResults(vitestJson([
      { file: "tests/d.test.ts", suite: "s", title: "怪的", status: "flaky-ish" },
      { file: "tests/d.test.ts", suite: "s", title: "绿的", status: "passed" },
    ]));
    expect(p.complete).toBe(false);
    expect(p.reasons.join("；")).toContain("flaky-ish");
    expect(p.reasons.join("；")).toContain("怪的");
    expect(p.counts.passed + p.counts.failed).toBe(1); // 那条没进任何桶，但也没被冒充成红
  });

  it("顶层计数与逐名对不上 ⇒ complete=false（读到几条都不叫完整）", () => {
    const obj = JSON.parse(VITEST_RED) as { numTotalTests: number };
    obj.numTotalTests = 9; // 谎报：顶层说九条，逐名只有三条
    const p = parseTestResults(JSON.stringify(obj));
    expect(p.tests).toHaveLength(3);
    expect(p.complete).toBe(false);
    expect(p.reasons.join("；")).toContain("numTotalTests=9");
  });

  it("报告说 success=false 而逐名一条红也没读到 ⇒ 出声（红在别处，不许读成全绿）", () => {
    const obj = JSON.parse(VITEST_GREEN) as Record<string, unknown>;
    obj.success = false;
    obj.numFailedTests = 1;
    const p = parseTestResults(JSON.stringify(obj));
    expect(p.complete).toBe(false);
    expect(p.counts.failed).toBe(0);
    expect(p.reasons.join("；")).toContain("success=false");
  });

  it("文件级 failed 却没有 assertionResults ⇒ 逐名面接不住，并点名是哪个文件", () => {
    const p = parseTestResults(JSON.stringify({
      numTotalTests: 0, numPassedTests: 0, numFailedTests: 1, success: false,
      testResults: [{ name: "/repo/tests/boom.test.ts", status: "failed", message: "收集期崩了" }],
    }));
    expect(p.format).toBe("vitest-json");
    expect(p.tests).toEqual([]);
    expect(p.complete).toBe(false);
    expect(p.reasons.join("；")).toContain("tests/boom.test.ts");
  });
});

describe("parseTestResults：node --test 的 TAP", () => {
  it("绿的一份：两行结果＋计划线＋结尾计数全对上 ⇒ complete", () => {
    const p = parseTestResults(TAP_GREEN);
    expect(p.format).toBe("node-test-tap");
    expect(p.counts).toEqual({ passed: 2, failed: 0, skipped: 0, todo: 0 });
    expect(p.tests.map((t) => t.name)).toEqual(["券后过线免运费", "券后未过线收运费"]);
    expect(p.complete, p.reasons.join("；")).toBe(true);
  });

  it("红的一份：not ok 那条带 location ⇒ file 落到 tests/fit.held.test.js，绿的那一份里它是 passed（A≠旧值）", () => {
    const red = parseTestResults(TAP_RED);
    const green = parseTestResults(TAP_GREEN);
    expect(red.counts).toEqual({ passed: 1, failed: 1, skipped: 0, todo: 0 });
    const bad = red.tests.find((t) => t.outcome === "failed");
    expect(bad?.name).toBe("券后未过线收运费");
    expect(bad?.file).toBe("tests/fit.held.test.js");
    expect(green.tests.filter((t) => t.outcome === "failed")).toEqual([]);
    expect(red.complete, red.reasons.join("；")).toBe(true);
  });

  it("截断的一份（有省略标记、结果行数少于计划线）⇒ 读出「不完整」，绝不读成全绿", () => {
    const truncated = tapDoc([tapRow(1, "宽度换成 3：每段真的按 wrap 的规则折", true)], 7, 4, 3);
    const withElision = truncated.replace("# tests 7", "…[有界性：中段省略 1715 字]…\n# tests 7");
    const p = parseTestResults(withElision);
    expect(p.format).toBe("node-test-tap");
    expect(p.complete).toBe(false);
    expect(p.tests).toHaveLength(1);
    expect(p.reasons.join("；")).toContain("省略");
    expect(p.reasons.join("；")).toContain("计划 7 条、逐名读到 1 条");
    expect(p.reasons.join("；")).toContain("# fail 3 与逐名读到的 1 不符");
  });

  it("没有计划线也没有 TAP version 头 ⇒ 两笔都要出声（无从核对齐全就不许报完整）", () => {
    const p = parseTestResults("# Subtest: 只有一行\nok 1 - 只有一行\n  ...\n");
    expect(p.format).toBe("node-test-tap");
    expect(p.complete).toBe(false);
    expect(p.reasons.join("；")).toContain("1..N 计划线");
    expect(p.reasons.join("；")).toContain("TAP version");
  });

  it("SKIP／TODO 指令不许混成绿（指令从名字里切干净，桶也进对）", () => {
    const p = parseTestResults(tapDoc([tapRow(1, "被跳的 # SKIP 还没装依赖", false), tapRow(2, "待写的 # TODO 已知不通过", false)], 2, 0, 0, 1, 1));
    expect(p.counts).toEqual({ passed: 0, failed: 0, skipped: 1, todo: 1 });
    expect(p.tests.map((t) => t.name)).toEqual(["被跳的", "待写的"]);
    expect(p.complete, p.reasons.join("；")).toBe(true);
  });

  it("缩进的嵌套 subtest 结果行不双计（顶格那些才是结尾计数数的那些）", () => {
    const p = parseTestResults("TAP version 13\nnot ok 1 - 父\n  ---\n  error: '嵌套里红了两条'\n  ...\n    ok 1 - 子甲\n    not ok 2 - 子乙\n1..1\n# tests 1\n# pass 0\n# fail 1\n# cancelled 0\n# skipped 0\n# todo 0\n");
    expect(p.tests.map((t) => t.name)).toEqual(["父"]);
    expect(p.counts).toEqual({ passed: 0, failed: 1, skipped: 0, todo: 0 });
    expect(p.complete, p.reasons.join("；")).toBe(true);
  });

  it("Bail out! 之后一条没跑 ⇒ complete=false 并说出为什么", () => {
    const p = parseTestResults("TAP version 13\nok 1 - 跑到的\nBail out! runner died\n1..9\n");
    expect(p.complete).toBe(false);
    expect(p.reasons.join("；")).toContain("Bail out!");
    expect(p.reasons.join("；")).toContain("计划 9 条、逐名读到 1 条");
  });
});

describe("parseTestResults：pytest（SWE-bench 的判卷就是它）", () => {
  it("绿的一份：verbose 行与 -rA 短汇总行并成同一枚 nodeid（不许双计）", () => {
    const p = parseTestResults(PYTEST_GREEN);
    expect(p.format).toBe("pytest");
    expect(p.tests.map((t) => t.name)).toEqual([F2P_ID, P2P_A, P2P_B]);
    expect(p.counts).toEqual({ passed: 3, failed: 0, skipped: 0, todo: 0 });
    expect(p.tests[0]!.file).toBe("tests/test_foo.py");
    expect(p.complete, p.reasons.join("；")).toBe(true);
  });

  it("红的一份：FAILED 落在同一个 nodeid 上，绿的 counterpart 里它是 passed（A≠旧值）", () => {
    const red = parseTestResults(PYTEST_RED);
    const green = parseTestResults(PYTEST_GREEN);
    expect(red.counts).toEqual({ passed: 2, failed: 1, skipped: 0, todo: 0 });
    expect(red.tests.filter((t) => t.outcome === "failed").map((t) => t.name)).toEqual([F2P_ID]);
    expect(green.tests.filter((t) => t.outcome === "failed")).toEqual([]);
    expect(red.complete, red.reasons.join("；")).toBe(true);
  });

  it("只有进度点的一份：格式认得出是 pytest，但逐名面**没有尺** ⇒ complete=false", () => {
    const dots = [
      "============================= test session starts ==============================",
      "collected 30 items",
      "............F..................                                        [100%]",
      "========================= 1 failed, 29 passed in 0.35s =========================",
    ].join("\n");
    const p = parseTestResults(dots);
    expect(p.format).toBe("pytest");
    expect(p.complete).toBe(false);
    expect(p.reasons.join("；")).toContain("一条逐名也没读到");
    expect(p.reasons.join("；")).toContain("collected 30 条");
  });

  it("收集期的 ERROR（nodeid 没有 :: 段）⇒ 说清那个文件里不会有逐名行", () => {
    const p = parseTestResults([
      "==================================== ERRORS =====================================",
      "ERROR tests/test_foo.py - ImportError: No module named x",
      "=========================== short test summary info ============================",
      "ERROR tests/test_foo.py - ImportError: No module named x",
      "============================== 1 error in 0.05s ==============================",
    ].join("\n"));
    expect(p.format).toBe("pytest");
    expect(p.complete).toBe(false);
    expect(p.reasons.join("；")).toContain("没有 :: 段");
    expect(p.tests.filter((t) => t.outcome === "failed").map((t) => t.name)).toEqual(["tests/test_foo.py"]);
  });

  it("结尾汇总与逐名对不上 ⇒ 点名差在哪个桶", () => {
    const p = parseTestResults(PYTEST_GREEN.replace("3 passed in 0.12s", "9 passed in 0.12s"));
    expect(p.complete).toBe(false);
    expect(p.reasons.join("；")).toContain("passed 合计 9 与逐名读到的 3 不符");
  });
});

describe("parseTestResults：认不出就说认不出（第三态不许伪装成读数）", () => {
  it("空输入 ⇒ unknown、complete=false，reasons 说这是「没有尺」而不是「零条失败」", () => {
    const p = parseTestResults("   \n");
    expect(p.format).toBe("unknown");
    expect(p.complete).toBe(false);
    expect(p.counts).toEqual({ passed: 0, failed: 0, skipped: 0, todo: 0 });
    expect(p.reasons.join("；")).toContain("没有尺");
  });

  it("环境噪声（python 没装）⇒ unknown，且 reasons 带着那句噪声", () => {
    const p = parseTestResults("bash: python: command not found\n");
    expect(p.format).toBe("unknown");
    expect(p.complete).toBe(false);
    expect(p.reasons.join("；")).toContain("command not found");
  });

  it("半截 JSON（写到一半被杀）⇒ 说不出这是哪份报告，但必须给出成因", () => {
    const p = parseTestResults(VITEST_GREEN.slice(0, Math.floor(VITEST_GREEN.length / 2)));
    expect(p.format).toBe("unknown");
    expect(p.complete).toBe(false);
    expect(p.reasons.join("；")).toContain("解析不开");
  });

  it("截断的那半截与完整那份给出**不同**读数（A≠旧值：截断不会被读成全绿）", () => {
    const full = parseTestResults(VITEST_GREEN);
    const cut = parseTestResults(VITEST_GREEN.slice(0, 40));
    expect(full.complete).toBe(true);
    expect(cut.complete).toBe(false);
    expect(cut.format).not.toBe(full.format);
  });
});

describe("judgeNamedSets：FAIL_TO_PASS 全绿 且 PASS_TO_PASS 一条不许坏", () => {
  it("pytest 全绿的一份 ⇒ pass（两列每个 id 都逐字对上、读到的都是绿）", () => {
    const v = judgeNamedSets(parseTestResults(PYTEST_GREEN), SPEC);
    expect(v.state).toBe("pass");
    expect(v.notGreen).toEqual([]);
    expect(v.broken).toEqual([]);
    expect(v.unmatched).toEqual([]);
  });

  it("该转绿的没绿 ⇒ fail 并点名那一枚 id（退出码那种同形读数给不出这一行）", () => {
    const v = judgeNamedSets(parseTestResults(PYTEST_RED), SPEC);
    expect(v.state).toBe("fail");
    expect(v.notGreen).toEqual([F2P_ID]);
    expect(v.broken).toEqual([]); // 两半分得开：这一份坏的只是 F2P
    expect(v.reasons.join("；")).toContain("该转绿的没绿");
  });

  it("该保住的坏了 ⇒ fail 走 broken 那一列，与上一例是**不同**的读数（A≠旧值）", () => {
    const v = judgeNamedSets(parseTestResults(PYTEST_P2P_RED), SPEC);
    expect(v.state).toBe("fail");
    expect(v.broken).toEqual([P2P_A]);
    expect(v.notGreen).toEqual([]);
    expect(v.reasons.join("；")).toContain("该保住的坏了");
  });

  it("名字对不上 ⇒ 逐一点名并落第三态，绝不算成绿", () => {
    const v = judgeNamedSets(parseTestResults(PYTEST_GREEN), {
      failToPass: ["tests/test_other.py::test_never_ran"],
      passToPass: [P2P_A, "tests/test_foo.py::test_also_absent"],
    });
    expect(v.state).toBe("unreadable");
    expect(v.unmatched).toEqual(["tests/test_other.py::test_never_ran", "tests/test_foo.py::test_also_absent"]);
    expect(v.state).not.toBe("pass");
    expect(v.reasons.join("；")).toContain("不许算成绿");
  });

  it("逐名面派生不完整时，即便读到的全是绿也不许报过 ⇒ 第三态并带着成因", () => {
    const truncated = tapDoc([tapRow(1, "宽度换成 3：每段真的按 wrap 的规则折", false)], 7, 6, 1);
    const withElision = truncated.replace("# tests 7", "…[有界性：中段省略 812 字]…\n# tests 7");
    const p = parseTestResults(withElision);
    const v = judgeNamedSets(p, { failToPass: ["宽度换成 3：每段真的按 wrap 的规则折"], passToPass: [] });
    expect(p.complete).toBe(false);
    expect(v.unmatched).toEqual([]); // 名字对上了，病在「不全」
    expect(v.notGreen).toEqual([]);
    expect(v.state).toBe("unreadable");
    expect(v.reasons.join("；")).toContain("派生不完整");
  });

  it("读到的红优先于没读全：一条确证的 fail 不被 unreadable 盖掉", () => {
    const v = judgeNamedSets(parseTestResults(PYTEST_RED), { failToPass: [F2P_ID, "tests/test_foo.py::test_ghost"], passToPass: [] });
    expect(v.state).toBe("fail");
    expect(v.notGreen).toEqual([F2P_ID]);
    expect(v.unmatched).toEqual(["tests/test_foo.py::test_ghost"]);
  });

  it("TAP 的标题串与 SWE-bench 的 python nodeid 天生对不上 ⇒ unreadable（不许靠削前缀去蒙一个绿）", () => {
    const v = judgeNamedSets(parseTestResults(TAP_RED), SPEC);
    expect(v.state).toBe("unreadable");
    expect(v.unmatched).toEqual([F2P_ID, P2P_A, P2P_B]);
    expect(v.notGreen).toEqual([]);
    expect(v.broken).toEqual([]);
  });

  it("状态不认识的那条不算绿：名字对上、桶没进 ⇒ 判成没绿而不是 pass", () => {
    const p = parseTestResults(vitestJson([{ file: "tests/e.test.ts", suite: "s", title: "e", status: "weird" }]));
    const v = judgeNamedSets(p, { failToPass: ["s e"], passToPass: [] });
    expect(p.complete).toBe(false);
    expect(v.state).toBe("fail");
    expect(v.notGreen).toEqual(["s e"]);
  });

  it("vitest 的标题串当 id 用时能逐字对上（匹配严格不等于匹配不上：同一把尺两侧都要有见证）", () => {
    const v = judgeNamedSets(parseTestResults(VITEST_RED), {
      failToPass: ["运费计算 券后过线免运费"],
      passToPass: ["运费计算 券后未过线收运费", "折扣 整单清零仍付运费"],
    });
    expect(v.state).toBe("fail");
    expect(v.broken).toEqual(["运费计算 券后未过线收运费"]);
    expect(v.notGreen).toEqual([]);
    expect(v.unmatched).toEqual([]);
  });
});

describe("namedSetProblems：规格本身成立吗（数据层与裁决器共用这一支）", () => {
  it("合法的一份 ⇒ 零问题；passToPass 允许空（SWE-bench 有这种实例），failToPass 空则不许", () => {
    expect(namedSetProblems(SPEC)).toEqual([]);
    expect(namedSetProblems({ failToPass: ["a"], passToPass: [] })).toEqual([]);
    expect(namedSetProblems({ failToPass: [], passToPass: ["a"] }).join("；")).toContain("failToPass 为空");
  });

  it("同一枚 id 同时出现在两列 ⇒ 点名它（自相矛盾的判卷）", () => {
    const out = namedSetProblems({ failToPass: ["a", "b"], passToPass: ["b"] });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("既在 failToPass 又在 passToPass");
    expect(out[0]).toContain("（b）"); // 要点名的是那一枚 id，不是句子好不好看
  });

  it("列内重复与空串都点名（分母骗人／永远匹配不上）", () => {
    const dup = namedSetProblems({ failToPass: ["a", "a"], passToPass: [] });
    expect(dup.join("；")).toContain("重复");
    expect(dup.join("；")).toContain("a");
    expect(namedSetProblems({ failToPass: ["  "], passToPass: [] }).join("；")).toContain("第 1 条是空的");
  });

  it("没给规格 ⇒ 一句话说清这一格没有可判的东西（与「给了但空」是两种成因）", () => {
    const out = namedSetProblems(null);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("没给逐名规格");
    expect(namedSetProblems(undefined)).toEqual(out); // null 与 undefined 同形：都是「没给」，不是「给坏了」
  });
});

describe("真料证人：留档原文逐字对得上", () => {
  it("红的那段真 TAP：30 条逐名、结尾计数全对上，那条红的名字与文件里的结果行逐字一致", () => {
    const p = parseTestResults(TAP_RED_REAL);
    expect(p.format).toBe("node-test-tap");
    expect(p.counts).toEqual({ passed: 29, failed: 1, skipped: 0, todo: 0 });
    expect(p.complete, p.reasons.join("；")).toBe(true);
    expect(p.tests.filter((t) => t.outcome === "failed").map((t) => t.name)).toEqual([REAL_RED_NAME]);
    expect(p.tests.find((t) => t.outcome === "failed")?.file).toBe("tests/m23-maxnum.test.js");
    // 取料侧的逐字证人：把解析出的名字拼回结果行，它必须是原文里那一整行（数组元素级相等，不是子串命中）
    const rawLines = TAP_RED_REAL.split("\n");
    expect(rawLines).toContain(REAL_RED_LINE);
    expect(rawLines).not.toContain(REAL_RED_LINE + "X");
    // 生产侧那枚正则在同一行上认得出号码与名字（判卷不抄第二份取料）
    const m = TAP_RESULT_LINE.exec(REAL_RED_LINE);
    expect(m?.groups?.verdict).toBe("not ok");
    expect(m?.groups?.num).toBe("23");
    expect(m?.groups?.rest).toBe(REAL_RED_NAME);
  });

  it("同一段真 TAP 拿去判 SWE-bench 那两列 ⇒ 全部 unmatched（逐名面诚实到点名，而不是退出码那种糊）", () => {
    const spec = fromSweBenchJsonl(read("../outputs/eval-benchmark-adapter-2026-09-24/swebench-sample.jsonl")).tasks[0]!.judge;
    expect(spec, "SWE-bench 路径没产出逐名规格 ⇒ 接线断了").toBeDefined();
    const v = judgeNamedSets(parseTestResults(TAP_RED_REAL), spec!);
    expect(v.state).toBe("unreadable");
    expect(v.unmatched).toEqual([...spec!.failToPass, ...spec!.passToPass]);
    expect(v.notGreen).toEqual([]);
    expect(v.state).not.toBe("pass");
  });

  it("绿的那段真 TAP：一条红也没有 ⇒ 与红的那段给出**不同**的逐名集合（A≠旧值）", () => {
    const p = parseTestResults(TAP_GREEN_REAL);
    expect(p.complete, p.reasons.join("；")).toBe(true);
    expect(p.counts.failed).toBe(0);
    const redNames = parseTestResults(TAP_RED_REAL).tests.filter((t) => t.outcome === "failed").map((t) => t.name);
    expect(p.tests.filter((t) => t.outcome === "failed").map((t) => t.name)).toEqual([]);
    expect(p.tests.filter((t) => t.outcome === "failed").map((t) => t.name)).not.toEqual(redNames);
  });

  it("vitest JSON 切片：逐名读出的名字与既有那位读者（suiteRows）一模一样，而 status 正是这里补上的那一半", () => {
    const full = JSON.parse(read("../outputs/judge-timeout-2026-10-01/suite-quiet.json")) as { testResults: { name?: string }[] };
    const failing = full.testResults.filter((f) => typeof f.name === "string" && f.name.includes("prose-needle-scan"));
    expect(failing).toHaveLength(1); // 取料面自己：切片确实只取到那一个文件，取不到就炸
    const sliceText = JSON.stringify({ ...full, testResults: failing });
    const p: ParsedResults = parseTestResults(sliceText);
    const rows = suiteRows(sliceText, "");
    expect(rows, "既有读者在切片上读不出东西 ⇒ 两位读者没法对照").not.toBeNull();
    expect([...new Set(rows!.map((r) => `${r.file}::${r.full}`))].sort())
      .toEqual([...new Set(p.tests.map((t) => `${t.file ?? ""}::${t.name}`))].sort());
    expect(p.tests.filter((t) => t.outcome === "failed").map((t) => t.name)).toEqual([
      "真仓扫：这把尺自己不许空载 在飞那一半点得出名，并且已提交那一半里不许混进在飞文件（两侧配对）",
    ]);
    // 切片带着全量的顶层计数 ⇒ 必须报「不完整」：这就是派生完整，不是数量下界
    expect(p.complete).toBe(false);
    expect(p.reasons.join("；")).toContain("numTotalTests=");
  });
});
