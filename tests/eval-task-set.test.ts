// 能力 10 的数据层：外部基准（SWE-bench 形态的 JSONL）与本仓任务集 → 统一 TaskSpec。
// 这一层的唯一存在理由：把"我们能不能被某个基准衡量"变成**可跑的读数**而不是宣言——
// 解析必须**不静默丢**（少一条任务就少一分母，而没人会去数），可行性必须说清**缺什么**
// （缺快照/缺凭据是"没有尺"，不许读成"成功率 0"）。
import { describe, expect, it } from "vitest";
import { aggregateFeasibility, deriveVerifierProbe, feasibility, fromSweBenchJsonl, parseTaskSetJson, HELD_OUT_EXPECT, type EnvProbe } from "../src/agent/eval/task-set";

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
    expect(r.tasks[0]!.verifier?.command).toContain("test_pow");
    // PASS_TO_PASS 也进命令：基准的判卷是"坏的要过 + 好的不许坏"两半，少一半就是假绿
    expect(r.tasks[0]!.verifier?.command).toContain("test_add");
    expect(r.tasks[0]!.source).toBe("sympy/sympy@a1b2c3d");
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
