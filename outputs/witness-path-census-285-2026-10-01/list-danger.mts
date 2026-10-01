/** 把「被算进危险码的每一行」逐条列出来——门自己只印第一行（`evidence-typecheck-check.ts` 的 `firstDangerLine`），
 *  修的时候需要全表。取料面与判定共用门那一份实现（`runEvidenceTsc`／`parseTscLine`／`DANGER_CODES`），不抄第二份。 */
import { runEvidenceTsc, parseTscLine, DANGER_CODES, DANGER_BASELINE, tally } from "/Users/ze/Downloads/deepseek harness/scripts/lib/evidence-typecheck.ts";

const CWD = "/Users/ze/Downloads/deepseek harness";
const tsc = runEvidenceTsc(CWD);
if (tsc === null) { console.log("跑不了 tsc ⇒ 这一格没有读数"); process.exit(1); }
const lines = tsc.out.split("\n");
const danger = lines.filter((l) => {
  const p = parseTscLine(l);
  return p !== null && (DANGER_CODES as readonly string[]).includes(p.code);
}).map((l) => {
  const p = parseTscLine(l)!;
  return { file: p.file, code: p.code, line: l.slice(0, 170) };
});
const t = tally(lines);
console.log(JSON.stringify({
  total: t.total, parsed: t.parsed, dangerTotal: danger.length,
  baselineFiles: Object.keys(DANGER_BASELINE).length,
  baselineSum: Object.values(DANGER_BASELINE).reduce((a: number, n) => a + n, 0),
  新补档那两支: danger.filter((d) => d.file.includes("selector-uniqueness") || d.file.includes("sequencer-dynamic")),
}, null, 2));
for (const d of danger) console.log(`${d.file} ${d.code}｜${d.line}`);
