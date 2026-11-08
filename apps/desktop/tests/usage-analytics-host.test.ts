import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createKernelHost } from "../src/main/kernel-host";

const dir = mkdtempSync(join(tmpdir(), "cairn-usage-analytics-host-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const line = (row: unknown) => JSON.stringify(row) + "\n";
const stamp = new Date(2026, 9, 24, 10).getTime();
const workspaces = [join(dir, "a"), join(dir, "b")];
const userDataDir = join(dir, "user-data");
mkdirSync(userDataDir, { recursive: true });
writeFileSync(join(userDataDir, "settings.json"), JSON.stringify({ provider: "demo" }));
for (const workspace of workspaces) mkdirSync(join(workspace, ".agent", "sessions"), { recursive: true });
const sessionFile = (workspace: string, id: string) => join(workspace, ".agent", "sessions", `${id}.jsonl`);
const first = sessionFile(workspaces[0]!, "first");
const original = [
  { type: "session_meta", session_id: "first" },
  { type: "user_message", content: "hi", ts: stamp },
  { type: "usage", inputTokens: 100, outputTokens: 20, model: "model-a", ts: stamp },
].map(line).join("");
writeFileSync(first, original);
writeFileSync(sessionFile(workspaces[0]!, "empty-usage"), line({ type: "session_meta", session_id: "empty-usage" }) + line({ type: "user_message", content: "no provider report", ts: stamp }));
writeFileSync(sessionFile(workspaces[1]!, "fork"), [
  { type: "session_meta", session_id: "fork", lineage: { parent: "first", boundary: 3 } },
  { type: "usage", inputTokens: 30, outputTokens: 5, model: "model-a", agent_id: "worker", ts: stamp },
  { type: "usage", inputTokens: 7, outputTokens: 0 },
].map(line).join(""));
writeFileSync(join(workspaces[1]!, ".agent", "sessions", "session-metadata.json"), "{broken}");
const host = createKernelHost({ workspaces, activeWorkspace: workspaces[0]!, userDataDir, outbox: () => undefined });

describe("host analytics projection", () => {
  it("merges model/day buckets across workspaces, counts sessions once per day, and never expands fork parents", async () => {
    const result = await host.usageLedger();
    if (!result.ok) throw new Error(result.error);
    expect(result.workspaces).toBe(2);
    expect(result.sessions).toBe(3);
    expect(result.totals.inputTokens).toBe(137);
    expect(result.analytics).toMatchObject({ sessionsWithUsage: 2, sessionsWithoutUsage: 1 });
    expect(result.analytics?.buckets.find((row) => row.model === "model-a")).toMatchObject({ day: "2026-10-24", inputTokens: 130, outputTokens: 25, usageCount: 2, workerUsageCount: 1 });
    expect(result.analytics?.activity.find((row) => row.day === "2026-10-24")).toEqual({ day: "2026-10-24", sessions: 3, rounds: 2, toolSteps: 0 });
    expect(result.analytics?.buckets.find((row) => row.day === null)).toMatchObject({ model: null, inputTokens: 7 });
    expect(readFileSync(first, "utf8")).toBe(original);
  });

  it("refreshes changed files without letting response mutation corrupt the cached measurements", async () => {
    const firstResult = await host.usageLedger();
    if (!firstResult.ok) throw new Error(firstResult.error);
    firstResult.analytics!.buckets[0]!.inputTokens = 9999;
    appendFileSync(first, line({ type: "usage", inputTokens: 2, outputTokens: 1, model: "model-a", ts: stamp }));
    const next = await host.usageLedger();
    if (!next.ok) throw new Error(next.error);
    expect(next.totals.inputTokens).toBe(139);
    expect(next.analytics?.buckets.find((row) => row.model === "model-a")?.inputTokens).toBe(132);
  });
});
