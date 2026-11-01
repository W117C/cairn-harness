// 类型化 playbook（Cairn Evolve · P1）：把“经验”从一段越写越长的提示词，改成
// 带作用域、触发、证据、置信度、过期与冲突关系的条目；写入只接受增量 delta。
//
// 纯函数：给定 entries + 检索上下文 ⇒ 给定选择；不读盘、不取时钟、不调模型。
// 纪律：
//  · 无证据只能建 candidate；active 必须有 Episode 证据；
//  · 只有 active 且未过期才可注入；candidate/shadow 只在 shadow/实验中可检索；
//  · body 增量帽 30%（ACE 的 brevity bias/context collapse 教训）；
//  · 同 scope+trigger 的 active 条目冲突时两条都不注入；
//  · 检索有硬预算（条数/字符），不把整个 playbook 塞进上下文。

import { digestOf } from "./digest";
import { tokensOf } from "../map/retrieve";
import type { EpisodeTaskClass } from "./episode";
import { isRecord } from "../../is-record";

export const PLAYBOOK_POLICY_VERSION = "evolve-v1";

export type ExperienceKind = "fact" | "strategy" | "warning" | "policy";
export type ExperienceStatus = "candidate" | "shadow" | "active" | "dormant" | "deprecated" | "retired";
export type ExperienceGenerator = "rule" | "reflect" | "gepa" | "human" | "legacy";
export type TriggerWhen = "always" | "on-task-class" | "on-signal" | "on-tool" | "on-path";

export interface ExperienceScope {
  /** 绝对工作区路径，或 "*"（只能经显式全局晋升）。 */
  workspace: string;
  taskClass?: EpisodeTaskClass;
  toolchain?: string[];
  pathGlobs?: string[];
}

export interface ExperienceTrigger {
  when: TriggerWhen;
  /** on-signal / on-tool 的定位键；其余触发可缺席。 */
  signal?: string;
  keywords?: string[];
}

export interface ExperienceEvidence {
  episodes: string[];
  failures: string[];
}

export interface ExperienceConfidence {
  /** 只统计“注入了这条且结果可测”的 Episode；用于排序，不用于晋升。 */
  observational: { trials: number; successes: number; failures: number };
  /** 只来自带控制组的实验；P1 只落形状，P2 起填数。 */
  causal: { trials: number; riskDiff: number | null; ci95: [number, number] | null };
}

export interface ExperienceEntry {
  v: 1;
  id: string;
  kind: ExperienceKind;
  scope: ExperienceScope;
  trigger: ExperienceTrigger;
  body: string;
  evidence: ExperienceEvidence;
  provenance: {
    generator: ExperienceGenerator;
    model: string | null;
    pipeline: string;
    digest: string;
  };
  status: ExperienceStatus;
  confidence: ExperienceConfidence;
  budget: { tokens: number; maxPerSession: number };
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number | null;
  expiresAt: number | null;
  supersedes: string[];
  conflictsWith: string[];
  /** 全局晋升（scope.workspace="*"）时的跨 workspace 证据（owner 显式；CLI 校验 ≥3 个 workspace）。
   *  缺席 = 普通 workspace 局部经验。 */
  globalEvidence?: Array<{ workspace: string; episodeId: string }>;
  gates: { passed: string[]; lastRun: number };
}

export interface NewExperienceInput {
  kind: ExperienceKind;
  scope: ExperienceScope;
  trigger: ExperienceTrigger;
  body: string;
  evidenceEpisodes?: readonly string[];
  evidenceFailures?: readonly string[];
  status?: ExperienceStatus;
  generator?: ExperienceGenerator;
  model?: string | null;
  pipeline?: string;
  id?: string;
  now: number;
  expiresAt?: number | null;
  budget?: { tokens: number; maxPerSession: number };
}

export type ExperiencePatchFields = Partial<
  Pick<ExperienceEntry, "body" | "trigger" | "scope" | "budget" | "expiresAt" | "status" | "confidence">
>;

export type PlaybookOp =
  | { v: 1; op: "add"; ts: number; entry: ExperienceEntry; evidence: string[]; reason: string }
  | { v: 1; op: "patch"; ts: number; id: string; fields: ExperiencePatchFields; evidence: string[]; reason: string }
  | { v: 1; op: "deprecate"; ts: number; id: string; evidence: string[]; reason: string }
  | { v: 1; op: "retire"; ts: number; id: string; evidence: string[]; reason: string }
  | { v: 1; op: "merge"; ts: number; ids: string[]; into: ExperienceEntry; evidence: string[]; reason: string }
  | { v: 1; op: "split"; ts: number; id: string; into: ExperienceEntry[]; evidence: string[]; reason: string };

