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
  cacheUnreportedLine,
  costOf,
  scoreStream,
  scorecardVerdict,
  splitStreams,
  usageOfStream,
  type UsageTotals,
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
  // 三种"不可测"的**修法不同**（补语料 / 换任务面 / 等 run 留下终态证据），所以判据收 `cause` 字段；
  // 以前收的是 `reason` 里的子串——「语料」在本仓有 33 处副本，改另一处它照样绿（第 92 页量到的那格）。
  it("一行都没有 ⇒ 不可测，cause 是 no-streams（语料不存在与「一单没成」是两件事）", () => {
    const v = scorecardVerdict([]);
    expect(v.measurable).toBe(false);
    expect(v.cause).toBe("no-streams");
  });

  it("全是 no-write ⇒ cause 是 no-writes（没有一条改过盘，绿灯率无从谈起）", () => {
    const v = scorecardVerdict([scoreStream(readPair()), scoreStream(readPair("r2"))]);
    expect(v.measurable).toBe(false);
    expect(v.cause).toBe("no-writes");
    expect(v.reason, "原因句必须说清是「没写过盘」而不是「跑不起来」").toContain("没有一条改过盘");
  });

  it("写过盘但没有一条留下终态证据 ⇒ 第三种 cause（no-decisive-beat），只能报证据缺席", () => {
    // 这一格以前没有用例：三种不可测里只有它藏在前两种后面，`reason` 不同而 `measurable` 相同 ⇒ 不可见。
    const v = scorecardVerdict([scoreStream([...writePair(), envRed()]), scoreStream(writePair())]);
    expect(v.measurable).toBe(false);
    expect(v.cause).toBe("no-decisive-beat");
  });

  it("有写过盘且能定终态的 run ⇒ 可测，cause 必须是空串（env-blocked 单独报出不进分子分母）", () => {
    const v = scorecardVerdict([scoreStream([...writePair(), green()]), scoreStream([...writePair(), envRed()])]);
    expect(v.measurable).toBe(true);
    expect(v.cause).toBe("");
  });
});

describe("登记表两侧齐（D-8）", () => {
  it("run-scorecard 已登记，且脚本真在盘上", () => {
    const entry = REPLAY_READINGS.find((r) => r.id === "run-scorecard");
    expect(entry, "登记了才有门在扫它").toBeTruthy();
    expect(readFileSync(entry!.script, "utf8")).toContain("export function scoreStream");
  });
});

// ---- 代价轴（第 88 页）：报数必须并列「准确率」与「每次成功花多少」----
// 动因是这条面自己缺的那一维：它有 y 轴（成功/返工）却没有任何代价读数，
// 而本仓定死的报数口径是「准确率与 $/成功任务 并列」。两条纪律各有用例：
//   · token 轴与成功率**同一分母**（否则"每次成功更省"可以靠悄悄扩大分母做到）；
//   · 钱算不出 ⇒ null + 说出缺哪一面，**绝不折成 $0**（"不可知记成免费"是本仓点名的假绿形状）。
import { DEFAULT_MODEL_TABLE } from "../src/providers/registry";

const usageEv = (inputTokens: number, outputTokens: number, extra: Record<string, unknown> = {}): AgentEvent =>
  ({ type: "usage", inputTokens, outputTokens, ...extra }) as unknown as AgentEvent;

const emptyTotals = (over: Partial<UsageTotals> = {}): UsageTotals => ({
  usageEvents: 0, inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0,
  cacheReadUnreported: 0, cacheWriteUnreported: 0, modelAttributed: 0, buckets: [], ...over,
});

describe("token 轴：合计与缺报", () => {
  it("in/out 累加；缓存分块**缺字段算缺报**，不当命中 0（规则 95）", () => {
    const t = usageOfStream([usageEv(1000, 100, { cacheReadInputTokens: 700 }), usageEv(500, 50)]);
    expect(t.usageEvents).toBe(2);
    expect(t.inputTokens).toBe(1500);
    expect(t.outputTokens).toBe(150);
    expect(t.cacheRead).toBe(700);
    expect(t.cacheReadUnreported).toBe(1);
    expect(t.cacheWriteUnreported).toBe(2); // 两条都没上报写侧
  });

  it("`inputTokens` 是含缓存的总输入 ⇒ 汇总**不再把 cache 加第二遍**", () => {
    const t = usageOfStream([usageEv(1000, 100, { cacheReadInputTokens: 900, cacheWriteInputTokens: 50 })]);
    expect(t.inputTokens + t.outputTokens).toBe(1100);
  });
});

/* 第 150 页（规则 231⑷）：**成对可选字段不许用「或」/相加合成一个读数**。
   教材就是这条面自己的存量语料：read 字段 166/166 在场（97 条为正、合计 274,880 token），write 字段 **0/166 在场**。
   旧写法 `cacheReadUnreported + cacheWriteUnreported` 把这两件相反的事印成一句"缺报 166"——
   合并的读数会同时藏住"有"和"没有"，我据此写过一条错批语（"命中率卡在无 cache 分块"）。 */
