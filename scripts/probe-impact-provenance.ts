// 任务 #9 的现读：波及面（impact）今天**按名字图**算调用方，精确边能把它收紧多少、会掉多少真边？
//
// 为什么先量再动手（本仓的规矩：便宜读数排最前，它经常反转方向）：
// 第 300 页给符号地图接上 import 精确边时，`impact/index.ts` **刻意没接**——它自己按
// 「同名即引用」建 refs（`addSites(refs, t.name, …)`），把精确边混进去会静默改掉波及面精度。
// 而它已经把自己的病写在文案里了：「一个 `private readFile` 吸进 107 个文件的同名 ref」。
//
// ⚠️ 第一版这里只量了「按 import 收紧」一种切法，跑完才发现**夹具早就把口径登记死了**
// （`fixtures/impact/accuracy-repo/ground-truth.json` 的 note，2026-10-01 人工核对）：
//   「def/ref 按名字连边、**不采 import**——同名定义的调用点按合同连到全部两份定义，**不算假阳性**」
// 那个夹具是全局脚本形状的仓库（`api.js` 直接 call `slugify`，压根没有 import 语句）⇒
// 「按 import 收紧」会把它的 16 条真值边全删掉。所以这一版把**四种**收紧法各数一遍，
// 并且同时对着那个夹具跑一次「会掉几条真值边」——安全的那一种才是能买的。
//
// 四种切法（都只在「跨文件 (ref→def) 对」这一层做减法）：
//   B 文件级：ref 文件 import 了 def 文件；
//   C 名字级：那个名字真的出现在 ref 文件对 def 文件的 import 子句里；
//   D 本地自有定义：ref 文件**自己也 def 了那个名字** ⇒ 它那一处多半是在用自己的，不该记到别人头上；
//   E 名字绑在别处：ref 文件把那个名字从**第三个文件** import 进来 ⇒ 同理，与 def 文件无关。
// D/E 是「负面证据」型规则：它们只在**有证据表明这处引用另有归属**时才摘边，
// 全局脚本仓库里既没有本地同名定义也没有 import ⇒ 一条边都不会掉。这才是与夹具口径相容的那一类。
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { scanSourceFilesAll } from "../src/agent/map/build";
import { fileSymbols } from "../src/agent/map/parse";
import { resolveModuleSpecifier } from "../src/agent/map/import-edge";
import { attributableToDef, buildImpact, contextNoteFor, fileImpact, upward } from "../src/agent/impact/index";

const REPO = resolve(import.meta.dirname, "..");

interface Row {
  rel: string;
  defs: Set<string>;
  refs: Set<string>;
  importsFile: Set<string>;
  importedNames: Map<string, Set<string>>;
  /** 名字 → 该名字被 import 进来的来源文件（用于 E 与「另有归属」判断）。 */
  boundFrom: Map<string, string[]>;
}

const SUPPORTED = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/u;

function listFiles(absDir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (SUPPORTED.test(e.name)) out.push(relative(absDir, p).split(sep).join("/"));
    }
  };
  walk(absDir);
  return out.sort();
}

async function buildRows(absDir: string, rels: string[]): Promise<Row[]> {
  const known = new Set(rels);
  const rows: Row[] = [];
  for (const rel of rels) {
    const ext = rel.slice(rel.lastIndexOf(".") + 1).toLowerCase();
    const sym = await fileSymbols(readFileSync(join(absDir, rel), "utf8"), ext);
    const defs = new Set<string>(), refs = new Set<string>();
    for (const t of sym.tags) (t.kind === "def" ? defs : refs).add(t.name);
    const importsFile = new Set<string>();
    const importedNames = new Map<string, Set<string>>();
    const boundFrom = new Map<string, string[]>();
    for (const ir of sym.imports) {
      // 这里**不**剔 `typeOnly`：波及面里改一个类型也会波及导入方，
      // 与地图排名那一档「类型边不入图」的裁决（09-23）刻意不同——两面问的不是同一件事。
      // 外部包（`node:fs`）解不出仓内目标，但**它同样是"另有归属"的证据**，所以 boundFrom 记 "⬦external"。
      const target = resolveModuleSpecifier(rel, ir.spec, known);
      if (target) {
        importsFile.add(target);
        if (!importedNames.has(target)) importedNames.set(target, new Set());
        importedNames.get(target)!.add(ir.name);
      }
      if (!boundFrom.has(ir.name)) boundFrom.set(ir.name, []);
      boundFrom.get(ir.name)!.push(target ?? `external:${ir.spec}`);
    }
    rows.push({ rel, defs, refs, importsFile, importedNames, boundFrom });
  }
  return rows;
}

