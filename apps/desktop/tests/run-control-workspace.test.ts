import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createSession } from "../../../src/main/sessions";
import { handleAgentRun } from "../../../src/main/agent-runner";
import { createKernelHost, type KernelHost } from "../src/main/kernel-host";

vi.mock("../../../src/main/agent-runner", async (original) => ({
  ...await original<typeof import("../../../src/main/agent-runner")>(), handleAgentRun: vi.fn(async () => ({ ok: true })),
}));

let root: string, a: string, b: string, host: KernelHost;
beforeEach(async () => {
  vi.mocked(handleAgentRun).mockReset();
  root = await mkdtemp(join(tmpdir(), "cairn-run-control-"));
  a = join(root, "a"); b = join(root, "b"); const userData = join(root, "userData");
  for (const dir of [a, b, userData]) await mkdir(dir, { recursive: true });
  await writeFile(join(userData, "settings.json"), JSON.stringify({ provider: "demo", model: "" }));
  for (const ws of [a, b]) await createSession(join(ws, ".agent", "sessions"), "same");
  host = createKernelHost({ workspaces: [a, b], activeWorkspace: a, userDataDir: userData, outbox: () => undefined });
});
afterEach(async () => { await host.orchestrationClose(); await rm(root, { recursive: true, force: true }); });

async function withRun(check: (over: NonNullable<Parameters<typeof handleAgentRun>[1]>) => Promise<void>, id = "same") {
  let finish: () => void = () => undefined;
  let overrides: Parameters<typeof handleAgentRun>[1];
  vi.mocked(handleAgentRun).mockImplementationOnce(async (_req, over) => {
    overrides = over;
    await new Promise<void>((resolve) => { finish = resolve; });
    return { ok: true };
  });
  const pending = host.run({ sessionId: id, workspace: a, message: "run A", mode: "default" });
  try {
    await vi.waitFor(() => expect(overrides?.signal).toBeDefined());
    await check(overrides!);
  } finally { finish(); await pending; }
}

it("another workspace cannot steer or cancel the same-id run, even after opening its own session", async () => withRun(async (over) => {
  await host.openSession("same", b);
  expect(await host.steer("same", "only for B", b)).toMatchObject({ ok: false, code: "workspace_mismatch" });
  expect(await host.cancel("same", b)).toMatchObject({ ok: false, code: "workspace_mismatch" });
  expect(over.signal?.aborted).toBe(false);
  expect(over.steering?.take()).toBeUndefined();
}));

it("the exact workspace can steer and cancel through a canonical directory alias", async () => withRun(async (over) => {
  const alias = join(root, "alias"); await symlink(a, alias);
  expect(await host.steer("same", "for A", alias)).toMatchObject({ ok: true, queued: 1 });
  expect(over.steering?.take()).toEqual(["for A"]);
  expect(await host.cancel("same", alias)).toEqual({ ok: true });
  expect(over.signal?.aborted).toBe(true);
}));

it("legacy controls without workspace reject ambiguous session ids", async () => withRun(async (over) => {
  expect(await host.steer("same", "ambiguous")).toMatchObject({ ok: false, code: "invalid_target" });
  expect(await host.cancel("same")).toMatchObject({ ok: false, code: "invalid_target" });
  expect(over.signal?.aborted).toBe(false);
  expect(over.steering?.take()).toBeUndefined();
}));

it("legacy controls still work for a unique session id", async () => {
  await createSession(join(a, ".agent", "sessions"), "unique");
  await withRun(async (over) => {
    expect(await host.steer("unique", "unique message")).toMatchObject({ ok: true });
    expect(over.steering?.take()).toEqual(["unique message"]);
    expect(await host.cancel("unique")).toEqual({ ok: true });
    expect(over.signal?.aborted).toBe(true);
  }, "unique");
});

it("invalid or unregistered explicit targets cannot fall back to the live run", async () => withRun(async (over) => {
  for (const workspace of [null, "", 42, join(root, "unregistered")]) {
    expect(await host.cancel("same", workspace)).toMatchObject({ ok: false, code: "invalid_target" });
    expect(await host.steer("same", "bad target", workspace)).toMatchObject({ ok: false, code: "invalid_target" });
  }
  expect(over.signal?.aborted).toBe(false);
  expect(over.steering?.take()).toBeUndefined();
}));

it("an aborted run no longer acknowledges new steering text", async () => withRun(async (over) => {
  await host.cancel("same", a);
  expect((await host.steer("same", "too late", a)).ok).toBe(false);
  expect(over.steering?.take()).toBeUndefined();
}));

it("reports no live run without creating a controller or a steering inbox", async () => {
  expect((await host.cancel("same", a)).ok).toBe(false);
  expect((await host.steer("same", "not received", a)).ok).toBe(false);
  expect(host.runningCount()).toBe(0);
});

it("rejects malformed ids and steering content without changing the active run", async () => withRun(async (over) => {
  for (const id of [undefined, null, 42, "", "  "]) {
    expect(await host.cancel(id, a)).toMatchObject({ ok: false, code: "invalid_target" });
    expect(await host.steer(id, "bad id", a)).toMatchObject({ ok: false, code: "invalid_target" });
  }
  for (const text of [null, 42, "", "  "]) {
    expect(await host.steer("same", text, a)).toMatchObject({ ok: false, code: "invalid_target" });
  }
  expect(over.signal?.aborted).toBe(false);
  expect(over.steering?.take()).toBeUndefined();
}));
