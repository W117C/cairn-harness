/** 第 262 页取证：全量判卷的**逐条耗时分布**——"哪些用例坐在缺省 5000ms 帽下面"要有名单，不能靠印象。
 *
 *  取料：`suite-quiet.json`（同一台机器、安静态、`--reporter=json` 的一次全量跑）。
 *  为什么要这张表：2026-10-01 认证 `bd5ec44` 时两条用例报 `Test timed out in 5000ms`（不是断言失败），
 *  而 `tests/vitest.config.ts` 里没有 `testTimeout`、全仓 0 条用例带显式 timeout ⇒ **3394 条都骑在缺省 5s 上**。
 *  要给哪几条加预算，只能从"安静态实测多久"里选，不能凭"看起来慢"（规则 237/242：尺要先喂真数据、要能两态不同形）。
 *  用法：`node --import tsx outputs/judge-timeout-2026-10-01/analyse.mts` */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const here = fileURLToPath(new URL(".", import.meta.url));
type Assertion = { fullName?: string; title?: string; ancestorTitles?: string[]; duration?: number; status?: string; failureMessages?: string[] };
type FileRow = { name: string; assertionResults?: Assertion[] };

const raw = JSON.parse(readFileSync(join(here, "suite-quiet.json"), "utf8")) as { testResults?: FileRow[] };
const files = raw.testResults ?? [];
const rows: { file: string; full: string; ms: number; failed: boolean }[] = [];
for (const f of files) {
  const rel = f.name.replace(fileURLToPath(new URL("../../", import.meta.url)), "");
  for (const a of f.assertionResults ?? []) {
    rows.push({ file: rel, full: a.fullName ?? a.title ?? "(无名)", ms: a.duration ?? 0, failed: (a.failureMessages ?? []).length > 0 });
  }
}
if (rows.length < 1000) {
  console.log(`❌ 只解析出 ${String(rows.length)} 条（全量应有 3000 条以上）⇒ 取料形状不对，别看下面的数`);
  process.exit(2);
}
const byDesc = [...rows].sort((x, y) => y.ms - x.ms);
const bucket = (lo: number): number => rows.filter((r) => r.ms >= lo).length;
console.log(`取料：${String(files.length)} 个文件／${String(rows.length)} 条用例（json 里 duration 为缺省的按 0 计，条数 ${String(rows.filter((r) => r.ms === 0).length)}）`);
console.log(`缺省帽 5000ms；分布：≥1000ms ${String(bucket(1000))} 条｜≥2000ms ${String(bucket(2000))}｜≥3000ms ${String(bucket(3000))}｜≥4000ms ${String(bucket(4000))}｜≥4800ms ${String(bucket(4800))}｜≥5000ms ${String(bucket(5000))}`);
console.log("最慢 18 条（安静态）：");
for (const r of byDesc.slice(0, 18)) console.log(`  ${String(r.ms).padStart(6)}ms  ${r.file}  ${r.full.slice(0, 90)}`);
const hot = new Map<string, number>();
for (const r of rows) if (r.ms >= 2000) hot.set(r.file, (hot.get(r.file) ?? 0) + 1);
const hotRows = [...hot.entries()].sort((a, b) => b[1] - a[1]);
console.log(`坐在 ≥2000ms 这一档后面的文件（共 ${String(hotRows.length)} 个）：${hotRows.map(([f, n]) => `${f}=${String(n)}`).join(" ")}`);
console.log(`失败条数（安静态应为 0）：${String(rows.filter((r) => r.failed).length)}`);