function indexDefs(rows: Row[]): Map<string, string[]> {
  const defFiles = new Map<string, string[]>();
  for (const r of rows) for (const d of r.defs) {
    if (!defFiles.has(d)) defFiles.set(d, []);
    defFiles.get(d)!.push(r.rel);
  }
  return defFiles;
}

/** 四个计数器：A＝今天的名图对数；B/C/D/E 各是"会被那种切法摘掉"之外的存活数。 */
function count(rows: Row[]) {
  const defFiles = indexDefs(rows);
  let A = 0, B = 0, C = 0, D = 0, E = 0;
  for (const ref of rows) {
    for (const symName of ref.refs) {
      for (const defFile of defFiles.get(symName) ?? []) {
        if (defFile === ref.rel) continue;
        A++;
        if (ref.importsFile.has(defFile)) B++;
        if (ref.importedNames.get(defFile)?.has(symName) ?? false) C++;
        if (!ref.defs.has(symName)) D++; // 本地没有同名定义
        const bound = ref.boundFrom.get(symName) ?? [];
        // E：这名字被明确绑到了**另一个来源**（第三方文件或外部包）⇒ 它在这一处的用法与 defFile 无关。
        //     没绑（全局脚本形状的仓库里 `slugify` 谁也没 import）就是"无证据"，按夹具口径**照旧连边**。
        if (!bound.some((s) => s !== defFile)) E++;
      }
    }
  }
  return { A, B, C, D, E };
}

// ---- ① 真仓 ----
const repoFiles = await scanSourceFilesAll(REPO);
const repoRels = repoFiles.map((f) => f.rel);
const repoRows = await buildRows(resolve(REPO), repoRels);
const n = count(repoRows);
const pct = (x: number, d: number) => (d === 0 ? "n/a" : `${((x / d) * 100).toFixed(1)}%`);
console.log(`[impact-provenance] 真仓：解析 ${String(repoRows.length)} 个文件（取料面＝地图那一支 scanSourceFilesAll，帽前全量）`);
console.log(`  A 名字图（今天 impact 的算法）(ref→def) 对数 = ${String(n.A)}`);
console.log(`  B 文件级 import 成立 = ${String(n.B)}（${pct(n.B, n.A)}）⇒ 这种切法摘掉 ${String(n.A - n.B)} 对（${pct(n.A - n.B, n.A)}）`);
console.log(`  C 名字级 import 成立 = ${String(n.C)}（${pct(n.C, n.A)}）⇒ 摘掉 ${String(n.A - n.C)} 对（${pct(n.A - n.C, n.A)}）`);
console.log(`  D 「ref 文件自己没有同名定义」 = ${String(n.D)}（${pct(n.D, n.A)}）⇒ 负面证据切法摘掉 ${String(n.A - n.D)} 对（${pct(n.A - n.D, n.A)}）`);
console.log(`  E 「名字没被绑到第三方」 = ${String(n.E)}（${pct(n.E, n.A)}）⇒ 摘掉 ${String(n.A - n.E)} 对（${pct(n.A - n.E, n.A)}）`);

