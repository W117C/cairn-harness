import { createHash } from "node:crypto";
import { lstat, opendir, realpath, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { writeFileAtomic } from "../../atomic-write.js";

type TagsCacheKind = "symbol-map-tags" | "impact-tags";
const limits = { maxEntries: 16_000, maxBytes: 128 * 1024 * 1024 };
const sweepIntervalMs = 24 * 60 * 60 * 1000;
const sweepDelayMs = 10_000;
const lastScheduled = new Map<string, number>();

export function tagsCacheDir(kind: TagsCacheKind, home = homedir()): string {
  return join(home, ".cairn-harness", kind);
}

export function tagsCacheFile(dir: string, abs: string): string {
  return join(dir, createHash("sha1").update(abs).digest("hex") + ".json");
}

/** Evict the oldest regenerable entries from an app-owned tags directory. */
export async function pruneTagsCache(dir: string, { maxEntries, maxBytes } = limits): Promise<void> {
  const files = [];
  let bytes = 0;
  for await (const entry of await opendir(dir)) {
    if (!entry.isFile() || !/^[a-f0-9]{40}\.json$/.test(entry.name)) continue;
    const path = join(dir, entry.name);
    const info = await lstat(path).catch(() => null);
    if (info === null || !info.isFile()) continue;
    const fileBytes = Math.max(info.size, (info.blocks ?? 0) * 512);
    files.push({ path, info, bytes: fileBytes, lastUsed: Math.max(info.atimeMs, info.mtimeMs) });
    bytes += fileBytes;
  }

  let entries = files.length;
  if (entries <= maxEntries && bytes <= maxBytes) return;
  files.sort((a, b) => a.lastUsed - b.lastUsed);
  for (const file of files) {
    if (entries <= maxEntries && bytes <= maxBytes) break;
    try {
      const current = await lstat(file.path);
      // A concurrent build may have reused, rewritten or replaced this entry during the scan.
      if (!current.isFile() || current.ino !== file.info.ino || current.ctimeMs !== file.info.ctimeMs ||
          current.atimeMs !== file.info.atimeMs) continue;
      await unlink(file.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") continue;
    }
    entries--;
    bytes -= file.bytes;
  }
}

/** Keep maintenance off the request path and restrict it to Cairn's default cache locations. */
export function scheduleTagsCachePrune(dir: string, kind: TagsCacheKind): void {
  const home = homedir();
  if (dir !== tagsCacheDir(kind, home)) return;
  const now = Date.now();
  const last = lastScheduled.get(dir);
  if (last !== undefined && now >= last && now - last < sweepIntervalMs) return;
  lastScheduled.set(dir, now);
  setTimeout(() => {
    void sweep(dir, kind, home).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") console.debug("[tags-cache] 缓存回收失败:", error.message);
    });
  }, sweepDelayMs).unref();
}

async function sweep(dir: string, kind: TagsCacheKind, home: string): Promise<void> {
  const actual = await realpath(dir);
  if (actual !== tagsCacheDir(kind, await realpath(home))) return;
  const marker = join(actual, ".last-sweep");
  const previous = await lstat(marker).catch(() => null);
  const age = previous === null ? Infinity : Date.now() - previous.mtimeMs;
  if (previous !== null && (!previous.isFile() || (age >= 0 && age < sweepIntervalMs))) return;
  await pruneTagsCache(actual);
  await writeFileAtomic(marker, "");
}
