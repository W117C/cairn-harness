// 会话归属根：core 侧那些「按会话 id 找它自己的日志」的动作，必须问**同一个**问题
// （2026-10-20 独立评审追出的两条真缺陷的共同根因）。
//
// 缺陷形状（两个出口，一个根因）：
//  ① 存在性检查问**单例根** ⇒ 项目工作区里的会话被判成「会话不存在」⇒
//     置顶/赞踩/归档/改名/删除**全部**对项目会话失效（"加一个项目文件夹"是这产品的主入口）；
//  ② 还原文件那一笔**落单例根** ⇒ 侧栏多出一个只含这一行的幽灵会话，
//     而真会话里**没有**这次还原 ⇒ 还原不持久（重开会话又变回"已改"——正是这个功能要修的 bug）。
//
// 修法：core 侧加一个**归属解析器**（宿主注入），存在性检查与事件落盘都问它。
// 本份判卷是**真跑**的：真起两个根、真在第二个根里建会话、真调 handler、真读回事件流。
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  handleFeedbackSubmit,
  handlePinSet,
  handleSessionRename,
  initSessionsDir,
  setSessionRootResolver,
} from "../src/main/session-handlers";
import { createSession, pathOf, readSessionEvents } from "../src/main/sessions";
import { setRunWorkspace } from "../src/main/runner-workspace";

const dirs: string[] = [];

afterEach(async () => {
  setSessionRootResolver(null);
  initSessionsDir("");
  setRunWorkspace(null);
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

/** 两个根：装配根（单例）+ 项目根（桌面端注册的项目工作区）。会话住在**项目根**里。 */
async function twoRoots(): Promise<{ singleton: string; project: string; sessionId: string }> {
  const root = await mkdtemp(join(tmpdir(), "cairn-multi-root-"));
  dirs.push(root);
  const singleton = join(root, "singleton");
  const project = join(root, "project");
  await mkdir(singleton, { recursive: true });
  await mkdir(project, { recursive: true });
  initSessionsDir(singleton);
  const sessionId = await createSession(project, "项目会话");
  return { singleton, project, sessionId };
}

describe("会话归属根（多根面）", () => {
  it("注册解析器 ⇒ 项目会话的置顶/赞踩/改名不再被判成「会话不存在」", async () => {
    const f = await twoRoots();
    // 不注册解析器（单例形态）⇒ 旧形状：项目会话不在单例根里 ⇒ 判成不存在。
    const before = await handlePinSet({ sessionId: f.sessionId, eventId: 1, pinned: true });
    expect(before.ok, "旧形状下项目会话就是判成不存在——这一格钉的是那条修法前的读数").toBe(false);
    expect(before.error).toContain("会话不存在");

    // 注册解析器（桌面端形态）⇒ 同一条调用成功。
    setSessionRootResolver(async (id) => (id === f.sessionId ? f.project : f.singleton));
    const pin = await handlePinSet({ sessionId: f.sessionId, eventId: 1, pinned: true });
    expect(pin.ok, JSON.stringify(pin)).toBe(true);
    const fb = await handleFeedbackSubmit({ sessionId: f.sessionId, eventId: 1, rating: "up" });
    expect(fb.ok, JSON.stringify(fb)).toBe(true);
    const renamed = await handleSessionRename(f.sessionId, "改过名");
    expect(renamed.id).toBeDefined();
  });

  it("解析器说「不知道」⇒ 仍然判成不存在（不许回落单例根）", async () => {
    const f = await twoRoots();
    setSessionRootResolver(async () => null);
    const pin = await handlePinSet({ sessionId: f.sessionId, eventId: 1, pinned: true });
    expect(pin.ok).toBe(false);
    expect(pin.error).toContain("会话不存在");
  });

  it("还原那一笔落**会话自己的**日志；单例根里不留幽灵会话", async () => {
    const f = await twoRoots();
    setSessionRootResolver(async (id) => (id === f.sessionId ? f.project : f.singleton));
    // 直接落一条 file_restored（主进程那一半的最小形状：事件进的是哪本日志）
    const { handleSnapshotRestore } = await import("../src/main/session-handlers");
    // 造一份可还原的快照（工作区 = 项目根）
    const ws = join(f.project, "ws");
    await mkdir(join(ws, ".agent", "snapshots", "snap1"), { recursive: true });
    await writeFile(join(ws, ".agent", "snapshots", "snap1", "a.ts"), "原件\n", "utf8");
    await writeFile(join(ws, "a.ts"), "原件\n", "utf8");
    setRunWorkspace(ws);
    const r = await handleSnapshotRestore({ path: "a.ts", snapshotId: ".agent/snapshots/snap1/a.ts", sessionId: f.sessionId });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    // 真会话自己的日志里有这一条
    const own = await readSessionEvents(f.project, f.sessionId);
    expect(own.some((e) => e.type === "file_restored")).toBe(true);
    // 单例根里**没有**多出任何会话（幽灵会话就是从这里长出来的）
    const stray = await readdir(f.singleton).catch(() => [] as string[]);
    expect(stray.filter((n) => n.endsWith(".jsonl"))).toEqual([]);
  });

  it("解析器说「不知道」⇒ 那一笔**不落任何日志**（回落单例根 = 造幽灵会话）", async () => {
    const f = await twoRoots();
    setSessionRootResolver(async () => null);
    const ws = join(f.project, "ws");
    await mkdir(join(ws, ".agent", "snapshots", "snap1"), { recursive: true });
    await writeFile(join(ws, ".agent", "snapshots", "snap1", "a.ts"), "原件\n", "utf8");
    await writeFile(join(ws, "a.ts"), "原件\n", "utf8");
    setRunWorkspace(ws);
    const { handleSnapshotRestore } = await import("../src/main/session-handlers");
    const r = await handleSnapshotRestore({ path: "a.ts", snapshotId: ".agent/snapshots/snap1/a.ts", sessionId: f.sessionId });
    // 盘上真的还原了（还原的结论是盘上的事实）
    expect(r.ok, JSON.stringify(r)).toBe(true);
    // 但**不许**因为"不知道落在哪儿"就落单例根：那一笔会变成只含 file_restored 的幽灵会话，
    // 而真会话里没有这次还原（还原看起来没生效）——两个毛病一次犯。
    const stray = await readdir(f.singleton).catch(() => [] as string[]);
    expect(stray.filter((n) => n.endsWith(".jsonl")), "单例根里多出了幽灵会话").toEqual([]);
  });
});
