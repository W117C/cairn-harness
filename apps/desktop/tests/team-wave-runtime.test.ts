// 群生产波次判卷：真实临时 JSONL、真实成员会话与真实串行闸；只把模型 run 换成假实现。
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MemberProfile } from "../../../src/agent/team/members";
import { createEventLog, type AgentEvent } from "../../../src/events";
import { createSession, pathOf, readSessionEvents } from "../../../src/main/sessions";
import { memberOfSession, type StartRun } from "../src/main/team-dispatch";
import { createRunLock } from "../src/main/member-run-lock";
import {
  runTeamGroupWave,
  type GroupWaveRuntimeDeps,
  type GroupWaveRuntimeInput,
} from "../src/main/team-wave-runtime";

let root: string | null = null;
afterEach(async () => {
  if (root !== null) await rm(root, { recursive: true, force: true });
  root = null;
});

const emptyGrants = { grants: [], rejected: [], requests: [] };
const member = (id: string): MemberProfile => ({
  id,
  name: `成员 ${id}`,
  role: "执行者",
  tier: "auto",
  memoryScope: "team",
  capabilities: [],
});

async function fixture() {
  root = await mkdtemp(join(tmpdir(), "cairn-group-wave-"));
  const workspacePath = join(root, "workspace");
  await mkdir(workspacePath, { recursive: true });
  const workspace = await realpath(workspacePath);
  const sessionsRoot = join(workspace, ".agent", "sessions");
  const memberSessionsRoot = join(workspace, ".agent", "member-sessions");
  const append = async (path: string, event: AgentEvent) => await createEventLog(path).append(event);
  const newGroup = async (name: string) => {
    const sessionId = await createSession(sessionsRoot, name);
    await append(pathOf(sessionsRoot, sessionId), { type: "user_message", content: "一起看下" });
    return sessionId;
  };
  return { workspace, sessionsRoot, memberSessionsRoot, append, newGroup };
}

function inputOf(
  fixtureValue: Awaited<ReturnType<typeof fixture>>,
  sessionId: string,
  speakers: readonly string[],
): GroupWaveRuntimeInput {
  return {
    sessionsRoot: fixtureValue.sessionsRoot,
    sessionId,
    workspace: fixtureValue.workspace,
    members: speakers.map(member),
    maxMode: "auto",
    speakers,
    task: "一起看下",
  };
}

function depsOf(
  fixtureValue: Awaited<ReturnType<typeof fixture>>,
  run: StartRun,
  extra: Partial<GroupWaveRuntimeDeps> = {},
): GroupWaveRuntimeDeps {
  return {
    createSession: (candidate) => createSession(candidate),
    append: fixtureValue.append,
    pathOf,
    run,
    grants: emptyGrants,
    sessionsRootFor: async () => fixtureValue.memberSessionsRoot,
    hasWorkspace: (candidate) => candidate === fixtureValue.workspace,
    ...extra,
  };
}

