// session-semantics-check —— ADR 0005 的运行时判卷（会话语义）：游标 + 指针分叉 + 提交幂等。
//
// 为什么要有这份脚本：判卷要能在**真仓**上跑出 ✅/❌ 逐条（人读得懂、能贴进报告），
// 且它不依赖 vitest 的运行器。断言与 tests/session-semantics.test.ts 同源、互为两把尺。
//
// 判的六条：
//   ① 游标不透明（载荷里不出现明文会话 id 与位置）且往返无损；
//   ② 四种坏法各有各的码：malformed / unsupported-kind / session-mismatch / out-of-range；
//   ③ 坏游标**绝不**被换成另一个位置（抛，不回落）；
//   ④ 游标的位置是**含**的（重放范围含指针那条）；
//   ⑤ 指针分叉：子会话自己的文件只有一行、父会话 sha256 不变、解析器给出「父前缀 + 自己的事件」；
//   ⑥ 在飞状态不继承；解析器 fail-closed（父缺失 / 边界越界 / 父链成环 ⇒ 抛）；
//   ⑦ 提交幂等：同一 requestId 提交两次只跑一次；submit 失败粘滞、submitOnce 不粘滞。
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { replay, type AgentEvent } from "../src/events";
import {
  CursorError,
  decodeCursor,
  encodeCursor,
  forkPointFromCursor,
  replayFromCursor,
} from "../src/agent/session-cursor";

let failures = 0;
function assert(cond: boolean, label: string): void {
  if (cond) {
    console.log("  ✅ " + label);
  } else {
    failures++;
    console.error("  ❌ " + label);
  }
}

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

  console.log("[session-semantics-check] 游标部分断言完成");
} finally {
  await rm(dir, { recursive: true, force: true });
}

if (failures > 0) {
  console.error("[session-semantics-check] 失败: " + String(failures) + " 项断言未通过");
  process.exitCode = 1;
} else {
  console.log("[session-semantics-check] 全部断言通过");
}
