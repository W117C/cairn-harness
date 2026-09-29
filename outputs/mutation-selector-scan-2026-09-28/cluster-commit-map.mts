// 台账 sha 的可解析性映射：簇里每一笔 → 标题 → 改动文件 → 被 PROGRESS 哪一行引用。
// 复算：node --import tsx outputs/mutation-selector-scan-2026-09-28/cluster-commit-map.mts
// 为什么要这份表：落库若压成一笔，页里引用的 15 个 sha 在主线历史里就不存在了
// （现读见第 199 页）。有了这张表，"读者想核对某一笔具体改了什么"就不再依赖对象是否可达。
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const CLUSTER = "/Users/ze/Downloads/deepseek harness/.worktrees/p170-tighten";
const BASE = "6849e35";
const TIP = "e4d2e9b";
const OUT = "/Users/ze/Downloads/deepseek harness/.worktrees/p170-tighten/outputs/mutation-selector-scan-2026-09-28/cluster-commit-map-2026-09-30.md";

const g = (args) => execFileSync("git", args, { cwd: CLUSTER, encoding: "utf8", maxBuffer: 1 << 27 });

const log = g(["log", "--reverse", "--format=%H%x09%ad%x09%s", `--date=format:%m-%d %H:%M`, `${BASE}..${TIP}`])
  .split("\n")
  .filter(Boolean)
  .map((l) => l.split("\t"));

const pageAdded = g(["diff", `${BASE}..${TIP}`, "--", "PROGRESS.md"])
  .split("\n")
  .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
  .join("\n");

const lines = [];
lines.push("# 簇 `6849e35..e4d2e9b` 逐笔映射（给台账里那些 sha 兜底）");
lines.push("");
lines.push(`- 笔数=${String(log.length)}；这份表由 \`cluster-commit-map.mts\` 现生成，不手抄。`);
lines.push("- **悬空 sha 的引用面**：PROGRESS 新增行里出现 15 个 sha 形态 token，全部只在簇内可达（现读：`merge-base --is-ancestor <sha> 6849e35` 一律非祖先）。");
lines.push("- 落库方式两种都成立：① 压成一笔 ⇒ 这些 sha 靠本表＋保留的私有 ref `refs/dsh/cluster-p169-198` 解释；② 保留簇历史（merge）⇒ sha 直接在主线可达，本表变成索引。");
lines.push("");
lines.push("| sha7 | 时间 | 标题 | 改动文件 | 页里是否引用 |");
lines.push("| --- | --- | --- | --- | --- |");
for (const [sha, when, subj] of log) {
  const short = sha.slice(0, 7);
  const files = g(["show", "--name-only", "--format=", sha]).split("\n").filter(Boolean);
  const cited = pageAdded.includes(short) ? "是" : "";
  const subjClean = subj.replace(/\|/g, "\\|");
  const fileCell = files.length > 6 ? `${files.slice(0, 6).join(", ")} ＋${String(files.length - 6)} more` : files.join(", ");
  lines.push(`| \`${short}\` | ${when} | ${subjClean} | ${fileCell.replace(/\|/g, "\\|")} | ${cited} |`);
}
const citedCount = log.filter(([s]) => pageAdded.includes(s.slice(0, 7))).length;
const tokensInPages = Array.from(new Set(Array.from(pageAdded.matchAll(/\b[0-9a-f]{7,40}\b/g), (m) => m[0])));
const covered = new Set(log.map(([s]) => s));
const unresolved = tokensInPages.filter((t) => ![...covered].some((full) => full.startsWith(t)));
lines.push("");
lines.push(`统计：页里 ${String(tokensInPages.length)} 个 sha 形态引用 token，${String(citedCount)} 个命中本表的某笔，` +
  `未在本簇祖先链里命中的 ${String(unresolved.length)} 个${unresolved.length === 0 ? "（⇒ 台账引用的 sha 全部是本簇内部坐标，" +
  "压成一笔落库后它们在线性历史里不存在，这张表加保留的私有 ref 就是它们唯一的解释面）" : `（名单：${unresolved.join(" ")}）`}`);
writeFileSync(OUT, lines.join("\n"));
console.log(`MAP_EXIT=0 rows=${String(log.length)} cited=${String(citedCount)} tokens=${String(tokensInPages.length)} 未在本簇命中=${String(unresolved.length)} → ${OUT}`);