export interface PlaybookRefusal {
  index: number;
  op: string;
  reason: string;
}

export interface ApplyPlaybookResult {
  entries: ExperienceEntry[];
  refusals: PlaybookRefusal[];
}

export interface Conflict {
  a: string;
  b: string;
  reason: string;
}

const KINDS: ReadonlySet<ExperienceKind> = new Set(["fact", "strategy", "warning", "policy"]);
const STATUSES: ReadonlySet<ExperienceStatus> = new Set([
  "candidate", "shadow", "active", "dormant", "deprecated", "retired",
]);
const GENERATORS: ReadonlySet<ExperienceGenerator> = new Set(["rule", "reflect", "gepa", "human", "legacy"]);
const TRIGGERS: ReadonlySet<TriggerWhen> = new Set([
  "always", "on-task-class", "on-signal", "on-tool", "on-path",
]);
const TASK_CLASSES: ReadonlySet<EpisodeTaskClass> = new Set([
  "edit", "debug", "refactor", "test", "explain", "research", "ops", "ui", "other",
]);
const ID_RE = /^exp_[0-9a-f]{16}$/u;
const MAX_BODY_CHARS = 800;
const MAX_BODY_DELTA_RATIO = 0.3;

/** kind 的默认 TTL：policy 变得最快，warning 最耐久。 */
export function defaultTtlMs(kind: ExperienceKind, now: number): number {
  const day = 24 * 60 * 60 * 1000;
  const days = kind === "policy" ? 30 : kind === "strategy" ? 90 : kind === "fact" ? 180 : 365;
  return now + days * day;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

/** 从不可信形状里取证据数组；缺/坏 = 空（随后由 validateExperience 决定是否收）。 */
function evidenceOf(value: unknown): ExperienceEvidence {
  if (!isRecord(value) || !isRecord(value.evidence)) return { episodes: [], failures: [] };
  const episodes = Array.isArray(value.evidence.episodes)
    ? value.evidence.episodes.filter((item): item is string => typeof item === "string")
    : [];
  const failures = Array.isArray(value.evidence.failures)
    ? value.evidence.failures.filter((item): item is string => typeof item === "string")
    : [];
  return { episodes, failures };
}

function entryIdentity(input: {
  kind: ExperienceKind;
  scope: ExperienceScope;
  trigger: ExperienceTrigger;
  body: string;
}): string {
  return digestOf(JSON.stringify({
    kind: input.kind,
    workspace: input.scope.workspace,
    taskClass: input.scope.taskClass ?? null,
    toolchain: [...(input.scope.toolchain ?? [])].sort(),
    pathGlobs: [...(input.scope.pathGlobs ?? [])].sort(),
    when: input.trigger.when,
    signal: input.trigger.signal ?? null,
    keywords: [...(input.trigger.keywords ?? [])].sort(),
    body: input.body,
  }));
}

/** 建一条新经验。id 缺省由 kind+scope+trigger+body 稳定哈希。 */
export function newExperience(input: NewExperienceInput): ExperienceEntry {
  const evidence = {
    episodes: uniqueSorted(input.evidenceEpisodes ?? []),
    failures: uniqueSorted(input.evidenceFailures ?? []),
  };
  return {
    v: 1,
    id: input.id ?? "exp_" + entryIdentity(input),
    kind: input.kind,
    scope: { ...input.scope },
    trigger: { ...input.trigger, ...(input.trigger.keywords ? { keywords: [...input.trigger.keywords] } : {}) },
    body: input.body,
    evidence,
    provenance: {
      generator: input.generator ?? "rule",
      model: input.model ?? null,
      pipeline: input.pipeline ?? PLAYBOOK_POLICY_VERSION,
      digest: digestOf(JSON.stringify({ kind: input.kind, body: input.body, evidence })),
    },
    status: input.status ?? "candidate",
    confidence: {
      observational: { trials: 0, successes: 0, failures: 0 },
      causal: { trials: 0, riskDiff: null, ci95: null },
    },
    budget: input.budget ?? { tokens: 400, maxPerSession: 1 },
    createdAt: input.now,
    updatedAt: input.now,
    lastUsedAt: null,
    expiresAt: input.expiresAt === undefined ? defaultTtlMs(input.kind, input.now) : input.expiresAt,
    supersedes: [],
    conflictsWith: [],
    gates: { passed: [], lastRun: 0 },
  };
}

/** 形状校验：返回问题列表；空数组 = 合法。 */
export function validateExperience(entry: ExperienceEntry): string[] {
  const issues: string[] = [];
  if (entry.v !== 1) issues.push("v 必须为 1");
  if (!ID_RE.test(entry.id)) issues.push("id 必须是 exp_ + 16 位小写十六进制");
  if (!KINDS.has(entry.kind)) issues.push("kind 不在取值域");
  if (!STATUSES.has(entry.status)) issues.push("status 不在取值域");
  if (typeof entry.scope?.workspace !== "string" || entry.scope.workspace.length === 0) {
    issues.push("scope.workspace 必须是非空字符串");
  }
  if (entry.scope?.taskClass !== undefined && !TASK_CLASSES.has(entry.scope.taskClass)) {
    issues.push("scope.taskClass 不在取值域");
  }
  if (entry.scope?.toolchain !== undefined
    && (!Array.isArray(entry.scope.toolchain) || entry.scope.toolchain.some((value) => typeof value !== "string" || value.length === 0))) {
    issues.push("scope.toolchain 必须是非空字符串数组");
  }
  if (entry.scope?.pathGlobs !== undefined
    && (!Array.isArray(entry.scope.pathGlobs) || entry.scope.pathGlobs.some((value) => typeof value !== "string" || value.length === 0))) {
    issues.push("scope.pathGlobs 必须是非空字符串数组");
  }
  if (!TRIGGERS.has(entry.trigger?.when)) issues.push("trigger.when 不在取值域");
  if ((entry.trigger?.when === "on-signal" || entry.trigger?.when === "on-tool")
    && (typeof entry.trigger.signal !== "string" || entry.trigger.signal.length === 0)) {
    issues.push("trigger.signal 在 on-signal/on-tool 下必填");
  }
  if (entry.trigger?.keywords !== undefined
    && (!Array.isArray(entry.trigger.keywords) || entry.trigger.keywords.some((value) => typeof value !== "string"))) {
    issues.push("trigger.keywords 必须是字符串数组");
  }
  if (typeof entry.body !== "string" || entry.body.trim().length === 0) issues.push("body 不能为空");
  if (typeof entry.body === "string" && entry.body.length > MAX_BODY_CHARS) {
    issues.push("body 超过 " + String(MAX_BODY_CHARS) + " 字符");
  }
  if (!Array.isArray(entry.evidence?.episodes) || entry.evidence.episodes.some((value) => typeof value !== "string")) {
    issues.push("evidence.episodes 必须是字符串数组");
  }
  if (!Array.isArray(entry.evidence?.failures) || entry.evidence.failures.some((value) => typeof value !== "string")) {
    issues.push("evidence.failures 必须是字符串数组");
  }
  if (entry.status === "active" && (entry.evidence?.episodes?.length ?? 0) === 0) {
    issues.push("active 必须有至少一条 Episode 证据");
  }
  if (!GENERATORS.has(entry.provenance?.generator)) issues.push("provenance.generator 不在取值域");
  if (entry.provenance?.model !== null && typeof entry.provenance?.model !== "string") issues.push("provenance.model 必须是 string|null");
  if (typeof entry.provenance?.pipeline !== "string" || entry.provenance.pipeline.length === 0) issues.push("provenance.pipeline 必须是非空字符串");
  if (typeof entry.provenance?.digest !== "string") issues.push("provenance.digest 必须是字符串");
  for (const key of ["trials", "successes", "failures"] as const) {
    if (typeof entry.confidence?.observational?.[key] !== "number" || entry.confidence.observational[key] < 0) {
      issues.push("confidence.observational." + key + " 必须是非负数");
    }
  }
  if (typeof entry.confidence?.causal?.trials !== "number" || entry.confidence.causal.trials < 0) {
    issues.push("confidence.causal.trials 必须是非负数");
  }
  if (entry.confidence?.causal?.riskDiff !== null && typeof entry.confidence.causal.riskDiff !== "number") {
    issues.push("confidence.causal.riskDiff 必须是 number|null");
  }
  if (entry.confidence?.causal?.ci95 !== null) {
    const ci = entry.confidence.causal.ci95;
    if (!Array.isArray(ci) || ci.length !== 2 || ci.some((value) => typeof value !== "number")) {
      issues.push("confidence.causal.ci95 必须是 [number, number] | null");
    }
  }
  if (!Number.isInteger(entry.budget?.tokens) || entry.budget.tokens < 0 || entry.budget.tokens > 2000) {
    issues.push("budget.tokens 必须是 0..2000 的整数");
  }
  if (!Number.isInteger(entry.budget?.maxPerSession) || entry.budget.maxPerSession < 1 || entry.budget.maxPerSession > 10) {
    issues.push("budget.maxPerSession 必须是 1..10 的整数");
  }
  for (const key of ["createdAt", "updatedAt"] as const) {
    if (typeof entry[key] !== "number" || !Number.isFinite(entry[key])) issues.push(key + " 必须是有限数");
  }
  if (entry.lastUsedAt !== null && (typeof entry.lastUsedAt !== "number" || !Number.isFinite(entry.lastUsedAt))) {
    issues.push("lastUsedAt 必须是 number|null");
  }
  if (entry.expiresAt !== null && (typeof entry.expiresAt !== "number" || !Number.isFinite(entry.expiresAt))) {
    issues.push("expiresAt 必须是 number|null");
  }
  if (!Array.isArray(entry.supersedes) || entry.supersedes.some((value) => typeof value !== "string")) issues.push("supersedes 必须是字符串数组");
  if (!Array.isArray(entry.conflictsWith) || entry.conflictsWith.some((value) => typeof value !== "string")) issues.push("conflictsWith 必须是字符串数组");
  if (entry.globalEvidence !== undefined) {
    if (!Array.isArray(entry.globalEvidence)) issues.push("globalEvidence 必须是数组");
    else {
      for (const ref of entry.globalEvidence) {
        if (typeof ref?.workspace !== "string" || ref.workspace.length === 0
          || typeof ref?.episodeId !== "string" || ref.episodeId.length === 0) {
          issues.push("globalEvidence 每项必须含非空 workspace 与 episodeId");
          break;
        }
      }
    }
  }
  if (!Array.isArray(entry.gates?.passed) || entry.gates.passed.some((value) => typeof value !== "string")) issues.push("gates.passed 必须是字符串数组");
  if (typeof entry.gates?.lastRun !== "number" || !Number.isFinite(entry.gates.lastRun)) issues.push("gates.lastRun 必须是有限数");
  return issues;
}

/** body 增量比例：只算“被改掉的旧字符”占旧正文的比例；整段重写 = 1。 */
export function bodyChangeRatio(oldBody: string, newBody: string): number {
  if (oldBody === newBody) return 0;
  if (oldBody.length === 0) return 1;
  const max = Math.min(oldBody.length, newBody.length);
  let prefix = 0;
  while (prefix < max && oldBody[prefix] === newBody[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < max - prefix && oldBody[oldBody.length - 1 - suffix] === newBody[newBody.length - 1 - suffix]) suffix += 1;
  return (oldBody.length - prefix - suffix) / oldBody.length;
}

function mergeEvidence(entry: ExperienceEntry, episodes: readonly string[], failures: readonly string[] = []): ExperienceEntry {
  return {
    ...entry,
    evidence: {
      episodes: uniqueSorted([...entry.evidence.episodes, ...episodes]),
      failures: uniqueSorted([...entry.evidence.failures, ...failures]),
    },
  };
}

function applyOne(state: Map<string, ExperienceEntry>, event: PlaybookOp, index: number, refusals: PlaybookRefusal[]): void {
  const refuse = (reason: string): void => { refusals.push({ index, op: event.op, reason }); };
  if (event.v !== 1) { refuse("事件 v 必须为 1"); return; }
  const evidence = Array.isArray((event as { evidence?: unknown }).evidence)
    ? (event as { evidence: unknown[] }).evidence.filter((item): item is string => typeof item === "string")
    : [];

  if (event.op === "add") {
    if (!isRecord(event.entry)) { refuse("add.entry 必须是对象"); return; }
    const raw = { ...event.entry, evidence: evidenceOf(event.entry) } as unknown as ExperienceEntry;
    const withEvidence = mergeEvidence(raw, evidence);
    if (state.has(withEvidence.id)) { refuse("同 id 已存在（版本不可变，修改走 patch）"); return; }
    const issues = validateExperience(withEvidence);
    if (issues.length > 0) { refuse(issues.join("；")); return; }
    state.set(withEvidence.id, withEvidence);
    return;
  }

  if (event.op === "patch") {
    if (!isRecord(event.fields)) { refuse("patch.fields 必须是对象"); return; }
    const current = state.get(event.id);
    if (current === undefined) { refuse("patch 目标不存在"); return; }
    if (current.status === "retired") { refuse("retired 条目不可再 patch"); return; }
    let next: ExperienceEntry = { ...current };
    if (event.fields.body !== undefined) {
      if (event.fields.body !== current.body && bodyChangeRatio(current.body, event.fields.body) > MAX_BODY_DELTA_RATIO) {
        refuse("body 增量超过 " + String(MAX_BODY_DELTA_RATIO * 100) + "%（整段重写请走 merge/split 或新建）");
        return;
      }
      next.body = event.fields.body;
    }
    if (event.fields.scope !== undefined) next.scope = event.fields.scope;
    if (event.fields.trigger !== undefined) next.trigger = event.fields.trigger;
    if (event.fields.budget !== undefined) next.budget = event.fields.budget;
    if (event.fields.expiresAt !== undefined) next.expiresAt = event.fields.expiresAt;
    if (event.fields.status !== undefined) next.status = event.fields.status;
    if (event.fields.confidence !== undefined) next.confidence = event.fields.confidence;
    next = mergeEvidence(next, evidence);
    next.updatedAt = event.ts;
    const issues = validateExperience(next);
    if (issues.length > 0) { refuse(issues.join("；")); return; }
    state.set(next.id, next);
    return;
  }

  if (event.op === "deprecate" || event.op === "retire") {
    const current = state.get(event.id);
    if (current === undefined) { refuse(event.op + " 目标不存在"); return; }
    state.set(current.id, {
      ...mergeEvidence(current, evidence),
      status: event.op === "retire" ? "retired" : "deprecated",
      updatedAt: event.ts,
    });
    return;
  }

  if (event.op === "merge") {
    if (!Array.isArray(event.ids) || !isRecord(event.into)) { refuse("merge.ids/into 形状不合法"); return; }
    if (event.ids.length < 2) { refuse("merge 至少需要两个来源 id"); return; }
    const sources: ExperienceEntry[] = [];
    for (const id of event.ids) {
      const source = state.get(id);
      if (source === undefined) { refuse("merge 来源不存在：" + id); return; }
      if (source.status === "retired") { refuse("merge 来源已 retired：" + id); return; }
      sources.push(source);
    }
    if (state.has(event.into.id)) { refuse("merge 目标 id 已存在（请用新 id）"); return; }
    const rawInto = { ...event.into, evidence: evidenceOf(event.into) } as unknown as ExperienceEntry;
    let into = mergeEvidence(rawInto, evidence);
    into = mergeEvidence(into, sources.flatMap((source) => source.evidence.episodes), sources.flatMap((source) => source.evidence.failures));
    into.supersedes = uniqueSorted([...into.supersedes, ...event.ids]);
    into.updatedAt = event.ts;
    const issues = validateExperience(into);
    if (issues.length > 0) { refuse(issues.join("；")); return; }
    for (const source of sources) {
      state.set(source.id, { ...source, status: "retired", updatedAt: event.ts });
    }
    state.set(into.id, into);
    return;
  }

  if (event.op === "split") {
    if (!Array.isArray(event.into)) { refuse("split.into 必须是数组"); return; }
    const source = state.get(event.id);
    if (source === undefined) { refuse("split 目标不存在"); return; }
    if (source.status === "retired") { refuse("split 目标已 retired"); return; }
    if (event.into.length < 2) { refuse("split 至少需要两个目标"); return; }
    const prepared: ExperienceEntry[] = [];
    for (const raw of event.into) {
      if (!isRecord(raw)) { refuse("split.into 条目必须是对象"); return; }
      if (state.has(raw.id)) { refuse("split 目标 id 已存在：" + String(raw.id)); return; }
      const rawEntry = { ...raw, evidence: evidenceOf(raw) } as unknown as ExperienceEntry;
      let next = mergeEvidence(rawEntry, evidence);
      next = mergeEvidence(next, source.evidence.episodes, source.evidence.failures);
      next.supersedes = uniqueSorted([...next.supersedes, source.id]);
      next.updatedAt = event.ts;
      const issues = validateExperience(next);
      if (issues.length > 0) { refuse(issues.join("；")); return; }
      prepared.push(next);
    }
    state.set(source.id, { ...source, status: "retired", updatedAt: event.ts });
    for (const entry of prepared) state.set(entry.id, entry);
    return;
  }

  refuse("未知 op");
}

/** 纯 fold：按账本顺序应用 delta；非法 op 只进 refusals，不让整账作废。 */
export function applyPlaybookEvents(events: readonly PlaybookOp[]): ApplyPlaybookResult {
  const state = new Map<string, ExperienceEntry>();
  const refusals: PlaybookRefusal[] = [];
  events.forEach((event, index) => applyOne(state, event, index, refusals));
  return {
    entries: [...state.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    refusals,
  };
}

export function isExpired(entry: ExperienceEntry, now: number): boolean {
  return entry.expiresAt !== null && entry.expiresAt <= now;
}

/** 可注入 = active + 未过期 + 正文非空。 */
export function canInject(entry: ExperienceEntry, now: number): boolean {
  return entry.status === "active" && !isExpired(entry, now) && entry.body.trim().length > 0;
}

/** 可在 shadow/实验中检索 = candidate/shadow/active 且未过期。 */
export function retrievable(entry: ExperienceEntry, now: number): boolean {
  return (entry.status === "candidate" || entry.status === "shadow" || entry.status === "active")
    && !isExpired(entry, now);
}

function scopeKey(entry: ExperienceEntry): string {
  return [
    entry.scope.workspace,
    entry.scope.taskClass ?? "*",
    entry.trigger.when,
    entry.trigger.signal ?? "",
  ].join("\0");
}

function keywordOverlap(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  if (a === undefined || a.length === 0 || b === undefined || b.length === 0) return true;
  const set = new Set(a.map((value) => value.toLowerCase()));
  return b.some((value) => set.has(value.toLowerCase()));
}

/** 冲突：同 workspace/taskClass/trigger 的两个 active/shadow 条目，关键词相交或一方无关键词。 */
export function detectConflicts(entries: readonly ExperienceEntry[]): Conflict[] {
  const groups = new Map<string, ExperienceEntry[]>();
  for (const entry of entries) {
    if (entry.status !== "active" && entry.status !== "shadow") continue;
    const key = scopeKey(entry);
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key, group);
  }
  const out: Conflict[] = [];
  for (const group of groups.values()) {
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        const a = group[i]!;
        const b = group[j]!;
        if (!keywordOverlap(a.trigger.keywords, b.trigger.keywords)) continue;
        out.push({
          a: a.id, b: b.id,
          reason: "同触发（" + scopeKey(a).replace(/\0/gu, " · ") + "）且关键词不互斥",
        });
      }
    }
  }
  return out.sort((x, y) => (x.a + x.b < y.a + y.b ? -1 : 1));
}

