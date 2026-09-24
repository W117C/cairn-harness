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
const FACE_FROM = "2026-09-23";
/** 页目录的面：日期派生 + 目录内所有 `0*.md`（旧写法把面写死成"09-23 的目录里的一个文件名"，
 *  于是 09-24 起的整批页静默不在覆盖表里——正是本门反对的"面写死到名字上必漂"）。 */
const pages: string[] = [];
for (const n of readdirSync(OUT)) {
  const m = /^(.+)-(\d{4}-\d{2}-\d{2})$/.exec(n);
  if (!m || m[2] < FACE_FROM) continue;
  let names: string[] = [];
  try { names = readdirSync(join(OUT, n)); } catch { continue; }
  for (const f of names.sort()) if (/^0.*\.md$/.test(f)) pages.push(join(OUT, n, f));
}
pages.sort();

const shortPage = (dir: string): string => {
  // 页号优先读**页目录自带的 page.txt**（一行数字）——集中一张手抄 MAP 就是本文件注释自己点名的
  // "漏一行 ⇒ 整页判据静默不查"。09-23 的 16 页没有 page.txt，仍走下面的 MAP（ grandfathered，
  // 迁移到 page.txt 时这张表整条删掉，别留两份）。
  const own = read(join(OUT, dir, "page.txt")).trim();
  if (/^\d+$/.test(own)) return own;
  // 目录名里没有页号，必须显式映射（第一版用正则去抠，全抠成 "approved-s" 这种截断名 ⇒ 对齐失效）
  const MAP: Record<string, string> = {
    "stale-view-guard": "16", "side-effect-outcome": "17", "grading-surface-guard": "18",
    "instruction-provenance": "19", "projection-invariant": "20", "hollow-implementation": "21",
    "midrun-steering": "22", "observer-coverage": "23", "change-set-atomicity": "24",
    "verify-alignment": "25", "declared-surface-alignment": "26", "approved-scope-drift": "27",
    "claim-observability": "28", "self-contamination": "29", "anchor-resolvability": "30", "truncation-account": "31", "capability-program": "合册",
  };
  const key = dir.replace(/-\d{4}-\d{2}-\d{2}$/, "");
  const mapped = MAP[key];
  if (mapped === undefined) UNMAPPED.push(dir); // 本表自己就是一张"声明↔可达"面：漏一行 = 新页的判据静默不查
  return mapped ?? key;
};
const UNMAPPED: string[] = [];

/** 两类「必红」必须分开算，否则结论是假的：
 *  · today  = 「**现在就**必红」→ 断言的是**今天的世界**，必须有可跑谓词（本页管的就是这类）；
 *  · future = 「针 X 一摘就必须红 / 落地后不修就红」→ 断言的是**未来的测试行为**，
 *             今天无法验（只能登记成 needs-src，等施工时转正）。 */
const TODAY = /现在就必红|现在必红|今天必红|开门即红|开门之日|现在就红|现在就是红的|这条现在就必红/;

const docClaims: DocClaim[] = [];
const seenRow = new Set<string>();
/** 页目录的面：按**日期**派生（≥ 2026-09-23 的全部 dated 目录），页文件收目录内所有 `0*.md`。
 *  原先是 `/-2026-09-23$/` + 只读 `00-主张与判据.md` 一个文件名 ⇒ 09-24 起的整批页静默不在面上
 *  （本门自己的判据反对的正是这种"面写死到名字上"）。抽取语义（只认 §四 / `## 判据表` 段里的表行）不变。 */
