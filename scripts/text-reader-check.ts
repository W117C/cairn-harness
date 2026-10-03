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
 *  退出码两格：0＝出数了；1＝**两张形状表有一张开始瞎**（`UNKNOWN_CAP`／`CORPUS_UNKNOWN_CAP`，都只准调低）。
 *  「该跑哪些判卷」这一格刻意不做成阻断维（理由写在页上）：清单是线索，多列是安全方向；
 *  会拦人的只有"尺自己开始瞎了"那一格——那正是第 327 页缺的东西。
 *
 *  **两栏分开印**（第 329 页，任务 #38）：
 *   - 第一栏「谁读了这份文件」＝字面量点名的接线判卷（改动面逐个反查）；
 *   - 第二栏「改动面级判卷」＝遍历被改到的那个面的判卷（登记的语料助手／`readdirSync(源面)`／`git ls-files` 那几类）。
 *  并成一行就再也分不清"少了一条"还是"少了一类"——第 328 页补踩的正是后者：那一族在清单里整类缺失。 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { corpusJudgesFor, corpusSummary, readerSummary, readersOf, scanJudgeForCorpusReaders, scanJudgeForReaders, type ReaderHit, type ReaderScan } from "./lib/text-readers";

const ROOT = resolve(import.meta.dirname, "..");

/** 存量帽（第 328 页现读登记，只准调低）：连第一个参数都切不出来的读取调用数。
 *  高于它＝有人写了新读法而这张表不知道 ⇒ 这把尺正在漏报；补 `classifyArg` 并同笔加一条只有它能看见的合成输入。 */
export const UNKNOWN_CAP = 0;

/** 第二出口的存量帽（第 329 页现读登记，只准调低）：语料级判据里"要人复认"的列目录调用数。
 *  这一档涨上去的意思和上面一样——出现了没登记的语料助手／新写法，而那正是第 328 页补踩过的坑。 */
export const CORPUS_UNKNOWN_CAP = 0;

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

const corpus = judgeCorpus();
const scans: ReaderScan[] = corpus.map((f) => scanJudgeForReaders(f.path, f.text, exists));
const corpusScans = corpus.map((f) => scanJudgeForCorpusReaders(f.path, f.text));
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
    // 第二出口的**改动面那一半**：谁在遍历被改到的那个面，就要跑谁（与上面「谁读了这份文件」两栏分开印）。
    const mustRun = corpusJudgesFor(files, corpusScans);
    if (mustRun.length === 0) {
      console.log("  改动面级判卷：一份都没有 ⇒ 这一格**没有点名**（改动面没落在任何被登记遍历的面上，或第二出口瞎了）");
    } else {
      console.log(`  改动面级判卷 ${String(mustRun.length)} 份（改了这些面里的任何文件都要跑，不看谁读了哪一行）：`);
      // 前缀刻意与第一栏的「要跑：」不同字：两栏同前缀时，用 grep 取清单的人会串栏（第 330 页自己踩过一次——
      // 抄下来的"清单"里混进了汇总行那一串名字，vitest 收了 4 个文件而不是 11 个，还一片绿，看着像跑过了）。
      for (const m of mustRun) console.log(`      必跑：${m.judge}（遍历 ${m.faces.join("、")}）`);
      // 再给一行**可直接粘贴**的整串（第 330 页第二次踩同一个坑：zsh 不对未加引号的变量分词，
      // 逐行名单传进去变成一个参数，vitest 照跑不误、只跑了显式那几个文件）。一行一命令，不靠取料人会不会分词。
      console.log("      一次跑完：" + mustRun.map((m) => m.judge).join(" "));
    }
  }
}

// 第二出口单独一栏——与上面那栏并成一行就分不清"少了一条"还是"少了一类"（第 328 页补踩的就是后者）
console.log("  " + corpusSummary(corpusScans));
const corpusUnknown = corpusScans.reduce((a, s) => a + s.unknown, 0);
for (const s of corpusScans) {
  if (s.unknown === 0) continue;
  console.log(`      要复认：${s.judge}（${s.shapes.filter((x) => x.startsWith("unknown:")).join("、")}）`);
}

const corpusBad = corpusUnknown > CORPUS_UNKNOWN_CAP;
if (corpusBad) {
  console.log(`  ❌ 语料级那一栏要人复认 ${String(corpusUnknown)} > 帽 ${String(CORPUS_UNKNOWN_CAP)}`
    + " ⇒ 出现了没登记的语料助手／新写法，第二出口正在漏报（登记进 `CORPUS_HELPERS` 并同笔补一条只有它能看见的合成输入，别抬帽）");
}
if (unknown > UNKNOWN_CAP) {
  console.log(`  ❌ 形状不认识 ${String(unknown)} > 帽 ${String(UNKNOWN_CAP)} ⇒ 这张表盖不住新写法，尺正在漏报`);
  process.exitCode = 1;
} else if (corpusBad) {
  process.exitCode = 1;
} else {
  console.log(`  ✅ 两张形状表都盖住当前写法（读取：形状不认识 ${String(unknown)} ≤ 帽 ${String(UNKNOWN_CAP)}；`
    + `语料级：要人复认 ${String(corpusUnknown)} ≤ 帽 ${String(CORPUS_UNKNOWN_CAP)}）`);
}
