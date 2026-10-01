/** 第 282 页探针：`ScanReport` 那 30 个字段里，哪些**印出来了但没人判**、哪些**只有"安全值那一侧"的证人**。
 *  口径与门无关：自己读三份文件（尺本体、判卷、锚点表），只做文本级连接，不起 vitest。
 *  三格读数分别是：
 *   判卷＝字段名在 `tests/prose-needle-scan.test.ts` 里被提到几次（不是"判了几次"，是"有没有人看"的下界）
 *   印出＝字段名是否出现在尺自己那段"给人看的读数"里（取 `"prose-needle-scan："` 之后那一段）
 *   锚点＝`scripts/mutate-verify.mjs` 里 `src` 指向这支尺的条目，其 `s.replace` 的**搜索串**是否含这个字段名
 *  ⚠️ 连接键用错过一次：按"锚点表全文 grep 字段名"数出来的全是 0（锚点钉的是代码文字，不是字段名），
 *     那不是覆盖率为零，是**join 键错了**（规则 340 那一族）。故这里先只收 `src` 对得上的条目、且只看搜索串，
 *     并配一条**已知不可能为 0** 的哨兵：`multiCopy` 一定被某支锚点的搜索串提到过；哨兵为 0 时本探针 `exit 1`。 */
import { readFileSync } from "node:fs";

const SCAN = "scripts/prose-needle-scan.ts";
const TEST = "tests/prose-needle-scan.test.ts";
const TABLE = "scripts/mutate-verify.mjs";

const scan = readFileSync(SCAN, "utf8");
const test = readFileSync(TEST, "utf8");
const table = readFileSync(TABLE, "utf8");

/** ScanReport 的字段名（两空格缩进的 `name:` 行）。 */
const ifaceAt = scan.indexOf("export interface ScanReport");
if (ifaceAt < 0) { console.error("找不到 ScanReport ⇒ 尺的形状变了，这份探针的数不算数"); process.exit(1); }
const iface = scan.slice(ifaceAt, scan.indexOf("\n}", ifaceAt));
const fields = [...iface.matchAll(/^ {2}(\w+)\??:/gmu)].map((m) => m[1]!);
if (fields.length < 20) { console.error(`只解析出 ${String(fields.length)} 个字段，形状与尺不符`); process.exit(1); }

/** "给人看的读数"那一段：从打印标题起，到本函数结束。 */
const printAt = scan.indexOf("prose-needle-scan：");
if (printAt < 0) { console.error("找不到读数标题 ⇒ 取料面变了，这份探针的数不算数"); process.exit(1); }
const printedText = scan.slice(printAt, scan.indexOf("\nexport ", printAt));

/** 只收 `src` 指向这支尺的锚点条目，并抽出其中 `s.replace(` 的第一参数（搜索串）。 */
type Anchor = { id: string; needles: string[] };
const anchors: Anchor[] = [];
for (const m of table.matchAll(/id:\s*"([^"]+)",[\s\S]{0,4000}?apply:\s*\(s\)\s*=>([\s\S]{0,900}?),\s*\n\s*(?:expectFail|desc):/gmu)) {
  const body = m[2]!;
  // 搜索串＝每个 s.replace 的第一个实参
  const needles = [...body.matchAll(/\.replace\(\s*"((?:[^"\\]|\\.)*)"/gmu)].map((x) => x[1]!);
  if (needles.length === 0) continue;
  anchors.push({ id: m[1]!, needles });
}
/** 上面这一刀没带 src 过滤（条目里 src 在 id 之前），这里按 src 再收一遍。 */
const scanAnchorIds = new Set<string>();
for (const m of table.matchAll(/id:\s*"([^"]+)",\s*\n\s*src:\s*"scripts\/prose-needle-scan\.ts"/gmu)) scanAnchorIds.add(m[1]!);
const mine = anchors.filter((a) => scanAnchorIds.has(a.id));

const rows = fields.map((f) => {
  const judge = (test.match(new RegExp("\\b" + f + "\\b", "gu")) ?? []).length;
  const printed = new RegExp("\\b" + f + "\\b", "u").test(printedText);
  const pinned = mine.filter((a) => a.needles.some((n) => n.includes(f))).length;
  return { f, judge, printed, pinned };
});
rows.sort((a, b) => a.judge - b.judge || (a.f < b.f ? -1 : 1));

console.log(`字段 ${String(fields.length)} 个｜本尺锚点条目 ${String(mine.length)} 支（全表 ${String(anchors.length)} 支解析出搜索串）`);
for (const r of rows) {
  if (r.judge <= 1) console.log(`  ${r.f}｜判卷 ${String(r.judge)}｜印出 ${String(r.printed)}｜锚点搜索串 ${String(r.pinned)}`);
}
const noJudge = rows.filter((r) => r.judge === 0).length;
const oneJudge = rows.filter((r) => r.judge === 1).length;
const printedNoJudge = rows.filter((r) => r.judge === 0 && r.printed).length;
console.log(`汇总：判卷零次 ${String(noJudge)} 个｜只判过一次 ${String(oneJudge)} 个｜其中"印出来却没人判" ${String(printedNoJudge)} 个`);

/** 哨兵：`multiCopy` 是全表最忙的一格（判卷里出现十几处、第 92-95 页就为它立过帽），
 *  它读 0 只能说明我的 join 键坏了——那这份普查一个数都不能信。 */
const sentinel = rows.find((r) => r.f === "multiCopy");
if (sentinel === undefined || sentinel.judge < 5) {
  console.error(`哨兵读到的 multiCopy 判卷次数＝${String(sentinel?.judge)}，与真仓不符 ⇒ 连接键坏了，上面的数一律不算数`);
  process.exit(1);
}
console.log(`哨兵：multiCopy 判卷 ${String(sentinel.judge)} 次（该 ≥5）⇒ 连接键可用`);
process.exit(0);
