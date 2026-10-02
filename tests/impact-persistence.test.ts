// 影响面索引持久化判卷（任务书任务 1）：buildImpact 落盘（schemaVersion＋sha＋defs/refs/edges）
// → 同 sha＋全量文件指纹命中直接载入（零解析）→ 任一文件变化走 tags 缓存增量 → 损坏自愈。
// 夹具：mini-repo 四文件拷进 tmp 并 git init（冻结原件不动），sha 与指纹全部真实——
// 不 mock buildImpact、不 mock git，载入路径坏了测试必须红。
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  buildImpact,
  type ImpactGraph,
  type ImpactSite,
} from "../src/agent/impact/index.js";
import {
  IMPACT_INDEX_SCHEMA_VERSION,
  impactIndexDirFor,
} from "../src/agent/impact/persist.js";

const execFileP = promisify(execFile);
const MINI_REPO = fileURLToPath(new URL("../fixtures/impact/mini-repo", import.meta.url));
const MINI_FILES = ["app.js", "math.js", "metrics.ts", "utils.js"] as const;

/** tmp git 仓：mini-repo 四文件副本＋真 git init/commit（sha 是真的，索引键才站得住）。 */
async function freshGitRepo(): Promise<{ ws: string; cacheDir: string; indexDir: string; sha: string }> {
  const ws = await mkdtemp(join(tmpdir(), "impact-persist-ws-"));
  for (const rel of MINI_FILES) {
    await writeFile(join(ws, rel), await readFile(join(MINI_REPO, rel)), "utf8");
  }
  await execFileP("git", ["init"], { cwd: ws });
  await execFileP("git", ["config", "user.email", "judge@example.invalid"], { cwd: ws });
  await execFileP("git", ["config", "user.name", "judge"], { cwd: ws });
  await execFileP("git", ["add", "."], { cwd: ws });
  await execFileP("git", ["commit", "-m", "init", "--no-gpg-sign"], { cwd: ws });
  const sha = (await execFileP("git", ["rev-parse", "HEAD"], { cwd: ws })).stdout.trim();
  const cacheDir = await mkdtemp(join(tmpdir(), "impact-persist-cache-"));
  const indexDir = await mkdtemp(join(tmpdir(), "impact-persist-index-"));
  return { ws, cacheDir, indexDir, sha };
}

function build(ws: string, cacheDir: string, indexDir: string, persistIndex: boolean): Promise<ImpactGraph> {
  return buildImpact({ workspace: ws, cacheDir, indexDir, persistIndex });
}

