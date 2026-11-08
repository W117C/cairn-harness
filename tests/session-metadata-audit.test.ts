// 阶段 3 · 会话 sidecar 审计面（viewed / archived / idle / resumeAttempts）的判卷。
// 判的是两件容易做错的事：
//   ① 老 sidecar（本次改动之前写的）**原样加载**，新字段**保持缺席**（不补 0 / false / epoch 0）；
//   ② 缺席 `resumeAttempts` = **未记录（未知）**，与 `0`（记过、一次都没恢复过）是**两态**。
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
  root = await mkdtemp(join(tmpdir(), "dsh-session-audit-"));
  metadataPath = join(root, "user-data", "session-metadata.json");
  tick = 0;
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** 写一份「本次改动之前」的 sidecar：没有审计字段。 */
async function writeLegacySidecar(): Promise<void> {
  await mkdir(dirname(metadataPath), { recursive: true });
  const legacy = {
    version: 1,
    sessions: {
      "legacy-session": {
        id: "legacy-session",
        title: "老会话",
        pinned: true,
        archived: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
    },
  };
  await writeFile(metadataPath, JSON.stringify(legacy, null, 2) + "\n", "utf8");
}

describe("会话 sidecar 审计面", () => {
  it("mark viewed / archived / idle / resume 各自落盘并回读", async () => {
    const repository = new SessionMetadataRepository(metadataPath, { now });
    // `now` 是**计数钟**（每次调用推进 1 秒）⇒ 刻度是确定的，可以逐格钉死。
    // 刻度序：create() 取第 0 拍（22:13:20）⇒ 下面三次改动各取一拍。
    await repository.create("session-a", "标题");

    const viewed = await repository.markViewed("session-a");
    expect(viewed.viewedAt).toBe("2023-11-14T22:13:21.000Z");

    const archived = await repository.setArchived("session-a", true);
    expect(archived.archived).toBe(true);
    expect(archived.archivedAt).toBe("2023-11-14T22:13:22.000Z");

    const idle = await repository.markIdle("session-a");
    expect(idle.idleSince).toBe("2023-11-14T22:13:23.000Z");

    const resumed = await repository.recordResumeAttempt("session-a");
    expect(resumed.resumeAttempts).toBe(1);

    // 重开仓库（真读盘）后仍在
    const reloaded = new SessionMetadataRepository(metadataPath, { now });
    const record = await reloaded.get("session-a");
    expect(record.viewedAt).toBe("2023-11-14T22:13:21.000Z");
    expect(record.archivedAt).toBe("2023-11-14T22:13:22.000Z");
    expect(record.idleSince).toBe("2023-11-14T22:13:23.000Z");
    expect(record.resumeAttempts).toBe(1);

    const audit = await reloaded.audit("session-a");
    expect(audit).toEqual({
      viewedAt: "2023-11-14T22:13:21.000Z",
      archivedAt: "2023-11-14T22:13:22.000Z",
      idleSince: "2023-11-14T22:13:23.000Z",
      resumeAttempts: 1,
    });
  });

  it("取消归档 ⇒ archivedAt 被摘掉（两格不许互相矛盾）", async () => {
    const repository = new SessionMetadataRepository(metadataPath, { now });
    await repository.create("session-a");
    await repository.setArchived("session-a", true);
    const unarchived = await repository.setArchived("session-a", false);
    expect(unarchived.archived).toBe(false);
    expect(unarchived.archivedAt).toBeUndefined();
    expect("archivedAt" in unarchived).toBe(false);
  });

  it("回到活跃 ⇒ idleSince 被摘掉（否则界面会一直说「还闲着」）", async () => {
    const repository = new SessionMetadataRepository(metadataPath, { now });
    await repository.create("session-a");
    await repository.markIdle("session-a");
    const active = await repository.markActive("session-a");
    expect(active.idleSince).toBeUndefined();
    expect("idleSince" in active).toBe(false);
  });

  it("老 sidecar（没有审计字段）原样加载，新字段保持缺席", async () => {
    await writeLegacySidecar();
    const repository = new SessionMetadataRepository(metadataPath, { now });

    const record = await repository.get("legacy-session");
    expect(record.title).toBe("老会话");
    expect(record.pinned).toBe(true);
    // 缺席 ＝ 没记录过：**不许**补 0 / false / epoch 0。
    expect(record.viewedAt).toBeUndefined();
    expect(record.archivedAt).toBeUndefined();
    expect(record.idleSince).toBeUndefined();
    expect(record.resumeAttempts).toBeUndefined();
    expect("viewedAt" in record).toBe(false);
    expect("resumeAttempts" in record).toBe(false);

    const audit = await repository.audit("legacy-session");
    expect(audit).toEqual({});
  });

  it("resumeAttempts 缺席 ＝ 未知，与 0 是两态", async () => {
    const repository = new SessionMetadataRepository(metadataPath, { now });
    await repository.create("fresh");
    // 没记过 ⇒ undefined（未知），不是 0。
    expect(await repository.resumeAttemptsOf("fresh")).toBeUndefined();
    expect(await repository.resumeAttemptsOf("fresh")).not.toBe(0);

    // 第一次记录 ⇒ 1（从 0 起数会把「刚发生过一次」记成「一次都没发生过」）。
    await repository.recordResumeAttempt("fresh");
    expect(await repository.resumeAttemptsOf("fresh")).toBe(1);
    await repository.recordResumeAttempt("fresh");
    expect(await repository.resumeAttemptsOf("fresh")).toBe(2);
  });

  it("审计字段非法 ⇒ 仍然 fail-loud（不静默重置成假状态）", async () => {
    await mkdir(dirname(metadataPath), { recursive: true });
    await writeFile(
      metadataPath,
      JSON.stringify({
        version: 1,
        sessions: {
          bad: {
            id: "bad",
            title: "坏记录",
            pinned: false,
            archived: false,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            viewedAt: "not-a-timestamp",
          },
        },
      }),
      "utf8",
    );
    const repository = new SessionMetadataRepository(metadataPath, { now });
    await expect(repository.list()).rejects.toBeInstanceOf(SessionMetadataCorruptError);
    // 坏文件不许被覆盖成默认状态。
    expect(await readFile(metadataPath, "utf8")).toContain("not-a-timestamp");
  });
});
