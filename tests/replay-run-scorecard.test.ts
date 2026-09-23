// 每个 run 一行结果卡：这轮任务到底有没有把代码改到能跑、被说"不行"之后返了几次工。
//
// 为什么要有这条面（能力 10 的空位）：现役六个复跑面量的都是**分布**（ask 密度、gate 留痕、
// verify 归因、时延、在途 worker…），没有一条回答"这一轮成功了吗"。所以「评估与持续迭代」
// 至今没有 y 轴——判据只能靠新任务花真钱跑，而已经付过钱的 19 份真实轨迹里的事件序列
// 一直没人读过结论。这条面把那份数据变成逐 run 的终态与返工数：y 轴的免费基线。
//
// 三条口径纪律（都有对应用例钉着，不是注释里的承诺）：
// ① 「算不算写过盘」复用 `mayHaveWrittenDisk`（唯一事实源）——经 shell 落盘的改动必须计入，
//    否则这条面会把「只跑 shell 改代码」的 run 判成 no-write，分母反过来骗人；
// ② 环境拍（`isEnvVerifyCause`）不记在模型账上：既不算 ended-red，也不算返工——
//    这是 P1-3 归因落盘的**消费面**，它有没有挣到自己的钱，看这条就知道；
// ③ 主会话与 worker 子流分开算：worker 事件带 `agent_id`，混在一起算就是"一份载荷两个生产者"
//    的反向版（一个读数两拨人）。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  RUN_OUTCOMES,
  aggregateScorecard,
  scoreStream,
  scorecardVerdict,
  splitStreams,
} from "../scripts/replay/run-scorecard";
import { REPLAY_READINGS } from "../scripts/replay-readings";
import type { AgentEvent, VerifyCause } from "../src/events";

const writePair = (id = "w1"): AgentEvent[] => [
  { type: "tool_call", id, name: "write_file", args: { path: "src/a.ts" } },
  { type: "tool_result", callId: id, ok: true, output: "written" },
];
const shellPair = (id = "s1", command = "printf 'x' >> src/a.ts"): AgentEvent[] => [
  { type: "tool_call", id, name: "shell_rw", args: { command } },
  { type: "tool_result", callId: id, ok: true, output: "1 file changed" },
];
const readPair = (id = "r1"): AgentEvent[] => [
  { type: "tool_call", id, name: "read_file", args: { path: "src/a.ts" } },
  { type: "tool_result", callId: id, ok: true, output: "..." },
];
const green = (): AgentEvent => ({ type: "verify_result", callId: "v", ok: true, attempt: 1, maxAttempts: 3, results: [] });
const codeRed = (): AgentEvent => ({ type: "verify_result", callId: "v", ok: false, attempt: 1, maxAttempts: 3, results: [], cause: "code" });
/** 未归因的红拍：口径是「缺席 = 按 code 算」（`isEnvVerifyCause` 注释原文），所以它该记账。 */
const unattributedRed = (): AgentEvent => ({ type: "verify_result", callId: "v", ok: false, attempt: 1, maxAttempts: 3, results: [] });
const envRed = (cause: VerifyCause = "toolchain-missing"): AgentEvent => ({ type: "verify_result", callId: "v", ok: false, attempt: 1, maxAttempts: 3, results: [], cause });

describe("run 结果卡：终态判定", () => {
  it("写过盘 + 一拍绿 ⇒ green-first-try（返工 0）", () => {
    const s = scoreStream([...writePair(), green()]);
    expect(s.outcome).toBe("green-first-try");
    expect(s.reworkRounds).toBe(0);
    expect(s.writes).toBe(1);
  });

  it(
    "只经 shell 改盘也算写过盘（复用 mayHaveWrittenDisk；旧的两名字清单会把这一格判成 no-write，分母就此骗人）",
    () => {
      expect(scoreStream([...shellPair(), green()]).outcome).toBe("green-first-try");
      // 反向一侧：shell 跑只读命令不是写盘
      expect(scoreStream([...shellPair("s1", "ls -la"), green()]).outcome).toBe("no-write");
    },
  );

  it("改了盘但全程没有任何验证拍 ⇒ wrote-never-verified（能力 5 的空位，单独一档不混进 red）", () => {
    expect(scoreStream(writePair()).outcome).toBe("wrote-never-verified");
    expect(scoreStream([...writePair(), ...readPair()]).outcome).toBe("wrote-never-verified");
  });

  it("压根没写盘 ⇒ no-write（读多写少的问答轮，不许进闭环分母）", () => {
    expect(scoreStream(readPair()).outcome).toBe("no-write");
  });

  it("最后一拍是代码红 ⇒ ended-red（哪怕中间绿过——绿过又改坏了就是改坏了）", () => {
    expect(scoreStream([...writePair(), codeRed()]).outcome).toBe("ended-red");
    expect(scoreStream([...writePair(), green(), ...writePair("w2"), codeRed()]).outcome).toBe("ended-red");
  });

  it("未归因的红拍按 code 记账（缺席不等于免单）", () => {
    expect(scoreStream([...writePair(), unattributedRed()]).outcome).toBe("ended-red");
  });

  it(
    "环境红不记在模型账上：只有一拍环境红 ⇒ env-blocked，既不 ended-red 也不算返工",
    () => {
      const s = scoreStream([...writePair(), envRed()]);
      expect(s.outcome).toBe("env-blocked");
      expect(s.reworkRounds, "环境拍不是「你没修好」，不该驱动返工数").toBe(0);
      expect(s.envRed).toBe(1);
      // 反向一侧：环境拍之后跑出绿 ⇒ 仍是 first-try（环境那一拍没占用返工）
      expect(scoreStream([...writePair(), envRed(), green()]).outcome).toBe("green-first-try");
    },
  );
});

