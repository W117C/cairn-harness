// 一次性探针：静态那把尺为什么放过了「四支数都给…」这根死指针？
// 两侧现在**共用** expectFailMatchesTitles（第 141 页收过一份），所以差异只剩"喂进去的那份文本"不同：
// 静态喂判卷**整份源文件**，runner 喂**失败面**。这里把两边各喂一次，并印出是哪条标题把它认下来的。
// 用法：node --import tsx "outputs/expectfail-pointer-width-2026-09-27/probe.mts"
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { expectFailMatchesTitles, vitestTitlePatterns, failingTestText } from "../../scripts/lib/mutate-gates.ts";

const STALE = "四支数都给 ⇒ 求和（0 也算数，不许被当成缺项丢掉）";
const LIVE = "六支数都给 ⇒ 求和（0 也算数，不许被当成缺项丢掉）";

const src = readFileSync("tests/mutate-verify-gates.test.ts", "utf8");
console.log(`判卷源文件里逐字含「${STALE.slice(0, 5)}…」= ${src.includes(STALE)}；含「${LIVE.slice(0, 5)}…」= ${src.includes(LIVE)}`);
console.log(`静态尺对旧指针判定 = ${expectFailMatchesTitles(STALE, src)}（true ⇒ 静态放过，这就是那条 ❌ 只能靠 21 分钟实跑发现的入口）`);
console.log(`静态尺对现指针判定 = ${expectFailMatchesTitles(LIVE, src)}`);

// 逐条标题问一遍：到底是哪条标题"认下"了这根死指针，以及它是怎么认的（逐字 or 占位符展开）
for (const [i, re] of vitestTitlePatterns(src).entries()) {
  if (!re.test(STALE)) continue;
  const srcTitle = src.split("\n").find((l) => l.includes("数都给")) ?? "(找不到那行)";
  console.log(`  ↳ 第 ${i} 条标题的模式认下了旧指针。源文件里含「数都给」的行：${srcTitle.trim().slice(0, 120)}`);
  console.log(`     模式本体（去掉首尾 [\\s\\S]*）= ${String(re.source).replace(/^\^\[\\s\\S\]\*/, "").replace(/\[\\s\\S\]\*\$$/, "").slice(0, 160)}`);
}
console.log(`失败面那一侧：旧指针 matched = ${expectFailMatchesTitles(STALE, failingTestText(" × tests/mutate-verify-gates.test.ts > 六支数都给 ⇒ 求和（0 也算数，不许被当成缺项丢掉）"))}`);