export interface RetrievalContext {
  workspace: string;
  taskClass: EpisodeTaskClass;
  tokens: readonly string[];
  signals: readonly string[];
  toolNames: readonly string[];
  paths: readonly string[];
  now: number;
}

export interface RetrievalOptions {
  maxEntries?: number;
  maxChars?: number;
  includeStatuses?: readonly ExperienceStatus[];
}

export type RetrievalSkipReason = "status" | "expired" | "scope" | "trigger" | "conflict" | "budget";

export interface RetrievalResult {
  selected: ExperienceEntry[];
  skipped: Array<{ id: string; reason: RetrievalSkipReason }>;
  chars: number;
  conflicts: string[];
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function globMatch(glob: string, path: string): boolean {
  let pattern = "^";
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i]!;
    if (ch === "*") {
      if (glob[i + 1] === "*") { pattern += ".*"; i += 1; }
      else pattern += "[^/]*";
    } else if (ch === "?") {
      pattern += "[^/]";
    } else {
      pattern += escapeRegExp(ch);
    }
  }
  return new RegExp(pattern + "$", "u").test(path);
}

function lowerSet(values: readonly string[]): Set<string> {
  return new Set(values.map((value) => value.toLowerCase()));
}

function matchesScope(entry: ExperienceEntry, context: RetrievalContext): boolean {
  if (entry.scope.workspace !== "*" && entry.scope.workspace !== context.workspace) return false;
  if (entry.scope.taskClass !== undefined && entry.scope.taskClass !== context.taskClass) return false;
  if (entry.scope.toolchain !== undefined && entry.scope.toolchain.length > 0) {
    const surface = lowerSet([...context.toolNames, ...context.tokens]);
    if (!entry.scope.toolchain.every((value) => surface.has(value.toLowerCase()))) return false;
  }
  if (entry.scope.pathGlobs !== undefined && entry.scope.pathGlobs.length > 0) {
    if (!context.paths.some((path) => entry.scope.pathGlobs!.some((glob) => globMatch(glob, path)))) return false;
  }
  return true;
}

