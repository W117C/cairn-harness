// ADR 0005 的判卷面（日志结构控制记录）：协议 + 投影 + 落流纪律。
//
// 判的是什么：
//   ① 新事件型（session_rewind / session_meta_update）进了联合、进了 KNOWN_TYPES、
//      且在脱敏表里**恰好**落进一个桶（不多不少）；
//   ② 投影语义：回退按**含**的 id 截断、回退标记不在有效历史里、元数据补丁只进补丁表；
//   ③ 坏控制记录**炸**（越界 / 0 / 非整数），不许静默忽略；
//   ④ 投影是纯函数（源码里不许有时钟、随机、promise 等待）；
//   ⑤ `replay()` 保持"哑"：旧日志逐字原样返回，带控制记录的日志也**原样**返回
//      （控制记录的解释是投影层的活，不是 replay 的活）。
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  effectiveEvents,
  replay,
  sessionMetaPatch,
  type AgentEvent,
} from "../src/events";
// KNOWN_TYPES **不在** ./index 的公开面里（拆分前就没有导出过——公开面逐字不变），
// 判卷直接从协议面模块取它。
import { KNOWN_TYPES } from "../src/events/types";
import { ProjectionError } from "../src/events/projection";
import {
  PROSE_FREE_TYPES,
  SCANNED_TEXT_PATHS,
  SCANNED_UPSTREAM_TYPES,
  USER_AUTHORED_TEXT_TYPES,
} from "../src/agent/worker-projection";
import { knownTypes, unionTypes } from "./event-registry";

let dir: string;
afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

const msg = (content: string): AgentEvent => ({ type: "user_message", content }) as AgentEvent;
const rewind = (to: number, reason?: string): AgentEvent =>
  ({ type: "session_rewind", to_event_id: to, ...(reason === undefined ? {} : { reason }) }) as AgentEvent;
const metaUpdate = (patch: Record<string, string>): AgentEvent =>
  ({ type: "session_meta_update", patch }) as AgentEvent;

describe("协议面：新事件型进了联合与注册表", () => {
  it("联合成员与 KNOWN_TYPES 都含两种新类型（漏登记 = 编译期错，但这里还要判运行时表也对上）", () => {
    expect(unionTypes()).toContain("session_rewind");
    expect(unionTypes()).toContain("session_meta_update");
    expect(knownTypes()).toContain("session_rewind");
    expect(knownTypes()).toContain("session_meta_update");
    expect(KNOWN_TYPES.session_rewind).toBe(true);
    expect(KNOWN_TYPES.session_meta_update).toBe(true);
  });

  it("两种新类型在脱敏表里**恰好**落进一个桶（零个桶或两个桶都红）", () => {
    const buckets = [SCANNED_TEXT_PATHS, SCANNED_UPSTREAM_TYPES, USER_AUTHORED_TEXT_TYPES, PROSE_FREE_TYPES];
    for (const t of ["session_rewind", "session_meta_update"] as const) {
      let hits = 0;
      if (SCANNED_TEXT_PATHS[t] !== undefined) hits++;
      if (SCANNED_UPSTREAM_TYPES.includes(t)) hits++;
      if (USER_AUTHORED_TEXT_TYPES.includes(t)) hits++;
      if (PROSE_FREE_TYPES.includes(t)) hits++;
      expect(hits, `${t} 落进了 ${String(hits)} 个桶（必须恰好 1 个）`).toBe(1);
      expect(SCANNED_TEXT_PATHS[t], `${t} 带着自由文本 ⇒ 必须进扫描路径`).toBeDefined();
    }
    // 扫描路径必须是能真擦掉文本的那条（patch 是对象 ⇒ 逐叶子扫）。
    expect(SCANNED_TEXT_PATHS.session_rewind).toEqual([["reason"]]);
    expect(SCANNED_TEXT_PATHS.session_meta_update).toEqual([["patch"]]);
    // 桶互斥：任何一型不得同时在两个桶里。
    const all = [
      ...Object.keys(SCANNED_TEXT_PATHS),
      ...SCANNED_UPSTREAM_TYPES,
      ...USER_AUTHORED_TEXT_TYPES,
      ...PROSE_FREE_TYPES,
    ];
    const seen = new Map<string, number>();
    for (const t of all) seen.set(t, (seen.get(t) ?? 0) + 1);
    expect(all.filter((t) => (seen.get(t) ?? 0) > 1)).toEqual([]);
    expect(buckets.length).toBe(4);
  });
});