// 同名大户：单一定义点、名图 ≥8 个引用方（页面那条 `readFile` 吸 107 个文件的形状）
const defFiles = indexDefs(repoRows);
const hubs: { sym: string; def: string; nameUnion: number; fileLevel: number; selfDef: number; boundElsewhere: number }[] = [];
for (const [sym, defs] of defFiles) {
  if (defs.length !== 1) continue;
  const def = defs[0]!;
  let nameUnion = 0, fileLvl = 0, withSelfDef = 0, elsewhere = 0;
  for (const ref of repoRows) {
    if (ref.rel === def || !ref.refs.has(sym)) continue;
    nameUnion++;
    if (ref.importsFile.has(def)) fileLvl++;
    if (ref.defs.has(sym)) withSelfDef++;
    const bound = ref.boundFrom.get(sym) ?? [];
    if (bound.length > 0 && bound.some((s) => s !== def)) elsewhere++;
  }
  if (nameUnion >= 8) hubs.push({ sym, def, nameUnion, fileLevel: fileLvl, selfDef: withSelfDef, boundElsewhere: elsewhere });
}
hubs.sort((a, b) => b.nameUnion - a.nameUnion);
console.log(`  同名大户（单一定义点且名图 ≥8；selfDef＝引用方自己也 def 了这名字；elsewhere＝引用方把这名字从别处 import 进来）：`);
for (const h of hubs.slice(0, 12)) {
  console.log(`    ${h.sym.padEnd(24)} 定义=${h.def.padEnd(34)} 名图=${String(h.nameUnion).padStart(4)} 文件级=${String(h.fileLevel).padStart(4)} 自带同名=${String(h.selfDef).padStart(4)} 另有归属=${String(h.boundElsewhere).padStart(4)}`);
}

// ---- ② 同一套切法对着**冻结夹具**跑一遍：哪一种会掉真值边 ----
const fxDir = resolve(REPO, "fixtures/impact/accuracy-repo");
const truth = JSON.parse(readFileSync(join(fxDir, "ground-truth.json"), "utf8")) as {
  note: string; edgeCount: number; edges: { from: string; to: string; symbol: string }[];
};
const fxRels = listFiles(fxDir).filter((r) => r !== "ground-truth.json");
const fxRows = await buildRows(fxDir, fxRels);
const fxByRel = new Map(fxRows.map((r) => [r.rel, r]));
let keepB = 0, keepC = 0, keepD = 0, keepE = 0;
const lostB: string[] = [], lostD: string[] = [], lostE: string[] = [];
for (const e of truth.edges) {
  const ref = fxByRel.get(e.from);
  if (!ref) continue;
  if (ref.importsFile.has(e.to)) keepB++; else lostB.push(`${e.from}→${e.to}(${e.symbol})`);
  if (ref.importedNames.get(e.to)?.has(e.symbol) ?? false) keepC++;
  if (!ref.defs.has(e.symbol)) keepD++; else lostD.push(`${e.from} 自己也 def ${e.symbol}`);
  const bound = ref.boundFrom.get(e.symbol) ?? [];
  if (!(bound.length > 0 && bound.some((s) => s !== e.to))) keepE++; else lostE.push(`${e.from} 把 ${e.symbol} 绑在 ${bound.join("/")}`);
}
const tN = truth.edges.length;
console.log(`[impact-provenance] 冻结夹具 accuracy-repo（真值 ${String(tN)} 条边，note 自己写着「按名字连边、不采 import」）：`);
console.log(`  B 文件级 import 存活 ${String(keepB)}/${String(tN)}；C 名字级存活 ${String(keepC)}/${String(tN)}`);
console.log(`  D 「引用方自带同名定义才摘」存活 ${String(keepD)}/${String(tN)}${lostD.length ? ` ⇒ 摘掉：${lostD.slice(0, 6).join("、")}` : " ⇒ 一条不掉"}`);
console.log(`  E 「名字被绑到第三方才摘」存活 ${String(keepE)}/${String(tN)}${lostE.length ? ` ⇒ 摘掉：${lostE.slice(0, 6).join("、")}` : " ⇒ 一条不掉"}`);

