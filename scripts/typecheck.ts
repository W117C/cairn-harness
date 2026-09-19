// `pnpm typecheck` 的门：跑 tsc、**原样转发输出**、退出码照抄，只在红的时候多打一行归因
// （哪些报错文件在 HEAD、哪些是别人未跟踪的在飞草稿）。归因逻辑在 scripts/lib/typecheck-triage.ts，
// 那份是可单测的纯函数；这里只做进程编排，保持本仓「门的判定面可测」的既有分法。
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

const LOCAL_TSC = join(process.cwd(), "node_modules", "typescript", "bin", "tsc");
const run = existsSync(LOCAL_TSC)
  ? spawnSync(process.execPath, [LOCAL_TSC, "--noEmit"], { encoding: "utf8" })
  : spawnSync("tsc", ["--noEmit"], { encoding: "utf8" });

const out = (run.stdout ?? "") + (run.stderr ?? "");
if (out !== "") process.stdout.write(out.endsWith("\n") ? out : out + "\n");

const code = run.status ?? 1;
if (code !== 0) {
  for (const line of triageVerdict(triageTypecheck(out, untrackedSet(process.cwd())))) console.log(line);
}
process.exit(code);
