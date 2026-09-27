import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

/** 判卷表路径 = **唯一事实源**：下面的 sha 校验与权限层的「判卷面硬闸」都读这一处，
 *  第二份字面量就是本仓点名的「同族出口策略副本」（一张表两个地址 ⇒ 改一处即静默失配）。 */
export const FROZEN_TABLE_REL = join("scripts", "frozen-sha256.json");

const judgeSetCache = new Map<string, ReadonlySet<string>>();

/** 该工作区声明的判卷文件集合（= 冻结表的键集，归一成 `/` 分隔的工作区相对路径）。
 *  · 表不存在 ⇒ **空集**：用户自己的仓库没有这张表 ⇒ 本条闸零行为，不强加我们的判卷纪律。
 *  · 表存在但解析不出对象 / 键数为 0 ⇒ **显式抛**：静默折成「这个工作区没有判卷面」
 *    等于把刚建起来的闸从最省事的地方拆掉（清空一张表比改一行代码安静得多）。
 *  按 root 缓存：这张表只在收口时变，热路径（每次工具调用前评估）不该反复读盘。 */
export function frozenJudgePathSet(root: string): ReadonlySet<string> {
  const hit = judgeSetCache.get(root);
  if (hit !== undefined) return hit;
  const file = join(root, FROZEN_TABLE_REL);
  let set: ReadonlySet<string> = new Set<string>();
  if (existsSync(file)) {
    const raw = JSON.parse(readFileSync(file, "utf8")) as unknown;
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(`判卷表不是对象（${file}）——判卷面装载失败，拒绝按「无判卷面」继续`);
    }
    const keys = Object.keys(raw as Record<string, unknown>).map((k) => k.split("\\").join("/"));
    if (keys.length === 0) {
      throw new Error(`判卷表为空（${file}）——0 条判卷文件不是"没有判卷面"，是表被清空`);
    }
    set = new Set(keys);
  }
  judgeSetCache.set(root, set);
  return set;
}

// 判卷文件完整性校验：对照 scripts/frozen-sha256.json 的冻结基线。
// e2e 与真实模型运行共用；任何判卷文件被改动都会被抓住。
export async function sha256MatchesFrozen(root: string): Promise<{ ok: boolean; broken?: string }> {
  return await sha256MatchesFrozenFile(root, FROZEN_TABLE_REL);
}

/** H7（审查 P2）：冻结覆盖漂移——冻结表是白名单枚举，**新增**判卷文件不会被发现。
 *  对判卷区（fixtures/mock/** + fixtures/todo-app/tests/** + M5a fixtures/gym/cases/**
 *  + M7 fixtures/impact/** + 能力 14 fixtures/no-progress/**）
 *  做目录枚举并与冻结表双向比对。
 *  M5a 扩展：fixtures/gym/index.json 是 case 清单（判据），单文件不属目录区，显式并入盘上集合。
 *
 *  两个方向的语义各自不同，别再混成一件事（2026-09-23 实踩，见下面的 `tableDirsNotSwept`）：
 *  · `onDiskNotInTable` = **区内的盘上集合** 减 表 ⇒ 这一维必须按区枚举（"没入表的新判卷文件"）。
 *  · `inTableNotOnDisk` = **表里每条自己存不存在**。原先写成"表 减 盘上集合"，而盘上集合只覆盖已登记区
 *    ⇒ 任何**新判卷区**（第一个案例就是刚冻结的 fixtures/no-progress 7 条）一入表就被读成"盘上没有"，
 *    门红得理直气壮而文件好好地在那儿——那是判据越界，不是产品说谎。
 *  · `tableDirsNotSwept` = 表里出现、但不属于任何已登记区的目录 ⇒ **显式登记**才能享受"新文件不漏"那一维。
 *    不登记不是错，但也不能静默：机制覆盖不到的东西必须自己说出来（同族：未证 ≠ 通过）。 */
export async function frozenCoverageDrift(root: string): Promise<{
  onDiskNotInTable: string[]; inTableNotOnDisk: string[]; tableDirsNotSwept: string[];
}> {
  const areas = [
    join("fixtures", "mock"), join("fixtures", "todo-app", "tests"),
    join("fixtures", "gym", "cases"), join("fixtures", "impact"),
    join("fixtures", "no-progress"),
  ].map((a) => a.replaceAll("\\", "/"));
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
  for (const area of areas) await walk(area);
  let table: string[] = [];
  try {
    const frozen = JSON.parse(await readFile(join(root, "scripts", "frozen-sha256.json"), "utf8")) as Record<string, string>;
    table = Object.keys(frozen).map((k) => k.split("\\").join("/"));
  } catch {
    /* 表读取失败由 sha256MatchesFrozen 负责，本函数只做集合比对 */
  }
  const tableSet = new Set(table);
  const inSweptArea = (rel: string): boolean =>
    areas.some((a) => rel.startsWith(a + "/")) || extraFiles.includes(rel);
  // 存在性逐条 stat（不看区）：表里的东西消失 = 陈旧条目，无论它住在哪个目录。
  const missing: string[] = [];
  for (const rel of table) {
    if (!(await stat(join(root, rel)).then(() => true, () => false))) missing.push(rel);
  }
  return {
    onDiskNotInTable: onDisk.filter((f) => !tableSet.has(f)).sort(),
    inTableNotOnDisk: missing.sort(),
    tableDirsNotSwept: [...new Set(table.filter((f) => !inSweptArea(f)).map((f) => dirname(f)))].sort(),
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
