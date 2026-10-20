/** 任务 #28 的决策级现读：认证那一趟（`/tmp/dsh-head-cert-<rev>/suite.json`）里最慢的几条用例，
 *  各自在源码里**有没有**显式 timeout——没有的那几条就是"负载下会去撞缺省"的候选。
 *  为什么这么量：#28 的原话是「只给了一条用例」，那是按**用例**数的；而缺省超时也是按用例生效的。
 *  量法两条要说清（免得读成一把尺）：
 *   ⑴ 显式预算两种写法都要认——`it(名, 体, 30000)` 的位置式 与 `it(名, 体, { timeout: 30000 })` 的选项式；
 *      只搜一种会把另一种读成「没有」（本机踩过：全仓 0 条 X 要先按框架自己的写法搜）。
 *   ⑵ 这里数的是** durations 最大的那些条**，不是「全部超帽的条」——超帽判定归 `head-cert-deps` 那把尺
 *      （它现在被隔壁那一格挡着），本工件只回答"最慢的那些有没有各自的预算"。 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const SUITE = process.argv[2] ?? "/tmp/dsh-head-cert-fb2931d/suite.json";
const TOP = Number(process.argv[3] ?? "18");
const j = JSON.parse(readFileSync(SUITE, "utf8"));

const cases = [];
for (const f of j.testResults ?? []) {
  const rel = (f.name ?? "").replace(/^.*\/(?=(?:tests|src|scripts|fixtures)\/)/, "");
  for (const a of f.assertionResults ?? []) {
    cases.push({ file: rel, title: a.fullName ?? [...(a.ancestorTitles ?? []), a.title ?? ""].join(" > "), ms: a.duration ?? 0 });
  }
}
const defTxt = readFileSync("tests/vitest.config.ts", "utf8");
// 第一版取 `/timeout\s*:\s*(\d+)/` 拿到的是 30（那是别的键，不是每条用例的预算）⇒ 比值全错。
// 缺省预算只认 `test: { … }` 块里的 `timeout:`；块里没有就照 vitest 的文档缺省 30000，并说清是推的。
const testBlock = /test\s*:\s*\{[\s\S]*?\n\s*\}/u.exec(defTxt)?.[0] ?? "";
const inBlock = /\btimeout\s*:\s*(\d+)/u.exec(testBlock);
const defMs = inBlock === null ? 30000 : Number(inBlock[1]);
console.log(`用例 ${String(cases.length)} 条｜每条用例的缺省预算 = ${String(defMs)}ms（${inBlock === null ? "vitest 文档缺省，config 的 test 块里没写" : "取自 tests/vitest.config.ts 的 test.timeout"}）`);

const srcCache = new Map();
/** 这一条用例在源码里有没有自己的预算：在该文件的 `it(` 头上找位置式第三参或选项式 timeout。 */
const explicitBudget = (file, title) => {
  let t = srcCache.get(file);
  if (t === undefined) { try { t = readFileSync(file, "utf8"); } catch { t = ""; } srcCache.set(file, t); }
  // it.each 会把模板里的 `$i`／`#N` 之类换成值 ⇒ 整段标题找不到，退化用"去掉尾段变量位"的前缀找。
  const leaf = (title.split(" > ").pop() ?? title).trim();
  let i = t.indexOf(leaf);
  if (i < 0) i = t.indexOf(leaf.replace(/\s+\d+\s*$/u, "").slice(0, 40));
  if (i < 0) return "取不到标题位置";
  const tail = t.slice(i, i + 900);
  const opt = /\btimeout\s*:\s*(\d+)/u.exec(tail);
  if (opt !== null) return `选项式 ${String(opt[1])}ms`;
  const pos = /\)\s*,\s*(\d{3,})\s*\)/u.exec(tail) ?? /\}\s*,\s*(\d{3,})\s*\)/u.exec(tail);
  if (pos !== null) return `位置式 ${String(pos[1])}ms`;
  return "无（撞缺省）";
};

const top = [...cases].sort((a, b) => b.ms - a.ms).slice(0, TOP);
console.log(`\n最慢 ${String(TOP)} 条（占缺省的比值只在 defMs 取到时给）：`);
for (const c of top) {
  const ratio = defMs > 0 ? ` 占缺省 ${(c.ms / defMs * 100).toFixed(1)}%` : "";
  console.log(`  ${(c.ms / 1000).toFixed(2)}s${ratio}  ${explicitBudget(c.file, c.title)}  ${c.file}｜${c.title.slice(0, 78)}`);
}
const none = top.filter((c) => explicitBudget(c.file, c.title) === "无（撞缺省）");
const lost = top.filter((c) => explicitBudget(c.file, c.title) === "取不到标题位置");
if (lost.length === top.length && top.length > 0) {
  console.log("❌ 这批全部「取不到标题位置」＝我的定位写法坏了（不是「都有预算」）。停在这里，别把 0/N 当结论。");
  process.exit(3);
}
console.log(`\n最慢这批 ${String(top.length)} 条里：无显式预算 ${String(none.length)} 条、定位失败 ${String(lost.length)} 条（两个数都要印，只印一个就会读成"都有"）`);
const byFile = new Map();
for (const c of none) byFile.set(c.file, (byFile.get(c.file) ?? 0) + 1);
console.log([...byFile.entries()].sort((a, b) => b[1] - a[1]).map(([f, n]) => `  ${f} ×${String(n)}`).join("\n") || "  （这一批里都有）");
