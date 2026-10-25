import { afterEach, expect, it } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OrchestrationService } from "../src/main/orchestration-service";
import { orchestrationPlan } from "./orchestration-fixture";
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of cleanups.splice(0).reverse()) await fn(); });
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "cairn-orchestration-service-")); cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const a = join(dir, "A"), b = join(dir, "B"); await Promise.all([mkdir(a), mkdir(b)]);
  const service = new OrchestrationService({ dataDir: join(dir, "data"), allowedWorkspaces: () => [a, b] }); cleanups.push(() => service.close());
  return { dir, a, b, service };
}
it("accepts real product session names containing Chinese text and spaces", async () => {
  const { a, service } = await setup();
  const response = await service.submit({ address: { workspace: a, sessionId: "会话 2026-10-25 #1" }, request_id: "submit", plan: orchestrationPlan() });
  expect(response.ok, JSON.stringify(response)).toBe(true);
});
it("isolates identically named sessions and plans in separate workspaces", async () => {
  const { a, b, service } = await setup();
  await service.submit({ address: { workspace: a, sessionId: "same" }, request_id: "submit", plan: orchestrationPlan() });
  const other = await service.view({ workspace: b, sessionId: "same" });
  expect(other.ok && Object.keys(other.snapshot.view.plans)).toEqual([]);
  const own = await service.view({ workspace: a, sessionId: "same" }); expect(own.ok && Object.keys(own.snapshot.view.plans)).toEqual(["plan"]);
});
it("rejects unregistered roots and unsafe session names", async () => {
  const { dir, a, service } = await setup();
  expect((await service.view({ workspace: dir, sessionId: "safe" })).ok).toBe(false);
  for (const sessionId of ["..", "a/b", "a\\b", "", "bad\0name"]) expect((await service.view({ workspace: a, sessionId })).ok).toBe(false);
});
it("asks the backend factory with the full session address, not just the workspace", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cairn-orchestration-service-backends-")); cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const workspace = join(dir, "ws"); await mkdir(workspace);
  const seen: string[] = [];
  const service = new OrchestrationService({ dataDir: join(dir, "data"), allowedWorkspaces: () => [workspace], backendFor: (address) => { seen.push(address.sessionId); return null; } });
  cleanups.push(() => service.close());
  await service.view({ workspace, sessionId: "session-a" });
  await service.view({ workspace, sessionId: "session-b" });
  expect(seen).toEqual(["session-a", "session-b"]);
});
it("defaults to shadow and refuses execute without an enforceable backend", async () => {
  const { a, service } = await setup(); const address = { workspace: a, sessionId: "safe" };
  const view = await service.view(address); expect(view.ok && view.snapshot.mode).toBe("shadow");
  expect((await service.submit({ address, request_id: "submit", plan: orchestrationPlan(), execute: true })).ok).toBe(false);
});
