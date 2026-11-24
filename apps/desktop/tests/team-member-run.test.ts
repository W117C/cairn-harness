import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MemberProfile } from "../../../src/agent/team/members";
import { createEventLog } from "../../../src/events";
import { createSession, pathOf, readSessionEvents } from "../../../src/main/sessions";
import { startRosterMember } from "../src/main/team-member-run";

let root: string | null = null;
afterEach(async () => {
  if (root !== null) await rm(root, { recursive: true, force: true });
  root = null;
});

const emptyGrants = { grants: [], rejected: [], requests: [] };
const member = (fields: Partial<MemberProfile> = {}): MemberProfile => ({
  id: "m1",
  name: "成员一",
  role: "执行者",
  tier: "auto",
  memoryScope: "team",
  capabilities: [],
  ...fields,
});

describe("roster 成员起跑生产服务", () => {
  it("成员档位与 model/thinking/workdir 进入真实会话和 run；全局更宽不放宽成员", async () => {
    root = await mkdtemp(join(tmpdir(), "cairn-roster-profile-"));
    const workspacePath = join(root, "workspace");
    await mkdir(workspacePath, { recursive: true });
    const workspace = await realpath(workspacePath);
    const workdir = join(workspace, "packages", "member");
    await mkdir(workdir, { recursive: true });
    const sessionsRoot = join(workdir, ".agent", "sessions");
    const run = vi.fn(async () => ({ ok: true }));
    const create = vi.fn(async (sessionsRootForRun: string) => await createSession(sessionsRootForRun));
    const sessionsRootFor = vi.fn(async () => sessionsRoot);
    const hasWorkspace = vi.fn((candidate: string) => candidate === workspace || candidate === workdir);

    const result = await startRosterMember(
      {
        sessionsRootFor,
        member: member({ model: "member-model", thinking: "high", workdir }),
        task: "按成员档案执行",
        maxMode: "full-access",
        workspace,
      },
      {
        createSession: create,
        append: (path, event) => createEventLog(path).append(event),
        pathOf,
        run,
        grants: emptyGrants,
        envTarget: {},
        envSource: {},
        hasWorkspace,
      },
    );

    expect(result).toMatchObject({ ok: true, sessionsRoot });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith({
      message: "按成员档案执行",
      mode: "auto",
      sessionId: result.sessionId,
      workspace: workdir,
      model: "member-model",
      thinking: "high",
    });
    expect(sessionsRootFor).toHaveBeenCalledWith(workdir);
    expect(create).toHaveBeenCalledWith(sessionsRoot);
    expect(await readSessionEvents(sessionsRoot, String(result.sessionId))).toEqual([
      expect.objectContaining({ type: "session_meta_update", patch: { member: "m1" } }),
    ]);
  });

  it("已登记的子 workspace 成为执行根；会话只建在该根的 .agent/sessions", async () => {
    root = await mkdtemp(join(tmpdir(), "cairn-roster-child-"));
    const workspacePath = join(root, "workspace");
    await mkdir(workspacePath, { recursive: true });
    const workspace = await realpath(workspacePath);
    const executionWorkspacePath = join(workspace, "packages", "worker");
    await mkdir(executionWorkspacePath, { recursive: true });
    const executionWorkspace = await realpath(executionWorkspacePath);
    const parentSessionsRoot = join(workspace, ".agent", "sessions");
    const executionSessionsRoot = join(executionWorkspace, ".agent", "sessions");
    const run = vi.fn(async () => ({ ok: true }));
    const sessionsRootFor = vi.fn(async (candidate: string) =>
      candidate === executionWorkspace ? executionSessionsRoot : undefined);
    const hasWorkspace = vi.fn((candidate: string) => candidate === executionWorkspace);

    const result = await startRosterMember(
      {
        sessionsRootFor,
        member: member({ workdir: join(workspace, "packages", "worker") }),
        task: "在子工作区执行",
        maxMode: "default",
        workspace,
      },
      {
        createSession: (candidate) => createSession(candidate),
        append: (path, event) => createEventLog(path).append(event),
        pathOf,
        run,
        grants: emptyGrants,
        envTarget: {},
        envSource: {},
        hasWorkspace,
      },
    );

    expect(result).toMatchObject({ ok: true, sessionsRoot: executionSessionsRoot });
    expect(hasWorkspace).toHaveBeenCalledExactlyOnceWith(executionWorkspace);
    expect(sessionsRootFor).toHaveBeenCalledWith(executionWorkspace);
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ workspace: executionWorkspace }));
    await expect(stat(parentSessionsRoot)).rejects.toMatchObject({ code: "ENOENT" });
    const sessionPath = pathOf(executionSessionsRoot, String(result.sessionId));
    expect(await readFileSync(sessionPath, "utf8")).toContain('"member":"m1"');
  });

  it("无 workdir 时 workspace 别名/软链先规范化，再登记并派发到同一执行根", async () => {
    root = await mkdtemp(join(tmpdir(), "cairn-roster-alias-"));
    const workspacePath = join(root, "workspace");
    const aliasPath = join(root, "workspace-alias");
    await mkdir(workspacePath, { recursive: true });
    await symlink(workspacePath, aliasPath, "dir");
    const workspace = await realpath(workspacePath);
    const sessionsRoot = join(workspace, ".agent", "sessions");
    const run = vi.fn(async () => ({ ok: true }));
    const create = vi.fn(async (candidate: string) => await createSession(candidate));
    const sessionsRootFor = vi.fn(async (candidate: string) =>
      candidate === workspace ? sessionsRoot : undefined);
    const hasWorkspace = vi.fn((candidate: string) => candidate === workspace);

    const result = await startRosterMember(
      {
        sessionsRootFor,
        member: member(),
        task: "从规范化执行根起跑",
        maxMode: "full-access",
        workspace: aliasPath,
      },
      {
        createSession: create,
        append: (path, event) => createEventLog(path).append(event),
        pathOf,
        run,
        grants: emptyGrants,
        envTarget: {},
        envSource: {},
        hasWorkspace,
      },
    );

    expect(result).toMatchObject({ ok: true, sessionsRoot });
    expect(hasWorkspace).toHaveBeenCalledExactlyOnceWith(workspace);
    expect(sessionsRootFor).toHaveBeenCalledExactlyOnceWith(workspace);
    expect(create).toHaveBeenCalledExactlyOnceWith(sessionsRoot);
    expect(run).toHaveBeenCalledExactlyOnceWith({
      message: "从规范化执行根起跑",
      mode: "auto",
      sessionId: result.sessionId,
      workspace,
    });
  });

  it("workdir 未登记时 fail-closed：不建会话、不写 JSONL、不调 run", async () => {
    root = await mkdtemp(join(tmpdir(), "cairn-roster-unregistered-"));
    const workspacePath = join(root, "workspace");
    await mkdir(workspacePath, { recursive: true });
    const workspace = await realpath(workspacePath);
    const workdir = join(workspace, "packages", "unregistered");
    await mkdir(workdir, { recursive: true });
    const create = vi.fn(async (candidate: string) => await createSession(candidate));
    const append = vi.fn(async () => undefined);
    const run = vi.fn(async () => ({ ok: true }));
    const sessionsRootFor = vi.fn(async () => join(workdir, ".agent", "sessions"));

    const result = await startRosterMember(
      {
        sessionsRootFor,
        member: member({ workdir }),
        task: "未登记工作区不许跑",
        maxMode: "full-access",
        workspace,
      },
      {
        createSession: create,
        append,
        pathOf,
        run,
        grants: emptyGrants,
        envTarget: {},
        envSource: {},
        hasWorkspace: () => false,
      },
    );

    expect(result.ok).toBe(false);
    expect(String(result.error)).toContain("未注册");
    expect(create).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    expect(sessionsRootFor).not.toHaveBeenCalled();
  });
});

describe("teamMemberStart 生产接线见证", () => {
  it("桌面入口把真实成员、全局上限和已登记工作区闸交给生产服务", () => {
    const main = readFileSync(new URL("../src/main/index.ts", import.meta.url), "utf8");
    const start = main.indexOf("teamMemberStart:");
    const end = main.indexOf("teamGroupCreate:", start);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const handler = main.slice(start, end);
    expect(handler).toContain("resolveProvidedWorkspace(workspace, await knownProjectRoots(), workspaceContext())");
    expect(handler).toContain("if (!gate.ok) return { ok: false, error: gate.error }");
    expect(handler).toContain("if (gate.workspace === null) return { ok: false, error: \"没有可用的工作区\" }");
    expect(handler).toContain("startRosterMember(");
    expect(handler).toContain("member,");
    expect(handler).toContain("maxMode: settings.mode");
    expect(handler).toContain("workspace: gate.workspace");
    expect(handler).toContain("hasWorkspace: host.hasWorkspace");
    expect(handler).not.toContain("mode: settings.mode");
    expect(handler).not.toContain("getLastWorkspace");
    expect(handler).not.toContain("process.cwd");
  });
});
