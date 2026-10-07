// 能力 10 的数据层：外部基准（SWE-bench 形态的 JSONL）与本仓任务集 → 统一 TaskSpec。
// 这一层的唯一存在理由：把"我们能不能被某个基准衡量"变成**可跑的读数**而不是宣言——
// 解析必须**不静默丢**（少一条任务就少一分母，而没人会去数），可行性必须说清**缺什么**
// （缺快照/缺凭据是"没有尺"，不许读成"成功率 0"）。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { EXPECT_HANDLERS, expectFailReason, type ExpectFace } from "../scripts/lib/eval-expects";
import { VERIFY_RECOVERY_WHY, type VerifyRecovery } from "../scripts/lib/eval-validity";
import { namedSetProblems } from "../src/agent/eval/test-results";
import { aggregateFeasibility, deriveVerifierProbe, EXPECT_NAMES, feasibility, fromSweBenchJsonl, parseTaskSetJson, HELD_OUT_EXPECT, type EnvProbe, unknownExpectNames } from "../src/agent/eval/task-set";

const goodTask = {
  id: "I9",
  instruction: "把失败的测试修好",
  seed: { kind: "dir", path: "fixtures/todo-app" },
  verifier: { command: "pnpm test" },
  expects: ["verifyOk"],
  source: "本仓",
};

describe("parseTaskSetJson：本仓任务集文件", () => {
  it("合法一份：字段逐条落地，errors 为空", () => {
    const r = parseTaskSetJson(JSON.stringify([goodTask]));
    expect(r.errors).toEqual([]);
    expect(r.tasks).toHaveLength(1);
    expect(r.tasks[0]!.id).toBe("I9");
    expect(r.tasks[0]!.verifier?.command).toBe("pnpm test");
  });

  it("重复 id 必须点名（静默去重会让分母骗人）", () => {
    const r = parseTaskSetJson(JSON.stringify([goodTask, { ...goodTask, instruction: "另一条" }]));
    expect(r.tasks).toHaveLength(1);
    expect(r.errors.join(" ")).toContain("重复");
    expect(r.errors.join(" ")).toContain("I9");
  });

  it("instruction 为空/非串 ⇒ 拒收这一条并说明原因", () => {
    const r = parseTaskSetJson(JSON.stringify([{ ...goodTask, instruction: "   " }]));
    expect(r.tasks).toHaveLength(0);
    expect(r.errors.join(" ")).toContain("instruction");
  });

  it("认不出的字段名（如把 verifier 拼成 verifior）必须报错，不许静默忽略", () => {
    const typo = { id: "T1", instruction: "x", source: "s", verifior: { command: "y" } };
    const r = parseTaskSetJson(JSON.stringify([typo]));
    expect(r.errors.join(" ")).toContain("verifior");
  });
});

