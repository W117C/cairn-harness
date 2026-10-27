import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, readdir, type FileHandle } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";

const FP_MAX_FILES = 5_000;
const FP_MAX_FILE_BYTES = 8 * 1024 * 1024;
const FP_MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024;

/** One content snapshot is both the trust witness and the loader input.
 * The loader never reopens a path after the fingerprint has been computed. */
export interface PluginSnapshot {
  fp: string;
  bounded: boolean;
  files: ReadonlyMap<string, Buffer>;
  /** Every path observed by the walk, including symlinks and files whose
   * bytes did not fit the retention budget. Callers use this to distinguish
   * "not present" from "present but unsafe/incomplete". */
  paths: ReadonlySet<string>;
}

async function readBoundedSnapshot(abs: string): Promise<Buffer | null> {
  let fh: FileHandle;
  try {
    // The file is opened once; fstat and the read use the same handle.
    fh = await open(abs, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  } catch {
    return null;
  }
  try {
    const before = await fh.stat();
    if (!before.isFile() || before.size > FP_MAX_FILE_BYTES) return null;
    const buffer = Buffer.allocUnsafe(before.size + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const read = await fh.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead);
      if (read.bytesRead === 0) break;
      bytesRead += read.bytesRead;
    }
    const after = await fh.stat();
    if (
      bytesRead !== before.size ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs
    ) {
      return null;
    }
    return buffer.subarray(0, bytesRead);
  } catch {
    return null;
  } finally {
    await fh.close().catch(() => undefined);
  }
}

function keyOf(root: string, abs: string): string | null {
  const rel = relative(root, abs).split(sep).join("/");
  if (isAbsolute(rel) || rel === ".." || rel.startsWith("../")) return null;
  return rel;
}

/** Read every regular file once and retain the bytes the loader will consume.
 * If a file is over a cap, unreadable, a symlink, or the aggregate snapshot
 * budget is exhausted, `bounded` is set and approval remains impossible.
 * Files that did not fit are deliberately absent: the loader treats their
 * absence as a load failure rather than reopening the live path. */
export async function pluginSnapshot(root: string): Promise<PluginSnapshot> {
  const parts: [string, string][] = [];
  const files = new Map<string, Buffer>();
  const paths = new Set<string>();
  let count = 0;
  let snapshotBytes = 0;
  let bounded = false;

  const record = (key: string, content: Buffer): void => {
    count++;
    parts.push([key, createHash("sha256").update(content).digest("hex")]);
    if (snapshotBytes + content.length > FP_MAX_SNAPSHOT_BYTES) {
      bounded = true;
      return;
    }
    snapshotBytes += content.length;
    files.set(key, content);
  };

  const walk = async (dir: string): Promise<void> => {
    if (count >= FP_MAX_FILES) {
      bounded = true;
      return;
    }
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      bounded = true;
      return;
    }
    for (const ent of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (count >= FP_MAX_FILES) {
        bounded = true;
        return;
      }
      const abs = join(dir, ent.name);
      const key = keyOf(root, abs);
      if (key === null) bounded = true;
      else paths.add(key);
      if (ent.isSymbolicLink()) {
        bounded = true;
        continue;
      }
      if (ent.isDirectory()) {
        if (ent.name === ".git") {
          await walkGitMeta(abs);
          continue;
        }
        await walk(abs);
        continue;
      }
      if (!ent.isFile()) continue;
      if (key === null) {
        bounded = true;
        continue;
      }
      const content = await readBoundedSnapshot(abs);
      if (content === null) {
        bounded = true;
        continue;
      }
      record(key, content);
    }
  };

  /** `.git` metadata is not included wholesale, but config and hooks can
   * redirect executable behavior, so those files stay in the binding. */
  const walkGitMeta = async (gitDir: string): Promise<void> => {
    const config = await readBoundedSnapshot(join(gitDir, "config"));
    if (config !== null) {
      const key = keyOf(root, join(gitDir, "config"));
      if (key !== null) record(key, config);
    }
    const hooksDir = join(gitDir, "hooks");
    let hooks;
    try {
      hooks = await readdir(hooksDir, { withFileTypes: true });
    } catch {
      return; // no hooks directory is normal
    }
    for (const ent of hooks.sort((a, b) => a.name.localeCompare(b.name))) {
      if (ent.isSymbolicLink()) {
        bounded = true;
        continue;
      }
      if (!ent.isFile()) continue;
      const abs = join(hooksDir, ent.name);
      const content = await readBoundedSnapshot(abs);
      if (content === null) {
        bounded = true;
        continue;
      }
      const key = keyOf(root, abs);
      if (key === null) {
        bounded = true;
        continue;
      }
      record(key, content);
    }
  };

  await walk(root);
  return {
    // Tuple encoding preserves filename boundaries, including literal newlines.
    fp: createHash("sha256").update(JSON.stringify(parts.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))).digest("hex").slice(0, 32),
    bounded,
    files,
    paths,
  };
}

export function snapshotFileKey(root: string, abs: string): string | null {
  return keyOf(root, abs);
}

export function snapshotReadBytes(
  root: string,
  abs: string,
  snapshot: PluginSnapshot,
): Buffer | null {
  const key = snapshotFileKey(root, abs);
  return key === null ? null : snapshot.files.get(key) ?? null;
}

export function snapshotReadText(
  root: string,
  abs: string,
  snapshot: PluginSnapshot,
): string | null {
  return snapshotReadBytes(root, abs, snapshot)?.toString("utf8") ?? null;
}

export function snapshotHasFile(
  root: string,
  abs: string,
  snapshot: PluginSnapshot,
): boolean {
  return snapshotReadBytes(root, abs, snapshot) !== null;
}

export function snapshotHasEntry(
  root: string,
  abs: string,
  snapshot: PluginSnapshot,
): boolean {
  const key = snapshotFileKey(root, abs);
  return key !== null && snapshot.paths.has(key);
}

export function snapshotIsDirectory(
  root: string,
  abs: string,
  snapshot: PluginSnapshot,
): boolean {
  const key = snapshotFileKey(root, abs);
  if (key === null) return false;
  const prefix = key === "" ? "" : key + "/";
  for (const file of snapshot.files.keys()) {
    if (file.startsWith(prefix)) return true;
  }
  return false;
}

export function snapshotListDirectory(
  root: string,
  abs: string,
  snapshot: PluginSnapshot,
): string[] {
  const key = snapshotFileKey(root, abs);
  if (key === null) return [];
  const prefix = key === "" ? "" : key + "/";
  const names = new Set<string>();
  for (const file of snapshot.files.keys()) {
    if (!file.startsWith(prefix)) continue;
    const rest = file.slice(prefix.length);
    const slash = rest.indexOf("/");
    names.add(slash < 0 ? rest : rest.slice(0, slash));
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}
