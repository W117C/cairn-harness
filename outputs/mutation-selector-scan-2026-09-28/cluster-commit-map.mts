// 台账 sha 的可解析性映射：簇里每一笔 → 标题 → 改动文件 → 被 PROGRESS 哪一行引用。
// 复算：cd <仓根> && node --import tsx outputs/mutation-selector-scan-2026-09-28/cluster-commit-map.mts
// 也可 DSH_ROOT=<仓根绝对路径>。tip 不写死：现读私有 ref `refs/dsh/cluster-p169-199`（名字里的 199 是范围标签）。
// 为什么要这份表：落库若压成一笔，页里引用的那些 sha 在主线历史里就不存在了
// （现读见第 199 页）。有了这张表，"读者想核对某一笔具体改了什么"就不再依赖对象是否可达。
// 为什么 tip 改成现读：09-30 这张表落后历史 5 笔（表里 41 行、簇已 46 笔）——写死 TIP 的表一定会旧于它描述的历史。
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(process.env.DSH_ROOT ?? process.cwd());
const BASE = "6849e35";
const REF = "refs/dsh/cluster-p169-199";
const OUT = join(ROOT, "outputs/mutation-selector-scan-2026-09-28/cluster-commit-map-2026-09-30.md");

const g = (args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 27 });
const TIP = g(["rev-parse", REF]).trim();

const log = g(["log", "--reverse", "--format=%H%x09%ad%x09%s", `--date=format:%m-%d %H:%M`, `${BASE}..${TIP}`])
  .split("\n")
  .filter(Boolean)
  .map((l) => l.split("\t"));

const pageAdded = g(["diff", `${BASE}..${TIP}`, "--", "PROGRESS.md"])
  .split("\n")
  .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
  .join("\n");

const lines = [];
lines.push(`# 簇 \`6849e35..${TIP.slice(0, 7)}\` 逐笔映射（给台账里那些 sha 兜底）`);
lines.push("");
lines.push(`- 笔数=${String(log.length)}；这份表由 \`cluster-commit-map.mts\` 现生成（tip 现读 \`${REF}\`），不手抄、不写死。`);
lines.push("- **悬空 sha 的引用面**：PROGRESS 新增行里出现的 sha 形态 token 逐个查可达性（现读：`merge-base --is-ancestor <sha> <tip>`），" +
  "名单与命中数见表末统计行。**只有「不在本簇祖先链里、也不是主线提交」的那些才是悬空引用**——" +
  "表末名单里若出现本簇父提交或主线那笔（如 `6849e35`／`15fad7b`），它们落库后照样可达，不属于要兜底的那一批。");
lines.push("- 落库方式两种都成立：① 压成一笔 ⇒ 这些 sha 靠本表＋保留的私有 ref 解释；② 保留簇历史（merge）⇒ sha 直接在主线可达，本表变成索引。");
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
// 未命中的那些**分两档**，因为修法相反：主线可达的 sha 落库后照样查得到（不是问题）；
// 两边都不在的才是真悬空引用（要改文案或补进表里）。只报"未命中"会把前者读成缺陷。
const mainline = (sha) => {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", sha, "HEAD"], { cwd: ROOT, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
};
const dangling = unresolved.filter((t) => !mainline(t));
const onMainline = unresolved.filter((t) => mainline(t));
lines.push("");
lines.push(`统计：页里 ${String(tokensInPages.length)} 个 sha 形态引用 token，${String(citedCount)} 个命中本表的某笔，` +
  `未命中 ${String(unresolved.length)} 个——其中**主线可达** ${String(onMainline.length)} 个${onMainline.length > 0 ? `（${onMainline.join(" ")}＝本簇父提交/主线那笔，落库后仍能查到，不算悬空）` : ""}，` +
  `**真悬空** ${String(dangling.length)} 个${dangling.length === 0 ? "（⇒ 本表加保留的私有 ref 就覆盖了全部悬空引用；压成一笔落库后，簇内那些 sha 在线性历史里不存在，这张表是它们唯一的解释面）" : `（名单：${dangling.join(" ")}⇒ 要改文案或补进本表）`}`);
writeFileSync(OUT, lines.join("\n"));
console.log(`MAP_EXIT=0 rows=${String(log.length)} cited=${String(citedCount)} tokens=${String(tokensInPages.length)} 未在本簇命中=${String(unresolved.length)} → ${OUT}`);