describe("fromSweBenchJsonl：外部基准实例 → TaskSpec", () => {
  const instance = {
    instance_id: "sympy__sympy-20322",
    repo: "sympy/sympy",
    base_commit: "a1b2c3d",
    problem_statement: "Element.__pow__ 对负整数幂返回错误结果",
    FAIL_TO_PASS: ["sympy/core/tests/test_expr.py::test_pow"],
    PASS_TO_PASS: ["sympy/core/tests/test_expr.py::test_add"],
  };

  it("一行合法实例：id 用 instance_id，指令用 problem_statement，判卷命令收进 FAIL_TO_PASS", () => {
    const r = fromSweBenchJsonl(JSON.stringify(instance) + "\n");
    expect(r.errors).toEqual([]);
    expect(r.tasks[0]!.id).toBe("sympy__sympy-20322");
    expect(r.tasks[0]!.instruction).toContain("__pow__");
    // 那句拼接命令从前由两条 toContain 判（同文件里近乎恒真：只要串里出现这两个词就绿，
    // 顺序错、参数漏一枚、-rA 掉了都读不出来）。现在整串逐字钉住——它是 `judge` 那一格的孪生出口。
    expect(r.tasks[0]!.verifier?.command).toBe(
      "python -m pytest -rA sympy/core/tests/test_expr.py::test_pow sympy/core/tests/test_expr.py::test_add",
    );
    // 同一份取料的**第二半**：逐名规格两列都在，且逐字等于源里的 FAIL_TO_PASS／PASS_TO_PASS。
    expect(r.tasks[0]!.judge).toEqual({
      failToPass: ["sympy/core/tests/test_expr.py::test_pow"],
      passToPass: ["sympy/core/tests/test_expr.py::test_add"],
    });
    // A≠旧值：两列不是同一份清单抄两遍（抄两遍的话这一格就永远不会红）
    expect(r.tasks[0]!.judge!.failToPass).not.toEqual(r.tasks[0]!.judge!.passToPass);
    expect(r.tasks[0]!.source).toBe("sympy/sympy@a1b2c3d");
  });

  it("PASS_TO_PASS 是空数组的一份：命令少一枚 id，judge.passToPass 也照实是空（不编一份保住清单出来）", () => {
    const r = fromSweBenchJsonl(JSON.stringify({ ...instance, PASS_TO_PASS: [] }) + "\n");
    expect(r.errors).toEqual([]);
    expect(r.tasks[0]!.judge).toEqual({ failToPass: ["sympy/core/tests/test_expr.py::test_pow"], passToPass: [] });
    expect(r.tasks[0]!.verifier?.command).toBe("python -m pytest -rA sympy/core/tests/test_expr.py::test_pow");
    // A≠旧值：与两列齐全那份比，command 与 judge 都少了那一枚（不是"照常绿"）
    const both = fromSweBenchJsonl(JSON.stringify(instance) + "\n").tasks[0]!;
    expect(r.tasks[0]!.verifier?.command).not.toBe(both.verifier?.command);
    expect(r.tasks[0]!.judge!.passToPass).not.toEqual(both.judge!.passToPass);
  });

  it("坏 JSON 行只作废那一行并带行号，其余行照常解析（逐行容错）", () => {
    const raw = '{"instance_id":"broken"\n' + JSON.stringify(instance) + "\n";
    const r = fromSweBenchJsonl(raw);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain("第 1 行");
    expect(r.tasks.map((t) => t.id)).toEqual(["sympy__sympy-20322"]);
  });

  it("缺 FAIL_TO_PASS ⇒ 这条没有判卷，必须报错而不是收成'零判卷通过'", () => {
    const noJudge = { ...instance };
    delete (noJudge as Record<string, unknown>).FAIL_TO_PASS;
    const r = fromSweBenchJsonl(JSON.stringify(noJudge));
    expect(r.tasks).toHaveLength(0);
    expect(r.errors.join(" ")).toContain("FAIL_TO_PASS");
    // 负样那一态：整条被拒 ⇒ 也就没有 judge。这条钉的是"没第二条出口"——
    // 不许有人为了留住条目给它补一个空规格（空 failToPass 会把这一格退化成"没坏就算过"）。
    expect(r.tasks.map((t) => t.judge ?? null)).toEqual([]);
  });

  it("FAIL_TO_PASS 是空数组也算没有判卷（只查 PASS_TO_PASS 会静默变成'没坏就算过'）", () => {
    const r = fromSweBenchJsonl(JSON.stringify({ ...instance, FAIL_TO_PASS: [] }));
    expect(r.tasks).toHaveLength(0);
    expect(r.errors.join(" ")).toContain("FAIL_TO_PASS");
  });

  it("空白行不算任务也不报错（文件尾换行是常态）", () => {
    const r = fromSweBenchJsonl("\n" + JSON.stringify(instance) + "\n\n");
    expect(r.errors).toEqual([]);
    expect(r.tasks).toHaveLength(1);
  });
});