describe("run 结果卡：返工轮数（被说不行之后又改了几次）", () => {
  it("红→改→绿 ⇒ green-after-rework，返工 1", () => {
    const s = scoreStream([...writePair(), codeRed(), ...writePair("w2"), green()]);
    expect(s.outcome).toBe("green-after-rework");
    expect(s.reworkRounds).toBe(1);
  });

  it("末尾的红不算返工（它后面没有再改动）", () => {
    expect(scoreStream([...writePair(), codeRed(), green(), codeRed()]).reworkRounds).toBe(0);
  });

  it("两拍代码红之后各有一次改动 ⇒ 2（口径：每条被后续改动回应过的红拍都算一次）", () => {
    const s = scoreStream([...writePair(), codeRed(), ...writePair("w2"), codeRed(), ...writePair("w3"), green()]);
    expect(s.reworkRounds).toBe(2);
  });
});

describe("流切分与汇总", () => {
  it("worker 事件按 agent_id 分拨，主会话读数不被 worker 污染（反之亦然）", () => {
    const stream: AgentEvent[] = [
      ...writePair("w1"),
      green(),
      { type: "tool_call", agent_id: "worker-1", id: "x1", name: "write_file", args: { path: "src/b.ts" } } as AgentEvent,
      { type: "tool_result", agent_id: "worker-1", callId: "x1", ok: true, output: "written" } as AgentEvent,
    ];
    const { main, workers } = splitStreams(stream);
    expect(scoreStream(main).writes, "主会话自己写了 1 次，不能把 worker 那次算进来").toBe(1);
    expect(workers.map((w) => w.agentId)).toEqual(["worker-1"]);
    expect(scoreStream(workers[0].events).writes).toBe(1);
    expect(scoreStream(workers[0].events).beats, "worker 流里没有验证拍 ⇒ 它是 wrote-never-verified").toBe(0);
  });

  it("汇总给分档计数，no-write 单独列出（不进分母也不被丢弃）", () => {
    const rows = [
      scoreStream([...writePair(), green()]),
      scoreStream([...writePair(), codeRed(), ...writePair("w2"), green()]),
      scoreStream([...writePair(), codeRed()]),
      scoreStream(writePair()),
      scoreStream(readPair()),
      scoreStream([...writePair(), envRed()]),
    ];
    const agg = aggregateScorecard(rows);
    expect(agg.byOutcome["green-first-try"]).toBe(1);
    expect(agg.byOutcome["green-after-rework"]).toBe(1);
    expect(agg.byOutcome["ended-red"]).toBe(1);
    expect(agg.byOutcome["wrote-never-verified"]).toBe(1);
    expect(agg.byOutcome["no-write"]).toBe(1);
    expect(agg.byOutcome["env-blocked"]).toBe(1);
    expect(agg.closedLoopRuns, "分母 = 写过盘的 run（no-write 不算），共 5").toBe(5);
    // 成功率的分母只算「有拍能定终态」的三条；wrote-never-verified 与 env-blocked 是证据缺席，
    // 把它们塞进分母等于让机器的不可用记在模型头上（口径纪律 ⑵）。
    expect(agg.judged).toBe(3);
    expect(agg.green).toBe(2);
    expect(agg.greenRate, "绿的 2 / 能定终态的 3").toBeCloseTo(2 / 3, 5);
    expect(agg.unproven, "证据缺席单独报出：wrote-never-verified + env-blocked").toBe(2);
  });

  it("枚举封闭：每个终态都在 RUN_OUTCOMES 里（新增一档忘了进枚举即红）", () => {
    for (const s of [
      [...writePair(), green()],
      [...writePair(), codeRed(), ...writePair("w2"), green()],
      [...writePair(), codeRed()],
      writePair(),
      readPair(),
      [...writePair(), envRed()],
    ]) {
      expect(RUN_OUTCOMES as readonly string[]).toContain(scoreStream(s).outcome);
    }
  });
});

describe("不可测的三种状态必须红，不许读成「成功率 0」", () => {
  it("一行都没有 ⇒ 不可测（语料不存在与「一单没成」是两件事）", () => {
    const v = scorecardVerdict([]);
    expect(v.measurable).toBe(false);
    expect(v.reason).toContain("语料");
  });

  it("全是 no-write ⇒ 不可测（没有一条改过盘，绿灯率无从谈起）", () => {
    const v = scorecardVerdict([scoreStream(readPair()), scoreStream(readPair("r2"))]);
    expect(v.measurable).toBe(false);
    expect(v.reason, "原因句必须说清是「没写过盘」而不是「跑不起来」").toContain("没有一条改过盘");
  });

  it("有写过盘的 run ⇒ 可测，且 env-blocked 单独报出不进成功率分子分母", () => {
    const v = scorecardVerdict([scoreStream([...writePair(), green()]), scoreStream([...writePair(), envRed()])]);
    expect(v.measurable).toBe(true);
  });
});

describe("登记表两侧齐（D-8）", () => {
  it("run-scorecard 已登记，且脚本真在盘上", () => {
    const entry = REPLAY_READINGS.find((r) => r.id === "run-scorecard");
    expect(entry, "登记了才有门在扫它").toBeTruthy();
    expect(readFileSync(entry!.script, "utf8")).toContain("export function scoreStream");
  });
});
