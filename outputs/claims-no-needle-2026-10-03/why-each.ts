/** 第 331 页 逐格复核 ＋ 门槛枚举（#34 的裁决取料）。
 *  ⑴ 为什么重做一份：`nowrite.log` 用 `sites.find(file#fn)` 取原文，而同一函数里可能有第二条 mark
 *      （`sequencer.ts#resolvePluginRole` 实测 2 条，其中一条有针脚）⇒ 那份日志会把原文指到**别的面**上。
 *  ⑵ 这一版按面键对齐，并回答"要不要跨插值取值／要不要降 6 字门槛"：逐格量最长连续中文与门槛枚举。 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { trackedExistingFiles } from "../../scripts/lib/scan-scope.ts";
import { claimWitnessFindings, claimWitnessRuns, scanClaimSites } from "../../scripts/probe-promise-recall.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const exts = /\.(ts|mts)$/u;
const prod = trackedExistingFiles(ROOT, "src").files.filter((p) => exts.test(p))
  .map((p) => ({ path: p, text: readFileSync(join(ROOT, p), "utf8") }));
const sites = scanClaimSites(prod);
const tests = trackedExistingFiles(ROOT, "tests").files.filter((p) => exts.test(p))
  .map((p) => readFileSync(join(ROOT, p), "utf8"));
const f = claimWitnessFindings(sites, tests);

/** 只取「这一格自己」的那条面：noNeedle 的键是 `file#fn｜`（针脚为空），所以按 needle==="" 筛。 */
const noNeedleSites = sites.filter((s) => s.audience === "model" && s.runs.length === 0);
const byFace = new Set(f.noNeedle);
console.log(`尺读不出 ${String(byFace.size)} 格｜按面筛出的模型可见零段面 ${String(noNeedleSites.length)} 条（两数不等＝面的去重把同 file#fn 的多条并了，须点名）`);

const stats = new Map<number, number>();
for (const s of noNeedleSites) {
  const all = claimWitnessRuns(s.text, 1);
  const longest = all.reduce((b, r) => (r.length > b.length ? r : b), "");
  const hasTpl = /\$\{/u.test(s.text);
  let rescuedAt = 0;
  for (const min of [6, 5, 4, 3, 2]) {
    if (claimWitnessRuns(s.text, min).length > 0) { rescuedAt = min; break; }
  }
  stats.set(rescuedAt, (stats.get(rescuedAt) ?? 0) + 1);
  console.log(`\n● ${s.file}#${s.fn}｜（mark=${s.mark}）`);
  console.log(`  原文：${JSON.stringify(s.text)}`);
  console.log(`  最长连续中文 ${String(longest.length)} 字 ${JSON.stringify(longest)}｜句里有 \${…}：${hasTpl ? "是" : "否"}`);
  console.log(`  门槛降到几字才挑得出段：${rescuedAt === 0 ? "降到 2 仍挑不出" : `min=${String(rescuedAt)}`}`);
}
console.log("\n门槛枚举（现读 6 字 ⇒ 5 格全不可判）：");
for (const [min, n] of [...stats.entries()].sort((a, b) => b[0] - a[0])) {
  console.log(`  min=${String(min)} 可救 ${String(n)} 格`);
}
const tplSite = noNeedleSites.find((s) => s.text.includes("${"));
const tplLongest = tplSite === undefined ? "" :
  claimWitnessRuns(tplSite.text, 1).reduce((b, r) => (r.length > b.length ? r : b), "");
console.log("跨插值取值这条路：插值段没有静态取值可给（运行期才知道）。");
console.log(`而唯一句里有 \${…} 的那格（${tplSite === undefined ? "无" : tplSite.file + "#" + tplSite.fn}），`
  + `把整句当文本切到的最长中文段仍是「${tplLongest}」（${String(tplLongest.length)} 字 <6）⇒ 插值不是任何一格的卡点。`);
