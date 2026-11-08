import { chmod, lstat, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { extract as tarExtract, list as tarList, type ReadEntry } from "tar";

export const MAX_PLUGIN_ARCHIVE_BYTES = 64 * 1024 * 1024;
export const MAX_PLUGIN_EXTRACTED_BYTES = 128 * 1024 * 1024;
export const MAX_PLUGIN_ARCHIVE_FILES = 5_000;
export const MAX_PLUGIN_ARCHIVE_FILE_BYTES = 8 * 1024 * 1024;

const MAX_PLUGIN_ARCHIVE_DEPTH = 64;
const MAX_PLUGIN_DECOMPRESSION_RATIO = 1_000;
const LISTING_ENTRIES = Symbol("plugin-archive-listing-entries");
const REGULAR_FILE_TYPES = new Set<ReadEntry["type"]>(["File", "OldFile", "ContiguousFile"]);

export interface PluginArchiveListing {
  readonly rootName: string;
  readonly files: readonly string[];
  readonly totalBytes: number;
}

interface InternalPluginArchiveListing extends PluginArchiveListing {
  readonly [LISTING_ENTRIES]: ReadonlySet<string>;
}

function normalizedArchivePath(raw: string): string {
  if (raw === "" || raw.includes("\0") || raw.includes("\\")) {
    throw new Error("plugin archive path is invalid");
  }
  if (raw.startsWith("/") || /^[A-Za-z]:/u.test(raw)) {
    throw new Error(`plugin archive path is absolute or outside the package: ${raw}`);
  }
  const normalized = raw.replace(/^\.\/+/u, "").replace(/\/+$/u, "");
  if (normalized === "" || normalized === ".") return "";
  const segments = normalized.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error(`plugin archive path is outside the package: ${raw}`);
  }
  if (segments.length > MAX_PLUGIN_ARCHIVE_DEPTH) {
    throw new Error(`plugin archive path exceeds ${String(MAX_PLUGIN_ARCHIVE_DEPTH)} levels: ${raw}`);
  }
  return segments.join("/");
}

function entryKind(entry: ReadEntry): "file" | "directory" {
  if (REGULAR_FILE_TYPES.has(entry.type)) return "file";
  if (entry.type === "Directory") return "directory";
  if (entry.type === "Link" || entry.type === "SymbolicLink") {
    throw new Error(`plugin archive contains a link entry: ${entry.path}`);
  }
  throw new Error(`plugin archive contains unsupported entry type ${entry.type}: ${entry.path}`);
}

function asInternalListing(listing: PluginArchiveListing): InternalPluginArchiveListing {
  const entries = (listing as Partial<InternalPluginArchiveListing>)[LISTING_ENTRIES];
  if (!(entries instanceof Set)) throw new Error("plugin archive listing is invalid");
  return listing as InternalPluginArchiveListing;
}

