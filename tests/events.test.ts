import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createEventLog, mergeAssistantDeltas, replay, replayIncremental, type AgentEvent, type AssistantDeltaEvent } from "../src/events";

let dir: string;
afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

describe("事件流", () => {
  it("写 3 条 → replay 回 3 条且顺序一致", async () => {
    dir = await mkdtemp(join(tmpdir(), "m0-events-"));
    const logPath = join(dir, "events.jsonl");
    const log = createEventLog(logPath);
    const written = [
      { type: "user_message", content: "修复失败的测试" },
      { type: "tool_call", id: "c1", name: "read_file", args: { path: "src/todo.ts" } },
      { type: "tool_result", callId: "c1", ok: true, output: "...file body..." },
    ] as const;
    for (const e of written) await log.append(e);
    const events = await replay(logPath);
    expect(events).toHaveLength(3);
    expect(events).toEqual([...written]);
    // 顺序一致性：逐条比对类型与关键字段
    expect(events.map((e) => e.type)).toEqual(["user_message", "tool_call", "tool_result"]);
  });

  it("append-only：replay 之后继续追加只增不改", async () => {
    dir = await mkdtemp(join(tmpdir(), "m0-events-"));
    const logPath = join(dir, "events.jsonl");
    const log = createEventLog(logPath);
    await log.append({ type: "user_message", content: "a" });
    expect(await replay(logPath)).toHaveLength(1);
    await log.append({ type: "assistant_message", content: "b" });
    const events = await replay(logPath);
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ type: "user_message", content: "a" });
  });

  it("未知事件类型被拒绝（防坏日志）", async () => {
    dir = await mkdtemp(join(tmpdir(), "m0-events-"));
    const log = createEventLog(join(dir, "events.jsonl"));
    await expect(log.append({ type: "bogus" } as never)).rejects.toThrow(/未知事件类型/);
  });

  it("M1a：5 条事件（含 2 条 delta）replay 顺序与内容一致", async () => {
    dir = await mkdtemp(join(tmpdir(), "m1a-events-"));
    const logPath = join(dir, "events.jsonl");
    const log = createEventLog(logPath);
    const written = [
      { type: "user_message", content: "hi" },
      { type: "assistant_delta", callId: "a1", text: "你好" },
      { type: "assistant_delta", callId: "a1", text: "，世界" },
      { type: "tool_call", id: "c1", name: "read_file", args: { path: "a.ts" } },
      { type: "usage", inputTokens: 3, outputTokens: 5 },
    ] as const;
    for (const e of written) await log.append(e);
    const events = await replay(logPath);
    expect(events).toHaveLength(5);
    expect(events).toEqual([...written]);
    expect(events.map((e) => e.type)).toEqual([
      "user_message", "assistant_delta", "assistant_delta", "tool_call", "usage",
    ]);
  });

  it("M1a：按 event id 截断重放长度正确", async () => {
    dir = await mkdtemp(join(tmpdir(), "m1a-events-"));
    const logPath = join(dir, "events.jsonl");
    const log = createEventLog(logPath);
    const written = [
      { type: "user_message", content: "1" },
      { type: "assistant_delta", callId: "a1", text: "x" },
      { type: "assistant_delta", callId: "a1", text: "y" },
      { type: "tool_call", id: "c1", name: "read_file", args: {} },
      { type: "usage", inputTokens: 1, outputTokens: 1 },
    ] as const;
    for (const e of written) await log.append(e);
    const three = await replay(logPath, "3");
    expect(three).toHaveLength(3);
    expect(three).toEqual([...written].slice(0, 3));
    expect(await replay(logPath, "1")).toHaveLength(1);
    expect(await replay(logPath, "5")).toHaveLength(5);
    // 非法 id 一律报错（fail loud），不静默截断
    await expect(replay(logPath, "0")).rejects.toThrow(/无效 untilEventId/);
    await expect(replay(logPath, "6")).rejects.toThrow(/无效 untilEventId/);
    await expect(replay(logPath, "x")).rejects.toThrow(/无效 untilEventId/);
  });

  it("M1a：同一段文本拆成 N 个 delta → 合成结果与原文逐字相等", async () => {
    const text = "3 条测试全部通过，bug 已修复，任务完成。";
    const chars = Array.from(text);
    const deltas: AssistantDeltaEvent[] = [];
    for (let i = 0; i < chars.length; i += 4) {
      deltas.push({ type: "assistant_delta", callId: "a1", text: chars.slice(i, i + 4).join("") });
    }
    expect(deltas.length).toBeGreaterThan(1);
    expect(mergeAssistantDeltas(deltas)).toBe(text);
    expect(mergeAssistantDeltas(deltas, "a1")).toBe(text);
    // 不同 callId 只合成各自的
    deltas.push({ type: "assistant_delta", callId: "a2", text: "另一轮" });
    expect(mergeAssistantDeltas(deltas)).toBe(text + "另一轮");
    expect(mergeAssistantDeltas(deltas, "a1")).toBe(text);
  });
});

