// 给成员派活判卷（ADR 0015 §四 第二件的 UI 入口）。
//
// 判的是什么：
//   ① 派活 = 开一条**归属该成员**的会话：先写归属补丁，再写任务书（顺序有语义：先归属再说话）；
//   ② 空任务书 / 非法 id 一律拒（不建会话，别留空壳）；
//   ③ 归属可反查（`memberOfSession`）；
//   ④ 建会话失败 ⇒ 交回错误，不吞。
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { dispatchToMember, memberOfSession, startToMember, type DispatchDeps } from "../src/main/team-dispatch";
import { createEventLog, type AgentEvent } from "../../../src/events";
import { createSession, pathOf } from "../../../src/main/sessions";

let root: string | null = null;
afterEach(async () => { if (root !== null) await rm(root, { recursive: true, force: true }); root = null; });

const realDeps = (): DispatchDeps => ({
  createSession: (r) => createSession(r),
  append: (p, e) => createEventLog(p).append(e as AgentEvent),
  pathOf,
});

describe("给成员派活", () => {
  it("开一条归属该成员的会话：任务书成为第一句，归属可反查", async () => {
    root = await mkdtemp(join(tmpdir(), "cairn-dispatch-"));
    const result = await dispatchToMember({ sessionsRoot: root, memberId: "m1", task: "查一下壁纸对比度" }, realDeps());
    expect(result.ok).toBe(true);
    const id = String(result.sessionId);
    expect(await memberOfSession(root, id)).toBe("m1");
  });

  it("空任务书 ⇒ 拒，且不建会话", async () => {
    root = await mkdtemp(join(tmpdir(), "cairn-dispatch-"));
    const created: string[] = [];
    const deps: DispatchDeps = {
      createSession: async () => { created.push("x"); return "s1"; },
      append: async () => undefined,
      pathOf: () => "/dev/null",
    };
    const result = await dispatchToMember({ sessionsRoot: root, memberId: "m1", task: "   " }, deps);
    expect(result.ok).toBe(false);
    expect(created).toEqual([]);
  });

  it("非法成员 id ⇒ 拒（不建会话）", async () => {
    root = await mkdtemp(join(tmpdir(), "cairn-dispatch-"));
    let touched = 0;
    const deps: DispatchDeps = {
      createSession: async () => { touched += 1; return "s1"; },
      append: async () => { touched += 1; },
      pathOf: () => "/dev/null",
    };
    for (const bad of ["a.b", "a/b", "", "x".repeat(65)]) {
      const result = await dispatchToMember({ sessionsRoot: root, memberId: bad, task: "t" }, deps);
      expect(result.ok).toBe(false);
    }
    expect(touched).toBe(0);
  });

  it("建会话失败 ⇒ 交回错误，不假装成功", async () => {
    root = await mkdtemp(join(tmpdir(), "cairn-dispatch-"));
    const deps: DispatchDeps = {
      createSession: async () => { throw new Error("磁盘满了"); },
      append: async () => undefined,
      pathOf: () => "/dev/null",
    };
    const result = await dispatchToMember({ sessionsRoot: root, memberId: "m1", task: "t" }, deps);
    expect(result.ok).toBe(false);
    expect(String(result.error)).toContain("磁盘满了");
  });
});

describe("派活并开跑（v63）", () => {
  it("建归属会话 → 交给 run 写任务书并开跑；任务书只出现一次（不重复写）", async () => {
    const created: string[] = [];
    const appended: { path: string; type: string; content?: string; patch?: Record<string, string> }[] = [];
    const runs: { message: string; sessionId: string }[] = [];
    const deps = {
      createSession: async () => { created.push("s1"); return "s1"; },
      append: async (path: string, event: AgentEvent) => {
        const e = event as { type: string; content?: string; patch?: Record<string, string> };
        appended.push({ path, type: e.type, ...(e.content === undefined ? {} : { content: e.content }), ...(e.patch === undefined ? {} : { patch: e.patch }) });
      },
      pathOf: () => "/dev/null",
      run: async (req: { message: string; sessionId: string }) => { runs.push({ message: req.message, sessionId: req.sessionId }); return { ok: true }; },
    };
    const result = await startToMember({ sessionsRoot: "/ws", memberId: "m1", task: "量对比度", mode: "default" }, deps);
    expect(result).toEqual({ ok: true, sessionId: "s1" });
    // 只写了归属补丁，任务书交给 run
    expect(appended).toEqual([{ path: "/dev/null", type: "session_meta_update", patch: { member: "m1" } }]);
    expect(runs).toEqual([{ message: "量对比度", sessionId: "s1" }]);
  });

  it("run 失败 ⇒ 如实交回错误（不假装开跑成功）", async () => {
    const result = await startToMember(
      { sessionsRoot: "/ws", memberId: "m1", task: "t", mode: "default" },
      {
        createSession: async () => "s1",
        append: async () => undefined,
        pathOf: () => "/dev/null",
        run: async () => ({ ok: false, error: "模型没配" }),
      },
    );
    expect(result).toEqual({ ok: false, error: "模型没配" });
  });
});
