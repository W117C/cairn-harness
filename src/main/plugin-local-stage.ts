import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstatSync, realpathSync } from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { StagedPluginSource } from "./plugin-source";

export const MAX_LOCAL_PLUGIN_FILES = 5_000;
export const MAX_LOCAL_PLUGIN_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_LOCAL_PLUGIN_TOTAL_BYTES = 128 * 1024 * 1024;

interface TreeFile {
  readonly absolute: string;
  readonly relative: string;
  readonly size: number;
}

const authorizedLocalSources = new Set<string>();

function within(base: string, target: string): boolean {
  const rel = relative(base, target);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function overlaps(left: string, right: string): boolean {
  return within(left, right) || within(right, left);
}

async function inspectTree(root: string): Promise<TreeFile[]> {
  const rootStat = await lstat(root).catch(() => null);
  if (rootStat === null) throw new Error("local plugin source does not exist");
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error("local plugin source must be a real directory");
  }
  const files: TreeFile[] = [];
  let totalBytes = 0;

  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.name === ".git") continue;
      const absolute = join(dir, entry.name);
      const rel = relative(root, absolute).replaceAll("\\", "/");
      const stat = await lstat(absolute);
      if (stat.isSymbolicLink()) {
        throw new Error(`local plugin source contains a symbolic link: ${rel}`);
      }
      if (stat.isDirectory()) {
        await walk(absolute);
        continue;
      }
      if (!stat.isFile()) {
        throw new Error(`local plugin source contains a special file: ${rel}`);
      }
      if (stat.size > MAX_LOCAL_PLUGIN_FILE_BYTES) {
        throw new Error(`local plugin file exceeds the 8 MiB size limit: ${rel}`);
      }
      if (files.length >= MAX_LOCAL_PLUGIN_FILES) {
        throw new Error("local plugin exceeds the 5000 file limit");
      }
      totalBytes += stat.size;
      if (totalBytes > MAX_LOCAL_PLUGIN_TOTAL_BYTES) {
        throw new Error("local plugin exceeds the 128 MiB total size limit");
      }
      files.push({ absolute, relative: rel, size: stat.size });
    }
  };

  await walk(root);
  return files;
}

async function requireManifest(root: string): Promise<void> {
  const manifest = join(root, ".claude-plugin", "plugin.json");
  const stat = await lstat(manifest).catch(() => null);
  if (stat === null || !stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("local plugin must contain a real .claude-plugin/plugin.json manifest");
  }
}

export async function pluginDirectorySha256(root: string): Promise<string> {
  const files = await inspectTree(root);
  const hash = createHash("sha256");
  for (const file of files) {
    const content = await readFile(file.absolute);
    hash.update(file.relative);
    hash.update("\0");
    hash.update(createHash("sha256").update(content).digest("hex"));
    hash.update("\n");
  }
  return hash.digest("hex");
}

export function authorizeLocalPluginSource(path: string): void {
  const canonical = canonicalAuthorizedDirectory(path);
  authorizedLocalSources.add(canonical);
}

export function isAuthorizedLocalPluginSource(path: string): boolean {
  try {
    return authorizedLocalSources.has(canonicalAuthorizedDirectory(path));
  } catch {
    return false;
  }
}

function canonicalAuthorizedDirectory(path: string): string {
  const info = lstatSync(path);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error("local plugin source must be a real directory");
  }
  return resolve(realpathSync(path));
}

export async function stageLocalPlugin(input: {
  readonly sourcePath: string;
  readonly destination: string;
}): Promise<StagedPluginSource> {
  if (!isAuthorizedLocalPluginSource(input.sourcePath)) {
    throw new Error("local plugin source was not authorized by the native picker");
  }
  const source = await realpath(input.sourcePath);
  const destination = resolve(input.destination);
  const destinationParent = await realpath(dirname(destination));
  const canonicalDestination = join(destinationParent, destination.slice(dirname(destination).length + 1));
  if (overlaps(source, canonicalDestination)) {
    throw new Error("local plugin source and staging destination overlap");
  }
  const files = await inspectTree(source);
  await requireManifest(source);
  await mkdir(destination, { recursive: false, mode: 0o700 });
  for (const file of files) {
    const target = join(destination, file.relative);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await copyFile(file.absolute, target, constants.COPYFILE_EXCL);
    await chmod(target, 0o600);
  }
  await requireManifest(destination);
  return {
    root: destination,
    source: { kind: "local", sourcePath: source },
    packageSha256: await pluginDirectorySha256(destination),
  };
}
