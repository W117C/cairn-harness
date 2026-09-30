/** 第 237 页的前置探针：静态那把尺只抽 `it` 标题，而运行时 `-t` 匹配的是**整条名**（describe 前缀＋it 标题）。
 *  于是有一类锚点会被静态判成「唯一命中＝可以走 -t」，运行时却选中该支下的多条 ⇒ 这一格要的是**条数读数**，不是印象。
 *  算法（保守上界）：指针若能匹配该判卷里任一支 `describe` 的标题，就把这份判卷的全部 `it` 都算成候选命中（真实值 ≤ 它）。
 *  用法：node --import tsx outputs/composed-title-audit-2026-09-30/probe.mts
 *  退出码：探针本身不判对错，只出数；跑不起来才非 0。 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describeTitles, selectorAmbiguity, titleMatchPattern, vitestTitles } from "../../scripts/lib/mutate-gates.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

function listAnchorRows(): { id: string; test: string; expectFail: string }[] {
  const script = join(ROOT, "scripts/mutate-verify.mjs");
  const r = spawnSync(process.execPath, [script, "--list"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`--list exit=${String(r.status)}：${(r.stderr ?? "").slice(0, 400)}`);
  return (r.stdout ?? "").split("\n")
    .map((l) => l.split("\t"))
    .filter((p) => p.length >= 5 && p[4] !== undefined && p[4].startsWith("\""))
    .map((p) => ({ id: p[0] ?? "", test: p[3] ?? "", expectFail: JSON.parse(p[4] ?? '""') as string }));
}

const rows = listAnchorRows();
const cache = new Map<string, { itTitles: string[]; descs: string[] } | null>();
function faceOf(rel: string) {
  if (!cache.has(rel)) {
    try {
      const text = readFileSync(join(ROOT, rel), "utf8");
      cache.set(rel, { itTitles: vitestTitles(text), descs: describeTitles(text) });
    } catch { cache.set(rel, null); }
  }
  return cache.get(rel);
}

/** 指针是否"够得着"某个 describe 标题：逐字（含解码后）或按那条标题的模式。 */
function pointerHitsTitle(pointer: string, title: string): boolean {
  if (title.includes(pointer)) return true;
  const un = title.replace(/\\(.)/g, "$1");
  if (un.includes(pointer)) return true;
  const re = titleMatchPattern(title);
  return re !== null && re.test(pointer);
}

/** 一条锚点在「静态 it 面」与「运行时整条名」之间的差值。抽出来是为了能喂合成表当哨兵——
 *  真表读数是 0，而 0 与"这把尺根本数不清"同形（规则 261/262）。
 *  三态分开回（归因守错格是本仓点名的形状，规则 224）：
 *   `off`＝压根没进这把尺（指针为空／非 `.test.ts`／文件读不到／抽不出标题），
 *   `not-unique`＝进了尺但静态命中不是 1（那 3 条今天就是零命中 1＋多命中 2），
 *   否则回「指针够得着的支数」。 */
function assess(pointer: string, descs: string[], read: () => string): "off" | "not-unique" | { risk: number } {
  const scan = selectorAmbiguity([{ id: "synthetic", test: "synthetic.test.ts", expectFail: pointer }], read);
  if (scan.inspected !== 1) return "off";
  const hits = scan.selectableIds.length === 1 ? 1 : (scan.problems[0]?.hits ?? 0);
  if (hits !== 1) return "not-unique";
  return { risk: descs.filter((d) => pointerHitsTitle(pointer, d)).length };
}

// 哨兵（合成判卷）：指针「唯一那条」只落进一条 it 标题（静态判 1），同时又是那支 describe 标题的一部分
// ⇒ 运行时 `-t` 拿整条名匹配，会把该支下两条一起选中。这一格必须报 ≥1，否则下面真表那个 0 是尺瞎了不是盘空。
// （第一版把指针写成了「唯一那条」而支名写的是「支名甲 带指针」——两边不相含，哨兵当场报 0，
//   是哨兵替我抓出来的构造错，不是真表结论。构造错与读数 0 同形，这一族今天第二次命中。）
const SYN = 'describe("支名里也写着 唯一那条 的前缀", () => {\n  it("唯一那条 的子句", () => {});\n  it("另一条不相关的", () => {});\n});\n';
const sentinel = assess("唯一那条", describeTitles(SYN), () => SYN);
const sentinelRisk = typeof sentinel === "object" ? sentinel.risk : null;
console.log(`哨兵（合成表，静态判 1 且指针够得着支名）⇒ 期望 ≥1，现读 ${String(sentinelRisk === null ? `没进被检形状（${sentinel}）` : sentinelRisk)}`);
if (sentinelRisk === null || sentinelRisk < 1) {
  console.error("哨兵没咬住 ⇒ 这把尺数不清，下面那个 0 不许当成结论");
  process.exit(1);
}

let staticOne = 0;
let offFace = 0;
let notUnique = 0;
const atRisk: { id: string; test: string; descs: number; its: number }[] = [];
for (const e of rows) {
  // 不进这把尺的三种条要各归各的账（与 selectorAmbiguity 的 excluded/unreadable/blind 同一口径）：
  // 指针为空／判卷不是 .test.ts（结构钉型）／文件读不到或抽不出标题。把它们当成「唯一命中」＝虚高的分子。
  const face = faceOf(e.test);
  if (e.expectFail === "" || !e.test.endsWith(".test.ts")) { offFace += 1; continue; }
  if (face === null || face.itTitles.length === 0) { offFace += 1; continue; }
  // 真表与哨兵走同一份 assess()：两支各自算一遍命中宽度就是"同一判据两份副本漂宽"那一族（第十三族）。
  const r = assess(e.expectFail, face.descs, () => readFileSync(join(ROOT, e.test), "utf8"));
  if (r === "off") { offFace += 1; continue; }
  if (r === "not-unique") { notUnique += 1; continue; }
  staticOne += 1;
  if (r.risk > 0) atRisk.push({ id: e.id, test: e.test, descs: r.risk, its: face.itTitles.length });
}

console.log(`锚点全长 ${String(rows.length)} 条｜静态判成「唯一命中（可走 -t）」 ${String(staticOne)} 条｜` +
  `进了这把尺但静态命中≠1 ${String(notUnique)} 条｜压根不进这把尺 ${String(offFace)} 条`);
console.log(`核对式：${String(staticOne)} ＋ ${String(notUnique)} ＋ ${String(offFace)} ＝ ${String(staticOne + notUnique + offFace)}（应等于全长 ${String(rows.length)}）`);
console.log(`其中指针同时够得着本判卷某支 describe ⇒ 运行时整条名会连带选中该支下的多条（保守上界）：${String(atRisk.length)} 条`);
for (const a of atRisk) console.log(`  ${a.id}  (${a.test})  命中支 ${String(a.descs)}｜该文件 it 总数 ${String(a.its)}`);
