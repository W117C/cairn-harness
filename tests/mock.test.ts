import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { createMockProvider } from "../src/providers/mock";
import type { ModelOutput } from "../src/providers";

const FIXTURE = join(import.meta.dirname, "..", "fixtures", "mock", "todo-fix.jsonl");

async function drain(fixturePath: string): Promise<ModelOutput[]> {
  const provider = createMockProvider(fixturePath);
  const out: ModelOutput[] = [];
  for (let i = 0; i < 100; i++) {
    const e = await provider.next();
    if (!e) break;
    out.push(e);
  }
  return out;
}

describe("mock provider", () => {
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

  it("序列跑完即停：之后 next() 恒为 null", async () => {
    const provider = createMockProvider(FIXTURE);
    for (let i = 0; i < 7; i++) await provider.next();
    expect(await provider.next()).toBeNull();
    expect(await provider.next()).toBeNull();
  });
});
