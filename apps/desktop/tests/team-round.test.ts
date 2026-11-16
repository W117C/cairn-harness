// 群的一轮判卷（v65）：轮次序号落群会话补丁，下一位发言者按名单轮转。
//
// 判的是什么：
//   ① 第一次推进 ⇒ 第 1 轮、发言人＝名单第 1 位；第二次 ⇒ 第 2 轮、第 2 位；绕回名单末尾后回到第 1 位；
//   ② 轮次从**日志**读（重开同一份日志得同一个数），不是内存态；
//   ③ 空名单拒；非法成员 id 被过滤（不参与轮转）；
//   ④ 写补丁失败如实交回（不假装推进成功）。
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { advanceGroupRound, groupTaskOf, roundOf } from "../src/main/team-round";
import { createEventLog, type AgentEvent } from "../../../src/events";
import { readSessionEvents } from "../../../src/main/sessions";
import { pathOf } from "../../../src/main/sessions";
import { groupOfSession, createTeamGroup } from "../src/main/team-group";

let root: string | null = null;
afterEach(async () => { if (root !== null) await rm(root, { recursive: true, force: true }); root = null; });

const deps = { read: readSessionEvents, append: (p: string, e: AgentEvent) => createEventLog(p).append(e), pathOf };

async function group(): Promise<{ root: string; id: string }> {
  root = await mkdtemp(join(tmpdir(), "cairn-round-"));
  const created = await createTeamGroup({ sessionsRoot: root, name: "攻坚" });
  return { root, id: String(created.sessionId) };
}

describe("群的一轮", () => {
  it("轮转：第 1 轮 → 名单第 1 位；第 2 轮 → 第 2 位；绕回第 1 位", async () => {
    const { root: r, id } = await group();
    const members = ["m1", "m2", "m3"];
    expect(await advanceGroupRound({ sessionsRoot: r, sessionId: id, memberIds: members }, deps))
      .toEqual({ ok: true, round: 1, speaker: "m1" });
    expect(await advanceGroupRound({ sessionsRoot: r, sessionId: id, memberIds: members }, deps))
      .toEqual({ ok: true, round: 2, speaker: "m2" });
    await advanceGroupRound({ sessionsRoot: r, sessionId: id, memberIds: members }, deps);
    expect(await advanceGroupRound({ sessionsRoot: r, sessionId: id, memberIds: members }, deps))
      .toEqual({ ok: true, round: 4, speaker: "m1" });
  });

  it("轮次从日志读：重开同一份日志得同一个数", async () => {
    const { root: r, id } = await group();
    await advanceGroupRound({ sessionsRoot: r, sessionId: id, memberIds: ["m1"] }, deps);
    const events = await readSessionEvents(r, id);
    expect(roundOf(events)).toBe(1);
    // 群标记还在（轮次没有把群身份覆盖掉）
    expect(await groupOfSession(r, id)).toEqual({ name: "攻坚" });
  });

  it("空名单 / 全是非法 id ⇒ 拒", async () => {
    const { root: r, id } = await group();
    expect((await advanceGroupRound({ sessionsRoot: r, sessionId: id, memberIds: [] }, deps)).ok).toBe(false);
    expect((await advanceGroupRound({ sessionsRoot: r, sessionId: id, memberIds: ["a.b"] }, deps)).ok).toBe(false);
  });

  it("写补丁失败 ⇒ 如实交回", async () => {
    const result = await advanceGroupRound(
      { sessionsRoot: "/ws", sessionId: "s1", memberIds: ["m1"] },
      { read: async () => [], append: async () => { throw new Error("磁盘只读"); }, pathOf: () => "/dev/null" },
    );
    expect(result).toEqual({ ok: false, error: "磁盘只读" });
  });
});

describe("群里这一轮要干什么", () => {
  it("取最后一条 user_message 当任务书；没有就 null", () => {
    const events = [
      { type: "user_message", content: "旧话题" },
      { type: "assistant_message", content: "收到" },
      { type: "user_message", content: "把壁纸对比度再量一遍" },
    ] as never[];
    expect(groupTaskOf(events)).toBe("把壁纸对比度再量一遍");
    expect(groupTaskOf([{ type: "assistant_message", content: "只有回复" }] as never[])).toBeNull();
    expect(groupTaskOf([] as never[])).toBeNull();
    // 空白不算一句话
    expect(groupTaskOf([{ type: "user_message", content: "   " }] as never[])).toBeNull();
  });
});
