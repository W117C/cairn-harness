// H1 判卷（第 1330 页热路径清单）：sessionOwnedHistory 声明的会话型 provider 不再每步吃
// 全量投影（stream 收到 []），legacy/scripted provider 照旧吃投影——两条路同一判卷对照。
// 反向锚点：不带声明的 provider 收到的必须是投影（摘掉 loop 的 skip 分支本条当场红）。
import { describe, expect, it } from "vitest";
import { runLoop } from "../src/agent/loop";
import type { EventLog } from "../src/events";
import type { ModelOutput, Provider, ProviderMessage } from "../src/providers";

function memLog(): EventLog {
  return { append: async () => undefined };
}

function recordProvider(record: ProviderMessage[][], declareSession: boolean): Provider {
  return {
    ...(declareSession ? { sessionOwnedHistory: true as const } : {}),
    stream: async function* (messages) {
      record.push([...messages]);
      yield { type: "assistant_message", content: "done" } as ModelOutput;
    },
  };
}

describe("loop 投影跳过（H1）", () => {
  it("声明 sessionOwnedHistory 的 provider 收到 []；legacy 照旧收到投影", async () => {
    const seen: ProviderMessage[][] = [];
    await runLoop({
      provider: recordProvider(seen, true),
      events: memLog(),
      workspace: ".",
      userMessage: "任务",
      maxSteps: 3,
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual([]); // 死投影已剪：不再每步算 projectContext
  });

  it("反向锚点：不带声明的 provider 仍收到投影（含 user_message）", async () => {
    const seen: ProviderMessage[][] = [];
    await runLoop({
      provider: recordProvider(seen, false),
      events: memLog(),
      workspace: ".",
      userMessage: "任务",
      maxSteps: 3,
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.length).toBeGreaterThan(0);
    expect(JSON.stringify(seen[0])).toContain("任务");
  });
});
