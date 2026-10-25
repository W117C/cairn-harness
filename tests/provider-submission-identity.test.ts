import { describe, expect, it } from "vitest";
import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLoop } from "../src/agent/loop";
import { createEventLog, replay } from "../src/events";
import { streamOpenAI } from "../src/providers/openai";
import { streamAnthropic } from "../src/providers/anthropic";
import { streamGemini } from "../src/providers/gemini";
import type { ModelOutput } from "../src/providers";

const kinds = ["openai-stream", "openai-json", "anthropic", "gemini"] as const;
type Kind = typeof kinds[number];
const sse = (data: unknown): string => "data: " + JSON.stringify(data) + "\n\n";
function stream(kind: Kind, nativeIds: boolean): AsyncIterable<ModelOutput> {
  const id = (index: number) => nativeIds ? { id: `native-${index}` } : {};
  const args = (index: number) => ({ path: index === 0 ? "first" : "second" });
  const common = { apiKey: "test-key", stallTimeoutMs: 0 };
  if (kind === "openai-json") {
    const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({ choices: [{
      message: { tool_calls: [0, 1].map((index) => ({
        ...id(index), type: "function", function: { name: "read_file", arguments: JSON.stringify(args(index)) },
      })) }, finish_reason: "tool_calls",
    }] }));
    return streamOpenAI([], { ...common, stream: false, fetchImpl });
  }
  let body: string;
  if (kind === "openai-stream") {
    // One call spans two chunks; it must remain one identity after argument aggregation.
    body = sse({ choices: [{ delta: { tool_calls: [
      { ...id(0), index: 0, function: { name: "read_file", arguments: '{"path":' } },
    ] } }] }) + sse({ choices: [{ delta: { tool_calls: [
      { index: 0, function: { arguments: '"first"}' } },
      { ...id(1), index: 1, function: { name: "read_file", arguments: JSON.stringify(args(1)) } },
    ] }, finish_reason: "tool_calls" }] }) + "data: [DONE]\n\n";
  } else if (kind === "anthropic") {
    body = [0, 1].map((index) =>
      sse({ type: "content_block_start", index, content_block: { ...id(index), type: "tool_use", name: "read_file", input: {} } }) +
      sse({ type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: '{"path":' } }) +
      sse({ type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(args(index).path) + "}" } }) +
      sse({ type: "content_block_stop", index }),
    ).join("") + sse({ type: "message_delta", delta: { stop_reason: "tool_use" } }) + sse({ type: "message_stop" });
  } else {
    body = sse({ candidates: [{ content: { parts: [0, 1].map((index) => ({
      functionCall: { ...id(index), name: "read_file", args: args(index) },
    })) }, finishReason: "STOP" }] });
  }
  const fetchImpl: typeof fetch = async () => new Response(body, { headers: { "Content-Type": "text/event-stream" } });
  if (kind === "openai-stream") return streamOpenAI([], { ...common, fetchImpl });
  if (kind === "anthropic") return streamAnthropic([], { ...common, fetchImpl });
  return streamGemini([], { ...common, fetchImpl });
}

async function calls(kind: Kind, nativeIds: boolean) {
  const results: Extract<ModelOutput, { type: "tool_call" }>[] = [];
  for await (const output of stream(kind, nativeIds)) if (output.type === "tool_call") results.push(output);
  return results;
}

describe("提供方调用身份的请求作用域", () => {
  it.each(kinds)("%s：缺失原生 id 时，同请求两笔与不同请求都不能碰撞", async (kind) => {
    const first = await calls(kind, false);
    const second = await calls(kind, false);
    expect(first.map((call) => call.args)).toEqual([{ path: "first" }, { path: "second" }]);
    expect(second.map((call) => call.args)).toEqual([{ path: "first" }, { path: "second" }]);
    expect(new Set([...first, ...second].map((call) => call.id)).size).toBe(4);
  });

  it.each(kinds)("%s：真实 provider id 原样保留，分片不制造额外调用", async (kind) => {
    const outputs = await calls(kind, true);
    expect(outputs.map((call) => call.id)).toEqual(["native-0", "native-1"]);
    expect(outputs.map((call) => call.args)).toEqual([{ path: "first" }, { path: "second" }]);
  });

  it("Gemini 原生响应经 loop 执行两次新提交，不会把下一请求的序号零当重发", async () => {
    const root = await mkdtemp(join(tmpdir(), "cairn-gemini-submit-"));
    try {
      const requests: Record<string, unknown>[] = [];
      const fetchImpl: typeof fetch = async (_input, init) => {
        requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        const turn = requests.length;
        const part = turn <= 2
          ? { functionCall: { name: "write_file", args: { path: turn === 1 ? "first" : "second" } } }
          : { text: "done" };
        return new Response(sse({ candidates: [{ content: { parts: [part] }, finishReason: "STOP" }] }));
      };
      const path = join(root, "events.jsonl");
      await runLoop({
        workspace: root, mode: "auto", events: createEventLog(path),
        provider: { stream: (messages) => streamGemini(messages, { apiKey: "test-key", fetchImpl, stallTimeoutMs: 0 }) },
        tools: { write_file: { name: "write_file", async run(args) {
          await appendFile(join(root, "effects"), String(args.path) + "\n");
          return { ok: true, output: "written " + String(args.path) };
        } } },
      });
      expect(await readFile(join(root, "effects"), "utf8")).toBe("first\nsecond\n");
      const events = await replay(path);
      expect(events.filter((event) => event.type === "tool_call")).toHaveLength(2);
      expect(events.filter((event) => event.type === "tool_result")).toHaveLength(2);
      expect(requests).toHaveLength(3);
      expect(requests[2]).toMatchObject({ contents: expect.arrayContaining([
        { role: "user", parts: [{ functionResponse: { name: "write_file", response: { output: "written second" } } }] },
      ]) });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
