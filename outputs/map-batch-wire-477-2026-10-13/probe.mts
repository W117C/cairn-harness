import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGlmSessionProvider } from "../../src/agent/glm-session";
import { createEventLog, type AgentEvent } from "../../src/events";
import { MAX_FILES_DEFAULT } from "../../src/agent/map/cap";

async function run(label: string, events: AgentEvent[]): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "map-probe-"));
  try {
    const log = createEventLog(join(dir, "events.jsonl"));
    for (const e of events) await log.append(e);
    await log.close?.();
    const seen: string[][] = [];
    const provider = createGlmSessionProvider(join(dir, "events.jsonl"), {
      workspace: dir, system: "SYSTEM",
      mapBuilder: {
        build: async (opts) => {
          seen.push([...(opts.contextFiles ?? [])]);
          return { text: "", tokens: 0, ok: true, fromTagsCache: 0, parsed: 0, fromRenderCache: false, fingerprint: "fp", cap: MAX_FILES_DEFAULT, graphFiles: 0, candidates: 0, retrievedFiles: 0 };
        },
      },
      transport: async function* () { yield { type: "assistant_message", content: "ok" }; },
    });
    for await (const _ of provider.stream([])) { /* drain */ }
    console.log(label + " ⇒ 构建器被叫 " + String(seen.length) + " 次；contextFiles=" + JSON.stringify(seen[0] ?? null));
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

await run("只有 user_message", [{ type: "user_message", content: "TASK" }]);
await run("user_message + 一条批量 tool_call", [
  { type: "user_message", content: "TASK" },
  { type: "tool_call", id: "t1", name: "read_file", args: { paths: ["src/a.ts", "src/b.ts"] } },
]);
await run("批量 tool_call + user_message", [
  { type: "tool_call", id: "t1", name: "read_file", args: { paths: ["src/a.ts", "src/b.ts"] } },
  { type: "user_message", content: "TASK" },
]);
await run("user_message + 批量调用 + tool_result", [
  { type: "user_message", content: "TASK" },
  { type: "tool_call", id: "t1", name: "read_file", args: { paths: ["src/a.ts", "src/b.ts"] } },
  { type: "tool_result", callId: "t1", ok: true, output: "x" },
]);
