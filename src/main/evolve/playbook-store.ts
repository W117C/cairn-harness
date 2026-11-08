// Playbook 存储（Cairn Evolve · P1）：追加式 delta 账为事实源，索引是可重建投影。
//
// 与 Episode 存储同一族纪律：坏行只丢一条、读侧投影、原子写索引。
// 迁移（legacy）只产出 candidate：旧 evolution.json 的补丁、memory 的 lesson/workflow
// 都没有 Episode id 作为可核验证据，因此不能直接 active；它们进 shadow 先看命中与噪声。

import { digestOf } from "../../agent/evolve/digest";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { loadEvolution, patchKeyOf, type StrategyPatch } from "../../agent/evolution";
import {
  applyPlaybookEvents,
  detectConflicts,
  newExperience,
  validateExperience,
  type ExperienceEntry,
  type ExperienceKind,
  type ExperienceTrigger,
  type PlaybookOp,
  type PlaybookRefusal,
} from "../../agent/evolve/playbook";
import { MEMORY_INDEX, parseIndex, projectMemoryDir, readTopicBody } from "../../agent/memory/store";
import { writeFileAtomic } from "../../atomic-write";
import { evolveDirFor } from "./paths";
import { isEvolveFrozen, loadEvolveBudget } from "./governance";
import { isRecord } from "../../is-record";

export const PLAYBOOK_FILE = "playbook.jsonl";
export const PLAYBOOK_INDEX_FILE = "playbook.index.json";

export function playbookPathFor(workspace: string): string {
  return join(evolveDirFor(workspace), PLAYBOOK_FILE);
}

export function playbookIndexPathFor(workspace: string): string {
  return join(evolveDirFor(workspace), PLAYBOOK_INDEX_FILE);
}

function legacyId(seed: string): string {
  return "exp_" + digestOf("legacy:" + seed);
}

/** 单行 parse：只验到「可交给纯 fold」的形状；语义拒单由 applyPlaybookEvents 出声。 */
export function parsePlaybookLine(line: string): PlaybookOp | null {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isRecord(raw) || raw.v !== 1 || typeof raw.op !== "string") return null;
  return raw as unknown as PlaybookOp;
}

export interface LoadedPlaybook {
  events: PlaybookOp[];
  entries: ExperienceEntry[];
  refusals: PlaybookRefusal[];
  badLines: number;
}

/** 读整份 playbook 账；文件缺失 = 空账；坏行只丢一条；语义拒单保留出声。 */
export async function loadPlaybook(workspace: string): Promise<LoadedPlaybook> {
  return loadPlaybookFile(playbookPathFor(workspace));
}

/** 任一 playbook 文件（全局账也用它）：同一套 parse/fold 口径，不另写第二份。 */
export async function loadPlaybookFile(path: string): Promise<LoadedPlaybook> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return { events: [], entries: [], refusals: [], badLines: 0 };
  }
  const events: PlaybookOp[] = [];
  let badLines = 0;
  for (const line of raw.split("\n")) {
    if (line.trim().length === 0) continue;
    const parsed = parsePlaybookLine(line);
    if (parsed === null) {
      badLines += 1;
      continue;
    }
    events.push(parsed);
  }
  const applied = applyPlaybookEvents(events);
  return { events, entries: applied.entries, refusals: applied.refusals, badLines };
}

export interface AppendPlaybookResult {
  path: string;
  written: number;
}

/** 追加 delta；不在这里做语义校验（读侧 fold 才是唯一判据）。 */
export async function appendPlaybookEvents(
  workspace: string,
  events: readonly PlaybookOp[],
): Promise<AppendPlaybookResult> {
  return appendPlaybookEventsAt(playbookPathFor(workspace), events);
}

/** 任一 playbook 文件的追加口（全局账也用它）：调用方负责目录创建在同一口径。 */
export async function appendPlaybookEventsAt(
  path: string,
  events: readonly PlaybookOp[],
): Promise<AppendPlaybookResult> {
  if (events.length === 0) return { path, written: 0 };
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, events.map((event) => JSON.stringify(event)).join("\n") + "\n", "utf8");
  return { path, written: events.length };
}

export interface PlaybookIndexRecord {
  v: 1;
  ts: number;
  entries: Array<Pick<ExperienceEntry, "id" | "kind" | "status" | "scope" | "trigger" | "expiresAt" | "updatedAt" | "evidence">>;
  conflicts: number;
  refusals: number;
  badLines: number;
}

/** 重建索引（原子写）；索引是投影，不是事实源。 */
export async function writePlaybookIndex(
  workspace: string,
): Promise<{ path: string; entries: number; conflicts: number }> {
  const loaded = await loadPlaybook(workspace);
  const conflicts = detectConflicts(loaded.entries);
  const path = playbookIndexPathFor(workspace);
  const record: PlaybookIndexRecord = {
    v: 1,
    ts: Date.now(),
    entries: loaded.entries.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      status: entry.status,
      scope: entry.scope,
      trigger: entry.trigger,
      expiresAt: entry.expiresAt,
      updatedAt: entry.updatedAt,
      evidence: entry.evidence,
    })),
    conflicts: conflicts.length,
    refusals: loaded.refusals.length,
    badLines: loaded.badLines,
  };
  await mkdir(evolveDirFor(workspace), { recursive: true });
  await writeFileAtomic(path, JSON.stringify(record, null, 2) + "\n");
  return { path, entries: loaded.entries.length, conflicts: conflicts.length };
}