/** 图的确定性 canonical 形（Map 展开按 symbol 排序；sites 数组建图端已 siteOrder 序）。 */
function canonical(g: ImpactGraph): unknown {
  return {
    files: g.files,
    candidates: g.candidates,
    cap: g.cap,
    edges: g.edges,
    defs: [...g.defs.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    refs: [...g.refs.entries()].sort((a, b) => a[0].localeCompare(b[0])),
  };
}

/** 载入图与重建图逐字等价的最强读端证据：对 defs∪refs 全部符号比 upward。 */
function allSymbols(g: ImpactGraph): string[] {
  return [...new Set([...g.defs.keys(), ...g.refs.keys()])].sort();
}

async function indexArtifact(indexDir: string, sha: string, ws: string): Promise<string | null> {
  const names = (await readdir(indexDir)).filter((f) => f.endsWith(".json"));
  if (names.length === 0) return null;
  expect(names.length).toBe(1); // 同 sha＋同 workspace 只有一份 artifact（覆写不堆积）
  expect(names[0]!.startsWith(sha.slice(0, 16))).toBe(true); // 键里带 commit sha
  return readFile(join(indexDir, names[0]!), "utf8");
}

describe("影响面·索引持久化", () => {
  it("① round-trip：build→落盘→载入，canonical 与全部符号 upward 逐字一致", async () => {
    const { ws, cacheDir, indexDir } = await freshGitRepo();
    const g1 = await build(ws, cacheDir, indexDir, true);
    expect(g1.fromIndex).toBeUndefined(); // 第一次是真建图
    expect((await readdir(indexDir)).filter((f) => f.endsWith(".json")).length).toBe(1);
    const g2 = await build(ws, cacheDir, indexDir, true);
    expect(canonical(g2)).toEqual(canonical(g1));
    for (const sym of allSymbols(g1)) {
      const up = (g: ImpactGraph): ImpactSite[] =>
        [...(g.refs.get(sym) ?? [])].filter((r) => !(g.defs.get(sym) ?? []).some((d) => d.file === r.file))
          .sort((a, b) => a.symbol.localeCompare(b.symbol) || (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)));
      expect(up(g2)).toEqual(up(g1));
    }
  });

  it("② 命中即零解析：parsed=0、fromTagsCache=0、fromIndex=true", async () => {
    const { ws, cacheDir, indexDir } = await freshGitRepo();
    const g1 = await build(ws, cacheDir, indexDir, true);
    expect(g1.parsed).toBe(4);
    const g2 = await build(ws, cacheDir, indexDir, true);
    expect(g2.fromIndex).toBe(true);
    expect(g2.parsed).toBe(0);
    expect(g2.fromTagsCache).toBe(0);
  });

  it("③ 增量：改 1 文件后重建——只重解析该文件（parsed=1），未变 3 个全走 tags 缓存（fromTagsCache=3），索引同步覆写", async () => {
    const { ws, cacheDir, indexDir } = await freshGitRepo();
    const g1 = await build(ws, cacheDir, indexDir, true);
    expect(g1.parsed).toBe(4);
    const mathSrc = await readFile(join(ws, "math.js"), "utf8");
    await writeFile(join(ws, "math.js"), mathSrc + "\nexport const extra = mul(2, 3);\n", "utf8");
    const g2 = await build(ws, cacheDir, indexDir, true);
    expect(g2.fromIndex).toBeUndefined(); // 指纹变了 ⇒ 不许吃旧图
    expect(g2.parsed).toBe(1); // 只有 math.js 被重解析
    expect(g2.fromTagsCache).toBe(3); // 未变文件的解析计数不变：3 个全命中
    expect(g2.edges.some((e) => e.symbol === "mul" && e.from === "math.js" && e.to === "utils.js")).toBe(true);
    const g3 = await build(ws, cacheDir, indexDir, true); // 无变化 ⇒ 热载新图（含新边）
    expect(g3.fromIndex).toBe(true);
    expect(g3.edges.some((e) => e.symbol === "mul" && e.from === "math.js" && e.to === "utils.js")).toBe(true);
  });

  it("④ 截断 JSON 损坏 ⇒ 自动重建且不抛，artifact 重新完整落盘", async () => {
    const { ws, cacheDir, indexDir, sha } = await freshGitRepo();
    const g1 = await build(ws, cacheDir, indexDir, true);
    const raw = await indexArtifact(indexDir, sha, ws);
    if (raw === null) throw new Error("artifact 未落盘");
    const artifactName = (await readdir(indexDir)).find((f) => f.endsWith(".json"))!;
    await writeFile(join(indexDir, artifactName), raw.slice(0, Math.floor(raw.length / 2)), "utf8");
    const g2 = await build(ws, cacheDir, indexDir, true); // 读到半截 JSON ⇒ 必须自愈
    expect(g2.fromIndex).toBeUndefined();
    // 自愈走既有增量层：文件级 tags 缓存没坏 ⇒ 通常全命中；断言每个文件要么解析要么命中
    expect(g2.parsed + g2.fromTagsCache).toBe(4);
    expect(canonical(g2)).toEqual(canonical(g1));
    const healed = await readFile(join(indexDir, artifactName), "utf8");
    expect(() => JSON.parse(healed)).not.toThrow(); // 已被完整覆写
  });

  it("⑤ schemaVersion 对不上 ⇒ 按 miss 重建并覆写回当前版本", async () => {
    const { ws, cacheDir, indexDir, sha } = await freshGitRepo();
    const g1 = await build(ws, cacheDir, indexDir, true);
    const artifactName = (await readdir(indexDir)).find((f) => f.endsWith(".json"))!;
    const stale = JSON.parse(await readFile(join(indexDir, artifactName), "utf8")) as Record<string, unknown>;
    stale.schemaVersion = IMPACT_INDEX_SCHEMA_VERSION + 999;
    stale.edges = [];
    await writeFile(join(indexDir, artifactName), JSON.stringify(stale), "utf8");
    const g2 = await build(ws, cacheDir, indexDir, true);
    expect(g2.fromIndex).toBeUndefined();
    expect(canonical(g2)).toEqual(canonical(g1)); // 重建出来还是同一张图
    const rewritten = JSON.parse(await readFile(join(indexDir, artifactName), "utf8")) as Record<string, unknown>;
    expect(rewritten.schemaVersion).toBe(IMPACT_INDEX_SCHEMA_VERSION);
    expect(rewritten.commitSha).toBe(sha);
  });

  it("⑥ 同 sha 下删 1 文件 ⇒ 不吃旧图：files 收缩、artifact 覆写", async () => {
    const { ws, cacheDir, indexDir } = await freshGitRepo();
    await build(ws, cacheDir, indexDir, true);
    const { unlink } = await import("node:fs/promises");
    await unlink(join(ws, "metrics.ts"));
    const g2 = await build(ws, cacheDir, indexDir, true);
    expect(g2.fromIndex).toBeUndefined();
    expect(g2.files).toEqual(["app.js", "math.js", "utils.js"]);
    // compute 在 metrics.ts 的引用点随文件删除消失；app.js 的还在
    const computeRefs = g2.refs.get("compute") ?? [];
    expect(computeRefs.some((r) => r.file === "metrics.ts")).toBe(false);
    expect(computeRefs.some((r) => r.file === "app.js")).toBe(true);
    expect(g2.edges.every((e) => e.from !== "metrics.ts" && e.to !== "metrics.ts")).toBe(true);
  });

  it("⑦ persistIndex 缺省 false ⇒ 一字节都不落盘（反作弊对照）", async () => {
    const { ws, cacheDir, indexDir } = await freshGitRepo();
    await buildImpact({ workspace: ws, cacheDir, indexDir });
    expect((await readdir(indexDir)).length).toBe(0);
  });

  it("⑧ 非 git 仓（sha 取不到）⇒ 索引整层不参与，建图照常", async () => {
    const ws = await mkdtemp(join(tmpdir(), "impact-persist-nogit-"));
    for (const rel of MINI_FILES) {
      await writeFile(join(ws, rel), await readFile(join(MINI_REPO, rel)), "utf8");
    }
    const cacheDir = await mkdtemp(join(tmpdir(), "impact-persist-cache-"));
    const indexDir = await mkdtemp(join(tmpdir(), "impact-persist-index-"));
    const g = await build(ws, cacheDir, indexDir, true);
    expect(g.files.sort()).toEqual([...MINI_FILES].sort());
    expect((await readdir(indexDir)).length).toBe(0); // 没有稳定键就不写索引
  });

  // 标题**一个字节都没改**：`tests/head-cert-deps.test.ts` 那条同分母尺是按留档语料里的标题回源码取预算的
  // （`budgetFromTestSource` 用 `JSON.stringify(title)` 逐字找），改标题 ⇒ 那一条查不到 ⇒ 全量判卷当场红一条。
  // 而语料留档按规矩不许改（它是当天的证据），改名要同轮换一份语料——那是隔壁那把尺的取料面。
  // 版本号真正钉在 `IMPACT_INDEX_SCHEMA_VERSION`（下面那条断言比的是常量，不是第二个字面量），
  // 为什么从 1 升到 2 由 `tests/impact-attribution.test.ts` 那条"1→2"守着。
  it("⑨ artifact 字段齐全：schemaVersion=1、commitSha=真 sha、files/defs/refs/edges/fingerprints 与图对得上", async () => {
    const { ws, cacheDir, indexDir, sha } = await freshGitRepo();
    const g = await build(ws, cacheDir, indexDir, true);
    const raw = await indexArtifact(indexDir, sha, ws);
    if (raw === null) throw new Error("artifact 未落盘");
    const a = JSON.parse(raw) as {
      schemaVersion: number; commitSha: string; files: string[]; candidates: number; cap: number;
      fingerprints: { rel: string; mtimeMs: number; size: number }[];
      defs: unknown[]; refs: unknown[]; edges: unknown[];
      nameSources: { file: string; bindings: unknown[] }[];
      attribution: { kept: number; dropped: number; noEvidence: number };
    };
    // 版本号比**常量**而不是比第二个字面量：`impact-attribution.test.ts` 那条钉着"现在是 2、为什么从 1 升上来"，
    // 这里再抄一遍就成了「两处各写一个数字」（每次 bump 都要来改两处，改错了还看不出来）。
    expect(a.schemaVersion).toBe(IMPACT_INDEX_SCHEMA_VERSION);
    expect(a.commitSha).toBe(sha);
    expect(a.files).toEqual(g.files);
    expect(a.candidates).toBe(g.candidates);
    expect(a.cap).toBe(g.cap);
    expect(a.defs.length).toBe(g.defs.size);
    expect(a.refs.length).toBe(g.refs.size);
    expect(a.edges).toEqual(g.edges);
    expect(a.nameSources.length, "归属取料面必须随 artifact 落盘（丢了它，热载入那张图整层判据失效）").toBe(g.nameSources.size);
    expect(a.attribution).toEqual(g.attribution);
    expect(a.fingerprints.map((f) => f.rel)).toEqual([...MINI_FILES].sort());
  });

  it("⑩ impactIndexDirFor：cacheDir 的兄弟目录（生产 = ~/.m0-agent-loop/impact-index，与拍板同区）", () => {
    expect(impactIndexDirFor("/home/u/.m0-agent-loop/impact-tags")).toBe("/home/u/.m0-agent-loop/impact-index");
    expect(impactIndexDirFor("/tmp/cache-x")).toBe("/tmp/impact-index");
  });
});