function matchesTrigger(entry: ExperienceEntry, context: RetrievalContext): boolean {
  const keywords = (entry.trigger.keywords ?? []).map((value) => value.toLowerCase());
  const tokens = lowerSet(context.tokens);
  const keywordHit = keywords.length === 0 || keywords.some((value) => tokens.has(value));
  switch (entry.trigger.when) {
    case "always":
      return true;
    case "on-task-class":
      if (entry.scope.taskClass !== undefined) return entry.scope.taskClass === context.taskClass;
      return keywordHit;
    case "on-signal":
      return entry.trigger.signal !== undefined && context.signals.includes(entry.trigger.signal);
    case "on-tool":
      return entry.trigger.signal !== undefined
        && (context.toolNames.includes(entry.trigger.signal) || keywordHit);
    case "on-path":
      return keywords.some((value) => context.paths.some((path) => globMatch(value, path)));
  }
}

/** 单条经验是否匹配当前上下文（scope + trigger）；实验注入用这一份，避免再抄一套匹配。 */
export function matchesContext(entry: ExperienceEntry, context: RetrievalContext): boolean {
  return matchesScope(entry, context) && matchesTrigger(entry, context);
}

function kindWeight(kind: ExperienceKind): number {
  return kind === "warning" ? 4 : kind === "strategy" ? 3 : kind === "policy" ? 2 : 1;
}

