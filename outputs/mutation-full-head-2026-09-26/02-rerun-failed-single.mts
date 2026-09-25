/** 把整张变异表日志里的每一条 ❌ **逐条单独复跑一次**，用第二次读数归类（第 84 页的复跑面）。
 *
 * 用法（**只在隔离 worktree 里跑**——本脚本会真的改源文件，主树有并发会话，绝不在此跑）：
 *   node --import tsx outputs/mutation-full-head-2026-09-26/02-rerun-failed-single.mts \
 *     --log=/tmp/mut-head-0926.log --tree=.worktrees/mut-full-0926
 * 退出码：0＝没有真存活也没有读不出；1＝有，逐条列名；2＝尺自己不成立（日志取不到 / 靶树不干净 / 抽取零命中）。
 *
 * 当场就用上了：整表里 `worker-verify-missing-autoverify` 报「还原后未恢复全绿」，
 * 单条复跑 16.2s ⇒ ✅ 被杀死 ⇒ 那条 ❌ 是读数噪声而不是缺口。**不复跑就只能靠人眼读日志归类。**
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { relative } from "node:path";

import { classify, failedIds, failedLineCount, looseFailedLineCount, needsAction, type TriageVerdict } from "../../scripts/lib/mutation-rerun-triage";

const args = process.argv.slice(2);
const getOpt = (name: string, dflt: string): string => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? dflt : hit.slice(name.length + 3);
};
const LOG = getOpt("log", "/tmp/mut-head-0926.log");
const TREE = getOpt("tree", ".worktrees/mut-full-0926");
const MAIN = getOpt("main", ".");
/** 靶树必须是 worktree 而不是主树：这条不靠人记住，用「靶树与主树不是同一个 inode 目录」＋下面的脏检查兜。 */
const JUDGE_PATHS = ["src", "scripts", "tests", "fixtures"];

function git(cwd: string, ...a: string[]): string {
  const r = spawnSync("git", a, { cwd, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : "__ERR__" + (r.stderr.trim().split("\n")[0] ?? "");
}
const judgedDirty = (cwd: string): string =>
  git(cwd, "status", "--porcelain", "--", ...JUDGE_PATHS);

let logText: string | null = null;
try { logText = readFileSync(LOG, "utf8"); } catch { logText = null; }
if (logText === null) {
  console.error(`读不到日志 ${LOG} ⇒ 没尺，退出（不把「没有 ❌」当通过）`);
  process.exit(2);
}

const rawCount = failedLineCount(logText);
const looseCount = looseFailedLineCount(logText);
const ids = failedIds(logText);
console.log(`取料：日志 ${LOG} —— 行首带 ❌ ${String(looseCount)} 行 / 严格抽取 ${String(rawCount)} 行 / 去重后 id ${String(ids.length)} 条`);
if (looseCount !== rawCount) {
  const missed = logText.split("\n").filter((l) => l.startsWith("❌") && !/^❌\s+\S+\s+—/.test(l));
  console.error("⇒ 两把尺不等：有红行是严格抽取认不出的形状 ⇒ 抽取器对不上当场日志，别把抽不出当「没有存活」。样例：\n  " +
    missed.slice(0, 3).map((l) => l.slice(0, 90)).join("\n  "));
  process.exit(2);
}
if (rawCount === 0) {
  console.log("⇒ 日志里没有 ❌ 行（两把尺都读到 0，所以这句不是「抽不出」）。末尾汇总行是——");
  const tail = logText.trimEnd().split("\n").slice(-2).join(" ⏎ ");
  console.log("   " + tail.slice(0, 160));
  process.exit(0);
}
if (ids.length === 0) {
  console.error("⇒ 有 ❌ 行却一条 id 都没抽出来：日志形状与抽取器不符，别把 0 当「没有存活」");
  process.exit(2);
}

const mainHead = git(MAIN, "rev-parse", "HEAD");
const treeHead = git(TREE, "rev-parse", "HEAD");
if (mainHead.startsWith("__ERR__") || treeHead.startsWith("__ERR__")) {
  console.error(`取不到 HEAD（主树 ${mainHead.slice(0, 20)} ／ 靶树 ${treeHead.slice(0, 20)}）⇒ 没尺`);
  process.exit(2);
}
const dirtyBefore = judgedDirty(TREE);
console.log(`靶树：${TREE}（HEAD ${treeHead.slice(0, 7)}）｜主树 HEAD ${mainHead.slice(0, 7)}｜靶树判卷四面在飞 ${dirtyBefore === "" ? "0" : dirtyBefore.split("\n").length} 项`);
if (treeHead !== mainHead) {
  console.error("⇒ 靶树与主树不是同一个提交：复跑读的是旧码。先 `git -C " + TREE + " checkout --detach " + mainHead.slice(0, 7) + "`（规则 104：在旧码上验出来的结论会替新码背书）");
  process.exit(2);
}
if (dirtyBefore !== "") {
  console.error("⇒ 靶树判卷四面不干净：上一轮可能留了残留（规则 120）。先还原再跑，别在带残留的树上取读数");
  process.exit(2);
}

const rows: Array<{ id: string; verdict: TriageVerdict; note: string }> = [];
for (const id of ids) {
  const r = spawnSync("node", ["scripts/mutate-verify.mjs", id], { cwd: TREE, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const c = classify(r.stdout ?? "", r.status, r.error?.message);
  rows.push({ id, verdict: c.verdict, note: c.note });
  console.log(`  ${c.verdict} ${id}${c.note === "" ? "" : " —— " + c.note}`);
  const after = judgedDirty(TREE);
  if (after !== "") {
    console.error(`  ⇒ 跑完 ${id} 后靶树脏了（还原语义有缺陷）——这条本身就是结论，停在这里`);
    break;
  }
}

const tally = new Map<TriageVerdict, number>();
for (const row of rows) tally.set(row.verdict, (tally.get(row.verdict) ?? 0) + 1);
console.log("\n第二次读数归类：" + [...tally].map(([k, v]) => `${k}=${String(v)}`).join(" ｜ "));
const actionable = needsAction(rows);
if (actionable.length > 0) {
  console.log("⇒ 必须逐条处理（存活＝补观测者；红了未点名＝改 expectFail；读不出＝先修尺）：\n  " + actionable.join("\n  "));
  process.exit(1);
}
console.log("⇒ 本轮 ❌ 里没有真存活。其余归类：基线红＝等那条已提交红灯清掉（不是这些锚点的账）；" +
  "未生效＝针脚要改指新写法（任务 #50）；已杀死＝整表那条 ❌ 是并发负载下的噪声。");
console.log(`（靶树与主树的相对路径：${relative(MAIN, TREE)}——本脚本从不改主树）`);