for (const p of pages) {
  const dirName = p.split("/").slice(-2)[0];
  const body = read(p);
  // 全部匹配段都要扫：`find` 只取第一个 §四 ⇒ 同页后面另立「判据表」的写法会被静默忽略
  // （本轮加 09-24 页的判据表时就是这么踩到的：抽出来 0 行却 exit 0，一次假绿）。
  const secs = body.split(/^## /m).filter((s) => /^四[、\s]/.test(s) || /^判据表/.test(s));
  if (secs.length === 0) continue;
  for (const sec of secs) {
  for (const line of sec.split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").map((c) => c.trim()).filter((c) => c !== "");
    if (cells.length < 2) continue;
    const id = cells[0].replace(/\*\*/g, "");
    if (!/^C\d+|^D\d|^\d/.test(id) && !/^C/.test(id)) continue;
    const row = line.replace(/\*\*/g, "");
    if (!/必红|即红|当场红|立刻红|必须红/.test(row)) continue;
    const pg = shortPage(dirName); // 只调一次：调两次会往 UNMAPPED 里重复塞同一个目录（红字里名字打两遍，读数就不干净了）
    const pushed = `${pg}:${id}`;
    if (seenRow.has(pushed)) continue; // 同页两段（§四 与「判据表」）重复列同一条不重复计数
    seenRow.add(pushed);
    docClaims.push({ page: pg, id, claim: (cells[1] ?? "").slice(0, 40), file: dirName, kind: TODAY.test(row) ? "today" : "future" });
  }
  }
}

/** 已登记的 `{page, id}`：从 verify-claims.mts 里机器抽。 */
const reg = read(join(OUT, "claim-observability-2026-09-23/verify-claims.mts"));
const registered = new Set<string>();
/** 谓词登记表里出现过的页号：用来反查「这页有没有一行能被本机器抽到」（见文末 orphanRegistry）。 */
const registeredPages = new Set<string>();
for (const m of reg.matchAll(/page:\s*"(\d+)[^"]*",\s*id:\s*"([^"]+)"/g)) {
  registered.add(`${m[1]}:${m[2].split("/")[0]}`);
  registered.add(`${m[1]}:${m[2]}`);
  registeredPages.add(m[1]!);
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
/** 未映射页要分两类，否则"扩面"会变成把门跑红在别人没写判据表的目录上：
 *  · 该目录**确实抽到了判据行**却没页号 ⇒ 真红（判据会静默不查）；
 *  · 只是没有 §四/判据表 的页目录（含别人今天的页） ⇒ 只报不拦。 */
const claimDirs = new Set(docClaims.map((c) => c.file));
const unmappedFatal = UNMAPPED.filter((d) => claimDirs.has(d));
const unmappedQuiet = UNMAPPED.filter((d) => !claimDirs.has(d));
console.log(unmappedFatal.length === 0
  ? `   页号来源：page.txt 优先、09-23 的 16 页走 MAP；带判据行的目录全部有页号（漏一个就 exit 1）。`
  : `   ⚠️ **这些目录抽到了判据行却没有页号**（既无 page.txt 也不在 MAP 里）：${unmappedFatal.join(", ")} ⇒ 它们的判据进不了对齐，退出码已判红。`);
if (unmappedQuiet.length > 0) {
  console.log(`   ℹ️  另有 ${unmappedQuiet.length} 个 dated 页目录没有页号，但没抽到判据行（没写 §四/判据表，或措辞不含「必红」）：` +
    `${unmappedQuiet.join(", ")} —— 只报不拦；它们哪天写了判据表就会转成红。`);
}
/** 两台机器必须互相看得见，否则「抽 0 行」与「没有欠账」在输出里长得一模一样。
 *  反查方向：某页在 `verify-claims.mts` 里有可跑谓词，但本页的判据行**一条都没被抽到**
 *  ⇒ 上面那个对齐循环根本没机会处理它（谓词永远不进 `missing`/`covered`，登记形同没登记）。
 *  2026-09-24 实踩：第 44 页第一版把两条断言写成项目符号（不在 §四／`## 判据表` 段、不带「必红」），
 *  于是本机器对它抽 0 行并 exit 0 —— 写页的人以为已登记，实际两侧从没握过手。 */
const orphanRegistry = [...registeredPages].filter((p) => !byPage.has(p)).sort((a, b) => Number(a) - Number(b));
console.log(orphanRegistry.length === 0
  ? `   两侧握手：verify-claims 里出现过的 ${registeredPages.size} 个页号，全部能在对应页里抽到至少一条判据行。`
  : `   ⚠️ **这些页在 verify-claims 里登记了可跑谓词，但本机器从页里抽不到任何判据行**：${orphanRegistry.join(", ")} ⇒ ` +
    "登记与抽料两侧没握手，上面那行「无登记也无理由 0 条」对它们是**假的**（措辞/段落形状不合抽取器）。退出码已判红。");
process.exit(missing === 0 && unmappedFatal.length === 0 && orphanRegistry.length === 0 ? 0 : 1);