const problems: string[] = [];
// ---- ③ 生产面自证：判据接上没有？（读 `buildImpact` 自己带的三态计数，不是探针再算一遍）----
// 这一格是"生产者与消费者同一决策点"的证据：探针算的 E 与图上带的计数必须都能非零，
// 否则说明生产那条支根本没吃到判据（本仓反复判死的「算出来不接」）。
// 帽＝**生产缺省**（`IMPACT_MAX_FILES_DEFAULT`＝5000，本仓 593 个候选 ⇒ 实际全量）。
// 为什么不能用小帽量这一格：第一版这里写的是 `maxFiles: 400`，于是 `writeFile` 的那份定义
// （`tests/secrets.test.ts`，mtime 排在 400 名之外）根本不在图里 ⇒ 定义点=0 ⇒ 规则**看着**一处没摘，
// 读数把"图里没有这个名字的定义"错读成"这条规则对这个名字无效"（一片 0 先怀疑量法）。
const prod = await buildImpact({ workspace: REPO });
console.log(`[impact-provenance] 生产面（buildImpact 直调，帽＝生产缺省 ${String(prod.cap)} → 图内 ${String(prod.files.length)} 文件／帽前候选 ${String(prod.candidates)}）：`);
console.log(`  图上三态计数 kept=${String(prod.attribution.kept)} dropped=${String(prod.attribution.dropped)} noEvidence=${String(prod.attribution.noEvidence)}`);
// 同分母 A/B（本仓规矩：收益结论必须有「同一张图、只换一个输入」的两臂，不然「次数×单位时长」只是模型）：
// B 臂＝把 `nameSources` 换成空表后**再走同一个 `upward`**——那正是接这一维之前的行为
// （无证据 ⇒ 一律保守计入），不是探针按老算法另算一遍。
const bare = { ...prod, nameSources: new Map<string, Map<string, string[]>>() };
console.log(`  同名大户清单（A＝接判据后，B＝同一张图抹掉取料面＝接之前的名字图行为）：`);
for (const sym of ["writeFile", "readFile", "createEventLog", "runLoop"]) {
  const a = upward(prod, sym);
  const b = upward(bare, sym);
  const fa = new Set(a.map((s) => s.file)).size;
  const fb = new Set(b.map((s) => s.file)).size;
  const defs = new Set((prod.defs.get(sym) ?? []).map((d) => d.file)).size;
  console.log(`    ${sym.padEnd(16)} 定义点=${String(defs).padStart(3)}  A ${String(a.length).padStart(3)} 处／${String(fa).padStart(3)} 文件  ←  B ${String(b.length).padStart(3)} 处／${String(fb).padStart(3)} 文件  ⇒ 掉 ${String(fb - fa)} 个文件`);
}
/* ── 第 326 页 · #19 的读数：`upward` 的并集口径 vs「点名要改哪一份定义」的逐份口径 ──
 * 现态：`upward` 问的是"任一份同名定义归得上吗"（并集），而 `downward` 逐份判——那边的注释自己写着
 *   「不能像 upward 那样任一命中即留」。读端 `impact_query` 的 file 作用域那一支**知道**自己在看哪一份定义，
 *   拿到的却是并集。同一把判据两种宽度＝第十三族。这里**不改口径**，只量三件事：
 *   ① 多定义符号上，并集比最宽那份多留几处（＝点名定义最多能省下的假阳性）；
 *   ② 那些"留下来"的地方靠的是什么证据（有正证／全靠没证据）——若全靠没证据，收窄一分钱收益都没有；
 *   ③ 冻结夹具的真值边按逐份口径必须**一条不许掉**（#9 登记的硬前提），掉了就不许改。 */
{
  let syms = 0, unionSites = 0, widestSites = 0, evidenceKept = 0, noEvOnly = 0;
  const movers: string[] = [];
  for (const [sym, ds] of prod.defs) {
    const defFiles = [...new Set(ds.map((d) => d.file))];
    if (defFiles.length < 2) continue;
    const refs = (prod.refs.get(sym) ?? []).filter((r) => !defFiles.includes(r.file));
    if (refs.length === 0) continue;
    syms++;
    let u = 0, ek = 0, ne = 0, w = 0;
    for (const r of refs) {
      const verdicts = defFiles.map((d) => attributableToDef(prod, r.file, sym, d));
      if (verdicts.some((v) => v !== "dropped")) u++;
      if (verdicts.some((v) => v === "kept")) ek++;
      if (verdicts.every((v) => v === "no-evidence")) ne++;
    }
    for (const d of defFiles) w = Math.max(w, refs.filter((r) => attributableToDef(prod, r.file, sym, d) !== "dropped").length);
    unionSites += u; widestSites += w; evidenceKept += ek; noEvOnly += ne;
    if (u - w >= 3) movers.push(`${sym.padEnd(20)} 定义 ${String(defFiles.length)} 份｜并集留 ${String(u)} 处｜最宽那份 ${String(w)} 处 ⇒ 点名能省 ${String(u - w)}`);
  }
  console.log(`  逐份口径 vs 并集口径（只看「≥2 份同名定义且有外部引用」的符号，共 ${String(syms)} 个）：`);
  console.log(`    并集留 ${String(unionSites)} 处｜最宽那份留 ${String(widestSites)} 处 ⇒ 点名定义最多能省 ${String(unionSites - widestSites)} 处（${unionSites === 0 ? "没有分母" : Math.round((unionSites - widestSites) * 1000 / unionSites) / 10 + "%"}）`);
  console.log(`    留下的那些靠什么：有正证（kept）${String(evidenceKept)} 处｜**全靠没证据** ${String(noEvOnly)} 处 ⇒ 全靠没证据的占比越高，收窄越没有收益`);
  for (const m of movers.slice(0, 8)) console.log(`    ${m}`);
  // 夹具：逐份口径下真值边一条不许掉（#9 的硬前提）。取料走生产端同一个 builder，不自己搭图。
  const fxGraph = await buildImpact({ workspace: fxDir });
  let fxKept = 0, fxDropped: string[] = [];
  for (const e of truth.edges) {
    if (attributableToDef(fxGraph, e.from, e.symbol, e.to) !== "dropped") fxKept++; else fxDropped.push(`${e.from}→${e.to}(${e.symbol})`);
  }
  console.log(`  冻结夹具按**逐份**口径判：真值边存活 ${String(fxKept)}/${String(tN)}${fxDropped.length ? ` ⇒ 摘掉：${fxDropped.slice(0, 6).join("、")}` : " ⇒ 一条不掉"}`);
  if (fxKept !== tN) problems.push(`夹具在逐份口径下掉了 ${String(tN - fxKept)} 条真值边 ⇒ #19 的收窄**不许做**（#9 的硬前提）`);
  if (syms === 0) problems.push("一个「≥2 份同名定义」的符号都没数到 ⇒ 上面那行读数没有分母，先怀疑量法而不是宣布没有差值");
  // 自证（分辨力）：三态各造一个输入，全都同答＝这把尺恒真。
  const ns0 = new Map<string, string[]>();
  ns0.set("f", ["b.ts"]);
  const g0 = { nameSources: new Map<string, Map<string, string[]>>([["x.ts", ns0]]) } as unknown as Parameters<typeof attributableToDef>[0];
  const probeOk = attributableToDef(g0, "x.ts", "f", "b.ts") === "kept"
    && attributableToDef(g0, "x.ts", "f", "a.ts") === "dropped"
    && attributableToDef(g0, "y.ts", "f", "a.ts") === "no-evidence";
  console.log(`  ${probeOk ? "✅" : "❌"} 自证：同一份判据对「正证／反证成立／没有那张表」三态各给一个值（${probeOk ? "三态分开" : "有态被合并 ⇒ 上面所有数作废"}）`);
  if (!probeOk) problems.push("逐份判据三态不分 ⇒ 它退化成布尔，本段读数全部作废");
}
// 模型实际看见的那一句（读端 `fileImpact` → `contextNoteFor`，不抄文案、直接调生产函数）。
for (const rel of ["src/agent/ledger.ts", "src/agent/impact/index.ts"]) {
  const rep = await fileImpact(REPO, rel);
  console.log(`  注入句（编辑 ${rel}）：${rep === null ? "（图外，不发事件）" : contextNoteFor(rep)}`);
}
if (prod.attribution.kept === 0) problems.push("生产面 kept=0 ⇒ 边构造根本没走判据（接线断了），上面的读数全部作废");
if (prod.attribution.dropped === 0) problems.push("生产面 dropped=0 ⇒ 判据算出来没接（探针自己数到反证），「算出来不接」那一族");
if (problems.length === 0 && n.A === 0) problems.push("真仓 A=0 ⇒ 取料面没吃到东西，所有比例不可引用");
if (hubs.length === 0) problems.push("一个「同名吸 ≥8」的定义点都数不到 ⇒ 与页面既有读数（readFile 吸 107 个文件）矛盾，先怀疑量法");
if (tN === 0) problems.push("夹具真值边数为 0 ⇒ 夹具校验没跑起来");
if (!(n.B <= n.A && n.C <= n.B)) problems.push(`单调性破了：A=${String(n.A)} B=${String(n.B)} C=${String(n.C)}`);
console.log(problems.length === 0
  ? "[impact-provenance] 自检 ✅ 真仓取到数、数到同名大户、夹具真值面也跑到了 ⇒ 上面所有数可以引用"
  : "[impact-provenance] 自检 ❌ " + problems.join("；"));
if (problems.length > 0) process.exit(1);
