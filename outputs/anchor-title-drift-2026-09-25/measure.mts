/** 一次性读数（不是门）：真表里有多少条 expectFail 不在其 test 文件的 it()/test() 标题集合里？
 *  为什么先量再写判据：桶要按当场事实分，不许先设计"未核对/逐行式/非 vitest 面"再往里塞。
 *  跑法：TERM=dumb node --import tsx outputs/anchor-title-drift-2026-09-25/measure.mts <表路径> <仓根> */
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const [tablePath, rootArg] = process.argv.slice(2);
if (tablePath === undefined || rootArg === undefined) {
  console.error("用法：measure.mts <mutate-verify 表路径> <仓根>");
  process.exit(2);
}
const TABLE = readFileSync(resolve(tablePath), "utf8");
const ROOT = resolve(rootArg);

/** 逐条抓 { id, test, expectFail }：表是 JS 对象字面量，**按每个 `id:` 出现的下标切片**
 *  （第一版用 `split(/\n(?=\s*\{\s*$)/)`，`\s*` 会连换行一起吃 ⇒ 整张表被当成一块、
 *  报出"锚点总数 1"这种结构恒真的读数。下面 EXPECT_TOTAL 就是拦这一格的。） */
type Row = { id: string; test: string | null; expectFail: string | null };
const rows: Row[] = [];
const idAt = [...TABLE.matchAll(/\n\s*id:\s*"((?:[^"\\]|\\.)*)"/g)];
for (let i = 0; i < idAt.length; i += 1) {
  const start = idAt[i]!.index!;
  const end = i + 1 < idAt.length ? idAt[i + 1]!.index! : TABLE.length;
  const chunk = TABLE.slice(start, end);
  const test = /\btest:\s*"((?:[^"\\]|\\.)*)"/.exec(chunk);
  const ef = /\bexpectFail:\s*"((?:[^"\\]|\\.)*)"/.exec(chunk);
  rows.push({ id: idAt[i]![1]!, test: test?.[1] ?? null, expectFail: ef?.[1] ?? null });
}

/** 取料自检：解析不出 N 条就是没有尺，不许把"0 条漂移"当结论。
 *  EXPECT_TOTAL 由 runner 自己印的条数给定（`--check-needles` 的「针脚体检：963 条」）。 */
const EXPECT_TOTAL = Number(process.env.EXPECT_TOTAL ?? "0");
if (EXPECT_TOTAL > 0 && rows.length !== EXPECT_TOTAL) {
  console.error(`❌ 解析到 ${String(rows.length)} 条，runner 自报 ${String(EXPECT_TOTAL)} 条 ⇒ 取料面与测量面对不上，下面的数不可用`);
  process.exit(1);
}

const titlesOf = new Map<string, string | null>();
function fileText(rel: string): string | null {
  if (titlesOf.has(rel)) return titlesOf.get(rel) ?? null;
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) { titlesOf.set(rel, null); return null; }
  const t = readFileSync(abs, "utf8");
  titlesOf.set(rel, t);
  return t;
}
/** 表里的字面量是 JS 转义态（`\"` 等），测试文件里是真字符 ⇒ 两边必须先按 JS 语义解一次，
 *  否则"标题里有引号"会被读成漂移（第一版就误报 131 条）。解不动就单列一桶，不许静默。 */
function decode(lit: string): string | null {
  try { return JSON.parse('"' + lit + '"') as string; } catch { return null; }
}

/** 参数化标题：runner 在运行时比的是 **vitest 渲染后的标题**，`it.each` / `%s` / `${...}` 会被填进实参
 *  ⇒ 静态子串比必然把这类误判成漂移（实测 `…(observationPack=true)` 这一条就是这样）。
 *  这里把每条字面标题里的占位符换成通配，再整串匹配一次。 */
function titlePatterns(rel: string): RegExp[] {
  const txt = fileText(rel);
  if (txt === null) return [];
  const lits = [
    ...[...txt.matchAll(/\b(?:it|test)(?:\.each|\.skip|\.todo|\.only|\.fails)?\s*\(\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]!),
    ...[...txt.matchAll(/\b(?:it|test)(?:\.each|\.skip|\.todo|\.only|\.fails)?\s*\(\s*`((?:[^`\\]|\\.)*)`/g)].map((m) => m[1]!),
  ];
  return lits.map((lit) => {
    const un = lit.replace(/\\(.)/g, "$1");
    const esc = un.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const body = esc
      .replace(/%[sdivjfo#]/g, "[\\s\\S]*?")
      .replace(/\$\{[\s\S]*?\}/g, "[\\s\\S]*?");
    return new RegExp("^" + body + "$");
  });
}

const buckets = { ok: [] as string[], okParam: [] as string[], drift: [] as Row[], noTest: [] as Row[], noEf: [] as Row[], testFileGone: [] as Row[], notVitest: [] as Row[], undecodable: [] as Row[] };
for (const r of rows) {
  if (r.test === null) { buckets.noTest.push(r); continue; }
  if (r.expectFail === null) { buckets.noEf.push(r); continue; }
  if (!r.test.endsWith(".test.ts")) { buckets.notVitest.push(r); continue; }
  const txt = fileText(r.test);
  if (txt === null) { buckets.testFileGone.push(r); continue; }
  const d = decode(r.expectFail);
  if (d === null) { buckets.undecodable.push(r); continue; }
  if (txt.includes(d)) { buckets.ok.push(r.id); continue; }
  if (titlePatterns(r.test).some((re) => re.test(d))) { buckets.okParam.push(r.id); continue; }
  buckets.drift.push(r);
}

console.log(`表：${tablePath}\n根：${rootArg}`);
console.log(`锚点总数 ${String(rows.length)}｜命中 ${buckets.ok.length}｜经参数化命中 ${buckets.okParam.length}｜漂移 ${buckets.drift.length}｜无 expectFail ${buckets.noEf.length}｜无 test 字段 ${buckets.noTest.length}｜test 非 vitest 面 ${buckets.notVitest.length}｜test 文件不在盘 ${buckets.testFileGone.length}｜解不动转义 ${buckets.undecodable.length}`);
for (const r of buckets.drift.slice(0, 12)) console.log(`  漂移  ${r.id} → ${r.test} :: ${r.expectFail}`);
for (const r of buckets.testFileGone.slice(0, 6)) console.log(`  文件不在盘  ${r.id} → ${r.test}`);
for (const r of buckets.notVitest.slice(0, 6)) console.log(`  非 vitest 面  ${r.id} → ${r.test}`);
const seen = new Set<string>();
for (const r of rows) if (r.id !== undefined) { if (seen.has(r.id)) console.log(`  重复 id  ${r.id}`); seen.add(r.id); }
