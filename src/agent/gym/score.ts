// M5a 靶场评分（§m5-proposal 步骤 3，纯函数）：主指标 = verify 全绿 && 必改文件都改了 &&
// 禁改文件没动 → 1，否则 0。副指标（usage/turns/改动数）由 runner 层统计，这里只判 0/1。
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { GymExpect } from "./case";

export interface GymScoreInput {
  verifyOk: boolean;
  /** 实际变更的文件（case repo 相对路径，/ 分隔）。 */
  changedFiles: string[];
}

export function scoreCase(expect: GymExpect, input: GymScoreInput): number {
  if (expect.mustPassVerify && input.verifyOk !== true) return 0;
  const required = expect.mustChangeFiles ?? [];
  const forbidden = expect.mustNotChangeFiles ?? [];
  if (!required.every((f) => input.changedFiles.includes(f))) return 0;
  if (forbidden.some((f) => input.changedFiles.includes(f))) return 0;
  return 1;
}

/** 递归收集目录下全部文件的相对路径（/ 分隔，只算文件）。 */
export async function collectRelFiles(root: string): Promise<Set<string>> {
  const out = new Set<string>();
  const walk = async (rel: string): Promise<void> => {
    const abs = join(root, rel);
    const entries = await readdir(abs, { withFileTypes: true });
    for (const ent of entries) {
      const childRel = rel === "" ? ent.name : rel + "/" + ent.name;
      if (ent.isDirectory()) await walk(childRel);
      else if (ent.isFile()) out.add(childRel);
    }
  };
  await walk("");
  return out;
}

async function fileSha256(p: string): Promise<string> {
  return createHash("sha256").update(await readFile(p)).digest("hex");
}

/** 变更文件集合：pristine vs work 两棵树逐文件内容对比（含新增/删除/内容改动）。纯函数（只读 IO）。 */
export async function changedFilesBetween(pristine: string, work: string): Promise<string[]> {
  const pristineFiles = await collectRelFiles(pristine);
  const workFiles = await collectRelFiles(work);
  const changed: string[] = [];
  for (const rel of workFiles) {
    if (!pristineFiles.has(rel)) {
      changed.push(rel); // 新增
      continue;
    }
    const [ph, wh] = await Promise.all([fileSha256(join(pristine, rel)), fileSha256(join(work, rel))]);
    if (ph !== wh) changed.push(rel);
  }
  for (const rel of pristineFiles) {
    if (!workFiles.has(rel)) changed.push(rel); // 删除
  }
  return changed.sort();
}
