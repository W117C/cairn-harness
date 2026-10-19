// 用户消息附件进事件（2026-10-18）：loop 只记 path/kind；缺省不得写字段（既有事件逐字节不变）。
import { describe, expect, it } from "vitest";
import { runLoop } from "../src/agent/loop";
import type { AgentEvent } from "../src/events";
import type { ModelOutput, Provider } from "../src/providers";

function onceProvider(): Provider {
  return {
    async *stream(): AsyncGenerator<ModelOutput> {
      yield { type: "assistant_message", content: "收到" };
    },
  };
}

async function runAndCollect(options: Partial<Parameters<typeof runLoop>[0]> = {}): Promise<AgentEvent[]> {
  const log: AgentEvent[] = [];
  await runLoop({
    provider: onceProvider(),
    events: { async append(event) { log.push(event); } },
    workspace: "/tmp",
    userMessage: "看附件",
    ...options,
  });
  return log;
}

describe("user_message 的 attachments 字段", () => {
  it("传入 userMessageAttachments 时写进事件（只记 path/kind）", async () => {
    const log = await runAndCollect({
      userMessageAttachments: [
        { path: "/tmp/ws/a.txt", kind: "file" },
        { path: "/tmp/ws/dir", kind: "directory" },
      ],
    });
    const user = log.find((e) => e.type === "user_message");
    expect(user).toMatchObject({
      type: "user_message",
      content: "看附件",
      attachments: [
        { path: "/tmp/ws/a.txt", kind: "file" },
        { path: "/tmp/ws/dir", kind: "directory" },
      ],
    });
  });

  it("缺省不写 attachments（旧事件形状不变）", async () => {
    const log = await runAndCollect();
    // 断言要的是「事件里有没有这个键」，而 AgentEvent 是联合类型 ⇒ 先过 unknown 再收窄（与本仓他处同形）。
    const user = log.find((e) => e.type === "user_message") as unknown as Record<string, unknown>;
    expect(user).toBeDefined();
    expect("attachments" in user).toBe(false);
  });
});
