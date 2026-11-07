import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { UserIntegrationSettings } from "../src/main/user-integration-settings";

it("merges disabled imports without replacing existing rows or stale saves", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cairn-integrations-"));
  try {
    const settings = new UserIntegrationSettings(dir);
    const before = await settings.mcpConfig();
    await expect(settings.mcpSave({ servers: { local: { command: "echo", args: ["two words", ""] } }, expectedRevision: before.revision })).resolves.toMatchObject({ ok: true });
    const initial = await settings.mcpConfig();
    await expect(settings.importMcp([
      { name: "local", config: { command: "ignored" } },
      { name: "remote", config: { url: "https://example.com/mcp" } },
    ])).resolves.toEqual(["remote"]);
    await expect(settings.mcpSave({ servers: {}, expectedRevision: initial.revision })).resolves.toMatchObject({ ok: false, conflict: true });
    expect((await settings.mcpConfig()).servers).toEqual([
      { name: "local", config: { command: "echo", args: ["two words", ""] } },
      { name: "remote", config: { type: "http", url: "https://example.com/mcp", disabled: true } },
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("keeps extra hook handlers and refuses to overwrite invalid files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cairn-hooks-"));
  try {
    const settings = new UserIntegrationSettings(dir);
    const path = join(dir, "hooks.json");
    const hooks = { PreToolUse: [{ if: "Read", matcher: "read_file", hooks: [
      { type: "command", command: ["echo", "two words"], timeout: 8 },
      { type: "prompt", prompt: "Check the path" },
    ] }] };
    await writeFile(path, JSON.stringify({ description: "example", hooks }));
    const config = await settings.hooksConfig();
    expect(config.hooks).toEqual(hooks);
    await expect(settings.hooksSave({ hooks: config.hooks, expectedRevision: config.revision })).resolves.toMatchObject({ ok: true });
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ description: "example", hooks });
    const invalid = '{"hooks":{"Stop":[null]}}';
    await writeFile(path, invalid);
    expect((await settings.hooksConfig()).errors).not.toEqual([]);
    await expect(settings.hooksSave({ hooks: {} })).resolves.toMatchObject({ ok: false });
    expect(await readFile(path, "utf8")).toBe(invalid);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