describe("feasibility：能不能跑，缺什么要说名字", () => {
  const task = fromSweBenchJsonl(JSON.stringify({
    instance_id: "x-1", repo: "a/b", base_commit: "deadbeef",
    problem_statement: "p", FAIL_TO_PASS: ["t.py::u"], PASS_TO_PASS: [],
  })).tasks[0]!;

  const probe = (over: Partial<EnvProbe>): EnvProbe => ({
    hasRepoSnapshot: () => true, hasCredentials: () => true, canRunVerifier: () => true, ...over,
  });

  it("快照 + 凭据都在 ⇒ runnable", () => {
    expect(feasibility(task, probe({})).runnable).toBe(true);
  });

  // 2026-09-25 实机踩到的一格：SWE-bench 形态的判卷命令写死 `python -m pytest`，
  // 而这台机器**没有装 pytest**（python3 在 ⇒ 只看可执行文件会假绿）。
  // 缺工具链是"没有尺"，不是"模型 0 分"——与本模块开头那条警告同源，但当时只数了快照与凭据两支。
  it("判卷命令跑不起来 ⇒ 不可跑，blocker 点名工具链（不许被读成模型 0 分）", () => {
    const f = feasibility(task, probe({ canRunVerifier: () => false }));
    expect(f.runnable).toBe(false);
    expect(f.blockers.join(" ")).toMatch(/工具链|判卷命令/u);
  });

  // 上面那条走的是 `verifier` **在而跑不起来**那一支；`task.verifier === undefined` 这一支此前 0 观测者，
  // 而那句「没有判卷命令 ⇒ 只能当演示，不许进分母」正是给读数的操作者看的（第 317 页核承诺网时抓到）。
  it("压根没有判卷命令那一支也要出声：blocker 说的是「没有判卷命令」，不许与工具链缺失混成一句", () => {
    const bare = { ...task };
    delete bare.verifier;
    const f = feasibility(bare, probe({}));
    expect(f.runnable).toBe(false);
    expect(f.blockers.join(" ")).toContain("没有判卷命令");
    // 两支话要说清各自的原因：把"没尺"写成"工具链缺失"，读数的人就会去装 pytest，而缺的是判卷本身。
    expect(f.blockers.join(" ")).not.toMatch(/工具链/u);
  });

  it("反向：自检通过时这一格**不许新增 blocker**（否则这条检查是恒红，量不到任何东西）", () => {
    expect(feasibility(task, probe({ canRunVerifier: () => true })).blockers).toHaveLength(0);
  });

  it("整批因工具链缺席而不可跑 ⇒ measurable=false，与「跑出来是红的」是两种读数", () => {
    const agg = aggregateFeasibility([feasibility(task, probe({ canRunVerifier: () => false }))]);
    expect(agg.measurable).toBe(false);
    // 收「全部不可跑」而不是裸「不可跑」：后者在 `scripts/loop-eval.ts` 的逐条打印里也写着，
    // 那是**另一个面**的同一词——第 95 页词法修好后这格才现形（旧面读不到那条模板字面量）。
    expect(agg.reason).toContain("全部不可跑");
  });

  it("没预先 fetch 仓库快照 ⇒ 不可跑，且 blocker 指名是哪个 commit（这是'没有尺'，不是失败）", () => {
    const f = feasibility(task, probe({ hasRepoSnapshot: () => false }));
    expect(f.runnable).toBe(false);
    expect(f.blockers.join(" ")).toContain("deadbeef");
  });

  it("没凭据 ⇒ 不可跑并说明是模型侧缺席（不许悄悄退回'跑不出来'）", () => {
    const f = feasibility(task, probe({ hasCredentials: () => false }));
    expect(f.runnable).toBe(false);
    expect(f.blockers.join(" ")).toMatch(/凭据/);
  });

  it("聚合三态：全部不可跑时 reason 说'无从谈起'，且 runnable 计数为 0 而不是成功率 0", () => {
    const agg = aggregateFeasibility([feasibility(task, probe({ hasRepoSnapshot: () => false }))]);
    expect(agg.measurable).toBe(false);
    expect(agg.reason).toContain("基准读数无从谈起");
    expect(agg.total).toBe(1);
    expect(agg.runnable).toBe(0);
  });

  it("部分可跑 ⇒ 可测，并并列报出可跑数与分母（比值不许脱离分母单独出现）", () => {
    const agg = aggregateFeasibility([
      feasibility(task, probe({})),
      feasibility(task, probe({ hasRepoSnapshot: () => false })),
    ]);
    expect(agg.measurable).toBe(true);
    expect(agg.runnable).toBe(1);
    expect(agg.total).toBe(2);
  });
});

