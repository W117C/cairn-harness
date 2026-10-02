// 一次性诊断（第 305 页第 6 段那条红的取料过程）：`tests/head-cert-deps.test.ts > 真机整表…同分母`
// 喊「取不到成因的条数必须是 0」而它报的是 1，本脚本要回答的是**哪一条**取不到成因——
// 归属判据需要具体到"这条标题是谁改的"，否则只能写成"隔壁在飞"这种没证据的话。
//
// 取料＝复用被度量方自己的那份（`suiteRows` 读留档 json、`budgetFromTestSource` 回源码认标题），
// 不另写一份标题匹配：自己再算一遍就会拿到一个和门不一样的数（规则 236）。
// 跑法：`node --import tsx outputs/impact-edge-attribution-2026-10-02/headcert-notresolved-probe.mts`
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { budgetFromTestSource, suiteRows } from "../../scripts/lib/head-cert-deps";

const repoRoot = resolve(import.meta.dirname, "..", "..");
const rows = suiteRows(readFileSync(join(repoRoot, "outputs/judge-timeout-2026-10-02/suite-quiet.json"), "utf8"), repoRoot + "/");
const all = rows ?? [];
const textCache = new Map<string, string | null>();
const unresolved: { file: string; title: string }[] = [];
for (const r of all) {
  if (!textCache.has(r.file)) {
    try {
      textCache.set(r.file, readFileSync(join(repoRoot, r.file), "utf8"));
    } catch {
      textCache.set(r.file, null);
    }
  }
  if (budgetFromTestSource(textCache.get(r.file) ?? "", r.title).kind === "not-resolved") {
    unresolved.push({ file: r.file, title: r.title });
  }
}
console.log(`语料条数=${String(all.length)}｜取不到成因=${String(unresolved.length)}`);
for (const u of unresolved) console.log(`  ${u.file} :: ${u.title}`);
