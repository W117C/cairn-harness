/** 占一个台账页号（第 243 页，第 249 页按评审加固）。用法：
 *    node --import tsx scripts/next-page.ts            # 占号并打印
 *    node --import tsx scripts/next-page.ts --file=docs/x.md   # 台账换文件（必须落在本仓工作树内）
 *  写新页**之前**跑它，拿到的号就是这一页的号；号池在 git common dir 下，跨 worktree、跨会话共享。
 *  退出码：0＝占到；2＝没占到（common dir／台账路径／号池三面任一取不到，或让位次数用满）。
 *  **2 不是"没有可用页号"，是"这一格没量到"**——照旧不许把取不到读成结论（规则 261/262）。 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { claimPage, insideRepo, pageNumbersIn } from "./lib/page-claim";

const CWD = process.cwd();
const FILE_FLAG = "--file=";
const fileArg = process.argv.find((a) => a.startsWith(FILE_FLAG));
const LEDGER_ARG = fileArg === undefined ? "PROGRESS.md" : fileArg.slice(FILE_FLAG.length);

function gitOut(args: string[]): string | null {
  const r = spawnSync("git", args, { cwd: CWD, encoding: "utf8" });
  const out = (r.stdout ?? "").trim();
  // 失败时把 stderr 也带上：`r.error`（git 不在 PATH）与"退 0 但空串"是两种坏法，混起来就没人知道该修哪一台
  if (r.status !== 0 || out === "") {
    const why = r.error !== undefined ? String(r.error.message) : (r.stderr ?? "").trim();
    console.log(`⚠️ \`git ${args.join(" ")}\` 没取到（status=${String(r.status)}${why === "" ? "" : `｜${why}` }）`);
    return null;
  }
  return out;
}

const COMMON = gitOut(["rev-parse", "--path-format=absolute", "--git-common-dir"]);
if (COMMON === null) {
  console.log("❌ 占不到：`git rev-parse --git-common-dir` 取不到 ⇒ 号池无处放。这不是「没有可用页号」，是这一格没量到。");
  console.log("   修法：在 git 工作树里跑本脚本（规则 244：仓库根不一定在你脚下这棵树）。");
  process.exit(2);
}
/* `--file=` 是**用户给的路径**：先归一化再问它是不是本仓的（`join` 不认绝对第二段——
   `/repo` ＋ `/tmp/x.md` 会拼成 `/repo/tmp/x.md`，于是"读了个不存在的东西"被静默当成"没有页号"）。 */
const TOP = gitOut(["rev-parse", "--show-toplevel"]);
const LEDGER = resolve(CWD, LEDGER_ARG);
if (TOP === null || !insideRepo(LEDGER, TOP)) {
  console.log(`❌ 占不到：台账路径 ${LEDGER} 不在本仓工作树里（或仓库根取不到）⇒ 宁可不出号，也不去仓外读数字。`);
  process.exit(2);
}

const DIR = join(COMMON, "dsh-pages");
// 号池**存不存在**要分清：被删过的池子会被 `mkdirSync(recursive)` 悄悄重建，那一次"谁都还没占号"是假的。
const poolPreexisting = existsSync(DIR);
let taken: number[] | null = null;
try {
  taken = pageNumbersIn(readFileSync(LEDGER, "utf8"));
} catch (e) {
  console.log(`⚠️ 台账读不到（${(e as Error).message}）⇒ 台账那一维报「取不到」，不冒充实测到 0 条`);
}
if (taken === null && !poolPreexisting) {
  console.log("❌ 占不到：台账面取不到 ＋ 号池是空的/刚被建 ⇒ 两个分母都没有料，这一格没量到。");
  console.log(`   修法：在仓根跑，或先人工看一眼 ${DIR} 是不是被清过。`);
  process.exit(2);
}

let lastErrno = "";
const r = claimPage({
  dir: DIR,
  taken,
  ops: {
    ensureDir: (d) => { mkdirSync(d, { recursive: true }); },
    list: (d) => { try { return readdirSync(d); } catch { return null; } },
    create: (d, name) => {
      try { mkdirSync(join(d, name)); return "ok"; }
      catch (e) {
        const code = (e as NodeJS.ErrnoException).code ?? "UNKNOWN";
        lastErrno = code;
        return code === "EEXIST" ? "exists" : "error";
      }
    },
  },
});

console.log(`${r.cell}${poolPreexisting ? "" : "（号池目录是这次新建的——之前不存在）"}`);
if (r.page === null) {
  console.log(`❌ 没占到 ⇒ 别自己挑一个号写下去（那正是撞号的来路）；号池=${DIR} 台账=${LEDGER}${lastErrno === "" ? "" : ` 最近一次 errno=${lastErrno}`}`);
  process.exit(2);
}
console.log(`✅ 下一页用 第 ${String(r.page)} 页（号池 ${DIR}）`);
