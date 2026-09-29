// 只读验证：缺省帽截的是不是"最近改动的 400 个"（build.ts:79 按 mtimeMs 降序 + :85 slice）。
// 判据：入图那批的 mtime 下界 应当 ≥ 图外那批的上界（中间允许并发写入的小重叠）。stat 不改任何东西。
import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve(process.env.DSH_ROOT ?? process.cwd());
const pick = async (rel) => import(pathToFileURL(join(ROOT, rel)).href);
const build = await pick("src/agent/map/build.ts");
const { MAX_FILES_DEFAULT } = build;

const all = await build.scanSourceFilesAll(ROOT);
const sorted = [...all].sort((a, b) => b.mtimeMs - a.mtimeMs);
const inSet = new Set(sorted.slice(0, MAX_FILES_DEFAULT).map((f) => f.rel));
const outSet = sorted.filter((f) => !inSet.has(f.rel));
const fmt = (ms) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");

console.log(`ROOT=${ROOT}`);
console.log(`候选=${String(all.length)} 帽=${String(MAX_FILES_DEFAULT)} 入图=${String(inSet.size)} 图外=${String(outSet.length)}`);
console.log(`入图 newest=${fmt(sorted[0].mtimeMs)} oldest=${fmt(sorted[inSet.size - 1].mtimeMs)}`);
console.log(`图外 newest=${fmt(outSet[0].mtimeMs)} oldest=${fmt(outSet[outSet.length - 1].mtimeMs)}`);
const cleanCut = sorted[inSet.size - 1].mtimeMs >= outSet[0].mtimeMs;
console.log(`边界是否就是"一次按 mtime 的切"=${cleanCut ? "是" : "否"}`);
// 再一测：同一台机器上把顺序换成"字典序"会切掉谁——两批差异有多大（说明"帽外是谁"取决于顺序，而不是重要性）
const alpha = [...all].sort((a, b) => a.rel.localeCompare(b.rel));
const alphaIn = new Set(alpha.slice(0, MAX_FILES_DEFAULT).map((f) => f.rel));
let diff = 0;
for (const r of inSet) if (!alphaIn.has(r)) diff += 1;
console.log(`若帽改成按路径字典序取前 ${String(MAX_FILES_DEFAULT)} ⇒ 与 mtime 口径的入图集合差异=${String(diff)} 个文件（${((diff / MAX_FILES_DEFAULT) * 100).toFixed(1)}%）`);
const kind = (p) => (/(^|\/)fixtures\//.test(p) ? "夹具" : /(^|\/)tests?\//.test(p) || /\.test\.[cm]?[tsj]sx?$/u.test(p) ? "测试" : "真项目文件");
const m = new Map();
for (const f of outSet) m.set(kind(f.rel), (m.get(kind(f.rel)) ?? 0) + 1);
console.log(`图外这批按档：${[...m].map(([k, v]) => `${k}=${String(v)}`).join(" ")}`);
const days = (ms) => ((Date.now() - ms) / 86400000).toFixed(1);
console.log(`图外最"新"的那个文件是 ${days(outSet[0].mtimeMs)} 天前改的；入图最"旧"的是 ${days(sorted[inSet.size - 1].mtimeMs)} 天前`);
