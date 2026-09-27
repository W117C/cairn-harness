/** 判定助手（不是门）：对 KNOWN_DRIFT 里每条，打印
 *    ① 这条锚点在 HEAD 表 / 工作树表里各自还在不在（在飞删除会让"修哪一面"变成两个问题）
 *    ② expectFail 原文
 *    ③ 该 test 文件里字面距离最近的 3 条 it()/test() 标题
 *  为什么要有③：判"expectFail 该改成什么"必须看真标题，而不是我把中文句子猜回原样（猜回去＝造一条新散文）。
 *  跑法：TERM=dumb node --import tsx outputs/anchor-title-drift-2026-09-25/adjudicate.mts */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { KNOWN_DRIFT, parseAnchors } from "../../scripts/mutate-anchor-titles.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const headTable = execFileSync("git", ["show", "HEAD:scripts/mutate-verify.mjs"], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 });
const diskPath = join(ROOT, "scripts/mutate-verify.mjs");
const diskTable = existsSync(diskPath) ? readFileSync(diskPath, "utf8") : "";

const rowsBy = (t: string) => new Map(parseAnchors(t).map((r) => [r.id, r]));
const HEAD = rowsBy(headTable);
const DISK = rowsBy(diskTable);

function titles(rel: string): string[] {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) return [];
  const src = readFileSync(abs, "utf8");
  return [
    ...[...src.matchAll(/\b(?:it|test)(?:\.each|\.skip|\.todo|\.only|\.fails)?\s*\(\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]!),
    ...[...src.matchAll(/\b(?:it|test)(?:\.each|\.skip|\.todo|\.only|\.fails)?\s*\(\s*`((?:[^`\\]|\\.)*)`/g)].map((m) => m[1]!),
  ].map((s) => s.replace(/\\(.)/g, "$1"));
}

/** 字符 bigram 的 Dice 系数——只为把候选缩到 3 条，判归人判。 */
function sim(a: string, b: string): number {
  const g = (s: string) => { const m = new Map<string, number>(); for (let i = 0; i + 1 < s.length; i += 1) { const k = s.slice(i, i + 2); m.set(k, (m.get(k) ?? 0) + 1); } return m; };
  const ga = g(a), gb = g(b);
  let inter = 0, na = 0, nb = 0;
  for (const v of ga.values()) na += v;
  for (const v of gb.values()) nb += v;
  for (const [k, v] of ga) inter += Math.min(v, gb.get(k) ?? 0);
  return na && nb ? (2 * inter) / (na + nb) : 0;
}

for (const id of Object.keys(KNOWN_DRIFT)) {
  const h = HEAD.get(id);
  const d = DISK.get(id);
  console.log(`\n### ${id}`);
  console.log(`  在 HEAD: ${h ? "是" : "否"}｜在工作树: ${d ? "是" : "否"}`);
  const ef = (h ?? d)?.expectFail ?? "(无)";
  const test = (h ?? d)?.test ?? "(无)";
  console.log(`  test 面: ${test}`);
  console.log(`  expectFail: ${ef}`);
  const cands = titles(test).map((t) => [sim(ef, t), t] as const).sort((a, b) => b[0] - a[0]).slice(0, 3);
  if (cands.length === 0) console.log("  候选: (该 test 文件里抽不到字面标题——可能是 helper/拼接标题，属另一类)");
  for (const [s, t] of cands) console.log(`  候选 ${s.toFixed(2)}: ${t}`);
}
