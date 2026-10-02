// 第 317 页取料：23 格「欠证人」里，有哪几格其实**早就有一条点名用例**在判它？
//
// 绑定通道从这一页起要四件事（面在欠证人清单／符号在源文件／**一条用例标题**／**那条用例体内引用符号**）。
// 前两件尺自己能查，后两件要人说"哪一条"——这份脚本不替人决定，它只把候选摆出来：
// 每条候选附上那条用例体里的头几条 `expect(`，看一眼就知道它判的是不是这句话。
// 跑法：node --import tsx outputs/claim-binding-tighten-2026-10-03/find-candidates.mts [每格候选数=3]
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { claimWitnessFindings, bindClaimFaces, CLAIM_BINDINGS, scanClaimSites } from "../../scripts/probe-promise-recall";
import { testCaseBody, vitestTitles } from "../../scripts/lib/mutate-gates";
import { trackedExistingFiles } from "../../scripts/lib/scan-scope";

const ROOT = resolve(import.meta.dirname, "..", "..");
const LIMIT = Number(process.argv[2] ?? "3");

const srcFiles = trackedExistingFiles(ROOT, "src").files.map((p) => ({ path: p, text: readFileSync(join(ROOT, p), "utf8") }));
const testPaths = trackedExistingFiles(ROOT, "tests").files;
const corpus = testPaths.map((p) => readFileSync(join(ROOT, p), "utf8"));
const material = { src: new Map(srcFiles.map((x) => [x.path, x.text])), tests: new Map(testPaths.map((p, i) => [p, corpus[i] ?? ""])) };

const f = claimWitnessFindings(scanClaimSites(srcFiles), corpus);
const owed = bindClaimFaces(f, CLAIM_BINDINGS, material).unwitnessed;
console.log("现读欠证人（已扣掉登记表里那些绑定）：" + String(owed.length) + " 格");

/** 符号名从面的单位里取：`file#symbol｜needle`。 */
const symbolOf = (face: string): string => (/#([A-Za-z_$][\w$]*)/u.exec(face)?.[1] ?? "");
const hasSymbol = (text: string, symbol: string): boolean =>
  new RegExp("(^|[^A-Za-z0-9_])" + symbol + "([^A-Za-z0-9_]|$)", "u").test(text);

for (const face of owed) {
  const symbol = symbolOf(face);
  console.log("\n■ " + face + "（符号 " + (symbol === "" ? "取不出" : symbol) + "）");
  if (symbol === "") { console.log("  —— 面的单位里没有可取的符号名 ⇒ 这条通道对它无话可说，只能等原句证人"); continue; }
  const hits: { test: string; title: string; expects: string[] }[] = [];
  testPaths.forEach((p, i) => {
    const text = corpus[i] ?? "";
    for (const title of vitestTitles(text)) {
      const body = testCaseBody(text, title);
      if (body === null || !hasSymbol(body, symbol)) continue;
      const expects = body.split("\n").filter((l) => l.includes("expect(")).slice(0, 2).map((l) => l.trim().slice(0, 96));
      hits.push({ test: p, title, expects });
    }
  });
  if (hits.length === 0) {
    console.log("  候选 0 条 ⇒ 没有任何一条用例的**体内**用到这个符号（文件级提到不算）");
    continue;
  }
  console.log("  候选 " + String(hits.length) + " 条（只列前 " + String(LIMIT) + "，登记前要人读一遍它判的是不是这句话）：");
  for (const h of hits.slice(0, LIMIT)) {
    console.log("    " + h.test + " ▸ " + h.title.slice(0, 88));
    for (const e of h.expects) console.log("        " + e);
  }
}
