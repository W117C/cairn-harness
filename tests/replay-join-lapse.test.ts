// 复跑面 `replay:join-lapse` 的判卷（orchestration-design §3 W1b 的前置读数：「先量占比再动终止语义」）。
//
// 这把尺守的错法与本仓那条老教训同形：**「占比是 0」与「根本没有 worker 可量」长得一模一样**。
// 所以这里的重点不是"数得对"，而是三件：⑴ 尺必须**能红**（造一条真在途要报 1，否则 0 是恒真读数）；
// ⑵ 「在途」的定义**挂产品的现状**（`interruptedWorkers` 的终态名单），不另抄一份 done/failed/cancelled；
// ⑶ 零 worker 的 run 不许进分母——不然占比会被大量无 worker 会话稀释成一个看起来很好的数。
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { interruptedWorkers } from "../src/agent/recovery";
import { WAIT_FOR_AGENTS_TOOL } from "../src/tools/wait_for_agents";
import { WAIT_TOOL_NAME } from "../src/agent/tool-choice";
import { REPLAY_READINGS } from "../scripts/replay-readings";
import { joinLapseVerdict, summarizeRuns, tallyJoinLapse } from "../scripts/replay/join-lapse";

const spawned = (id: string) => ({ type: "agent_spawned", agent_id: id, parent_event_id: 1, mode: "read", task: "t", permission_mode: "auto" });
const status = (id: string, s: string) => ({ type: "agent_status", agent_id: id, status: s });
const receipt = (id: string) => ({ type: "agent_result", agent_id: id, status: "done", output: "报告", artifacts: {} });
const waitCall = (id: string) => ({ type: "tool_call", id, name: WAIT_FOR_AGENTS_TOOL, args: {} });
const call = (id: string, name: string) => ({ type: "tool_call", id, name, args: {} });

describe("join-lapse 的「在途」定义", () => {
  it("造一条真在途要报 1（尺能红）：只有 running、无终态 ⇒ 回合末仍在途", () => {
    const row = tallyJoinLapse([spawned("w1"), status("w1", "running")], "a.jsonl");
    expect(row.spawns).toBe(1);
    expect(row.inFlight).toBe(1);
  });

  it("收过队就归零：同一 worker 补一条终态后 inFlight=0（不是把历史在途累计起来）", () => {
    const row = tallyJoinLapse([spawned("w1"), status("w1", "running"), status("w1", "done")], "a.jsonl");
    expect(row.inFlight).toBe(0);
  });

  it("failed / cancelled 同样算收队——终态名单挂产品的 `interruptedWorkers`，不在此另抄一份", () => {
    for (const s of ["failed", "cancelled"]) {
      const row = tallyJoinLapse([spawned("w1"), status("w1", s)], "a.jsonl");
      expect(row.inFlight, s + " 不得读成在途").toBe(0);
      // 与产品口径逐字一致：本尺的判定面就是恢复面那个函数，二者不得分叉
      expect(row.inFlight).toBe(interruptedWorkers(rowProbeEvents([spawned("w1"), status("w1", s)])).length);
    }
  });

  it("回执归因不串：A 已终态、B 未终态 ⇒ 1，不能因为「有过终态」就整批算收到", () => {
    const row = tallyJoinLapse(
      [spawned("w1"), spawned("w2"), status("w1", "done"), receipt("w1")],
      "a.jsonl",
    );
    expect(row.spawns).toBe(2);
    expect(row.inFlight).toBe(1);
  });
});

describe("join-lapse 的「主动收队」与「读到过」", () => {
  it("wait_for_agents 按工具名常量计数，且不看 result 成败（本条量的是模型有没有去等）", () => {
    const row = tallyJoinLapse(
      [spawned("w1"), waitCall("c1"), call("c2", "read_file"), ...waitResult("c2", false)],
      "a.jsonl",
    );
    expect(row.waitCalls).toBe(1);
  });

  it("回执之后主会话没有任何动作 ⇒ 收到过但没读（readReceipt=false）", () => {
    const row = tallyJoinLapse([spawned("w1"), status("w1", "done"), receipt("w1")], "a.jsonl");
    expect(row.inFlight).toBe(0);
    expect(row.readReceipt).toBe(false);
  });

  it("回执之后还有 tool_call ⇒ 算读到过（同一份事件流，只差一个动作，两向都要能判出来）", () => {
    const row = tallyJoinLapse([spawned("w1"), status("w1", "done"), receipt("w1"), call("c9", "write_file")], "a.jsonl");
    expect(row.readReceipt).toBe(true);
  });

  it("没派过活的 run 两个口径都是 false/0，不冒充「读了回执」", () => {
    const row = tallyJoinLapse([call("c1", "read_file")], "a.jsonl");
    expect(row.spawns).toBe(0);
    expect(row.readReceipt).toBe(false);
    expect(row.waitCalls).toBe(0);
  });
});

