import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SessionMetadataCorruptError,
  SessionMetadataRepository,
} from "../src/main/session-metadata";

let root = "";
let metadataPath = "";
let tick = 0;
const now = (): Date => new Date(1_700_000_000_000 + tick++ * 1_000);

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "dsh-session-metadata-"));
  metadataPath = join(root, "user-data", "session-metadata.json");
  tick = 0;
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("CX-01 SessionMetadataRepository", () => {
  it("persists pin/archive/project state and unarchive across reload", async () => {
    const repository = new SessionMetadataRepository(metadataPath, { now });
    const created = await repository.create("session-a", "真实标题");
    expect(created).toMatchObject({ id: "session-a", title: "真实标题", pinned: false, archived: false });

    await repository.setPinned("session-a", true);
    const archived = await repository.setArchived("session-a", true);
    await repository.assignProject("session-a", "project-1");
    expect(archived.archived).toBe(true);

    const reloaded = new SessionMetadataRepository(metadataPath, { now });
    expect(await reloaded.get("session-a")).toMatchObject({
      id: "session-a",
      title: "真实标题",
      pinned: true,
      archived: true,
      projectId: "project-1",
    });

    const restored = await reloaded.setArchived("session-a", false);
    expect(restored.archived).toBe(false);
    expect(restored.pinned).toBe(true);
    expect((await new SessionMetadataRepository(metadataPath).get("session-a")).archived).toBe(false);
  });

  it("queues concurrent mutations without dropping either organization fact", async () => {
    const repository = new SessionMetadataRepository(metadataPath, { now });
    await repository.create("session-a");
    await Promise.all([
      repository.setPinned("session-a", true),
      repository.setArchived("session-a", true),
    ]);

    expect(await repository.get("session-a")).toMatchObject({ pinned: true, archived: true });
  });

  it("renames metadata with the session while preserving pin/archive/project state", async () => {
    const repository = new SessionMetadataRepository(metadataPath, { now });
    await repository.create("old", "旧标题");
    await repository.setPinned("old", true);
    await repository.setArchived("old", true);
    await repository.assignProject("old", "project-1");

    const renamed = await repository.rename("old", "new", "新标题");
    expect(renamed).toMatchObject({
      id: "new",
      title: "新标题",
      pinned: true,
      archived: true,
      projectId: "project-1",
    });
    expect(await repository.find("old")).toBeUndefined();
    expect(await repository.find("new")).toEqual(renamed);
  });

  it("removes metadata, supports transactional restore, and treats a missing file as the empty default", async () => {
    const repository = new SessionMetadataRepository(metadataPath, { now });
    expect(await repository.list()).toEqual([]);
    const record = await repository.create("session-a", "标题");
    expect(await repository.remove("session-a")).toBe(true);
    expect(await repository.remove("session-a")).toBe(false);
    expect(await repository.find("session-a")).toBeUndefined();

    await repository.restore(record);
    expect(await repository.find("session-a")).toEqual(record);
  });

  it("fails closed on corrupt JSON or malformed records and never overwrites them with defaults", async () => {
    await mkdir(dirname(metadataPath), { recursive: true });
    await writeFile(metadataPath, "not-json", "utf8");
    const repository = new SessionMetadataRepository(metadataPath, { now });
    await expect(repository.list()).rejects.toBeInstanceOf(SessionMetadataCorruptError);
    await expect(repository.setPinned("session-a", true)).rejects.toBeInstanceOf(SessionMetadataCorruptError);
    expect(await readFile(metadataPath, "utf8")).toBe("not-json");

    await writeFile(metadataPath, JSON.stringify({ version: 1, sessions: { bad: { id: "bad" } } }), "utf8");
    await expect(repository.list()).rejects.toBeInstanceOf(SessionMetadataCorruptError);
    expect(await readFile(metadataPath, "utf8")).toContain('"bad"');
  });

  it("rejects invalid ids, titles, flags, and project references", async () => {
    const repository = new SessionMetadataRepository(metadataPath, { now });
    await expect(repository.create("bad/id")).rejects.toThrow(/id/);
    await expect(repository.create("session-a", "  ")).rejects.toThrow(/title/);
    expect(await repository.setPinned("legacy", true)).toMatchObject({ id: "legacy", pinned: true });
    // 合法会话名不得被对象原型键劫持（回归钉在 null-prototype state + hasOwn 读面）。
    expect(await repository.setPinned("constructor", true)).toMatchObject({ id: "constructor", pinned: true });
    expect((await new SessionMetadataRepository(metadataPath).get("constructor")).title).toBe("constructor");

    await repository.create("session-a");
    await expect(repository.create("session-a")).rejects.toThrow(/已存在/);
    await expect(repository.setPinned("session-a", "yes" as unknown as boolean)).rejects.toThrow(/pinned/);
    await expect(repository.assignProject("session-a", "bad/project")).rejects.toThrow(/projectId/);
  });
});
