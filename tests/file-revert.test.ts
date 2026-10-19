// #7 文件级回滚（v2.16）判卷：计划从事件流来（纯函数），落实对真盘（tmp 工作区）。
// 关键分辨力：同一文件取**最早**一份快照（"这一轮之前"）、轮后被改过的**拒回滚**、
// worker 事件不算主会话的轮、取不到原件一律 manual（不把"看不见"说成"能回滚"）。
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentEvent } from "../src/events";
import { applyTurnRevert, pathFromSnapshotId, planTurnRevert } from "../src/agent/file-revert";

let workspace = "";

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "file-revert-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

const user = (content: string): AgentEvent => ({ type: "user_message", content });
const call = (id: string, path: string): AgentEvent => ({ type: "tool_call", id, name: "write_file", args: { path } });
const ok = (callId: string, extra: Partial<Extract<AgentEvent, { type: "tool_result" }>> = {}): AgentEvent =>
  ({ type: "tool_result", callId, ok: true, output: "wrote", ...extra });
const snap = (rel: string, seg = "1--c1"): string => `.agent/snapshots/${seg}/${rel}`;

/** 一轮：用户在 `round` 轮里改了哪些文件（callId 与快照段同号，便于逐条对账）。 */
function turn(round: number, writes: { path: string; snapshot?: string; created?: boolean }[]): AgentEvent[] {
  const out: AgentEvent[] = [user(`第 ${String(round)} 轮`)];
  writes.forEach((w, i) => {
    const id = `c${String(round)}-${String(i)}`;
    out.push(call(id, w.path));
    out.push(ok(id, {
      ...(w.snapshot !== undefined ? { snapshotId: snap(w.snapshot, `${String(round)}--${id}`) } : {}),
      ...(w.created === true ? { change: "created" as const } : { change: "modified" as const }),
    }));
  });
  return out;
}

describe("pathFromSnapshotId：从快照 id 反解被覆盖文件的相对路径", () => {
  it("解出 <SNAPSHOT_ROOT>/<毫秒>--<callId>/<原相对路径> 里的原路径；形状不对返回 null（不猜）", () => {
    expect(pathFromSnapshotId(snap("src/a.ts"))).toBe("src/a.ts");
    expect(pathFromSnapshotId(snap("deep/nest/b.txt", "9--x_y"))).toBe("deep/nest/b.txt");
    expect(pathFromSnapshotId("src/a.ts")).toBeNull(); // 不是快照路径
    expect(pathFromSnapshotId(".agent/snapshots/1--c1")).toBeNull(); // 缺原路径
  });
});

describe("planTurnRevert：轮内取原件、轮后不改动才允许回滚", () => {
  it("覆盖过的文件 → restore（带覆盖前快照）；本轮新建的文件 → delete", () => {
    const events = [...turn(1, [{ path: "src/a.ts", snapshot: "src/a.ts" }, { path: "new.txt", created: true }])];
    const plan = planTurnRevert(events, 1);
    expect("error" in plan).toBe(false);
    if ("error" in plan) return;
    expect(plan.entries).toEqual([
      expect.objectContaining({ path: "src/a.ts", undo: "restore", snapshotId: snap("src/a.ts", "1--c1-0") }),
      expect.objectContaining({ path: "new.txt", undo: "delete" }),
    ]);
  });

  it("同一文件轮内被覆盖两次 ⇒ 取最早那份快照（后一份是轮内中间态，不是「这一轮之前」）", () => {
    const events = [
      ...turn(1, [{ path: "src/a.ts", snapshot: "src/a.ts" }, { path: "src/a.ts", snapshot: "src/a.ts" }]),
    ];
    // 两次覆盖的 callId 不同 ⇒ 快照段不同；计划必须挑第一条
    const plan = planTurnRevert(events, 1);
    if ("error" in plan) throw new Error(plan.error);
    expect(plan.entries).toEqual([
      expect.objectContaining({ path: "src/a.ts", undo: "restore", snapshotId: snap("src/a.ts", "1--c1-0") }),
    ]);
  });

  it("该文件在本轮之后又被改过 ⇒ 降级 manual 并点名理由（不静默抹掉后来的改动）", () => {
    const events = [...turn(1, [{ path: "src/a.ts", snapshot: "src/a.ts" }]), ...turn(2, [{ path: "src/a.ts", snapshot: "src/a.ts" }])];
    const plan = planTurnRevert(events, 1);
    if ("error" in plan) throw new Error(plan.error);
    expect(plan.entries).toEqual([
      expect.objectContaining({ path: "src/a.ts", undo: "manual" }),
    ]);
    expect(plan.entries[0]?.why).toContain("之后又被改过");
  });

  it("worker 的写事件带 agent_id：不算主会话的轮（张冠李戴会回滚错文件）", () => {
    const workerWrite: AgentEvent = { type: "tool_result", callId: "w1", ok: true, output: "x", snapshotId: snap("w.ts"), agent_id: "ag-1" };
    const events: AgentEvent[] = [user("第一轮"), workerWrite, call("c1", "m.ts"), ok("c1", { snapshotId: snap("m.ts") })];
    const plan = planTurnRevert(events, 1);
    if ("error" in plan) throw new Error(plan.error);
    expect(plan.entries.map((e) => e.path)).toEqual(["m.ts"]);
  });

  it("取不到原件的改动进 manual 并写明为什么；没有可回滚项时给空 entries", () => {
    const events: AgentEvent[] = [user("第一轮"), call("c1", "x.ts"), ok("c1", { change: "modified" })]; // 有 change 无 snapshot
    const plan = planTurnRevert(events, 1);
    if ("error" in plan) throw new Error(plan.error);
    expect(plan.entries).toEqual([expect.objectContaining({ path: "x.ts", undo: "manual" })]);
    expect(plan.entries[0]?.why).toContain("没有留下覆盖前原件");

    const empty = planTurnRevert([user("第一轮")], 1);
    if ("error" in empty) throw new Error(empty.error);
    expect(empty.entries).toEqual([]);
  });

  it("轮次越界 / 非正 / 零轮一律 fail-visible", () => {
    const events = [user("一"), user("二")];
    expect(planTurnRevert(events, 0)).toEqual({ error: expect.stringContaining("正整数") });
    expect(planTurnRevert(events, 3)).toEqual({ error: expect.stringContaining("超出会话轮数") });
    expect(planTurnRevert([], 1)).toEqual({ error: expect.stringContaining("0 条 user_message") });
  });
});

