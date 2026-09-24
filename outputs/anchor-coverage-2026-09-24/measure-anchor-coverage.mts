/** 判卷文件 ↔ 变异锚点的对账（只读，不改盘、不跑测试）。
 *
 *  动因：本仓反复出现「零件齐了两头断」——判卷写了、产品改了、中间那道"拆掉实现必须有人红"
 *  却没有尺。今天已经用这套方法抓出两支（记忆脱敏闸、子进程 env 消毒），所以把它做成机器，
 *  而不是下一轮再靠人想起去 grep。
 *
 *  三态读法（缺一即红，不许把"没扫到"读成"没问题"）：
 *   ① 没扫到：面为空（没有任何判卷文件 / 锚点表解析出 0 条）⇒ exit 1；
 *   ② 认不出：两个独立来源对不上（手写解析的锚点条数 ≠ `--list` 印出的条数）⇒ exit 1；
 *      这条是这条判据自己的可判性——换写法（多行对象、不同缩进）会让正则静默少抽。
 *   ③ 有料：正常输出，按"该判卷守的 src 面"分组打印零锚点的文件。
 *
 *  故意**不**给"有锚点 = 安全"的结论：锚点只证明"拆掉那一行会红"，不证明那一行就是不变量所在。
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const TABLE = join(ROOT, "scripts/mutate-verify.mjs");
const TESTS_DIR = join(ROOT, "tests");

/** 锚点表按「一个对象 = 一行 `    id: "…"` 起头」抽；只吃 id/src/test 三个字段，不吃 apply。 */
function parseAnchors(text: string): Array<{ id: string; src: string; test: string }> {
  const out: Array<{ id: string; src: string; test: string }> = [];
  const lines = text.split("\n");
  let cur: { id?: string; src?: string; test?: string } | null = null;
  const flush = (): void => {
    if (cur !== null && cur.id !== undefined) {
      out.push({ id: cur.id, src: cur.src ?? "", test: cur.test ?? "" });
    }
    cur = null;
  };
  for (const l of lines) {
    const idm = /^    id: "([^"]+)",$/u.exec(l);
    if (idm !== null) {
      flush();
      cur = { id: idm[1] };
      continue;
    }
    if (cur === null) continue;
    const srcm = /^    src: "([^"]+)",$/u.exec(l);
    if (srcm !== null) { cur.src = srcm[1]; continue; }
    const testm = /^    test: "([^"]+)",$/u.exec(l);
    if (testm !== null) { cur.test = testm[1]; }
  }
  flush();
  return out;
}

/** 独立第二来源：脚本自己的 `--list`（无副作用、只印不跑）。
 *  实测陷阱：一条锚点的 desc 里有换行 ⇒ 它印成两行。所以"行数"不是条数：
 *  只数带 ≥3 个 tab 字段的首行，其余算续行并报出来（不把"对不上"读成"解析器坏了"，也不反过来）。 */
function listCount(): { n: number, cont: number } {
  const raw = execFileSync(process.execPath, [join(ROOT, "scripts/mutate-verify.mjs"), "--list"], {
    cwd: ROOT, encoding: "utf8",
  });
  const rows = raw.split("\n").filter((l) => l.trim() !== "");
  const head = rows.filter((l) => l.split("\t").length >= 3);
  return { n: head.length, cont: rows.length - head.length };
}

/** 判卷文件：tests/**\/*.test.ts（git 跟踪与否不影响读盘，但报告里点名未入库的那些）。 */
function testFiles(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { out.push(...testFiles(join(dir, e.name), prefix + e.name + "/")); continue; }
    if (e.name.endsWith(".test.ts")) out.push("tests/" + prefix + e.name);
  }
  return out;
}

/** 该判卷 import 了哪些 src 模块（用于判断"值不值得钉"，不做加权打分）。 */
function importsOf(rel: string): string[] {
  const text = readFileSync(join(ROOT, rel), "utf8");
  const set = new Set<string>();
  for (const m of text.matchAll(/from\s+"(\.\.[^"]+)"/gu)) {
    const p = m[1].replace(/^\.\.\//u, "").replace(/\.js$/u, ".ts");
    if (p.startsWith("src/")) set.add(p);
  }
  return [...set].sort();
}