describe("deriveVerifierProbe：从判卷命令推一条自检命令（认不出就给 null，宁缺不编）", () => {
  it("python -m pytest ⇒ 探的是**模块**在不在；只看 python 在不在就会假绿（本机正是这一格）", () => {
    expect(deriveVerifierProbe("python -m pytest -rA t.py::u p.py::v")).toBe('python -c "import pytest"');
  });

  it("常规 runner ⇒ <bin> --version", () => {
    expect(deriveVerifierProbe("pnpm test")).toBe("pnpm --version");
    expect(deriveVerifierProbe("go test ./...")).toBe("go --version");
    expect(deriveVerifierProbe("cargo test --locked")).toBe("cargo --version");
  });

  it("认不出的形状给 null：相对路径脚本、带管道的复合命令、空串", () => {
    expect(deriveVerifierProbe("./run_tests.sh")).toBeNull();
    expect(deriveVerifierProbe("pnpm test | tee out.txt")).toBeNull();
    expect(deriveVerifierProbe("   ")).toBeNull();
  });

  it("-m 后面没有模块名（python -m）⇒ 也算认不出，不许编一条自检", () => {
    expect(deriveVerifierProbe("python -m")).toBeNull();
  });
});

/* held-out（隐藏验收面）的解析。规矩与 verifier 同一条：给坏了就点名，没给就什么都不说。
 * 「没给」必须与「给坏了」分得开——第一版就是把它俩并成了一类，于是 B3…B12 十条没有隐藏面的
 * 任务全被判成畸形，而跑器遇到任何一条解析错就**拒绝出数**（整批归零）。 */
describe("parseTaskSetJson：heldOut 隐藏验收面", () => {
  const held = {
    files: [{ src: "fixtures/bench-heldout/B1/checkout.held.test.js", dest: "tests/checkout.held.test.js" }],
    command: "node --test tests/checkout.held.test.js",
  };
  const withHeld = { ...goodTask, heldOut: held, expects: ["verifyOk", HELD_OUT_EXPECT] };

  it("合法一条：files/dest/command 逐字段落地", () => {
    const r = parseTaskSetJson(JSON.stringify([withHeld]));
    expect(r.errors).toEqual([]);
    expect(r.tasks[0]!.heldOut?.command).toBe(held.command);
    expect(r.tasks[0]!.heldOut?.files[0]!.dest).toBe(held.files[0]!.dest);
  });

  it("没给 heldOut ⇒ 零报错、字段缺省（这条决定整份任务集能不能出数）", () => {
    const r = parseTaskSetJson(JSON.stringify([goodTask]));
    expect(r.errors).toEqual([]);
    expect(r.tasks[0]!.heldOut).toBeUndefined();
  });

  it("给了却不判它 ⇒ 报错：装了跑了没人看，属静默不生效", () => {
    const r = parseTaskSetJson(JSON.stringify([{ ...withHeld, expects: ["verifyOk"] }]));
    expect(r.tasks).toHaveLength(0);
    expect(r.errors.join(" ")).toContain("heldOut");
  });

  it("显式 null 不是「没给」：它是写坏了，必须点名", () => {
    const r = parseTaskSetJson(JSON.stringify([{ ...withHeld, heldOut: null }]));
    expect(r.errors).toHaveLength(1);
  });

  it("files 为空数组 ⇒ 报错（没有隐藏文件的 held-out 就是没有这一面）", () => {
    const r = parseTaskSetJson(JSON.stringify([{ ...withHeld, heldOut: { ...held, files: [] } }]));
    expect(r.errors.join(" ")).toContain("files");
  });

  it("command 空白 ⇒ 报错（验收命令缺失时不许默认当过）", () => {
    const r = parseTaskSetJson(JSON.stringify([{ ...withHeld, heldOut: { ...held, command: "  " } }]));
    expect(r.errors.join(" ")).toContain("command");
  });

  it("src 落在本任务靶子里 ⇒ 报错：隐藏题会被拷进副本，模型第一遍就看见答案", () => {
    const r = parseTaskSetJson(JSON.stringify([{
      ...withHeld,
      heldOut: { ...held, files: [{ src: `${goodTask.seed.path}/tests/sneaky.test.js`, dest: "tests/sneaky.test.js" }] },
    }]));
    expect(r.errors.join(" ")).toContain("靶子");
  });

  it("靶子路径是另一条任务的前缀串（同名不同目录）⇒ 不误伤", () => {
    const r = parseTaskSetJson(JSON.stringify([{
      ...withHeld,
      heldOut: { ...held, files: [{ src: "fixtures/bench-heldout/x.js", dest: "tests/x.js" }] },
    }]));
    expect(r.errors).toEqual([]);
  });

  it("file 型 seed 也给得出 src 检查：dest 与 src 缺一个就点名缺哪个", () => {
    const r = parseTaskSetJson(JSON.stringify([{ ...withHeld, heldOut: { files: [{ src: "" } as never], command: held.command } }]));
    expect(r.errors.join(" ")).toContain("src");
  });

  it("heldOut 里的未知字段（把 files 拼成 flle）⇒ 报错，不许静默忽略", () => {
    const r = parseTaskSetJson(JSON.stringify([{ ...withHeld, heldOut: { flles: held.files, command: held.command } }]));
    expect(r.errors.join(" ")).toContain("flles");
  });

  it("判卷用的那枚 expects 名字与常量同源：抄错一枚字母就不判了", () => {
    const r = parseTaskSetJson(JSON.stringify([{ ...withHeld, expects: ["verifyOk", "heldOutPas"] }]));
    expect(r.tasks).toHaveLength(0);
    expect(r.errors.join(" ")).toContain(HELD_OUT_EXPECT);
  });
});

