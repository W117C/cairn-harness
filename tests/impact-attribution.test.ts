// 能力 1（任务 #9）：波及面的**归属判据**（反证型：同名但另有出处 ⇒ 不记给别处的同名定义）。
//
// 立案动因（10-02 现读，`outputs/impact-edge-provenance-2026-10-02/provenance.log`）：
// `impact` 按「同名即引用」连边 ⇒ 定义在某个测试文件里的局部 `writeFile` 吸走 140 个文件的调用点
// （那 140 处用的是 `node:fs/promises` 的同名函数），`src/agent/ledger.ts` 的 `readFile` 同理 114 处。
// 四种候选切法里只有这一种买得起：按 import 才连边（B/C）会把**冻结夹具**
// `fixtures/impact/accuracy-repo` 的 16 条真值边删到剩 1 条——那面登记着「不采 import」的设计边界。
// 反证型规则（E）夹具 16/16 一条不掉，真仓只摘 6.6% 却正好砍在两个大户上。
//
// 判卷形状（本仓规矩）：
// · 「一条不许掉」是**前提**不是副作用 ⇒ 直接对那个夹具数边集与 `attribution.dropped`；
// · 三态分开钉：kept／dropped／no-evidence 各有一条只有它能红起来的用例（把「没证据」读成「没关系」
//   是这一族反复判死的那件事）；
// · 缓存与持久化两层都验「两出口同进同出」——只硬化一层＝另一层的图会整层失效（本仓第十族）；
// · 接线判卷一条一格（五枚针脚挤一条，五个变异会红在同一条上）。
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  attributionNote, attributeRefToDef, bindingSourceKey, emptyAttributionStats,
} from "../src/agent/impact/attribution.js";
import { buildImpact, closureFilesOf, contextNoteFor, downward, ImpactUnavailableError, upward, type ImpactGraph } from "../src/agent/impact/index.js";
import { loadImpactIndex, saveImpactIndex, IMPACT_INDEX_SCHEMA_VERSION } from "../src/agent/impact/persist.js";
import { __resetLangCache, __resetQueryCache } from "../src/agent/map/parse.js";
import { TAGS_EXTRACT_VERSION } from "../src/agent/map/parse.js";
import type { ScannedFile } from "../src/agent/map/build.js";

const TMP: string[] = [];
const REPO = resolve(import.meta.dirname, "..");

afterAll(async () => {
  for (const d of TMP) await rm(d, { recursive: true, force: true }).catch(() => {});
  __resetLangCache();
  __resetQueryCache();
});

async function wsWith(files: Record<string, string>): Promise<string> {
  const ws = await mkdtemp(join(tmpdir(), "dsh-attrib-"));
  TMP.push(ws);
  for (const [rel, src] of Object.entries(files)) {
    const abs = join(ws, rel);
    await mkdtempParent(abs);
    await writeFile(abs, src, "utf8");
  }
  return ws;
}
async function mkdtempParent(abs: string): Promise<void> {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(abs.slice(0, abs.lastIndexOf("/")), { recursive: true });
}

/** 那一组四个文件：一个真 import、一个绑到外部包、一个绑到第三方文件、一个压根不 import（全局脚本形状）。 */
const FOUR_FILE_REPO = {
  "src/ledger.ts": "export function readFile(p: string): string { return p; }\n",
  "src/consumer.ts": 'import { readFile } from "./ledger.js";\nexport const a = readFile("x");\n',
  "src/nodeuser.ts": 'import { readFile } from "node:fs/promises";\nexport const b = readFile("y");\n',
  "src/otherdef.ts": 'import { readFile } from "./third.js";\nexport const c = readFile("z");\n',
  "src/third.ts": "export function readFile(p: string): string { return p; }\n",
  "src/legacy.js": "export const d = readFile(\"w\");\n",
};

// ---- 纯判据 ----

