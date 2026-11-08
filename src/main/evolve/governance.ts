// Evolve 治理面（Cairn Evolve · P5）：kill switch 与预算读数。
//
// STOP 文件存在 = 冻结：不注入、不晋升、不写技能候选；只允许读与报告。
// budget.json 是 TCB 侧的可调上限；缺失 = 缺省，坏档 = 缺省 + 出声（不静默放宽）。
// 本模块不写预算文件，也不允许候选修改它；STOP 只由人工治理入口（桌面/CLI）写。

import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { evolveDirFor } from "./paths";
import { isRecord } from "../../is-record";

export const EVOLVE_STOP_FILE = "STOP";
export const EVOLVE_BUDGET_FILE = "budget.json";

export function evolveStopPathFor(workspace: string): string {
  return join(evolveDirFor(workspace), EVOLVE_STOP_FILE);
}

export function evolveBudgetPathFor(workspace: string): string {
  return join(evolveDirFor(workspace), EVOLVE_BUDGET_FILE);
}

/** STOP 存在即冻结；读不到（ENOENT 等）按未冻结。 */
export async function isEvolveFrozen(workspace: string): Promise<boolean> {
  try {
    await stat(evolveStopPathFor(workspace));
    return true;
  } catch {
    return false;
  }
}

/** 人工治理：冻结写 STOP、解冻删 STOP（幂等）。报告/候选/runner 无写入口。 */
export async function setEvolveFrozen(workspace: string, frozen: boolean): Promise<void> {
  const path = evolveStopPathFor(workspace);
  if (!frozen) {
    await rm(path, { force: true });
    return;
  }
  await mkdir(evolveDirFor(workspace), { recursive: true });
  await writeFile(path, "frozen by owner\n", "utf8");
}

export interface EvolveBudget {
  maxPlaybookEntries: number;
  maxInjectedEntries: number;
  maxInjectedChars: number;
  maxExperiments: number;
  maxCandidates: number;
}

export const DEFAULT_EVOLVE_BUDGET: Readonly<EvolveBudget> = Object.freeze({
  maxPlaybookEntries: 200,
  maxInjectedEntries: 6,
  maxInjectedChars: 2_000,
  maxExperiments: 20,
  maxCandidates: 200,
});

export interface LoadedEvolveBudget {
  budget: EvolveBudget;
  source: "default" | "file" | "invalid";
  detail: string | null;
}

const LIMITS: Readonly<Record<keyof EvolveBudget, [number, number]>> = {
  maxPlaybookEntries: [1, 2_000],
  maxInjectedEntries: [1, 20],
  maxInjectedChars: [200, 8_000],
  maxExperiments: [1, 200],
  maxCandidates: [1, 2_000],
};

/** 读预算：缺失 = 缺省；坏档 = 缺省 + source invalid（不静默放宽，也不静默收紧）。 */
export async function loadEvolveBudget(workspace: string): Promise<LoadedEvolveBudget> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(evolveBudgetPathFor(workspace), "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      return { budget: { ...DEFAULT_EVOLVE_BUDGET }, source: "default", detail: null };
    }
    return { budget: { ...DEFAULT_EVOLVE_BUDGET }, source: "invalid", detail: "读不动：" + (err instanceof Error ? err.message : String(err)) };
  }
  if (!isRecord(raw)) {
    return { budget: { ...DEFAULT_EVOLVE_BUDGET }, source: "invalid", detail: "不是 JSON 对象" };
  }
  const budget = { ...DEFAULT_EVOLVE_BUDGET };
  for (const key of Object.keys(LIMITS) as Array<keyof EvolveBudget>) {
    const value = raw[key];
    if (value === undefined) continue;
    const [min, max] = LIMITS[key];
    if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
      return { budget: { ...DEFAULT_EVOLVE_BUDGET }, source: "invalid", detail: key + " 越界（" + String(min) + ".." + String(max) + "）" };
    }
    budget[key] = value;
  }
  return { budget, source: "file", detail: null };
}
