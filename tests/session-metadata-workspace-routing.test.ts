import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  claimSessionMetadata,
  handleSessionDelete,
  handleSessionRename,
  handleSessionSetArchived,
  handleSessionSetPinned,
  initSessionsDir,
  listSessionMetadataForRoot,
  listUnattributedSessionMetadata,
  requireSessionMetadata,
  requireSessionMetadataFor,
  setSessionRootsProvider,
} from "../src/main/session-handlers";

let root = "";
let sessionsA = "";
let sessionsB = "";
const sessionId = "same-metadata-session";

async function seedSession(rootPath: string): Promise<void> {
  await mkdir(rootPath, { recursive: true });
  await writeFile(
    join(rootPath, `${sessionId}.jsonl`),
    JSON.stringify({ type: "user_message", content: "x" }) + "\n",
    "utf8",
  );
}

async function seedLegacyMetadata(overrides: Record<string, unknown> = {}): Promise<void> {
  const timestamp = "2026-01-01T00:00:00.000Z";
  await writeFile(join(sessionsA, "session-metadata.json"), JSON.stringify({
    version: 1,
    sessions: {
      [sessionId]: {
        id: sessionId,
        title: "旧标题",
        pinned: true,
        archived: false,
        createdAt: timestamp,
        updatedAt: timestamp,
        ...overrides,
      },
    },
  }, null, 2) + "\n", "utf8");
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cairn-metadata-routing-"));
  sessionsA = join(root, "a", ".agent", "sessions");
  sessionsB = join(root, "b", ".agent", "sessions");
  await seedSession(sessionsA);
  await seedSession(sessionsB);
  initSessionsDir(sessionsA);
  setSessionRootsProvider(() => [sessionsA, sessionsB]);
});

afterEach(async () => {
  setSessionRootsProvider(null);
  await rm(root, { recursive: true, force: true });
});

