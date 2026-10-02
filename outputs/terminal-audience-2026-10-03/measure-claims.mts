// 第 311 页的现读：能力断言这一把网在**改完受众判定之后**交出什么数。
// 取料＝探针同一份（`trackedExistingFiles`＋`scanClaimSites`），证人语料＝`tests/**` 全文。
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  claimWitnessFindings, promiseInventoryFindings, scanClaimSites, scanPromiseSites,
} from "../../scripts/probe-promise-recall.ts";
import { trackedExistingFiles } from "../../scripts/lib/scan-scope.ts";

const ROOT = process.cwd();
const src = trackedExistingFiles(ROOT, "src");
const srcFiles = src.files.map((p: string) => ({ path: p, text: readFileSync(join(ROOT, p), "utf8") }));
const tests = trackedExistingFiles(ROOT, "tests");
const corpus = tests.files.map((p: string) => readFileSync(join(ROOT, p), "utf8"));

const claimSites = scanClaimSites(srcFiles);
const f = claimWitnessFindings(claimSites, corpus);
console.log(`能力断言：全量 ${String(claimSites.length)} 处｜受众 ${JSON.stringify(f.byAudience)}`);
console.log(`模型可见 ${String(f.modelSites)} 条 ⇒ 有证人 ${String(f.witnessed.length)}｜欠证人 ${String(f.unwitnessed.length)}｜挑不出针脚 ${String(f.noNeedle.length)}`);
console.log("== 欠证人逐条 ==");
for (const k of f.unwitnessed) console.log(`  ${k}`);
console.log("== 挑不出针脚逐条 ==");
for (const k of f.noNeedle) console.log(`  ${k}`);
console.log("== 受众改判的回归对照（承诺那一把网应当一字不动） ==");
const p = promiseInventoryFindings(scanPromiseSites(srcFiles));
console.log(`承诺网：面 ${JSON.stringify(promiseInventoryFindings(scanPromiseSites(srcFiles), {}).byAudience)}｜modelKeys ${String(p.modelKeys.length)}｜unjudged ${String(p.unjudged.length)}｜stale ${String(p.stale.length)}`);
