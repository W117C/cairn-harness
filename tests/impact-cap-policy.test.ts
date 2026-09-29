/* 影响面/地图那顶文件帽的**政策**与它的四个消费者（待办 #21 笔1，09-30）。
   根因不是「400 太小」，而是「按 mtime 截断」：切片前那份候选按这台机器最近动过的文件排，
   而 `git worktree add` 出来的树里所有文件同一个秒 ⇒ 边界由 rg 的遍历顺序决定。
   两棵同一份代码的树实测：换字典序取前 400，入图集合差 21–28%；确证口径 88 条查询答不同（22.0%）。
   读数与复跑命令：`outputs/impact-cap-decision-2026-09-30/`（`decision-input.md` ＋四支探针）。
   代价（独立进程、两种顺序各跑一次，非同进程对拍）：全量比帽 400 贵 **＋176ms／次建图**
   （本仓候选 512：1071ms → 1247ms，同臂散布 ≤13ms）。 */
import { cp, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { applyFileCap, compareCandidates, scanSourceFilesAll, scanSourceFiles, type ScannedFile } from "../src/agent/map/build";
import { MAX_FILES_CEILING, MAX_FILES_DEFAULT } from "../src/agent/map/cap";
import { affectedFilesOf, buildImpact, contextNoteFor, defaultImpactHook, fileImpact } from "../src/agent/impact/index";
import { coverageNote, graphIsPartial } from "../src/agent/impact/coverage";

const MINI = fileURLToPath(new URL("../fixtures/impact/mini-repo", import.meta.url));
let cache = "";
let wsBig = "";
const TMP: string[] = [];

/** N 个**内容合法、互相引用**的小文件（f1..fN-1 都引用 f0 的 `seed`）。
 *  mtime **递减**盖章 ⇒ f0 最新、fN-1 最旧：帽咬下去时"定义方 f0 在图内、一部分调用方在帽外"，
 *  于是「波及 N 个文件」的 N 被切小——正是这一组要钉住的那个骗人的读数。序是确定的，不赌毫秒精度。 */
async function makeChain(n: number): Promise<string> {
  const ws = await mkdtemp(join(tmpdir(), "impact-cap-chain-"));
  TMP.push(ws);
  for (let i = 0; i < n; i++) {
    const body = i === 0
      ? "export function seed(i) { return i + 1; }\n"
      : `import { seed } from "./f0";\nexport function use${String(i)}(i) { return seed(i); }\n`;
    const p = join(ws, `f${String(i)}.ts`);
    await writeFile(p, body, "utf8");
    const t = new Date(Date.UTC(2026, 0, 1 + (n - 1 - i)));
    await utimes(p, t, t);
  }
  return ws;
}

beforeEach(async () => {
  cache = await mkdtemp(join(tmpdir(), "impact-cap-cache-"));
  TMP.push(cache);
});
afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => { for (const d of TMP) await rm(d, { recursive: true, force: true }).catch(() => {}); });

