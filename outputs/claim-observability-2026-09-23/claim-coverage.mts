/** 能力 28 · 判卷断言的覆盖表（补 `00` §三 C1：「每页声称今天必红的断言都必须被登记」）
 *  为什么需要它：`verify-claims.mts` 里那 15 条是我**人工挑的**——
 *  「15 = 全集」这句话本身又没有观测者，正是这套东西反对的事。
 *  本脚本：从各页 §四 的表里**机器抽取**含「必红 / 即红」的行（=该页声称今天必红的判卷读数），
 *  再与 `verify-claims.mts` 里已登记的 `{page,id}` 对齐，逐页报缺口；
 *  未登记项**必须**在 UNREGISTERED 理由表里显式出现（带理由分类），否则 exit 1。
 *  跑法：TERM=dumb node --import tsx outputs/claim-observability-2026-09-23/claim-coverage.mts */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(ROOT, "outputs");
const read = (abs: string): string => (existsSync(abs) ? readFileSync(abs, "utf8") : "");

/** 各页 §四：抽「今天必红」的判卷行。 */
interface DocClaim { page: string; id: string; claim: string; file: string; kind: "today" | "future" }
const pages = readdirSync(OUT)
  .filter((n) => /-2026-09-23$/.test(n))
  .map((n) => join(OUT, n, "00-主张与判据.md"))
  .filter((p) => existsSync(p));

const shortPage = (dir: string): string => {
  // 目录名里没有页号，必须显式映射（第一版用正则去抠，全抠成 "approved-s" 这种截断名 ⇒ 对齐失效）
  const MAP: Record<string, string> = {
    "stale-view-guard": "16", "side-effect-outcome": "17", "grading-surface-guard": "18",
    "instruction-provenance": "19", "projection-invariant": "20", "hollow-implementation": "21",
    "midrun-steering": "22", "observer-coverage": "23", "change-set-atomicity": "24",
    "verify-alignment": "25", "declared-surface-alignment": "26", "approved-scope-drift": "27",
    "claim-observability": "28", "self-contamination": "29", "anchor-resolvability": "30", "truncation-account": "31", "capability-program": "合册",
  };
  const key = dir.split("-2026-09-23")[0];
  const mapped = MAP[key];
  if (mapped === undefined) UNMAPPED.push(key); // 本表自己就是一张"声明↔可达"面：漏一行 = 新页的判据静默不查
  return mapped ?? key;
};
const UNMAPPED: string[] = [];

/** 两类「必红」必须分开算，否则结论是假的：
 *  · today  = 「**现在就**必红」→ 断言的是**今天的世界**，必须有可跑谓词（本页管的就是这类）；
 *  · future = 「针 X 一摘就必须红 / 落地后不修就红」→ 断言的是**未来的测试行为**，
 *             今天无法验（只能登记成 needs-src，等施工时转正）。 */
const TODAY = /现在就必红|现在必红|今天必红|开门即红|开门之日|现在就红|现在就是红的|这条现在就必红/;

