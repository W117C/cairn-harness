import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  handleSessionCreate, handleSessionPrefsSet, initSessionsDir,
  requireSessionMetadata, setSessionRootResolver,
} from "../src/main/session-handlers";
import { createSession } from "../src/main/sessions";

let root = "";
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cairn-prefs-routing-"));
  initSessionsDir(join(root, "active"));
});
afterEach(async () => {
  setSessionRootResolver(null);
  await rm(root, { recursive: true, force: true });
});

describe("session preferences root resolution", () => {
  it("saves preferences for a session in a resolved non-default workspace", async () => {
    const otherRoot = join(root, "other");
    const metadata = requireSessionMetadata();
    const id = await createSession(otherRoot, "foreign", metadata);
    setSessionRootResolver(async (sessionId) => sessionId === id ? otherRoot : null);
    const result = await handleSessionPrefsSet({ sessionId: id, prefs: { model: "deepseek-chat", thinking: "high" } });
    expect(result).toEqual({ ok: true });
    expect(await metadata.find(id)).toMatchObject({ model: "deepseek-chat", thinking: "high" });
  });

  it("refuses an unresolved session instead of writing to the default root", async () => {
    const { id } = await handleSessionCreate("local");
    setSessionRootResolver(async () => null);
    const result = await handleSessionPrefsSet({ sessionId: id, prefs: { model: "deepseek-chat" } });
    expect(result.ok).toBe(false);
    expect((await requireSessionMetadata().find(id))?.model).toBeUndefined();
  });
});
