// event-semantics-check —— ADR 0005 的运行时判卷（日志结构控制记录）。
//
// 为什么要有这份脚本而不只有 vitest：判卷要能在**真仓**上跑出 ✅/❌ 逐条（人读得懂、能贴进报告），
// 且它不依赖 vitest 的运行器。断言与 tests/event-semantics.test.ts 同源、互为两把尺。
//
// 判的六条：
//   ① 新事件型进了联合与 KNOWN_TYPES；
//   ② 两种新类型在脱敏表里恰好落进一个桶；
//   ③ 回退按含的 id 截断，回退标记不在有效历史里；
//   ④ 元数据补丁只进补丁表、不进消息历史；
//   ⑤ 坏控制记录炸（越界 / 0 / 非整数）；
//   ⑥ 旧日志与带控制记录的日志，replay() 都**原样**返回（replay 保持哑）。
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { effectiveEvents, replay, sessionMetaPatch, type AgentEvent } from "../src/events";
// KNOWN_TYPES 不在 ./index 的公开面里（公开面逐字不变）⇒ 判卷直接取协议面模块。
import { KNOWN_TYPES } from "../src/events/types";
import { ProjectionError } from "../src/events/projection";
import {
  PROSE_FREE_TYPES,
  SCANNED_TEXT_PATHS,
  SCANNED_UPSTREAM_TYPES,
  USER_AUTHORED_TEXT_TYPES,
} from "../src/agent/worker-projection";

let failures = 0;
function assert(cond: boolean, label: string): void {
  if (cond) {
    console.log("  ✅ " + label);
  } else {
    failures++;
    console.error("  ❌ " + label);
  }
}

const msg = (content: string): AgentEvent => ({ type: "user_message", content }) as AgentEvent;
const rewind = (to: number, reason?: string): AgentEvent =>
  ({ type: "session_rewind", to_event_id: to, ...(reason === undefined ? {} : { reason }) }) as AgentEvent;
const metaUpdate = (patch: Record<string, string>): AgentEvent =>
  ({ type: "session_meta_update", patch }) as AgentEvent;

/** 抛出的错误码（不抛 ⇒ ""）。 */
function errorCode(fn: () => unknown): string {
  try {
    fn();
    return "";
  } catch (e) {
    return e instanceof ProjectionError ? e.code : "not-a-projection-error";
  }
}

const dir = await mkdtemp(join(tmpdir(), "adr0005-event-semantics-"));
try {
  console.log("[event-semantics-check] 目录 " + dir);

  // ① 协议面
  assert(KNOWN_TYPES.session_rewind === true, "KNOWN_TYPES 登记了 session_rewind");
  assert(KNOWN_TYPES.session_meta_update === true, "KNOWN_TYPES 登记了 session_meta_update");

  // ② 脱敏桶：恰好一个
  for (const t of ["session_rewind", "session_meta_update"] as const) {
    let hits = 0;
    if (SCANNED_TEXT_PATHS[t] !== undefined) hits++;
    if (SCANNED_UPSTREAM_TYPES.includes(t)) hits++;
    if (USER_AUTHORED_TEXT_TYPES.includes(t)) hits++;
    if (PROSE_FREE_TYPES.includes(t)) hits++;
    assert(hits === 1, `${t} 恰好落进 1 个脱敏桶（实得 ${String(hits)}）`);
  }

  // ③ 回退语义
  const eff1 = effectiveEvents([msg("一"), msg("二"), msg("三"), rewind(2), msg("四")]);
  assert(
    eff1.length === 2 && (eff1[0] as { content?: string }).content === "一" && (eff1[1] as { content?: string }).content === "二",
    "回退把有效历史截断到 to_event_id（含）",
  );
  assert(!eff1.some((e) => e.type === "session_rewind"), "回退标记不在有效历史里");
  const eff2 = effectiveEvents([msg("一"), rewind(1), msg("二"), msg("三")]);
  assert(eff2.length === 1, "被回退掉的后续事件全部丢弃");

  // ④ 元数据补丁
  const patched = [msg("一"), metaUpdate({ title: "A" }), msg("二"), metaUpdate({ title: "B", tag: "x" })];
  assert(
    JSON.stringify(sessionMetaPatch(patched)) === JSON.stringify({ title: "B", tag: "x" }),
    "元数据补丁累积进补丁表（后写的键覆盖先写的）",
  );
  assert(
    effectiveEvents(patched).every((e) => e.type === "user_message"),
    "元数据补丁不进消息历史",
  );
  assert(JSON.stringify(sessionMetaPatch([msg("一"), metaUpdate({})])) === "{}", "空补丁 = 什么都没改");

  // ⑤ 坏控制记录炸
  assert(errorCode(() => effectiveEvents([msg("一"), msg("二"), rewind(99)])) === "rewind-out-of-range", "回退越过末尾 → 抛");
  assert(errorCode(() => effectiveEvents([msg("一"), msg("二"), rewind(0)])) === "rewind-invalid-target", "回退指向 0 → 抛");
  assert(
    errorCode(() => effectiveEvents([msg("一"), msg("二"), { type: "session_rewind", to_event_id: 1.5 } as unknown as AgentEvent])) === "rewind-invalid-target",
    "回退指向非整数 → 抛",
  );

  // ⑥ replay 保持哑：逐字原样返回
  const legacy = join(dir, "legacy.jsonl");
  const legacyLines = [JSON.stringify(msg("一")), JSON.stringify({ type: "assistant_message", content: "二" })];
  await writeFile(legacy, legacyLines.join("\n") + "\n", "utf8");
  const legacyEvents = await replay(legacy);
  assert(
    legacyEvents.map((e) => JSON.stringify(e)).join("\n") === legacyLines.join("\n"),
    "旧日志经 replay() 逐字不变",
  );

  const withCtrl = join(dir, "with-control.jsonl");
  const ctrlLines = [JSON.stringify(msg("一")), JSON.stringify(rewind(1, "手滑了")), JSON.stringify(metaUpdate({ title: "A" }))];
  await writeFile(withCtrl, ctrlLines.join("\n") + "\n", "utf8");
  const ctrlEvents = await replay(withCtrl);
  assert(
    ctrlEvents.map((e) => JSON.stringify(e)).join("\n") === ctrlLines.join("\n"),
    "带控制记录的日志经 replay() 原样返回（replay 不解释控制记录）",
  );
  assert(ctrlEvents.length === 3 && ctrlEvents[1]!.type === "session_rewind", "控制记录占自己的行（id = 1-based 行号不变）");

  // ⑦ 投影是纯函数：源码里不许有时钟 / 随机 / promise 等待
  const projSrc = await readFile(join(process.cwd(), "src", "events", "projection.ts"), "utf8");
  for (const banned of ["Date.now", "new Date", "Math.random", "await"]) {
    assert(!projSrc.includes(banned), `projection.ts 不含 ${banned}（纯函数）`);
  }
  const input = [msg("一"), metaUpdate({ title: "A" }), rewind(2), msg("三")];
  const before = JSON.stringify(input);
  const a = JSON.stringify(effectiveEvents(input));
  const b = JSON.stringify(effectiveEvents(input));
  assert(a === b && JSON.stringify(input) === before, "投影是纯函数（同输入同输出、不改入参）");
} finally {
  await rm(dir, { recursive: true, force: true });
}

if (failures > 0) {
  console.error("[event-semantics-check] 失败: " + String(failures) + " 项断言未通过");
  process.exitCode = 1;
} else {
  console.log("[event-semantics-check] 全部断言通过");
}
