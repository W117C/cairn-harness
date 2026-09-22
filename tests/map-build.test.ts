// M2b 任务 4+5 验收（缓存与注入 / 失败降级）：
// ①未改文件 → 命中缓存且结果逐字相同 ②改一个文件 → 重算且结果变化 ③用户仓库里没有 tags 缓存文件
// ④坏 grammar 路径 → 不抛异常、返回空地图（降级）
import { describe, expect, it, beforeEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, utimes, readdir, access } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyFileCap, createMapBuilder, defaultTagsCacheDir, scanSourceFiles, scanSourceFilesAll } from "../src/agent/map/build.js";
import { __resetLangCache, __resetQueryCache } from "../src/agent/map/parse.js";

let ws = "";
let cacheDir = "";

beforeEach(async () => {
  ws = await mkdtemp(join(tmpdir(), "m2b-map-"));
  cacheDir = await mkdtemp(join(tmpdir(), "m2b-tags-"));
  await mkdir(join(ws, "src"), { recursive: true });
  await writeFile(
    join(ws, "src", "alpha.ts"),
    "export function alpha(): number { return helper(); }\nfunction helper() { return 1; }\n",
    "utf8",
  );
  await writeFile(
    join(ws, "src", "beta.py"),
    "def beta():\n    return gamma()\n\ndef gamma():\n    return 2\n",
    "utf8",
  );
});

describe("map build（任务 4+5）", () => {
  it("未改文件 → 渲染缓存命中、结果逐字相同且 tags 全命中；用户仓库里没有 tags 缓存文件", async () => {
    const b = createMapBuilder({ tagsCacheDir: cacheDir });
    const first = await b.build({ workspace: ws });
    expect(first.ok).toBe(true);
    expect(first.text).toContain("alpha");
    expect(first.fromRenderCache).toBe(false);
    const second = await b.build({ workspace: ws, nowRound: 1 });
    expect(second.fromRenderCache).toBe(true);
    expect(second.text).toBe(first.text); // 逐字相同
    expect(second.tokens).toBe(first.tokens);
    // tags 磁盘缓存写在 cacheDir，用户工作区无缓存文件
    const wsEntries = await readdir(ws, { recursive: true });
    expect(wsEntries.some((p) => p.includes("symbol-map") || p.endsWith(".tags.json"))).toBe(false);
    const cacheEntries = await readdir(cacheDir);
    expect(cacheEntries.length).toBeGreaterThan(0); // 缓存在应用数据目录一侧
  });

  it("改一个文件 → 指纹变化重算且结果变化；tags 磁盘缓存 {mtime,size} 键控生效", async () => {
    const b = createMapBuilder({ tagsCacheDir: cacheDir });
    const first = await b.build({ workspace: ws });
    expect(first.parsed).toBe(2);
    // 未改文件第二次构建（绕过渲染缓存：强制 nowRound 超过 recomputeEvery）
    const again = await b.build({ workspace: ws, nowRound: 99, recomputeEvery: 10 });
    expect(again.fromTagsCache).toBe(2); // {mtime,size} 未变 → tags 全命中
    expect(again.parsed).toBe(0);
    // 改 alpha.ts 内容 → mtime/size 变 → tags 重解析
    await new Promise((r) => setTimeout(r, 20));
    await writeFile(join(ws, "src", "alpha.ts"), "export function alpha2(): number { return 42; }\n", "utf8");
    const changed = await b.build({ workspace: ws, nowRound: 100, recomputeEvery: 10 });
    expect(changed.fromTagsCache).toBe(1);
    expect(changed.parsed).toBe(1);
    expect(changed.text).not.toBe(first.text); // 重算且结果变化
    expect(changed.text).toContain("alpha2");
  });

  it("坏 grammar（wasm 加载失败）→ 不抛异常、返回空地图（静默降级）", async () => {
    __resetLangCache();
    __resetQueryCache();
    const { __setWts } = await import("../src/agent/map/parse.js");
    __setWts({
      Parser: Object.assign(function () {
        throw new Error("boom");
      }, { init: () => Promise.resolve() }),
      Language: { load: () => Promise.reject(new Error("bad wasm")) },
      Query: class {},
    } as never);
    const b = createMapBuilder({ tagsCacheDir: cacheDir });
    const r = await b.build({ workspace: ws });
    expect(r.ok).toBe(false);
    expect(r.text).toBe(""); // 空地图：退回纯 agentic 探索
    __setWts(null);
    __resetLangCache();
    __resetQueryCache();
  });

  it("rg 不可用（工作区不存在）→ 空地图不抛；defaultTagsCacheDir 不在用户仓库", async () => {
    const b = createMapBuilder({ tagsCacheDir: cacheDir });
    const r = await b.build({ workspace: join(ws, "no-such-dir") });
    expect(r.ok).toBe(false);
    expect(r.text).toBe("");
    expect(defaultTagsCacheDir()).not.toContain(ws);
  });
  it("竞态回归：build() 返回 ⟹ 所有 tags 缓存已落盘（多文件确定性检验）", async () => {
    // 修复前 writeTagsCache 是即发即忘（void ... .catch()）：build 返回时仍有未落盘的写
    // → 紧接的第二次构建 readTagsCache 必然 miss。本测试用足够多的文件让「返回后仍有未决写」
    // 在修复前的实现下几乎必然发生，锁定「返回即落盘」不变量。
    const N = 120;
    for (let i = 0; i < N; i++) {
      await writeFile(join(ws, "src", `mod${i}.ts`), `export function fn${i}(): number { return ${i}; }\n`, "utf8");
    }
    const total = N + 2; // + alpha.ts + beta.py
    const b = createMapBuilder({ tagsCacheDir: cacheDir });
    const first = await b.build({ workspace: ws, maxFiles: total });
    expect(first.ok).toBe(true);
    expect(first.parsed).toBe(total);
    // 返回后立即清点磁盘缓存：必须与已解析文件数逐字一致（落盘完成才许返回）
    const entries = await readdir(cacheDir);
    expect(entries.length).toBe(total);
    // 紧接第二次构建（绕过渲染缓存）：tags 必须全命中，零重解析
    const again = await b.build({ workspace: ws, maxFiles: total, nowRound: 99, recomputeEvery: 10 });
    expect(again.fromTagsCache).toBe(total);
    expect(again.parsed).toBe(0);
  });

});

