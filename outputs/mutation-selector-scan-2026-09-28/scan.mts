/** 一次性可行性读数（第 169 页的前置探针）：能不能让每条锚点只跑「自己那条 killer 用例」，
 *  而不是每次 spawn 整份判卷宿主文件？
 *
 *  判据形状必须是 23.1s/条那个读数的同一份：一条锚点付 3 次 spawn，每次跑的是**整个宿主文件**。
 *  若 `-t` 能唯一定位到该锚点的 killer 用例，单价就从「宿主时长 ×3」降到「那一条用例时长 ×3」。
 *  风险与本页要量的正是同一件事：`-t` 选不中任何用例时 vitest **退 0**（没有测试＝没有失败），
 *  于是「基线不绿/变异存活」两拍都白过 ⇒ 一把只能印绿的尺。所以先看唯一性，再看有没有 0 命中。
 *
 *  用法：node --import tsx outputs/mutation-selector-scan-2026-09-28/scan.mts
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { vitestTitlePatterns } from "../../scripts/lib/mutate-gates.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** 从 `--list` 这条不改盘的入口取料（判卷不许自己再算一遍，规则 205/236）。 */
const out = execFileSync(process.execPath, ["--import", "tsx", join(ROOT, "scripts/mutate-verify.mjs"), "--list"], {
  cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
});
const rows = out.split("\n").filter((l) => l.split("\t").length >= 5).map((l) => {
  const p = l.split("\t");
  return { id: p[0] ?? "", test: p[3] ?? "", expectFail: JSON.parse(p[4] ?? '""') as string };
});

const titleCache = new Map<string, string[]>();
function titlesOf(rel: string): string[] {
  let v = titleCache.get(rel);
  if (v === undefined) {
    let src: string;
    try { src = readFileSync(join(ROOT, rel), "utf8"); } catch { v = []; titleCache.set(rel, v); return v; }
    // 逐条取标题原文：vitestTitlePatterns 是「一条正则」的形态（判卷用的那份），这里要的是可数命中的标题串。
    v = [...src.matchAll(/^\s*(?:it|test)(?:\.\w+)?\s*\(\s*(["`'])((?:\\.|(?!\1)[^\\])*)\1/gmu)]
      .map((m) => (m[2] ?? "").replace(/\\\$/g, "$").replace(/\\\$\{/g, "${").replace(/\\`/g, "`"));
    titleCache.set(rel, v);
  }
  return v;
}

const dist = { emptyPointer: 0, one: 0, many: 0, noJudgeFile: 0, notFound: 0, notVitest: 0 };
const manyList: string[] = [];

for (const r of rows) {
  if (r.expectFail === "") { dist.emptyPointer++; continue; }
  if (!r.test.endsWith(".test.ts")) { dist.notVitest++; continue; }
  const titles = titlesOf(r.test);
  if (titles.length === 0) { dist.noJudgeFile++; continue; }
  const hits = titles.filter((t) => t.includes(r.expectFail));
  if (hits.length === 0) dist.notFound++;
  else if (hits.length === 1) dist.one++;
  else { dist.many++; manyList.push(`${r.id} → ${String(hits.length)} 条`); }
}

console.log(`锚点总数：${String(rows.length)}`);
console.log(`指针为空（结构钉型判卷，不参与 -t）：${String(dist.emptyPointer)}`);
console.log(`唯一命中（可直接吃 -t）：${String(dist.one)}`);
console.log(`命中 >1（要先把指针写窄）：${String(dist.many)}${manyList.length === 0 ? "" : " ⇒ " + manyList.slice(0, 25).join("、")}${manyList.length > 25 ? "…" : ""}`);
console.log(`一条都没命中（标题已被改名／写法对不上）：${String(dist.notFound)}`);
console.log(`判卷文件取不到或无 it() 标题：${String(dist.noJudgeFile)}`);
console.log(`判卷不是 vitest 文件：${String(dist.notVitest)}`);

// 交叉核对：lib 那份谓词（判卷用的同一条）与上面的计数必须给出同一个「认不出」集合，否则两把尺各说各话。
const vacuous = rows.filter((r) => r.expectFail !== "" && r.test.endsWith(".test.ts") && !expectFailStillMatches(r));
function expectFailStillMatches(r: { test: string; expectFail: string }): boolean {
  let src: string;
  try { src = readFileSync(join(ROOT, r.test), "utf8"); } catch { return false; }
  return vitestTitlePatterns(src).some((re) => re.test(r.expectFail));
}
console.log(`lib 谓词（标题模式）认不出的条数：${String(vacuous.length)}${vacuous.length === 0 ? "" : " ⇒ " + vacuous.slice(0, 10).map((v) => v.id).join("、")}`);
