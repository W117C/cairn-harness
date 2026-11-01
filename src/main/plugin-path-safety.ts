import { lstat, mkdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

async function requireRealDirectory(path: string, label: string): Promise<void> {
  const info = await lstat(path).catch(() => null);
  if (info === null) throw new Error(`${label} does not exist`);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error(`${label} must be a real directory`);
  }
}

function relativeSegments(base: string, target: string): string[] {
  const rel = relative(base, target);
  if (rel === "") return [];
  if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) {
    throw new Error(`plugin path escapes its root: ${target}`);
  }
  return rel.split(sep).filter((part) => part !== "");
}

async function walkPluginPath(
  baseRoot: string,
  targetRoot: string,
  create: boolean,
): Promise<void> {
  await requireRealDirectory(baseRoot, "plugin data root");
  const base = resolve(baseRoot);
  const segments = relativeSegments(base, targetRoot);
  let cursor = base;
  for (const segment of segments) {
    cursor = join(cursor, segment);
    let info = await lstat(cursor).catch(() => null);
    if (info === null) {
      if (!create) return;
      await mkdir(cursor, { mode: 0o700 });
      info = await lstat(cursor);
    }
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error(`plugin path contains a symbolic link or non-directory: ${cursor}`);
    }
  }
  if (create || segments.length > 0) {
    const realBase = await realpath(baseRoot);
    const resolved = await realpath(cursor);
    const check = relative(realBase, resolved);
    if (isAbsolute(check) || check === ".." || check.startsWith(`..${sep}`)) {
      throw new Error(`plugin path resolves outside its root: ${targetRoot}`);
    }
  }
}

/** Create every missing plugin-root segment without following links. */
export async function preparePluginRoot(baseRoot: string, targetRoot: string): Promise<void> {
  const base = await lstat(baseRoot).catch(() => null);
  if (base === null) await mkdir(baseRoot, { recursive: true, mode: 0o700 });
  await walkPluginPath(baseRoot, targetRoot, true);
}

/** Validate existing plugin-root segments; missing suffixes are allowed. */
export async function assertPluginRoot(baseRoot: string, targetRoot: string): Promise<void> {
  const base = await lstat(baseRoot).catch(() => null);
  if (base === null) return;
  await walkPluginPath(baseRoot, targetRoot, false);
}
