/** 任务 #10 的前置 triage：把「语境式会翻红」的那几条读数，在它们各自面里的**每次出现**连上下文打出来，
 *  用来判两件事——① 真原文是否只是换了形状（像 vitest 的列对齐），② 那条数本来是否就不该算数（值是一位数、在任何面上必然偶遇）。 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.argv[2];
const readFace = (dir: string): string | null => {
  const abs = join(ROOT, "outputs", dir);
  if (!existsSync(abs)) return null;
  try {
    return readdirSync(abs).filter((f) => !f.endsWith(".mjs"))
      .map((f) => { try { return readFileSync(join(abs, f), "utf8"); } catch { return ""; } })
      .join("\n");
  } catch { return null; }
};

const cases: [string, string, string][] = [
  ["第 259 页", "2", "judge-timeout-2026-10-01"],
  ["第 259 页", "205", "judge-timeout-2026-10-01"],
  ["第 262 页", "101", "judge-timeout-2026-10-01"],
  ["第 262 页", "406", "judge-timeout-2026-10-01"],
  ["第 262 页", "6", "judge-timeout-2026-10-01"],
  ["第 264 页", "102", "judge-timeout-2026-10-01"],
];
const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/gu, "");

for (const [page, num, dir] of cases) {
  const face = stripAnsi(readFace(dir) ?? "");
  const re = new RegExp("(?:^|[^0-9.])" + num.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&") + "(?:[^0-9.]|$)", "mu");
  const hits: string[] = [];
  let i = 0;
  while (hits.length < 4) {
    const at = face.indexOf(num, i);
    if (at < 0) break;
    const before = face[at - 1] ?? "", after = face[at + num.length] ?? "";
    if (!/[0-9.]/u.test(before) && !/[0-9.]/u.test(after)) {
      hits.push(JSON.stringify(face.slice(Math.max(0, at - 46), at + num.length + 18).replace(/\n/gu, "⏎")));
    }
    i = at + num.length;
  }
  console.log(`[${page}|${num}] 按数位边界命中=${String(re.test(face))}｜出现位置（前 4 处）`);
  for (const h of hits) console.log(`   ${h}`);
  if (hits.length === 0) console.log("   （无命中——那这条本来就该红）");
}
