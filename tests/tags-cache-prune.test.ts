import { mkdtemp, mkdir, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { pruneTagsCache } from "../src/agent/map/tags-cache.js";

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "tags-prune-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

const name = (key: string) => key.repeat(40) + ".json";

async function seed(key: string, accessed: number, modified: number, bytes = 4096): Promise<void> {
  const path = join(dir, name(key));
  await writeFile(path, Buffer.alloc(bytes, 0x61));
  await utimes(path, accessed, modified);
}

it("evicts the least recently used tag file when over the file limit", async () => {
  await seed("a", 120, 110);
  await seed("b", 130, 130);
  await seed("c", 140, 100);
  await writeFile(join(dir, "settings.json"), "{}");
  await mkdir(join(dir, name("d")));

  await pruneTagsCache(dir, { maxEntries: 2, maxBytes: 1024 * 1024 });

  expect((await readdir(dir)).sort()).toEqual([name("b"), name("c"), name("d"), "settings.json"]);
});

it("evicts an old tag file when the byte limit is exceeded below the file limit", async () => {
  await seed("a", 100, 100, 16 * 1024);
  await seed("b", 200, 200, 16 * 1024);

  await pruneTagsCache(dir, { maxEntries: 10, maxBytes: 24 * 1024 });

  expect(await readdir(dir)).toEqual([name("b")]);
});
