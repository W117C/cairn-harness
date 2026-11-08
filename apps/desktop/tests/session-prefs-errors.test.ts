import { afterEach, expect, it, vi } from "vitest";
import { applySessionModelPick } from "../src/renderer/state/session-prefs";

afterEach(() => { vi.unstubAllGlobals(); });

it("shows a rejected save response even when IPC itself resolves successfully", async () => {
  vi.stubGlobal("window", { agent: {
    sessionPrefsSet: async () => ({ ok: false, error: "会话不存在: foreign" }),
  } });
  const setLastError = vi.fn();
  applySessionModelPick({
    activeId: "foreign", registryId: "deepseek-chat", selections: { current: new Map() },
    force: () => undefined, providerInfo: null, refreshProviderInfo: async () => undefined, setLastError,
  });
  await vi.waitFor(() => {
    expect(setLastError).toHaveBeenCalledWith(expect.stringContaining("会话不存在: foreign"));
  });
});
