/** 第 260 页取证探针：静态「指针接线」代理的**分辨力实测**（它抓得住规则 325 那一次真事故吗？会不会顺手把 711 条正常锚点也喊上？）。
 *
 *  判据本体不吃本地重写：直接 import `scripts/lib/mutate-gates.ts` 的 `enclosingSymbol`／`testCaseBody`／`auditPointerWiring`
 *  ——这一页要裁的就是那三个函数，探针自己再算一遍就成了第二个注入面（本仓「判据要与生产端共用决策点」）。
 *  用法：`node --import tsx outputs/pointer-wiring-observer-2026-10-01/probe.mts` */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { auditPointerWiring, enclosingSymbol, testCaseBody, wiringCensus } from "../../scripts/lib/mutate-gates";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const read = (rel: string): string | null => {
  try { return readFileSync(join(repo, rel), "utf8"); } catch { return null; }
};

type Case = { name: string; srcRel: string; needle: string; test: string; expectFail: string; want: "wired" | "suspect" };

const CASES: Case[] = [
  { name: "本笔那条锚点（指针写的就是调 parseTscLine 的用例）",
    srcRel: "scripts/lib/evidence-typecheck.ts", needle: "return { file: m[1]!, code: m[4]! };",
    test: "tests/evidence-typecheck.test.ts", expectFail: "真报错行 ⇒ file 与 code 都取对（code 必须是 TS 码，不是 'error'）", want: "wired" },
  { name: "把同一条锚点的指针换成隔壁那条不调它的用例（＝325 的形状）",
    srcRel: "scripts/lib/evidence-typecheck.ts", needle: "return { file: m[1]!, code: m[4]! };",
    test: "tests/evidence-typecheck.test.ts", expectFail: "登记表里的文件都还在盘上（删了的登记＝下一笔必须把帽撤到 0，不许留幽灵条目）", want: "suspect" },
  { name: "325 那次真事故照抄：needle 在 certTreeAbs 里，指针指向只调 staleScratchTrees 的 canonical 用例",
    srcRel: "scripts/lib/head-cert-deps.ts", needle: "export function certTreeAbs(mainRoot: string, treeArg: string): string {",
    test: "tests/head-cert-deps.test.ts", expectFail: "外域那棵进 foreign 而不是 stale，且照样在句子里点名（报成「不存在」＝尺把它吞了）", want: "suspect" },
  { name: "反向证人：同文件里真调 certTreeAbs 的那条用例",
    srcRel: "scripts/lib/head-cert-deps.ts", needle: "export function certTreeAbs(mainRoot: string, treeArg: string): string {",
    test: "tests/head-cert-deps.test.ts", expectFail: "认证树的位置只算一次", want: "wired" },
];

const rows = CASES.map((c) => ({ id: c.name, srcRel: c.srcRel, needle: c.needle, test: c.test, expectFail: c.expectFail }));
const got = auditPointerWiring(rows, { readSrc: read, readTest: read });
let bad = 0;
for (let i = 0; i < CASES.length; i += 1) {
  const c = CASES[i]!;
  const r = got[i]!;
  const ok = r.kind === c.want;
  if (!ok) bad += 1;
  console.log(`${ok ? "✅" : "❌"} ${c.name} ⇒ 期望 ${c.want}，现读 ${r.kind}（符号=${r.symbol ?? "无"}）`);
}
const c2 = wiringCensus(got);
console.log(`四格合计：wired=${String(c2.wired)} suspect=${String(c2.suspect)} 判不了=${String(c2["no-symbol"] + c2["no-needle"] + c2["no-title"] + c2.unreadable)}`);

// 单独把两个helper 的形状钉出来（判卷里喂的是假文字，这里喂真的，防"helper 在真文件上根本取不到东西"）
const srcText = read("scripts/lib/evidence-typecheck.ts") ?? "";
const at = srcText.indexOf("return { file: m[1]!, code: m[4]! };");
console.log(`enclosingSymbol 在真文件上取到：${enclosingSymbol(srcText, at) ?? "null"}`);
const testText = read("tests/evidence-typecheck.test.ts") ?? "";
const body = testCaseBody(testText, "真报错行 ⇒ file 与 code 都取对（code 必须是 TS 码，不是 'error'）");
console.log(`testCaseBody 取到的体长度：${String(body === null ? -1 : body.length)} 字符`);

if (bad > 0) {
  console.log(`❌ ${String(bad)} 格与期望不符 ⇒ 这把尺没有分辨力，别把它接进门`);
  process.exit(2);
}
console.log("✅ 四格全对：这一把尺既报得出「接上」也报得出「疑空」（两态不同形）");