describe("缺省帽＝成本安全阀，不再是覆盖面政策", () => {
  beforeEach(async () => { wsBig = await makeChain(405); });

  it("缺省帽不再按机器状态切覆盖面：405 个候选全进图", async () => {
    // 这一格就是「把 MAX_FILES_DEFAULT 改回 400 会红」的那一把尺：
    // 400 帽下最旧的那 5 个（f400..f404，mtime 依次递减）会被切掉，graphFiles 只剩 400。
    const g = await buildImpact({ workspace: wsBig, cacheDir: join(cache, "d") });
    expect(g.candidates, "候选数＝靶子自造的 405").toBe(405);
    expect(g.files.length, "缺省帽把候选全收进来 ⇒ 覆盖面不再取决于这台机器最近动过什么").toBe(405);
    expect(g.cap, "图要带着**实发的帽**出来，读端不许自己再解析一遍缺省").toBe(MAX_FILES_DEFAULT);
    expect(graphIsPartial(g.files.length, g.candidates)).toBe(false);
    expect(coverageNote(g.files.length, g.cap, g.candidates)).toBe("");
    expect(MAX_FILES_DEFAULT).toBe(MAX_FILES_CEILING);
  });

  it("反向对照：把帽压回 400 就真的少收 5 个（自述不是摆设）", async () => {
    // 上一格只说"没收全就红"；这一格说"少了要能看出来"。没有它，
    // 一个永远返回空自述的 coverageNote 也能让上一格"恰好"通过。
    const g = await buildImpact({ workspace: wsBig, cacheDir: join(cache, "r"), maxFiles: 400 });
    expect(g.files.length).toBe(400);
    expect(g.cap).toBe(400);
    expect(graphIsPartial(g.files.length, g.candidates)).toBe(true);
    expect(coverageNote(g.files.length, g.cap, g.candidates)).toContain("另有 5 个候选文件没进这张图");
  });

  it("切片处只有一个：scanSourceFiles 就是 scanSourceFilesAll 的前 N 个", async () => {
    const all = await scanSourceFilesAll(wsBig);
    expect(all.length).toBe(405);
    expect(applyFileCap(all, 3).map((f) => f.rel)).toEqual(all.slice(0, 3).map((f) => f.rel));
    expect((await scanSourceFiles(wsBig, 3)).map((f) => f.rel)).toEqual(applyFileCap(all, 3).map((f) => f.rel));
  });
});

describe("候选次序在 mtime 相同处也必须确定（worktree 树里所有文件同一个秒）", () => {
  let ws = "";

  it("同 mtime 的候选按路径字典序排，边界不再由 rg 决定", async () => {
    ws = await mkdtemp(join(tmpdir(), "impact-cap-order-"));
    TMP.push(ws);
    // 写入顺序**故意**与字典序无关；rg 的目录遍历顺序本机实测是乱序（见 map/build.ts 那段注释）
    const names = ["m.ts", "z.ts", "a.ts", "k.ts", "b.ts", "y.ts", "c.ts", "n.ts"];
    const same = new Date(Date.UTC(2026, 0, 1));
    for (const n of names) {
      await writeFile(join(ws, n), `export const ${n.slice(0, 1)} = 1;\n`, "utf8");
      await utimes(join(ws, n), same, same);
    }
    const rels = (await scanSourceFilesAll(ws)).map((f) => f.rel);
    expect(rels, "全部同秒 ⇒ 次序必须由第二级（路径字典序）给出来").toEqual([...rels].sort());
    // 帽真的咬下去时，"谁被切掉"从此与机器无关：取前 3 个必须是字典序最小的三个
    expect(applyFileCap(await scanSourceFilesAll(ws), 3).map((f) => f.rel)).toEqual(["a.ts", "b.ts", "c.ts"]);
  });

  it("mtime 仍是第一键：新的在前，字典序只在同一秒内说话", () => {
    const mk = (rel: string, mtimeMs: number): ScannedFile => ({ rel, abs: "/" + rel, mtimeMs, size: 1 });
    const arr = [mk("a.ts", 100), mk("z.ts", 900), mk("b.ts", 100), mk("y.ts", 900)];
    expect(arr.slice().sort(compareCandidates).map((f) => f.rel)).toEqual(["y.ts", "z.ts", "a.ts", "b.ts"]);
    // 反向哨兵：只按 mtime 排（缺第二级）会给出上面的乱序对 ⇒ 这条断言就是锚点观察面
    expect(arr.slice().sort((p, q) => q.mtimeMs - p.mtimeMs).map((f) => f.rel)).toEqual(["z.ts", "y.ts", "a.ts", "b.ts"]);
  });
});

