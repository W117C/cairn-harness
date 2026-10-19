// P2-1 空屏建议纯函数：把「这个项目当下最值得做的两三件事」排成可点的建议行。
// 纪律：文案全出处 STR（本文件零裸中文）；回退项不含路径与文件名（不给项目外用户看
// 无从理解的引用）；函数是纯计算——数据装配（三查 + 会话标题）在 App 侧，失败按 null 进来。
import { STR } from "./strings";

export interface QuickStartInput {
  git: { ok: boolean; branch?: string | null; dirtyFiles?: number } | null;
  hasPackageJson: boolean;
  scripts: readonly string[];
  readmeExists: boolean;
  lastSessionTitle: string | null;
}

/** 通用回退建议（不足 3 条时补足；无任何具体文件名）。 */
export const QUICK_START_FALLBACK: readonly string[] = STR.quickStarts.fallback;

/**
 * 排序即优先级表：继续上次 → 未提交改动计数 → 跑测试 → 解释结构；
 * 不足 3 条以 FALLBACK 补足去重（同文不重复上屏）；上限 4 条。
 */
export function buildQuickStarts(input: QuickStartInput): string[] {
  const out: string[] = [];

  const title = input.lastSessionTitle?.trim() ?? "";
  if (title !== "") out.push(STR.quickStarts.continueLast.replace("{title}", title));

  const dirty = input.git !== null && input.git.ok ? (input.git.dirtyFiles ?? 0) : 0;
  if (dirty > 0) out.push(STR.quickStarts.dirty.replace("{n}", String(dirty)));

  if (input.scripts.includes("test")) out.push(STR.quickStarts.runTests);

  if (input.readmeExists) out.push(STR.quickStarts.explain);

  for (const f of QUICK_START_FALLBACK) {
    if (out.length >= 3) break;
    if (!out.includes(f)) out.push(f);
  }
  return out.slice(0, 4);
}

/** 问候语按时段：0–11 早上 / 12–17 下午 / 18–23 晚上（越界小时数取模归一）。 */
export function greetingFor(hour: number): string {
  const h = ((Math.trunc(hour) % 24) + 24) % 24;
  if (h < 12) return STR.empty.greetingMorning;
  if (h < 18) return STR.empty.greetingAfternoon;
  return STR.empty.greetingEvening;
}
