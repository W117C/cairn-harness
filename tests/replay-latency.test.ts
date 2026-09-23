// 复跑面 `replay:latency` 的判卷（延迟第一次可测：工具耗时分布 + D8 的触发面）。
//
// 这把尺有两半，而它们**可测的时点不同**——分开钉，否则会出现「拿算得出的那半冒充整条读数」：
//  ⑴ 触发面（一轮里 ≥2 个 tool_call）：**不需要时间戳**，2026-09-23 之前的语料也算得出来。
//     orchestration spec §5 D8（并发执行只读工具）的 go/no-go 就看这一格：模型一轮只发一个调用时，
//     并发面根本不存在，实现它换来的是 0 收益。
//  ⑵ 时间面（工具耗时、工具占总耗时比）：**要靠 `createEventLog.append` 盖的时钟戳**。
//     旧语料一条戳都没有 ⇒ 必须红着说「不可测」，不许报「工具耗时 0ms」——那是最近的假绿入口。
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { REPLAY_READINGS } from "../scripts/replay-readings";
import { latencyVerdict, pickSources, tallyLatency, tallyStreams } from "../scripts/replay/latency";

const call = (id: string, name: string, ts?: number) => ({ type: "tool_call", id, name, args: {}, ...(ts === undefined ? {} : { ts }) });
const result = (id: string, ts?: number, ok = true) =>
  ({ type: "tool_result", callId: id, ok, output: "x", ...(ts === undefined ? {} : { ts }) });

describe("latency 的时间面", () => {
  it("按 callId 配对算时长：一次 read_file 250ms", () => {
    const t = tallyLatency([call("c1", "read_file", 1_000), result("c1", 1_250)]);
    expect(t.paird).toBe(1);
    expect(t.toolTimeMs).toBe(250);
    expect(t.byTool.get("read_file")?.totalMs).toBe(250);
    expect(t.hasTimestamps).toBe(true);
  });

  it("没戳的语料 ⇒ hasTimestamps=false（这一半不可测，不许读成 0ms）", () => {
    const t = tallyLatency([call("c1", "read_file"), result("c1")]);
    expect(t.hasTimestamps).toBe(false);
    expect(t.paird).toBe(0);
  });

  it("有结果的孤儿 tool_result 与没结果的 tool_call 各自记账，都不混进时长", () => {
    const t = tallyLatency([
      call("c1", "read_file", 1_000), result("c1", 1_100),
      result("ghost", 1_500),                       // 没有对应 call
      call("c2", "run_shell", 2_000),               // 没有对应 result（被中断/在飞）
    ]);
    expect(t.paird).toBe(1);
    expect(t.orphanResults).toBe(1);
    expect(t.openCalls).toBe(1);
    expect(t.toolTimeMs).toBe(100);
  });

  it("p50/p90 用最近秩：三个样本 100/200/300 ⇒ p50=200、p90=300", () => {
    const t = tallyLatency([
      call("a", "grep", 0), result("a", 100),
      call("b", "grep", 1_000), result("b", 1_200),
      call("c", "grep", 2_000), result("c", 2_300),
    ]);
    const g = t.byTool.get("grep");
    expect(g?.n).toBe(3);
    expect(g?.p50Ms).toBe(200);
    expect(g?.p90Ms).toBe(300);
    expect(g?.maxMs).toBe(300);
  });
});