// 审查 S1-2（修复任务书 1.2）：增量缓存的「读尾部 + push + 推进 offset」在 await 间隙会被
// 并发消费方各推一次 -> 该轮投影出现重复事件（生产形态：sidechat 读主会话日志与主 run
// assemble 同时在飞，旁路提问的设计前提就是主会话在跑）。修前实测返回 11 条且两路同一数组。
describe("replayIncremental 并发与缓存边界（S1-2 回归）", () => {
  it("两路并发读同一日志不产生重复事件，且不交出缓存数组本体", async () => {
    dir = await mkdtemp(join(tmpdir(), "m0-incremental-"));
    const logPath = join(dir, "events.jsonl");
    const log = createEventLog(logPath);
    const um = (t: string): AgentEvent => ({ type: "user_message", content: t } as AgentEvent);
    for (let i = 1; i <= 5; i++) await log.append(um("m" + String(i)));
    expect(await replayIncremental(logPath)).toHaveLength(5); // 建缓存（此后只走增量分支）
    for (let i = 1; i <= 3; i++) await log.append(um("c" + String(i)));
    const [a, b] = await Promise.all([replayIncremental(logPath), replayIncremental(logPath)]);
    expect(a.map((ev) => (ev as { content?: string }).content)).toEqual([
      "m1", "m2", "m3", "m4", "m5", "c1", "c2", "c3",
    ]);
    expect(b).toHaveLength(8);
    expect(a).not.toBe(b); // 共享缓存本体不得外泄
    a.push(um("poison")); // 消费方就地改数组也不该污染缓存
    expect(await replayIncremental(logPath)).toHaveLength(8);
  });
});


// 审查 S1-4（修复任务书 1.4）：A1 的逐行容错若也吃掉中段坏行，「事件 id = 1-based 行号」
// 这个跨文件契约就破了（promote 的 events[id-1]、untilEventId、compressed_event_ids 全按
// 行号取事件）。本用例锁边界：尾部坏行可容且 id 语义不变；中段坏行显式失败，不静默错位。
describe("replay 坏行容错边界（S1-4 回归）", () => {
  it("尾部半写行可容：前缀完整、untilEventId 仍按行号成立", async () => {
    dir = await mkdtemp(join(tmpdir(), "m0-tailbad-"));
    const logPath = join(dir, "events.jsonl");
    const log = createEventLog(logPath);
    for (let i = 1; i <= 3; i++) await log.append({ type: "user_message", content: "m" + String(i) } as AgentEvent);
    await appendFile(logPath, '{"type":"user_message","conten', "utf8"); // 崩溃截断的尾行
    const events = await replay(logPath);
    expect(events.map((e) => (e as { content?: string }).content)).toEqual(["m1", "m2", "m3"]);
    const upto2 = await replay(logPath, "2");
    expect(upto2).toHaveLength(2);
    expect(upto2[1]!.type).toBe("user_message");
    expect((upto2[1] as { content?: string }).content).toBe("m2"); // 不偏位
    await expect(replay(logPath, "4")).rejects.toThrow(/无效 untilEventId/);
  });

  it("中段坏行不静默跳过：显式失败（跳过会让之后每个 id 错位一格）", async () => {
    dir = await mkdtemp(join(tmpdir(), "m0-midbad-"));
    const logPath = join(dir, "events.jsonl");
    const log = createEventLog(logPath);
    await log.append({ type: "user_message", content: "m1" } as AgentEvent);
    await log.append({ type: "user_message", content: "m2" } as AgentEvent);
    const raw = await readFile(logPath, "utf8");
    const lines = raw.trimEnd().split("\n");
    await writeFile(logPath, lines[0] + "\n" + "{ 坏行不是合法 JSON" + "\n" + lines[1] + "\n", "utf8");
    await expect(replay(logPath)).rejects.toThrow(/非尾部坏行/);
    await expect(replay(logPath, "2")).rejects.toThrow(/非尾部坏行/);
  });
});


