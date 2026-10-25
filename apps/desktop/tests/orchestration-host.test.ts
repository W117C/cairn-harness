import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createKernelHost } from "../src/main/kernel-host";
import { orchestrationPlan } from "../../../tests/orchestration-fixture";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); });

describe("desktop orchestration host boundary", () => {
  it("persists controls in the explicit workspace/session and rejects unknown addresses", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cairn-orch-host-"));
    cleanup.push(() => rm(dir, { recursive: true, force: true }));
    const workspacePath = join(dir, "workspace");
    const otherPath = join(dir, "other");
    const userDataDir = join(dir, "user-data");
    await mkdir(workspacePath); await mkdir(otherPath); await mkdir(userDataDir);
    const workspace = await realpath(workspacePath);
    const other = await realpath(otherPath);
    await writeFile(join(userDataDir, "settings.json"), JSON.stringify({ provider: "demo" }));
    const host = createKernelHost({ workspaces: [workspace, other], activeWorkspace: workspace, userDataDir, outbox: () => undefined });
    expect(typeof host.orchestrationView).toBe("function");
    cleanup.push(() => host.orchestrationClose());
    const first = await host.createSession(workspace);
    const second = await host.createSession(other);
    const address = { workspace, sessionId: first.id };
    const submitted = await host.orchestrationSubmit({ address, request_id: "submit-1", plan: orchestrationPlan() });
    expect(submitted).toMatchObject({ ok: true, snapshot: { mode: "shadow", address, view: { plans: { plan: { phase: "proposed" } } } } });
    const approved = await host.orchestrationControl({ address, command: { request_id: "approve-1", plan_id: "plan", version: 1, action: "approve_plan" } });
    expect(approved).toMatchObject({ ok: true, snapshot: { view: { plans: { plan: { phase: "approved" } } } } });
    expect(await host.orchestrationView({ workspace, sessionId: second.id })).toMatchObject({ ok: false, error: expect.any(String) });
    expect(await host.orchestrationView({ workspace: other, sessionId: first.id })).toMatchObject({ ok: false, error: expect.any(String) });
    expect(await host.orchestrationView({ workspace: other, sessionId: second.id })).toMatchObject({ ok: true, snapshot: { view: { plans: {} } } });
    expect(await host.orchestrationView({ workspace: dir, sessionId: first.id })).toMatchObject({ ok: false, error: expect.any(String) });
    expect(await host.orchestrationControl({ address, command: { request_id: "unknown", plan_id: "missing", version: 1, action: "pause_plan" } })).toMatchObject({ ok: false, error: expect.any(String) });
  });
});
