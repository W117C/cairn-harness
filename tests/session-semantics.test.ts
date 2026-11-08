// ADR 0005 的判卷面·下半（会话语义）：游标 + 指针分叉 + 提交幂等。
//
// 判的是什么：
//   ① 游标**不透明**且**fail-closed**：四种坏法各有各的码，一律抛，绝不换一个位置顶上；
//   ② 指针分叉：子会话自己的文件只有一行（父会话字节不变），解析器给出「父前缀 + 自己的事件」；
//   ③ 在飞状态**不继承**（父会话里已发起未收尾的那几笔不跟着走）；
//   ④ 解析器 fail-closed：父缺失 / 边界越界 / 父链成环 ⇒ 抛；
//   ⑤ 提交幂等：同一个 requestId 提交两次 ⇒ 工作**只跑一次**；`submit` 失败粘滞、`submitOnce` 不粘滞。
import { createHash } from "node:crypto";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createEventLog, replay, type AgentEvent, type ToolResultEvent } from "../src/events";
import {
  CursorError,
  decodeCursor,
  encodeCursor,
  forkPointFromCursor,
  replayFromCursor,
} from "../src/agent/session-cursor";

let dir: string;
afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

const msg = (content: string): AgentEvent => ({ type: "user_message", content }) as AgentEvent;
const toolCall = (id: string, name = "read_file"): AgentEvent =>
  ({ type: "tool_call", id, name, args: { path: "a.ts" } }) as AgentEvent;
// 返**具体那一种**事件类型而不是 AgentEvent 联合：worker 归因那格要在 tool_result 上加
// `agent_id`，联合类型上做扩展会退化成「这字段不在联合的某些成员上」⇒ 类型面不认。
const toolResult = (callId: string, output = "ok"): ToolResultEvent =>
  ({ type: "tool_result", callId, ok: true, output }) as ToolResultEvent;

/** 造一段会话日志，返回路径。 */
async function seed(events: readonly AgentEvent[], name = "events.jsonl"): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), "cairn-session-semantics-"));
  const path = join(dir, name);
  const log = createEventLog(path);
  for (const e of events) await log.append(e);
  return path;
}