// P1-2：增量入口曾对任何位置的坏行都 `if (e) push` 静默跳过 ⇒ 同一份损坏文件在 replay 炸、
// 在 replayIncremental 继续产出错位投影（id=1-based 行号契约只在一条入口成立）。
// 现两入口共用同一条判据：尾坏可容、非尾坏必炸，且「当时在尾部」不是永久豁免。
describe("replayIncremental 与 replay 同判（P1-2 契约分叉回归）", () => {
  const um = (t: string): AgentEvent => ({ type: "user_message", content: t } as AgentEvent);

  it("首访即「坏行 + 其后好行」→ 增量与全量同样显式失败，且不留半份缓存", async () => {
    dir = await mkdtemp(join(tmpdir(), "m0-inc-mid-"));
    const logPath = join(dir, "events.jsonl");
    await writeFile(logPath, '{"type":"user_message","content":"m1"}\n{ 坏行\n{"type":"user_message","content":"m2"}\n', "utf8");
    await expect(replay(logPath)).rejects.toThrow(/非尾部坏行/);
    await expect(replayIncremental(logPath)).rejects.toThrow(/非尾部坏行/);
    await expect(replayIncremental(logPath)).rejects.toThrow(/非尾部坏行/); // 失败态可重复，第二次退化成静默
  });

  it("尾坏当时可容、其后一旦追加新事件即转非尾部 → 两入口同判必炸", async () => {
    dir = await mkdtemp(join(tmpdir(), "m0-inc-tail-"));
    const logPath = join(dir, "events.jsonl");
    const log = createEventLog(logPath);
    for (let i = 1; i <= 3; i++) await log.append(um("m" + String(i)));
    expect(await replayIncremental(logPath)).toHaveLength(3); // 建缓存，此后只走增量分支

    // ① 崩溃留下的半行（无换行）：不得被消费，也不得推进偏移
    await appendFile(logPath, '{"type":"user_message","conten', "utf8");
    expect(await replayIncremental(logPath)).toHaveLength(3);

    // ② 下一次 append 把它粘成一条「完整的坏行」（第 4 行）——此刻它仍在尾部：两入口都不炸
    await appendFile(logPath, '} 不是合法 JSON\n', "utf8");
    expect(await replayIncremental(logPath)).toHaveLength(3);
    expect(await replay(logPath)).toHaveLength(3);

    // ③ 再追加一条好行：那条坏行已离开尾部 ⇒ replay 抛，增量也必须抛（改前这里静默跳过）
    await appendFile(logPath, '{"type":"user_message","content":"m4"}\n', "utf8");
    await expect(replay(logPath)).rejects.toThrow(/非尾部坏行/);
    const inc = await replayIncremental(logPath).catch((e: unknown) => e);
    expect(inc).toBeInstanceOf(Error);
    expect(String((inc as Error).message)).toMatch(/非尾部坏行/);
    expect(String((inc as Error).message)).toMatch(/首在第 4 行/); // 绝对行号，不是批内下标
  });

  it("坏行始终在尾部（无后续事件）→ 两入口一致降级，不误判成损坏", async () => {
    dir = await mkdtemp(join(tmpdir(), "m0-inc-puretail-"));
    const logPath = join(dir, "events.jsonl");
    const log = createEventLog(logPath);
    for (let i = 1; i <= 2; i++) await log.append(um("m" + String(i)));
    expect(await replayIncremental(logPath)).toHaveLength(2);
    await appendFile(logPath, "{ 坏行不是合法 JSON\n", "utf8");
    const inc = await replayIncremental(logPath);
    expect(inc.map((e) => (e as { content?: string }).content)).toEqual(["m1", "m2"]);
    expect(await replay(logPath)).toHaveLength(2); // 同一裁决
  });
});

