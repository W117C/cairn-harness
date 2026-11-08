import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { handleSessionPrefsSet, initSessionsDir, requireSessionMetadata, setSessionRootResolver } from "../src/main/session-handlers";
import { createSession, deleteSession, pathOf, renameSession } from "../src/main/sessions";

let root = "";
let a = "";
let b = "";
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cairn-scoped-prefs-"));
  a = join(root, "a"); b = join(root, "b");
  initSessionsDir(a);
  await createSession(a, "same");
  await createSession(b, "same");
});
afterEach(async () => { setSessionRootResolver(null); await rm(root, { recursive: true, force: true }); });

async function readPrefs(dir: string): Promise<unknown> {
  try { return JSON.parse(await readFile(`${pathOf(dir, "same")}.prefs.json`, "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

it("saves same-id preferences beside each exact session without overwriting the other root", async () => {
  const first = await handleSessionPrefsSet({ sessionId: "same", prefs: { model: "model-a", thinking: "high" } }, a, { inheritLegacy: false });
  const second = await handleSessionPrefsSet({ sessionId: "same", prefs: { model: "model-b", thinking: "low" } }, b, { inheritLegacy: false });
  expect([first, second]).toEqual([{ ok: true }, { ok: true }]);
  expect(await readPrefs(a)).toEqual({ version: 1, model: "model-a", thinking: "high" });
  expect(await readPrefs(b)).toEqual({ version: 1, model: "model-b", thinking: "low" });
});

it("clears one scoped field while keeping its sibling and the other workspace", async () => {
  await handleSessionPrefsSet({ sessionId: "same", prefs: { model: "model-a", thinking: "high" } }, a, { inheritLegacy: false });
  await handleSessionPrefsSet({ sessionId: "same", prefs: { model: "model-b" } }, b, { inheritLegacy: false });
  await handleSessionPrefsSet({ sessionId: "same", prefs: { model: null } }, a, { inheritLegacy: false });
  expect(await readPrefs(a)).toEqual({ version: 1, thinking: "high" });
  expect(await readPrefs(b)).toEqual({ version: 1, model: "model-b" });
});

it("inherits an unambiguous legacy choice on first save without rewriting the old metadata", async () => {
  const metadata = requireSessionMetadata();
  await metadata.setPrefs("same", { model: "legacy-model", thinking: "high" });
  await handleSessionPrefsSet({ sessionId: "same", prefs: { model: "new-model" } }, a, { inheritLegacy: true });
  expect(await readPrefs(a)).toEqual({ version: 1, model: "new-model", thinking: "high" });
  expect(await metadata.find("same")).toMatchObject({ model: "legacy-model", thinking: "high" });
});

it("renames and deletes only the addressed session's preference file", async () => {
  await handleSessionPrefsSet({ sessionId: "same", prefs: { model: "model-a" } }, a, { inheritLegacy: false });
  await handleSessionPrefsSet({ sessionId: "same", prefs: { model: "model-b" } }, b, { inheritLegacy: false });
  await renameSession(a, "same", "renamed");
  const renamed = `${pathOf(a, "renamed")}.prefs.json`;
  expect(await readPrefs(a)).toBeNull();
  expect(JSON.parse(await readFile(renamed, "utf8"))).toEqual({ version: 1, model: "model-a" });
  await deleteSession(a, "renamed");
  await expect(readFile(renamed)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readPrefs(b)).toEqual({ version: 1, model: "model-b" });
});

it("refuses a preference target collision and rolls the log name back", async () => {
  await handleSessionPrefsSet({ sessionId: "same", prefs: { model: "model-a" } }, a, { inheritLegacy: false });
  const target = `${pathOf(a, "renamed")}.prefs.json`;
  await writeFile(target, '{"version":1,"model":"orphan"}');
  await expect(renameSession(a, "same", "renamed")).rejects.toThrow(/偏好.*存在/);
  expect(await readFile(pathOf(a, "same"), "utf8")).toBe("");
  expect(JSON.parse(await readFile(target, "utf8"))).toEqual({ version: 1, model: "orphan" });
});

it("restores the preference sidecar when metadata rename fails", async () => {
  await handleSessionPrefsSet({ sessionId: "same", prefs: { thinking: "high" } }, a, { inheritLegacy: false });
  await expect(renameSession(a, "same", "renamed", { rename: async () => { throw new Error("metadata write failed"); } })).rejects.toThrow("metadata write failed");
  expect(await readPrefs(a)).toEqual({ version: 1, thinking: "high" });
  expect(await readFile(pathOf(a, "same"), "utf8")).toBe("");
});

it("restores log, metadata and preferences when deletion fails after staging", async () => {
  const metadata = requireSessionMetadata();
  await metadata.create("same");
  await handleSessionPrefsSet({ sessionId: "same", prefs: { model: "model-a" } }, a, { inheritLegacy: false });
  await expect(deleteSession(a, "same", {
    find: (id) => metadata.find(id), restore: (record) => metadata.restore(record),
    remove: async (id) => { await metadata.remove(id); throw new Error("metadata write failed"); },
  })).rejects.toThrow("metadata write failed");
  expect(await readPrefs(a)).toEqual({ version: 1, model: "model-a" });
  expect(await metadata.find("same")).toBeDefined();
  expect(await readFile(pathOf(a, "same"), "utf8")).toBe("");
});

it("keeps malformed preference bytes and reports the failed save", async () => {
  const path = `${pathOf(a, "same")}.prefs.json`;
  await writeFile(path, "null\n");
  const result = await handleSessionPrefsSet({ sessionId: "same", prefs: { model: "model-a" } }, a, { inheritLegacy: false });
  expect(result.ok).toBe(false);
  expect(result.error).toContain("会话偏好损坏");
  expect(await readFile(path, "utf8")).toBe("null\n");
});

it("serializes simultaneous model and thinking patches without losing a field", async () => {
  const results = await Promise.all([
    handleSessionPrefsSet({ sessionId: "same", prefs: { model: "model-a" } }, a, { inheritLegacy: false }),
    handleSessionPrefsSet({ sessionId: "same", prefs: { thinking: "high" } }, a, { inheritLegacy: false }),
  ]);
  expect(results).toEqual([{ ok: true }, { ok: true }]);
  expect(await readPrefs(a)).toEqual({ version: 1, model: "model-a", thinking: "high" });
});