describe("attributeRefToDef（三态，没证据≠没关系）", () => {
  it("四种输入各给一个答案：无 import 面／没有绑定证据／正证在此／反证在别处", () => {
    expect(attributeRefToDef({ known: false, sources: ["other.ts"] }, "d.ts")).toBe("no-evidence");
    expect(attributeRefToDef({ known: true, sources: [] }, "d.ts")).toBe("kept");
    expect(attributeRefToDef({ known: true, sources: ["d.ts"] }, "d.ts")).toBe("kept");
    expect(attributeRefToDef({ known: true, sources: ["x.ts"] }, "d.ts")).toBe("dropped");
  });

  it("「无证据」优先于任何 sources：不能因为带了名字表就把没判的文件算成排除", () => {
    expect(attributeRefToDef({ known: false, sources: [] }, "d.ts")).toBe("no-evidence");
    expect(attributeRefToDef({ known: false, sources: [] }, "d.ts"), "no-evidence 与 kept 是两个不同的数").not.toBe("kept");
  });

  it("多来源里有 defFile 就留（一个名字从两份文件绑进来的形状不许整条判死）", () => {
    expect(attributeRefToDef({ known: true, sources: ["a.ts", "d.ts"] }, "d.ts")).toBe("kept");
  });

  it("外部包与仓内文件分得开：键由 bindingSourceKey 一处构造", () => {
    expect(bindingSourceKey("src/ledger.ts", "./ledger.js")).toBe("src/ledger.ts");
    expect(bindingSourceKey(null, "node:fs/promises")).toBe("external:node:fs/promises");
    // 仓内可以有一个叫 `external:...` 的怪路径吗？能——但那要真存在文件，前缀让两种证据不会撞键
    expect(bindingSourceKey(null, "x")).not.toBe(bindingSourceKey("x", "x"));
  });
});

describe("attributionNote（三态各自出声，全 0 就一个字都不加）", () => {
  it("全 0 ⇒ 空串（不许印「排除 0 处」这种噪声）", () => {
    expect(attributionNote(emptyAttributionStats())).toBe("");
  });

  it("两格分别出声：dropped 说「另有出处」，noEvidence 说「保守计入」，各不带对方那句话", () => {
    const d = attributionNote({ kept: 5, dropped: 12, noEvidence: 0 });
    const e = attributionNote({ kept: 5, dropped: 0, noEvidence: 3 });
    expect(d).toContain("12 处已按「同名但另有出处」排除");
    expect(d).not.toContain("保守计入");
    expect(e).toContain("3 处所在文件没有 import 面可判，按名字图保守计入");
    expect(e).not.toContain("另有出处");
    const both = attributionNote({ kept: 1, dropped: 12, noEvidence: 3 });
    expect(both).toContain("12");
    expect(both).toContain("3");
  });
});

// ---- 图上行为 ----

async function buildFour(): Promise<ImpactGraph> {
  const ws = await wsWith(FOUR_FILE_REPO);
  const cache = await mkdtemp(join(tmpdir(), "dsh-attrib-cache-"));
  TMP.push(cache);
  return buildImpact({ workspace: ws, cacheDir: cache, maxFiles: 50 });
}

