import { spawn } from "node:child_process";
import { lookup as dnsLookup } from "node:dns/promises";
import { lstat, mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parsePluginImportRequest, type StagedPluginSource } from "./plugin-source";
import {
  isPublicPluginAddress,
  type PluginAddressLookup,
} from "./plugin-package-download";
import { pluginDirectorySha256 } from "./plugin-local-stage";

const MAX_GIT_OUTPUT_BYTES = 1024 * 1024;

export interface GitRunnerOptions {
  readonly cwd?: string;
  readonly env: NodeJS.ProcessEnv;
  readonly signal?: AbortSignal;
}

export type GitRunner =
  (args: readonly string[], options: GitRunnerOptions) => Promise<string>;

export function hardenedGitEnvironment(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    GIT_LFS_SKIP_SMUDGE: "1",
    GCM_INTERACTIVE: "never",
  };
}

const systemLookup: PluginAddressLookup = async (hostname) => {
  const rows = await dnsLookup(hostname, { all: true, verbatim: true });
  return rows.map((row) => row.address);
};

export const hardenedGitRunner: GitRunner = async (args, options) => {
  return await new Promise<string>((resolveOutput, reject) => {
    const child = spawn("git", [...args], {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    const collect = (target: "stdout" | "stderr", chunk: Buffer): void => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_GIT_OUTPUT_BYTES) {
        child.kill();
        reject(new Error(`git output exceeds ${String(MAX_GIT_OUTPUT_BYTES)} bytes`));
        return;
      }
      if (target === "stdout") stdout += chunk.toString("utf8");
      else stderr += chunk.toString("utf8");
    };
    child.stdout.on("data", (chunk: Buffer) => { collect("stdout", chunk); });
    child.stderr.on("data", (chunk: Buffer) => { collect("stderr", chunk); });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) {
        resolveOutput(stdout.trim());
        return;
      }
      reject(new Error(
        `git ${args[0] ?? "command"} failed (${signal ?? String(code)}): ${stderr.trim() || "no stderr"}`,
      ));
    });
  });
};

async function publicRepositoryAddresses(
  url: URL,
  lookup: PluginAddressLookup,
): Promise<void> {
  const addresses = await lookup(url.hostname);
  if (addresses.length === 0) throw new Error("Git repository host has no public address");
  for (const address of addresses) {
    if (!isPublicPluginAddress(address)) {
      throw new Error(`Git repository host resolved to a non-public address: ${address}`);
    }
  }
}

function cloneArgs(repositoryUrl: string, ref: string | undefined, destination: string): string[] {
  return [
    "-c", "protocol.file.allow=never",
    "-c", "protocol.ext.allow=never",
    "-c", "core.hooksPath=/dev/null",
    "-c", "core.symlinks=false",
    "-c", "credential.helper=",
    "clone",
    "--depth=1",
    "--single-branch",
    "--no-tags",
    "--recurse-submodules=no",
    ...(ref === undefined ? [] : ["--branch", ref]),
    "--",
    repositoryUrl,
    destination,
  ];
}

async function requireManifest(root: string): Promise<void> {
  const manifest = await lstat(join(root, ".claude-plugin", "plugin.json")).catch(() => null);
  if (manifest === null || !manifest.isFile() || manifest.isSymbolicLink()) {
    throw new Error("Git plugin must contain a real .claude-plugin/plugin.json manifest");
  }
}

export async function stageGitPlugin(input: {
  readonly repositoryUrl: string;
  readonly ref?: string;
  readonly destination: string;
  readonly signal?: AbortSignal;
  readonly runGit?: GitRunner;
  readonly lookup?: PluginAddressLookup;
}): Promise<StagedPluginSource> {
  const request = parsePluginImportRequest({
    kind: "git",
    repositoryUrl: input.repositoryUrl,
    ...(input.ref === undefined ? {} : { ref: input.ref }),
  });
  if (request.kind !== "git") throw new Error("Git staging received a non-Git request");
  const repositoryUrl = new URL(request.repositoryUrl);
  await publicRepositoryAddresses(repositoryUrl, input.lookup ?? systemLookup);

  const destination = resolve(input.destination);
  const existing = await lstat(destination).catch(() => null);
  if (existing !== null) throw new Error(`Git staging destination already exists: ${destination}`);
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  const runGit = input.runGit ?? hardenedGitRunner;
  const env = hardenedGitEnvironment();
  let complete = false;
  try {
    await runGit(cloneArgs(request.repositoryUrl, request.ref, destination), {
      env,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    const commit = (await runGit(["rev-parse", "HEAD"], {
      cwd: destination,
      env,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    })).trim().toLowerCase();
    if (!/^[a-f0-9]{40}$/u.test(commit)) throw new Error("Git clone returned an invalid HEAD commit");
    if (await lstat(join(destination, ".gitmodules")).then(() => true, () => false)) {
      throw new Error("Git plugin contains .gitmodules; submodules are not supported");
    }
    const gitDir = await lstat(join(destination, ".git")).catch(() => null);
    if (gitDir?.isSymbolicLink()) throw new Error("Git metadata must not be a symbolic link");
    await rm(join(destination, ".git"), { recursive: true, force: true });
    await requireManifest(destination);
    const packageSha256 = await pluginDirectorySha256(destination);
    complete = true;
    return {
      root: destination,
      source: {
        kind: "git",
        repositoryUrl: request.repositoryUrl,
        ref: request.ref ?? "HEAD",
        commit,
      },
      packageSha256,
    };
  } finally {
    if (!complete) await rm(destination, { recursive: true, force: true }).catch(() => undefined);
  }
}
