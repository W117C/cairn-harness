import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create as tarCreate } from "tar";
import { afterEach, describe, expect, it } from "vitest";
import {
  MAX_PLUGIN_ARCHIVE_BYTES,
  MAX_PLUGIN_ARCHIVE_FILE_BYTES,
  extractPluginArchive,
  inspectPluginArchive,
} from "../src/agent/plugins/package-archive";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "cairn-plugin-archive-"));
  dirs.push(dir);
  return dir;
}

async function archive(
  source: string,
  paths: string[],
  options: {
    prefix?: string;
    preservePaths?: boolean;
    onWriteEntry?: (entry: { path: string }) => void;
  } = {},
): Promise<string> {
  const file = join(scratch(), "plugin.tgz");
  await tarCreate({
    cwd: source,
    file,
    gzip: true,
    portable: true,
    ...options,
  }, paths);
  return file;
}

function pluginSource(): string {
  const source = scratch();
  const root = join(source, "demo-plugin");
  mkdirSync(join(root, ".claude-plugin"), { recursive: true });
  writeFileSync(join(root, ".claude-plugin", "plugin.json"), JSON.stringify({
    name: "demo-plugin",
    version: "1.2.3",
  }));
  writeFileSync(join(root, "skills.md"), "# Demo\n");
  return source;
}

describe("plugin package archive", () => {
  it("accepts one package root and strips it during extraction", async () => {
    const archivePath = await archive(pluginSource(), ["demo-plugin"]);
    const listing = await inspectPluginArchive(archivePath, statSync(archivePath).size);

    expect(listing.rootName).toBe("demo-plugin");
    expect(listing.files).toContain(".claude-plugin/plugin.json");

    const destination = scratch();
    await extractPluginArchive(archivePath, destination, listing);
    expect(readFileSync(join(destination, ".claude-plugin", "plugin.json"), "utf8"))
      .toContain("demo-plugin");
    expect(statSync(join(destination, ".claude-plugin", "plugin.json")).mode & 0o777).toBe(0o600);
  });

  it("rejects traversal paths", async () => {
    const source = pluginSource();
    const archivePath = await archive(source, ["demo-plugin"], {
      prefix: "../",
      preservePaths: true,
    });

    await expect(inspectPluginArchive(archivePath, statSync(archivePath).size))
      .rejects.toThrow(/path|outside/i);
  });

  it("rejects symbolic links", async () => {
    const source = pluginSource();
    symlinkSync("/etc/passwd", join(source, "demo-plugin", "outside"));
    const archivePath = await archive(source, ["demo-plugin"]);

    await expect(inspectPluginArchive(archivePath, statSync(archivePath).size))
      .rejects.toThrow(/link/i);
  });

  it("rejects archives with multiple roots", async () => {
    const source = scratch();
    mkdirSync(join(source, "root-a"), { recursive: true });
    mkdirSync(join(source, "root-b"), { recursive: true });
    writeFileSync(join(source, "root-a", "a.txt"), "a");
    writeFileSync(join(source, "root-b", "b.txt"), "b");
    const archivePath = await archive(source, ["root-a", "root-b"]);

    await expect(inspectPluginArchive(archivePath, statSync(archivePath).size))
      .rejects.toThrow(/single root/i);
  });

  it("rejects duplicate and case-folded collisions", async () => {
    const duplicateSource = pluginSource();
    mkdirSync(join(duplicateSource, "demo-plugin", "nested"), { recursive: true });
    writeFileSync(join(duplicateSource, "demo-plugin", "nested", "b.txt"), "b");
    const duplicatePath = await archive(duplicateSource, ["demo-plugin"], {
      onWriteEntry(entry) {
        if (entry.path.endsWith("skills.md")) entry.path = "demo-plugin/README.md";
        if (entry.path.endsWith("nested/b.txt")) entry.path = "demo-plugin/README.md";
      },
    });
    await expect(inspectPluginArchive(duplicatePath, statSync(duplicatePath).size))
      .rejects.toThrow(/duplicate/i);

    const collisionSource = pluginSource();
    mkdirSync(join(collisionSource, "demo-plugin", "nested"), { recursive: true });
    writeFileSync(join(collisionSource, "demo-plugin", "nested", "b.txt"), "b");
    const collisionPath = await archive(collisionSource, ["demo-plugin"], {
      onWriteEntry(entry) {
        if (entry.path.endsWith("skills.md")) entry.path = "demo-plugin/README.md";
        if (entry.path.endsWith("nested/b.txt")) entry.path = "demo-plugin/readme.md";
      },
    });
    await expect(inspectPluginArchive(collisionPath, statSync(collisionPath).size))
      .rejects.toThrow(/collision/i);
  });

  it("rejects oversized archives and individual files", async () => {
    const source = pluginSource();
    const archivePath = await archive(source, ["demo-plugin"]);

    await expect(inspectPluginArchive(archivePath, MAX_PLUGIN_ARCHIVE_BYTES + 1))
      .rejects.toThrow(/archive.*limit/i);

    writeFileSync(
      join(source, "demo-plugin", "large.bin"),
      Buffer.alloc(MAX_PLUGIN_ARCHIVE_FILE_BYTES + 1),
    );
    const oversizedPath = await archive(source, ["demo-plugin"]);
    await expect(inspectPluginArchive(oversizedPath, statSync(oversizedPath).size))
      .rejects.toThrow(/file.*limit/i);
  });
});
