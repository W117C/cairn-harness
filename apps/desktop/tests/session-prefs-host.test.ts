import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { canonicalWorkspacePath, createKernelHost, type KernelHost } from "../src/main/kernel-host";
import { handleSessionPrefsSet, requireSessionMetadata, setSessionRootResolver } from "../../../src/main/session-handlers";
import { createSession } from "../../../src/main/sessions";

let root = ""; let a = ""; let b = ""; let userData = ""; let host: KernelHost;
function boot(): KernelHost {
  return createKernelHost({ workspaces: [a, b], activeWorkspace: a, userDataDir: userData, outbox: () => undefined });
}
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cairn-prefs-host-"));
  a = join(root, "a"); b = join(root, "b"); userData = join(root, "userData");
  for (const dir of [a, b, userData]) await mkdir(dir, { recursive: true });
  await writeFile(join(userData, "settings.json"), JSON.stringify({ provider: "demo", model: "" }));
  for (const ws of [a, b]) await createSession(join(ws, ".agent", "sessions"), "same");
  host = boot();
});
afterEach(async () => { await host.orchestrationClose(); setSessionRootResolver(null); await rm(root, { recursive: true, force: true }); });

it("lists independent saved choices after a fresh host boot", async () => {
  await handleSessionPrefsSet({ sessionId: "same", prefs: { model: "model-a", thinking: "high" } }, join(a, ".agent", "sessions"), { inheritLegacy: false });
  await handleSessionPrefsSet({ sessionId: "same", prefs: { model: "model-b", thinking: "low" } }, join(b, ".agent", "sessions"), { inheritLegacy: false });
  await host.orchestrationClose(); host = boot();
  const rows = await host.listSessions();
  expect(rows.find((s) => s.workspace === canonicalWorkspacePath(a))).toMatchObject({ model: "model-a", thinking: "high" });
  expect(rows.find((s) => s.workspace === canonicalWorkspacePath(b))).toMatchObject({ model: "model-b", thinking: "low" });
});

it("does not assign ambiguous legacy preferences to both same-id sessions", async () => {
  await requireSessionMetadata().setPrefs("same", { model: "unknown-owner", thinking: "high" });
  const rows = await host.listSessions();
  expect(rows).toHaveLength(2);
  for (const row of rows) { expect(row.model).toBeUndefined(); expect(row.thinking).toBeUndefined(); }
});

it("saves through the host using explicit registered workspaces and rejects ambiguous addressing", async () => {
  expect(await host.sessionPrefsSet("same", { model: "model-a", thinking: "high" }, a)).toEqual({ ok: true });
  expect(await host.sessionPrefsSet("same", { model: "model-b", thinking: "low" }, b)).toEqual({ ok: true });
  const rows = await host.listSessions();
  expect(rows.find((s) => s.workspace === canonicalWorkspacePath(a))).toMatchObject({ model: "model-a", thinking: "high" });
  expect(rows.find((s) => s.workspace === canonicalWorkspacePath(b))).toMatchObject({ model: "model-b", thinking: "low" });
  expect((await host.sessionPrefsSet("same", { model: "wrong" })).ok).toBe(false);
  expect((await host.sessionPrefsSet("same", { model: "wrong" }, root)).ok).toBe(false);
});

it("an explicit clear keeps masking legacy choices after the other same-id log disappears", async () => {
  await requireSessionMetadata().setPrefs("same", { model: "legacy", thinking: "high" });
  expect(await host.sessionPrefsSet("same", { model: null, thinking: null }, a)).toEqual({ ok: true });
  await rm(join(b, ".agent", "sessions", "same.jsonl"));
  await host.orchestrationClose(); host = boot();
  const row = (await host.listSessions())[0];
  expect(row?.model).toBeUndefined(); expect(row?.thinking).toBeUndefined();
  expect(await requireSessionMetadata().find("same")).toMatchObject({ model: "legacy", thinking: "high" });
});

it("keeps a malformed scoped sidecar visible instead of falling back or overwriting it", async () => {
  const path = join(a, ".agent", "sessions", "same.jsonl.prefs.json");
  await writeFile(path, "null\n");
  await expect(host.listSessions()).rejects.toThrow("会话偏好损坏");
  const result = await host.sessionPrefsSet("same", { model: "model-a" }, a);
  expect(result.ok).toBe(false); expect(result.error).toContain("会话偏好损坏");
  expect(await readFile(path, "utf8")).toBe("null\n");
});
