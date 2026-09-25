/** 两份全量 log 的判卷对账（第 86 页）：同一套判卷面，HEAD 树与主树各跑一次，按文件比结论并**当场归因**。
 *
 * 用法：
 *   node --import tsx outputs/two-tree-judge-diff-2026-09-26/01-report.mts \
 *     --head-log=/tmp/dsh-head-cert-<sha>/test.log --disk-log=/tmp/main-test.log
 * 取 log 的正规路子是 `node --import tsx scripts/head-cert.ts`（它自己核切树成功与依赖完整）；
 * 本脚本**故意不起进程、不跑门**——两把尺各抄一份取料迟早漂出两套口径（规则 113 那一族）。
 *
 * 为什么值得有：本线程 HEAD 上那 5 条已提交红灯里 3 条是我造的，全靠事后开隔离树才发现。
 * 这个面对账把"会不会随提交进 HEAD"变成提交前就能读到的一行，并且每行带着 git 状态 ⇒ 归因不用二次查。
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { diffVerdicts, greenCount, HOW_TO_READ, parseFileVerdicts, stripAnsi, type DiffRow } from "../../scripts/lib/judge-verdict-diff";
import { attributeInputs } from "../../scripts/lib/judge-input-face";
import { buildGraph } from "../../scripts/lib/reach-graph";

const argv = process.argv.slice(2);
const opt = (name: string, dflt: string): string => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? dflt : hit.slice(name.length + 3);
};
const HEAD_LOG = opt("head-log", "");
const DISK_LOG = opt("disk-log", "");
const MAIN = opt("main", ".");

const read = (p: string): string | null => {
  try { return readFileSync(p, "utf8"); } catch { return null; }
};
if (HEAD_LOG === "" || DISK_LOG === "") {
  console.error("两个参数都得给：--head-log=<HEAD 树的全量输出> --disk-log=<主树的全量输出>");
  process.exit(2);
}
const headText = read(HEAD_LOG);
const diskText = read(DISK_LOG);
if (headText === null || diskText === null) {
  console.error(`读不到 log（${headText === null ? HEAD_LOG : ""} ${diskText === null ? DISK_LOG : ""}）⇒ 没尺，退出`);
  process.exit(2);
}
// 自检一：每份 log 都得有 `Test Files` 汇总行——没有就是**那次跑本身没跑完**，不许当成"两侧都没红"。
const unfinished = [[HEAD_LOG, headText], [DISK_LOG, diskText]].filter(([, t]) => !stripAnsi(t).includes("Test Files")).map(([p]) => p);
if (unfinished.length > 0) {
  console.error("这些 log 里没有 `Test Files` 汇总行 ⇒ 那次跑没结束/被截断，读数不算数：\n  " + unfinished.join("\n  "));
  process.exit(2);
}

const head = parseFileVerdicts(headText);
const disk = parseFileVerdicts(diskText);
// 自检二：抽不出任何文件行＝取料形状不对（同规则 180：抽取器与真值必须各量一次）。
if (head.size < 20 || disk.size < 20) {
  console.error(`抽出的文件数小得可疑（HEAD ${String(head.size)} / 盘 ${String(disk.size)}）⇒ 抽取器对不上当场日志，不出结论`);
  process.exit(2);
}

const porcelain = execFileSync("git", ["status", "--porcelain"], { cwd: MAIN, encoding: "utf8" });
/** porcelain v1 是**定列**格式：`XY<空格>路径`。
 *  用 `(\S{2})\s+` 去匹会把 ` M x`／` D x` 这类"第一位是空格"的行整条丢掉
 *  （实测：改完这段后 50 条删除项的 git 列全变成了"无在飞改动"＝join 键断掉，读数一片干净但没人垫）。 */
