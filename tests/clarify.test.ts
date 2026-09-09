// 澄清门（任务 1）验收：
// ① clarify_requested → 表单提交 → 挂回的 tool_result 内容与提交值逐字一致（callId = 原 tool_use id）
// ② 无门接线 fail-closed；③ 入参校验（1–4 问、每问 2–4 选项）。
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { runLoop } from "../src/agent/loop";
import { ClarifyGate } from "../src/agent/gates";
import { createEventLog, replay, type AgentEvent, type ClarifyAnswerMap, type ClarifyQuestion } from "../src/events";
import { createMockProvider } from "../src/providers/mock";
import { clarify, parseClarifyQuestions } from "../src/tools/clarify";
import type { ModelOutput } from "../src/providers";

function tmpLog(tag: string): string {
  return join(tmpdir(), `m1b-clarify-${tag}-${String(Date.now())}-${String(Math.random()).slice(2, 8)}.jsonl`);
}

// 索引式剧本 provider：记录 next() 调用次数（「不再调用模型」可断言）
function scriptedProvider(script: ModelOutput[]): {
  provider: { next(): Promise<ModelOutput | null> };
  calls: () => number;
} {
  let i = 0;
  let calls = 0;
  return {
    provider: {
      async next() {
        calls++;
        const v = script[i];
        i++;
        return v ?? null;
      },
    },
    calls: () => calls,
  };
}

const QUESTIONS: ClarifyQuestion[] = [
  {
    question: "交互框架用哪个？",
    header: "技术选型",
    options: [
      { label: "React", description: "生态最大" },
      { label: "Vue", description: "上手快" },
      { label: "Svelte" },
    ],
  },
  { question: "要不要顺带补测试？", options: [{ label: "要" }, { label: "不要" }] },
];

describe("clarify 工具（工具级）", () => {
  it("clarify_requested → submit → 返回值与提交值逐字一致", async () => {
    const gate = new ClarifyGate();
    const emitted: AgentEvent[] = [];
    const pending = clarify.run(
      { questions: QUESTIONS },
      { workspace: "/tmp", callId: "call-7", emit: (e) => { emitted.push(e); }, clarify: gate },
    );
    // 工具此刻应已登记等待（先登记后广播，提交竞态在源头关闭）
    expect(gate.pendingCount).toBe(1);
    await Promise.resolve(); // 让 emit 的首个 await 边界走完（事件落数组）
    expect(emitted).toHaveLength(1);
    const req = emitted[0]!;
    expect(req.type).toBe("clarify_requested");
    if (req.type !== "clarify_requested") return;
    expect(req.callId).toBe("call-7");
    expect(req.questions).toEqual(QUESTIONS);

    const submitted: ClarifyAnswerMap = { "交互框架用哪个？": "React", "要不要顺带补测试？": ["要"] };
    expect(gate.submit("call-7", submitted)).toBe(true);
    const result = await pending;
    expect(result.ok).toBe(true);
    // 逐字一致：tool_result 内容 === JSON.stringify(提交值)
    expect(result.output).toBe(JSON.stringify(submitted));
  });

  it("无门接线 → fail-closed 报错（不挂起）", async () => {
    await expect(clarify.run({ questions: QUESTIONS }, { workspace: "/tmp" })).rejects.toThrow("无澄清通道");
  });

  it("提交到无人等待的 callId → 返回 false（不误挂）", () => {
    const gate = new ClarifyGate();
    expect(gate.submit("nobody", { a: "b" })).toBe(false);
  });
});

describe("clarify 入参校验", () => {
  it("1–4 问之外拒绝", () => {
    expect(() => parseClarifyQuestions({ questions: [] })).toThrow();
    expect(() => parseClarifyQuestions({ questions: QUESTIONS.concat([QUESTIONS[0]!, QUESTIONS[0]!, QUESTIONS[0]!]) })).toThrow();
  });
  it("每问 2–4 选项之外拒绝；缺 options = 自由补充", () => {
    expect(() => parseClarifyQuestions({ questions: [{ question: "q", options: [{ label: "only" }] }] })).toThrow();
    expect(() =>
      parseClarifyQuestions({
        questions: [{ question: "q", options: [{ label: "1" }, { label: "2" }, { label: "3" }, { label: "4" }, { label: "5" }] }],
      }),
    ).toThrow();
    const free = parseClarifyQuestions({ questions: [{ question: "补充点想法？" }] });
    expect(free[0]?.options).toBeUndefined();
  });
});

describe("clarify（loop 级：tool_result 挂回原 tool_use id）", () => {
  let logPath: string;
  beforeEach(() => {
    logPath = tmpLog("loop");
  });

  it("剧本 clarify → 驱动方提交 → tool_result.callId === 工具调用 id 且内容逐字一致", async () => {
    const gate = new ClarifyGate();
    const submitted: ClarifyAnswerMap = { "交互框架用哪个？": "Vue", "要不要顺带补测试？": "要" };
    // 驱动方：看到 clarify_requested 就提交（等价 UI 卡片的 form_submit 动作）
    const base = createEventLog(logPath);
    const events = {
      append: async (e: AgentEvent) => {
        await base.append(e);
        if (e.type === "clarify_requested") {
          queueMicrotask(() => {
            gate.submit(e.callId, submitted);
          });
        }
      },
    };
    const script: ModelOutput[] = [
      { type: "assistant_message", content: "这个任务有歧义，我先问清楚。" },
      { type: "tool_call", id: "u1", name: "clarify", args: { questions: QUESTIONS } },
      { type: "assistant_message", content: "明白了，按你的选择来。" },
    ];
    const { provider, calls } = scriptedProvider(script);
    await runLoop({ provider, events, workspace: "/tmp", mode: "auto", userMessage: "做个开关", clarify: gate });

    const log = await replay(logPath);
    const call = log.find((e): e is Extract<AgentEvent, { type: "tool_call" }> => e.type === "tool_call" && e.name === "clarify");
    expect(call).toBeDefined();
    const result = log.find((e): e is Extract<AgentEvent, { type: "tool_result" }> => e.type === "tool_result" && call !== undefined && e.callId === call.id);
    expect(result).toBeDefined();
    if (result?.type === "tool_result") {
      expect(result.ok).toBe(true);
      expect(result.output).toBe(JSON.stringify(submitted)); // 逐字一致
    }
    expect(calls()).toBe(4); // 剧本 3 条全部消费 + 第 4 次 next() 拿到 null 收束 loop
    await rm(logPath, { force: true });
  });
});
