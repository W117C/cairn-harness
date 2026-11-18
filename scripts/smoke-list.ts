// 探针清单（第 1329 页纪律 1：让腐化可见）。
//
// 背景：80 支真机冒烟/探针只有 4 支被真机证据台账登记（改 renderer 必须重跑重签的那四支），
// 其余 76 支从写它的那天起没人再跑——"有 80 支在看着"是错觉。本脚本把探针面列出来，
// 让「哪些有台账、哪些没重跑记录」一眼可见；它不是门（没有历史读数可判），
// 是**清单**：改设置面/窗格面的批次，按它点名重跑受影响的探针并把读数写台账。
//
// 用法：pnpm smoke:list
import { readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = join("apps", "desktop", "scripts");

/** 真机证据台账登记的四支（apps/desktop/tests/helpers/renderer-evidence.ts 的 EVIDENCE_LEDGER）。
 *  这四支改 renderer 后必须重跑重签；其余探针没有这份纪律。 */
const SEALED = new Set([
  "cds-values-probe.cjs",
  "ime-guard-smoke.cjs",
  "queue-key-smoke.cjs",
  "overlay-mutex-smoke.cjs",
]);

const names = readdirSync(DIR)
  .filter((n) => n.endsWith(".cjs") && (n.includes("smoke") || n.includes("probe")))
  .sort();

let sealed = 0;
console.log(`真机探针清单（apps/desktop/scripts，共 ${String(names.length)} 支）`);
for (const name of names) {
  const isSealed = SEALED.has(name);
  if (isSealed) sealed += 1;
  console.log(`  ${isSealed ? "[台账]" : "[未登记]"} ${name}`);
}
console.log(
  `台账登记 ${String(sealed)} / ${String(names.length)}；` +
  "未登记的探针没有重跑记录——按第 1329 页纪律，改设置/窗格面的批次应重跑受影响支并记录读数。",
);
