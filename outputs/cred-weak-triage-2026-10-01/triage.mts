/** 第 270 页的前置测量：弱证那 8 对，逐条问「本页那一趟的原文到底在不在盘上（哪怕在别的目录）」。
 *  三种答案对应三种修法：
 *  ① 本页那趟的工件在盘上、且含这个数 ⇒ 只是页点名的目录没指对 ⇒ 补点名；
 *  ② 本页那趟的工件在盘上、但不含这个数 ⇒ 这条数不是这一趟测出来的 ⇒ 要么撤要么改述；
 *  ③ 本页那趟的工件压根不在盘上 ⇒ 这条数是别趟的（合法跨趟引用），修法是把被引用那一趟的提交号写进页里。
 *  判定不自己发明：调生产端的 `sourcedReadings`（剥 ANSI＋严格式）与 `credRunShas`（门自己印的两行）。 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { credentialPages, sourcedReadings, credRunShas, CREDLEDGER_FILE } from "../../scripts/docs-check.ts";

const ROOT = process.argv[2];
if (typeof ROOT !== "string" || ROOT === "") {
  console.error("用法：node --import tsx outputs/cred-weak-triage-2026-10-01/triage.mts <仓根>");
  process.exit(2);
}

/** 全局索引：dated 目录里每份非脚本文件的读数集合与趟号。 */
interface Row { where: string; nums: Set<string>; runs: string[] }
const outRoot = join(ROOT, "outputs");
const index: Row[] = [];
for (const d of readdirSync(outRoot)) {
  const abs = join(outRoot, d);
  if (!/-\d{4}-\d{2}-\d{2}$/u.test(d)) continue;
  if (!existsSync(abs) || !statSync(abs).isDirectory()) continue;
  for (const f of readdirSync(abs)) {
    if (f.endsWith(".mjs")) continue;
    let text = "";
    try { text = readFileSync(join(abs, f), "utf8"); } catch { continue; }
    index.push({ where: `${d}/${f}`, nums: sourcedReadings(text), runs: credRunShas(text) });
  }
}

const ledger = readFileSync(join(ROOT, CREDLEDGER_FILE), "utf8");
const pages = credentialPages(ledger).filter((p) => p.dirs.length > 0 && p.numbers.length > 0);

let rows = 0;
for (const p of pages) {
  for (const num of p.numbers) {
    const wit = index.filter((f) => p.dirs.some((d) => f.where.startsWith(d + "/")) && f.nums.has(num));
    const identified = wit.filter((f) => f.runs.length > 0);
    if (identified.length === 0) continue;
    if (identified.some((f) => f.runs.some((r) => p.shas.includes(r)))) continue;   // 已经是强证
    rows++;
    const ownRunFiles = index.filter((f) => f.runs.some((r) => p.shas.includes(r)));
    const ownWithNum = ownRunFiles.filter((f) => f.nums.has(num));
    const anonWitnesses = wit.filter((f) => f.runs.length === 0);
    const kind = ownWithNum.length > 0 ? "① 补点名" : ownRunFiles.length > 0 ? "② 这条数不是本页那趟测的" : "③ 合法跨趟引用：把被引用那一趟写进页";
    console.log(`${p.key}｜读数 ${num} ⇒ ${kind}`);
    console.log(`   现在的证人（身份不属于本页）：${identified.map((f) => `${f.where}→${f.runs.join("/")}`).join("、")}`);
    console.log(`   同一页面里**没有身份行**的证人：${anonWitnesses.length > 0 ? `${String(anonWitnesses.length)} 份：${anonWitnesses.map((f) => f.where).slice(0, 4).join("、")}` : "（无——这条弱证是干净的：面上只有别趟的原文）"}`);
    console.log(`   本页那趟的工件：${ownRunFiles.length > 0 ? ownRunFiles.map((f) => f.where).slice(0, 3).join("、") : "（盘上没有）"}`);
    console.log(`   其中含这个数的：${ownWithNum.length > 0 ? ownWithNum.map((f) => f.where).slice(0, 3).join("、") : "（没有）"}`);
  }
}
console.log(`小计：待分诊 ${String(rows)} 对（索引覆盖 ${String(index.length)} 份 dated 文件）`);
