/** 第 269 页的前置测量：未点名那 9 页／19 条读数，逐条问「原文到底还在不在盘上」。
 *  第 268 页的教训带进来两条：
 *  ⑴ 身份判据不能是子串——所以这里只认**生产严格式**（`sourcedReadings`：剥 ANSI ＋ `CRED_NUMBER_RES` 整句形状），
 *     与门上的口径同源，探针不另算一遍（规则 236）。
 *  ⑵ 我自己的探针日志会原样印出台账里的数 ⇒ 那种命中不算证人。所以每条命中按**文件种类**分层：
 *     `runner`＝命令输出归档（.log/.txt），只有这一类能当「原文还在盘上」；
 *     `probe`＝我写的脚本源码（.mts/.ts/.mjs），`doc`＝散文（.md）——都只报出来，不采信。
 *  取料面**排除 PROGRESS.md 自己**：凭证页不能拿自己的散文给自己的读数作证（规则 242/265 同一条理由）。
 *  两条哨兵先立起来（规则 242：一片 0 要先证明尺认得出非 0）：
 *     正哨＝`3422` 必须在 `outputs/cred-unnamed-dirs-2026-10-01/head-cert-2068d6c.log` 命中；
 *     负哨＝`987654`（这仓里不可能存在过的读数）必须 0 命中。两个哨值都不从台账抽。 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { credentialPages, sourcedReadings, CRED_UNNAMED_PAGE_CAP } from "../../scripts/docs-check.ts";

const ROOT = process.argv[2];
if (typeof ROOT !== "string" || ROOT === "") {
  console.error("用法：node --import tsx outputs/cred-unrecoverable-sweep-2026-10-01/sweep.mts <仓根>");
  process.exit(2);
}

type FaceKind = "runner" | "probe" | "doc";
const kind = (name: string): FaceKind | null => {
  if (name.endsWith(".log") || name.endsWith(".txt")) return "runner";
  if (name.endsWith(".mts") || name.endsWith(".mjs") || name.endsWith(".ts")) return "probe";
  if (name.endsWith(".md")) return "doc";
  return null;
};

/** 递归收 durable 文本；跳过依赖与验证树（那些不是这个仓的取料面）。 */
const walk = (dir: string, depth: number, acc: string[]): string[] => {
  if (depth > 4) return acc;
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === ".worktrees" || e === ".git") continue;
    const abs = join(dir, e);
    let st;
    try { st = statSync(abs); } catch { continue; }
    if (st.isDirectory()) walk(abs, depth + 1, acc);
    else if (st.isFile() && kind(e) !== null) acc.push(abs);
  }
  return acc;
};

const files: string[] = [];
for (const top of ["outputs", "docs"]) {
  const abs = join(ROOT, top);
  if (existsSync(abs)) walk(abs, 0, files);
}
files.push(join(ROOT, "PROGRESS.md"));   // 单独留着，只为了把它从证人物里点名排除（下面 filter）

const corpus = files.filter((f) => !f.endsWith("PROGRESS.md"));

/** 每个文件一次读、一次抽；命中表按「读数 → 文件」倒排，只留 runner 类当证人。 */
const hits = new Map<string, { runner: string[]; probe: string[]; doc: string[] }>();
let filesSwept = 0;
for (const f of corpus) {
  let text = "";
  try { text = readFileSync(f, "utf8"); } catch { continue; }
  filesSwept++;
  const rel = f.slice(ROOT.length + 1);
  const k = kind(f);
  if (k === null) continue;   // 证据面（evidence-typecheck）报的 TS7053：从前靠"外面已过滤"兜着，类型看不出来
  for (const num of sourcedReadings(text)) {
    const row = hits.get(num) ?? { runner: [], probe: [], doc: [] };
    row[k].push(rel);
    hits.set(num, row);
  }
}

const ledgerText = readFileSync(join(ROOT, "PROGRESS.md"), "utf8");
const unnamedPages = credentialPages(ledgerText).filter((p) => p.dirs.length === 0 && p.numbers.length > 0);
const readings = unnamedPages.flatMap((p) => p.numbers.map((n) => ({ page: p.key, num: n, title: p.title.slice(0, 34) })));

console.log(`取料面：扫 ${String(filesSwept)} 个 durable 文件（outputs/ ＋ docs/，PROGRESS.md 自己排除）`);

const pos = hits.get("3422")?.runner ?? [];
const neg = hits.get("987654");
console.log(`哨兵：正（3422）runner 命中 ${String(pos.length)} 个文件${pos.length > 0 ? " ⇒ " + pos.join("、") : ""}｜负（987654）命中 ${String(neg === undefined ? 0 : neg.runner.length + neg.probe.length + neg.doc.length)} 个`);
if (pos.length === 0) {
  console.log("❌ 正哨没命中 ⇒ 这把尺扫不出严格式，下面所有「0 命中」都不成立");
  process.exit(1);
}
if (neg !== undefined) {
  console.log("❌ 负哨命中 ⇒ 取料面把不存在的读数也算进来了，下面所有结论作废");
  process.exit(1);
}

let noRunner = 0, withRunner = 0;
for (const r of readings) {
  const row = hits.get(r.num);
  const runner = row?.runner ?? [];
  const weak = [...(row?.probe ?? []), ...(row?.doc ?? [])];
  if (runner.length === 0) noRunner++; else withRunner++;
  console.log(`${runner.length === 0 ? "不可回查" : "在盘上   "}｜${r.page}｜读数 ${r.num}｜runner ${String(runner.length)} 个${runner.length > 0 ? "：" + runner.slice(0, 3).join("、") : ""}｜弱证（探针/散文，不采信）${String(weak.length)} 个${weak.length > 0 ? "：" + weak.slice(0, 3).join("、") : ""}`);
}
console.log(`小计：未点名 ${String(unnamedPages.length)} 页／${String(readings.length)} 条读数 ⇒ runner 类有原文 ${String(withRunner)} 条、真不可回查 ${String(noRunner)} 条`);
console.log(`帽：现读未点名页数 ${String(unnamedPages.length)} 对门上登记的 ${String(CRED_UNNAMED_PAGE_CAP)}（相等＝本页没让这一格涨，也不等于降）`);
