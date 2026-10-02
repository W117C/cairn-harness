// 任务 #18 的现读：词面检索这一维的**收益上限**由「仓库里有多少文件真写了自己说明」决定，而这个数没量过。
//
// 为什么要单独量（第 302 页留下的缺口）：那一笔把首轮命中率从 6/16 抬到 13/16，靠的是「文件自己的头注释
// ＋路径」当语料。可这条通道的覆盖面从来没数过 ⇒ 下一跳该买哪一档就成了猜：
// · 覆盖率低 ⇒ 该做的是让**缺自述的文件自己出声**（注入面点名"这些文件没有自述"），不是再调检索参数；
// · 覆盖率高而命中率仍卡 ⇒ 才轮到同义改写/embedding 那一档（属裁决，要花真钱）。
//
// 三件一起取，且**三态分开印**（规则 239）：
//   ① 全仓候选面的摘要分布（有摘要·未截顶／有摘要·截在帽上／没有顶部注释／读不到）；
//   ② 「读不到」单独一格，绝不并进「没有注释」——那正是把「我没看见」读成「它没有」的同一种错；
//   ③ 尺自己的真值集（`fixtures/locate/dsh-questions.json` 那 16 题的真值文件）里各占几个——
//      这一列才是 13/16 那个数的天花板。
// 「截在帽上」那一格是 L14 那道题的形状（`src/agent/model-surface.ts` 的后半段被 220 码点切掉），
// 它数出来才知道这个帽到底咬了多少文件。
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { SUMMARY_MAX_CODEPOINTS, commentSummary } from "../src/agent/map/retrieve";
import { scanSourceFilesAll } from "../src/agent/map/build";

const REPO = resolve(import.meta.dirname, "..");

type Bucket = "summarized" | "truncated" | "no-comment" | "unreadable";
const BUCKETS: Bucket[] = ["summarized", "truncated", "no-comment", "unreadable"];
const LABEL: Record<Bucket, string> = {
  summarized: "有摘要·未截顶",
  truncated: "有摘要·截在帽上（信息尾被切掉那一格）",
  "no-comment": "没有顶部注释（词面通道对它完全看不见）",
  unreadable: "读不到（单独一格，绝不并进「没有注释」）",
};

/** 分类（纯逻辑，取料在调用方）：截顶按**码点**数，与 `commentSummary` 同一个量法。 */
function classify(src: string): Bucket {
  const s = commentSummary(src);
  if (s === "") return "no-comment";
  return [...s].length >= SUMMARY_MAX_CODEPOINTS ? "truncated" : "summarized";
}

async function bucketOf(abs: string): Promise<{ bucket: Bucket; chars: number }> {
  try {
    const src = await readFile(abs, "utf8");
    const b = classify(src);
    return { bucket: b, chars: b === "no-comment" ? 0 : [...commentSummary(src)].length };
  } catch {
    return { bucket: "unreadable", chars: -1 };
  }
}

const files = await scanSourceFilesAll(REPO); // 与地图**同一支取料面**（含载荷目录排除、后缀白名单）
const byBucket = new Map<Bucket, number>(BUCKETS.map((b) => [b, 0]));
const byDir = new Map<string, Map<Bucket, number>>();
const examples = new Map<Bucket, string[]>();
for (const f of files) {
  const { bucket } = await bucketOf(f.abs);
  byBucket.set(bucket, (byBucket.get(bucket) ?? 0) + 1);
  const top = f.rel.includes("/") ? f.rel.slice(0, f.rel.indexOf("/")) : "(根)";
  if (!byDir.has(top)) byDir.set(top, new Map(BUCKETS.map((b) => [b, 0])));
  const m = byDir.get(top)!;
  m.set(bucket, (m.get(bucket) ?? 0) + 1);
  if ((examples.get(bucket) ?? []).length < 3) examples.set(bucket, [...(examples.get(bucket) ?? []), f.rel]);
}

