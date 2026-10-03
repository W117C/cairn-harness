/** 第 331/332 页凭证用的两棵树 title 级对账（现读，不写死期望值）。
 *  用法：node outputs/claims-no-needle-2026-10-03/title-audit-331.mjs <旧 suite.json> <新 suite.json>
 *  为什么吃两份 suite.json 而不是再跑一次 vitest list：head-cert 每趟自产一份（`/tmp/dsh-head-cert-<rev>/suite.json`
 *  目前会留在盘上），取它＝**零额外判卷**；但要记住它没有出处声明（温度未知）⇒ 这里只做"条数与标题集"的对账，
 *  不许拿里面的 duration 去刷预算（第 332 页 #41 治的就是那一格）。
 *  键名现读来的：`testResults[].assertionResults[]` 里有 `fullName`（＝ancestorTitles + title 拼好的），
 *  另有 `title`／`ancestorTitles`；曾经取 `durationMs` 读成全 0（真名是 `duration`）。 */
import { readFileSync } from "node:fs";

const [, , oldPath, newPath] = process.argv;
if (!oldPath || !newPath) {
  console.error("用法：node title-audit-331.mjs <旧 suite.json> <新 suite.json>（两个都要，缺一个就别说「对过账」）");
  process.exit(2);
}

const titlesOf = (p) => {
  const j = JSON.parse(readFileSync(p, "utf8"));
  const set = new Set();
  const files = new Set();
  for (const f of j.testResults ?? []) {
    files.add((f.name ?? "").replace(/^.*\/(?=(?:tests|src|scripts|fixtures)\/)/, ""));
    for (const a of f.assertionResults ?? []) set.add(a.fullName ?? [...(a.ancestorTitles ?? []), a.title ?? ""].join(" > "));
  }
  return { set, files, numTotal: j.numTotalTests ?? -1 };
};

const A = titlesOf(oldPath), B = titlesOf(newPath);
const onlyOld = [...A.set].filter((t) => !B.set.has(t));
const onlyNew = [...B.set].filter((t) => !A.set.has(t));
console.log(`旧树：文件 ${String(A.files.size)} 份｜标题集 ${String(A.set.size)} 个｜自报 numTotalTests=${String(A.numTotal)}`);
console.log(`新树：文件 ${String(B.files.size)} 份｜标题集 ${String(B.set.size)} 个｜自报 numTotalTests=${String(B.numTotal)}`);
console.log(`title 级：＋${String(onlyNew.length)}／−${String(onlyOld.length)}`);
if (onlyNew.length) { console.log("  新增（只在新树）："); for (const t of onlyNew) console.log("    ＋ " + t.slice(0, 110)); }
if (onlyOld.length) { console.log("  消失（只在旧树）——改名/删用例都要逐条给出归属："); for (const t of onlyOld) console.log("    − " + t.slice(0, 110)); }
const fileDiff = [...B.files].filter((f) => !A.files.has(f)).concat([...A.files].filter((f) => !B.files.has(f)).map((f) => "（旧有新无）" + f));
console.log(`文件级差集 ${String(fileDiff.length)} 项：${fileDiff.join("、") || "（两棵树同一批文件）"}`);
// 去重口径要自证：标题集与自报条数不等时，差值就是"同名标题"的数量——那一格不许静默。
for (const [label, x] of [["旧", A], ["新", B]]) {
  if (x.numTotal >= 0 && x.numTotal !== x.set.size) {
    console.log(`  ⚠️ ${label}树：自报 ${String(x.numTotal)} 条而标题集 ${String(x.set.size)} 个 ⇒ 同名标题 ${String(x.numTotal - x.set.size)} 条（本尺按标题集比，这一格要说出口，不许由 0 顶掉）`);
  }
}
