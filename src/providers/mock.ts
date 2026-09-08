import { readFile } from "node:fs/promises";
import type { AgentEvent } from "../events";
import type { ModelOutput, Provider } from "./index.js";

// 从 fixture JSONL 预录序列创建 mock provider：
// 按序吐出预录的 assistant_message / tool_call，序列跑完即停（之后 next() 恒为 null）。
export function createMockProvider(fixturePath: string): Provider {
  let script: ModelOutput[] | null = null;
  let cursor = 0;

  async function load(): Promise<void> {
    if (script) return;
    const raw = await readFile(fixturePath, "utf8");
    const parsed = raw
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as AgentEvent);
    const out: ModelOutput[] = [];
    for (const e of parsed) {
      if (e.type === "assistant_message" || e.type === "tool_call") {
        out.push(e);
      } else {
        throw new Error(`mock fixture 只允许 assistant_message/tool_call，读到: ${JSON.stringify(e)}`);
      }
    }
    script = out;
  }

  return {
    async next() {
      await load();
      const event = script![cursor++];
      return event ?? null; // 序列跑完即停
    },
  };
}