function confidenceScore(entry: ExperienceEntry): number {
  const { trials, successes } = entry.confidence.observational;
  return (successes + 1) / (trials + 2);
}

/** 任务词面相似度（Jaccard）：设计 §5.5「scope → trigger → 相似度（token Jaccard + 工具链）」的
 *  缺项。`context.tokens` 是 episode 的粗粒度任务词；这里用与记忆/地图同一把 `tokensOf`
 *  （CJK 二元组 + 拉丁词）切正文与关键词，避免「整句中文当一个 token」的稀疏。 */
function taskSimilarity(entry: ExperienceEntry, tokens: readonly string[]): number {
  if (tokens.length === 0) return 0;
  const query = new Set(tokensOf(tokens.join(" ")));
  if (query.size === 0) return 0;
  const entryTokens = new Set(tokensOf(
    entry.body + " " + (entry.trigger.keywords ?? []).slice(0, 20).join(" "),
  ));
  if (entryTokens.size === 0) return 0;
  let intersection = 0;
  for (const token of query) if (entryTokens.has(token)) intersection += 1;
  return intersection / (query.size + entryTokens.size - intersection);
}

/** Episode 观测账的行形状（与 `ExperienceObservationStat` 同形；这里只认需要的四格）。 */
export interface ObservationalStat {
  trials: number;
  successes: number;
  failures: number;
  lastUsedAt?: number;
}

