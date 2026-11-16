// 团队档案落点判卷（ADR 0015 §五 B3：registry＝投影）。
//
// 判的是什么：
//   ① 没有 team.json：写的是事件日志里的补丁，读的是投影；
//   ② 同一份日志重放两次得同一份名单（投影不是第二真源）；
//   ③ 移除＝写墓碑（removed=1），历史不删，重放仍能还原「谁被删过」；
//   ④ 全新用户没有日志 ⇒ 空名单，不是错误。
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendTeamPatch, readTeamRecords, readTeamRoster, teamLogPath } from "../src/main/team-store";
import { memberPatch } from "../../../src/agent/team/members";

let dir: string | null = null;
afterEach(async () => { if (dir !== null) await rm(dir, { recursive: true, force: true }); dir = null; });

async function scratch(): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), "cairn-team-"));
  return teamLogPath(dir);
}

describe("团队档案落点", () => {
  it("全新用户：没有日志 ⇒ 空名单（不是错误）", async () => {
    const path = await scratch();
    expect(await readTeamRecords(path)).toEqual([]);
    const roster = await readTeamRoster(path, "guided");
    expect(roster.members).toEqual([]);
    expect(roster.records).toBe(0);
  });

  it("写一条档案 ⇒ 读得到；名单是投影，不是文件", async () => {
    const path = await scratch();
    await appendTeamPatch(path, memberPatch("m1", { name: "阿岚", role: "调研", tier: "guided" }));
    const records = await readTeamRecords(path);
    expect(records).toHaveLength(1);
    expect(Object.keys(records[0]!.patch)).toContain("member.m1.name");
    const roster = await readTeamRoster(path, "guided");
    expect(roster.members).toEqual([
      { id: "m1", name: "阿岚", role: "调研", tier: "guided", capabilities: [] },
    ]);
  });

  it("同一份日志读两次逐字相同（可重建）", async () => {
    const path = await scratch();
    await appendTeamPatch(path, memberPatch("m1", { name: "A", role: "r" }));
    await appendTeamPatch(path, memberPatch("m2", { name: "B", role: "r", tier: "auto" }));
    expect(await readTeamRoster(path, "guided")).toEqual(await readTeamRoster(path, "guided"));
  });

  it("移除＝写墓碑：名单里没了，历史还在（补丁条数只增不减）", async () => {
    const path = await scratch();
    await appendTeamPatch(path, memberPatch("m1", { name: "A", role: "r" }));
    await appendTeamPatch(path, memberPatch("m1", { removed: "1" }));
    const roster = await readTeamRoster(path, "guided");
    expect(roster.members).toEqual([]);
    expect(roster.records).toBe(2);
    // 历史仍在日志里：两条补丁都能读回来
    const records = await readTeamRecords(path);
    expect(records.map((r) => r.at)).toEqual([1, 2]);
  });

  it("越权档位按团队档裁剪并出声", async () => {
    const path = await scratch();
    await appendTeamPatch(path, memberPatch("m1", { name: "A", role: "r", tier: "full-access" }));
    const roster = await readTeamRoster(path, "read-only");
    expect(roster.members[0]!.tier).toBe("read-only");
    expect(roster.clamped).toEqual([{ id: "m1", requested: "full-access", applied: "read-only" }]);
  });

  it("空补丁拒写（没有任何键的补丁是写侧 bug）", async () => {
    const path = await scratch();
    await expect(appendTeamPatch(path, {})).rejects.toThrow(/空/);
  });
});