function parsePorcelain(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (line.length < 4) continue;
    const xy = line.slice(0, 2).trim() || "?";
    let p = line.slice(3).trim();
    const arrow = p.indexOf(" -> ");
    if (arrow >= 0) p = p.slice(arrow + 4);
    if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1); // git 会把非 ASCII 路径整体加引号（内含八进制转义）
    out.set(p, xy);
  }
  return out;
}
const pathState = parsePorcelain(porcelain);
// 自检三：解析不许**丢行**（上面那条 bug 就是整类 ` M`/` D` 被正则丢掉，join 键当场断）。
const porcelainLines = porcelain.split("\n").filter((l) => l.trim() !== "").length;
if (pathState.size !== porcelainLines) {
  console.error(`porcelain ${String(porcelainLines)} 行只解析出 ${String(pathState.size)} 条 ⇒ 取料断在解析这一步，不出结论`);
  process.exit(2);
}
const inFlight = new Set(pathState.keys());
const stateOf = (file: string): string => pathState.get(file) ?? "在 HEAD 里、无在飞改动";
/** 第二跳归因用：这条判卷面**读的那些面**里有哪些在飞。图只收 src/tests/scripts 的 .ts，
 *  收不到的那一路（把目标当文本读、或读 docs/**）由路径字面量那把尺补，且两条尺的来路都印出来。 */
const graph = buildGraph(MAIN, ["src", "tests", "scripts"]);
const textOf = (file: string): string | null => {
  try { return readFileSync(join(MAIN, file), "utf8"); } catch { return null; }
};
const ATTRIBUTED: ReadonlySet<DiffRow["kind"]> = new Set<DiffRow["kind"]>(["只在 HEAD 红", "只在盘上红", "两棵都红"]);

const rows = diffVerdicts(head, disk);
const tally = new Map<DiffRow["kind"], number>();
for (const r of rows) tally.set(r.kind, (tally.get(r.kind) ?? 0) + 1);
console.log(`取料：HEAD 树 ${String(head.size)} 个判卷文件 ／ 主树 ${String(disk.size)} 个；两侧都绿 ${String(greenCount(head, disk))} 个；有差异 ${String(rows.length)} 行\n`);
for (const kind of ["只在盘上红", "只在 HEAD 红", "两棵都红", "只在 HEAD 有", "只在盘上有", "两棵都绿"] as const) {
  const bucket = rows.filter((r) => r.kind === kind);
  if (kind === "两棵都绿" || bucket.length === 0) continue;
  console.log(`【${kind}】${String(bucket.length)} 条 —— ${HOW_TO_READ[kind]}`);
  for (const r of bucket) {
    console.log(`   ${r.file}｜HEAD: ${r.headCounts || "—"}｜盘: ${r.diskCounts || "—"}｜git: ${stateOf(r.file)}`);
    if (!ATTRIBUTED.has(r.kind)) continue;
    // 第二跳：这条判卷面**读的那些面**里有谁在飞——没有这一行，读数的人只能看见"该文件自己没改"，
    // 而"盘上绿／HEAD 红"常常是别的未提交文件垫的（第 86 页 §三 记的限制）。
    const attr = attributeInputs(r.file, { graph, text: textOf(r.file), inFlight });
    for (const h of attr.hits) console.log(`        ↳ 在飞取料：${h.file}（${h.via}；它自己的 git=${stateOf(h.file)}）`);
    if (attr.hits.length === 0 || !attr.note.startsWith("含 import")) console.log(`        ↳ ${attr.note}`);
  }
  console.log("");
}
const mustFix = rows.filter((r) => r.kind === "只在盘上红");
console.log(mustFix.length === 0
  ? "⇒ 没有『只在盘上红』的判卷面：本次在飞改动不会给 HEAD 留新红灯。"
  : `⇒ 有 ${String(mustFix.length)} 条『只在盘上红』：**逐条归因前不要提交**（` + mustFix.map((r) => r.file).join("、") + "）");
process.exit(mustFix.length === 0 ? 0 : 1);
