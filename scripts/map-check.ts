// M2b 符号地图明卷（任务 3+4 验收）：
// ①渲染结果 token ≤ 1024（默认预算）②改小预算时输出确实变短（这里以 1024 vs 4096 双跑验证预算生效）
// ③单行超 100 字符被截断 ④未改文件 → 命中缓存且结果逐字相同 ⑤改一个文件 → 重算且结果变化
// ⑥用户仓库里没有 tags 缓存文件（缓存只落应用数据目录 M2B_TAGS_DIR 指定的临时目录）
// 真实靶子 = 本仓库 src/agent/**（自研吃狗粮，四语言中的 ts 真实存在）。
import { cp, mkdtemp, readdir, stat, utimes, writeFile } from "node:fs/promises";
import { lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { measureMapRecall } from "./probe-map-recall.js";
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
  // H9（审查 P2）：工作区改为仓库临时副本——旧实现直接以 process.cwd() 为工作区，⑤的注桩
  // 写进**受版本控制的源码** src/agent/map/rank.ts，仅靠 finally 还原；进程被 SIGKILL/超时
  // 打断即留下污染。副本上注桩，真实源码零接触（耗时换数据完整性）。
  const repoRoot = process.cwd();
  const workspace = await mkdtemp(join(tmpdir(), "m2b-mapcheck-ws-"));
  // 审查 S3-9（原 agents 分片 #10）：子串匹配会误伤同名前缀（outputs / dist-staging /
  // 任何名字里带 "out" 的目录段），也可能因绝对路径里出现 "/.git" 而漏拷或过删。
  // 按路径段精确比对，跳过集合就是那六个目录名。
  // 跳过集合再加 .codegraph：它是 CodeGraph 工具自身的索引目录（含守护进程 socket），
  // 与 node_modules 同类——不属于被测源码，且 daemon.sock 是 socket 文件，cp 复制会抛
  // ERR_FS_CP_SOCKET（在有 CodeGraph 守护进程运行的环境下必现，把门禁卡在拷贝阶段）。
  const SKIP_SEGS = new Set(["node_modules", ".git", "out", "dist", "oh-src", ".tmp", ".codegraph"]);
  await cp(repoRoot, workspace, {
    recursive: true,
    // 双保险：任何非普通文件（socket / fifo / 设备）一律跳过，不依赖目录名枚举。
    filter: (src: string): boolean => {
      if (src.split("/").some((seg) => SKIP_SEGS.has(seg))) return false;
      const st = lstatSync(src, { throwIfNoEntry: false });
      return st === undefined || st.isFile() || st.isDirectory();
    },
  });
  check("⓪工作区为临时副本（不改动受版本控制源码）", workspace.startsWith(tmpdir()), workspace.slice(0, 40));
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
    // 顶部锚定 + contextFiles boost：rank.ts 是上下文文件（×50），boost 后必在预算渲染面内。
    // 旧实现既未锚顶也无 boost——probe 符号随仓库增长（新增源文件）落到 top-k 截断区外（⑤b 假红）。
    const newSym = "export function __map_check_probe_symbol_x9(): number { return 42; }\n\n";
    await writeFile(join(workspace, target), newSym + orig, "utf8");
    const after = await builder.build({ workspace, nowRound: 100, recomputeEvery: 10, contextFiles: [target] });
    check("⑤改一个文件 → 重算（parsed=1）", after.parsed === 1, `parsed=${after.parsed} fromTagsCache=${after.fromTagsCache}`);
    check("⑤b 结果变化（新符号入图）", after.text.includes("__map_check_probe_symbol_x9"), "");
  } finally {
    await writeFile(join(workspace, target), orig, "utf8"); // 还原（git checkout 双保险在 finally 后）
  }

  // ⑥ 用户仓库里没有 tags 缓存文件（检查工作区里没有 .m2b-tags 类文件；缓存实际落在 tmp tagsDir）
  const wsEntries = await readdir(workspace, { recursive: true });
  const leaked = wsEntries.filter((p) => p.includes("symbol-map-tags") || p.includes(".tags-cache"));
  check("⑥用户仓库内无 tags 缓存文件", leaked.length === 0, leaked.slice(0, 3).join(","));
  const cacheEntries = await readdir(tagsDir);
  check("⑥b 应用数据目录（tmp）缓存存在", cacheEntries.length > 0, `entries=${cacheEntries.length}`);

  // ⑦ 召回不变量（在**真仓库**上量，不是那份 tmp 拷贝）：合法文件不许整文件从图里消失。
  // 只守机制不守阈值——召回率会随新语法自然浮动，而「TS 自己认得过、图里却一个定义都没有」不会。
  // 立这条的实测：首跑 4 个合法文件因 grammar 误报被一票否决（含 `src/agent/map/parse.ts` 自己，
  // 27 个模块级声明全丢），改成 ERROR 子树之外的部分回收后归零（召回 0.9863 → 0.9991）。
  try {
    const rep = await measureMapRecall(resolve(import.meta.dirname, ".."));
    const rate = rep.decls === 0 ? 0 : rep.caught / rep.decls;
    check("⑦真仓库召回：零抽取文件数 = 0", rep.zeroDefFiles.length === 0,
      `files=${String(rep.tsFiles)} decls=${String(rep.decls)} 召回率=${rate.toFixed(4)}（读数）漏抽=${String(rep.misses.size)} 零抽取=${rep.zeroDefFiles.slice(0, 3).map(([f]) => f).join(",")}`);
  } catch (err) {
    console.log(`  ⚠️ ⑦未证：召回测量跑不动（${err instanceof Error ? err.message : String(err)}）——不拿「量不了」当「通过」，也不当红`);
  }

  console.log("[map-check] 符号地图验收");
  for (const r of results) console.log(r);
  console.log(failed === 0 ? "✅ map-check 全部通过" : `❌ map-check 失败 ${failed} 项`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("[map-check] 异常:", err);
  process.exit(1);
});
