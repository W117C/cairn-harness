/** 第 286 页的补课：把「还有哪几格只在安全值那一侧被断言」从印象换成读数。
 *  做法：字段清单从 `ScanReport` 接口抽（类型面是唯一事实源，不在这里手抄），再对每个字段在判卷文件里找**断言形状**：
 *    · 等式（两侧都能出声）＝ `toBe(`／`toEqual(`／`toStrictEqual(`／`toBeNull(`／`toBe(0)`
 *    · 只在安全值一侧＝ `toBeGreaterThan`／`toHaveLength(0)`／`toContain`／`.every(`／`toMatch(`／`toBeUndefined(`
 *  ⚠️ 这是一份普查、不是一把尺：它只回答「下一笔该改哪几格」，不进任何门禁（只印不判的东西不许冒充尺）。
 *  ⚠️ 已知粗处：接收者按「点号＋字段名」认（`r.x`／`e.x` 都算），所以注释里出现 `.x` 会被计入——因此本表**只用于排序疑点，
 *     不能当判据**；真要动某一格，得先把它那一行断言读一遍（这一句写在输出里，免得下游把这张表当成结论）。 */
import { readFileSync } from "node:fs";

const ROOT = "/Users/ze/Downloads/deepseek harness";
const src = readFileSync(ROOT + "/scripts/prose-needle-scan.ts", "utf8");
const test = readFileSync(ROOT + "/tests/prose-needle-scan.test.ts", "utf8");

const iface = /export interface ScanReport \{([\s\S]*?)\n\}/u.exec(src)?.[1] ?? "";
const fields = [...iface.matchAll(/^ {2}([A-Za-z][\w$]*)(\??):/gmu)].map((m) => m[1]!);
if (fields.length < 25) { console.log(`接口只抽到 ${String(fields.length)} 个字段 ⇒ 分母可疑，这份读数不成立`); process.exit(1); }

const SAFE_ONLY = /toBeGreaterThan|toHaveLength\(0\)|toContain|\.every\(|toMatch\(|toBeUndefined\(/u;
const EXACT = /\.toBe\(|toEqual\(|toStrictEqual\(|toBeNull\(/u;

const rows: { kind: string; field: string; n: number; sample: string }[] = [];
for (const f of fields) {
  // ⚠️ 第一版在这里切了「命中点往后 130 字」⇒ 整行只剩 `expect(` 之后的部分，`expect(` 过滤器把每一条都筛掉，
  //    于是 28/30 格读成「零断言」——**哨兵那三格当场拒绝**（第 286 页第 5 项写的正是这条纪律），这一版改成取整行。
  const hits = [...test.matchAll(new RegExp("\\." + f + "(?=[^\\w$])", "gu"))]
    .map((m) => {
      const from = test.lastIndexOf("\n", m.index) + 1;
      const to = test.indexOf("\n", m.index);
      return test.slice(from, to === -1 ? test.length : to).trim();
    })
    .filter((l) => /expect\(/u.test(l));
  const hasExact = hits.some((h) => EXACT.test(h));
  const hasSafe = hits.some((h) => SAFE_ONLY.test(h));
  const kind = hits.length === 0 ? "零断言" : hasExact ? "等式" : hasSafe ? "只在安全值一侧" : "形状认不出";
  rows.push({ kind, field: f, n: hits.length, sample: hits[0]?.trim().slice(0, 86) ?? "" });
}
const tally = (k: string) => rows.filter((x) => x.kind === k).length;
console.log(`字段 ${String(rows.length)} 个｜等式 ${String(tally("等式"))}｜只在安全值一侧 ${String(tally("只在安全值一侧"))}｜零断言 ${String(tally("零断言"))}｜形状认不出 ${String(tally("形状认不出"))}`);
// 哨兵：第 286 页刚改成等式的三格必须落在「等式」那一档。它们落不进去 ＝ 上面那两条正则坏了，
// 而不是「这三格又退化了」（这一族读数一片 0 时先怀疑尺，规则 237/322）。
for (const must of ["sourceFiles", "proseHeldBack", "inFlightStale"]) {
  const line = rows.find((x) => x.field === must);
  console.log(`哨兵 ${must} → ${line?.kind ?? "字段不在清单里"}`);
}
console.log("--- 逐格（先列两种可疑档，再列全表）---");
for (const k of ["只在安全值一侧", "零断言", "形状认不出"]) {
  for (const x of rows.filter((y) => y.kind === k)) console.log(`${k}｜${x.field}｜${String(x.n)} 处｜${x.sample}`);
}
for (const x of rows.filter((y) => y.kind === "等式")) console.log(`等式｜${x.field}｜${String(x.n)} 处`);
