/** 第 280 页探针：候选判据 D-11（"行号引用紧邻的标识符必须还在被指的那个文件里"）今天能不能建？
 *  口径与门无关：自己扫台账、自己取 HEAD 文件体，输出口径分三档（可核／文件本身追不到／符号不在文件里），
 *  并把每一条"失败"的**上下文**印出来——判"能不能建"要看失败是真缺陷还是抽取形状自己造的。 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const txt = readFileSync("PROGRESS.md", "utf8");
const tracked = new Set(execFileSync("git", ["ls-tree", "-r", "--name-only", "HEAD"], { encoding: "utf8" }).trim().split("\n"));
const body = new Map<string, string>();
const read = (p: string): string => {
  let b = body.get(p);
  if (b === undefined) { b = execFileSync("git", ["show", "HEAD:" + p], { encoding: "utf8", maxBuffer: 64_000_000 }); body.set(p, b); }
  return b;
};

/** 形状 A：窗口 24 字符内紧邻的标识符（第一版草拟的形状）。 */
const SHAPE_A = /`([A-Za-z0-9_./-]+\.(?:ts|mts|mjs|js|json)):(\d+)`[\s\S]{0,24}?`([A-Za-z_$][A-Za-z0-9_$]{3,})`/g;
/** 形状 B：只允许**同一个小句**（碰到 。；、） ）、换行就断）——把跨子句的抓取挡掉。 */
const SHAPE_B = /`([A-Za-z0-9_./-]+\.(?:ts|mts|mjs|js|json)):(\d+)`[^。；！\n）]{0,18}?`([A-Za-z_$][A-Za-z0-9_$]{3,})`/g;

for (const [name, re] of [["形状A（24 字窗口）", SHAPE_A], ["形状B（同小句内）", SHAPE_B]] as [string, RegExp][]) {
  let checkable = 0; let unresolvableFile = 0; const fails: string[] = [];
  for (const m of txt.matchAll(re)) {
    const p = m[1]!, sym = m[3]!;
    checkable += 1;
    if (!tracked.has(p)) { unresolvableFile += 1; continue; }
    if (!read(p).includes(sym)) fails.push(`${p}:${m[2]} 邻近符号 \`${sym}\`｜上下文：…${txt.slice(Math.max(0, (m.index ?? 0) - 20), (m.index ?? 0) + 90).replace(/\n/g, "⏎")}…`);
  }
  console.log(`${name}：可核 ${String(checkable)} 条｜其中文件本身追不到 ${String(unresolvableFile)} 条（D-10 已管）｜符号不在文件里 ${String(fails.length)} 条`);
  for (const f of fails) console.log("   ↳ " + f);
}

/** 还要印一条**真阳性对照**：故意把符号换成一个确实搬走过的位置（`collectNeedles` 在 prose-needle-scan.ts 里在、
 *  在 tests/schedule.test.ts 里不在）——没有这条，"0 失败"可能只是尺根本没在跑。 */
const probeTrue = read("scripts/prose-needle-scan.ts").includes("collectNeedles");
const probeFalse = read("tests/schedule.test.ts").includes("collectNeedles");
console.log(`阳性对照：collectNeedles 在 scripts/prose-needle-scan.ts＝${String(probeTrue)}｜在 tests/schedule.test.ts＝${String(probeFalse)}（前者该 true、后者该 false）`);
process.exit(probeTrue && !probeFalse ? 0 : 1);