describe("语义租约：图非全量时不许把空波及当结论（它管 spawn 准入）", () => {
  it("语义租约在图非全量时出声，空波及不当结论", async () => {
    const ws = await makeChain(6);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // 帽压到 2 ⇒ 闭包只可能在这两张里算；从前这一支**什么都不说**（钩子抛错才 warn）
    const out = await affectedFilesOf(ws, ["nope/**"], join(cache, "lease"), 2);
    expect(out).toEqual([]);
    const line = warn.mock.calls.map((c) => String(c[0])).find((s) => s.includes("语义租约"));
    expect(line, "缺料必须像故障一样出声：orchestrator 冲突 0 条时连审批卡都不发").toContain("非全量");
    expect(line).toContain("空波及不等于无冲突");
  });

  it("缺省（全量图）时租约不出声——那句警告不许变成常驻噪声", async () => {
    const ws = await makeChain(6);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = await affectedFilesOf(ws, ["f0.ts"], join(cache, "quiet"));
    expect(out.length, "前提：闭包真的算出来了").toBeGreaterThan(0);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("语义租约"))).toHaveLength(0);
  });
});

describe("回注摘要的覆盖面自述（第四个消费者：write/edit 后那句 [impact]）", () => {
  it("注入摘要带上同一句覆盖面自述（图全量时逐字不变）", async () => {
    const ws = await makeChain(8);
    // 帽 3 ⇒ 图里只有 f0/f1/f2：`seed` 的定义在图内、另外 5 个调用方在帽外。
    // 于是这一支会给出「波及 2 个文件」——N 本身被切过，从前它一个字都不提。
    const partial = await fileImpact(ws, "f0.ts", join(cache, "note"), 3);
    expect(partial, "前提：f0 是最新的三个之一，在帽内").not.toBeNull();
    expect(partial?.graphCap).toBe(3);
    expect(partial?.graphCandidates).toBe(8);
    const partialNote = contextNoteFor(partial!);
    expect(partialNote).toContain("波及 2 个文件");
    expect(partialNote).toContain("另有 5 个候选文件没进这张图");
    // 反向对照：同一问、全量图 ⇒ N 变成 7，且一个自述字节都不多（正常仓库的回注零回归）
    const full = await fileImpact(ws, "f0.ts", join(cache, "note2"));
    expect(full).not.toBeNull();
    const fullNote = contextNoteFor(full!);
    expect(fullNote).toContain("波及 7 个文件");
    expect(fullNote).not.toContain("覆盖度");
    const hook = defaultImpactHook(ws, join(cache, "hook"));
    const noted = await hook("f0.ts");
    expect(noted, "前提：钩子这一支真的产出了回注").not.toBeNull();
    expect(noted!.contextNote).not.toContain("覆盖度");
  });

  it("租约与摘要共用一把尺：graphIsPartial 是「图非全量」唯一判据", () => {
    // 判据从工具里挪到图这一层之后，读端（coverageNote/capCauseNote）与这两支必须同进同退。
    expect(graphIsPartial(400, 405)).toBe(true);
    expect(graphIsPartial(405, 405)).toBe(false);
    expect(coverageNote(400, 400, 405)).not.toBe("");
    expect(coverageNote(405, 5000, 405)).toBe("");
    // 收全时帽比候选大也不许说话（旧判据 files < cap 在这里误报）
    expect(coverageNote(405, 5000, 405), "帽 5000 > 收录 405，旧判据会说「非全量」").toBe("");
  });
});

describe("冻结靶子零回归（mini-repo 无夹具、无截断）", () => {
  let ws = "";
  beforeEach(async () => {
    ws = await mkdtemp(join(tmpdir(), "impact-cap-mini-"));
    TMP.push(ws);
    await cp(MINI, ws, { recursive: true });
  });

  it("小仓无截断 ⇒ 答案逐字不含覆盖面那句", async () => {
    const g = await buildImpact({ workspace: ws, cacheDir: join(cache, "m") });
    expect(graphIsPartial(g.files.length, g.candidates), `前提：mini-repo 候选 ${String(g.candidates)} 全进图`).toBe(false);
    const r = await fileImpact(ws, "utils.js", join(cache, "m2"));
    expect(r).not.toBeNull();
    const note = contextNoteFor(r!);
    expect(note).toContain("波及");
    expect(note).not.toContain("覆盖度");
    // 冻结靶子的波及闭包逐字不变（改了排序键也不能改答案）
    expect(await affectedFilesOf(ws, ["utils.js"], join(cache, "m3"))).toEqual(["app.js", "math.js", "utils.js"]);
  });
});
