/** 占一个台账页号（第 243 页）。用法：
 *    node --import tsx scripts/next-page.ts            # 占号并打印
 *    node --import tsx scripts/next-page.ts --file=docs/x.md
 *  写新页**之前**跑它，拿到的号就是这一页的号；号池在 git common dir 下，跨 worktree、跨会话共享。
 *  退出码：0＝占到；2＝没占到（面取不到／让位次数用满）。**2 不是"没有可用页号"，是"这一格没量到"**——
 *  照旧不许把取不到读成结论（规则 261/262）。 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { claimPage, pageNumbersIn } from "./lib/page-claim";

const CWD = process.cwd();
const fileArg = process.argv.find((a) => a.startsWith("--file="));
const LEDGER = fileArg === undefined ? "PROGRESS.md" : fileArg.slice("--file=".length);

function commonDir(): string | null {
  const r = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: CWD, encoding: "utf8" });
  const out = (r.stdout ?? "").trim();
  if (r.status !== 0 || out === "") return null;
  return out;
}

const COMMON = commonDir();
if (COMMON === null) {
  console.log("❌ 占不到：`git rev-parse --git-common-dir` 取不到 ⇒ 号池无处放。这不是「没有可用页号」，是这一格没量到。");
  console.log("   修法：在 git 工作树里跑本脚本（规则 244：仓库根不一定在你脚下这棵树）。");
  process.exit(2);
}

const DIR = join(COMMON, "dsh-pages");
let taken: number[] = [];
try {
  taken = pageNumbersIn(readFileSync(join(CWD, LEDGER), "utf8"));
} catch (e) {
  console.log(`⚠️ 台账读不到（${(e as Error).message}）⇒ 已占页号那一维按空算，号池那一维仍然有效`);
}

const r = claimPage({
  dir: DIR,
  taken,
  ops: {
    ensureDir: (d) => { mkdirSync(d, { recursive: true }); },
    list: (d) => { try { return readdirSync(d); } catch { return null; } },
    create: (d, name) => {
      try { mkdirSync(join(d, name)); return "ok"; }
      catch (e) { return (e as NodeJS.ErrnoException).code === "EEXIST" ? "exists" : "error"; }
    },
  },
});

console.log(`${r.cell}`);
if (r.page === null) {
  console.log(`❌ 没占到 ⇒ 别自己挑一个号写下去（那正是撞号的来路）；号池=${DIR} 台账=${LEDGER}`);
  process.exit(2);
}
console.log(`✅ 下一页用 第 ${String(r.page)} 页（号池 ${DIR}）`);
