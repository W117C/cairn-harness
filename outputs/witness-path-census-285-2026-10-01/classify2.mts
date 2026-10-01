/** 第 285 页：把 D-11 的分面收成**凭证页**（判据是「凭证页引的证人随没随页落库」⇒ 分面按判据取，规则 345）。
 *  `classify.mts` 那份是整本台账的宽度：现读 216 条点名／61 条 miss（49 条在盘上、12 条盘上也没有）。
 *  本探针只吃 `credentialPages(...).refs`——抽法仍是 `ledgerWitnessRefs` 那一份实现，不在这里再抄。 */
import { existsSync, readFileSync } from "node:fs";
import { credentialPages, trackedFilesAtHead } from "/Users/ze/Downloads/deepseek harness/scripts/docs-check.ts";

const ROOT = "/Users/ze/Downloads/deepseek harness";
const tracked = trackedFilesAtHead();
if (tracked === null) { console.log("HEAD 跟踪清单取不到 ⇒ 这次分类不构成读数"); process.exit(1); }
const pages = credentialPages(readFileSync(ROOT + "/PROGRESS.md", "utf8"));
const dirsInHead = new Set<string>();
for (const p of tracked) {
  const m = /^outputs\/([^/]+)\/.*/u.exec(p);
  if (m) dirsInHead.add(`outputs/${m[1]}/`);
}
const refs = [...new Set(pages.flatMap((p) => p.refs))].sort();
const miss = refs.filter((r) => (r.endsWith("/") ? !dirsInHead.has(r) : !tracked.has(r)));
const gone = miss.filter((r) => !existsSync(ROOT + "/" + r.replace(/\/$/u, "")));
const badPages = pages.filter((p) => p.refs.some((r) => miss.includes(r))).map((p) => p.key);
console.log(JSON.stringify({
  credPages: pages.length,
  pagesNamingRefs: pages.filter((p) => p.refs.length > 0).length,
  refsTotal: refs.length,
  missTotal: miss.length,
  miss且盘上还在: miss.length - gone.length,
  miss且盘上也没有: gone.length,
  受影响页数: badPages.length,
  受影响页: badPages.slice(0, 12),
}, null, 2));
console.log("--- 逐条 miss（带在盘分类）---");
for (const r of miss) console.log((existsSync(ROOT + "/" + r.replace(/\/$/u, "")) ? "在盘 " : "无盘 ") + r);
