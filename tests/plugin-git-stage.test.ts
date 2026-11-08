import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stageGitPlugin, type GitRunner } from "../src/main/plugin-git-stage";

const dirs: string[] = [];
const COMMIT = "0123456789abcdef0123456789abcdef01234567";

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "cairn-git-stage-"));
  dirs.push(dir);
  return dir;
}

function publicLookup(): Promise<readonly string[]> {
  return Promise.resolve(["140.82.114.3"]);
}

function writePlugin(root: string): void {
  mkdirSync(join(root, ".claude-plugin"), { recursive: true });
  writeFileSync(
    join(root, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: "demo-plugin", version: "1.2.3" }),
  );
}

function fakeRunner(options: {
  gitmodules?: boolean;
  symlink?: boolean;
} = {}): GitRunner {
  return vi.fn(async (args) => {
    if (args.includes("clone")) {
      const destination = args.at(-1);
      if (destination === undefined) throw new Error("missing destination");
      mkdirSync(destination, { recursive: true });
      writePlugin(destination);
      mkdirSync(join(destination, ".git", "hooks"), { recursive: true });
      writeFileSync(join(destination, ".git", "config"), "[core]\n");
      if (options.gitmodules === true) writeFileSync(join(destination, ".gitmodules"), "unsafe");
      if (options.symlink === true) symlinkSync("/tmp", join(destination, "outside"));
      return "";
    }
    if (args.includes("rev-parse")) return COMMIT;
    throw new Error(`unexpected git args: ${args.join(" ")}`);
  });
}

describe("Git plugin staging", () => {
  it("clones one commit without hooks, submodules, prompts, or a shell", async () => {
    const destination = join(scratch(), "clone");
    const runGit = fakeRunner();

    const staged = await stageGitPlugin({
      repositoryUrl: "https://github.com/acme/demo",
      destination,
      runGit,
      lookup: publicLookup,
    });

    expect(staged.source).toEqual({
      kind: "git",
      repositoryUrl: "https://github.com/acme/demo",
      ref: "HEAD",
      commit: COMMIT,
    });
    expect(existsSync(join(destination, ".git"))).toBe(false);
    expect(existsSync(join(destination, ".claude-plugin", "plugin.json"))).toBe(true);
    const [args, options] = vi.mocked(runGit).mock.calls[0] ?? [];
    expect(args).toEqual(expect.arrayContaining([
      "-c", "protocol.file.allow=never",
      "-c", "protocol.ext.allow=never",
      "-c", "core.hooksPath=/dev/null",
      "-c", "core.symlinks=false",
      "-c", "credential.helper=",
      "clone", "--depth=1", "--single-branch", "--no-tags", "--recurse-submodules=no",
    ]));
    expect(args).not.toContain("shell");
    expect(options?.env.GIT_TERMINAL_PROMPT).toBe("0");
    expect(options?.env.GIT_CONFIG_NOSYSTEM).toBe("1");
    expect(options?.env.GIT_LFS_SKIP_SMUDGE).toBe("1");
  });

  it("rejects SSH, credentials, private hosts, and option-like refs", async () => {
    const destination = join(scratch(), "clone");
    await expect(stageGitPlugin({
      repositoryUrl: "git@github.com:acme/demo.git",
      destination,
      runGit: fakeRunner(),
      lookup: publicLookup,
    })).rejects.toThrow(/https/i);
    await expect(stageGitPlugin({
      repositoryUrl: "https://user:secret@github.com/acme/demo.git",
      destination,
      runGit: fakeRunner(),
      lookup: publicLookup,
    })).rejects.toThrow(/credentials/i);
    await expect(stageGitPlugin({
      repositoryUrl: "https://localhost/acme/demo.git",
      destination,
      runGit: fakeRunner(),
      lookup: publicLookup,
    })).rejects.toThrow(/public|公开/i);
    await expect(stageGitPlugin({
      repositoryUrl: "https://github.com/acme/demo.git",
      ref: "--upload-pack=evil",
      destination,
      runGit: fakeRunner(),
      lookup: publicLookup,
    })).rejects.toThrow(/ref/i);
  });

  it("rejects submodules and symbolic links before publication", async () => {
    const submoduleDestination = join(scratch(), "submodule");
    await expect(stageGitPlugin({
      repositoryUrl: "https://github.com/acme/demo.git",
      destination: submoduleDestination,
      runGit: fakeRunner({ gitmodules: true }),
      lookup: publicLookup,
    })).rejects.toThrow(/submodule|\.gitmodules/i);

    const symlinkDestination = join(scratch(), "symlink");
    await expect(stageGitPlugin({
      repositoryUrl: "https://github.com/acme/demo.git",
      destination: symlinkDestination,
      runGit: fakeRunner({ symlink: true }),
      lookup: publicLookup,
    })).rejects.toThrow(/symbolic link|软链/i);
  });

  it("rejects a hostname when any resolved address is not public", async () => {
    await expect(stageGitPlugin({
      repositoryUrl: "https://github.com/acme/demo.git",
      destination: join(scratch(), "clone"),
      runGit: fakeRunner(),
      lookup: async () => ["140.82.114.3", "127.0.0.1"],
    })).rejects.toThrow(/public|公开/i);
  });
});
