// 会话根寻址与父依赖保护（计划 Task 3 红面）。
//   ① 两个登记根同名会话：只给 id 必须拒绝歧义，显式 workspace 才能定位；
//   ② 依赖扫描直接 + 传递，读不动不许当「无依赖」；
//   ③ withSessionMutation 进程内串行、跨进程用根内锁文件；活人占用与崩溃遗留都显式报错；
//   ④ 受控暂停里的删除检查与并发创建只能一个成功，不留下断链。
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentEvent, SessionMetaEvent } from "../src/events";
import { resolveSessionRef, SESSION_MUTATION_LOCK, withSessionMutation } from "../src/main/session-repository";
import { assertNoDependents, dependentSessionsInRoot } from "../src/main/session-dependencies";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true }))); });

const user = (content: string): AgentEvent => ({ type: "user_message", content });
const forkMeta = (from: string, boundary: number, id: string): SessionMetaEvent =>
  ({ type: "session_meta", fork: { from_session_path: from, boundary_event_id: boundary, from_session_id: id } });

async function setup(): Promise<{ ws: string; root: string }> {
  const ws = await realpath(await mkdtemp(join(tmpdir(), "cairn-repo-")));
  roots.push(ws);
  const root = join(ws, ".agent", "sessions");
  await mkdir(root, { recursive: true });
  return { ws, root };
}

async function writeSession(root: string, id: string, events: readonly AgentEvent[]): Promise<string> {
  const path = join(root, id + ".jsonl");
  await writeFile(path, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  return realpath(path);
}

describe("resolveSessionRef：同名会话必须精确寻址", () => {
  it("无 workspace 且两个根同名 ⇒ 拒绝；显式 workspace 各自命中", async () => {
    const a = await setup();
    const b = await setup();
    await writeSession(a.root, "same", [user("A")]);
    await writeSession(b.root, "same", [user("B")]);
    await expect(resolveSessionRef({ sessionId: "same" }, [a.ws, b.ws])).rejects.toThrow(/多个工作区/);
    expect(await resolveSessionRef({ sessionId: "same", workspace: a.ws }, [a.ws, b.ws]))
      .toEqual({ workspace: a.ws, sessionId: "same" });
    expect(await resolveSessionRef({ sessionId: "same", workspace: b.ws }, [a.ws, b.ws]))
      .toEqual({ workspace: b.ws, sessionId: "same" });
  });

  it("未登记工作区 / 不存在的会话 / 空 id 都 fail closed", async () => {
    const a = await setup();
    const outsider = await setup();
    await writeSession(a.root, "only", [user("X")]);
    await expect(resolveSessionRef({ sessionId: "only", workspace: outsider.ws }, [a.ws])).rejects.toThrow(/未登记/);
    await expect(resolveSessionRef({ sessionId: "gone" }, [a.ws])).rejects.toThrow(/不存在/);
    await expect(resolveSessionRef({ sessionId: "" }, [a.ws])).rejects.toThrow(/空串/);
  });
});

describe("父依赖：直接 + 传递，读不动不算无依赖", () => {
  it("parent ← child ← grand：删除 parent 前能列出两代子会话；叶子可删", async () => {
    const { ws, root } = await setup();
    const parent = await writeSession(root, "parent", [user("P")]);
    const child = await writeSession(root, "child", [forkMeta(parent, 1, "parent"), user("C")]);
    await writeSession(root, "grand", [forkMeta(child, 2, "child"), user("G")]);
    expect((await dependentSessionsInRoot(root, ws, "parent")).map((d) => d.sessionId)).toEqual(["child", "grand"]);
    expect((await dependentSessionsInRoot(root, ws, "child")).map((d) => d.sessionId)).toEqual(["grand"]);
    expect(await dependentSessionsInRoot(root, ws, "grand")).toEqual([]);
    await expect(assertNoDependents({ workspace: ws, sessionId: "parent" }, root)).rejects.toThrow(/拒绝破坏性操作.*child.*grand/);
    await expect(assertNoDependents({ workspace: ws, sessionId: "grand" }, root)).resolves.toBeUndefined();
  });

  it("依赖文件读不动 ⇒ 抛错，不当成没有依赖", async () => {
    const { ws, root } = await setup();
    await writeSession(root, "parent", [user("P")]);
    await writeFile(join(root, "broken.jsonl"), [JSON.stringify(user("A")), "not-json", JSON.stringify(user("B"))].join("\n") + "\n");
    await expect(dependentSessionsInRoot(root, ws, "parent")).rejects.toThrow(/依赖扫描失败/);
  });
});

describe("withSessionMutation：根级临界区", () => {
  it("进程内串行：第二个 mutation 等第一个结束才开始", async () => {
    const { root } = await setup();
    const order: string[] = [];
    let release!: () => void;
    let markStarted!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const started = new Promise<void>((r) => { markStarted = r; });
    const first = withSessionMutation(root, async () => {
      order.push("first-start");
      markStarted();
      await gate;
      order.push("first-end");
    });
    const second = withSessionMutation(root, async () => { order.push("second"); });
    await started; // 等第一段真的开跑，再判第二段没抢跑（不靠固定 sleep 赌负载）
    await new Promise((r) => setTimeout(r, 0));
    expect(order).toEqual(["first-start"]);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(["first-start", "first-end", "second"]);
  });

  it("跨进程：锁被占用时另一个进程拿不到；结束后锁文件不残留", async () => {
    const { root } = await setup();
    const lockPath = join(root, SESSION_MUTATION_LOCK);
    let probe = "";
    await withSessionMutation(root, async () => {
      expect(await readFile(lockPath, "utf8")).toContain(String(process.pid));
      try {
        execFileSync(process.execPath, ["-e", `require("node:fs").openSync(${JSON.stringify(lockPath)}, "wx")`], { stdio: "pipe" });
      } catch (error) {
        probe = String((error as { stderr?: Buffer }).stderr ?? "");
      }
    });
    expect(probe).toMatch(/EEXIST/);
    expect(await readdir(root)).not.toContain(SESSION_MUTATION_LOCK);
  });

  it("崩溃遗留的锁：显式报「需人工确认」，不自动删锁", async () => {
    const { root } = await setup();
    const lockPath = join(root, SESSION_MUTATION_LOCK);
    await writeFile(lockPath, "999999\n");
    await expect(withSessionMutation(root, async () => undefined)).rejects.toThrow(/崩溃遗留.*人工确认/);
    expect(await readdir(root)).toContain(SESSION_MUTATION_LOCK);
    await rm(lockPath, { force: true });
  });
});