describe("join-lapse 的分母与三态", () => {
  it("分母只数真派过活的 run：掺进无 worker 的会话不会把占比稀释成 0", () => {
    const rows = [
      tallyJoinLapse([spawned("w1"), status("w1", "running")], "lapse.jsonl"),
      tallyJoinLapse([call("c1", "read_file")], "no-worker-a.jsonl"),
      tallyJoinLapse([call("c2", "read_file")], "no-worker-b.jsonl"),
    ];
    const s = summarizeRuns(rows);
    expect(s.workerRuns).toBe(1);
    expect(s.lapsedRuns).toBe(1);
    expect(s.totalSpawns).toBe(1);
  });

  it("neverWaitedRuns 数的是「派了活却一次没等」的 run（supervise 臂实测 3/3 在此）", () => {
    const rows = [
      tallyJoinLapse([spawned("w1"), status("w1", "done")], "waited.jsonl"),
      tallyJoinLapse([spawned("w1"), status("w1", "done"), waitCall("c1")], "waited2.jsonl"),
      tallyJoinLapse([call("c1", "read_file")], "no-worker.jsonl"),
    ];
    expect(summarizeRuns(rows).neverWaitedRuns).toBe(1);
  });

  it("样本宽度只数派过活的 run：掺进来的无 worker 目录不许把「样本很窄」这句稀释掉", () => {
    const rows = [
      tallyJoinLapse([spawned("w1"), status("w1", "done")], "exp/a.jsonl"),
      tallyJoinLapse([call("c1", "read_file")], "prod1/b.jsonl"),
      tallyJoinLapse([call("c2", "read_file")], "prod2/c.jsonl"),
      tallyJoinLapse([call("c3", "read_file")], "prod3/d.jsonl"),
    ];
    expect(summarizeRuns(rows).families).toBe(1); // 按全语料数会是 4 ⇒ 那句警告会被自己吞掉
  });

  it("反向一侧：两个目录各派过活 ⇒ 样本宽度真是 2（不许读成「只有一个实验」）", () => {
    const rows = [
      tallyJoinLapse([spawned("w1"), status("w1", "done")], "exp1/a.jsonl"),
      tallyJoinLapse([spawned("w1"), status("w1", "done")], "exp2/b.jsonl"),
      tallyJoinLapse([call("c1", "read_file")], "prod/c.jsonl"),
    ];
    expect(summarizeRuns(rows).families).toBe(2);
  });

  it("零 worker 语料 ⇒ 红着退出并说「不可测」，不许报 0/0 让人读成「占比是 0」", () => {
    const v = joinLapseVerdict(summarizeRuns([tallyJoinLapse([call("c1", "read_file")], "x.jsonl")]));
    expect(v.exitCode).toBe(1);
    expect(v.lines.join("\n")).toContain("不可测");
  });

  it("有 worker 且零在途 ⇒ 绿，且文案点名「那道闸一次也不会触发」（W1b 的裁决语）", () => {
    const v = joinLapseVerdict(summarizeRuns([tallyJoinLapse([spawned("w1"), status("w1", "done")], "a.jsonl")]));
    expect(v.exitCode).toBe(0);
    expect(v.lines.join("\n")).toContain("一次也不会触发");
  });

  it("有在途 ⇒ 绿着退出（有数可判就是有效读数），并把比值打出来", () => {
    const v = joinLapseVerdict(summarizeRuns([tallyJoinLapse([spawned("w1"), status("w1", "running")], "a.jsonl")]));
    expect(v.exitCode).toBe(0);
    expect(v.lines.join("\n")).toContain("1/1");
  });
});

describe("join-lapse 的接线面", () => {
  it("两处 wait 工具名常量必须同值：本尺只 import 其一，另一支漂了要当场红", () => {
    expect(WAIT_TOOL_NAME).toBe(WAIT_FOR_AGENTS_TOOL);
  });

  it("已在复跑面登记表里（登记 = 有文档引用它，docs-check D-8 两侧都盯）", () => {
    const ids = REPLAY_READINGS.map((r) => r.id);
    expect(ids).toContain("join-lapse");
    expect(new Set(ids).size).toBe(ids.length);
    const row = REPLAY_READINGS.find((r) => r.id === "join-lapse");
    expect(existsSync(new URL("../" + (row?.script ?? ""), import.meta.url))).toBe(true);
  });
});

// 产品口径那份事件流是有类型的；这里只用来对照「在途数」，故按最小形状断言即可。
function rowProbeEvents(raws: readonly unknown[]) {
  return raws as unknown as Parameters<typeof interruptedWorkers>[0];
}
function waitResult(id: string, ok: boolean) {
  return [{ type: "tool_result", callId: id, ok, output: "x" }];
}
