// 自进化的持久化层：把补丁落到 `<workspace>/.agent/evolution.json`，下一轮装配时读回。
// 与 settings / bandit 同一口径：原子写（tmp+rename），损坏即 fail-closed（当作无补丁，
// 不静默编一个），读失败不影响主流程（它只是观测/提示，不驱动判据）。

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomic } from "../../atomic-write";
import { hasAdvice, type EvolutionAdvice } from "./advice";
import type { PatchEffect } from "./patch-effect";
import type { StrategyPatch } from "./strategy-patch";

export const EVOLUTION_FILE = "evolution.json";

export function evolutionPathFor(workspace: string): string {
  return join(workspace, ".agent", EVOLUTION_FILE);
}

export interface EvolutionRecord {
  version: 1;
  /** 产生这批补丁的会话日志路径（证据指针，可追溯）。 */
  fromSession?: string;
  patches: StrategyPatch[];
  /** 跨轮闭环：上一轮补丁对本轮读数的效果评估（旧记录缺这一栏 = 还没评过，不当成"全消解"）。 */
  effects?: PatchEffect[];
  /** 跨轮闭环：本轮读数推出的路由/上下文建议（空建议不落这一栏）。 */
  advice?: EvolutionAdvice;
  /** 写入时间（epoch ms）。 */
  ts: number;
}

/** 落盘的附加栏（跨轮闭环）；缺省 = 与从前逐字同形的记录（旧读者不受影响）。 */
export interface EvolutionExtras {
  effects?: PatchEffect[];
  advice?: EvolutionAdvice;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStrategyPatch(value: unknown): value is StrategyPatch {
  if (!isRecord(value) || typeof value.note !== "string") return false;
  if (value.kind === "verify-escalate") {
    return typeof value.cause === "string" && typeof value.times === "number" && Number.isFinite(value.times);
  }
  if (value.kind === "goal-reconfirm") {
    return typeof value.driftCount === "number" && Number.isFinite(value.driftCount);
  }
  if (value.kind === "cost-throttle") {
    return value.tokensPerBoundary === null
      || (typeof value.tokensPerBoundary === "number" && Number.isFinite(value.tokensPerBoundary));
  }
  return false;
}

function isPatchEffect(value: unknown): value is PatchEffect {
  return isRecord(value)
    && (value.kind === "verify-escalate" || value.kind === "goal-reconfirm" || value.kind === "cost-throttle")
    && typeof value.key === "string"
    && (value.status === "resolved" || value.status === "recurred" || value.status === "inconclusive")
    && (value.disposition === "drop" || value.disposition === "keep" || value.disposition === "escalate" || value.disposition === "observe")
    && typeof value.observed === "string"
    && isStrategyPatch(value.patch)
    && value.patch.kind === value.kind;
}

function isEvolutionAdvice(value: unknown): value is EvolutionAdvice {
  return isRecord(value)
    && (value.preferredTier === null || value.preferredTier === "cheap")
    && (value.contextAction === null || value.contextAction === "compress-early" || value.contextAction === "stop-after-boundary")
    && Array.isArray(value.reasons)
    && value.reasons.every((reason) => typeof reason === "string");
}

export async function persistEvolution(
  workspace: string,
  patches: StrategyPatch[],
  fromSession?: string,
  extras?: EvolutionExtras,
): Promise<string> {
  const path = evolutionPathFor(workspace);
  const effects = extras?.effects ?? [];
  const advice = extras?.advice;
  const record: EvolutionRecord = {
    version: 1,
    ...(fromSession ? { fromSession } : {}),
    patches,
    ...(effects.length > 0 ? { effects } : {}),
    ...(advice !== undefined && hasAdvice(advice) ? { advice } : {}),
    ts: Date.now(),
  };
  await writeFileAtomic(path, JSON.stringify(record, null, 2) + "\n");
  return path;
}

export async function loadEvolution(workspace: string): Promise<EvolutionRecord | null> {
  try {
    const raw = await readFile(evolutionPathFor(workspace), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.patches)) return null;
    if (!parsed.patches.every(isStrategyPatch)) return null;
    if (typeof parsed.ts !== "number" || !Number.isFinite(parsed.ts)) return null;
    if (parsed.fromSession !== undefined && typeof parsed.fromSession !== "string") return null;
    if (parsed.effects !== undefined && (!Array.isArray(parsed.effects) || !parsed.effects.every(isPatchEffect))) return null;
    if (parsed.advice !== undefined && !isEvolutionAdvice(parsed.advice)) return null;
    return parsed as unknown as EvolutionRecord;
  } catch {
    // 缺文件 / 损坏：当作无补丁，不静默编造。
    return null;
  }
}