describe("投影语义：回退按含的 id 截断", () => {
  it("session_rewind 把有效历史截断到 to_event_id（含）", () => {
    const events = [msg("一"), msg("二"), msg("三"), rewind(2), msg("四")];
    const eff = effectiveEvents(events);
    expect(eff.map((e) => (e as { content?: string }).content)).toEqual(["一", "二"]);
  });

  it("回退标记本身不在有效历史里（它是关于日志的记录，不是历史的一环）", () => {
    const events = [msg("一"), rewind(1, "手滑了"), msg("二")];
    const eff = effectiveEvents(events);
    expect(eff.map((e) => e.type)).toEqual(["user_message"]);
    expect(eff.some((e) => e.type === "session_rewind")).toBe(false);
  });

  it("被回退掉的那一段之后的事件全部丢弃（回退 = 往回走）", () => {
    const events = [msg("一"), msg("二"), rewind(1), msg("三"), msg("四")];
    expect(effectiveEvents(events).map((e) => (e as { content?: string }).content)).toEqual(["一"]);
  });

  it("多次回退：后一条作用在那一刻的历史上（只会更早）", () => {
    const events = [msg("一"), msg("二"), msg("三"), rewind(3), msg("四"), rewind(1)];
    expect(effectiveEvents(events).map((e) => (e as { content?: string }).content)).toEqual(["一"]);
  });

  it("session_meta_update 累积进补丁表，且不进消息历史", () => {
    const events = [msg("一"), metaUpdate({ title: "A" }), msg("二"), metaUpdate({ title: "B", tag: "x" })];
    expect(sessionMetaPatch(events)).toEqual({ title: "B", tag: "x" });
    expect(effectiveEvents(events).map((e) => e.type)).toEqual(["user_message", "user_message"]);
  });

  it("空补丁 = 什么都没改（记录存在，但它不改变任何键）", () => {
    expect(sessionMetaPatch([msg("一"), metaUpdate({})])).toEqual({});
    expect(effectiveEvents([msg("一"), metaUpdate({})]).map((e) => e.type)).toEqual(["user_message"]);
  });

  it("缺席的键 = 该键不变（不是清空）：只出现在补丁里的键才是被改的键", () => {
    const events = [metaUpdate({ title: "A", tag: "x" }), metaUpdate({ title: "B" })];
    expect(sessionMetaPatch(events)).toEqual({ title: "B", tag: "x" });
  });

  it("回退连带回滚它之后的元数据补丁（回退是往回走）", () => {
    const events = [msg("一"), metaUpdate({ title: "A" }), rewind(1), metaUpdate({ title: "B" })];
    expect(sessionMetaPatch(events)).toEqual({});
  });

  it("无控制记录的旧日志：有效历史 = 全部事件，逐条同形", () => {
    const events = [msg("一"), { type: "assistant_message", content: "二" } as AgentEvent];
    expect(effectiveEvents(events)).toEqual(events);
    expect(sessionMetaPatch(events)).toEqual({});
  });
});

