// 靶场暗卷通道的接线绊线测（2026-09-20 立）。
// 为什么值得锁：暗卷 provider 的注释自称「主会话同款接线」，实现却是 stub——丢掉调用方传来的
// messages 与 tools、自己只发一条裸 task，且把生成器缓存成一次性的（第二轮拿到已耗尽的迭代器）。
// 后果是**真实模型在靶场里物理上不可能调工具**，而 gym-check B3 只验 `typeof verifyOk === "boolean"`
// ⇒ 「门全绿」与「暗卷分数恒 0」同时成立一年多。首次真凭据跑（2026-09-20）实测到 turns=0 in=113。
// 本测用注入 transport 走**真函数 runCase**（不是自己造的桩），四个断言各自打掉旧实现的一处：
//   ① 工具表必须透传（旧实现传 undefined）      ② 系统提示必须进 messages（旧实现只发裸 task）
//   ③ 一次调用 = 一轮，第二轮必须还能要到新迭代器（旧实现第二轮拿到耗尽生成器）
//   ④ 历史逐轮增长（「执行 → 验证 → 修正」回流的物理前提；断在第二轮就永远看不到自己上一轮干了什么）
// 全程离线：transport 是注入的假件，不碰网络、不需要 CAIRN_API_KEY。
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadCase, loadGymIndex } from "../src/agent/gym/case";
import { cleanupRun, runCase, type GymCaseResult } from "../src/agent/gym/runner";
import type { ModelOutput } from "../src/providers";
import type { GlmToolSpec } from "../src/providers/glm";

const ROOT = process.cwd();
const GYM = join(ROOT, "fixtures", "gym");
/** 哨兵：只有「系统提示真的进了 messages」才可能被读到。 */
const SYSTEM_SENTINEL = "【loop-eval 系统提示哨兵 SENTINEL-9F2C】";

interface RecordedCall {
  messages: unknown[];
  tools: GlmToolSpec[] | undefined;
}

const calls: RecordedCall[] = [];

/** 假 transport：一次调用记一份装配，然后按轮吐「一次工具调用 → 收束文本」。 */
async function* recordingTransport(
  messages: readonly unknown[],
  _opts: unknown,
  tools?: GlmToolSpec[],
): AsyncGenerator<ModelOutput> {
  const turn = calls.length + 1;
  calls.push({ messages: [...messages], tools });
  if (turn === 1) {
    yield { type: "tool_call", id: "c1", name: "read_file", args: { path: "src/todo.js" } };
    yield { type: "usage", inputTokens: 100, outputTokens: 10 };
    return;
  }
  yield { type: "assistant_delta", callId: "a1", text: "已按读到的内容收束。" };
  yield { type: "usage", inputTokens: 200, outputTokens: 20 };
}

describe("靶场暗卷 provider 接线（真函数 runCase + 注入 transport）", () => {
  let result: GymCaseResult | null = null;
  let runError: unknown = null;

  beforeAll(async () => {
    const index = await loadGymIndex(GYM);
    const entry = index.cases.find((c) => c.id === "todo-completed-count");
    expect(entry, "靶场里必须还有 todo-completed-count").toBeTruthy();
    const c = await loadCase(GYM, entry!);
    calls.length = 0;
    try {
      result = await runCase(c, { model: "real", system: SYSTEM_SENTINEL, transport: recordingTransport });
    } catch (err) {
      runError = err;
    }
  });

  afterAll(async () => {
    if (result) await cleanupRun(result);
  });

  it("① 每一轮都把工具表发给模型（旧实现传 undefined ⇒ 模型看不见任何工具）", () => {
    expect(runError).toBeNull();
    expect(calls.length).toBeGreaterThanOrEqual(1);
    for (const call of calls) {
      const names = (call.tools ?? []).map((t) => t.function.name);
      expect(names.length, "工具表不得为空").toBeGreaterThan(0);
      expect(names).toContain("read_file");
      expect(names).toContain("write_file");
    }
  });

  it("② 系统提示进 messages（旧实现只发一条裸 task ⇒ 六条纪律一句都没到模型）", () => {
    const first = calls[0]!;
    const serialized = JSON.stringify(first.messages);
    expect(serialized).toContain(SYSTEM_SENTINEL);
    const roles = (first.messages as { role: string }[]).map((m) => m.role);
    expect(roles[0]).toBe("system");
  });

  it("③ 一轮一次请求：工具执行后模型还能被叫回来（旧实现第二轮拿到已耗尽的生成器）", () => {
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  it("④ 历史逐轮增长，且第二轮带上第一轮的工具回执（修正回流的物理前提）", () => {
    const [a, b] = calls;
    expect(b!.messages.length).toBeGreaterThan(a!.messages.length);
    const roles = b!.messages.map((m) => (m as { role: string }).role);
    expect(roles).toContain("tool");
  });

  // 注：曾写第 ⑤ 条「turns ≥ 1 ⇒ 分数不再被通道锁死」，反向验证时它在**坏实现下也绿**
  // （坏实现的第一轮照样能吐一个 tool_call）⇒ 不判别，按本仓规矩撤回，不编一条刚好会红的断言。
});
