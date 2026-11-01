import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  authorizeLocalPluginSource,
  isAuthorizedLocalPluginSource,
  pluginDirectorySha256,
  stageLocalPlugin,
} from "../src/main/plugin-local-stage";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "cairn-local-stage-"));
  dirs.push(dir);
  return dir;
}

function pluginFixture(): string {
  const root = scratch();
  mkdirSync(join(root, ".claude-plugin"), { recursive: true });
  writeFileSync(
    join(root, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: "demo-plugin", version: "1.2.3" }),
  );
  mkdirSync(join(root, "skills", "demo"), { recursive: true });
  writeFileSync(join(root, "skills", "demo", "SKILL.md"), "---\nname: demo\ndescription: Demo\n---\n");
  return root;
}

describe("local plugin staging", () => {
  it("copies an authorized directory without git metadata", async () => {
    const source = pluginFixture();
    mkdirSync(join(source, ".git"), { recursive: true });
    writeFileSync(join(source, ".git", "config"), "unsafe");
    authorizeLocalPluginSource(source);
    const destination = join(scratch(), "staged");

    const staged = await stageLocalPlugin({ sourcePath: source, destination });

    expect(staged.root).toBe(destination);
    expect(staged.source).toEqual({ kind: "local", sourcePath: realpathSync(source) });
    expect(existsSync(join(destination, ".claude-plugin", "plugin.json"))).toBe(true);
    expect(existsSync(join(destination, ".git"))).toBe(false);
    expect(staged.packageSha256).toBe(await pluginDirectorySha256(source));
    expect(staged.packageSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("requires a source path authorized by the native picker", async () => {
    const source = pluginFixture();
    expect(isAuthorizedLocalPluginSource(source)).toBe(false);
    await expect(stageLocalPlugin({ sourcePath: source, destination: join(scratch(), "staged") }))
      .rejects.toThrow(/picker|选择器|authorized|授权/i);
  });

  it("rejects every symbolic link", async () => {
    const source = pluginFixture();
    symlinkSync("/tmp", join(source, "outside"));
    authorizeLocalPluginSource(source);
    await expect(stageLocalPlugin({ sourcePath: source, destination: join(scratch(), "staged") }))
      .rejects.toThrow(/symbolic link|软链/i);
  });

  it("rejects an oversized file and a missing manifest", async () => {
    const oversized = pluginFixture();
    const large = join(oversized, "large.bin");
    writeFileSync(large, "");
    truncateSync(large, 8 * 1024 * 1024 + 1);
    authorizeLocalPluginSource(oversized);
    await expect(stageLocalPlugin({ sourcePath: oversized, destination: join(scratch(), "staged") }))
      .rejects.toThrow(/limit|上限|size|大小/i);

    const missing = scratch();
    writeFileSync(join(missing, "README.md"), "not a plugin");
    authorizeLocalPluginSource(missing);
    await expect(stageLocalPlugin({ sourcePath: missing, destination: join(scratch(), "staged") }))
      .rejects.toThrow(/manifest|plugin\.json/i);
  });

  it("rejects source and destination overlap before copying", async () => {
    const source = pluginFixture();
    authorizeLocalPluginSource(source);
    await expect(stageLocalPlugin({ sourcePath: source, destination: join(source, "nested") }))
      .rejects.toThrow(/overlap|重叠/i);
  });

  it("computes a deterministic digest independent of file timestamps", async () => {
    const source = pluginFixture();
    const destination = join(scratch(), "copy");
    authorizeLocalPluginSource(source);
    await stageLocalPlugin({ sourcePath: source, destination });
    const before = await pluginDirectorySha256(destination);
    writeFileSync(join(destination, "skills", "demo", "SKILL.md"), readFileSync(join(source, "skills", "demo", "SKILL.md")));
    expect(await pluginDirectorySha256(destination)).toBe(before);
  });
});
