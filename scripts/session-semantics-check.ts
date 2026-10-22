// session-semantics-check —— ADR 0005 的运行时判卷（会话语义）：游标 + 指针分叉 + 提交幂等。
//
// 为什么要有这份脚本：判卷要能在**真仓**上跑出 ✅/❌ 逐条（人读得懂、能贴进报告），
// 且它不依赖 vitest 的运行器。断言与 tests/session-semantics.test.ts 同源、互为两把尺。
//
// 判的七条：
//   ① 游标不透明（载荷里不出现明文会话 id 与位置）且往返无损；
//   ② 四种坏法各有各的码：malformed / unsupported-kind / session-mismatch / out-of-range；
//   ③ 坏游标**绝不**被换成另一个位置（抛，不回落）；
//   ④ 游标的位置是**含**的（重放范围含指针那条）；
//   ⑤ 指针分叉：子会话自己的文件只有一行、父会话 sha256 不变、解析器给出「父前缀 + 自己的事件」；
//   ⑥ 在飞状态不继承；解析器 fail-closed（父缺失 / 边界越界 / 父链成环 ⇒ 抛）；
//   ⑦ 提交幂等：同一 requestId 提交两次只跑一次；submit 失败粘滞、submitOnce 不粘滞。
import { createHash } from "node:crypto";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEventLog, forkSessionPointer, replay, replaySession, SessionReplayError, type AgentEvent } from "../src/events";
import { SubmissionLedger, submissionRequestId } from "../src/agent/submission-ledger";
import {
  CursorError,
  decodeCursor,
  encodeCursor,
  forkPointFromCursor,
  replayFromCursor,
} from "../src/agent/session-cursor";

let failures = 0;
let assertions = 0;
function assert(cond: boolean, label: string): void {
  assertions++;
  if (cond) {
    console.log("  ✅ " + label);
  } else {
    failures++;
    console.error("  ❌ " + label);
  }
}

async function sessionErrorCode(job: Promise<unknown>): Promise<string> {
  try {
    await job;
    return "";
  } catch (error) {
    return error instanceof SessionReplayError ? error.code : "not-a-session-error";
  }
}

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const messages = (events: readonly AgentEvent[]): string[] =>
  events.filter((event) => event.type === "user_message").map((event) => event.content);
const writeEvents = (path: string, events: readonly AgentEvent[]): Promise<void> =>
  writeFile(path, events.map((event) => JSON.stringify(event)).join("\n") + "\n");

/** 捕获错误码（不抛 ⇒ ""）。 */
function errorCode(fn: () => unknown): string {
  try {
    fn();
    return "";
  } catch (e) {
    return e instanceof CursorError ? e.code : "not-a-cursor-error";
  }
}

const msg = (content: string): AgentEvent => ({ type: "user_message", content }) as AgentEvent;

