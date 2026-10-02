// 任务 #19 的前置现读（第 306 页）：**语义租约的波及闭包**被第 305 页那条判据顺带改窄了，窄掉的是假冲突还是真冲突？
//
// 为什么这一格必须单量（而不是拿第 305 页那张表当结论）：
// `affectedFilesOf`（`src/agent/impact/index.ts`）对声明过的每个文件，把它定义的每个符号的 `upward(...)` 全并进闭包，
// 而 `upward` 从第 305 页起吃归属判据 ⇒ 租约的**冲突预测器**跟着变了。
// 判卷全绿不等于这格有观测者：本仓的租约测试用的是合成图，真仓闭包大小从来没人数过（第十三族③「同一位置双向偏差」的老形状）。
//
// 两臂＝同一张图、只把落料面抹成空表（＝接第 305 页之前的行为），两臂都走同一个 `affectedFilesOf` 的取料路径。
// 正反两控：
//   阳性＝某文件真的 import 了这个符号 ⇒ 它必须**留在**窄闭包里（窄过头就是把真冲突放过去）；
//   阴性＝某文件把这个名字绑到 `node:fs` ⇒ 它应当**掉出**闭包（旧闭包里它就是那条假冲突）。
import { resolve } from "node:path";
import { buildImpact, closureFilesOf, type ImpactGraph } from "../src/agent/impact/index";
import { attributeRefToDef } from "../src/agent/impact/attribution";

const REPO = resolve(import.meta.dirname, "..");

const prod = await buildImpact({ workspace: REPO });
const bare: ImpactGraph = { ...prod, nameSources: new Map<string, Map<string, string[]>>() };
console.log(`[lease-ab] 图：${String(prod.files.length)} 文件／帽前候选 ${String(prod.candidates)}｜帽 ${String(prod.cap)}`);
console.log(`[lease-ab] 三态（图自己带的）：kept=${String(prod.attribution.kept)} dropped=${String(prod.attribution.dropped)} noEvidence=${String(prod.attribution.noEvidence)}`);

const TARGETS = ["src/agent/ledger.ts", "src/agent/impact/index.ts", "src/events/index.ts", "src/agent/loop.ts", "src/main/settings.ts"];
const problems: string[] = [];
for (const rel of TARGETS) {
  if (!prod.files.includes(rel)) {
    problems.push(`${rel} 不在这张图里 ⇒ 这一行的读数无意义`);
    continue;
  }
  const wide = closureFilesOf(bare, [rel]);
  const narrow = closureFilesOf(prod, [rel]);
  const gone = wide.filter((f) => !narrow.includes(f));
  const keptSymbols = new Set<string>();
  for (const sym of prod.defs.keys()) {
    if (!(prod.defs.get(sym) ?? []).some((d) => d.file === rel)) continue;
    const defFiles = new Set((prod.defs.get(sym) ?? []).map((d) => d.file));
    // 阳性对照的判据＝**同一把**判据自己说"这一处归得到这份定义"，不许探针另算一遍
    for (const r of prod.refs.get(sym) ?? []) {
      if (defFiles.has(r.file)) continue;
      const binding = { known: prod.nameSources.has(r.file), sources: prod.nameSources.get(r.file)?.get(sym) ?? [] };
      if (attributeRefToDef(binding, rel) !== "dropped") keptSymbols.add(`${r.file}::${sym}`);
    }
  }
  console.log(`  ${rel}：宽（旧行为）=${String(wide.length)} 文件｜窄（第 305 页后）=${String(narrow.length)} 文件｜掉 ${String(gone.length)} 个`);
  console.log(`    留下的可归引用点=${String(keptSymbols.size)} 个｜掉出清单的前 3 个：${gone.slice(0, 3).join("、") || "（无）"}`);
  for (const k of keptSymbols) {
    const f = k.split("::")[0] ?? "";
    if (!narrow.includes(f)) problems.push(`阳性对照破了：判据说 ${f} 归得到 ${rel} 的定义，窄闭包里却没有它`);
  }
}
// 阴性对照：`src/agent/ledger.ts` 的 `readFile` 那份清单里，绑到外部包的文件应当只在宽臂出现。
const readFileRefs = prod.refs.get("readFile") ?? [];
const ledgerDefs = new Set((prod.defs.get("readFile") ?? []).map((d) => d.file));
const externalBound = [...new Set(readFileRefs
  .map((r) => r.file)
  .filter((f) => !ledgerDefs.has(f))
  .filter((f) => {
    const sources = prod.nameSources.get(f)?.get("readFile") ?? [];
    return prod.nameSources.has(f) && sources.length > 0 && !sources.includes("src/agent/ledger.ts");
  }))];
const wideLedger = closureFilesOf(bare, ["src/agent/ledger.ts"]);
const narrowLedger = closureFilesOf(prod, ["src/agent/ledger.ts"]);
const negKept = externalBound.filter((f) => wideLedger.includes(f) && !narrowLedger.includes(f)).length;
console.log(`  阴性对照：把 readFile 明确绑到别处的引用方=${String(externalBound.length)} 个文件，其中 ${String(negKept)} 个从窄闭包里掉出`);
if (externalBound.length === 0) problems.push("一个「绑到别处」的 readFile 引用方都没数到 ⇒ 落料面没吃到东西，阴性对照无意义");
if (negKept === 0) problems.push("有反证的引用方一个都没掉出闭包 ⇒ 判据在租约那条支上没生效");

console.log(problems.length === 0
  ? "[lease-ab] 自检 ✅ 两臂同分母、阳性对照没被窄掉、阴性对照真掉出去 ⇒ 上面所有数可以引用"
  : "[lease-ab] 自检 ❌ " + problems.join("；"));
if (problems.length > 0) process.exit(1);
