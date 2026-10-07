// 判卷 · `scripts/replay/lessons-recurrence.ts`（M6 教训面的**复发读数**）。
//
// 这份读数最容易出的错不是算错，而是**把「没有尺」读成「读数为 0」**：零语料（一场会话都没有）
// 与「有语料但一类都没复发」在率上都长成 0%，而前者根本没有意义。所以本判卷的重心有一半
// 在**区分这两格**上，另一半在把折演的分子分母逐格钉死（含一格手算得出期望值的小例）。
//
// 分组：
//   A 折演与排序的确定性（同批语料、打乱喂入 ⇒ 逐字节同一份读数；等时按 id 定序）。
//   B 两组的分子分母算对（四场合成语料，手算期望值逐格对）。
//   C 零语料不静默（与「有语料但零复发」必须分得开）。
//   D 口径那一句在（读数不许只给数、不给「这不是因果」）。
import { describe, expect, it } from "vitest";
import { census, recurrence, RECURRENCE_CALIBER, type SessionFacts } from "../scripts/replay/lessons-recurrence";
import type { AgentEvent, ToolCallEvent, ToolResultEvent, VerifyResultEvent } from "../src/events";

// ---- 轨迹构件（合成，不依赖真语料）----
function verifyRed(callId: string): VerifyResultEvent {
  return {
    type: "verify_result", callId, ok: false, attempt: 1, maxAttempts: 3,
    results: [{ command: "pnpm test", ok: false, output: "FAIL 1 test" }],
  };
}
function toolCall(id: string, name: string, args: unknown = {}): ToolCallEvent {
  return { type: "tool_call", id, name, args: args as Record<string, unknown> };
}
function toolFail(id: string): ToolResultEvent {
  return { type: "tool_result", callId: id, ok: false, output: "boom" };
}
function quiet(): AgentEvent {
  return { type: "user_message", content: "聊两句" };
}
/** 一场会话：`id` 走 `.jsonl` 尾巴（`distillLessons` 从它取会话名），`time` 是排序键。 */
function session(id: string, time: number, events: AgentEvent[]): SessionFacts {
  return { id, time, events };
}

/** 两拍写向同一工具、**参数不同**（推进式）⇒ 有工具红，但不是重复动作。 */
const twoToolFails = (): AgentEvent[] => [
  toolCall("t1", "write_file", { path: "a.ts", content: "x" }), toolFail("t1"),
  toolCall("t2", "write_file", { path: "b.ts", content: "y" }), toolFail("t2"),
];
/** 一拍工具红 ⇒ 有工具红（present），但**不成**连败教训（产不出），是天然的分歧格。 */
const oneToolFail = (): AgentEvent[] => [toolCall("t1", "write_file", { path: "a.ts", content: "x" }), toolFail("t1")];

const rowOf = (reading: ReturnType<typeof recurrence>, kind: string) =>
  reading.rows.find((r) => r.kind === kind)!;

describe("A 折演与排序的确定性", () => {
  it("同批语料、喂入顺序打乱 ⇒ 逐字节同一份读数（折演不许依赖入参顺序）", () => {
    const s = [
      session("/logs/A.jsonl", 100, [verifyRed("va")]),
      session("/logs/B.jsonl", 200, twoToolFails()),
      session("/logs/C.jsonl", 300, [verifyRed("vc")]),
      session("/logs/D.jsonl", 400, [quiet()]),
    ];
    const forward = recurrence(s);
    const backward = recurrence([...s].reverse());
    expect(JSON.stringify(backward)).toBe(JSON.stringify(forward));
  });

  it("**等时按 id 定序**：id 序若被忽略，这条会读成「对照组 2/2」而不是 1/1", () => {
    // a 产出 tool-streak；b 只是出现（单拍红，产不出）。两者 time 相同。
    const a = session("/logs/a.jsonl", 100, twoToolFails());
    const b = session("/logs/b.jsonl", 100, oneToolFail());
    // 入参故意 b 在前：只按 time 的稳定排序会保留 b、a ⇒ 两场都在「尚不可用组」。
    const r = recurrence([b, a]);
    const t = rowOf(r, "tool-streak");
    expect(t.unavailable).toMatchObject({ recurred: 1, sessions: 1 }); // a 先（id 序）供料 ⇒ b 落在可用组
    expect(t.available).toMatchObject({ recurred: 1, sessions: 1 });
  });
});