describe("边构造与查询：反证成立才摘，其余照名字图连", () => {
  it("四个引用方各归各位：真 import 的留、外部包与第三方绑定的摘、不 import 的留", async () => {
    const g = await buildFour();
    const ups = upward(g, "readFile").map((s) => s.file);
    expect(ups, "正向：ledger.ts 的 import 方必须在清单里").toContain("src/consumer.ts");
    expect(ups, "全局脚本形状（没有任何 import 绑这个名字）按合同照旧连").toContain("src/legacy.js");
    expect(ups, "反证：那处用的是 node:fs/promises 的同名函数 ⇒ 两处定义都归不上").not.toContain("src/nodeuser.ts");
    expect(ups, "third.ts 确实 import 了这份同名函数 ⇒ 这一处留着，只是不再记给 ledger.ts").toContain("src/otherdef.ts");
    expect(g.attribution.dropped, "摘掉的格数要出声（nodeuser 对两份定义各一次）").toBeGreaterThan(0);
    expect(g.edges.some((e) => e.from === "src/otherdef.ts" && e.to === "src/ledger.ts"), "按 def 逐条判：这一对必须不在边里").toBe(false);
    expect(g.edges.some((e) => e.from === "src/otherdef.ts" && e.to === "src/third.ts"), "而它对 third.ts 那份仍是一条边").toBe(true);
  });

  it("同名的另一份定义仍在图里（third.ts 的 readFile 不因这一格消失）", async () => {
    const g = await buildFour();
    expect((g.defs.get("readFile") ?? []).map((d) => d.file).sort())
      .toEqual(["src/ledger.ts", "src/third.ts"]);
  });

  it("downward 按 def 逐条判：otherdef.ts 看不到 ledger.ts 那份，consumer.ts 看得到", async () => {
    const g = await buildFour();
    expect(downward(g, "src/consumer.ts").some((d) => d.file === "src/ledger.ts")).toBe(true);
    expect(downward(g, "src/otherdef.ts").some((d) => d.file === "src/ledger.ts"), "它 import 的是 third.ts 那份").toBe(false);
    expect(downward(g, "src/otherdef.ts").some((d) => d.file === "src/third.ts")).toBe(true);
  });

  it("无证据那一支：手工把 nameSources 抹掉 ⇒ 清单回到按名字图（一条不摘，且计数进 noEvidence）", async () => {
    const g = await buildFour();
    const withEvidence = upward(g, "readFile").map((s) => s.file);
    const bare: ImpactGraph = { ...g, nameSources: new Map() };
    const withoutEvidence = upward(bare, "readFile").map((s) => s.file);
    expect(withoutEvidence.length, "没证据 ⇒ 那两处的调用点照旧回来").toBeGreaterThan(withEvidence.length);
    for (const f of withEvidence) expect(withoutEvidence).toContain(f);
  });

  it("冻结夹具一条不许掉：边集 == 真值 16 条、dropped=0（这一档买得起的前提，不是副作用）", async () => {
    const truth = JSON.parse(readFileSync(join(REPO, "fixtures/impact/accuracy-repo/ground-truth.json"), "utf8")) as {
      edgeCount: number; edges: { from: string; to: string; symbol: string }[];
    };
    const cache = await mkdtemp(join(tmpdir(), "dsh-attrib-fx-"));
    TMP.push(cache);
    const g = await buildImpact({ workspace: join(REPO, "fixtures/impact/accuracy-repo"), cacheDir: cache, maxFiles: 50 });
    const got = g.edges.map((e) => `${e.from}>${e.to}:${e.symbol}`).sort();
    const want = truth.edges.map((e) => `${e.from}>${e.to}:${e.symbol}`).sort();
    expect(truth.edgeCount, "夹具自己登记的边数").toBe(16);
    expect(got, "归属判据把夹具的真值边摘掉了 ⇒ 这一档就不该买").toEqual(want);
    expect(g.attribution.dropped, "夹具是全局脚本形状：一处反证都不该成立").toBe(0);
    expect(g.attribution.noEvidence, "夹具里 index.ts 有 import 面 ⇒ 不该整层无证据").toBeLessThan(g.attribution.kept + g.attribution.dropped + g.attribution.noEvidence);
  });
});

// ---- 两层缓存：两出口同进同出 ----