describe("缓存分块缺报要分列印（read / write 各一格）", () => {
  it("两条各缺一侧 ⇒ 两半各记 1（合并成一个数就只能报「缺报 2」，谁缺的说不清）", () => {
    const agg = aggregateScorecard([scoreStream([
      usageEv(1000, 100, { cacheReadInputTokens: 700 }),
      usageEv(500, 50, { cacheWriteInputTokens: 30 }),
    ])]);
    expect(agg.cacheUnreported).toEqual({ read: 1, write: 1 });
  });

  it("「读侧全在场、写侧全缺」与反过来，必须印成两句不同的话（这就是本次缺陷的正反两格）", () => {
    const writeAllMissing = cacheUnreportedLine(3, { read: 0, write: 3 });
    const readAllMissing = cacheUnreportedLine(3, { read: 3, write: 0 });
    expect(writeAllMissing).not.toBe(readAllMissing);
    expect(writeAllMissing).toContain("读侧 0");
    expect(writeAllMissing).toContain("写侧 3");
    // 牙齿：两半都要在行里出现，且**各自带自己的数**——只印一个合并数时这条正则是空的
    expect(writeAllMissing.split("缺报：")[1]).toMatch(/读侧 \d+ 条 · 写侧 \d+ 条/);
  });

  it("汇总那一行不许再把两半加回去（加回去＝本次修的缺陷复活，且这次没人会再发现）", () => {
    const src = readFileSync(new URL("../scripts/replay/run-scorecard.ts", import.meta.url), "utf8");
    expect(src).not.toContain("cacheReadUnreported + allUsage.cacheWriteUnreported");
    expect(src).toContain("cacheUnreported: { read: allUsage.cacheReadUnreported, write: allUsage.cacheWriteUnreported }");
  });
});

describe("钱轴：算不出就说算不出，并说清缺哪一面（cause）", () => {
  // 三种"算不出"的修法各不相同：no-usage＝这条面没取到 usage；no-attribution＝写侧没报 model（#16）；
  // unpriced-bucket＝名字有了但价表查不到（两表漂移）。收 `cause` 而不是 `reason` 的子串：
  // 「model」这个词在本仓有 48 处字面量在管，改任意另一处断言照样绿。
  it("一条 usage 都没有 ⇒ cause 是 no-usage，原因是『没有钱轴』而不是『没花钱』", () => {
    const c = costOf([emptyTotals()]);
    expect(c.measurable).toBe(false);
    expect(c.usd).toBeNull();
    expect(c.cause).toBe("no-usage");
    expect(c.reason).toContain("一条 usage 事件都没有");
  });

  it("有 usage 但零 model 归因 ⇒ usd 必须是 null（**负控：不许读成 $0**）——语料现状正是这一格", () => {
    const c = costOf([emptyTotals({ usageEvents: 166, inputTokens: 1000, outputTokens: 200 })]);
    expect(c.measurable).toBe(false);
    expect(c.usd).toBeNull();
    expect(c.cause).toBe("no-attribution");
    expect(c.unpricedTokens).toBeGreaterThan(0);
  });

  it("有 model 名字但查不到档位（两表漂移）⇒ 仍 null、cause 是第三种，不折成 0", () => {
    const stream: AgentEvent[] = [usageEv(1000, 200, { model: "no-such-model-xyz" })];
    const c = costOf([usageOfStream(stream)]);
    expect(c.measurable).toBe(false);
    expect(c.usd).toBeNull();
    expect(c.cause).toBe("unpriced-bucket");
  });

  it("档位表里的真名能走通整条链（名 → priceForModel → 价表 → usd>0）", () => {
    const spec = DEFAULT_MODEL_TABLE[0]!;
    const c = costOf([usageOfStream([usageEv(100000, 1000, { model: spec.id })])]);
    expect(c.measurable, "档位表里第一个名字定价不了 ⇒ 这条链就断了：" + c.reason).toBe(true);
    expect(c.cause, "可测时 cause 必须是空串（别把『没成因』写成另一种成因）").toBe("");
    expect((c.usd ?? 0) > 0).toBe(true);
    expect(c.reason).toBe(""); // 全部桶都归了因 ⇒ 不该有「下界」话术
  });
});

describe("代价与成功率共用分母", () => {
  const greenStream = scoreStream([...writePair(), usageEv(2000, 200), green()]);
  const redStream = scoreStream([...writePair("w2"), usageEv(8000, 800), codeRed()]);

  it("tokensPerGreen 只除以绿的条数（否则扩大分母就能假装『每次成功更省』）", () => {
    const agg = aggregateScorecard([greenStream, redStream]);
    expect(agg.judged).toBe(2);
    expect(agg.green).toBe(1);
    expect(agg.tokensPerGreen).toBe(2200);
    expect(agg.tokensPerJudged).toBe(5500); // (2200+8800)/2
  });

  it("一条都没成 ⇒ tokensPerGreen 是 null，不是 0（0 会被读成『免费成功』的反面：不存在）", () => {
    const agg = aggregateScorecard([redStream]);
    expect(agg.tokensPerGreen).toBeNull();
    expect(agg.tokensPerJudged).toBe(8800);
  });
});