describe("坏控制记录必须炸（不许静默忽略）", () => {
  it("回退指向末尾之后 → 抛（rewind-out-of-range）", () => {
    const events = [msg("一"), msg("二"), rewind(99)];
    expect(() => effectiveEvents(events)).toThrow(ProjectionError);
    try {
      effectiveEvents(events);
      expect.unreachable("应当抛出");
    } catch (e) {
      expect((e as ProjectionError).code).toBe("rewind-out-of-range");
    }
  });

  it("回退指向 0 → 抛（rewind-invalid-target）", () => {
    const events = [msg("一"), msg("二"), rewind(0)];
    try {
      effectiveEvents(events);
      expect.unreachable("应当抛出");
    } catch (e) {
      expect((e as ProjectionError).code).toBe("rewind-invalid-target");
    }
  });

  it("回退指向非整数 → 抛（rewind-invalid-target）", () => {
    for (const bad of [1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const events = [msg("一"), msg("二"), { type: "session_rewind", to_event_id: bad } as unknown as AgentEvent];
      try {
        effectiveEvents(events);
        expect.unreachable("应当抛出");
      } catch (e) {
        expect((e as ProjectionError).code).toBe("rewind-invalid-target");
      }
    }
  });

  it("后一条回退指到已被前一次回退丢弃的行 → 抛（越界不许被当成'已在那儿'）", () => {
    const events = [msg("一"), msg("二"), rewind(1), rewind(2)];
    try {
      effectiveEvents(events);
      expect.unreachable("应当抛出");
    } catch (e) {
      expect((e as ProjectionError).code).toBe("rewind-out-of-range");
    }
  });
});

describe("投影是纯函数", () => {
  it("同一份输入必得同一份输出，且不改动入参", () => {
    const events = [msg("一"), metaUpdate({ title: "A" }), rewind(2), msg("三")];
    const before = JSON.stringify(events);
    const a = effectiveEvents(events);
    const b = effectiveEvents(events);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(sessionMetaPatch(events))).toBe(JSON.stringify(sessionMetaPatch(events)));
    expect(JSON.stringify(events), "投影不得就地改写调用方的事件数组").toBe(before);
  });

  it("源码里不许有时钟、随机、promise 等待（投影必须是可重放的纯函数）", async () => {
    const src = await readFile(join(process.cwd(), "src", "events", "projection.ts"), "utf8");
    for (const banned of ["Date.now", "new Date", "Math.random", "await"]) {
      expect(src.includes(banned), `projection.ts 不得出现 ${banned}`).toBe(false);
    }
  });
});

describe("replay() 保持哑：逐字、控制记录原样", () => {
  it("旧日志（无控制记录）逐字重放", async () => {
    dir = await mkdtemp(join(tmpdir(), "cairn-event-semantics-"));
    const p = join(dir, "events.jsonl");
    const lines = [
      JSON.stringify(msg("一")),
      JSON.stringify({ type: "assistant_message", content: "二" }),
      JSON.stringify({ type: "tool_call", id: "c1", name: "read_file", args: { path: "a.ts" } }),
    ];
    await writeFile(p, lines.join("\n") + "\n", "utf8");
    const events = await replay(p);
    expect(events).toHaveLength(3);
    // 逐字：replay 回来的每一行与盘上的那一行**逐字**相同（不多不少，不改一个键）。
    expect(events.map((e) => JSON.stringify(e))).toEqual(lines);
  });

  it("带控制记录的日志：replay **原样**返回（含控制记录，不解释、不丢弃）", async () => {
    dir = await mkdtemp(join(tmpdir(), "cairn-event-semantics-"));
    const p = join(dir, "events.jsonl");
    const lines = [
      JSON.stringify(msg("一")),
      JSON.stringify(rewind(1, "手滑了")),
      JSON.stringify(metaUpdate({ title: "A" })),
      JSON.stringify(msg("二")),
    ];
    await writeFile(p, lines.join("\n") + "\n", "utf8");
    const events = await replay(p);
    expect(events).toHaveLength(4);
    expect(events.map((e) => JSON.stringify(e))).toEqual(lines);
    expect(events[1]!.type).toBe("session_rewind");
    expect(events[2]!.type).toBe("session_meta_update");
    // 解释是投影层的活：replay 不解释 ⇒ 有效历史与 replay 结果不同。
    expect(effectiveEvents(events).map((e) => e.type)).toEqual(["user_message"]);
    expect(effectiveEvents(events)).toHaveLength(1);
  });

  it("事件 id = 1-based 行号：控制记录占自己的行（不改 id 口径）", async () => {
    dir = await mkdtemp(join(tmpdir(), "cairn-event-semantics-"));
    const p = join(dir, "events.jsonl");
    await writeFile(
      p,
      [JSON.stringify(msg("一")), JSON.stringify(rewind(1)), JSON.stringify(msg("二"))].join("\n") + "\n",
      "utf8",
    );
    const events = await replay(p);
    expect(events).toHaveLength(3);
    expect(events.map((e, i) => i + 1)).toEqual([1, 2, 3]);
    // 回退到第 1 条 ⇒ 有效历史只剩第 1 条（第 2 条是控制记录本身，第 3 条被丢弃）。
    expect(effectiveEvents(events)).toHaveLength(1);
  });
});
