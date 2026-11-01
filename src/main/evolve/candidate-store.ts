// 候选档案存储（Cairn Evolve · P3）：每个候选取一个 JSON 快照，状态可更新（draft→…→promoted）。
// 档案不是事实源：事实仍是 Episode/Experiment/Playbook；这里的评分与族谱用于父代采样与审计。

import { mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { validateCandidate, type CandidateRecord } from "../../agent/evolve/candidates";
import { writeFileAtomic } from "../../atomic-write";
import { evolveDirFor } from "./paths";
import { isRecord } from "../../is-record";

export const CANDIDATES_DIR = "candidates";

export function candidatesDirFor(workspace: string): string {
  return join(evolveDirFor(workspace), CANDIDATES_DIR);
}

export function candidatePathFor(workspace: string, id: string): string {
  return join(candidatesDirFor(workspace), id + ".json");
}

export async function loadCandidate(workspace: string, id: string): Promise<CandidateRecord | null> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(candidatePathFor(workspace, id), "utf8"));
  } catch {
    return null;
  }
  if (!isRecord(raw)) return null;
  const candidate = raw as unknown as CandidateRecord;
  return validateCandidate(candidate).length === 0 ? candidate : null;
}

/** 新建候选；同 id 已存在 ⇒ 拒绝（状态更新走 saveCandidate）。 */
export async function createCandidate(workspace: string, candidate: CandidateRecord): Promise<string> {
  const issues = validateCandidate(candidate);
  if (issues.length > 0) throw new Error("候选不合法：" + issues.join("；"));
  const path = candidatePathFor(workspace, candidate.id);
  const exists = await readFile(path, "utf8").then(() => true, () => false);
  if (exists) throw new Error("候选 " + candidate.id + " 已存在");
  await mkdir(candidatesDirFor(workspace), { recursive: true });
  await writeFileAtomic(path, JSON.stringify(candidate, null, 2) + "\n");
  return path;
}

/** 状态/晋升字段更新；不新建 id。 */
export async function saveCandidate(workspace: string, candidate: CandidateRecord): Promise<string> {
  const issues = validateCandidate(candidate);
  if (issues.length > 0) throw new Error("候选不合法：" + issues.join("；"));
  const path = candidatePathFor(workspace, candidate.id);
  await mkdir(candidatesDirFor(workspace), { recursive: true });
  await writeFileAtomic(path, JSON.stringify(candidate, null, 2) + "\n");
  return path;
}

/** 列表：新档案在前；坏档跳过（CLI 可另报）。 */
export async function listCandidates(workspace: string): Promise<CandidateRecord[]> {
  let names: string[];
  try {
    names = await readdir(candidatesDirFor(workspace));
  } catch {
    return [];
  }
  const out: CandidateRecord[] = [];
  for (const name of names.sort()) {
    if (!name.endsWith(".json")) continue;
    const candidate = await loadCandidate(workspace, name.slice(0, -".json".length));
    if (candidate !== null) out.push(candidate);
  }
  return out.sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
