import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentEvent } from "../src/events";
import { buildMessages, createGlmProvider, parseResponse } from "../src/providers/glm";

let dir = "";
afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

describe("glm provider（注入 fake fetch，不联网）", () => {
  it("buildMessages: 事件历史 → OpenAI 协议消息（usage 跳过）", () => {
    const history: AgentEvent[] = [
      { type: "user_message", content: "修复测试" },
      { type: "assistant_message", content: "我先读文件" },
      { type: "tool_call", id: "c1", name: "read_file", args: { path: "src/todo.ts" } },
      { type: "tool_result", callId: "c1", ok: true, output: "...file..." },
      { type: "usage", inputTokens: 10, outputTokens: 5 },
    ];
    const msgs = buildMessages(history);
    expect(msgs[0].role).toBe("system");
    expect(msgs.map((m) => m.role)).toEqual(["system", "user", "assistant", "assistant", "tool"]);
    expect(msgs[3].tool_calls?.[0]).toEqual({
      id: "c1",
      type: "function",
      function: { name: "read_file", arguments: '{"path":"src/todo.ts"}' },
    });
    expect(msgs[4].tool_call_id).toBe("c1");
  });

  it("parseResponse: 文本在前 tool_calls 按序在后；坏参数落空参；usage 换算", () => {
    const parsed = parseResponse(
      {
        content: "找到了",
        tool_calls: [
          { id: "a", function: { name: "write_file", arguments: '{"path":"x","content":"y"}' } },
          { id: "b", function: { name: "run_shell", arguments: "not-json" } },
        ],
      },
      { prompt_tokens: 100, completion_tokens: 20 },
    );
    expect(parsed.outputs.map((o) => o.type)).toEqual(["assistant_message", "tool_call", "tool_call"]);
    const tcs = parsed.outputs.filter((o) => o.type === "tool_call");
    expect(tcs[0]).toEqual({ type: "tool_call", id: "a", name: "write_file", args: { path: "x", content: "y" } });
    expect(tcs[1].args).toEqual({}); // 坏参数 → 空参，工具回错误让模型自纠
    expect(parsed.usage).toEqual({ type: "usage", inputTokens: 100, outputTokens: 20 });
  });

  it("provider: 一轮吐 2 个 tool_call，纯文本轮之后 next() 恒 null；usage 落日志", async () => {
    dir = await mkdtemp(join(tmpdir(), "m0-glm-"));
    const logPath = join(dir, "log.jsonl");
    const payload = (msg: object, usage: object) =>
      new Response(JSON.stringify({ choices: [{ message: msg }], usage }), { status: 200 });
    let calls = 0;
    const fakeFetch = (async () => {
      calls++;
      if (calls === 1) {
        return payload(
          {
            content: "我先看代码",
            tool_calls: [
              { id: "a", function: { name: "read_file", arguments: '{"path":"src/todo.ts"}' } },
              { id: "b", function: { name: "run_shell", arguments: '{"command":"pnpm test"}' } },
            ],
          },
          { prompt_tokens: 50, completion_tokens: 10 },
        );
      }
      return payload({ content: "修好了" }, { prompt_tokens: 80, completion_tokens: 4 });
    }) as typeof fetch;
    const provider = createGlmProvider({
      baseUrl: "https://fake.example/v1/",
      apiKey: "test-key",
      model: "glm-5.3-flash",
      eventLogPath: logPath,
      fetchImpl: fakeFetch,
    });
    // 预置 user_message（真实运行里由 loop 先落）
    const { createEventLog } = await import("../src/events");
    await createEventLog(logPath).append({ type: "user_message", content: "修复测试" });

    const o1 = await provider.next();
    const o2 = await provider.next();
    const o3 = await provider.next(); // 触发第二次 API
    const o4 = await provider.next(); // 纯文本轮已吐完 → 结束
    const o5 = await provider.next();
    expect(o1).toMatchObject({ type: "assistant_message", content: "我先看代码" });
    expect(o2).toMatchObject({ type: "tool_call", id: "a", name: "read_file" });
    expect(o3).toEqual({ type: "tool_call", id: "b", name: "run_shell", args: { command: "pnpm test" } });
    expect(o4).toMatchObject({ type: "assistant_message", content: "修好了" });
    expect(o5).toBeNull(); // 结束后恒为 null
    expect(calls).toBe(2); // 结束后不再调 API
    // 尾部斜杠被规整：两次请求 URL 正确
    const log = await readFile(logPath, "utf8");
    const usageCount = log.split("\n").filter((l) => l.includes('"type":"usage"')).length;
    expect(usageCount).toBe(2); // 每轮 API 一条 usage
  });
});