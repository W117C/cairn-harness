import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEventLog } from "../src/events";
import {
  handleProjectAdd,
  handleProjectList,
  handleProjectRemove,
  handleSessionAssignProject,
  handleSessionCreate,
  handleSessionDelete,
  handleSessionList,
  handleSessionOpen,
  handleSessionRename,
  handleSessionSetArchived,
  handleSessionSetPinned,
  initSessionsDir,
} from "../src/main/session-handlers";
import { initSettingsStore, store } from "../src/main/settings-handlers";
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
