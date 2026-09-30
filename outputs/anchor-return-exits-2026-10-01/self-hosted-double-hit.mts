/** 第 263 页补⑴ 的可复现证人（规则 328 第四种撞法）：同一串文字，
 *  「裸串」在这份文件里命中 2 处（代码那一行 ＋ 锚点表里那条 apply 的 needle 字面量），
 *  「行锚定」只命中 1 处（只有代码那一行）。⇒ 正向文字断言也必须行锚，否则针脚一抄进表就把判据变成恒真。
 *  用法：node --import tsx outputs/anchor-return-exits-2026-10-01/self-hosted-double-hit.mts */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const text = readFileSync(repo + "scripts/mutate-verify.mjs", "utf8");
const bare = /｜出口数可数 \$\{String\(countable\.length\)\} 条/gu;
const anchored = /^ {4}`｜出口数可数 \$\{String\(countable\.length\)\} 条，其中针脚长在「≥2 条 return」的函数里 \$\{String\(multiExit\.length\)\} 条` \+$/mu;
const hitsOf = (re: RegExp): number => (text.match(new RegExp(re.source, re.flags)) ?? []).length;
const bareN = hitsOf(bare);
const anchoredN = hitsOf(anchored);
console.log(`裸串命中：${String(bareN)} 处（代码那一行 + 表里那条 needle 字面量）`);
console.log(`行锚定命中：${String(anchoredN)} 处（只有代码那一行）`);
// 第二半：把「代码那一行」按锚点的改法换成常数，行锚断言必须不再成立（＝这条锚点真能红）
const mutated = text.replace("\n    `｜出口数可数 ${String(countable.length)} 条，其中针脚长在「≥2 条 return」的函数里 ${String(multiExit.length)} 条` +", "\n    `｜出口数可数 0 条` +");
if (mutated === text) { console.log("❌ 突变没生效（针脚与代码对不上 ⇒ 本文件已过期）"); process.exit(2); }
const anchoredAfter = hitsOf.call(null, anchored) as number;
const anchoredInMutated = (mutated.match(new RegExp(anchored.source, anchored.flags)) ?? []).length;
console.log(`突变后行锚命中：${String(anchoredInMutated)} 处（应为 0 ⇒ 判卷会红）；裸串在突变后：${String((mutated.match(new RegExp(bare.source, bare.flags)) ?? []).length)} 处（应为 1，来自表里那份 needle）`);
if (anchoredInMutated !== 0 || anchoredN !== 1 || bareN !== 2 || anchoredInMutated >= anchoredAfter) { console.log("❌ 形状与预期不符 ⇒ 结论不能这么写"); process.exit(2); }
console.log("✅ 两态成对：裸串 2→1（藏住），行锚 1→0（当场红）");
