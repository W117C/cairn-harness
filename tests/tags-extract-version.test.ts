// tags 磁盘缓存的「抽取判据版本」判卷（待办 #44）。
//
// 动因（2026-09-23 实测，读数在 outputs/impact-precision-2026-09-23.md）：要修影响面的精度
// 就得改 `parse.ts` 的 PATTERNS，而 map 与 impact 两份 tags 缓存的命中判据只有 {mtime,size}
// ⇒ **没被改过的那 397/400 个文件仍会读回旧判据抽出的 tags**，新判据看起来「改了没反应」。
// 那个现象最坏的地方不在于慢，而在于它会把一次正确的修法骗人回滚掉。
//
// 本文件判三件事，缺一件都等于没修：
//  ① 版本号必须由 pattern 文本派生（手写常量 = 下一处漂移磁铁）；
//  ② **map 侧**读到版本不符的条目必须当 miss（含旧条目根本没有 `v` 字段这一格）；
//  ③ **impact 侧**同上——两份缓存各判各的，只在一面实现等于另一面静默失效。
import { describe, it, expect, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TAGS_EXTRACT_VERSION, TAGS_PATTERNS, tagsExtractVersion } from "../src/agent/map/parse.js";
import { createMapBuilder } from "../src/agent/map/build.js";
import { buildImpact } from "../src/agent/impact/index.js";

let ws = "";
let cacheDir = "";
beforeEach(async () => {
  ws = await mkdtemp(join(tmpdir(), "tagsver-ws-"));
  cacheDir = await mkdtemp(join(tmpdir(), "tagsver-cache-"));
  await mkdir(join(ws, "src"), { recursive: true });
  await writeFile(join(ws, "src", "a.ts"), "export function alpha(): number { return 1; }\n", "utf8");
});

/** 缓存文件名 = sha1(abs) + ".json"（与 build.ts/impact 侧同一键法，测试不猜路径）。 */
async function onlyCacheEntry(dir: string): Promise<{ file: string; abs: string }> {
  const files = await readdir(dir);
  expect(files.length, "缓存目录里应恰好一条").toBe(1);
  const file = files[0]!;
  // 键法本身也是判卷对象：改了键法而不改这里，下面这条会直接点名
  const abs = join(ws, "src", "a.ts");
  expect(file).toBe(createHash("sha1").update(abs).digest("hex") + ".json");
  return { file: join(dir, file), abs };
}

describe("① 版本号由 pattern 文本派生", () => {
  it("改一条 pattern ⇒ 版本必须变；同一组 pattern ⇒ 版本稳定", () => {
    const base = ["(a) @def", "(b) @ref"];
    expect(tagsExtractVersion(base)).toBe(tagsExtractVersion(["(a) @def", "(b) @ref"]));
    expect(tagsExtractVersion(base)).not.toBe(tagsExtractVersion(["(a) @def", "(b!) @ref"]));
    expect(tagsExtractVersion(base)).not.toBe(tagsExtractVersion(base.slice().reverse()));
  });
  it("导出的常量确实等于按现网 pattern 算出来的值（不是抄下的字面量）", () => {
    expect(TAGS_PATTERNS.length).toBeGreaterThan(10);
    expect(TAGS_EXTRACT_VERSION).toBe(tagsExtractVersion(TAGS_PATTERNS));
  });
});

describe("②③ 两份缓存各自都必须拒绝旧判据的条目", () => {
  // 成对判据（缺一边都测不出另一边的漏）：v 正确 ⇒ 命中(parsed=0)；v 过期 ⇒ 作废(parsed=1)
  it("map 侧：版本不符 ⇒ 该文件重解析（同一条缓存改回正确版本又能命中）", async () => {
    const b = createMapBuilder({ tagsCacheDir: cacheDir });
    expect((await b.build({ workspace: ws })).parsed).toBe(1);
    const again = await b.build({ workspace: ws, nowRound: 99, recomputeEvery: 10 });
    expect(again.parsed, "v 正确时该命中，否则下面那半条测的是别的事").toBe(0);

    const { file } = await onlyCacheEntry(cacheDir);
    const e = JSON.parse(await readFile(file, "utf8")) as { v: string };
    expect(e.v).toBe(TAGS_EXTRACT_VERSION); // 写盘确实带了版本
    e.v = "stale0000000";
    await writeFile(file, JSON.stringify(e), "utf8");
    const after = await b.build({ workspace: ws, nowRound: 199, recomputeEvery: 10 });
    expect(after.parsed, "抽取判据换过 ⇒ 旧 tags 必须作废，否则新判据对这些文件不生效").toBe(1);
  });

  it("map 侧：旧条目没有 v 字段 ⇒ 同样按 miss（升级路径不能假命中）", async () => {
    const b = createMapBuilder({ tagsCacheDir: cacheDir });
    await b.build({ workspace: ws });
    const { file } = await onlyCacheEntry(cacheDir);
    const e = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
    delete e.v; // 模拟本次改动之前落在盘上的条目
    await writeFile(file, JSON.stringify(e), "utf8");
    const after = await b.build({ workspace: ws, nowRound: 99, recomputeEvery: 10 });
    expect(after.parsed).toBe(1);
  });

  it("impact 侧：版本不符 ⇒ 重解析并计数（两份缓存不共用读取代码，各判一次）", async () => {
    const first = await buildImpact({ workspace: ws, cacheDir });
    expect(first.parsed).toBe(1);
    const hit = await buildImpact({ workspace: ws, cacheDir });
    expect(hit.fromTagsCache, "v 正确时该命中").toBe(1);

    const { file } = await onlyCacheEntry(cacheDir);
    const e = JSON.parse(await readFile(file, "utf8")) as { v: string };
    expect(e.v).toBe(TAGS_EXTRACT_VERSION);
    e.v = "stale0000000";
    await writeFile(file, JSON.stringify(e), "utf8");
    const after = await buildImpact({ workspace: ws, cacheDir });
    expect(after.parsed, "impact 这张图独立于 map 的缓存读取面，漏判就等于精度修法在此不生效").toBe(1);
    expect(after.fromTagsCache).toBe(0);
  });
});
