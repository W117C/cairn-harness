// 还原（撤销此文件改动）之后**落一条事件**（2026-10-19 独立评审追出的真缺陷的主进程那一半）。
//
// 缺陷形状：还原只改盘上的文件、**不留任何事件**，而改动面（Inspector 的「改动」Tab、变更窗格、
// 顶栏 Changes 徽标、交付卡的「改动已验证」）**全部**从事件流投影 ⇒ 还原之后那一行仍写着"修改"、
// 仍提供"撤销"、徽标仍数着它、交付卡仍说"改动已验证"——而那个改动在盘上已经不存在了。
// 渲染侧的投影在 apps/desktop/tests/restore-drops-from-changes.test.ts；本文件管**主进程这一半**：
// 还原成功后必须真的往那个会话的事件流里落一条 `file_restored`。
//
// 判据是真跑的：真起会话、真写日志、真还原文件、再真读回事件流。
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { handleSnapshotRestore, initSessionsDir } from "../src/main/session-handlers";
import { createSession, pathOf } from "../src/main/sessions";
import { readSessionEvents } from "../src/main/sessions";
import { setRunWorkspace } from "../src/main/runner-workspace";
import { replay } from "../src/events";

const dirs: string[] = [];

afterEach(async () => {
  initSessionsDir("");
  setRunWorkspace(null);
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

/** 起一个会话目录 + 一个工作区，并在工作区里放一个"改过之前的原件"。 */
async function fixture(): Promise<{ sessionsDir: string; workspace: string; sessionId: string; target: string }> {
  const root = await mkdtemp(join(tmpdir(), "cairn-restore-"));
  dirs.push(root);
  const sessionsDir = join(root, "sessions");
  const workspace = join(root, "ws");
  await mkdtemp(join(root, "keep-")).catch(() => undefined);
  const { mkdir } = await import("node:fs/promises");
  await mkdir(sessionsDir, { recursive: true });
  await mkdir(join(workspace, ".agent", "snapshots"), { recursive: true });
  initSessionsDir(sessionsDir);
  setRunWorkspace(workspace);
  const sessionId = await createSession(sessionsDir, "还原判卷");
  const target = join(workspace, "a.ts");
  await writeFile(target, "原件\n", "utf8");
  // 快照目录：与 restoreSnapshot 的配对校验同口径（SNAPSHOT_ROOT/<id>/<relpath>）
  const snapDir = join(workspace, ".agent", "snapshots", "snap1");
  await mkdir(snapDir, { recursive: true });
  await writeFile(join(snapDir, "a.ts"), "原件\n", "utf8");
  return { sessionsDir, workspace, sessionId, target };
}

describe("还原之后落 file_restored 事件（主进程那一半）", () => {
  it("还原成功 ⇒ 那个会话的事件流里真有一条 file_restored（带 path）", async () => {
    const f = await fixture();
    const snapshotId = ".agent/snapshots/snap1/a.ts";
    const r = await handleSnapshotRestore({ path: "a.ts", snapshotId, sessionId: f.sessionId });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    // 盘上真的还原了
    expect(await readFile(f.target, "utf8")).toBe("原件\n");
    // 事件流里真的落了一条
    const events = await readSessionEvents(f.sessionsDir, f.sessionId);
    const restored = events.find((e) => e.type === "file_restored");
    expect(restored, "还原没有落事件 ⇒ 改动面还会当这个文件没撤").toBeDefined();
    expect(restored).toMatchObject({ type: "file_restored", path: "a.ts" });
  });

  it("还原失败 ⇒ 不落事件（失败就是没还原，落了就是撒谎）", async () => {
    const f = await fixture();
    // 快照与路径不配对 ⇒ 还原必拒
    const r = await handleSnapshotRestore({ path: "b.ts", snapshotId: ".agent/snapshots/snap1/a.ts", sessionId: f.sessionId });
    expect(r.ok).toBe(false);
    const events = await readSessionEvents(f.sessionsDir, f.sessionId);
    expect(events.find((e) => e.type === "file_restored")).toBeUndefined();
  });

  it("没给 sessionId ⇒ 不落（不知道往哪条事件流落；不许瞎落到别的会话）", async () => {
    const f = await fixture();
    const r = await handleSnapshotRestore({ path: "a.ts", snapshotId: ".agent/snapshots/snap1/a.ts" });
    expect(r.ok, JSON.stringify(r)).toBe(true); // 还原本身成功
    const events = await readSessionEvents(f.sessionsDir, f.sessionId);
    expect(events.find((e) => e.type === "file_restored")).toBeUndefined();
  });

  it("落的那条事件可重放（append→replay 逐字无损：渲染层读的就是这条）", async () => {
    const f = await fixture();
    await handleSnapshotRestore({ path: "a.ts", snapshotId: ".agent/snapshots/snap1/a.ts", sessionId: f.sessionId });
    const replayed = await replay(pathOf(f.sessionsDir, f.sessionId));
    expect(replayed.find((e) => e.type === "file_restored")).toMatchObject({ path: "a.ts" });
  });
});