const its = (n: number): string => String(n);

const anchors = parseAnchors(readFileSync(TABLE, "utf8"));
const listed = listCount();

console.log("面：判卷文件（tests/**.test.ts）+ 锚点表 scripts/mutate-verify.mjs");
if (anchors.length === 0) {
  console.log("❌ 锚点表解析出 0 条 —— 没有尺，不判。");
  process.exit(1);
}
if (listed.n === 0) {
  console.log("❌ `--list` 印出 0 条 —— 第二来源空转，对账无意义。");
  process.exit(1);
}
if (anchors.length !== listed.n) {
  console.log(`❌ 两个来源对不上：手写解析 ${its(anchors.length)} 条，脚本自己印 ${its(listed.n)} 条` +
    `（差 ${its(listed.n - anchors.length)}）⇒ 解析器已被新写法绕过，本次读数不可信。`);
  process.exit(1);
}
console.log(`✅ 对账前提成立：两种独立取法同为 ${its(anchors.length)} 条锚点` +
  (listed.cont > 0 ? `；${its(listed.cont)} 行是跨行 desc 的续行（已按首行计）` : ""));

// 反向：锚点指的判卷/被测文件在不在盘上（needles-check 管针脚可判定，这里管"路径本身存在"）
const missingPaths = [...new Set(anchors.flatMap((a) => [a.src, a.test]).filter((p) => p !== "" && !existsSync(join(ROOT, p))))];
if (missingPaths.length > 0) {
  console.log(`❌ ${its(missingPaths.length)} 个锚点指向的文件盘上不存在（未入库/搬走）：${missingPaths.join("、")}`);
}

const byTest = new Map<string, string[]>();
for (const a of anchors) {
  if (a.test === "") continue;
  byTest.set(a.test, [...(byTest.get(a.test) ?? []), a.id]);
}

const files = testFiles(TESTS_DIR);
if (files.length === 0) {
  console.log("❌ 判卷面为空 —— 没有尺，不判。");
  process.exit(1);
}

const zero = files.filter((f) => (byTest.get(f) ?? []).length === 0);
console.log(`\n判卷文件 ${its(files.length)} 支；其中零锚点 ${its(zero.length)} 支。`);
console.log("（零锚点 ≠ 缺陷：纯函数/投影类只需判卷；下面按「它 import 的产品面数」降序，越靠前越该问一句）\n");

const rows = zero.map((f) => ({ f, imps: importsOf(f) }))
  .sort((a, b) => b.imps.length - a.imps.length || a.f.localeCompare(b.f));
for (const r of rows.slice(0, 25)) {
  console.log(`  ${r.f}  产品面 ${its(r.imps.length)}：${r.imps.slice(0, 6).join(", ")}${r.imps.length > 6 ? " …" : ""}`);
}
if (rows.length > 25) console.log(`  …另有 ${its(rows.length - 25)} 支（跑本脚本看全表）`);

// 自检注入（rule 74：新观测道第一次跑就要证明它不是瞎的，且每次跑都注入）
const selfChecks: string[] = [];
const knownGuarded = "tests/remember.test.ts";
if ((byTest.get(knownGuarded) ?? []).length === 0) selfChecks.push(`${knownGuarded} 本该有锚点却读到 0 ⇒ 取料面断了`);
const fakeKey = "tests/__definitely-not-anchored-__.test.ts";
if ((byTest.get(fakeKey) ?? []).length !== 0) selfChecks.push(`负控失败：不存在的判卷文件竟被算成有锚点`);
if (selfChecks.length > 0) {
  console.log("\n❌ 本门自检失败（读数不可信）：\n  - " + selfChecks.join("\n  - "));
  process.exit(1);
}
console.log(`\n自检：正控 ${knownGuarded} 有锚点 ✅ ／ 负控 空面不误报 ✅（注入 = 本脚本的取料面，非被测码）`);
console.log(`判卷文件总数 ${its(files.length)}、锚点 ${its(anchors.length)}、零锚点 ${its(zero.length)}、路径缺失 ${its(missingPaths.length)}`);
process.exit(missingPaths.length === 0 ? 0 : 1);