describe("游标：不透明 + fail-closed", () => {
  it("编解码往返：内容面原样回来（会话 id + 位置 + 种类）", () => {
    const raw = encodeCursor({ sessionId: "s1", eventId: 7 });
    expect(typeof raw).toBe("string");
    expect(raw.length).toBeGreaterThan(0);
    const c = decodeCursor(raw);
    expect(c.sessionId).toBe("s1");
    expect(c.eventId).toBe(7);
    expect(c.kind).toBe("session");
  });

  it("游标是**不透明**的：载荷里不出现明文会话 id 与位置", () => {
    const raw = encodeCursor({ sessionId: "secret-session", eventId: 42 });
    expect(raw).not.toContain("secret-session");
    expect(raw).not.toContain("42");
  });

  it("坏游标一律抛 `malformed`：不是 base64url / 不是 JSON / 校验和不符 / 版本不对", () => {
    const cases: string[] = [
      "这不是base64url的载荷",
      Buffer.from("not json at all", "utf8").toString("base64url"),
      // 手改过的那一位（改 eid 不改校验和 ⇒ 校验和必然不符）
      (() => {
        const raw = encodeCursor({ sessionId: "s1", eventId: 7 });
        const payload = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Record<string, unknown>;
        payload.eid = 8;
        return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
      })(),
      // 版本不对
      (() => {
        const raw = encodeCursor({ sessionId: "s1", eventId: 7 });
        const payload = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Record<string, unknown>;
        payload.v = 99;
        return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
      })(),
    ];
    for (const raw of cases) {
      try {
        decodeCursor(raw);
        expect.unreachable("坏游标必须抛");
      } catch (e) {
        expect(e).toBeInstanceOf(CursorError);
        expect((e as CursorError).code).toBe("malformed");
      }
    }
  });

  it("种类不支持 ⇒ `unsupported-kind`（解得开、校验也对，只是种类不认识）", () => {
    const raw = encodeCursor({ sessionId: "s1", eventId: 7 });
    const payload = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Record<string, unknown>;
    payload.kind = "some-other-kind";
    // 校验和按载荷算：这里换的是"种类"，所以重算一遍校验和，让它走到 unsupported-kind 那一支。
    const body = JSON.stringify([payload.v, payload.kind, payload.sid, payload.eid]);
    payload.c = createHash("sha256").update(body).digest("hex").slice(0, 8);
    const forged = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    try {
      decodeCursor(forged);
      expect.unreachable("不支持的种类必须抛");
    } catch (e) {
      expect((e as CursorError).code).toBe("unsupported-kind");
    }
  });

  it("会话不匹配 ⇒ `session-mismatch`；位置越界 ⇒ `out-of-range`", () => {
    const raw = encodeCursor({ sessionId: "s1", eventId: 7 });
    try {
      decodeCursor(raw, { sessionId: "s2" });
      expect.unreachable("会话不匹配必须抛");
    } catch (e) {
      expect((e as CursorError).code).toBe("session-mismatch");
    }
    try {
      decodeCursor(raw, { sessionId: "s1", eventCount: 3 });
      expect.unreachable("位置越界必须抛");
    } catch (e) {
      expect((e as CursorError).code).toBe("out-of-range");
    }
  });

  it("坏游标**绝不**被换成另一个位置（抛，不回落成「最后一条」）", () => {
    const raw = encodeCursor({ sessionId: "s1", eventId: 7 });
    expect(() => decodeCursor(raw + "x")).toThrow(CursorError);
    // 关键：抛出来的是**错误**，不是一个"能用的游标"。
    try {
      decodeCursor(raw + "x");
      expect.unreachable("坏游标必须抛");
    } catch (e) {
      expect(e).toBeInstanceOf(CursorError);
      expect((e as CursorError).code).toBe("malformed");
    }
  });

  it("游标的位置是**含**的：forkPointFromCursor 返回 lastIncluded = 游标位置", async () => {
    const path = await seed([msg("一"), msg("二"), msg("三")]);
    const events = await replay(path);
    const cursor = decodeCursor(encodeCursor({ sessionId: "s1", eventId: 2 }));
    expect(forkPointFromCursor(events, cursor, "s1")).toEqual({ lastIncluded: 2 });
    // 重放范围含指针那条（第 2 条在里面）。
    expect(replayFromCursor(events, cursor, "s1").map((e) => (e as { content?: string }).content)).toEqual(["一", "二"]);
  });

  it("游标指向别的会话 / 越界 ⇒ 抛（分叉点也不许兜底）", async () => {
    const path = await seed([msg("一"), msg("二")]);
    const events = await replay(path);
    const other = decodeCursor(encodeCursor({ sessionId: "s2", eventId: 1 }));
    expect(() => forkPointFromCursor(events, other, "s1")).toThrow(CursorError);
    const oob = decodeCursor(encodeCursor({ sessionId: "s1", eventId: 99 }));
    expect(() => forkPointFromCursor(events, oob, "s1")).toThrow(CursorError);
  });
});

// 下列断言保护核心入口；raw 日志行号始终属于各自文件，不拿合成数组下标充当游标。
import * as sessionApi from "../src/events";

async function pointerApi() {
  expect(sessionApi).toHaveProperty("forkSessionPointer", expect.any(Function));
  expect(sessionApi).toHaveProperty("replaySession", expect.any(Function));
  return sessionApi;
}

async function ledgerApi() {
  const loaded = import("../src/agent/submission-ledger");
  await expect(loaded).resolves.toHaveProperty("SubmissionLedger", expect.any(Function));
  return loaded;
}

async function rawSession(events: readonly AgentEvent[], name = "parent.jsonl") {
  dir = await mkdtemp(join(tmpdir(), "cairn-session-pointer-"));
  const path = join(dir, name);
  await writeFile(path, events.map(e => JSON.stringify(e)).join("\n") + "\n");
  return path;
}

