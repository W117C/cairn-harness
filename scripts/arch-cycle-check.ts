// 架构环对账（A6／第 338 页）：把 intra-src **运行期 import** 图里的强连通分量与已登记的债对账。
//
// 跑法：
//   node --import tsx scripts/arch-cycle-check.ts                // 对账（新圈或假存量 ⇒ 退 1）
//   node --import tsx scripts/arch-cycle-check.ts --emit-debt    // 只印当前读数与可直接粘贴的登记字面量
//   node --import tsx scripts/arch-cycle-check.ts --include-tests // 把 tests/ 也拉进图（缺省只算 src/）
//
// 为什么缺省不含 `tests/`：这一格要守的是**运行期** TDZ 风险，而 tests 不会被产品路径加载 ⇒ 它不在
// 这条不变量的适用面里。**注意这不是"含了会炸出假圈"**——第 338 页实测 `--include-tests` 那一档
// 是 470 支／1113 条运行边／圈数仍然 1（登记的那一条），所以两档的差别只有分母，没有结论。
// `--include-tests` 的读数**单独印**、不并进同一张登记表（登记的是 src 面的水位，混档会让水位说不清）。
//
// 取料纪律（规则 236/237）：文件面用地图自己的 `scanSourceFilesAll`，解析用地图自己的
// `fileSymbols().imports` ＋ `resolveModuleSpecifier`——**不写第二份 import 正则**。
// 为什么不复用 `buildGraph` 的 `adj`：那张表把精确 import 边与同名全连兜底边混在一起（rank.ts ⑴ 支），
// 后者对「谁依赖谁」是假边；用它数圈会把同名不同实体当成互相依赖（正是 09-23 那条裁决清出去的东西）。
import { readFileSync } from "node:fs";
import { dirname, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fileSymbols, TreeSitterUnavailableError } from "./../src/agent/map/parse.js";
import { resolveModuleSpecifier } from "./../src/agent/map/import-edge.js";
import { scanSourceFilesAll } from "./../src/agent/map/build.js";
import { adjacencyOf, classifyCycles, cycleFindings, cycleSummary, stronglyConnectedComponents } from "./lib/arch-cycles.js";
import { RUNTIME_CYCLE_DEBT } from "./lib/arch-cycle-debt.js";

const ROOT = pathResolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const includeTests = argv.includes("--include-tests");
const emitDebt = argv.includes("--emit-debt");
for (const a of argv) {
  if (a === "--include-tests" || a === "--emit-debt") continue;
  console.error(`[arch-cycle] 不认识参数：${a}（本尺只认 --include-tests／--emit-debt）`);
  process.exit(2);
}

const say = (s: string): void => { console.log(s); };

const scanned = await scanSourceFilesAll(ROOT);
const inScope = scanned.filter((f) => (f.rel.startsWith("src/") || (includeTests && f.rel.startsWith("tests/"))));
const known = new Set(inScope.map((f) => f.rel));

let grammarBroken = false;
const edges: [string, string][] = [];
let typeOnlySkipped = 0;
let external = 0;
let unparsed = 0;
let importsRead = 0;
for (const f of inScope) {
  let src: string;
  try { src = readFileSync(pathResolve(ROOT, f.rel), "utf8"); } catch { unparsed++; continue; }
  const ext = f.rel.slice(f.rel.lastIndexOf(".") + 1).toLowerCase();
  let symbols;
  try { symbols = await fileSymbols(src, ext); } catch (err) {
    if (err instanceof TreeSitterUnavailableError) { grammarBroken = true; break; }
    unparsed++; continue; // 单文件语法坏：地图自己也跳过（不抛），这里同一口径
  }
  importsRead += symbols.imports.length;
  for (const ir of symbols.imports) {
    if (ir.typeOnly) { typeOnlySkipped++; continue; }        // 类型边不入图（09-23 裁决）
    const target = resolveModuleSpecifier(f.rel, ir.spec, known);
    if (target === null) { external++; continue; }            // 外部包／不在本面内
    edges.push([f.rel, target]);
  }
}

const adj = adjacencyOf(edges);
const nodes = [...new Set(edges.flat())];
const found = grammarBroken ? [] : stronglyConnectedComponents(nodes, adj);
const verdict = classifyCycles(found, RUNTIME_CYCLE_DEBT);

say(`[arch-cycle] 取料面＝scanSourceFilesAll ⇒ 域内 ${String(inScope.length)} 支（tests ${includeTests ? "含" : "不含"}）｜解析失败 ${String(unparsed)} 支`);
say(`[arch-cycle] import 声明 ${String(importsRead)} 条 ⇒ 运行边去自环 ${String([...adj.values()].reduce((s, v) => s + v.size, 0))} 条｜类型边跳过 ${String(typeOnlySkipped)}｜外部/域外 ${String(external)}`);
if (grammarBroken) {
  say("[arch-cycle] ⚠️ 取不到：tree-sitter grammar 不可用 ⇒ 整条未检，不等于通过");
  process.exit(2);
}
say(`[arch-cycle] ${cycleSummary(verdict)}`);
for (const c of verdict.allowed) say(`  ✅ 登记债：${c.join(" → ")}`);
for (const c of verdict.fresh) say(`  ❌ 新圈：${c.join(" → ")}`);
for (const s of verdict.stale) say(`  ❌ 登记已失效：${s}`);
if (emitDebt) {
  say("--emit-debt 的登记字面量（当前读数，粘贴进 RUNTIME_CYCLE_DEBT 才算登记）：");
  for (const c of found) say(`  [${c.map((x) => `"${x}"`).join(", ")}],`);
}
const findings = cycleFindings(verdict);
for (const f of findings) say(`  ${f.rule}: ${f.detail}`);
process.exit(findings.length === 0 ? 0 : 1);
