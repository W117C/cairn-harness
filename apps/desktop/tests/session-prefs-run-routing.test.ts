import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createSession } from "../../../src/main/sessions";
import { canonicalWorkspacePath, createKernelHost, type KernelHost } from "../src/main/kernel-host";
import { handleAgentRun } from "../../../src/main/agent-runner";

vi.mock("../../../src/main/agent-runner", async (original) => ({
  ...await original<typeof import("../../../src/main/agent-runner")>(), handleAgentRun: vi.fn(async () => ({ ok: true })),
}));

let root = ""; let a = ""; let b = ""; let host: KernelHost;
beforeEach(async () => {
  vi.mocked(handleAgentRun).mockClear();
  root = await mkdtemp(join(tmpdir(), "cairn-prefs-run-"));
  a = join(root, "a"); b = join(root, "b"); const userData = join(root, "userData");
  for (const dir of [a, b, userData]) await mkdir(dir, { recursive: true });
  await writeFile(join(userData, "settings.json"), JSON.stringify({ provider: "demo", model: "" }));
  for (const ws of [a, b]) await createSession(join(ws, ".agent", "sessions"), "same");
  host = createKernelHost({ workspaces: [a, b], activeWorkspace: a, userDataDir: userData, outbox: () => undefined });
});
afterEach(async () => { await host.orchestrationClose(); await rm(root, { recursive: true, force: true }); });

it("routes an explicit same-id run to its workspace and exact log", async () => {
  const result = await host.run({ sessionId: "same", workspace: b, message: "continue B", model: "model-b", thinking: "low", mode: "default" });
  expect(result.ok).toBe(true);
  expect(handleAgentRun).toHaveBeenCalledWith(expect.objectContaining({ model: "model-b", thinking: "low" }),
    expect.objectContaining({ workspace: canonicalWorkspacePath(b), logPath: join(canonicalWorkspacePath(b), ".agent", "sessions", "same.jsonl") }));
});

it("keeps another workspace's same-id run isolated while the first execution is active", async () => {
  let finish!: () => void;
  vi.mocked(handleAgentRun).mockImplementationOnce(async () => { await new Promise<void>((resolve) => { finish = resolve; }); return { ok: true }; });
  const active = host.run({ sessionId: "same", workspace: a, message: "continue A", mode: "default" });
  void active.catch(() => undefined);
  try {
    await vi.waitFor(() => expect(handleAgentRun).toHaveBeenCalledTimes(1));
    expect((await host.openSession("same", b)).running).toBe(false);
    expect(() => host.removeWorkspace(a)).toThrow(/正在运行/);
    const rejected = await host.run({ sessionId: "same", workspace: b, message: "continue B", mode: "default" });
    expect(rejected.ok).toBe(false);
    expect(rejected.error).not.toMatch(/already running|已在运行|正在运行/u);
    expect(handleAgentRun).toHaveBeenCalledTimes(1);
  } finally { finish?.(); await active; }
});

it("distinguishes admission rejection from failure after a user message was accepted", async () => {
  const request = { sessionId: "same", workspace: a, message: "queue message", mode: "default" as const };
  vi.mocked(handleAgentRun).mockResolvedValueOnce({ ok: false, error: "admission refused" });
  expect(await host.run(request)).toMatchObject({ ok: false, accepted: false });
  vi.mocked(handleAgentRun).mockImplementationOnce(async (_req, overrides) => {
    overrides?.onEvent?.({ type: "user_message", content: "queue message" });
    return { ok: false, error: "execution failed" };
  });
  expect(await host.run(request)).toMatchObject({ ok: false, accepted: true });
});