describe("latency 的触发面（D8 那一格）", () => {
  it("同一轮里两个 tool_call ⇒ multiCallTurns=1（并发面存在）", () => {
    const t = tallyLatency([call("a", "read_file"), call("b", "grep"), result("a"), result("b")]);
    expect(t.turnsWithCalls).toBe(1);
    expect(t.multiCallTurns).toBe(1);
    expect(t.maxCallsPerTurn).toBe(2);
  });

  it("一调一果交替 ⇒ 0：模型一轮只发一个调用，并发执行换来的是 0 收益", () => {
    const t = tallyLatency([call("a", "read_file"), result("a"), call("b", "grep"), result("b")]);
    expect(t.turnsWithCalls).toBe(2);
    expect(t.multiCallTurns).toBe(0);
    expect(t.maxCallsPerTurn).toBe(1);
  });

  it("D8 可折次数按「该轮只读调用数 − 1」算，不按「整轮是否全只读」（真语料有个 25 调用的轮，23 个是 read_file）", () => {
    const twoSafe = tallyLatency([call("a", "read_file"), call("b", "grep"), result("a"), result("b")]);
    const oneSafe = tallyLatency([call("a", "read_file"), call("b", "run_shell"), result("a"), result("b")]);
    const twoSafeOneWrite = tallyLatency([
      call("a", "read_file"), call("b", "grep"), call("c", "run_shell"),
      result("a"), result("b"), result("c"),
    ]);
    expect(twoSafe.d8SavableCalls).toBe(1);
    expect(oneSafe.d8SavableCalls).toBe(0); // 只有一个只读调用 ⇒ 没东西可并
    // 这一格就是旧口径会读成 0 的那种轮：整轮不"全只读"，但那两个读本来可以并
    expect(twoSafeOneWrite.d8SavableCalls).toBe(1);
  });

  it("一条流末尾未闭合的调用会把下一条流的「轮」吞掉 ⇒ 必须逐条成流再合并", () => {
    const a = [call("a1", "read_file"), result("a1"), call("dangling", "read_file")];
    const b = [call("b1", "grep"), result("b1")];
    expect(tallyStreams([a, b]).turnsWithCalls).toBe(2);
    // 反面（本面第一版踩过）：拼成一条数组时 b 那一轮 pending 永不归零 ⇒ 少计一轮
    expect(tallyLatency([...a, ...b]).turnsWithCalls).toBe(1);
  });
});

describe("latency 的三态结论", () => {
  it("一条 tool_call 也没有 ⇒ 红着退出说不可测（时间面与触发面都没有分母）", () => {
    const v = latencyVerdict(tallyLatency([{ type: "user_message", content: "hi", ts: 5 }]));
    expect(v.exitCode).toBe(1);
    expect(v.lines.join("\n")).toContain("不可测");
  });

  it("有调用但全无戳 ⇒ 触发面照常报，时间面单独说「旧语料无戳」并红着退出", () => {
    const v = latencyVerdict(tallyLatency([call("a", "read_file"), result("a")]));
    expect(v.exitCode).toBe(1);
    const s = v.lines.join("\n");
    expect(s).toContain("触发面");
    expect(s).toContain("无戳");
  });

  it("有戳 ⇒ 绿，并把「工具占总耗时」那一行印出来（D8 的天花板就是它）", () => {
    const v = latencyVerdict(tallyLatency([
      call("a", "read_file", 0), result("a", 100),
      { type: "assistant_message", content: "done", ts: 900 },
    ]));
    expect(v.exitCode).toBe(0);
    expect(v.lines.join("\n")).toContain("工具占总耗时");
  });
});

describe("latency 的取料面（`-- <路径>` 支持）", () => {
  const tree: Record<string, string[]> = {
    "runs/a": ["runs/a/one.jsonl", "runs/a/two.jsonl"],
    "runs/a/one.jsonl": ["runs/a/one.jsonl"],
    "runs/empty": [],
  };
  const list = (p: string): string[] => tree[p] ?? [];
  const corpus = ["outputs/x.jsonl"];

  it("不给参数 ⇒ 用登记表语料（口径不变）", () => {
    expect(pickSources([], corpus, list)).toEqual({ files: corpus, problem: null });
  });

  it("给了路径就只用那些路径，不掺登记表语料（否则「这一批的数」会混进别的批）", () => {
    expect(pickSources(["runs/a"], corpus, list)).toEqual({ files: ["runs/a/one.jsonl", "runs/a/two.jsonl"], problem: null });
  });

  it("路径下一条 .jsonl 也没有 ⇒ 红着点名该路径，绝不退回全语料", () => {
    const v = pickSources(["runs/empty"], corpus, list);
    expect(v.files).toEqual([]);
    expect(v.problem).toContain("runs/empty");
  });

  it("多个路径里只要有一个读不到，整条读数就不成立（不报「其余那半的数」当整批）", () => {
    const v = pickSources(["runs/a", "runs/empty"], corpus, list);
    expect(v.problem).toContain("runs/empty");
    expect(v.files).toEqual([]);
  });
});

describe("latency 的接线面", () => {
  it("已在复跑面登记表里（登记 = 有文档引用它，docs-check D-8 两侧都盯）", () => {
    const ids = REPLAY_READINGS.map((r) => r.id);
    expect(ids).toContain("latency");
    expect(new Set(ids).size).toBe(ids.length);
    const row = REPLAY_READINGS.find((r) => r.id === "latency");
    expect(existsSync(new URL("../" + (row?.script ?? ""), import.meta.url))).toBe(true);
  });
});