const total = files.length;
const seen = (byBucket.get("summarized") ?? 0) + (byBucket.get("truncated") ?? 0);
console.log(`[summary-coverage] 候选面=${String(total)} 个文件（取料面＝地图那一支 `+
  `scanSourceFilesAll，含载荷目录排除；帽前全量，不是 400 那一切片）`);
for (const b of BUCKETS) {
  const n = byBucket.get(b) ?? 0;
  console.log(`  ${LABEL[b]}＝${String(n)}（${((n / Math.max(1, total)) * 100).toFixed(1)}%）` +
    ` 例：${(examples.get(b) ?? []).join("、") || "（无）"}`);
}
console.log(`  ⇒ 词面通道可见的文件＝${String(seen)}/${String(total)}（${((seen / Math.max(1, total)) * 100).toFixed(1)}%）`);
console.log(`  按顶层目录（有自述＝summarized＋truncated）：`);
const selfReported = (m: Map<Bucket, number>) => (m.get("summarized") ?? 0) + (m.get("truncated") ?? 0);
for (const [dir, m] of [...byDir.entries()].sort((a, b) => selfReported(b[1]) - selfReported(a[1]) || a[0].localeCompare(b[0]))) {
  const yes = selfReported(m);
  const all = [...BUCKETS].reduce((s, b) => s + (m.get(b) ?? 0), 0);
  console.log(`    ${dir.padEnd(12)} 文件 ${String(all).padStart(4)} 有自述 ${String(yes).padStart(4)}（${((yes / Math.max(1, all)) * 100).toFixed(0)}%）` +
    ` 其中截顶 ${String(m.get("truncated") ?? 0).padStart(3)}｜无注释 ${String(m.get("no-comment") ?? 0).padStart(4)}｜读不到 ${String(m.get("unreadable") ?? 0)}`);
}

// ---- 尺自己的真值集：13/16 那个数的天花板 ----
const spec = JSON.parse(await readFile(resolve(REPO, "fixtures/locate/dsh-questions.json"), "utf8")) as {
  questions: { truth: { file: string }[] }[];
};
const truthFiles = [...new Set(spec.questions.flatMap((q) => q.truth.map((t) => t.file)))];
const truthBuckets = new Map<Bucket, string[]>();
for (const rel of truthFiles) {
  const { bucket } = await bucketOf(resolve(REPO, rel));
  truthBuckets.set(bucket, [...(truthBuckets.get(bucket) ?? []), `${rel}`]);
}
console.log(`[summary-coverage] 题集真值文件（去重 ${String(truthFiles.length)} 个）按同一把尺分格：`);
for (const b of BUCKETS) {
  const list = truthBuckets.get(b) ?? [];
  if (list.length > 0) console.log(`  ${LABEL[b]}＝${String(list.length)}：${list.join("、")}`);
}

// ---- 自检：分类器不许是瞎的（某个桶空着＝它压根没看见那一形状，读数就不能引用）----
// 三个真实存在的形状各要数到至少一个：第一版这里挑的哨兵是 `src/agent/map/retrieve.ts`，
// 结果它自己撞在「截顶」那一格上报了 ❌ ⇒ 哨兵要换成**已知短**的文件，而不是「我以为短」的文件。
const problems: string[] = [];
for (const b of ["summarized", "truncated", "no-comment"] as Bucket[]) {
  if ((byBucket.get(b) ?? 0) === 0) problems.push(`「${LABEL[b]}」数到 0 个 ⇒ 分类器对这一形状失明，上面的百分比不可引用`);
}
const sentinel = await bucketOf(resolve(REPO, "src/main/settings.ts"));
if (sentinel.bucket !== "summarized") {
  problems.push(`哨兵 src/main/settings.ts（第 300 页那个枢纽文件，摘要未截顶）读到的是「${sentinel.bucket}」，期望 summarized ⇒ 分类器或取料面坏了`);
}
console.log(problems.length === 0
  ? "[summary-coverage] 自检 ✅ 三个形状都数到了、哨兵落在 summarized ⇒ 上面的覆盖率可以引用"
  : "[summary-coverage] 自检 ❌ " + problems.join("；"));
if (problems.length > 0) process.exit(1);