/** 把观测账叠加到条目上（纯函数，不改原对象）：只动 observational 与 lastUsedAt。
 *  没有 trials 的账（只被用过、结局不可测）只更新 lastUsedAt，不把既有置信度清零；
 *  causal 置信度不从这里来——那要对照组实验。 */
export function applyObservationalStats(
  entries: readonly ExperienceEntry[],
  stats: ReadonlyMap<string, ObservationalStat>,
): ExperienceEntry[] {
  if (stats.size === 0) return [...entries];
  return entries.map((entry) => {
    const stat = stats.get(entry.id);
    if (stat === undefined) return entry;
    const usedAt = stat.lastUsedAt === undefined ? entry.lastUsedAt : Math.max(entry.lastUsedAt ?? 0, stat.lastUsedAt);
    return {
      ...entry,
      ...(stat.trials > 0
        ? { confidence: { ...entry.confidence, observational: { trials: stat.trials, successes: stat.successes, failures: stat.failures } } }
        : {}),
      lastUsedAt: usedAt,
    };
  });
}

function specificity(entry: ExperienceEntry): number {
  let score = 0;
  if (entry.scope.taskClass !== undefined) score += 4;
  if ((entry.scope.toolchain?.length ?? 0) > 0) score += 2;
  if ((entry.scope.pathGlobs?.length ?? 0) > 0) score += 2;
  if (entry.trigger.when !== "always") score += 2;
  if ((entry.trigger.keywords?.length ?? 0) > 0) score += 1;
  return score;
}

