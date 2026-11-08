// 自进化的策略补丁层：把信号变成「下一轮该怎么改」的可审计指令。
// 纯函数：signals ⇒ patches。每条补丁都带证据（cause / eventCount），
// 不编造、不猜——同 lessons 的「无出处不写」纪律。
//
// 代词纪律（2026-10-16）：note 是收尾那一轮写的、**下一轮开工时**读进 system prompt 的。
// 所以正文里的时间代词一律站在读者这一侧说「这一轮」——写「下一轮」会被读成"再往后一轮"。

import type { EvolutionSignals } from "./signal";
import { isEnvVerifyCause } from "../../events";
import type { VerifyCause } from "../../events";

export type StrategyPatch =
  | { kind: "verify-escalate"; cause: string; times: number; note: string }
  | { kind: "goal-reconfirm"; driftCount: number; note: string }
  | { kind: "cost-throttle"; tokensPerBoundary: number | null; note: string };

export const MAX_PATCHES_PER_RUN = 3;

/** 「每次 verified 前进花多少 token 算偏高」的唯一事实源：补丁与跨轮评估（patch-effect）
 *  共用这一份，不许各抄一个 40_000——两处阈值漂了会得到"这轮说贵、上轮说已消解"的账。 */
export const COST_PER_BOUNDARY_LIMIT = 40_000;

/** 从结构化 cause 生成当前口径的 verify 建议；旧记录的 note 不能覆盖已修正的归因语义。 */
export function renderVerifyPatchNote(cause: string, times: number): string {
  const envCause = cause !== "unknown" && isEnvVerifyCause(cause as VerifyCause);
  const advice = envCause
    ? "这是非代码阻塞，按该 cause 恢复验证执行；不要为失败盲目改代码。"
    : cause === "code"
      ? "失败归因是代码问题；这一轮先根据失败输出定位问题并改变诊断或修复路径，不要重复同一改动。"
      : "失败尚未归因；这一轮先查明实际原因，再决定是否改代码，不要臆断为环境问题。";
  return `同一 verify 失败 cause="${cause}" 达到连续失败升级阈值（本跑该 cause 共 ${String(times)} 次）——${advice}`;
}

/** 把信号翻译成策略补丁。纯函数，有界（单跑最多 MAX_PATCHES_PER_RUN 条）。 */
export function strategyPatches(s: EvolutionSignals): StrategyPatch[] {
  const out: StrategyPatch[] = [];

  // 1) 同一 cause 连败 ≥3 ⇒ 升级，按 cause 选择诊断/修复方向。
  if (s.repeatedVerifyCause !== null) {
    const times = s.verifyFailuresByCause[s.repeatedVerifyCause] ?? 0;
    out.push({
      kind: "verify-escalate",
      cause: s.repeatedVerifyCause,
      times,
      note: renderVerifyPatchNote(s.repeatedVerifyCause, times),
    });
  }

  // 2) 目标漂移 >0 ⇒ 下一轮先复述目标再动手。
  if (s.goalDriftCount > 0) {
    out.push({
      kind: "goal-reconfirm",
      driftCount: s.goalDriftCount,
      note: `本跑目标漂移 ${String(s.goalDriftCount)} 处——这一轮开工前先复述当前目标与「不做什么」，对齐了再动手。`,
    });
  }

  // 3) 成本÷前进可测且偏高 ⇒ 提前压缩 + 降档路由。
  // 「可测」这一格走具名判据（costThrottleMeasurable），不在这儿再抄一遍：
  // 抄了就会和跨轮评估（patch-effect）那份分叉——一边说贵、一边说已消解。
  if (costThrottleMeasurable(s) && s.tokensPerBoundary > COST_PER_BOUNDARY_LIMIT) {
    out.push({
      kind: "cost-throttle",
      tokensPerBoundary: s.tokensPerBoundary,
      note: `每次 verified 前进平均花 ${String(s.tokensPerBoundary)} token——这一轮提前压缩上下文、路由优先走便宜档。`,
    });
  }

  return out.slice(0, MAX_PATCHES_PER_RUN);
}

/** 一条 cost-throttle 补丁的**跨轮可判性**：不可测的补丁不接续、不升级。
 *
 *  2026-10-16 修：从前 `!costMeasurable && spendAfterLastBoundary > 0` 既在这里产一条
 *  「该停就停」的补丁，也被 `patch-effect` 读成"死跑复发"从而 escalate。两者的共同前提是把
 *  **不可测**读成**无前进**——而 verified 边界要求配对的 verify 工具调用，harness 自动补跑的
 *  成功验证、产物生成、有效预览都不产生模型侧 verify 调用 ⇒ 边界=0 ⇒ 不可测。于是"生成了产物、
 *  自动检查也过了"的会话照样被判死跑，还把这句话带进下一轮系统提示词。
 *  现在这一族只在**真可测且偏高**时出手；不可测就是不可测（`cost-per-progress` 的原话）。
 *
 *  2026-10-22：这份判据此前是**死导出**（0 引用），而真正在判的两处各抄了一遍内联
 *  （strategyPatches 的出手条件、patch-effect 的评估分支）⇒ 同一条判据三份，具名那一份
 *  反而是没人调的那份——上面的 2026-10-16 裁决就写在没人调用的函数上：改了它，两处行为纹丝不动。
 *  现在它是**唯一事实源**：出手处（strategyPatches）与评估处（patch-effect）都走它。
 *  返回类型是类型守卫：不可测时 tokensPerBoundary 仍是 null，守卫把这一格收窄成 number，
 *  两处于是不必再各写一遍 null 检查（那也是同一判据的第四份抄法）。 */
export function costThrottleMeasurable(
  s: EvolutionSignals,
): s is EvolutionSignals & { costMeasurable: true; tokensPerBoundary: number } {
  return s.costMeasurable && s.tokensPerBoundary !== null;
}

/** 「读数是什么时候记的」的唯一渲染面（epoch ms ⇒ 本地时间 YYYY-MM-DD HH:mm）。
 *
 *  为什么每段提示都要自报时刻（2026-10-16）：这些段落是**上一轮收尾时**写下、**这一轮开工时**
 *  读进 system prompt 的。同一次会话里读起来"就是刚才"，但会话可能隔几天才续——
 *  没有时刻锚，模型会把三天前的读数当成"刚发生的"（代词「本轮」也会顺着这个错觉读错方向）。
 *  记 0 或负数也照渲染（时钟怪值不是省略它的理由）。 */
export function anchorText(ts: number): string {
  const d = new Date(ts);
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${String(d.getFullYear())}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 「（记于 X）」戳；缺省（调用方没给时刻）= 空串（形状与从前逐字一致）。 */
export function recordedAtStamp(recordedAt?: number): string {
  return recordedAt === undefined ? "" : "（记于 " + anchorText(recordedAt) + "）";
}

/** 把补丁渲染成一段给模型看的紧凑提示（进 system prompt，不另起事件类型）。 */
export function renderPatches(patches: readonly StrategyPatch[], recordedAt?: number): string {
  if (patches.length === 0) return "";
  const lines = patches.map((p) => `- ${p.kind === "verify-escalate" ? renderVerifyPatchNote(p.cause, p.times) : p.note}`);
  return `\n\n[evolution] 上一轮的经验（仅供参考，不强制${recordedAt === undefined ? "" : "，记于 " + anchorText(recordedAt)}）：\n${lines.join("\n")}`;
}
