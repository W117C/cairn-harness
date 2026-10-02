import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createGlmSessionProvider } from "../src/agent/glm-session";
vi.mock("../src/agent/memory/inject", async () =>
  (await import("./helpers/memory-inject-mock")).memoryInjectMock({ project: null, global: null }));
let dir: string;
afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });
it("checks final remounted request before transport and preserves complete log", async () => {
  dir = await mkdtemp(join(process.env.PI_SCRATCH_DIR!, "final-budget-"));
  const path = join(dir, "events.jsonl");
  const original = JSON.stringify({ type: "user_message", content: "TASK" }) + "\n";
  await writeFile(path, original);
  let requests = 0;
  const transport = async function* () { requests++; yield { type: "assistant_message" as const, content: "ok" }; };
  const blocked = createGlmSessionProvider(path, { map: false, workspace: dir, transport,
    plugins: { deriveRemount: () => "x".repeat(600_000) } });
  await expect(async () => { for await (const _ of blocked.stream([])) {} }).rejects.toThrow("context_budget_exceeded");
  expect(requests).toBe(0);
  expect(await readFile(path, "utf8")).toBe(original);
  const normal = createGlmSessionProvider(path, { map: false, workspace: dir, transport });
  for await (const _ of normal.stream([])) {}
  expect(requests).toBe(1);
});
