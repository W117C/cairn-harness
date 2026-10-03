/* 第 329 页 · 第二出口的现读（规则 235/248：收紧前先量存量，且要看清每一处归在哪一档）。
 * 逐条印出「列目录／列跟踪面」调用的原始参数与归类，供人工复认——不靠聚合数判断形状表对不对。 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { findCallSites, scanJudgeForCorpusReaders } from "../../scripts/lib/text-readers.ts";

const ROOT = resolve(import.meta.dirname, "../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) { if (!name.startsWith(".")) walk(p, out); continue; }
    if (/\.(ts|mts)$/.test(name)) out.push(p);
  }
  return out;
}

const files = walk(join(ROOT, "tests")).sort();
let total = 0;
const lines: string[] = [];
for (const abs of files) {
  const rel = abs.slice(ROOT.length + 1).replaceAll("\\", "/");
  const text = readFileSync(abs, "utf8");
  const scan = scanJudgeForCorpusReaders(rel, text);
  total += scan.listCalls;
  lines.push(`### ${rel}  corpus=${String(scan.corpus)} local=${String(scan.local)} unknown=${String(scan.unknown)} faces=${scan.faces.join(",")} shapes=${scan.shapes.join(",")}`);
  for (const at of findCallSites(text, ["readdirSync", "readdir", "execFileSync", "spawnSync", "execSync"])) {
    const from = Math.max(0, at - 24);
    lines.push("    · " + JSON.stringify(text.slice(from, at + 120).replace(/\s+/gu, " ")));
  }
}
console.log(`判卷语料 ${String(files.length)} 份，列目录／列跟踪面调用合计 ${String(total)} 处`);
console.log(lines.join("\n"));