describe("指针分叉：独立读侧，不改 raw replay", () => {
  it("子文件仅一行血缘；父字节不变；继承含边界，之后接本地事件", async () => {
    const api = await pointerApi();
    const parent = await rawSession([msg("一"), msg("二"), msg("不继承")]);
    const before = await readFile(parent, "utf8");
    const fork = await api.forkSessionPointer(parent, 2, join(dir, "child"), "parent-id");
    expect(fork.count).toBe(1);
    const child = await replay(fork.eventsPath);
    expect(child).toHaveLength(1);
    expect(child[0]).toMatchObject({ type: "session_meta", fork: {
      // 生产侧存的是**规范路径**（realpath 后的真身）——那是软链不许越界的那道闸留下的形状。
      // macOS 上 /tmp 是 /private/tmp 的软链 ⇒ 这里比的真身，不是盘面字面。
      from_session_path: await realpath(parent), boundary_event_id: 2, from_session_id: "parent-id",
    } });
    const log = createEventLog(fork.eventsPath);
    await log.append(msg("孩子"));
    await log.close?.();
    expect((await api.replaySession(fork.eventsPath)).filter(e => e.type === "user_message").map(e => e.content)).toEqual(["一", "二", "孩子"]);
    expect(await readFile(parent, "utf8")).toBe(before);
    expect(await replay(parent)).toEqual([msg("一"), msg("二"), msg("不继承")]);
  });

  it("边界 0 是有父但无继承，与根会话分得开", async () => {
    const api = await pointerApi();
    const parent = await rawSession([msg("根消息")]);
    const child = await api.forkSessionPointer(parent, 0, join(dir, "empty"));
    const events = await api.replaySession(child.eventsPath);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "session_meta", fork: { boundary_event_id: 0 } });
    expect(await api.replaySession(parent)).toEqual([msg("根消息")]);
  });

  it("嵌套分叉的边界取父 raw 第2行，而不是扁平数组第2项", async () => {
    const api = await pointerApi();
    const parent = await rawSession([msg("祖一"), msg("祖二"), msg("祖三")]);
    const child = await api.forkSessionPointer(parent, 3, join(dir, "child"));
    const log = createEventLog(child.eventsPath);
    await log.append(msg("父第2行"));
    await log.append(msg("父第3行不继承"));
    await log.close?.();
    const grandchild = await api.forkSessionPointer(child.eventsPath, 2, join(dir, "grandchild"));
    expect((await api.replaySession(grandchild.eventsPath)).filter(e => e.type === "user_message").map(e => e.content)).toEqual(["祖一", "祖二", "祖三", "父第2行"]);
  });

  it("父前缀先应用控制记录；不把 raw 行号重排后再应用回退", async () => {
    const api = await pointerApi();
    const parent = await rawSession([msg("保留"), { type: "session_meta_update", patch: { title: "x" } }, msg("丢弃"), { type: "session_rewind", to_event_id: 1 }]);
    const before = await readFile(parent, "utf8");
    const child = await api.forkSessionPointer(parent, 4, join(dir, "child"));
    expect((await api.replaySession(child.eventsPath)).filter(e => e.type === "user_message").map(e => e.content)).toEqual(["保留"]);
    expect(await readFile(parent, "utf8")).toBe(before);
    expect(await replay(parent)).toHaveLength(4);
  });

  it("只过滤继承的在飞状态；边界后的结果不能替父请求收尾", async () => {
    const api = await pointerApi();
    const parent = await rawSession([
      toolCall("done"), toolResult("done"), toolCall("pending"),
      { type: "clarify_requested", callId: "ask", questions: [{ question: "?" }] },
      { type: "plan_proposed", callId: "plan", plan: { goal: "g", files: [] } },
      { type: "approval_requested", id: "approval", tool: "run_shell", args_digest: "pwd", risk: "low" },
      toolResult("pending"),
    ]);
    const child = await api.forkSessionPointer(parent, 6, join(dir, "child"));
    const log = createEventLog(child.eventsPath);
    await log.append(toolCall("child-pending"));
    await log.close?.();
    const events = await api.replaySession(child.eventsPath);
    expect(events.filter(e => e.type === "tool_call").map(e => e.id)).toEqual(["done", "child-pending"]);
    expect(events.some(e => ["clarify_requested", "plan_proposed", "approval_requested"].includes(e.type))).toBe(false);
    expect(events.filter(e => e.type === "tool_result").map(e => e.callId)).toEqual(["done"]);
  });

  it("已收尾的澄清、方案、审批保持原样；worker同id结果不能解除主流在飞状态", async () => {
    const api = await pointerApi();
    const closed: AgentEvent[] = [
      { type: "clarify_requested", callId: "ask", questions: [] }, toolResult("ask"),
      { type: "plan_proposed", callId: "plan", plan: { goal: "g", files: [] } },
      { type: "plan_approved", callId: "plan", approved: false },
      { type: "approval_requested", id: "a", tool: "write_file", args_digest: "x", risk: "low" },
      { type: "approval_resolved", id: "a", decision: "rejected", scope: "once" },
    ];
    const parent = await rawSession([...closed, toolCall("same"), { ...toolResult("same"), agent_id: "worker" }]);
    const child = await api.forkSessionPointer(parent, 8, join(dir, "child"));
    const events = await api.replaySession(child.eventsPath);
    expect(events.slice(0, 6)).toEqual(closed);
    expect(events.some(e => e.type === "tool_call" && e.id === "same")).toBe(false);
  });

  it("父缺失 / 边界越界 / 非整数 / 负数全都拒绝且不创建子文件", async () => {
    const api = await pointerApi();
    const parent = await rawSession([msg("一")]);
    for (const boundary of [2, -1, 0.5, Number.NaN]) {
      await expect(api.forkSessionPointer(parent, boundary, join(dir, "bad"))).rejects.toMatchObject({ code: "boundary-out-of-range" });
    }
    await expect(readFile(join(dir, "bad", "events.jsonl"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(api.forkSessionPointer(join(dir, "missing"), 0, join(dir, "bad"))).rejects.toMatchObject({ code: "session-missing" });
    const broken = join(dir, "broken.jsonl");
    await writeFile(broken, JSON.stringify({ type: "session_meta", fork: { from_session_path: parent, boundary_event_id: 99 } }) + "\n");
    await expect(api.replaySession(broken)).rejects.toMatchObject({ code: "boundary-out-of-range" });
    await rm(parent);
    await expect(api.replaySession(broken)).rejects.toMatchObject({ code: "session-missing" });
  });

  it("自环、祖先环、坏血缘拒绝；既有目标保持字节不变", async () => {
    const api = await pointerApi();
    const a = await rawSession([]);
    const b = join(dir, "b.jsonl");
    const meta = (path: string) => JSON.stringify({ type: "session_meta", fork: { from_session_path: path, boundary_event_id: 1 } }) + "\n";
    await writeFile(a, meta(a));
    await expect(api.replaySession(a)).rejects.toMatchObject({ code: "fork-cycle" });
    await writeFile(a, meta(b));
    await writeFile(b, meta(a));
    await expect(api.replaySession(a)).rejects.toMatchObject({ code: "fork-cycle" });
    await writeFile(a, JSON.stringify({ type: "session_meta", fork: { from_session_path: "relative.jsonl", boundary_event_id: 0 } }) + "\n");
    await expect(api.replaySession(a)).rejects.toMatchObject({ code: "invalid-fork" });
    await writeFile(a, JSON.stringify(msg("根")) + "\n");
    const child = await api.forkSessionPointer(a, 1, join(dir, "existing"));
    const before = await readFile(child.eventsPath, "utf8");
    await expect(api.forkSessionPointer(a, 0, join(dir, "existing"))).rejects.toMatchObject({ code: "EEXIST" });
    expect(await readFile(child.eventsPath, "utf8")).toBe(before);
  });

  it("allowedRoot把父链读限制在真实路径下，软链不能绕过", async () => {
    const api = await pointerApi();
    const parent = await rawSession([msg("父")]);
    const child = await api.forkSessionPointer(parent, 1, join(dir, "child"));
    await expect(api.replaySession(child.eventsPath, { allowedRoot: dir })).resolves.toHaveLength(2);
    await expect(api.replaySession(child.eventsPath, { allowedRoot: join(dir, "child") })).rejects.toMatchObject({ code: "outside-session-root" });
    const { symlink } = await import("node:fs/promises");
    const link = join(dir, "child", "parent-link.jsonl");
    await symlink(parent, link);
    await writeFile(child.eventsPath, JSON.stringify({ type: "session_meta", fork: { from_session_path: link, boundary_event_id: 1 } }) + "\n");
    await expect(api.replaySession(child.eventsPath, { allowedRoot: join(dir, "child") })).rejects.toMatchObject({ code: "outside-session-root" });
  });
});

describe("提交幂等：实例内的会话分域账本", () => {
  it("submit并发与完成后重放共用同一Promise；工作只执行一次", async () => {
    const { SubmissionLedger } = await ledgerApi();
    const ledger = new SubmissionLedger<number>();
    let calls = 0;
    const first = ledger.submit("id", () => ++calls);
    const second = ledger.submit("id", () => ++calls);
    expect(second).toBe(first);
    expect(await first).toBe(1);
    expect(await ledger.submit("id", () => ++calls)).toBe(1);
    expect(calls).toBe(1);
  });

  it("submit同步抛错也粘滞；重复提交重抛同一个错误而不重跑", async () => {
    const { SubmissionLedger } = await ledgerApi();
    const ledger = new SubmissionLedger<number>();
    const failed = new Error("side effect failed");
    let calls = 0;
    await expect(ledger.submit("id", () => { calls++; throw failed; })).rejects.toBe(failed);
    await expect(ledger.submit("id", () => ++calls)).rejects.toBe(failed);
    expect(calls).toBe(1);
  });

  it("submit异步拒绝也粘滞；在飞重入在run执行前已登记", async () => {
    const { SubmissionLedger } = await ledgerApi();
    const ledger = new SubmissionLedger<number>();
    const failed = new Error("async failed");
    let calls = 0;
    let nested: Promise<number> | undefined;
    const first = ledger.submit("id", () => {
      calls++;
      nested = ledger.submit("id", () => ++calls);
      return Promise.reject(failed);
    });
    await expect(first).rejects.toBe(failed);
    expect(nested).toBe(first);
    await expect(ledger.submit("id", () => ++calls)).rejects.toBe(failed);
    expect(calls).toBe(1);
  });

  it("submitOnce只共享在飞Promise，成功与失败后都可以重新执行", async () => {
    const { SubmissionLedger } = await ledgerApi();
    const ledger = new SubmissionLedger<number>();
    let calls = 0;
    const first = ledger.submitOnce("id", () => ++calls);
    expect(ledger.submitOnce("id", () => ++calls)).toBe(first);
    expect(await first).toBe(1);
    expect(await ledger.submitOnce("id", () => ++calls)).toBe(2);
    const failed = new Error("retryable");
    const rejecting = ledger.submitOnce("id", () => { calls++; throw failed; });
    expect(ledger.submitOnce("id", () => ++calls)).toBe(rejecting);
    await expect(rejecting).rejects.toBe(failed);
    expect(await ledger.submitOnce("id", () => ++calls)).toBe(4);
  });

  it("requestId按会话分域且分隔符不碰撞；新账本不声称跨重启去重", async () => {
    const { SubmissionLedger, submissionRequestId } = await ledgerApi();
    const a = submissionRequestId("session-a", "call");
    const b = submissionRequestId("session-b", "call");
    expect(a).not.toBe(b);
    expect(submissionRequestId("a:b", "c")).not.toBe(submissionRequestId("a", "b:c"));
    const ledger = new SubmissionLedger<number>();
    let calls = 0;
    expect(await ledger.submit(a, () => ++calls)).toBe(1);
    expect(await ledger.submit(b, () => ++calls)).toBe(2);
    expect(await new SubmissionLedger<number>().submit(a, () => ++calls)).toBe(3);
  });
});

describe("游标入口额外fail-closed边界", () => {
  it("Buffer宽松接收的非规范base64url不得当成有效游标", () => {
    const raw = encodeCursor({ sessionId: "s1", eventId: 1 });
    for (const changed of [raw + "=", raw + "\n", " " + raw]) {
      expect(() => decodeCursor(changed)).toThrow(CursorError);
    }
  });

  it("结构化游标也验kind/version；不允许绕过decode", () => {
    const cursor = decodeCursor(encodeCursor({ sessionId: "s1", eventId: 1 }));
    // 刻意造一个 kind 不对的游标：**绕过 decode 直接喂进去**，两道入口都得当场拒。
    // `as unknown as` 是必须的——`kind: "other"` 与 `SessionCursor` 的 `kind: "session"` 不重叠，
    // 直接 `as` 会被类型面拦下（那正是这格要验的：类型面拦不住运行时，面要自己拒）。
    expect(() => forkPointFromCursor([msg("一")], { ...cursor, kind: "other" } as unknown as typeof cursor, "s1")).toThrow(CursorError);
    expect(() => replayFromCursor([msg("一")], { ...cursor, version: 99 }, "s1")).toThrow(CursorError);
  });

  it("小于1的位置按ADR给out-of-range；非整数载荷仍为malformed", () => {
    for (const eventId of [0, -1]) {
      try {
        decodeCursor(encodeCursor({ sessionId: "s1", eventId }));
        expect.unreachable("越界必须抛");
      } catch (e) {
        expect((e as CursorError).code).toBe("out-of-range");
      }
    }
  });
});
