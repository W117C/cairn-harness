import { afterEach, expect, it, vi } from "vitest";
import { browserThemeEnv } from "../src/renderer/theme";

afterEach(() => { vi.unstubAllGlobals(); });

it("实际主题同时更新 Cairn 与上游皮肤的标记，亮暗往返不残留", () => {
  const root = new Map<string, string>();
  const body = new Set<string>();
  vi.stubGlobal("document", {
    documentElement: { setAttribute: (name: string, value: string) => { root.set(name, value); } },
    body: { toggleAttribute: (name: string, on: boolean) => { if (on) body.add(name); else body.delete(name); } },
  });
  vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
  const env = browserThemeEnv();
  env.setDataTheme("dark");
  expect(root.get("data-theme")).toBe("dark");
  expect(body.has("data-ds-dark-theme")).toBe(true);
  env.setDataTheme("light");
  expect(root.get("data-theme")).toBe("light");
  expect(body.has("data-ds-dark-theme")).toBe(false);
});
