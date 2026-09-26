// 读数：整簇落库会删掉多少条用例，而其中有多少条测的是**还活着的模块**。
// 为什么量这个：主树 230 个测试文件 vs HEAD 认证树 272 个 ⇒ 落库要少 42 个文件／414 条用例。
// 「桌面层已删，所以这些用例本来就该死」是一句**断言**，不是一句读数——只有逐条看每个被删测试
// 引的模块在盘上还在不在，才能判它是不是只测桌面层。
// 用法：node --import tsx "outputs/head-state-2026-09-26/measure-deleted-test-coverage.mts"
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = process.cwd();
const git = (args: string[]): string => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });

// 「已跟踪 ∧ 盘上没有」＝被删那一态（第 119 页的三态之一），只看 tests/ 下的 .test.ts
const tracked = git(["ls-files", "-z", "--", "tests"]).split("\0").filter((p) => p.endsWith(".test.ts"));
const missing = tracked.filter((p) => !existsSync(join(ROOT, p)));
const onDisk = tracked.filter((p) => existsSync(join(ROOT, p)));

/** 数一条用例：HEAD 那份里 `it(` / `test(` 的行数（口径写在报告里，不冒充 vitest 的计数）。 */
function countCases(text: string): number {
  return (text.match(/^\s*(?:it|test)\(/gm) ?? []).length;
}

/** 取一个文件里所有相对 import 的路径字面量（含动态 import 与 vi.mock 的靶）。 */
function importsOf(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/from\s+["'](\.[^"']+)["']/g)) out.add(m[1]);
  for (const m of text.matchAll(/import\(["'](\.[^"']+)["']\)/g)) out.add(m[1]);
  for (const m of text.matchAll(/vi\.mock\(\s*["'](\.[^"']+)["']/g)) out.add(m[1]);
  return [...out];
}

/** 相对路径 → 仓内路径，并判它现在还在不在。
 *  ⚠️ TS 源码里普遍用 `./x.js` 指 `./x.ts`（ESM 写法），所以 `.js` 结尾必须先降级再试 `.ts`/`.tsx`——
 *  第一版没做这一步，把 12 个活得好好的 import 报成断链（join 键造出来的假象，本页第 3 次同一坑）。 */
function resolveTarget(fromFile: string, spec: string): { path: string; exists: boolean } {
  const abs = resolve(ROOT, dirname(fromFile), spec);
  const rel = abs.slice(ROOT.length + 1);
  const noJs = rel.replace(/\.js$/, "");
  const candidates = [rel, noJs + ".ts", noJs + ".tsx", noJs + ".js", noJs + ".mts", join(noJs, "index.ts"), join(rel, "index.ts")];
  return { path: rel, exists: candidates.some((c) => existsSync(join(ROOT, c))) };
}

let caseSumMissing = 0;
const orphaned: { test: string; targets: string[] }[] = [];
const headOnly: string[] = [];
for (const f of missing) {
  let text = "";
  try {
    text = git(["show", "HEAD:" + f]);
  } catch {
    continue;
  }
  caseSumMissing += countCases(text);
  const alive = importsOf(text)
    .map((s) => resolveTarget(f, s))
    .filter((t) => t.exists && !t.path.startsWith("tests/"));
  if (alive.length > 0) orphaned.push({ test: f, targets: [...new Set(alive.map((a) => a.path))] });
  // 只引 tests/fixtures 或什么都不引的，才算"随桌面层一起死"的那一类
  if (alive.length === 0) headOnly.push(f);
}

// 反向对照：现在还在盘的测试文件里，有没有已经引着盘上不存在的东西（断链测试）
const brokenNames: string[] = [];
for (const f of onDisk) {
  const text = readFileSync(join(ROOT, f), "utf8");
  const bad = importsOf(text).filter((s) => !resolveTarget(f, s).exists);
  if (bad.length > 0) brokenNames.push(f + " ⇒ " + bad.slice(0, 2).join("、"));
}

console.log(`tests/*.test.ts：已跟踪 ${String(tracked.length)} ＝ 在盘 ${String(onDisk.length)} ＋ 被删 ${String(missing.length)}`);
console.log(`被删那批的用例数（按 it(/test( 行数口径）：${String(caseSumMissing)} 条`);
console.log(`其中「只引 tests//fixtures 或不引」的（＝可能真随桌面层一起死）：${String(headOnly.length)} 个文件`);
console.log(`引着**盘上仍存在**的非测试模块的（＝落库后那模块少一份测试）：${String(orphaned.length)} 个文件`);
for (const o of orphaned.slice(0, 20)) console.log(`  ${o.test} ▸ ${o.targets.slice(0, 4).join("、")}${o.targets.length > 4 ? ` …共 ${String(o.targets.length)} 个` : ""}`);
console.log(`对照：仍在盘的 ${String(onDisk.length)} 个测试里，import 已有断链的：${String(brokenNames.length)} 个`);
for (const b of brokenNames) console.log(`  ${b}`);

// 被删文件里，落在 src/renderer / src/preload 这类已删面上的（用于说明"这些确实无家可归"）
const srcMissing = git(["ls-files", "-z", "--", "src"]).split("\0").filter((p) => !existsSync(join(ROOT, p)));
console.log(`同批被删的 src 文件数：${String(srcMissing.length)}（其中 renderer/preload：${String(srcMissing.filter((p) => /renderer|preload/.test(p)).length)}）`);

/* 真正要的那个数：上面这些「模块还活着」的被删测试里，哪些模块**落库后一个 importer 都不剩**。
   「有别的测试也引它」＝不变量仍有主人；「只剩这一个被删测试引它」＝落库即零测试。 */
const importers = new Map<string, Set<string>>();
for (const f of onDisk) {
  const text = readFileSync(join(ROOT, f), "utf8");
  for (const s of importsOf(text)) {
    const t = resolveTarget(f, s);
    if (!t.exists || t.path.startsWith("tests/")) continue;
    if (!importers.has(t.path)) importers.set(t.path, new Set());
    importers.get(t.path)!.add(f);
  }
}
const stranded: { module: string; lostBy: string }[] = [];
for (const o of orphaned) {
  for (const m of o.targets) {
    const survivors = importers.get(m);
    if (survivors === undefined || survivors.size === 0) stranded.push({ module: m, lostBy: o.test });
  }
}
console.log(`落库后「零在盘 importer」的模块数：${String(stranded.length)}（下面逐条：模块 ⇐ 唯一测它的被删测试）`);
for (const s of stranded) console.log(`  ${s.module} ⇐ ${s.lostBy}`);
