// `pnpm typecheck` 的门：跑 tsc、**原样转发输出**、退出码照抄，只在红的时候多打几行归因
// （哪些报错文件在 HEAD、哪些是别人未跟踪的在飞草稿、哪些是**已跟踪但工作树脏**——第三档是第 330 页补的，
//  前两项分不开时，隔壁未提交的 hunk 会被读成「HEAD 内 N 个」，而 HEAD 其实干净）。
// 归因逻辑在 scripts/lib/typecheck-triage.ts，那份是可单测的纯函数；这里只做进程编排，保持本仓「门的判定面可测」的既有分法。
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { triageTypecheck, triageVerdict } from "./lib/typecheck-triage.js";

function untrackedSet(cwd: string): Set<string> {
  const r = spawnSync("git", ["ls-files", "--others", "--exclude-standard"], { cwd, encoding: "utf8" });
  // git 不可用 / 不是仓库 ⇒ 空集：所有报错都按「HEAD 内」处理（保守，绝不为草稿开脱而掩盖真错）
  if (r.status !== 0) return new Set();
  return new Set((r.stdout ?? "").split("\n").filter((x) => x !== ""));
}

/** 工作树相对 HEAD **脏的已跟踪文件**（含已暂存那一半）。
 *  取不到时返回 `null` 而**不是空集**：空集＝"全都干净"⇒ 每条报错都会被记成 HEAD 缺陷（谎报）；
 *  `null` 让归因把它们放进「取不到」那一档并出声（规则 261：读不到与没有不许同形）。 */
function dirtyTrackedSet(cwd: string): Set<string> | null {
  const r = spawnSync("git", ["diff", "--name-only", "HEAD"], { cwd, encoding: "utf8" });
  if (r.status !== 0) return null;
  return new Set((r.stdout ?? "").split("\n").filter((x) => x !== ""));
}

const LOCAL_TSC = join(process.cwd(), "node_modules", "typescript", "bin", "tsc");
const run = existsSync(LOCAL_TSC)
  ? spawnSync(process.execPath, [LOCAL_TSC, "--noEmit"], { encoding: "utf8" })
  : spawnSync("tsc", ["--noEmit"], { encoding: "utf8" });

const out = (run.stdout ?? "") + (run.stderr ?? "");
if (out !== "") process.stdout.write(out.endsWith("\n") ? out : out + "\n");

const code = run.status ?? 1;
if (code !== 0) {
  for (const line of triageVerdict(triageTypecheck(out, untrackedSet(process.cwd()), dirtyTrackedSet(process.cwd())))) console.log(line);
} else {
  // tsc 干净时一个字不吐（它的契约），而门禁现在把「绿而零输出」当成"查了没发现 与 没查 同形"按未证计。
  // 不豁免、不改判据 —— 让这道门自己把结论说出来：本仓的规矩是门说的话等于门测的事。
  console.log("typecheck: tsc --noEmit 通过（0 条报错）✅");
}
process.exit(code);