describe("tags 缓存与持久化索引都不许只带一个出口", () => {
  it("tags 条目同时带 tags 与 imports；把 imports 抠掉的老条目按 miss 重解析", async () => {
    const ws = await wsWith(FOUR_FILE_REPO);
    const dir = join(ws, "tags");
    const first = await buildImpact({ workspace: ws, cacheDir: dir, maxFiles: 50 });
    expect(first.parsed, "第一次都是现解析").toBeGreaterThan(0);
    const names = (await readdir(dir)).filter((n) => n.endsWith(".json"));
    expect(names.length, "缓存目录写了条目").toBeGreaterThan(0);
    const probe = names[0]!;
    const raw = JSON.parse(await readFile(join(dir, probe), "utf8")) as Record<string, unknown>;
    expect(Array.isArray(raw.imports), "落盘条目必须带 imports（不然归属判据没有取料面）").toBe(true);
    expect(raw.v, "版本源与地图同一把").toBe(TAGS_EXTRACT_VERSION);
    for (const n of names) {
      const e = JSON.parse(await readFile(join(dir, n), "utf8")) as Record<string, unknown>;
      delete e.imports;
      e.v = TAGS_EXTRACT_VERSION; // 版本号照抄：不许靠 v 失配蒙过去
      await writeFile(join(dir, n), JSON.stringify(e), "utf8");
    }
    const second = await buildImpact({ workspace: ws, cacheDir: dir, maxFiles: 50 });
    expect(second.fromTagsCache, "被抠掉 imports 的条目必须全算 miss").toBe(0);
    expect(second.attribution.dropped, "重解析之后反证仍然成立（不是靠老条目把判据饿死）").toBe(first.attribution.dropped);
  });

  it("索引 artifact 带上 nameSources 与 attribution；缺任何一格或版本不对都按 miss", async () => {
    const ws = await wsWith(FOUR_FILE_REPO);
    const cache = await mkdtemp(join(tmpdir(), "dsh-attrib-idx-"));
    const indexDir = join(cache, "impact-index");
    TMP.push(cache);
    const files: ScannedFile[] = [];
    const g = await buildImpact({ workspace: ws, cacheDir: cache, indexDir, maxFiles: 50 });
    for (const rel of g.files) {
      const st = await import("node:fs/promises").then((m) => m.stat(join(ws, rel)));
      files.push({ rel, abs: join(ws, rel), mtimeMs: st.mtimeMs, size: st.size });
    }
    const sha = "0".repeat(40);
    await saveImpactIndex(indexDir, ws, sha, g, files);
    const back = await loadImpactIndex(indexDir, ws, sha, files);
    expect(back, "自己存的索引要能载回来").not.toBeNull();
    expect(back!.nameSources.size, "归属取料面必须原样回来（丢了它整层判据静默失效）").toBe(g.nameSources.size);
    expect(back!.attribution).toEqual(g.attribution);
    const artifactNames = (await readdir(indexDir)).filter((n) => n.endsWith(".json"));
    expect(artifactNames.length, "落盘一份 artifact").toBe(1);
    const artifactPath = join(indexDir, artifactNames[0]!);
    const raw = JSON.parse(await readFile(artifactPath, "utf8")) as Record<string, unknown>;
    expect(raw.schemaVersion).toBe(IMPACT_INDEX_SCHEMA_VERSION);
    // 钉的是「这一版动过号」而不是"等于几"：写死 2 就成了第二份号，将来升 3 时这条无谓地红。
    expect(IMPACT_INDEX_SCHEMA_VERSION, "1→2：新字段必须整层作废老 artifact").toBeGreaterThan(1);
    // 反向：把两个新字段抠掉、版本号照抄 ⇒ 必须 miss（不许载出一张"处处无证据"的图）
    delete raw.nameSources;
    delete raw.attribution;
    await writeFile(artifactPath, JSON.stringify(raw), "utf8");
    expect(await loadImpactIndex(indexDir, ws, sha, files), "缺取料面的 artifact 必须按 miss").toBeNull();
  });

  it("版本号不符的 artifact 即使字段齐全也按 miss（只加字段不认号＝老图整层复活）", async () => {
    const ws = await wsWith(FOUR_FILE_REPO);
    const cache = await mkdtemp(join(tmpdir(), "dsh-attrib-ver-"));
    const indexDir = join(cache, "impact-index");
    TMP.push(cache);
    const g = await buildImpact({ workspace: ws, cacheDir: cache, indexDir, maxFiles: 50 });
    const files: ScannedFile[] = [];
    for (const rel of g.files) {
      const st = await import("node:fs/promises").then((m) => m.stat(join(ws, rel)));
      files.push({ rel, abs: join(ws, rel), mtimeMs: st.mtimeMs, size: st.size });
    }
    const sha = "1".repeat(40);
    await saveImpactIndex(indexDir, ws, sha, g, files);
    const name = (await readdir(indexDir)).filter((n) => n.endsWith(".json"))[0]!;
    const artifactPath = join(indexDir, name);
    const raw = JSON.parse(await readFile(artifactPath, "utf8")) as Record<string, unknown>;
    // 字段一格不缺，只有号不符：这一格不许由"缺字段"那支顺手兜住，否则版本号本身就是死代码。
    raw.schemaVersion = IMPACT_INDEX_SCHEMA_VERSION + 1;
    await writeFile(artifactPath, JSON.stringify(raw), "utf8");
    expect(await loadImpactIndex(indexDir, ws, sha, files), "号不符＝判据换过，宁 miss 重建").toBeNull();
  });
});