/* ── 第 412 页 · `judge` 逐名规格：SWE-bench 那两列在**本仓任务集**这一路也要能写 ─────────────
 * 上面那条 `fromSweBenchJsonl` 的接线证明外部语料那条路会产出 judge；这一格管另一件事：
 * 手写任务集里给了 judge 就得**逐字落地**，给坏了就得**点名拒收**——与 heldOut／verifier 同一个口径。
 * 语义检查（空列／重复／两列重叠）不在这里再写一遍规则，而是复用裁决器那支 `namedSetProblems`
 * （本仓成文：判卷不许自己再算一遍取料，生产侧只留一份判据）。 */
describe("parseTaskSetJson：judge 逐名规格", () => {
  const judge = { failToPass: ["tests/checkout.test.ts::券后过线免运费"], passToPass: ["tests/checkout.test.ts::原价未过线收运费"] };
  const withJudge = { ...goodTask, judge };

  it("合法一份：两列逐字落地，且与 verifier.command 各是各的（一个答退出码、一个答逐名）", () => {
    const r = parseTaskSetJson(JSON.stringify([withJudge]));
    expect(r.errors, r.errors.join(" ")).toEqual([]);
    expect(r.tasks[0]!.judge).toEqual(judge);
    expect(r.tasks[0]!.verifier).toEqual({ command: "pnpm test" });
  });

  it("没给 judge ⇒ 字段缺省且零报错（多数内建任务没有逐名规格；heldOut 那次把缺省判成畸形，整批出不了数）", () => {
    const r = parseTaskSetJson(JSON.stringify([goodTask]));
    expect(r.errors).toEqual([]);
    expect(r.tasks[0]!.judge).toBeUndefined();
  });

  it("子字段拼错（failToPasc）⇒ 点名认不出，不许静默忽略成「写了但没生效」", () => {
    const r = parseTaskSetJson(JSON.stringify([{ ...withJudge, judge: { failToPasc: judge.failToPass, passToPass: judge.passToPass } }]));
    expect(r.tasks).toHaveLength(0);
    expect(r.errors.join(" ")).toContain("failToPasc");
  });

  it("judge 不是对象 ⇒ 说出它必须是什么形状", () => {
    const r = parseTaskSetJson(JSON.stringify([{ ...withJudge, judge: ["a", "b"] }]));
    expect(r.tasks).toHaveLength(0);
    expect(r.errors.join(" ")).toContain("failToPass");
  });

  it("passToPass 整列没给 ⇒ 拒收（少一半就是半份判卷，SWE-bench 的病正长这样）", () => {
    const r = parseTaskSetJson(JSON.stringify([{ ...withJudge, judge: { failToPass: judge.failToPass } }]));
    expect(r.tasks).toHaveLength(0);
    expect(r.errors.join(" ")).toContain("passToPass");
  });

  it("语义问题只有**一份**判据：解析期报的句子就是 namedSetProblems 的输出（抄第二份迟早漂）", () => {
    const bad = { failToPass: ["a", "a"], passToPass: ["a"] };
    const problems = namedSetProblems(bad);
    expect(problems.length).toBeGreaterThanOrEqual(2); // 重复 ＋ 两列重叠
    const r = parseTaskSetJson(JSON.stringify([{ ...goodTask, judge: bad }]));
    expect(r.tasks).toHaveLength(0);
    for (const p of problems) expect(r.errors.join(" ")).toContain(p);
    // A≠旧值：两列干净的那份必须一条问题也没有（否则上面那条拒收是恒红）
    expect(namedSetProblems(judge)).toEqual([]);
    const ok = parseTaskSetJson(JSON.stringify([{ ...goodTask, judge }]));
    expect(ok.errors, ok.errors.join(" ")).toEqual([]);
    expect(ok.tasks[0]!.judge).toEqual(judge);
  });

  it("failToPass 为空数组 ⇒ 拒收：这一格会退化成只查「好的不许坏」", () => {
    const r = parseTaskSetJson(JSON.stringify([{ ...goodTask, judge: { failToPass: [], passToPass: ["a"] } }]));
    expect(r.tasks).toHaveLength(0);
    expect(r.errors.join(" ")).toContain("failToPass 为空");
  });

  it("★接线：judge 已登记进 TASK_FIELDS ⇒ 认它、也仍然认不出拼错的老字段", () => {
    const r = parseTaskSetJson(JSON.stringify([withJudge]));
    expect(r.errors, r.errors.join(" ")).toEqual([]);
    const typo = parseTaskSetJson(JSON.stringify([{ ...withJudge, juege: judge }]));
    expect(typo.errors.join(" ")).toContain("juege");
  });
});

