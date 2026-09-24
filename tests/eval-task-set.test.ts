// 能力 10 的数据层：外部基准（SWE-bench 形态的 JSONL）与本仓任务集 → 统一 TaskSpec。
// 这一层的唯一存在理由：把"我们能不能被某个基准衡量"变成**可跑的读数**而不是宣言——
// 解析必须**不静默丢**（少一条任务就少一分母，而没人会去数），可行性必须说清**缺什么**
// （缺快照/缺凭据是"没有尺"，不许读成"成功率 0"）。
import { describe, expect, it } from "vitest";
import { aggregateFeasibility, feasibility, fromSweBenchJsonl, parseTaskSetJson, type EnvProbe } from "../src/agent/eval/task-set";

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
    hasRepoSnapshot: () => true, hasCredentials: () => true, ...over,
  });

  it("快照 + 凭据都在 ⇒ runnable", () => {
    expect(feasibility(task, probe({})).runnable).toBe(true);
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
    expect(agg.reason).toContain("不可跑");
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
