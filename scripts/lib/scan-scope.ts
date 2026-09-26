// 断言体检的**扫描面**：哪些文件算判卷面。
//
// 口径只有一句：只判 git 已跟踪的脚本。未跟踪的在飞草稿属"隔壁会话正在写一个探针"，
// 不属 HEAD 回归——这句原先只写在 tests/assertion-health-scan.test.ts 里，
// `scripts/gates.ts` 另抄了一份"遍历 scripts/ 磁盘目录"的实现 ⇒ 同一件事两支各答一遍，
// 硬化了一支、另一支照旧把在飞草稿算成红（本仓同族：同一条判据各抄一份）。现在两支共用这一份。
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

export const SCAN_EXT = /\.(?:ts|tsx|mjs|cjs|js)$/;

/** 把 `git ls-files` 的 stdout 收成待扫清单（纯函数，可单测）。 */
export function scriptFilesFromLsFiles(out: string): string[] {
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && SCAN_EXT.test(l));
}

/**
 * 已跟踪脚本清单（相对仓库根）。返回 `null` = 拿不到（git 不可用，或清单空到可疑）——
 * 调用方必须退回磁盘遍历并出声，**不许**把"取不到清单"当成"没有要扫的东西"静默少判。
 *
 * `prefix` 是给"判卷面不止 scripts/"留的口子（切片边界那道判据算的是 tests/）。
 * 刻意加参数而不是在调用方另写一遍 `git ls-files`：口径只有一句，多写一份就是本仓最忌的
 * "同一条判据各抄一份"——硬化了一支、另一支照旧把在飞草稿算成红。
 */
export function trackedScriptFiles(cwd: string, prefix = "scripts"): string[] | null {
  const r = spawnSync("git", ["ls-files", "--", prefix], { cwd, encoding: "utf8" });
  if (r.status !== 0) return null;
  const files = scriptFilesFromLsFiles(r.stdout ?? "");
  return files.length === 0 ? null : files;
}

/** 取料口径的**第二跳**：「git 已跟踪」与「盘上有这个文件」在桌面层删除在飞时不是一件事
 *  （实测 `scripts/` 有 17 支、`tests/` 51 支、`src/` 12 支已跟踪但盘上没有）。
 *  分成两个字段交出去，是为了让"扫描面变小"这件事有名字：随手 `.filter(existsSync)` 的那一支
 *  会把 92 → 75 读成全量，报告照样写着"扫了已跟踪脚本"（规则 82：范围得是字段，不是数出来的差值）。
 *
 *  `trackedUnavailable` ＝第三态：拿不到 git 清单。调用方必须出声并退回磁盘遍历（同上一条的规矩），
 *  不许把"取不到清单"当成"没有要扫的东西"。 */
export function trackedExistingFiles(
  cwd: string,
  prefix = "scripts",
): { files: string[]; missingOnDisk: string[]; trackedUnavailable: boolean } {
  const tracked = trackedScriptFiles(cwd, prefix);
  if (tracked === null) return { files: [], missingOnDisk: [], trackedUnavailable: true };
  const files: string[] = [];
  const missingOnDisk: string[] = [];
  for (const p of tracked) (existsSync(resolve(cwd, p)) ? files : missingOnDisk).push(p);
  return { files, missingOnDisk, trackedUnavailable: false };
}