// A1（P0-A）：事件落盘改常驻 FileHandle——锁住四条边界：大量顺序写、rm 重建（inode 校验）、
// 同实例并发写（无半行/无重复）、多 path 缓存淘汰后文件内容仍正确。
describe("A1 常驻句柄（事件落盘）", () => {
  const um = (t: string): AgentEvent => ({ type: "user_message", content: t } as AgentEvent);

  it("(a) 连续 append 200 条 → replay 200 条且逐条深相等", async () => {
    dir = await mkdtemp(join(tmpdir(), "m0-handle-a-"));
    const logPath = join(dir, "events.jsonl");
    const log = createEventLog(logPath);
    const written: AgentEvent[] = [];
    for (let i = 0; i < 200; i++) {
      const e = um("m" + String(i));
      written.push(e);
      await log.append(e);
    }
    const events = await replay(logPath);
    expect(events).toHaveLength(200);
    expect(events).toEqual(written);
  });

  it("(b) rm 后重建：新句柄写到新 inode（不写进已 unlink 的旧 inode）", async () => {
    dir = await mkdtemp(join(tmpdir(), "m0-handle-b-"));
    const logPath = join(dir, "events.jsonl");
    const first = createEventLog(logPath);
    await first.append(um("旧"));
    expect(await replay(logPath)).toHaveLength(1);
    await rm(logPath, { force: true }); // agent-runner:877 的形态：先 rm 再 createEventLog
    const second = createEventLog(logPath); // 新实例；文件已 unlink（重建 = 新 inode）
    await second.append(um("新"));
    const events = await replay(logPath);
    expect(events).toHaveLength(1);
    expect((events[0] as { content?: string }).content).toBe("新");
  });

  it("(c) 同实例并发写 50 条：无半行、无重复、每行合法 JSON", async () => {
    dir = await mkdtemp(join(tmpdir(), "m0-handle-c-"));
    const logPath = join(dir, "events.jsonl");
    const log = createEventLog(logPath);
    await Promise.all(Array.from({ length: 50 }, (_, i) => log.append(um("c" + String(i)))));
    const raw = await readFile(logPath, "utf8");
    const lines = raw.split("\n").filter((l) => l.trim() !== "");
    expect(lines).toHaveLength(50);
    for (const l of lines) expect(() => JSON.parse(l) as unknown).not.toThrow();
    const events = await replay(logPath);
    expect(events).toHaveLength(50);
    expect(new Set(events.map((e) => (e as { content?: string }).content)).size).toBe(50); // 无重复
  });

  it("(e) X1：句柄被有界缓存挤出后，同一实例后续 append 仍成功（每次核对缓存引用）", async () => {
    dir = await mkdtemp(join(tmpdir(), "m0-handle-e-"));
    const mainPath = join(dir, "main.jsonl");
    const main = createEventLog(mainPath);
    await main.append(um("before"));
    // 用 ≥ LOG_HANDLE_MAX(32) 个其它 path 把 main 的句柄挤出缓存并 close（真实形态：长会话里
    // 32+ 个 sidechat/会话 path）。旧实现（按实例只记忆化一次句柄）此处 write 到已关闭句柄
    // → ERR_FILE_HANDLE_CLOSED → 整个 run 失败。
    for (let i = 0; i < 40; i++) {
      await createEventLog(join(dir, "other" + String(i) + ".jsonl")).append(um("o" + String(i)));
    }
    await main.append(um("after"));
    const events = await replay(mainPath);
    expect(events.map((e) => (e as { content?: string }).content)).toEqual(["before", "after"]);
  });

  it("(d) 40 个不同 path 各 append 1 条（超 LOG_HANDLE_MAX=32，淘汰后仍可用）", async () => {
    dir = await mkdtemp(join(tmpdir(), "m0-handle-d-"));
    const paths = Array.from({ length: 40 }, (_, i) => join(dir, "e" + String(i) + ".jsonl"));
    for (let i = 0; i < paths.length; i++) {
      await createEventLog(paths[i]!).append(um("p" + String(i)));
    }
    for (let i = 0; i < paths.length; i++) {
      const events = await replay(paths[i]!);
      expect(events).toHaveLength(1);
      expect((events[0] as { content?: string }).content).toBe("p" + String(i));
    }
  });
});

