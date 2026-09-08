import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// 判卷文件完整性校验：对照 scripts/frozen-sha256.json 的冻结基线。
// e2e 与真实模型运行共用；任何判卷文件被改动都会被抓住。
export async function sha256MatchesFrozen(root: string): Promise<{ ok: boolean; broken?: string }> {
  const frozenPath = join(root, "scripts", "frozen-sha256.json");
  const frozen = JSON.parse(await readFile(frozenPath, "utf8")) as Record<string, string>;
  for (const [rel, expected] of Object.entries(frozen)) {
    const actual = createHash("sha256").update(await readFile(join(root, rel))).digest("hex");
    if (actual !== expected) return { ok: false, broken: rel };
  }
  return { ok: true };
}
