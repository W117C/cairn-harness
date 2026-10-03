/** 「谁在读这段文本」的取料与出口（第 328 页，任务 #37）。判据本体在 `scripts/lib/text-readers.ts`。
 *
 *  为什么要有这把尺（读数来自第 327 页补）：把一支判据从 `scripts/loop-eval.ts` 搬进
 *  `scripts/lib/eval-expects.ts` 之后，typecheck、我动过的两个判卷、六台造红、`--check-needles`（阻断 0）全部安静，
 *  只有 `head-cert` 的全量判卷报 `Tests 2 failed | 4023 passed (4025)`——那两条红读的就是 loop-eval 的**源文本**。
 *  ⇒ 交笔轮缺一个便宜的读数：「我改了这些文件，还有哪些判卷把它们当文本在读，该一起跑」。
 *
 *  用法（事实源是本文件与 `package.json`，别处抄的命令会过期）：
 *    node --import tsx scripts/text-reader-check.ts                       # 改动面＝工作树 ∪ rev..HEAD（默认 rev＝HEAD~1）
 *    node --import tsx scripts/text-reader-check.ts --changed-since=<rev>  # 只问这一段改动
 *    node --import tsx scripts/text-reader-check.ts --readers-of=scripts/loop-eval.ts
 *    node --import tsx scripts/text-reader-check.ts --all                   # 全仓读取面（不问改动）
 *    node --import tsx scripts/text-reader-check.ts --no-face               # 连"没有读取者"的那些也印出来（默认只印清单，噪声省掉）
 *
 *  退出码两格：0＝出数了；1＝**形状不认识的读取调用超过登记帽**（`UNKNOWN_CAP`，只准调低）。
 *  「该跑哪些判卷」这一格刻意不做成阻断维（理由写在页上）：清单是线索，多列是安全方向；
 *  会拦人的只有"尺自己开始瞎了"那一格——那正是第 327 页缺的东西。 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { readerSummary, readersOf, scanJudgeForReaders, type ReaderHit, type ReaderScan } from "./lib/text-readers";

const ROOT = resolve(import.meta.dirname, "..");

/** 存量帽（第 328 页现读登记，只准调低）：连第一个参数都切不出来的读取调用数。
 *  高于它＝有人写了新读法而这张表不知道 ⇒ 这把尺正在漏报；补 `classifyArg` 并同笔加一条只有它能看见的合成输入。 */
export const UNKNOWN_CAP = 0;

const git = (args: readonly string[]): string | null => {
  try {
    return execFileSync("git", [...args], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch { return null; }
};

/** 判卷语料＝`tests/` 下所有源码文件。这一面要数所有判卷，所以没有目录级豁免。 */
function judgeCorpus(): { path: string; text: string }[] {
  const acc: { path: string; text: string }[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) { if (!name.startsWith(".")) walk(p); continue; }
      if (!/\.(ts|mts)$/.test(name)) continue;
      acc.push({ path: p.slice(ROOT.length + 1).replaceAll("\\", "/"), text: readFileSync(p, "utf8") });
    }
  };
  walk(join(ROOT, "tests"));
  return acc;
}

/** 改动面＝工作树脏文件 ∪ `rev..HEAD`。git 取不到时**出声**，不许读成"没有改动"。 */
function changedFiles(rev: string): { files: string[]; gitOk: boolean } {
  const a = git(["diff", "--name-only", `${rev}..HEAD`]);
  const b = git(["status", "--porcelain"]);
  if (a === null || b === null) return { files: [], gitOk: false };
  const set = new Set<string>();
  for (const l of a.split("\n")) if (l.trim() !== "") set.add(l.trim());
  for (const l of b.split("\n")) {
    const p = l.slice(2).trim().split(" -> ").pop();
    if (p && /\.(ts|mts|tsx|mjs)$/.test(p)) set.add(p);
  }
  return { files: [...set].sort(), gitOk: true };
}

function printReaders(read: Map<string, ReaderHit[]>, includeSilent: boolean): void {
  for (const [target, hits] of [...read.entries()].sort()) {
    const byJudge = new Map<string, ReaderHit[]>();
    for (const h of hits) {
      const list = byJudge.get(h.judge) ?? [];
      list.push(h);
      byJudge.set(h.judge, list);
    }
    if (hits.length === 0) {
      if (includeSilent) console.log(`  （没有读取者）${target}`);
      continue;
    }
    console.log(`  ${target} ← ${String(byJudge.size)} 份判卷在读`);
    for (const [judge, hs] of [...byJudge.entries()].sort()) {
      const shapes = [...new Set(hs.map((h) => h.shape))].join("/");
      console.log(`      要跑：${judge}（第 ${String(hs[0]!.line)} 行起，${shapes}，共 ${String(hs.length)} 处）`);
    }
  }
}

const argv = process.argv.slice(2);
const flag = (name: string): string | null => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? null : hit.slice(name.length + 3);
};
const exists = (rel: string): boolean => existsSync(join(ROOT, rel));

const scans: ReaderScan[] = judgeCorpus().map((f) => scanJudgeForReaders(f.path, f.text, exists));
const unknown = scans.reduce((a, s) => a + s.unknown, 0);
console.log(`[text-reader-check] 判卷语料 ${String(scans.length)} 份｜${readerSummary(scans)}`);
if (unknown > 0) {
  // 复认要有名字：只印一个总数等于让人去猜哪一处新写法。逐条点名，但不截断到 0。
  for (const s of scans) for (const h of s.hits) {
    if (h.kind !== "unknown") continue;
    console.log(`      要复认：${s.judge}:${String(h.line)}（第一个参数切不出来）`);
  }
}

const only = flag("readers-of");
const includeSilent = argv.includes("--all") || argv.includes("--no-face") || only !== null;
if (only !== null) {
  printReaders(readersOf([only.replaceAll("\\", "/").replace(/^\.\//u, "")], scans), true);
} else if (argv.includes("--all")) {
  const targets = new Set<string>();
  for (const s of scans) for (const h of s.hits) if (h.target !== null) targets.add(h.target);
  printReaders(readersOf([...targets].sort(), scans), includeSilent);
} else {
  const rev = flag("changed-since") ?? "HEAD~1";
  const { files, gitOk } = changedFiles(rev);
  if (!gitOk) console.log(`  ❌ git 取不到改动面（rev=${rev}）⇒ 这一格**没有读数**，不等于"没有改动"`);
  else if (files.length === 0) console.log(`  改动面为空（rev=${rev}＋工作树）⇒ 没有要问的文件`);
  else {
    console.log(`  改动面 ${String(files.length)} 个文件（rev=${rev} ∪ 工作树）：`);
    printReaders(readersOf(files, scans), includeSilent);
  }
}

if (unknown > UNKNOWN_CAP) {
  console.log(`  ❌ 形状不认识 ${String(unknown)} > 帽 ${String(UNKNOWN_CAP)} ⇒ 这张表盖不住新写法，尺正在漏报`);
  process.exitCode = 1;
} else {
  console.log(`  ✅ 形状表覆盖当前全部读取写法（形状不认识 ${String(unknown)} ≤ 帽 ${String(UNKNOWN_CAP)}）`);
}