function legacyEntry(input: {
  workspace: string;
  seed: string;
  kind: ExperienceKind;
  trigger: ExperienceTrigger;
  body: string;
  now: number;
  pipeline: string;
}): ExperienceEntry | null {
  const body = input.body.replace(/\s+/gu, " ").trim().slice(0, 800);
  if (body.length === 0) return null;
  return newExperience({
    id: legacyId(input.seed),
    kind: input.kind,
    scope: { workspace: input.workspace },
    trigger: input.trigger,
    body,
    evidenceEpisodes: [],
    generator: "legacy",
    pipeline: input.pipeline,
    now: input.now,
  });
}

function patchTrigger(patch: StrategyPatch): ExperienceTrigger {
  switch (patch.kind) {
    case "verify-escalate":
      return { when: "on-signal", signal: "verify-cause:" + patch.cause };
    case "goal-reconfirm":
      return { when: "on-signal", signal: "goal-drift" };
    case "cost-throttle":
      return { when: "on-signal", signal: "cost-high" };
  }
}

async function evolutionCandidates(workspace: string, now: number): Promise<ExperienceEntry[]> {
  const record = await loadEvolution(workspace);
  if (record === null) return [];
  const out: ExperienceEntry[] = [];
  for (const patch of record.patches) {
    const entry = legacyEntry({
      workspace,
      seed: "evolution:" + patchKeyOf(patch),
      kind: patch.kind === "cost-throttle" ? "policy" : "warning",
      trigger: patchTrigger(patch),
      body: patch.note,
      now,
      pipeline: "legacy-evolution-v1",
    });
    if (entry !== null) out.push(entry);
  }
  return out;
}

function lessonTrigger(topic: string): ExperienceTrigger {
  if (topic.includes("verify-red")) return { when: "on-signal", signal: "verify:red" };
  if (topic.includes("repeat-action")) return { when: "on-signal", signal: "repeat-action" };
  if (topic.startsWith("lesson-tool-streak-")) {
    return { when: "on-tool", signal: topic.slice("lesson-tool-streak-".length) };
  }
  if (topic.startsWith("lesson-not-executed-")) {
    return { when: "on-tool", signal: topic.slice("lesson-not-executed-".length) };
  }
  return { when: "on-signal", signal: "memory-lesson" };
}

async function memoryCandidates(workspace: string, now: number): Promise<ExperienceEntry[]> {
  const dir = projectMemoryDir(workspace);
  let raw: string;
  try {
    raw = await readFile(join(dir, MEMORY_INDEX), "utf8");
  } catch {
    return [];
  }
  const out: ExperienceEntry[] = [];
  for (const item of parseIndex(raw)) {
    const isLesson = item.topic.startsWith("lesson-");
    const isWorkflow = item.topic.startsWith("workflow-");
    if (!isLesson && !isWorkflow) continue;
    let body: string | null;
    try {
      body = await readTopicBody(dir, item.topic);
    } catch {
      continue;
    }
    if (body === null) continue;
    const entry = legacyEntry({
      workspace,
      seed: "memory:" + item.topic,
      kind: isWorkflow ? "strategy" : "warning",
      trigger: isWorkflow ? { when: "always" } : lessonTrigger(item.topic),
      body,
      now,
      pipeline: "legacy-memory-v1",
    });
    if (entry !== null) out.push(entry);
  }
  return out;
}

export interface SeedPlaybookOptions {
  now?: number;
}

export interface SeedPlaybookResult {
  path: string;
  proposed: number;
  added: number;
  skippedExisting: number;
  skippedInvalid: number;
  /** STOP 冻结时 true；本函数不写任何东西。 */
  frozen?: boolean;
  /** playbook 已达预算上限时 true；本函数不写任何东西。 */
  budgetBlocked?: boolean;
}

/** 把旧 evolution.json / memory 的 lesson+workflow 迁成 candidate；同 id 不重写。 */
export async function seedPlaybookFromLegacy(
  workspace: string,
  options: SeedPlaybookOptions = {},
): Promise<SeedPlaybookResult> {
  const now = options.now ?? Date.now();
  const path = playbookPathFor(workspace);
  if (await isEvolveFrozen(workspace)) {
    return { path, proposed: 0, added: 0, skippedExisting: 0, skippedInvalid: 0, frozen: true };
  }
  const budget = (await loadEvolveBudget(workspace)).budget;
  const loaded = await loadPlaybook(workspace);
  if (loaded.entries.length >= budget.maxPlaybookEntries) {
    return { path, proposed: 0, added: 0, skippedExisting: 0, skippedInvalid: 0, budgetBlocked: true };
  }
  const existing = new Set(loaded.entries.map((entry) => entry.id));
  const candidates = [
    ...await evolutionCandidates(workspace, now),
    ...await memoryCandidates(workspace, now),
  ];
  const ops: PlaybookOp[] = [];
  let skippedExisting = 0;
  let skippedInvalid = 0;
  for (const candidate of candidates) {
    if (existing.has(candidate.id)) {
      skippedExisting += 1;
      continue;
    }
    const issues = validateExperience(candidate);
    if (issues.length > 0) {
      skippedInvalid += 1;
      continue;
    }
    ops.push({
      v: 1,
      op: "add",
      ts: now,
      entry: candidate,
      evidence: candidate.evidence.episodes,
      reason: "legacy migration",
    });
    existing.add(candidate.id);
  }
  if (ops.length > 0) await appendPlaybookEvents(workspace, ops);
  return {
    path,
    proposed: candidates.length,
    added: ops.length,
    skippedExisting,
    skippedInvalid,
  };
}