describe("B 两组的分子分母（五场合成语料，手算期望值）", () => {
  // A(100) 代码红；B(200) 两拍工具红；C(300) 代码红；D(400) 无红；E(500) 代码红。
  // A 产出并出现 verify-red；B 产出并出现 tool-streak。逐类手算（A→B→C→D→E 顺序）：
  //   verify-red    出现：A、C、E；可用性在 A 之后置位
  //                 ⇒ 已可用组 2/4（B 否、C 是、D 否、E 是）；尚不可用组 1/1（A）。
  //   tool-streak   出现：只 B；可用性在 B 之后置位
  //                 ⇒ 已可用组 0/3（C、D、E）；尚不可用组 1/2（A 否、B 是）。
  //   repeat-action 全程不出现、也从不产出（无重复写向动作）
  //                 ⇒ 已可用组 0/0（分母 0 ⇒ rate=null）；尚不可用组 0/5（rate=0）。
  const reading = recurrence([
    session("/logs/A.jsonl", 100, [verifyRed("va")]),
    session("/logs/B.jsonl", 200, twoToolFails()),
    session("/logs/C.jsonl", 300, [verifyRed("vc")]),
    session("/logs/D.jsonl", 400, [quiet()]),
    session("/logs/E.jsonl", 500, [verifyRed("ve")]),
  ]);

  it("会话数与类别清单（类别从判定表派生，顺序即表序）", () => {
    expect(reading.sessions).toBe(5);
    expect(reading.rows.map((r) => r.kind)).toEqual(["verify-red", "tool-streak", "repeat-action"]);
  });

  it("verify-red：已可用 2/4（0.5），尚不可用 1/1（1）", () => {
    const r = rowOf(reading, "verify-red");
    expect(r.available).toMatchObject({ recurred: 2, sessions: 4 });
    expect(r.available.rate).toBe(0.5);
    expect(r.unavailable).toMatchObject({ recurred: 1, sessions: 1 });
    expect(r.unavailable.rate).toBe(1);
  });

  it("tool-streak：已可用 0/3（0），尚不可用 1/2（0.5）——**两组的分子不同的一格**", () => {
    const r = rowOf(reading, "tool-streak");
    expect(r.available).toMatchObject({ recurred: 0, sessions: 3 });
    expect(r.available.rate).toBe(0);
    expect(r.unavailable).toMatchObject({ recurred: 1, sessions: 2 });
    expect(r.unavailable.rate).toBe(0.5);
  });

  it("repeat-action：两类都 0，但**分母不同**——已可用组分母 0 ⇒ rate=null，不是 0", () => {
    const r = rowOf(reading, "repeat-action");
    expect(r.available).toMatchObject({ recurred: 0, sessions: 0 });
    expect(r.available.rate).toBeNull();
    expect(r.unavailable).toMatchObject({ recurred: 0, sessions: 5 });
    expect(r.unavailable.rate).toBe(0);
  });

  it("反向一侧（判据不许恒绿）：两组分子的**和**独立可算——verify-red 出现 3 场、tool-streak 出现 1 场", () => {
    // 把某一组的分子与它自己的分母「整组对调」会当场破掉上面两条 matchObject（两组分子不同）；
    // 这条再给一个不依赖组别划分的不变式：出现过的场次数 = 两组分子之和。
    const v = rowOf(reading, "verify-red");
    const t = rowOf(reading, "tool-streak");
    expect(v.available.recurred + v.unavailable.recurred).toBe(3); // A、C、E
    expect(t.available.recurred + t.unavailable.recurred).toBe(1); // B
  });
});

describe("C 零语料不静默（必须与「有语料但零复发」分得开）", () => {
  it("零语料：sessions=0、所有分母 0、所有 rate=null（**不许**折成 0）", () => {
    const r = recurrence([]);
    expect(r.sessions).toBe(0);
    expect(r.rows).toHaveLength(3);
    for (const row of r.rows) {
      expect(row.available).toEqual({ recurred: 0, sessions: 0, rate: null });
      expect(row.unavailable).toEqual({ recurred: 0, sessions: 0, rate: null });
    }
  });

  it("有语料但零复发：sessions>0、对照组分母非 0、rate=0（与上一格**不同形**）", () => {
    const r = recurrence([session("/logs/q1.jsonl", 1, [quiet()]), session("/logs/q2.jsonl", 2, [quiet()])]);
    expect(r.sessions).toBe(2);
    for (const row of r.rows) {
      expect(row.unavailable).toMatchObject({ recurred: 0, sessions: 2 });
      expect(row.unavailable.rate).toBe(0); // 真的有尺，读数就是 0
      expect(row.available.sessions).toBe(0);
      expect(row.available.rate).toBeNull();
    }
  });
});

describe("D 口径随读数一起出（不许只给数、不给「这不是因果」）", () => {
  it("EXPLICIT：口径句里明写「不是因果」与「正确的零」", () => {
    expect(RECURRENCE_CALIBER).toContain("不是因果");
    expect(RECURRENCE_CALIBER).toContain("一个正确的零");
  });
});

describe("E census（分母侧那一族）仍是同一把尺", () => {
  it("代码红 / 环境红 / 工具红 / 无归属红 四格各归各（环境红不进代码红）", () => {
    const c = census([
      { type: "verify_result", callId: "v1", ok: false, attempt: 1, maxAttempts: 3, results: [], cause: "code" },
      { type: "verify_result", callId: "v2", ok: false, attempt: 1, maxAttempts: 3, results: [], cause: "timeout" },
      toolCall("t1", "run_shell"), toolFail("t1"),
      { type: "tool_result", callId: "orphan", ok: false, output: "x" },
    ]);
    expect(c).toMatchObject({ codeRed: 1, envRed: 1, toolFail: 1, orphanFail: 1, verifyBeats: 2 });
  });
});
