// 实验存储（Cairn Evolve · P2）：预注册记录不可变，分析结果另文件；不自动改运行面。
//
// 目录：`.agent/evolve/experiments/<id>.json`（预注册）与 `<id>.results.json`（分析快照）。
// Episode 通过 assignment.experimentId 归入实验；unknown 结局单列，不折成失败。

import { mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  aggregateExperimentSamplesBySession,
  analyzeExperiment,
  validateExperiment,
  type ExperimentAnalysis,
  type ExperimentRecord,
  type ExperimentSample,
} from "../../agent/evolve/experiment";
import { writeFileAtomic } from "../../atomic-write";
import { loadEpisodesWithUserFeedback } from "./episode-store";
import { evolveDirFor } from "./paths";
import { isRecord } from "../../is-record";

export const EXPERIMENTS_DIR = "experiments";

export function experimentsDirFor(workspace: string): string {
  return join(evolveDirFor(workspace), EXPERIMENTS_DIR);
}

export function experimentPathFor(workspace: string, id: string): string {
  return join(experimentsDirFor(workspace), id + ".json");
}

export function experimentResultsPathFor(workspace: string, id: string): string {
  return join(experimentsDirFor(workspace), id + ".results.json");
}

/** 预注册记录不可变：同 id 第二次 create 直接拒绝。 */
export async function createExperiment(workspace: string, record: ExperimentRecord): Promise<string> {
  const issues = validateExperiment(record);
  if (issues.length > 0) throw new Error("实验不合法：" + issues.join("；"));
  const path = experimentPathFor(workspace, record.id);
  const exists = await readFile(path, "utf8").then(() => true, () => false);
  if (exists) throw new Error("实验 " + record.id + " 已存在（预注册不可覆盖）");
  await mkdir(experimentsDirFor(workspace), { recursive: true });
  await writeFileAtomic(path, JSON.stringify(record, null, 2) + "\n");
  return path;
}

/** 读预注册记录；缺失/坏档 = null（调用方出声，不编一个空实验）。 */
export async function loadExperiment(workspace: string, id: string): Promise<ExperimentRecord | null> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(experimentPathFor(workspace, id), "utf8"));
  } catch {
    return null;
  }
  if (!isRecord(raw)) return null;
  const record = raw as unknown as ExperimentRecord;
  return validateExperiment(record).length === 0 ? record : null;
}

/** 列出可用实验（跳过坏档与结果文件）。 */
export async function listExperiments(workspace: string): Promise<ExperimentRecord[]> {
  let names: string[];
  try {
    names = await readdir(experimentsDirFor(workspace));
  } catch {
    return [];
  }
  const out: ExperimentRecord[] = [];
  for (const name of names.sort()) {
    if (!name.endsWith(".json") || name.endsWith(".results.json")) continue;
    const record = await loadExperiment(workspace, name.slice(0, -".json".length));
    if (record !== null) out.push(record);
  }
  return out.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export async function writeExperimentAnalysis(workspace: string, analysis: ExperimentAnalysis): Promise<string> {
  const path = experimentResultsPathFor(workspace, analysis.experimentId);
  await mkdir(experimentsDirFor(workspace), { recursive: true });
  await writeFileAtomic(path, JSON.stringify(analysis, null, 2) + "\n");
  return path;
}

export async function loadExperimentAnalysis(
  workspace: string,
  id: string,
): Promise<ExperimentAnalysis | null> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(experimentResultsPathFor(workspace, id), "utf8"));
  } catch {
    return null;
  }
  if (!isRecord(raw) || raw.v !== 1 || raw.experimentId !== id) return null;
  return raw as unknown as ExperimentAnalysis;
}

export interface ExperimentRunResult {
  record: ExperimentRecord;
  analysis: ExperimentAnalysis;
  samples: ExperimentSample[];
  unknownEpisodes: number;
}

/** 从 Episode 账与 assignment 按会话单元聚合样本，按预注册规则裁决并落结果；不晋升、不改 status。 */
export async function analyzeExperimentById(workspace: string, id: string): Promise<ExperimentRunResult> {
  const record = await loadExperiment(workspace, id);
  if (record === null) throw new Error("实验不存在或坏档：" + id);
  const loaded = await loadEpisodesWithUserFeedback(workspace);
  const aggregated = aggregateExperimentSamplesBySession(record, loaded.episodes);
  const analysis = analyzeExperiment(record, aggregated.samples, aggregated.unknownEpisodes, {
    unknownControl: aggregated.unknownControl,
    unknownTreatment: aggregated.unknownTreatment,
    totalRuns: aggregated.totalRuns,
  });
  await writeExperimentAnalysis(workspace, analysis);
  return {
    record,
    analysis,
    samples: aggregated.samples,
    unknownEpisodes: aggregated.unknownEpisodes,
  };
}