export async function inspectPluginArchive(
  archivePath: string,
  archiveBytes: number,
): Promise<PluginArchiveListing> {
  if (!Number.isSafeInteger(archiveBytes) || archiveBytes <= 0) {
    throw new Error("plugin archive size is invalid");
  }
  if (archiveBytes > MAX_PLUGIN_ARCHIVE_BYTES) {
    throw new Error(`plugin archive exceeds ${String(MAX_PLUGIN_ARCHIVE_BYTES)} byte limit`);
  }

  const allowedEntries = new Set<string>();
  const foldedEntries = new Map<string, string>();
  const files: string[] = [];
  let rootName: string | null = null;
  let totalBytes = 0;
  let entryCount = 0;
  let validationError: Error | null = null;

  await tarList({
    file: archivePath,
    gzip: true,
    strict: true,
    maxDecompressionRatio: MAX_PLUGIN_DECOMPRESSION_RATIO,
    onReadEntry(entry) {
      if (validationError !== null) return;
      if (entry.meta || entry.ignore) return;
      try {
        const path = normalizedArchivePath(entry.path);
        if (path === "") return;
        entryCount += 1;
        if (entryCount > MAX_PLUGIN_ARCHIVE_FILES) {
          throw new Error(`plugin archive exceeds ${String(MAX_PLUGIN_ARCHIVE_FILES)} file limit`);
        }

        const kind = entryKind(entry);
        const firstSlash = path.indexOf("/");
        const entryRoot = firstSlash === -1 ? path : path.slice(0, firstSlash);
        if (rootName === null) {
          rootName = entryRoot;
        } else if (entryRoot !== rootName) {
          throw new Error(`plugin archive must have a single root directory: ${rootName} and ${entryRoot}`);
        }

        if (allowedEntries.has(path)) {
          throw new Error(`plugin archive contains duplicate path: ${path}`);
        }
        const folded = path.normalize("NFC").toLowerCase();
        const collision = foldedEntries.get(folded);
        if (collision !== undefined && collision !== path) {
          throw new Error(`plugin archive contains case-folded path collision: ${collision} and ${path}`);
        }
        allowedEntries.add(path);
        foldedEntries.set(folded, path);

        if (kind === "file") {
          if (entry.size > MAX_PLUGIN_ARCHIVE_FILE_BYTES) {
            throw new Error(
              `plugin archive file exceeds ${String(MAX_PLUGIN_ARCHIVE_FILE_BYTES)} byte limit: ${path}`,
            );
          }
          totalBytes += entry.size;
          if (totalBytes > MAX_PLUGIN_EXTRACTED_BYTES) {
            throw new Error(`plugin archive exceeds ${String(MAX_PLUGIN_EXTRACTED_BYTES)} extracted byte limit`);
          }
          files.push(firstSlash === -1 ? "" : path.slice(firstSlash + 1));
        }
      } catch (err) {
        validationError = err instanceof Error ? err : new Error(String(err));
      }
    },
  });

  if (validationError !== null) throw validationError;
  if (rootName === null) throw new Error("plugin archive is empty");
  const rootHasFiles = files.some((file) => file !== "");
  if (!rootHasFiles) throw new Error("plugin archive does not contain a package under its root");

  const listing: InternalPluginArchiveListing = {
    rootName,
    files: [...files].sort(),
    totalBytes,
    [LISTING_ENTRIES]: allowedEntries,
  };
  return listing;
}

async function secureExtractedTree(root: string): Promise<void> {
  const chmodPath = async (path: string, mode: number): Promise<void> => {
    await chmod(path, mode);
  };
  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(dir, entry.name);
      const stat = await lstat(path);
      if (stat.isSymbolicLink()) throw new Error(`plugin extraction produced a symbolic link: ${path}`);
      if (stat.isDirectory()) {
        await chmodPath(path, 0o700);
        await walk(path);
      } else if (stat.isFile()) {
        await chmodPath(path, 0o600);
      } else {
        throw new Error(`plugin extraction produced an unsupported file type: ${path}`);
      }
    }
  };
  await chmodPath(root, 0o700);
  await walk(root);
}

export async function extractPluginArchive(
  archivePath: string,
  destination: string,
  listing: PluginArchiveListing,
): Promise<void> {
  const internal = asInternalListing(listing);
  await mkdir(destination, { recursive: true, mode: 0o700 });
  const existing = await readdir(destination);
  if (existing.length !== 0) throw new Error("plugin extraction destination must be empty");

  await tarExtract({
    file: archivePath,
    cwd: destination,
    gzip: true,
    strict: true,
    preservePaths: false,
    strip: 1,
    jobs: 1,
    maxDepth: MAX_PLUGIN_ARCHIVE_DEPTH,
    maxDecompressionRatio: MAX_PLUGIN_DECOMPRESSION_RATIO,
    filter(path, entry) {
      const normalized = normalizedArchivePath(path);
      if (normalized === "") return false;
      if (!internal[LISTING_ENTRIES].has(normalized)) {
        throw new Error(`plugin archive changed between inspection and extraction: ${normalized}`);
      }
      entryKind(entry as ReadEntry);
      return true;
    },
  });
  await secureExtractedTree(destination);
}