function recencyScore(entry: ExperienceEntry, now: number): number {
  const stamp = entry.lastUsedAt ?? entry.updatedAt;
  const age = Math.max(0, now - stamp);
  return Math.max(0, 1 - age / (30 * 24 * 60 * 60 * 1000));
}

function entryChars(entry: ExperienceEntry): number {
  return entry.body.length + 80;
}

/** 按 scope → trigger → 分数排序，再按条数/字符预算截断；冲突条目两条都不选。 */
export function retrieveExperiences(
  entries: readonly ExperienceEntry[],
  context: RetrievalContext,
  options: RetrievalOptions = {},
): RetrievalResult {
  const includeStatuses = options.includeStatuses ?? ["active"];
  const maxEntries = options.maxEntries ?? 6;
  const maxChars = options.maxChars ?? 2_000;
  const conflicts = detectConflicts(entries);
  const conflictIds = new Set(conflicts.flatMap((conflict) => [conflict.a, conflict.b]));
  const skipped: RetrievalResult["skipped"] = [];
  const candidates: Array<{ entry: ExperienceEntry; score: number }> = [];

  for (const entry of entries) {
    if (!includeStatuses.includes(entry.status)) { skipped.push({ id: entry.id, reason: "status" }); continue; }
    if (isExpired(entry, context.now)) { skipped.push({ id: entry.id, reason: "expired" }); continue; }
    if (conflictIds.has(entry.id)) { skipped.push({ id: entry.id, reason: "conflict" }); continue; }
    if (!matchesScope(entry, context)) { skipped.push({ id: entry.id, reason: "scope" }); continue; }
    if (!matchesTrigger(entry, context)) { skipped.push({ id: entry.id, reason: "trigger" }); continue; }
    const score = kindWeight(entry.kind) * 10
      + specificity(entry) * 5
      + confidenceScore(entry) * 3
      + taskSimilarity(entry, context.tokens) * 4
      + recencyScore(entry, context.now) * 2;
    candidates.push({ entry, score });
  }

  candidates.sort((a, b) => b.score - a.score || (a.entry.id < b.entry.id ? -1 : a.entry.id > b.entry.id ? 1 : 0));
  const selected: ExperienceEntry[] = [];
  let chars = 0;
  for (const candidate of candidates) {
    if (selected.length >= maxEntries) { skipped.push({ id: candidate.entry.id, reason: "budget" }); continue; }
    const cost = entryChars(candidate.entry);
    if (chars + cost > maxChars) { skipped.push({ id: candidate.entry.id, reason: "budget" }); continue; }
    selected.push(candidate.entry);
    chars += cost;
  }

  return {
    selected,
    skipped,
    chars,
    conflicts: uniqueSorted(conflicts.flatMap((conflict) => [conflict.a, conflict.b])),
  };
}