/* ---------------- 候选集的两道静默排除（影响面「波及未知」的成因） ----------------
   动因（2026-09-23 实测本仓）：`write_file`/`edit_file` 之后的影响面回注走 `fileImpact`，
   而它第一句就是「这文件在图里吗」，不在 → 返回 null → **不发事件、也不写一行说明**。
   「不在图里」有两种成因，都不是罕见角落：
     ① `scanSourceFiles` 按 mtime 取最新 maxFiles 个（缺省 400）——本仓 436 个候选源码里
        有 36 个被挤在图外，其中包含 `src/renderer/app.js` 这种最热被改的文件；
     ② 枚举用 `rg --files`，它默认尊重 `.gitignore`——被忽略的源码永不进图。
   这一组测的是**成因本身**（钉住"今天它什么都没说"），不是修法。修法（让缺席说出原因，
   且不给面板发「波及 0」那种假读数）要改 `src/tools/base.ts` 的钩子形状或 `src/events` 的
   事件字段，两处都在别人的在飞改动集里 ⇒ 已立待办 #36，这里先把探针与数字留在地上。
   **09-23 追注（不回改上面那句——那是该日快照）**：读侧的成因已能说出（#41）——
   `scanSourceFilesAll` 交出全量候选并按 mtime 排好，`applyFileCap` 是唯一的切片处，
   `impact_query` 的缺席分诊据此区分「帽外第 k 位」与「压根没进候选集」。
   **写侧（编辑后回注里带一行说明）仍待 #36。** */
describe("候选集的两道静默排除（待办 #36 的成因探针）", () => {
  it("帽外不吭声：maxFiles 截断不留任何痕迹，被挤掉的文件与「本来就不支持的后缀」在结果里同形", async () => {
    // 5 个受支持后缀的文件，mtime 依次排到 alpha/beta 之后（帽按 mtime 取最新，别赌时钟精度）
    for (let i = 1; i <= 5; i++) {
      const p = join(ws, "src", `m${i}.ts`);
      await writeFile(p, `export function f${i}(): number { return ${i}; }\n`, "utf8");
      const t = new Date(Date.now() + i * 1000);
      await utimes(p, t, t);
    }
    const three = await scanSourceFiles(ws, 3);
    expect(three.map((f) => f.rel)).toEqual(["src/m5.ts", "src/m4.ts", "src/m3.ts"]);
    // m1/m2 在盘上、后缀支持、内容合法，却因为帽而不在图里——而返回值里没有任何"少算了"的记号
    await expect(access(join(ws, "src", "m1.ts"))).resolves.toBeUndefined();
    expect(three.length).toBe(3);
    const shaped = three as unknown as { truncated?: unknown; candidates?: unknown };
    expect(shaped.truncated, "截断标记不在切片结果上：要说「少算了」得去问全量候选（下面那条）").toBeUndefined();
    expect(shaped.candidates).toBeUndefined();
    // 成对的另一半（#41 落地的 seam）：同一个工作区，全量候选数得出来，切片只是它的前 3 个。
    // 没有这一条，"帽外"就只有读端猜的份；有了它，impact_query 才敢说"第 k 位 / 收录 N 个"。
    const all = await scanSourceFilesAll(ws);
    expect(all.length, "全量候选 = 帽前 + 帽外，必须比切片多").toBeGreaterThan(three.length);
    expect(all.map((f) => f.rel).slice(0, 3), "候选顺序 = 切片顺序（帽只截不断序）").toEqual(three.map((f) => f.rel));
    expect(all.some((f) => f.rel === "src/m1.ts"), "被帽挤掉的那个必须还在候选集里（第 k 位才算得出来）").toBe(true);
    expect(applyFileCap(all, 3).map((f) => f.rel)).toEqual(three.map((f) => f.rel));
  });

  it(".gitignore 掉的源码永远不进图：文件在盘上、后缀受支持、就是不出现", async () => {
    // rg 只在 git 仓库内应用 .gitignore（ignore crate 的 require_git 缺省为真）⇒ 先把靶子变成仓库
    execFileSync("git", ["init", "-q", ws]);
    await writeFile(join(ws, ".gitignore"), "gen/*.ts\n", "utf8");
    await mkdir(join(ws, "gen"), { recursive: true });
    await writeFile(join(ws, "gen", "hidden.ts"), "export function hidden(): number { return 1; }\n", "utf8");
    await writeFile(join(ws, "src", "kept.ts"), "export function kept(): number { return 2; }\n", "utf8");
    const rels = (await scanSourceFiles(ws)).map((f) => f.rel);
    // 成对判（排除类断言的老规矩）：被排除的那条确实在盘上，对照组确实进来了
    await expect(access(join(ws, "gen", "hidden.ts"))).resolves.toBeUndefined();
    expect(rels).toContain("src/kept.ts");
    expect(rels).not.toContain("gen/hidden.ts");
  });
});
