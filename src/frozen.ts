import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

// 判卷文件完整性校验：对照 scripts/frozen-sha256.json 的冻结基线。
// e2e 与真实模型运行共用；任何判卷文件被改动都会被抓住。
export async function sha256MatchesFrozen(root: string): Promise<{ ok: boolean; broken?: string }> {
  return await sha256MatchesFrozenFile(root, join("scripts", "frozen-sha256.json"));
}

/** H7（审查 P2）：冻结覆盖漂移——冻结表是白名单枚举，**新增**判卷文件不会被发现。
 *  对判卷区（fixtures/mock/** + fixtures/todo-app/tests/** + M5a fixtures/gym/cases/**）
 *  做目录枚举并与冻结表双向集合比对：盘上有而表没有（新判卷文件未入表）/ 表有而盘上无（陈旧条目）均记漂移。
 *  M5a 扩展：fixtures/gym/index.json 是 case 清单（判据），单文件不属目录区，显式并入盘上集合。 */
export async function frozenCoverageDrift(root: string): Promise<{ onDiskNotInTable: string[]; inTableNotOnDisk: string[] }> {
  const areas = [join("fixtures", "mock"), join("fixtures", "todo-app", "tests"), join("fixtures", "gym", "cases")];
  const extraFiles = ["fixtures/gym/index.json"];
  // 审查 S3-9（agents 分片 #5）：清单里的单文件过去**无条件**计入盘上集合，文件被删时
  // 它仍在集合里 → 表里也有 → 报不出 inTableNotOnDisk，反而把「判卷文件消失」这件事
  // 遮掉。改为 stat 命中才计入；消失由 sha256 校验之外的这条集合差显式报出。
  const onDisk: string[] = [];
  for (const f of extraFiles) {
    if (await stat(join(root, f)).then(() => true, () => false)) onDisk.push(f);
  }
  const walk = async (rel: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(join(root, rel), { withFileTypes: true });
    } catch {
      return; // 判卷区目录缺失：由 sha256 校验报错，这里不重复报
    }
    for (const ent of entries) {
      const childRel = rel.replaceAll("\\", "/") + "/" + ent.name;
      if (ent.isDirectory()) await walk(childRel);
      else if (ent.isFile()) onDisk.push(childRel);
    }
  };
  for (const area of areas) await walk(area.replaceAll("\\", "/"));
  let table: string[] = [];
  try {
    const frozen = JSON.parse(await readFile(join(root, "scripts", "frozen-sha256.json"), "utf8")) as Record<string, string>;
    table = Object.keys(frozen);
  } catch {
    /* 表读取失败由 sha256MatchesFrozen 负责，本函数只做集合比对 */
  }
  const tableSet = new Set(table);
  const diskSet = new Set(onDisk);
  return {
    onDiskNotInTable: onDisk.filter((f) => !tableSet.has(f)).sort(),
    inTableNotOnDisk: table.filter((f) => !diskSet.has(f)).sort(),
  };
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
