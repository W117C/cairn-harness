import { afterEach, expect, it, vi } from "vitest";
import { applySessionModelPick, hydrateSessionPrefs } from "../src/renderer/state/session-prefs";
import { composerThinking } from "../src/renderer/state/thinking-selection";

afterEach(() => vi.unstubAllGlobals());

it("hydrates two same-id rows into independent workspace/session keys", () => {
  const models = new Map<string, string | null>();
  const thinking = new Map<string, string>();
  hydrateSessionPrefs([
    { id: "same", workspace: "/a", model: "model-a", thinking: "high" },
    { id: "same", workspace: "/b", model: "model-b", thinking: "low" },
  ], models, thinking);
  expect(models.get('["/a","same"]')).toBe("model-a");
  expect(models.get('["/b","same"]')).toBe("model-b");
  expect(composerThinking("same", "off", thinking, "/a")).toBe("high");
  expect(composerThinking("same", "off", thinking, "/b")).toBe("low");
});

it("changing a model writes its scoped key and forwards workspace through IPC", () => {
  const sessionPrefsSet = vi.fn(async () => ({ ok: true }));
  vi.stubGlobal("window", { agent: { sessionPrefsSet } });
  const selections = { current: new Map<string, string | null>([['["/b","same"]', "model-b"]]) };
  applySessionModelPick({ activeId: "same", activeWorkspace: "/a", registryId: "model-a", selections,
    force: () => undefined, providerInfo: null, refreshProviderInfo: async () => undefined, setLastError: vi.fn() });
  expect(selections.current.get('["/a","same"]')).toBe("model-a");
  expect(selections.current.get('["/b","same"]')).toBe("model-b");
  expect(sessionPrefsSet).toHaveBeenCalledWith("same", { model: "model-a" }, "/a");
});
