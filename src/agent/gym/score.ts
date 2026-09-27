// M5a 靶场评分（§m5-proposal 步骤 3，纯函数）：主指标 = verify 全绿 && 必改文件都改了 &&
// 禁改文件没动 → 1，否则 0。副指标（usage/turns/改动数）由 runner 层统计。
// 2026-09-23 补 `judgeCase`：`expect.maxTurns` 此前只在 `gym-check` B1c 被断言、评分侧零消费者 ⇒
// 一条「跑了 30 轮最后放弃」的跑照样记 1 分。补的是**正交**的一格读数（stalled），0/1 逐字不变。
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { GymExpect } from "./case";

export interface GymScoreInput {
  verifyOk: boolean;
  /** 实际变更的文件（case repo 相对路径，/ 分隔）。 */
  changedFiles: string[];
  /** 这次跑实际发生的工具调用数（runner 从事件面数出来，不是模型自陈）。 */
  turns?: number;
}

/** 一次 case 跑的**两只**读数：0/1 正确性 + 是否超轮数预算（stall）。
 *  为什么不压成同一个数：外部（SWE-Effi / AgentRewardBench）反复出现的那类混淆是把「结果对不对」与
 *  「代价可不可接受」塞进同一个 pass/fail —— 压进去之后，一次「多派了个 worker 但最终修好了」的改进
 *  会被记 0 分，读者从此看不见真信号。所以 `stalled` 是正交的一格，`score` 逐字不变。 */
export interface GymOutcome {
  score: number;
  stalled: boolean;
  /** 判出来的原因（哪条没满足 / 超了多少轮）。不写成散文：单测与门都读它。 */
  reasons: string[];
}

export function judgeCase(expect: GymExpect, input: GymScoreInput): GymOutcome {
  const reasons: string[] = [];
  if (expect.mustPassVerify && input.verifyOk !== true) reasons.push("verify 未过");
  const required = expect.mustChangeFiles ?? [];
  const forbidden = expect.mustNotChangeFiles ?? [];
  const missing = required.filter((f) => !input.changedFiles.includes(f));
  if (missing.length > 0) reasons.push("必改文件缺：" + missing.join(","));
  const touched = forbidden.filter((f) => input.changedFiles.includes(f));
  if (touched.length > 0) reasons.push("禁改文件动了：" + touched.join(","));
  // 边界：turns === maxTurns 算在预算内（既有 gym-check B1c 用的就是 `<=`，两处一把尺）
  const budget = expect.maxTurns;
  const stalled = budget !== undefined && input.turns !== undefined && input.turns > budget;
  if (stalled) reasons.push("超轮数预算：" + String(input.turns) + " > " + String(budget));
  // 只有正确性那三条进 score；stall 单独一格（混进 score 就是上面说的那个混淆）
  const correctnessFail = reasons.some((r) => !r.startsWith("超轮数预算"));
  return { score: correctnessFail ? 0 : 1, stalled, reasons };
}

/** 兼容入口：只要 0/1 的调用方照旧。 */
export function scoreCase(expect: GymExpect, input: GymScoreInput): number {
  return judgeCase(expect, input).score;
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
