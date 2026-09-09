// M2b 符号地图明卷（任务 3+4 验收）：
// ①渲染结果 token ≤ 1024（默认预算）②改小预算时输出确实变短（这里以 1024 vs 4096 双跑验证预算生效）
// ③单行超 100 字符被截断 ④未改文件 → 命中缓存且结果逐字相同 ⑤改一个文件 → 重算且结果变化
// ⑥用户仓库里没有 tags 缓存文件（缓存只落应用数据目录 M2B_TAGS_DIR 指定的临时目录）
// 真实靶子 = 本仓库 src/agent/**（自研吃狗粮，四语言中的 ts 真实存在）。
import { mkdtemp, readdir, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMapBuilder, scanSourceFiles } from "../src/agent/map/build.js";
import { buildGraph, personalizedPageRank } from "../src/agent/map/rank.js";
import { clampBudget, renderMapBudget } from "../src/agent/map/render.js";
import { fileTags } from "../src/agent/map/parse.js";
import { readFile } from "node:fs/promises";

let failed = 0;
const results: string[] = [];
function check(name: string, ok: boolean, detail = ""): void {
  results.push(`  ${ok ? "✅" : "❌"} ${name}${detail ? "（" + detail + "）" : ""}`);
  if (!ok) failed++;
}

async function main(): Promise<void> {
  const workspace = process.cwd();
  const tagsDir = await mkdtemp(join(tmpdir(), "m2b-mapcheck-tags-"));
  const builder = createMapBuilder({ tagsCacheDir: tagsDir, maxInputTokens: 128_000 });

  // 基线构建
  const first = await builder.build({ workspace });
  check("地图构建成功（ok=true，非空文本）", first.ok && first.text.length > 0, `tokens=${first.tokens} parsed=${first.parsed} cached=${first.fromTagsCache}`);

  // ① 渲染结果 token ≤ 1024：默认预算（1024）下的真实渲染（不传显式预算 = 走 MAP_TOKENS_DEFAULT 路径）
  const files = await scanSourceFiles(workspace);
  const budget1k = clampBudget(undefined, 128_000); // 默认预算路径（1024）；上限被摘除时此处会放大 → ①变红
  const g = buildGraph(
    await Promise.all(
      files.map(async (f) => ({
        file: f.rel,
        tags: await fileTags(
          await readFile(f.abs, "utf8"),
          f.rel.slice(f.rel.lastIndexOf(".") + 1),
        ),
      })),
    ),
    { contextFiles: ["src/agent/map/rank.ts"] },
  );
  const ranks = personalizedPageRank(g);
  const r1k = renderMapBudget(g, ranks, budget1k);
  const r4k = renderMapBudget(g, ranks, clampBudget(4096, 128_000));
  check("①渲染结果 token ≤ 1024", r1k.tokens <= 1024, `tokens=${r1k.tokens}`);
  check("②改小预算时输出确实变短", r4k.text.length > r1k.text.length, `4096:${r4k.text.length} vs 1024:${r1k.text.length}`);
  check("②b 单行超 100 字符被截断", r4k.text.split("\n").every((l) => l.length <= 100), "");

  // ④ 未改文件 → 缓存命中且逐字相同
  const again = await builder.build({ workspace, nowRound: 99, recomputeEvery: 10 });
  check("④未改文件 → tags 缓存全命中", again.fromTagsCache === files.length && again.parsed === 0, `fromTagsCache=${again.fromTagsCache}/${files.length}`);
  check("④b 指纹不变 → 渲染逐字相同", again.text === first.text, "");

  // ⑤ 改一个文件 → 重算且结果变化
  const target = "src/agent/map/rank.ts";
  const orig = await (await import("node:fs/promises")).readFile(join(workspace, target), "utf8");
  const bak = await mkdtemp(join(tmpdir(), "m2b-mapcheck-bak-"));
  await writeFile(join(bak, "rank.ts"), orig, "utf8");
  try {
    const newSym = "\nexport function __map_check_probe_symbol_x9(): number { return 42; }\n";
    await writeFile(join(workspace, target), orig + newSym, "utf8");
    const after = await builder.build({ workspace, nowRound: 100, recomputeEvery: 10 });
    check("⑤改一个文件 → 重算（parsed=1）", after.parsed === 1, `parsed=${after.parsed} fromTagsCache=${after.fromTagsCache}`);
    check("⑤b 结果变化（新符号入图）", after.text !== first.text, "");
  } finally {
    await writeFile(join(workspace, target), orig, "utf8"); // 还原（git checkout 双保险在 finally 后）
  }

  // ⑥ 用户仓库里没有 tags 缓存文件（检查工作区里没有 .m2b-tags 类文件；缓存实际落在 tmp tagsDir）
  const wsEntries = await readdir(workspace, { recursive: true });
  const leaked = wsEntries.filter((p) => p.includes("symbol-map-tags") || p.includes(".tags-cache"));
  check("⑥用户仓库内无 tags 缓存文件", leaked.length === 0, leaked.slice(0, 3).join(","));
  const cacheEntries = await readdir(tagsDir);
  check("⑥b 应用数据目录（tmp）缓存存在", cacheEntries.length > 0, `entries=${cacheEntries.length}`);

  console.log("[map-check] 符号地图验收");
  for (const r of results) console.log(r);
  console.log(failed === 0 ? "✅ map-check 全部通过" : `❌ map-check 失败 ${failed} 项`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("[map-check] 异常:", err);
  process.exit(1);
});
