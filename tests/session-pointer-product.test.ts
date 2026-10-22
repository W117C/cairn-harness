// 产品指针创建（计划 Task 8）：
//   ① CLI 与桌面共用 createProductFork：子文件首行只有血缘、父 sha 不变、目标排他；
//   ② 嵌套分叉截在祖先轮时指向**祖先**文件与物理边界；
//   ③ 桌面 handler 走同一入口；
//   ④ CLI --replay 打出来源视图（显示序号 ≠ raw 行号）。
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createEventLog, replay, type AgentEvent, type SessionMetaEvent } from "../src/events";
import { createProductFork } from "../src/main/session-repository";
import { handleSessionFork, initSessionsDir } from "../src/main/session-handlers";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true }))); });

const user = (content: string): AgentEvent => ({ type: "user_message", content });
const assistant = (content: string): AgentEvent => ({ type: "assistant_message", content });

async function setup(): Promise<{ ws: string; root: string }> {
  const ws = await realpath(await mkdtemp(join(tmpdir(), "cairn-prod-")));
  roots.push(ws);
  const root = join(ws, ".agent", "sessions");
  await mkdir(root, { recursive: true });
  return { ws, root };
}

async function seed(root: string, id: string, rounds: number): Promise<string> {
  const path = join(root, id + ".jsonl");
  const log = createEventLog(path);
  for (let r = 1; r <= rounds; r++) {
    await log.append(user(`第 ${String(r)} 轮`));
    await log.append(assistant(`回 ${String(r)}`));
  }
  await log.close?.();
  return realpath(path);
}

const sha = async (p: string): Promise<string> => createHash("sha256").update(await readFile(p)).digest("hex");

describe("createProductFork", () => {
  it("子文件首行只有血缘；父 sha 不变；目标排他", async () => {
    const { ws, root } = await setup();
    const parent = await seed(root, "parent", 2);
    const before = await sha(parent);
    const made = await createProductFork({ workspace: ws, sessionId: "parent" }, 1, { workspace: ws, sessionId: "child" });
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(made.parent).toEqual({ workspace: ws, sessionId: "parent" });
    expect(made.boundaryEventId).toBe(2); // 第 1 轮 = 用户 1 + 回 1
    expect(made.totalRounds).toBe(2);
    const raw = await replay(made.eventsPath);
    expect(raw).toHaveLength(1);
    expect(raw[0]).toMatchObject({
      type: "session_meta",
      fork: { from_session_path: parent, boundary_event_id: 2, from_session_id: "parent" },
    } satisfies Partial<SessionMetaEvent>);
    expect(await sha(parent)).toBe(before);
    const again = await createProductFork({ workspace: ws, sessionId: "parent" }, 1, { workspace: ws, sessionId: "child" });
    expect(again).toMatchObject({ ok: false, error: expect.stringContaining("已存在") as unknown as string });
  });

  it("嵌套分叉截在祖先轮：指向祖先文件与祖先物理边界", async () => {
    const { ws, root } = await setup();
    const parent = await seed(root, "parent", 2);
    expect((await createProductFork({ workspace: ws, sessionId: "parent" }, 2, { workspace: ws, sessionId: "child" })).ok).toBe(true);
    const grand = await createProductFork({ workspace: ws, sessionId: "child" }, 1, { workspace: ws, sessionId: "grand" });
    expect(grand.ok).toBe(true);
    if (!grand.ok) return;
    // 子会话边界 4 ⇒ 可见历史 = 父前 4 条 + 子首行；第 1 轮在父第 2 条结束。
    expect(grand.parent).toEqual({ workspace: ws, sessionId: "parent" });
    expect(grand.boundaryEventId).toBe(2);
    const head = await replay(grand.eventsPath);
    expect(head[0]).toMatchObject({ fork: { from_session_path: parent, boundary_event_id: 2 } });
  });

  it("桌面 handler 走同一入口：子文件单行、父文件不变", async () => {
    const { ws, root } = await setup();
    const parent = await seed(root, "parent", 2);
    const before = await sha(parent);
    initSessionsDir(root);
    const res = await handleSessionFork("parent", 1, false, root);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(await replay(join(root, res.id + ".jsonl"))).toHaveLength(1);
    expect(await sha(parent)).toBe(before);
    void ws;
  });
});

describe("CLI --replay 的来源视图", () => {
  it("指针分叉的会话打出每行的来源与物理行号", async () => {
    const { ws, root } = await setup();
    await seed(root, "parent", 2);
    expect((await createProductFork({ workspace: ws, sessionId: "parent" }, 1, { workspace: ws, sessionId: "child" })).ok).toBe(true);
    // 子会话追加一条本地事件，让来源视图同时有祖先与本地。
    const log = createEventLog(join(root, "child.jsonl"));
    await log.append(user("本地追问"));
    await log.close?.();
    const bin = join(process.cwd(), "bin", "cairn.mjs");
    const r = spawnSync(process.execPath, [bin, "--workspace", ws, "--replay", "child"], {
      cwd: process.cwd(), encoding: "utf8", env: { ...process.env, NO_COLOR: "1" }, timeout: 120_000,
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("来源视图");
    expect(r.stdout).toContain("parent 第 1 行（继承）");
    expect(r.stdout).toContain("child 第 2 行");
    expect(r.stdout).toContain("本地追问");
  });
});