describe("会话 metadata 按会话根分卷", () => {
  it("两个工作区同 id：标题、置顶、归档各写各的卷", async () => {
    await requireSessionMetadataFor(sessionsA).setTitle(sessionId, "A 的标题");
    await requireSessionMetadataFor(sessionsB).setTitle(sessionId, "B 的标题");
    await handleSessionSetPinned(sessionId, true, sessionsA);
    await handleSessionSetArchived(sessionId, true, sessionsB);

    expect(await requireSessionMetadataFor(sessionsA).find(sessionId)).toMatchObject({
      title: "A 的标题",
      pinned: true,
      archived: false,
      workspaceScoped: true,
    });
    expect(await requireSessionMetadataFor(sessionsB).find(sessionId)).toMatchObject({
      title: "B 的标题",
      pinned: false,
      archived: true,
      workspaceScoped: true,
    });
  });

  it("重命名只迁移显式根：另一根的日志与 metadata 都不动", async () => {
    await requireSessionMetadataFor(sessionsA).setTitle(sessionId, "A");
    await requireSessionMetadataFor(sessionsB).setTitle(sessionId, "B");
    const renamed = "renamed-in-a";

    expect(await handleSessionRename(sessionId, renamed, sessionsA)).toEqual({ id: renamed });
    expect(await requireSessionMetadataFor(sessionsA).find(renamed)).toMatchObject({ title: renamed });
    expect(await requireSessionMetadataFor(sessionsA).find(sessionId)).toBeUndefined();
    expect(await requireSessionMetadataFor(sessionsB).find(sessionId)).toMatchObject({ title: "B" });
  });

  it("删除同 id 的一根只清这一根的 metadata，另一根保留", async () => {
    await requireSessionMetadataFor(sessionsA).setTitle(sessionId, "A");
    await requireSessionMetadataFor(sessionsB).setTitle(sessionId, "B");

    await handleSessionDelete(sessionId, sessionsA, [sessionsA, sessionsB]);
    expect(await requireSessionMetadataFor(sessionsA).find(sessionId)).toBeUndefined();
    expect(await requireSessionMetadataFor(sessionsB).find(sessionId)).toMatchObject({ title: "B" });
  });

  it("旧全局卷只在唯一归属时回退；首次写入项目根会搬迁并清除旧记录", async () => {
    // 装配根 A 的旧卷里有一条只可能属于 B 的记录（旧版桌面把所有根都写进这里）。
    await rm(join(sessionsA, `${sessionId}.jsonl`));
    await seedLegacyMetadata();

    const [fallback] = await listSessionMetadataForRoot(sessionsB);
    expect(fallback).toMatchObject({ title: "旧标题", pinned: true });
    expect(fallback?.workspaceScoped).toBeUndefined();

    await handleSessionSetArchived(sessionId, true, sessionsB);
    expect(await requireSessionMetadataFor(sessionsB).find(sessionId)).toMatchObject({
      title: "旧标题",
      pinned: true,
      archived: true,
      workspaceScoped: true,
    });
    expect(await requireSessionMetadata().find(sessionId)).toBeUndefined();
  });

  it("旧全局卷清理失败留下残留：读面只认项目根，再次写入不复活旧值", async () => {
    // 旧记录只可能属于 B（A 里的同名日志已移除）。第一次写入搬迁并清旧卷。
    await rm(join(sessionsA, `${sessionId}.jsonl`));
    await seedLegacyMetadata();
    await handleSessionSetPinned(sessionId, true, sessionsB);
    // 模拟 requireSessionMetadata().remove 失败/进程被杀：旧卷里那条没被清掉。
    await seedLegacyMetadata({ title: "旧卷残留", pinned: false });

    // 读面：本地卷有记录时，旧卷的重复 id 一律不进清单，也不覆盖 find。
    expect(await listSessionMetadataForRoot(sessionsB)).toEqual([
      expect.objectContaining({ id: sessionId, title: "旧标题", pinned: true, workspaceScoped: true }),
    ]);
    expect(await requireSessionMetadataFor(sessionsB).find(sessionId)).toMatchObject({ title: "旧标题" });

    // 再次写入：不把旧卷那条重新 adopt 进项目根，也不改写项目根的现有事实。
    await handleSessionSetArchived(sessionId, true, sessionsB);
    expect(await requireSessionMetadataFor(sessionsB).find(sessionId)).toMatchObject({
      title: "旧标题", pinned: true, archived: true, workspaceScoped: true,
    });
  });

  it("旧全局卷里的重复 id 无唯一归属 ⇒ 项目根不回退、不猜", async () => {
    await seedLegacyMetadata({ title: "归属不明" });

    expect(await listSessionMetadataForRoot(sessionsB)).toEqual([]);
  });
});

