/** 第 331 页 现读（规则 235：收紧/改口径前先量存量）：那 5 格「挑不出段」到底是哪 5 句、句里为什么凑不出 6 字连续中文。 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { trackedExistingFiles } from "../../scripts/lib/scan-scope.ts";
import { claimWitnessFindings, scanClaimSites } from "../../scripts/probe-promise-recall.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const srcExts = /\.(ts|mts)$/u;
const prod = trackedExistingFiles(ROOT, "src").files.filter((p) => srcExts.test(p))
  .map((p) => ({ path: p, text: readFileSync(join(ROOT, p), "utf8") }));
const sites = scanClaimSites(prod);
const tests = trackedExistingFiles(ROOT, "tests").files.filter((p) => srcExts.test(p))
  .map((p) => readFileSync(join(ROOT, p), "utf8"));
const f = claimWitnessFindings(sites, tests);
console.log(`面 ${String(f.modelSites)}｜原句证人 ${String(f.witnessed.length)}｜欠证人 ${String(f.unwitnessed.length)}｜挑不出段 ${String(f.noNeedle.length)}`);
for (const k of f.noNeedle) {
  const [face, needle] = k.split("｜");
  const [file, fn] = (face ?? "").split("#");
  const s = sites.find((x) => x.file === file && x.fn === fn && x.audience === "model");
  console.log(`\n● ${k}`);
  console.log(`  原文：${JSON.stringify((s?.text ?? "").slice(0, 220))}`);
}
