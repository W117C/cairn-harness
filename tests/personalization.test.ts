import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { systemPromptFor } from "../src/agent/system-prompt";
import { SettingsStore } from "../src/main/settings";

it("persists instructions, keeps an old profile compatible and rejects oversized edits", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cairn-instructions-"));
  try {
    const path = join(dir, "settings.json");
    const store = new SettingsStore(path);
    expect((await store.get()).customInstructions).toBe("");
    await store.set({ customInstructions: "请用简体中文答复" });
    await expect(store.set({ customInstructions: "啊".repeat(4001) })).rejects.toThrow("12000");
    expect((await new SettingsStore(path).get()).customInstructions).toBe("请用简体中文答复");
    await store.set({ customInstructions: "" });
    expect((await new SettingsStore(path).get()).customInstructions).toBe("");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("keeps mode instructions and adds personalized text only when configured", () => {
  const baseline = systemPromptFor("read-only");
  expect(systemPromptFor("read-only", "  \n")).toBe(baseline);
  const customized = systemPromptFor("read-only", "回答时用中文。");
  expect(customized.startsWith(baseline)).toBe(true);
  expect(customized).toContain("回答时用中文。");
});

it("a concurrent migration cannot overwrite user instructions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cairn-instructions-import-"));
  try {
    const store = new SettingsStore(join(dir, "settings.json"));
    const manual = store.set({ customInstructions: "我的偏好" });
    const imported = store.importCustomInstructions("导入指令");
    await manual;
    await expect(imported).resolves.toBe(false);
    expect((await store.get()).customInstructions).toBe("我的偏好");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
