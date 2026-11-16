// 成员线程的身份判卷（ADR 0015 §四 第二件：成员会话归属）。
//
// 判的是什么：
//   ① 点了成员 ⇒ `agent_id = member:<id>`；没点 ⇒ 老路径 `worker-N`（逐字不变）；
//   ② id 不合法 ⇒ 拒，**不**悄悄退回匿名 worker；
//   ③ 反向解析：只有 `member:<合法 id>` 才算成员身份；
//   ④ 身份串起来：`scopesForAgent("member:m1")` 带三档，`memberIdOf` 与 `memberOfAgentId` 同答案。
import { describe, expect, it } from "vitest";
import { memberOfAgentId, spawnIdentity } from "../src/agent/team/identity";
import { memberIdOf, scopesForAgent } from "../src/agent/memory/scope";

describe("成员线程身份", () => {
  it("没点成员 ⇒ 老路径 worker-N", () => {
    const id = spawnIdentity(undefined, () => "worker-7");
    expect(id).toEqual({ ok: true, agentId: "worker-7", memberId: null });
  });

  it("点了成员 ⇒ member:<id>", () => {
    const id = spawnIdentity("m1", () => "worker-7");
    expect(id).toEqual({ ok: true, agentId: "member:m1", memberId: "m1" });
  });

  it("非法 id ⇒ 拒（不退化成匿名 worker）", () => {
    for (const bad of ["a.b", "a/b", "", "x".repeat(65), "成员"]) {
      const id = spawnIdentity(bad, () => "worker-7");
      if (bad === "") { expect(id.ok).toBe(true); continue; } // 空串 = 没点成员
      expect(id.ok).toBe(false);
      if (!id.ok) expect(id.error).toContain("成员 id");
    }
  });

  it("反向解析与记忆作用域同一答案", () => {
    expect(memberOfAgentId("member:m1")).toBe("m1");
    expect(memberOfAgentId("member:.bad")).toBeNull();
    expect(memberOfAgentId("worker-1")).toBeNull();
    expect(memberOfAgentId(undefined)).toBeNull();
    expect(memberIdOf("member:m1")).toBe("m1");
    expect(scopesForAgent("member:m1")).toEqual(["project", "team", "member"]);
  });
});

describe("成员身份 → 记忆读取（端到端一跳）", () => {
  it("成员线程读得到 members/<id> 的私有记忆；匿名 worker 读不到", async () => {
    const { mkdtemp, mkdir, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { initMemoryHome, globalMemoryDir } = await import("../src/agent/memory/store");
    const { writeTopic } = await import("../src/agent/memory/store");
    const { buildWorkerSystemMessages } = await import("../src/agent/worker-prompt");

    const root = await mkdtemp(join(tmpdir(), "cairn-member-identity-"));
    const home = join(root, "memory-home");
    const ws = join(root, "ws");
    try {
      await mkdir(home, { recursive: true });
      await mkdir(ws, { recursive: true });
      process.env.M2D_MEMORY_HOME = home;
      initMemoryHome(home);
      const memberDir = join(globalMemoryDir(), "members", "m1");
      await mkdir(memberDir, { recursive: true });
      await writeTopic(memberDir, "mine", "project", "成员私有的排期约定：周五前交付", "2026-11-16T00:00:00.000Z");

      const task = { task: "成员私有的排期约定", context: {} as never };
      const asMember = await buildWorkerSystemMessages(task, ws, "", "", "member:m1");
      const asWorker = await buildWorkerSystemMessages(task, ws, "", "", "worker-1");
      const textOf = (msgs: readonly { content: string }[]): string => msgs.map((m) => m.content).join("\n");
      expect(textOf(asMember)).toContain("周五前交付");
      expect(textOf(asWorker)).not.toContain("周五前交付");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
