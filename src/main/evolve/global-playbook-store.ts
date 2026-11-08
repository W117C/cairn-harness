// 全局 playbook 存储（Cairn Evolve · 全局晋升）：owner 显式晋升的跨 workspace 经验。
//
// 边界：全局账与 workspace 账同一套 PlaybookOp/fold 口径（loadPlaybookFile），不另写格式；
// 位置默认 `<home>/.config/cairn/evolve`（与全局记忆同根），测试用 CAIRN_EVOLVE_HOME 覆盖。
// 全局 STOP 与 workspace STOP 分开：全局冻结只挡全局经验的注入/晋升，不改变局部账。

import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { PlaybookOp } from "../../agent/evolve/playbook";
import {
  appendPlaybookEventsAt,
  loadPlaybookFile,
  type AppendPlaybookResult,
  type LoadedPlaybook,
} from "./playbook-store";

export const GLOBAL_PLAYBOOK_FILE = "playbook.jsonl";
export const GLOBAL_STOP_FILE = "STOP";

export function globalEvolveDir(): string {
  return process.env.CAIRN_EVOLVE_HOME ?? join(homedir(), ".config", "cairn", "evolve");
}

export function globalPlaybookPath(): string {
  return join(globalEvolveDir(), GLOBAL_PLAYBOOK_FILE);
}

export function globalEvolveStopPath(): string {
  return join(globalEvolveDir(), GLOBAL_STOP_FILE);
}

/** 全局 STOP 是否存在；读不到（含目录不存在）按未冻结处理。 */
export async function isGlobalEvolveFrozen(): Promise<boolean> {
  try {
    await stat(globalEvolveStopPath());
    return true;
  } catch {
    return false;
  }
}

/** owner 全局治理：冻结写 STOP、解冻删 STOP（幂等；与 workspace STOP 分开）。 */
export async function setGlobalEvolveFrozen(frozen: boolean): Promise<void> {
  const path = globalEvolveStopPath();
  if (!frozen) {
    await rm(path, { force: true });
    return;
  }
  await mkdir(globalEvolveDir(), { recursive: true });
  await writeFile(path, "frozen by owner (global)\n", "utf8");
}

export async function loadGlobalPlaybook(): Promise<LoadedPlaybook> {
  return loadPlaybookFile(globalPlaybookPath());
}

export async function appendGlobalPlaybookEvents(
  events: readonly PlaybookOp[],
): Promise<AppendPlaybookResult> {
  return appendPlaybookEventsAt(globalPlaybookPath(), events);
}