const dir = await mkdtemp(join(tmpdir(), "adr0005-session-semantics-"));
try {
  console.log("[session-semantics-check] 目录 " + dir);

  // ① 往返 + 不透明
  const raw = encodeCursor({ sessionId: "s1", eventId: 7 });
  const back = decodeCursor(raw);
  assert(back.sessionId === "s1" && back.eventId === 7 && back.kind === "session", "游标往返无损（会话 id + 位置 + 种类）");
  assert(!raw.includes("s1") && !raw.includes("7"), "游标不透明（载荷里不出现明文会话 id 与位置）");

  // ② 四种坏法
  const body = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Record<string, unknown>;
  const tampered = Buffer.from(JSON.stringify({ ...body, eid: 8 }), "utf8").toString("base64url");
  assert(errorCode(() => decodeCursor(tampered)) === "malformed", "手改过的游标 → malformed（校验和不符）");
  assert(errorCode(() => decodeCursor("这不是 base64url 的载荷")) === "malformed", "解不开的游标 → malformed");
  const wrongVersion = Buffer.from(
    JSON.stringify({ ...body, v: 99 }),
    "utf8",
  ).toString("base64url");
  assert(errorCode(() => decodeCursor(wrongVersion)) === "malformed", "版本不对的游标 → malformed");
  const otherKind: Record<string, unknown> = { ...body, kind: "some-other-kind" };
  otherKind.c = createHash("sha256")
    .update(JSON.stringify([otherKind.v, otherKind.kind, otherKind.sid, otherKind.eid]))
    .digest("hex")
    .slice(0, 8);
  assert(
    errorCode(() => decodeCursor(Buffer.from(JSON.stringify(otherKind), "utf8").toString("base64url"))) === "unsupported-kind",
    "种类不支持的游标 → unsupported-kind",
  );
  assert(errorCode(() => decodeCursor(raw, { sessionId: "s2" })) === "session-mismatch", "会话不匹配 → session-mismatch");
  assert(errorCode(() => decodeCursor(raw, { sessionId: "s1", eventCount: 3 })) === "out-of-range", "位置越界 → out-of-range");

  // ③ 坏游标绝不换位置
  assert(errorCode(() => decodeCursor(raw + "x")) === "malformed", "坏游标抛错，不回落成别的位置");

  // ④ 位置是含的
  const events = [msg("一"), msg("二"), msg("三")];
  const cursor = decodeCursor(encodeCursor({ sessionId: "s1", eventId: 2 }));
  assert(
    JSON.stringify(forkPointFromCursor(events, cursor, "s1")) === JSON.stringify({ lastIncluded: 2 }),
    "游标 → 分叉点 = lastIncluded（游标位置，含）",
  );
  assert(
    JSON.stringify(replayFromCursor(events, cursor, "s1").map((e) => (e as { content?: string }).content)) ===
      JSON.stringify(["一", "二"]),
    "重放范围含指针那条",
  );
  assert(
    errorCode(() => forkPointFromCursor(events, decodeCursor(encodeCursor({ sessionId: "s2", eventId: 1 })), "s1")) === "session-mismatch",
    "分叉点：会话不匹配 → 抛",
  );
  assert(
    errorCode(() => forkPointFromCursor(events, decodeCursor(encodeCursor({ sessionId: "s1", eventId: 99 })), "s1")) === "out-of-range",
    "分叉点：位置越界 → 抛",
  );

  // ⑤ 真实日志的指针分叉：原文件与物理行号不变，子文件只存血缘。
  const parent = join(dir, "parent.jsonl");
  await writeEvents(parent, events);
  const before = sha256(await readFile(parent));
  const child = await forkSessionPointer(parent, 2, join(dir, "child"), "s1");
  const rawChild = await replay(child.eventsPath);
  assert(child.count === 1 && rawChild.length === 1, "指针分叉：子会话 raw 文件只有一行（不复制父事件）");
  const head = rawChild[0];
  assert(head?.type === "session_meta" && head.fork?.from_session_path === await realpath(parent) &&
    head.fork.boundary_event_id === 2 && head.fork.from_session_id === "s1", "子首行保存规范父路径、含边界与父会话身份");
  const childLog = createEventLog(child.eventsPath);
  try {
    await childLog.append(msg("孩子"));
  } finally {
    await childLog.close?.();
  }
  assert(JSON.stringify(messages(await replaySession(child.eventsPath, { allowedRoot: dir }))) === JSON.stringify(["一", "二", "孩子"]),
    "解析器合成父前缀 + 子事件（包含边界、不包含父后缀）");
  assert(sha256(await readFile(parent)) === before, "分叉与子会话追加后，父文件 sha256 保持不变");
  assert((await replay(parent)).length === 3 && (await replay(child.eventsPath)).length === 2,
    "raw replay 仍逐行返回各自物理文件，不偷偷展开父历史");
  const empty = await forkSessionPointer(parent, 0, join(dir, "empty"));
  assert(messages(await replaySession(empty.eventsPath)).length === 0, "边界 0：父存在，但不继承任何消息");
  const grandchild = await forkSessionPointer(child.eventsPath, 1, join(dir, "grandchild"));
  assert(JSON.stringify(messages(await replaySession(grandchild.eventsPath))) === JSON.stringify(["一", "二"]),
    "嵌套分叉边界取父 raw 第 1 行，而不是展开后第 1 项");

  // ⑥ 在飞状态只属于发起它的会话；父链的坏状态必须显式失败。
  const pendingParent = join(dir, "pending.jsonl");
  const call = (id: string): AgentEvent => ({ type: "tool_call", id, name: "read_file", args: { path: "a.txt" } });
  const pendingEvents: AgentEvent[] = [
    call("done"), { type: "tool_result", callId: "done", ok: true, output: "ok" },
    call("pending"),
    { type: "clarify_requested", callId: "ask", questions: [] },
    { type: "plan_proposed", callId: "plan", plan: { goal: "g", files: [] } },
    { type: "approval_requested", id: "approval", tool: "run_shell", args_digest: "pwd", risk: "low" },
    { type: "tool_result", callId: "pending", ok: true, output: "worker result", agent_id: "worker" },
  ];
  await writeEvents(pendingParent, pendingEvents);
  const settledChild = await forkSessionPointer(pendingParent, pendingEvents.length, join(dir, "settled"));
  const settledLog = createEventLog(settledChild.eventsPath);
  try {
    await settledLog.append(call("child-pending"));
  } finally {
    await settledLog.close?.();
  }
  const settled = await replaySession(settledChild.eventsPath);
  assert(JSON.stringify(settled.filter((event) => event.type === "tool_call").map((event) => event.id)) ===
    JSON.stringify(["done", "child-pending"]), "已收尾工具调用可继承，父在飞调用不继承（worker 同 id 不能替主流收尾）；子在飞调用保留");
  assert(!settled.some((event) => ["clarify_requested", "plan_proposed", "approval_requested"].includes(event.type)),
    "父澄清、方案、审批的未收尾请求不继承");
  assert(await sessionErrorCode(forkSessionPointer(parent, 4, join(dir, "bad"))) === "boundary-out-of-range",
    "创建分叉：边界越界 → 拒绝");
  assert(await sessionErrorCode(forkSessionPointer(parent, -1, join(dir, "bad"))) === "boundary-out-of-range",
    "创建分叉：负数边界 → 拒绝");
  assert(await sessionErrorCode(forkSessionPointer(parent, 0.5, join(dir, "bad"))) === "boundary-out-of-range",
    "创建分叉：非整数边界 → 拒绝");
  assert(await readFile(join(dir, "bad", "events.jsonl")).then(() => false, (error: NodeJS.ErrnoException) => error.code === "ENOENT"),
    "非法分叉不留下子会话文件");
  const broken = join(dir, "broken.jsonl");
  const forkMeta = (path: string, boundary: number): AgentEvent => ({
    type: "session_meta", fork: { from_session_path: path, boundary_event_id: boundary },
  });
  await writeEvents(broken, [forkMeta(await realpath(parent), 99)]);
  assert(await sessionErrorCode(replaySession(broken)) === "boundary-out-of-range", "读取分叉：父边界越界 → 抛，不回落");
  await writeEvents(broken, [forkMeta(join(dir, "missing.jsonl"), 0)]);
  assert(await sessionErrorCode(replaySession(broken)) === "session-missing", "读取分叉：父缺失即抛，边界 0 也不掩盖坏血缘");
  await writeEvents(broken, [forkMeta(broken, 1)]);
  assert(await sessionErrorCode(replaySession(broken)) === "fork-cycle", "读取分叉：父链自环 → 抛");
  const cycle = join(dir, "cycle.jsonl");
  await writeEvents(broken, [forkMeta(cycle, 1)]);
  await writeEvents(cycle, [forkMeta(broken, 1)]);
  assert(await sessionErrorCode(replaySession(broken)) === "fork-cycle", "读取分叉：多会话父链成环 → 抛");
  assert(await sessionErrorCode(replaySession(child.eventsPath, { allowedRoot: child.sessionDir })) === "outside-session-root",
    "可信根校验覆盖父链，不能借分叉读允许目录外的日志");

  // ⑦ 提交账本：不仅比较返回值，还数真正执行了多少次工作。
  const ledger = new SubmissionLedger<number>();
  const requestId = submissionRequestId("s1", "call-1");
  let calls = 0;
  let release!: (value: number) => void;
  const pending = new Promise<number>((resolve) => { release = resolve; });
  const first = ledger.submit(requestId, () => { calls++; return pending; });
  assert(ledger.submit(requestId, () => ++calls) === first, "submit：重复的在飞提交返回同一 promise");
  await Promise.resolve();
  assert(calls === 1, "submit：并发重放只执行一次工作");
  release(7);
  assert(await first === 7 && await ledger.submit(requestId, () => ++calls) === 7 && calls === 1,
    "submit：完成后重放返回既有结果，不重做副作用");
  const failed = new Error("side effect failed");
  const failId = submissionRequestId("s1", "failed");
  const failedFirst = ledger.submit(failId, () => { calls++; throw failed; });
  assert(await failedFirst.catch((error: unknown) => error) === failed, "submit：同步错误原样返回");
  assert(await ledger.submit(failId, () => ++calls).catch((error: unknown) => error) === failed && calls === 2,
    "submit：失败也粘滞，重放重抛同一错误且不重跑");
  const asyncId = submissionRequestId("s1", "async-failed");
  await ledger.submit(asyncId, async () => { calls++; throw failed; }).catch(() => undefined);
  assert(await ledger.submit(asyncId, () => ++calls).catch((error: unknown) => error) === failed && calls === 3,
    "submit：异步拒绝也保留终态，不重跑");
  const onceId = submissionRequestId("s1", "once");
  const once = ledger.submitOnce(onceId, () => ++calls);
  assert(ledger.submitOnce(onceId, () => ++calls) === once, "submitOnce：在飞提交共享同一 promise");
  await once;
  assert(await ledger.submitOnce(onceId, () => ++calls) === 5, "submitOnce：成功完成后允许下一次执行");
  const rejected = ledger.submitOnce(onceId, () => { calls++; throw failed; });
  assert(ledger.submitOnce(onceId, () => ++calls) === rejected, "submitOnce：失败前的并发重放也共享同一 promise");
  await rejected.catch(() => undefined);
  assert(await ledger.submitOnce(onceId, () => ++calls) === 7, "submitOnce：失败不粘滞，之后可以重试");
  const otherSession = submissionRequestId("s2", "call-1");
  assert(requestId !== otherSession && await ledger.submit(otherSession, () => ++calls) === 8,
    "requestId 按会话分域，同名工具调用不串会话");
  assert(submissionRequestId("a:b", "c") !== submissionRequestId("a", "b:c"), "requestId 元组编码无分隔符碰撞");
} finally {
  await rm(dir, { recursive: true, force: true });
}

if (assertions === 0) throw new Error("[session-semantics-check] 未执行断言");
if (failures > 0) {
  console.error("[session-semantics-check] 失败: " + String(failures) + " / " + String(assertions) + " 项断言未通过");
  process.exitCode = 1;
} else {
  console.log("[session-semantics-check] 全部断言通过（" + String(assertions) + " 项）");
}