/* ── 第 327 页 · #35：`expects` 的**判据名**也要 fail-closed ────────────────────────────
 * 这一层对**字段名**早就是 fail-closed 的（`TASK_FIELDS`，文件头那句"静默忽略＝允许数据集作者写了但没生效"），
 * 但对判据名从前是自由字符串：拼错的名字走不进任何 `if`，那条任务照样进分母、读数照印。
 * 第 325 页往这张表里加了 `verifyRecovered`，所以我把它补上——修法是"两支键集相等"，不是抄一份清单。 */
describe("判据名登记表 ↔ 判定分支表（#35：拼错的名字不许安静不生效）", () => {
  it("登记表非空，且 heldOut 那枚来自常量（抄第二份字符串就会漂）", () => {
    expect(EXPECT_NAMES.length).toBeGreaterThan(0);
    expect(EXPECT_NAMES).toContain(HELD_OUT_EXPECT);
  });

  it("unknownExpectNames：拼错的点名、登记的不误伤、空串进空出", () => {
    expect(unknownExpectNames([...EXPECT_NAMES])).toEqual([]);
    expect(unknownExpectNames(["verifyOkk"])).toEqual(["verifyOkk"]);
    expect(unknownExpectNames(["verifyOk", "clariffy", "clariffy"])).toEqual(["clariffy", "clariffy"]);
    expect(unknownExpectNames([])).toEqual([]);
  });

  it("解析期拒收：带未登记判据名的那条任务**不进分母**，且错误里点名那一枚", () => {
    const r = parseTaskSetJson(JSON.stringify([{ ...goodTask, expects: ["verifyOk", "wroteTestz"] }]));
    expect(r.tasks).toHaveLength(0);
    expect(r.errors.join(" ")).toContain("wroteTestz");
    // 原句证人（不是抄文案好看）：那句「写了也不会生效」是这一格对数据集作者的**承诺**，
    // 它一旦被人改成别的话，报错就只剩一个名字而没有后果说明——所以钉住这句里的那半截。
    expect(r.errors.join(" ")).toContain("里有没登记的判据名");
    // 反向：全登记名的一份必须照常过（拒收不能顺手把合法数据集判死）
    const ok = parseTaskSetJson(JSON.stringify([{ ...goodTask, expects: [...EXPECT_NAMES] }]));
    expect(ok.errors, ok.errors.join(" ")).toEqual([]);
    expect(ok.tasks).toHaveLength(1);
  });

  it("★两支键集相等：登记的每一枚都有分支，分支里的每一枚都登记（抄两份清单＝各写各的）", () => {
    expect(Object.keys(EXPECT_HANDLERS).sort()).toEqual([...EXPECT_NAMES].sort());
  });

  /* 两向证人。第一版这里写的是「一份什么都不满足的面喂进去，每一枚都要出声」，
   * 被自己这条尺当场判红：`wroteTest` 要 wroteTests=true、`testNotRewritten` 要 false，
   * 两枚读同一个字段、极性相反 ⇒ 那张「全违规面」根本不存在。尺是对的，面是我编的
   * （第 327 页的读数）。改成逐枚问两句：有没有一张面能让它出声（抓恒 null 的分支），
   * 有没有一张面能让它闭嘴（抓恒出事的判据——那会把合法任务全判死）。 */
  const RECOVERY_STATES = Object.keys(VERIFY_RECOVERY_WHY) as VerifyRecovery[];
  /** 其余判据都过的那张底面；`wroteTests` 由调用方给，因为它同时是两枚判据的反极性来源。 */
  const baseFace = (wroteTests: boolean): ExpectFace => ({
    clarified: 1, plannedBeforeWrite: true, readsBeforeFirstWrite: 3, verifyOkLast: true,
    verifyRecovery: "modelRecovery", touchedJudge: false, wroteTests, onlySrcChanged: true,
    expects: [...EXPECT_NAMES],
    heldOutSpec: { files: [{ src: "hidden/x.test.ts", dest: "tests/x.test.ts" }], command: "pnpm test" },
    heldOutRun: { ran: true, ok: true, exitCode: 0, output: "" },
    heldOutInstallErrs: [],
  });
  /** 枚举输入面＝两张底面 × 逐字段推到对面那一侧 ＋ verifyRecovery 六态 ＋ held-out 的三种「量不出来」。 */
  const enumeratedFaces = (): ExpectFace[] => {
    const out: ExpectFace[] = [];
    for (const base of [baseFace(true), baseFace(false)]) {
      out.push(base);
      for (const k of ["plannedBeforeWrite", "touchedJudge", "onlySrcChanged", "wroteTests"] as const) {
        out.push({ ...base, [k]: !base[k] });
      }
      out.push({ ...base, clarified: 0 }, { ...base, readsBeforeFirstWrite: 0 }, { ...base, verifyOkLast: false });
      for (const st of RECOVERY_STATES) out.push({ ...base, verifyRecovery: st });
      out.push(
        { ...base, heldOutSpec: undefined },
        { ...base, heldOutRun: { ran: false, why: "heldOut.command 是空的" } },
        { ...base, heldOutRun: { ran: true, ok: false, exitCode: 1, output: "" } },
      );
    }
    return out;
  };

  it("两向证人·出声：枚举的面里每一枚判据至少开口一次（恒 null 的分支＝那一格没在判）", () => {
    const faces = enumeratedFaces();
    expect(faces.length).toBeGreaterThan(RECOVERY_STATES.length);
    for (const name of EXPECT_NAMES) {
      const i = faces.findIndex((f) => EXPECT_HANDLERS[name](f) !== null);
      expect(i, `判据「${name}」对枚举出的 ${String(faces.length)} 张面一律不出声 ⇒ 这一格只是装饰`).toBeGreaterThanOrEqual(0);
    }
  });

  it("两向证人·闭嘴：枚举的面里每一枚判据至少过一次（恒出事的判据会把合法任务全判死）", () => {
    const faces = enumeratedFaces();
    for (const name of EXPECT_NAMES) {
      const i = faces.findIndex((f) => EXPECT_HANDLERS[name](f) === null);
      expect(i, `判据「${name}」对枚举出的 ${String(faces.length)} 张面一律出声 ⇒ 没有任何任务能满足它`).toBeGreaterThanOrEqual(0);
    }
  });

  it("绕过解析（内建任务写错名）也要出声：入口自己那一支兜住", () => {
    const face: ExpectFace = {
      clarified: 1, plannedBeforeWrite: true, readsBeforeFirstWrite: 1, verifyOkLast: true,
      verifyRecovery: "modelRecovery", touchedJudge: false, wroteTests: false, onlySrcChanged: true,
      expects: ["verifyOkk"],
    };
    expect(expectFailReason("verifyOkk", face)).toContain("verifyOkk");
    expect(expectFailReason("verifyOk", face)).toBeNull();
  });

  it("★接线 跑器不再自己判每一枚名字（旧那串 if 不许回来）", () => {
    const src = readFileSync(fileURLToPath(new URL("../scripts/loop-eval.ts", import.meta.url)), "utf8");
    expect(src).toContain('const why = expectFailReason(e, face);');
    expect(src).not.toMatch(/if \(e === "verifyOk" &&/);
    expect(src).not.toContain("heldOutFailReasons(t.expects");
  });
});
