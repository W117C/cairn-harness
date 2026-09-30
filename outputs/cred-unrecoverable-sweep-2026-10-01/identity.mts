/** 第 269 页的前置测量②：门上「可比对 N 个读数（红 0）」里，有多少条的证人**不是那一趟**的？
 *  D-9 现在的判定是「页点名的目录里，任一处出现该读数的严格式形状」——它不问那行原文出自哪一趟。
 *  于是别趟的日志只要**数值相同**就能替本页作证（第 268 页 `dir-hunt` 撞过一次回声；本笔把它量成数）。
 *  身份取进门自己印的那两行（结构化形状，不按子串）：`目标提交：<sha>`／`已核：TREE=<sha>`。
 *  页侧身份只取**该页段体内**的 hex token（7～40 位）——线索引级，不入门禁（规则 256）。
 *  三态分开印（规则 239/300）：同一趟＝强证｜面上只有别趟的身份行却数值撞对＝弱证｜读不到身份行＝无从判。 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { credentialPages, CRED_NUMBER_RES, CREDLEDGER_FILE } from "../../scripts/docs-check.ts";

const ROOT = process.argv[2];
if (typeof ROOT !== "string" || ROOT === "") {
  console.error("用法：node --import tsx outputs/cred-unrecoverable-sweep-2026-10-01/identity.mts <仓根>");
  process.exit(2);
}

const strip = (s: string): string => s.replace(/\x1b\[[0-9;]*m/gu, "");
/** 一个文件属于哪一趟：门自己印的 `目标提交：`／`已核：TREE=` 后面的 hex。 */
const runShaOf = (text: string): string[] => {
  const out = new Set<string>();
  for (const m of strip(text).matchAll(/(?:目标提交：|已核：TREE=)([0-9a-f]{7,40})/gu)) out.add(m[1]!.slice(0, 7));
  return [...out];
};
const numbersIn = (text: string): Set<string> => {
  const out = new Set<string>();
  for (const re of CRED_NUMBER_RES) for (const m of strip(text).matchAll(new RegExp(re.source, "gu"))) out.add(m[1]!);
  return out;
};

const ledger = readFileSync(join(ROOT, CREDLEDGER_FILE), "utf8");
const lines = ledger.split("\n");
const heads = lines.map((l, i) => [l, i] as const).filter(([l]) => /^### /u.test(l));
/** 页段体（同 `credentialPages` 的切法）：页侧 sha 只能从自己那几行取，全台账取会把别笔的 sha 算进来。 */
const bodyOf = new Map<string, string>();
heads.forEach(([head, start], n) => {
  if (!head.includes("凭证")) return;
  const end = n + 1 < heads.length ? heads[n + 1]![1] : lines.length;
  const key = /第 \d+ 页/u.exec(head)?.[0] ?? head.slice(0, 16);
  bodyOf.set(key, (bodyOf.get(key) ?? "") + "\n" + lines.slice(start, end).join("\n"));
});

const pages = credentialPages(ledger).filter((p) => p.dirs.length > 0 && p.numbers.length > 0);
let strong = 0, weak = 0, noIdentity = 0, pairs = 0;
const weakRows: string[] = [];
for (const p of pages) {
  const body = bodyOf.get(p.key) ?? "";
  const pageShas = new Set([...body.matchAll(/\b([0-9a-f]{7,40})\b/gu)].map((m) => m[1]!.slice(0, 7)));
  for (const num of p.numbers) {
    let seen = false, isStrong = false, identFiles = 0;
    const witnesses: string[] = [];
    for (const d of p.dirs) {
      const abs = join(ROOT, "outputs", d);
      if (!existsSync(abs)) continue;
      for (const f of readdirSync(abs)) {
        if (f.endsWith(".mjs")) continue;
        let text = "";
        try { text = readFileSync(join(abs, f), "utf8"); } catch { continue; }
        if (!numbersIn(text).has(num)) continue;
        seen = true;
        const runs = runShaOf(text);
        if (runs.length === 0) continue;
        identFiles++;
        if (runs.some((r) => pageShas.has(r))) isStrong = true;
        else witnesses.push(`${d}/${f}（${runs.join("、")}）`);
      }
    }
    if (!seen) continue;              // 这条本来就没被门算进对账面（未寻址），不归本探针管
    pairs++;
    if (isStrong) { strong++; continue; }
    if (identFiles === 0) { noIdentity++; continue; }   // 数值有原文，但那些文件里没有身份行 ⇒ 无从判
    weak++;
    weakRows.push(`${p.key}|读数 ${num}｜证人里没有本页提到的那一趟：${witnesses.slice(0, 3).join("、")}`);
  }
}
console.log(`身份核对：配到证人 ${String(pairs)} 对（页已点名目录、且该读数在面上有原文）`);
console.log(`  同一趟（强证）${String(strong)}｜别趟数值撞对（弱证）${String(weak)}｜面上无身份行（无从判）${String(noIdentity)}`);
for (const r of weakRows) console.log(`  ⚠️ 弱证：${r}`);
console.log(`哨兵：本页 sha 集合来自页段体，页里没提到的趟一律算弱证——所以「弱证」的口径是**身份对不上**，不是「数错」`);