const docClaims: DocClaim[] = [];
for (const p of pages) {
  const dirName = p.split("/").slice(-2)[0];
  const body = read(p);
  const sec = body.split(/^## /m).find((s) => /^四[、\s]/.test(s));
  if (sec === undefined) continue;
  for (const line of sec.split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").map((c) => c.trim()).filter((c) => c !== "");
    if (cells.length < 2) continue;
    const id = cells[0].replace(/\*\*/g, "");
    if (!/^C\d+|^D\d|^\d/.test(id) && !/^C/.test(id)) continue;
    const row = line.replace(/\*\*/g, "");
    if (!/必红|即红|当场红|立刻红|必须红/.test(row)) continue;
    docClaims.push({ page: shortPage(dirName), id, claim: (cells[1] ?? "").slice(0, 40), file: dirName, kind: TODAY.test(row) ? "today" : "future" });
  }
}

/** 已登记的 `{page, id}`：从 verify-claims.mts 里机器抽。 */
const reg = read(join(OUT, "claim-observability-2026-09-23/verify-claims.mts"));
const registered = new Set<string>();
for (const m of reg.matchAll(/page:\s*"(\d+)[^"]*",\s*id:\s*"([^"]+)"/g)) {
  registered.add(`${m[1]}:${m[2].split("/")[0]}`);
  registered.add(`${m[1]}:${m[2]}`);
}

/** 未登记项的显式理由表（缺理由 = 红）。分类三档：
 *  needs-src    需要真改代码才能验（这条判据测的是未来的实现，不是今天的世界）
 *  needs-gate   需要一支门/脚本（尚未落地）
 *  covered-by   已被另一条登记项实质覆盖（指过去） */
const UNREGISTERED: Record<string, [string, string]> = {
  "20:C1/C2": ["covered-by", "谓词 20:C2/L0（跑真 projectContext 数孤儿）已覆盖 C1 的事实前提"],
  "18:C2": ["covered-by", "18:G2（frozenJudgePathSet(用户仓库)=0）覆盖同一条现状"],
  "30:C2": ["probe-only", "由 measure-anchor.mts ② 现场给数（173 条死锚）；门未接线前不把解析器复制第二份——那正是 30 页反对的同族出口副本"],
  "30:C3": ["probe-only", "同上：139/173 出自 outputs/ 的分布只在 ② 的一次扫描里成立，拆成独立谓词会造假双份"],
  "30:C4": ["probe-only", "同上：歧义 1042 条依赖 basename 索引，待 anchor-check 门接线后转正为门断言"],
  "31:C4": ["sample-too-small", "真语料里带截断提示的 result 只有 4 条，n=4 不足以立可跑谓词；页内已标「读数已有、不作判据主面」"],
};

let missing = 0, covered = 0, futureN = 0;
const todayN = () => docClaims.filter((x) => x.kind === "today").length;
console.log("页 / today 类（今天就必红，管退出码）与 future 类（未来测试才会红，只报）");
const byPage = new Map<string, DocClaim[]>();
for (const c of docClaims) byPage.set(c.page, [...(byPage.get(c.page) ?? []), c]);
for (const [page, list] of [...byPage.entries()].sort()) {
  const rows: string[] = [];
  for (const c of list) {
    if (c.kind === "future") { futureN++; rows.push(c.id + "=future"); continue; }
    const key = `${c.page}:${c.id}`;
    const isReg = [...registered].some((r) => r === key || r.startsWith(key + "/") || r.startsWith(key + "-"));
    if (isReg) { covered++; rows.push(`${c.id}=✓登记`); continue; }
    if (UNREGISTERED[key] !== undefined) { covered++; rows.push(`${c.id}=理由(${UNREGISTERED[key][0]})`); continue; }
    missing++; rows.push(`${c.id}=**无理由**`);
  }
  const t = list.filter((x) => x.kind === "today").length;
  console.log(`  ${page.padEnd(4)} today ${String(t).padStart(2)} / future ${String(list.length - t).padStart(2)}   ${rows.join("  ")}`);
}
console.log(`\ntoday 类合计 ${todayN()} 条（须有可跑谓词或显式理由）；future 类 ${futureN} 条（施工时才成立，只报不拦）。`);
console.log(`today 类里：已登记或有理由 ${covered} 条，**无登记也无理由 ${missing} 条**。`);
console.log(missing === 0
  ? "⇒ 每条 today 类断言都能追到一个可跑谓词或一条显式理由，不存在靠自觉覆盖的部分。"
  : "⇒ 缺口真实存在：那些行只是写在文档里，没有任何东西知道它们还成不成立。");
console.log("   ⚠️ 抽取边界（本门自己的盲区，未做语义解析）：靠行内「必红/即红/当场红」等措辞识别，");
console.log("      换措辞（只写『会红』『应红』）就漏抽；today/future 的分法同理，是措辞层的近似。");
console.log(UNMAPPED.length === 0
  ? `   页号映射表：${pages.length} 个目录全部在册（漏一行就会有整页判据静默不查）。`
  : `   ⚠️ **页号映射表漏项 ${UNMAPPED.length} 个**：${UNMAPPED.join(", ")} ⇒ 这些页的判据没进本门，退出码已判红。`);
process.exit(missing === 0 && UNMAPPED.length === 0 ? 0 : 1);
