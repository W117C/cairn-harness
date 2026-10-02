// 第 314 页的现读：绑定通道接上之后，四态各自交出多少条（取料与探针同一份，不另算）。
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  bindClaimFaces, claimWitnessFindings, CLAIM_BINDINGS, CLAIM_UNWITNESSED_CAP,
  scanClaimSites, scanPromiseSites, promiseInventoryFindings,
  type BindingMaterial,
} from "../../scripts/probe-promise-recall.ts";
import { trackedExistingFiles } from "../../scripts/lib/scan-scope.ts";

const ROOT = process.cwd();
const srcScope = trackedExistingFiles(ROOT, "src");
const srcFiles = srcScope.files.map((p: string) => ({ path: p, text: readFileSync(join(ROOT, p), "utf8") }));
const testScope = trackedExistingFiles(ROOT, "tests");
const testTexts = testScope.files.map((p: string) => readFileSync(join(ROOT, p), "utf8"));

const sites = scanClaimSites(srcFiles);
const f = claimWitnessFindings(sites, testTexts);
const material: BindingMaterial = {
  src: new Map(srcFiles.map((x) => [x.path, x.text])),
  tests: new Map(testScope.files.map((p, i) => [p, testTexts[i] ?? ""])),
};
const bind = bindClaimFaces(f, CLAIM_BINDINGS, material);
const ceil = { over: bind.unwitnessed.length > CLAIM_UNWITNESSED_CAP, stale: bind.unwitnessed.length < CLAIM_UNWITNESSED_CAP };

console.log(`能力断言：全量 ${String(sites.length)} 处｜受众 ${JSON.stringify(f.byAudience)}｜盘上缺料 ${String(srcScope.missingOnDisk.length)}`);
console.log(`模型可见 ${String(f.modelSites)} 格 ⇒ 有证人(原句) ${String(f.witnessed.length)}｜绑定 ${String(bind.bound.length)}` +
  `｜欠证人 ${String(bind.unwitnessed.length)}（帽 ${String(CLAIM_UNWITNESSED_CAP)}${ceil.over ? " ⇒ 超帽" : ceil.stale ? " ⇒ 低于帽" : "，正贴线"}）` +
  `｜挑不出针脚 ${String(f.noNeedle.length)}`);
console.log(`守恒：四态相加 ${String(f.witnessed.length + bind.bound.length + bind.unwitnessed.length + f.noNeedle.length)} 对分母 ${String(f.modelSites)}`);
console.log("== 绑定生效逐条 ==");
for (const k of bind.bound) console.log(`  ${k}`);
console.log("== 登记表自己的病（应当为 0 条）==");
for (const k of bind.bad) console.log(`  ❌ ${k}`);
console.log("== 仍欠证人逐条 ==");
for (const k of bind.unwitnessed) console.log(`  ${k}`);
console.log("== 受众改判的回归对照（承诺那一把网应当一字不动）==");
const p = promiseInventoryFindings(scanPromiseSites(srcFiles));
console.log(`承诺网：面 ${JSON.stringify(p.byAudience)}｜unjudged ${String(p.unjudged.length)}｜stale ${String(p.stale.length)}`);
