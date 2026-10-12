// 自进化的持久化层：把补丁落到 `<workspace>/.agent/evolution.json`，下一轮装配时读回。
// 与 settings / bandit 同一口径：原子写（tmp+rename），损坏即 fail-closed（当作无补丁，
// 不静默编一个），读失败不影响主流程（它只是观测/提示，不驱动判据）。

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomic } from "../../atomic-write";
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
  /** 写入时间（epoch ms）。 */
  ts: number;
}

export async function persistEvolution(
  workspace: string,
  patches: StrategyPatch[],
  fromSession?: string,
): Promise<string> {
  const path = evolutionPathFor(workspace);
  const record: EvolutionRecord = { version: 1, ...(fromSession ? { fromSession } : {}), patches, ts: Date.now() };
  await writeFileAtomic(path, JSON.stringify(record, null, 2) + "\n");
  return path;
}

export async function loadEvolution(workspace: string): Promise<EvolutionRecord | null> {
  try {
    const raw = await readFile(evolutionPathFor(workspace), "utf8");
    const parsed = JSON.parse(raw) as EvolutionRecord;
    if (parsed.version !== 1 || !Array.isArray(parsed.patches)) return null;
    return parsed;
  } catch {
    // 缺文件 / 损坏：当作无补丁，不静默编造。
    return null;
  }
}