// ---- 读端文案与接线 ----

describe("语义租约的波及闭包（这条判据的第三个消费者，第 306 页）", () => {
  it("闭包只算归得到的引用方：绑到外部包的那一处掉出，真 import 与没有任何绑定的都留着（宽窄两臂同一张图）", async () => {
    const g = await buildFour();
    const bare: ImpactGraph = { ...g, nameSources: new Map() };
    const narrow = closureFilesOf(g, ["src/ledger.ts"]);
    const wide = closureFilesOf(bare, ["src/ledger.ts"]);
    // 阳性对照：真的从这份定义 import 过来的 ⇒ 窄闭包里必须有它（窄过头＝把真冲突放过去）
    expect(narrow, "consumer.ts 的 readFile 就是从 ledger.ts 绑进来的").toContain("src/consumer.ts");
    // 全局脚本形状（没有任何 import 绑这个名字）＝没有反证 ⇒ 照旧算波及
    expect(narrow, "legacy.js 拿不出反证 ⇒ 保守计入").toContain("src/legacy.js");
    // 阴性对照：那处用的是 node:fs/promises 的同名函数 ⇒ 不该再被当成冲突源
    expect(narrow, "反证成立：nodeuser.ts 那处与图上任何一份定义都归不上").not.toContain("src/nodeuser.ts");
    // 已登记的口径＝**任一定义命中即留**的并集：otherdef.ts 那处归得到 third.ts 那份定义，
    // 所以它仍算 ledger.ts 的冲突源。这一格是任务 #19 要收的口子（按 def 逐条筛），
    // 今天把它钉在这里，是为了让"改窄"那天有一个人能红——不是把它当正确行为藏起来。
    expect(narrow, "并集口径（第 306 页现状）：它归得到另一份定义 ⇒ 仍进闭包").toContain("src/otherdef.ts");
    // 两态必须不同输出（宽＝接第 305 页之前的行为，走的是同一个函数，不是探针另算一遍）
    expect(wide.length, "同一张图抹掉落料面 ⇒ 闭包回到全宽").toBeGreaterThan(narrow.length);
    for (const f of narrow) expect(wide).toContain(f);
  });

  it("闭包只有一支：affectedFilesOf 走 closureFilesOf，不内联第二份循环", () => {
    const idx = readFileSync(fileURLToPath(new URL("../src/agent/impact/index.ts", import.meta.url)), "utf8");
    expect(idx).toMatch(/return closureFilesOf\(graph, declared\);/);
    // 结构钉：并入闭包那一行只许出现一次。再抄一份（哪怕带判据）就是"两份同源循环各自漂"
    expect((idx.match(/out\.add\(site\.file\)/gu) ?? []).length, "波及闭包的并入行只有一处").toBe(1);
  });
});

