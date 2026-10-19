import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runLoop } from "../src/agent/loop";
import { createEventLog, replay, type AgentEvent } from "../src/events";
import type { ModelOutput, Provider } from "../src/providers";

/** 流式抛错的 provider：先正常吐一条消息，再炸——复现真实「模型/网络中途失败」。 */
function throwingProvider(error: Error, extra: ModelOutput[] = []): Provider {
  return {
    async *stream(): AsyncGenerator<ModelOutput> {
      for (const output of extra) yield output;
      yield { type: "assistant_message", content: "已产出的前半段" };
      throw error;
    },
  };
}

async function runAndCollect(
  provider: Provider,
  options: Partial<Parameters<typeof runLoop>[0]> = {},
): Promise<{ log: AgentEvent[]; error: unknown }> {
  const log: AgentEvent[] = [];
  let error: unknown = null;
  try {
    await runLoop({
      provider,
      events: { async append(event) { log.push(event); } },
      workspace: "/tmp",
      userMessage: "跑一下",
      ...options,
    });
  } catch (err) {
    error = err;
  }
  return { log, error };
}

let dir: string;
afterEach(async () => { if (dir) { await rm(dir, { recursive: true, force: true }); dir = ""; } });

describe("错误即事件（P0：失败不得静默）", () => {
  it("provider 流中途抛错时，事件流落一条 error 且原因逐字保留", async () => {
    const { log } = await runAndCollect(throwingProvider(new Error("429 rate_limited: insufficient quota")));
    const failed = log.filter((event) => event.type === "error");
    expect(failed).toHaveLength(1);
    expect((failed[0] as { message?: string }).message).toContain("429 rate_limited: insufficient quota");
  });

  it("error 事件不得吞掉既有失败语义——仍向调用方抛出原错误", async () => {
    const { error } = await runAndCollect(throwingProvider(new Error("boom")));
    expect((error as Error).message).toBe("boom");
  });

  it("已成功落流的前半段事件不因错误而丢失", async () => {
    const { log } = await runAndCollect(throwingProvider(new Error("connection reset")));
    expect(log.some((event) => event.type === "assistant_message")).toBe(true);
    expect(log[log.length - 1]?.type).toBe("error");
  });

  it("取消（AbortError + signal.aborted）不得被记成 error 事件", async () => {
    const controller = new AbortController();
    controller.abort();
    const aborted = new Error("The operation was aborted");
    aborted.name = "AbortError";
    const { log } = await runAndCollect(throwingProvider(aborted), { signal: controller.signal });
    expect(log.filter((event) => event.type === "error")).toHaveLength(0);
  });

  it("error 类型已注册进事件校验：真实 JSONL 落盘 + replay 无损", async () => {
    dir = await mkdtemp(join(tmpdir(), "dsh-error-event-"));
    const logPath = join(dir, "events.jsonl");
    const log = createEventLog(logPath);
    const event = { type: "error", message: "fetch failed: ENOTFOUND api.example.com", ts: 1 } as const;
    await log.append(event);
    const restored = await replay(logPath);
    expect(restored).toHaveLength(1);
    expect(restored[0]).toEqual(event);
  });
});

describe("内核异常也落事件（2026-10-19）", () => {
  it("撞 maxSteps 的 throw 之前先落一条 error（否则日志在最后一条普通事件处戛然而止）", async () => {
    const provider: Provider = {
      async *stream() {
        yield { type: "tool_call", id: "t1", name: "read_file", args: { path: "x" } } as unknown as ModelOutput;
      },
    };
    const { log, error } = await runAndCollect(provider, {
      mode: "auto",
      maxSteps: 2,
      tools: { read_file: { name: "read_file", async run() { return { ok: true, output: "x" }; } } },
    });
    expect((error as Error).message).toContain("maxSteps");
    const errors = log.filter((e) => e.type === "error");
    expect(errors).toHaveLength(1);
    expect((errors[0] as { message?: string }).message).toContain("maxSteps");
    expect(log[log.length - 1]?.type).toBe("error");
  });
});
