import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEventLog, replay } from "../src/events";
import {
  handleProjectAdd,
  handleProjectList,
  handleProjectRemove,
  handleSessionAssignProject,
  handleSessionCreate,
  handleSessionDelete,
  handleSessionFork,
  handleSessionList,
  handleSessionOpen,
  handleSessionRename,
  handleSessionRevert,
  handleSessionSetArchived,
  handleSessionSetPinned,
  initSessionsDir,
} from "../src/main/session-handlers";
import { initSettingsStore, store } from "../src/main/settings-handlers";
import { setRunWorkspace } from "../src/main/runner-workspace";
import { SessionMetadataRepository } from "../src/main/session-metadata";
import { createSession, pathOf } from "../src/main/sessions";

let root = "";
let sessionsDir = "";
let projectRegistryPath = "";
let metadataPath = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "dsh-session-organization-"));
  sessionsDir = join(root, "user-data", "sessions");
  projectRegistryPath = join(root, "user-data", "projects.json");
  metadataPath = join(root, "user-data", "session-metadata.json");
  initSessionsDir(sessionsDir, { projectRegistryPath, sessionMetadataPath: metadataPath });
  initSettingsStore(join(root, "user-data", "settings.json"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe("CX-01 session/project organization handlers", () => {
  it("keeps archive/pin/project authoritative in sidecar metadata without changing JSONL", async () => {
    const workspace = join(root, "workspace");
    await mkdir(workspace);
    const project = await handleProjectAdd({ name: "Forge", path: workspace });
    const { id } = await handleSessionCreate("真实会话");
    const logPath = pathOf(sessionsDir, id);
    await createEventLog(logPath).append({ type: "user_message", content: "unchanged" });
    const before = await readFile(logPath);

    await handleSessionSetPinned(id, true);
    await handleSessionSetArchived(id, true);
    await handleSessionAssignProject(id, project.id);
    expect(await readFile(logPath)).toEqual(before);

    // Simulate restart: repositories are reconstructed from the same userData files.
    initSessionsDir(sessionsDir, { projectRegistryPath, sessionMetadataPath: metadataPath });
    expect(await handleSessionList()).toEqual([
      expect.objectContaining({
        id,
        title: id,
        pinned: true,
        archived: true,
        projectId: project.id,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      }),
    ]);

    await handleSessionSetArchived(id, false);
    initSessionsDir(sessionsDir, { projectRegistryPath, sessionMetadataPath: metadataPath });
    expect((await handleSessionList())[0]).toMatchObject({ pinned: true, archived: false, projectId: project.id });
  });

  it("renames through the existing session path and follows the metadata title", async () => {
    const { id } = await handleSessionCreate("旧名");
    await handleSessionSetPinned(id, true);
    expect(await handleSessionRename(id, "新名")).toEqual({ id: "新名" });

    const listed = await handleSessionList();
    expect(listed).toEqual([expect.objectContaining({ id: "新名", title: "新名", pinned: true })]);
  });

  it("forks at round N（v2.15 IPC）：源只读、前缀一致、末条 branch_of，越界 fail-visible 不留半成品", async () => {
    const { id } = await handleSessionCreate("源会话");
    const logPath = pathOf(sessionsDir, id);
    const log = createEventLog(logPath);
    await log.append({ type: "user_message", content: "第一轮" });
    await log.append({ type: "assistant_message", content: "回应一" });
    await log.append({ type: "user_message", content: "第二轮" });
    await log.append({ type: "assistant_message", content: "回应二" });
    const before = await readFile(logPath);
    const srcEvents = await replay(logPath);

    const r = await handleSessionFork(id, 1);
    expect(r.ok, r.error).toBe(true);
    expect(r.id).toBe(id + "-f1");
    // 源会话只读：字节不变
    expect(await readFile(logPath)).toEqual(before);

    const forked = await replay(pathOf(sessionsDir, r.id!));
    // 前缀一致 + 末条 = session_meta{branch_of: 源路径}
    expect(forked.slice(0, -1)).toEqual(srcEvents.slice(0, forked.length - 1));
    expect(forked[forked.length - 1]).toMatchObject({ type: "session_meta", branch_of: logPath });
    // 只保留第 1 轮（含）：各 1 条 user/assistant
    expect(forked.filter((e) => e.type === "user_message")).toHaveLength(1);
    expect(forked.filter((e) => e.type === "assistant_message")).toHaveLength(1);

    // 越界轮次：fail-visible，且不落任何文件（无半成品、无 .fork- 残渣）
    const bad = await handleSessionFork(id, 9);
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain("超出会话轮数");
    expect(await exists(pathOf(sessionsDir, id + "-f9"))).toBe(false);
    // 重复分叉同名目标：不覆盖既有转录
    const again = await handleSessionFork(id, 1);
    expect(again.ok).toBe(false);
    expect(again.error).toContain("已存在");
  });

  it("reverts a turn's main-session writes from on-disk snapshots (v2.16 IPC)", async () => {
    const workspace = join(root, "revert-ws");
    await mkdir(join(workspace, "src"), { recursive: true });
    const { id } = await handleSessionCreate("回滚会话");
    const logPath = pathOf(sessionsDir, id);
    const snapshotId = ".agent/snapshots/1--c1/src/a.txt";
    await mkdir(join(workspace, ".agent", "snapshots", "1--c1", "src"), { recursive: true });
    await writeFile(join(workspace, "src", "a.txt"), "NEW", "utf8"); // 本轮覆盖后的样子
    await writeFile(join(workspace, snapshotId), "OLD", "utf8"); // 覆盖前原件
    const log = createEventLog(logPath);
    await log.append({ type: "user_message", content: "改一下 a.txt" });
    await log.append({ type: "tool_call", id: "c1", name: "write_file", args: { path: "src/a.txt" } });
    await log.append({ type: "tool_result", callId: "c1", ok: true, output: "wrote", snapshotId, change: "modified" });

    setRunWorkspace(workspace);
    const r = await handleSessionRevert(id, 1);
    expect(r.ok, r.error).toBe(true);
    expect(r.restored).toEqual(["src/a.txt"]);
    expect(await readFile(join(workspace, "src", "a.txt"), "utf8")).toBe("OLD");

    // 没有已知工作区 ⇒ fail-visible，绝不拿内置靶子冒充用户工作区
    setRunWorkspace(null);
    const noWs = await handleSessionRevert(id, 1);
    expect(noWs.ok).toBe(false);
    expect(noWs.error).toContain("没有已知的工作区");
    // 越界轮次 ⇒ fail-visible（与分叉同一口径）
    setRunWorkspace(workspace);
    const bad = await handleSessionRevert(id, 9);
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain("超出会话轮数");
    setRunWorkspace(null);
  });

  it("does not invent metadata for legacy sessions or list sidecar-only records", async () => {
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(pathOf(sessionsDir, "legacy"), "{\"type\":\"user_message\",\"content\":\"old\"}\n", "utf8");
    const metadata = new SessionMetadataRepository(metadataPath);
    await metadata.create("sidecar-only", "幽灵");

    const listed = await handleSessionList();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: "legacy", lines: 1 });
    expect(listed[0]).not.toHaveProperty("pinned");
    expect(listed[0]).not.toHaveProperty("createdAt");
    expect(listed.map((session) => session.id)).not.toContain("sidecar-only");
  });

  it("removes project registration without deleting its directory and blocks new assignment to it", async () => {
    const workspace = join(root, "workspace");
    await mkdir(workspace);
    const project = await handleProjectAdd({ path: workspace });
    const { id } = await handleSessionCreate("member");

    await handleSessionAssignProject(id, project.id);
    await handleProjectRemove(project.id);
    expect(await handleProjectList()).toEqual([]);
    expect((await stat(workspace)).isDirectory()).toBe(true);
    await expect(handleSessionAssignProject(id, project.id)).rejects.toThrow(/已移除/);
    const unassigned = await handleSessionAssignProject(id, null);
    expect(unassigned.id).toBe(id);
    expect(unassigned.projectId).toBeUndefined();
  });

  it("hard-deletes JSONL and metadata through one rollback-capable path and repairs currentSession", async () => {
    const { id } = await handleSessionCreate("delete-me");
    const logPath = pathOf(sessionsDir, id);
    await handleSessionOpen(id);
    expect((await store().get()).currentSession).toBe(id);

    await expect(handleSessionDelete(id)).resolves.toEqual({ currentSession: null });
    expect(await exists(logPath)).toBe(false);
    expect(await new SessionMetadataRepository(metadataPath).find(id)).toBeUndefined();
    expect((await store().get()).currentSession).toBeNull();
  });

  it("restores the JSONL when metadata cleanup fails, so a corrupt sidecar cannot masquerade as a successful hard delete", async () => {
    await mkdir(sessionsDir, { recursive: true });
    await mkdir(metadataPath, { recursive: true });
    const id = await createSession(sessionsDir, "keep-me");
    const logPath = pathOf(sessionsDir, id);

    await expect(handleSessionDelete(id)).rejects.toThrow();
    expect((await stat(logPath)).isFile()).toBe(true);
    expect((await store().get()).currentSession).toBeNull();
  });
});