describe("重复 id 历史记录的裁决（不猜、可枚举、显式认领）", () => {
  it("两个根都有同 id：孤儿记录可枚举、带标题与原始事实，不自动选边", async () => {
    await seedLegacyMetadata({ title: "归属不明", pinned: true });

    const orphans = await listUnattributedSessionMetadata();
    expect(orphans).toEqual([
      expect.objectContaining({ id: sessionId, title: "归属不明", pinned: true }),
    ]);
    expect(orphans[0]?.workspaceScoped).toBeUndefined();
    // 枚举本身不写盘：两边仍读不到，旧卷原样保留。
    expect(await listSessionMetadataForRoot(sessionsA)).toEqual([]);
    expect(await listSessionMetadataForRoot(sessionsB)).toEqual([]);
    expect((await requireSessionMetadata().find(sessionId))?.title).toBe("归属不明");
  });

  it("单根 CLI 形态：根集合只有装配根自己，旧记录照旧读（不被新过滤误伤）", async () => {
    setSessionRootsProvider(null);
    await rm(join(sessionsB, `${sessionId}.jsonl`));
    await seedLegacyMetadata({ title: "单根旧标题" });

    expect(await listUnattributedSessionMetadata()).toEqual([]);
    expect(await listSessionMetadataForRoot(sessionsA)).toEqual([
      expect.objectContaining({ id: sessionId, title: "单根旧标题" }),
    ]);
  });

  it("唯一归属的旧记录不算孤儿（沿用既有回退，不需业主裁决）", async () => {
    await rm(join(sessionsA, `${sessionId}.jsonl`));
    await seedLegacyMetadata();

    expect(await listUnattributedSessionMetadata()).toEqual([]);
    expect(await listSessionMetadataForRoot(sessionsB)).toEqual([
      expect.objectContaining({ id: sessionId, title: "旧标题" }),
    ]);
  });

  it("显式认领到 B：B 读到带标记的记录，A 仍空，旧卷移出该 id", async () => {
    await seedLegacyMetadata({ title: "业主判给 B", pinned: true });

    const result = await claimSessionMetadata(sessionId, sessionsB);
    expect(result.ok).toBe(true);
    expect(result.record).toMatchObject({
      id: sessionId, title: "业主判给 B", pinned: true, workspaceScoped: true,
    });
    expect(await listSessionMetadataForRoot(sessionsB)).toEqual([
      expect.objectContaining({ id: sessionId, title: "业主判给 B", workspaceScoped: true }),
    ]);
    expect(await listSessionMetadataForRoot(sessionsA)).toEqual([]);
    expect(await requireSessionMetadata().find(sessionId)).toBeUndefined();
    expect(await listUnattributedSessionMetadata()).toEqual([]);
  });

  it("认领不覆盖目标根已有的权威记录：本地卷赢，旧卷记录清掉", async () => {
    await seedLegacyMetadata({ title: "旧标题", pinned: true });
    await requireSessionMetadataFor(sessionsB).setTitle(sessionId, "B 的新标题");

    const result = await claimSessionMetadata(sessionId, sessionsB);
    expect(result.ok).toBe(true);
    expect(result.record).toMatchObject({ title: "B 的新标题", workspaceScoped: true });
    expect(await listSessionMetadataForRoot(sessionsB)).toEqual([
      expect.objectContaining({ id: sessionId, title: "B 的新标题" }),
    ]);
    expect(await requireSessionMetadata().find(sessionId)).toBeUndefined();
  });

  it("拒绝路径：未登记根 / 根里没这条会话 / 没有旧记录 / 已落卷 / 非法 id 都不写盘", async () => {
    const foreignRoot = join(root, "not-registered", ".agent", "sessions");
    expect((await claimSessionMetadata(sessionId, foreignRoot)).ok).toBe(false);

    await seedLegacyMetadata();
    await rm(join(sessionsB, `${sessionId}.jsonl`));
    expect((await claimSessionMetadata(sessionId, sessionsB)).ok).toBe(false);
    expect((await requireSessionMetadata().find(sessionId))?.title).toBe("旧标题");
    expect(await requireSessionMetadataFor(sessionsB).find(sessionId)).toBeUndefined();

    await seedSession(sessionsB);
    await requireSessionMetadataFor(sessionsB).setTitle(sessionId, "已落卷");
    await requireSessionMetadata().remove(sessionId);
    expect((await claimSessionMetadata(sessionId, sessionsB)).ok).toBe(false);
    expect(await requireSessionMetadataFor(sessionsB).find(sessionId)).toMatchObject({ title: "已落卷" });

    expect((await claimSessionMetadata("bad id", sessionsB)).ok).toBe(false);
  });

  it("装配根旧卷里已有带标记的记录 ⇒ 明确拒绝「无需认领」，不改动任何卷", async () => {
    // 「这条记录已按根落卷，无需认领」是模型可见的能力断言：判据逐字点名它，
    // 让 promise-recall-inventory 的证人面有原句证人，而不是靠登记豁免。
    await seedLegacyMetadata({ title: "已按根落卷", workspaceScoped: true });

    const result = await claimSessionMetadata(sessionId, sessionsB);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("这条记录已按根落卷，无需认领") });
    expect((await requireSessionMetadata().find(sessionId))?.title).toBe("已按根落卷");
    expect(await requireSessionMetadataFor(sessionsB).find(sessionId)).toBeUndefined();
  });
});
