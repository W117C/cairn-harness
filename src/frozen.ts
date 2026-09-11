import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// 判卷文件完整性校验：对照 scripts/frozen-sha256.json 的冻结基线。
// e2e 与真实模型运行共用；任何判卷文件被改动都会被抓住。
export async function sha256MatchesFrozen(root: string): Promise<{ ok: boolean; broken?: string }> {
  return await sha256MatchesFrozenFile(root, join("scripts", "frozen-sha256.json"));
}

/** M2g：通用实现——按给定冻结表（相对 root 的路径）逐个校验。
 *  判卷区与演示区共用一个实现、**两张独立的表**：往判卷表加演示条目 = 把演示剧本升格成判卷文件，
 *  且会动到判卷基线本身（审查方更正，见任务书任务 6 硬约束）。 */
export async function sha256MatchesFrozenFile(
  root: string,
  relTablePath: string,
): Promise<{ ok: boolean; broken?: string }> {
  const frozenPath = join(root, relTablePath);
  const frozen = JSON.parse(await readFile(frozenPath, "utf8")) as Record<string, string>;
  for (const [rel, expected] of Object.entries(frozen)) {
    const actual = createHash("sha256").update(await readFile(join(root, rel))).digest("hex");
    if (actual !== expected) return { ok: false, broken: rel };
  }
  return { ok: true };
}

/** 演示区冻结校验（演示通道 fixture 化；**不进验收链**，仅供重跑截图前自检）。 */
export async function sha256MatchesDemoFrozen(root: string): Promise<{ ok: boolean; broken?: string }> {
  return await sha256MatchesFrozenFile(root, join("scripts", "frozen-demo-sha256.json"));
}