describe("群生产波次", () => {
  it("真实共享流依次写下两条归属回复，第二位任务书看见第一位结论", async () => {
    const f = await fixture();
    const groupId = await f.newGroup("共享流");
    const tasks: string[] = [];
    const run: StartRun = async (req) => {
      tasks.push(req.message);
      const id = await memberOfSession(f.memberSessionsRoot, req.sessionId);
      await f.append(pathOf(f.memberSessionsRoot, req.sessionId), {
        type: "assistant_message",
        content: id === "m1" ? "m1 的结论" : "m2 的结论",
      });
      return { ok: true };
    };

    const result = await runTeamGroupWave(inputOf(f, groupId, ["m1", "m2"]), depsOf(f, run));

    expect(result.ok).toBe(true);
    expect(result.ran.map((entry) => entry.memberId)).toEqual(["m1", "m2"]);
    expect(result.ran[1]?.sawPrior).toBe(true);
    expect(tasks[1]).toContain("member:m1：m1 的结论");
    const groupEvents = await readSessionEvents(f.sessionsRoot, groupId);
    expect(groupEvents.filter((event) => event.type === "assistant_message")).toEqual([
      expect.objectContaining({ type: "assistant_message", content: "m1 的结论", agent_id: "member:m1" }),
      expect.objectContaining({ type: "assistant_message", content: "m2 的结论", agent_id: "member:m2" }),
    ]);
  });

  it("不同群会话并发共用真实注入闸，密钥可见窗口不重叠且收束后撤销", async () => {
    const f = await fixture();
    const [firstGroup, secondGroup] = await Promise.all([f.newGroup("并发一"), f.newGroup("并发二")]);
    const lock = createRunLock();
    const envTarget: Record<string, string | undefined> = {};
    const envSource = { TOKEN: "test-only" };
    const grants = {
      grants: [
        { memberId: "m1", secret: "TOKEN", allow: true, at: 1 },
        { memberId: "m2", secret: "TOKEN", allow: true, at: 2 },
      ],
      rejected: [],
      requests: [],
    };
    let releaseFirst!: () => void;
    let markFirstEntered!: () => void;
    const firstEntered = new Promise<void>((resolve) => { markFirstEntered = resolve; });
    const firstBlocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let active = 0;
    let maxActive = 0;
    const seen = new Map<string, Record<string, string | undefined>>();
    const run: StartRun = async (req) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      const id = await memberOfSession(f.memberSessionsRoot, req.sessionId);
      seen.set(String(id), { ...envTarget });
      if (id === "m1") {
        markFirstEntered();
        await firstBlocked;
      }
      await f.append(pathOf(f.memberSessionsRoot, req.sessionId), {
        type: "assistant_message",
        content: `${String(id)} 完成`,
      });
      active -= 1;
      return { ok: true };
    };
    const deps = depsOf(f, run, { lock, grants, envTarget, envSource });

    const firstWave = runTeamGroupWave(inputOf(f, firstGroup, ["m1"]), deps);
    await firstEntered;
    const secondWave = runTeamGroupWave(inputOf(f, secondGroup, ["m2"]), deps);
    await vi.waitFor(() => expect(lock.pending()).toBe(1));
    expect(lock.current()).toBe("m1");
    expect(envTarget.DSH_SECRET_TOKEN).toBe("test-only");
    releaseFirst();
    const [firstResult, secondResult] = await Promise.all([firstWave, secondWave]);

    expect(firstResult.ok).toBe(true);
    expect(secondResult.ok).toBe(true);
    expect(maxActive).toBe(1);
    expect(seen.get("m1")).toEqual({ DSH_SECRET_TOKEN: "test-only" });
    expect(seen.get("m2")).toEqual({ DSH_SECRET_TOKEN: "test-only" });
    expect(envTarget).toEqual({});
    for (const [groupId, agentId] of [[firstGroup, "member:m1"], [secondGroup, "member:m2"]] as const) {
      const events = await readSessionEvents(f.sessionsRoot, groupId);
      expect(events.filter((event) => event.type === "assistant_message")).toEqual([
        expect.objectContaining({ agent_id: agentId }),
      ]);
    }
  });

  it("成员 run 成功但没有 assistant 时停波次，不写空回复也不跑后一位", async () => {
    const f = await fixture();
    const groupId = await f.newGroup("无最终回复");
    const run = vi.fn<StartRun>(async () => ({ ok: true }));

    const result = await runTeamGroupWave(inputOf(f, groupId, ["m1", "m2"]), depsOf(f, run));

    expect(result).toEqual({
      ok: false,
      ran: [{ memberId: "m1", sessionId: expect.any(String), sawPrior: false }],
      failed: { memberId: "m1", error: "成员收束后没有最终回复" },
    });
    expect(run).toHaveBeenCalledTimes(1);
    const groupEvents = await readSessionEvents(f.sessionsRoot, groupId);
    expect(groupEvents.filter((event) => event.type === "assistant_message")).toEqual([]);
  });
});
