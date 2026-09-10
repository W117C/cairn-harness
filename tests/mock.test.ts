import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { createMockProvider } from "../src/providers/mock";
import type { ModelOutput } from "../src/providers";

const FIXTURE = join(import.meta.dirname, "..", "fixtures", "mock", "todo-fix.jsonl");

async function drain(fixturePath: string): Promise<ModelOutput[]> {
  const provider = createMockProvider(fixturePath);
  const out: ModelOutput[] = [];
  for await (const e of provider.stream([], [])) out.push(e);
  return out;
}

describe("mock provider（统一流式接口）", () => {
  it("同一 fixture 跑两次，tool_call 序列完全一致", async () => {
    const run1 = (await drain(FIXTURE)).filter((e) => e.type === "tool_call");
    const run2 = (await drain(FIXTURE)).filter((e) => e.type === "tool_call");
    expect(run1.length).toBeGreaterThan(0);
    expect(run1).toEqual(run2);
    expect(run1.map((e) => (e as { name: string }).name)).toEqual(["read_file", "write_file", "run_shell"]);
  });

  it("按预录顺序吐出 assistant_message 与 tool_call", async () => {
    const out = await drain(FIXTURE);
    expect(out.map((e) => e.type)).toEqual([
      "assistant_message", "tool_call", "assistant_message",
      "tool_call", "assistant_message", "tool_call", "assistant_message",
    ]);
  });

  it("序列跑完即停：之后 stream() 恒为空（与旧 next() 恒 null 等价）", async () => {
    const provider = createMockProvider(FIXTURE);
    const first: ModelOutput[] = [];
    for await (const e of provider.stream([], [])) first.push(e);
    expect(first.length).toBe(7);
    const again1: ModelOutput[] = [];
    for await (const e of provider.stream([], [])) again1.push(e);
    const again2: ModelOutput[] = [];
    for await (const e of provider.stream([], [])) again2.push(e);
    expect(again1).toEqual([]);
    expect(again2).toEqual([]);
  });
});