describe("回注文案：三态与同名歧义各说各的", () => {
  const base = {
    file: "src/a.ts", symbols: ["readFile"], truncated: false,
    graphFiles: 1, graphCap: 1, graphCandidates: 1,
  };
  it("歧义句与归属句彼此独立：只有归属计数没有歧义时，归属句照样出", () => {
    const onlyAttrib = contextNoteFor({
      ...base, up: [{ file: "src/b.ts", symbol: "readFile", line: 3 }], ambiguousSymbols: [],
      attribution: { kept: 1, dropped: 7, noEvidence: 2 },
    });
    expect(onlyAttrib).toContain("7 处已按「同名但另有出处」排除");
    expect(onlyAttrib).toContain("2 处所在文件没有 import 面可判");
    expect(onlyAttrib).not.toContain("同名定义");
  });

  it("全 0 时注入文本与接这一维之前逐字相同（零回归哨兵）", () => {
    const up = [{ file: "src/b.ts", symbol: "readFile", line: 3 }];
    const before = contextNoteFor({ ...base, up, ambiguousSymbols: [], attribution: emptyAttributionStats() });
    expect(before).not.toContain("归属判定");
  });
});

describe("接线（算出来不接＝本仓那一族）", () => {
  const idx = readFileSync(fileURLToPath(new URL("../src/agent/impact/index.ts", import.meta.url)), "utf8");
  const per = fileURLToPath(new URL("../src/agent/impact/persist.ts", import.meta.url));
  const perSrc = readFileSync(per, "utf8");

  it("边构造吃判据：三态计数各有一行，且摘边只看 verdict", () => {
    expect(idx).toMatch(/const verdict = attributeRefToDef\(binding, d\.file\);/);
    expect(idx).toMatch(/if \(verdict === "dropped"\) continue;/);
  });

  it("upward 与 downward 都过同一把判据（只硬化一支＝另一支的清单继续撒谎）", () => {
    expect(idx).toMatch(/attributableSomewhere\(graph, r\.file, symbol, defFiles\)/);
    expect(idx).toMatch(/if \(attributeRefToDef\(binding, d\.file\) === "dropped"\) continue;/);
    expect(idx).toMatch(/function attributableSomewhere/);
  });

  it("取料两出口同进缓存与索引", () => {
    expect(idx).toMatch(/writeTagsCache\(dir, f, tags, imports\)/);
    expect(idx).toMatch(/Array\.isArray\(e\.tags\) && Array\.isArray\(e\.imports\)/);
    expect(idx).toMatch(/nameSources,?\n\s*attribution,/);
    expect(perSrc).toMatch(/nameSources: \[\.\.\.graph\.nameSources\.entries\(\)\]/);
    expect(perSrc).toMatch(/attribution: \{ \.\.\.graph\.attribution \},/);
  });

  it("解析走 fileSymbols（第三个出口），不回退到 fileTags 薄壳", () => {
    expect(idx).toMatch(/await fileSymbols\(src, ext\)/);
    expect(idx).toMatch(/imports = sym\.imports;/);
    expect(idx).not.toMatch(/await fileTags\(src, ext\)/);
  });

  it("外部包同样是证据：取料那一处不许把解析失败丢掉", () => {
    expect(idx).toMatch(/bindingSourceKey\(resolveModuleSpecifier\(f\.rel, ir\.spec, knownFiles\), ir\.spec\)/);
  });

  it("ImpactUnavailableError 的 fail-loud 那一支没被顺手改掉（本笔动了同一个 try 块）", () => {
    expect(idx).toMatch(/impact: tree-sitter unavailable/);
    expect(new ImpactUnavailableError("x").name).toBe("ImpactUnavailableError");
  });
});