/** 触发条件的展示名（第 947 页）：`main/evolve/promotion.ts` 的包正文读同一份。 */
export function triggerLabel(entry: ExperienceEntry): string {
  switch (entry.trigger.when) {
    case "always": return "总是适用";
    case "on-task-class": return "任务类 " + (entry.scope.taskClass ?? "相关");
    case "on-signal": return "信号 " + (entry.trigger.signal ?? "未知");
    case "on-tool": return "工具 " + (entry.trigger.signal ?? "未知");
    case "on-path": return "路径 " + (entry.trigger.keywords ?? []).join("/");
  }
}

function confidenceLabel(entry: ExperienceEntry): string {
  const { trials, successes } = entry.confidence.observational;
  if (trials > 0) return "观测 " + String(successes) + "/" + String(trials);
  return entry.evidence.episodes.length > 0 ? "证据 " + String(entry.evidence.episodes.length) : "候选";
}

/** 把选中的 active 经验渲染成紧凑提示；空选择 = 空串（零行为）。 */
function renderEntryLines(selected: readonly ExperienceEntry[]): string[] {
  return selected.map((entry) => {
    const evidence = entry.evidence.episodes.length > 0
      ? "（证据：" + entry.evidence.episodes.slice(0, 3).join("、")
        + (entry.evidence.episodes.length > 3 ? " 等 " + String(entry.evidence.episodes.length) + " 条" : "")
        + "）"
      : "";
    return "- " + entry.id + " [" + entry.kind + "｜" + confidenceLabel(entry) + "] "
      + triggerLabel(entry) + "：" + entry.body + evidence;
  });
}

/** 把选中的 active 经验渲染成紧凑提示；空选择 = 空串（零行为）。 */
export function renderPlaybookNote(selected: readonly ExperienceEntry[]): string {
  if (selected.length === 0) return "";
  return "\n\n[evolve] 本工作区的经验（按证据筛选；标 candidate 的只在实验臂出现，不适用就忽略，最多 "
    + String(selected.length) + " 条）：\n" + renderEntryLines(selected).join("\n");
}

/** run 中途按信号提醒（verify 红灯）：与起点注入共用同一份行渲染，只换抬头。
 *  空选择 = 空串；调用方负责把它接在失败回执尾部。 */
export function renderSignalNote(selected: readonly ExperienceEntry[], signals: readonly string[]): string {
  if (selected.length === 0) return "";
  return "\n\n[verify 相关经验（信号 " + signals.join("、") + "；按证据筛选，不适用就忽略）]\n"
    + renderEntryLines(selected).join("\n");
}