describe("applyTurnRevert：真盘落实", () => {
  async function seed(rel: string, text: string): Promise<void> {
    const abs = join(workspace, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, text, "utf8");
  }

  it("restore：把快照原件按字节抄回；delete：删掉本轮新建的文件", async () => {
    await seed("src/a.txt", "NEW");
    await seed(snap("src/a.txt"), "OLD");
    await seed("new.txt", "created-this-turn");
    const plan = {
      round: 1,
      totalRounds: 1,
      entries: [
        { path: "src/a.txt", undo: "restore" as const, snapshotId: snap("src/a.txt"), sourceEventId: 3 },
        { path: "new.txt", undo: "delete" as const, sourceEventId: 5 },
      ],
    };
    const r = await applyTurnRevert(workspace, plan);
    expect(r.failed).toEqual([]);
    expect(r.restored).toEqual(["src/a.txt"]);
    expect(r.deleted).toEqual(["new.txt"]);
    expect(await readFile(join(workspace, "src/a.txt"), "utf8")).toBe("OLD");
    await expect(readFile(join(workspace, "new.txt"), "utf8")).rejects.toThrow();
  });

  it("越界路径与 agent 工作区目标一律拒绝（failed，不静默照做）", async () => {
    const plan = {
      round: 1,
      totalRounds: 1,
      entries: [
        { path: "../evil.txt", undo: "restore" as const, snapshotId: snap("x"), sourceEventId: 3 },
        { path: ".agent/keep.txt", undo: "delete" as const, sourceEventId: 5 },
      ],
    };
    const r = await applyTurnRevert(workspace, plan);
    expect(r.restored).toEqual([]);
    expect(r.deleted).toEqual([]);
    expect(r.failed.map((f) => f.path)).toEqual(["../evil.txt", ".agent/keep.txt"]);
  });

  it("快照原件缺失 ⇒ failed 如实报出（不假装回滚成功）", async () => {
    await seed("src/a.txt", "NEW"); // 只种目标，不种快照
    const plan = {
      round: 1,
      totalRounds: 1,
      entries: [{ path: "src/a.txt", undo: "restore" as const, snapshotId: snap("src/a.txt"), sourceEventId: 3 }],
    };
    const r = await applyTurnRevert(workspace, plan);
    expect(r.restored).toEqual([]);
    expect(r.failed).toHaveLength(1);
    expect(await readFile(join(workspace, "src/a.txt"), "utf8")).toBe("NEW"); // 原样不动
  });
});

// 2026-10-19 独立评审：worker 与 parent 的 callId 可撞号（provider 流内序号），
// 旧实现用全量 tool_call 建表 ⇒ 主会话 result 可能解析到 worker 的路径，回滚删错文件。
describe("回滚计划的归属与多文件（2026-10-19）", () => {
  it("worker 的 callId 不参与主会话的路径解析", () => {
    const events: AgentEvent[] = [
      user("第 1 轮"),
      call("call-0", "src/parent.ts"),
      ok("call-0", { change: "created" }),
      { type: "tool_call", id: "call-0", name: "write_file", args: { path: "src/worker.ts" }, agent_id: "w1" } as AgentEvent,
      ok("call-0", { change: "created", agent_id: "w1" } as never),
    ];
    const plan = planTurnRevert(events, 1);
    expect("entries" in plan).toBe(true);
    if (!("entries" in plan)) return;
    expect(plan.entries.map((e) => `${e.path}:${e.undo}`)).toEqual(["src/parent.ts:delete"]);
  });

  it("apply_patch 的 changedPaths 全部进计划：新建可删、无快照的改动标 manual", () => {
    const created: AgentEvent[] = [
      user("第 1 轮"),
      { type: "tool_call", id: "p1", name: "apply_patch", args: { patch: "x" } } as AgentEvent,
      ok("p1", { change: "created", changedPaths: ["a.ts", "b.ts"] }),
    ];
    const p1 = planTurnRevert(created, 1);
    expect("entries" in p1 && p1.entries.map((e) => `${e.path}:${e.undo}`)).toEqual(["a.ts:delete", "b.ts:delete"]);

    const modified: AgentEvent[] = [
      user("第 1 轮"),
      { type: "tool_call", id: "p2", name: "apply_patch", args: { patch: "x" } } as AgentEvent,
      ok("p2", { change: "modified", changedPaths: ["a.ts", "b.ts"], snapshotId: snap("a.ts", "1--p2") }),
    ];
    const p2 = planTurnRevert(modified, 1);
    expect("entries" in p2 && p2.entries.map((e) => `${e.path}:${e.undo}`)).toEqual(["a.ts:restore", "b.ts:manual"]);
  });
});
