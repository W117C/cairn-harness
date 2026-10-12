// 生成内置模型目录快照：src/providers/catalog-snapshot.json
//
// 为什么要有内置快照（2026-10-06 调研结论）：Cline 与 Codex 都是「随包内置一份 + 运行时刷新」，
// 好处是断网也能把窗口与价格填上。代价是那份数据会变旧 —— 所以快照文件带 `generatedAt`，
// 读取侧必须把「这次用的是内置快照」说出来（见 catalog.ts 文件头的纪律 2）。
//
// 为什么要**精选**而不是全量：全量裁剪后仍有 1.85MB / 226 家 / 8389 条，其中一大半是聚合网关的
// 长尾。内置快照只需要覆盖「用户最可能自己接的那几家」；长尾交给运行时刷新（联网时拿全量）。
// 这份清单是产品决策，不是技术限制 —— 改它就跑一次本脚本重新生成。
//
// 用法（联网）：
//   node --import tsx scripts/catalog-snapshot.ts            # 抓取并写文件
//   node --import tsx scripts/catalog-snapshot.ts --check    # 只抓取比大小/报缺口，不写文件
//
// 不跟随重定向：这是数据源请求，不是用户端点请求，重定向一律当失败（同 claude code 对发现请求的口径）。
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseModelsDevCatalog, type CatalogProvider } from "../src/providers/catalog";

const SOURCE_URL = "https://models.dev/api.json";
const OUT = join(dirname(dirname(fileURLToPath(import.meta.url))), "src", "providers", "catalog-snapshot.json");
const TIMEOUT_MS = 20_000;
/** 自设预算：超过它就让脚本失败，而不是悄悄把仓库撑大（体量门的精神：帽要显式）。 */
const SIZE_CAP_BYTES = 400 * 1024;

/** 内置快照覆盖的 provider（顺序即文件里的顺序，改这里要重跑本脚本）。 */
const CURATED = [
  "deepseek",
  "openai",
  "anthropic",
  "google",
  "openrouter",
  "moonshotai",
  "zai",
  "mistral",
  "xai",
  "groq",
  "minimax",
  "alibaba",
  "vercel",
  "requesty",
  "llmgateway",
  "poe",
] as const;

const checkOnly = process.argv.includes("--check");

const res = await fetch(SOURCE_URL, {
  redirect: "manual",
  signal: AbortSignal.timeout(TIMEOUT_MS),
  headers: { accept: "application/json" },
});
if (res.status >= 300 && res.status < 400) {
  console.error("[catalog-snapshot] FAIL: 数据源返回重定向（不跟随，避免把请求带到别处）:", res.status);
  process.exit(1);
}
if (!res.ok) {
  console.error(`[catalog-snapshot] FAIL: 数据源 HTTP ${res.status}`);
  process.exit(1);
}
const payload: unknown = await res.json();
const live = parseModelsDevCatalog(payload);

const byId = new Map(live.providers.map((p) => [p.id, p]));
const missing: string[] = [];
const picked: CatalogProvider[] = [];
for (const id of CURATED) {
  const p = byId.get(id);
  if (p === undefined) {
    missing.push(id); // 上游改名/下架 —— 明说，不静默少一家
    continue;
  }
  // 模型按 id 排序：让每次重新生成的文件 diff 只反映真实变化，不反映对象键序抖动。
  const models = [...p.models].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  picked.push({ ...p, models });
}

const snapshot = {
  version: 1,
  source: "models.dev",
  generatedAt: new Date().toISOString(),
  providers: picked,
};
// 紧凑 JSON（不留缩进）：这个文件是**生成物**，不是给人逐行读的——1573 条模型加缩进会胖三倍
// （603KB → 230KB 量级），而人真正需要审的是生成脚本里的 CURATED 清单与 catalog.ts 的解析面。
// 需要看内容时用 `node -e` 或 UI 读，不要靠读这个文件。
const text = JSON.stringify(snapshot) + "\n";

const modelCount = picked.reduce((n, p) => n + p.models.length, 0);
console.log(
  `[catalog-snapshot] 上游 ${live.providers.length} 家 → 精选 ${picked.length} 家 / ${modelCount} 条模型 / ${(
    text.length / 1024
  ).toFixed(0)} KB（帽 ${SIZE_CAP_BYTES / 1024} KB）`,
);
if (missing.length > 0) console.warn(`[catalog-snapshot] ⚠️ 清单里这几家在上游找不到（已跳过，请核对）: ${missing.join(", ")}`);
if (text.length > SIZE_CAP_BYTES) {
  console.error(`[catalog-snapshot] FAIL: 产物 ${text.length} 字节超过自设帽 ${SIZE_CAP_BYTES}；请缩清单而不是抬高帽`);
  process.exit(1);
}
if (checkOnly) {
  console.log("[catalog-snapshot] --check：未写文件");
} else {
  writeFileSync(OUT, text, "utf8");
  console.log("[catalog-snapshot] 已写入", OUT);
}
