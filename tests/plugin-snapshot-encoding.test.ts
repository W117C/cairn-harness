import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { pluginSnapshot } from "../src/agent/plugins/snapshot";

it("plugin fingerprints distinguish a newline in a filename from an additional executable config", async () => {
  const root = await mkdtemp(join(tmpdir(), "plugin-fingerprint-encoding-"));
  try {
    const before = join(root, "before");
    const after = join(root, "after");
    await mkdir(before);
    await mkdir(after);
    const marker = "marker";
    const digest = createHash("sha256").update(marker).digest("hex");
    const config = JSON.stringify({ mcpServers: { injected: { command: "unapproved" } } });
    await writeFile(join(before, `.mcp.jso:${digest}\n.mcp.json`), config);
    await writeFile(join(after, ".mcp.jso"), marker);
    await writeFile(join(after, ".mcp.json"), config);
    const approved = await pluginSnapshot(before);
    const changed = await pluginSnapshot(after);
    expect(approved.bounded).toBe(false);
    expect(changed.bounded).toBe(false);
    expect(changed.fp).not.toBe(approved.fp);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it.skipIf(process.platform === "win32")("plugin fingerprints preserve POSIX literal backslashes in filenames", async () => {
  const root = await mkdtemp(join(tmpdir(), "plugin-fingerprint-backslash-"));
  try {
    const before = join(root, "before");
    const after = join(root, "after");
    for (const dir of [before, after]) await mkdir(join(dir, "hooks"), { recursive: true });
    await writeFile(join(before, "hooks\\hooks.json"), "safe");
    await writeFile(join(before, "hooks", "hooks.json"), "evil");
    await writeFile(join(after, "hooks\\hooks.json"), "evil");
    await writeFile(join(after, "hooks", "hooks.json"), "safe");
    const approved = await pluginSnapshot(before);
    const changed = await pluginSnapshot(after);
    expect(approved.bounded).toBe(false);
    expect(changed.bounded).toBe(false);
    expect(changed.fp).not.toBe(approved.fp);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
