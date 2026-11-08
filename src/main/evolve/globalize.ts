// 全局晋升（Cairn Evolve）：owner 显式把一条 workspace 局部 active 经验提升为 `scope.workspace="*"`。
//
// 设计边界（docs/evolve-proposal.md §4.5）：全局只能由 owner 显式晋升，且需要 ≥3 个 workspace 的
// 证据；这里把这个门做成可核验的：每条证据（workspace + episodeId）必须能在该 workspace 的
// Episode 账里找到，且结局可测（final ≠ unknown）。不做自动全局晋升、不做 UI；CLI 默认 dry-run。

import { resolve } from "node:path";
import {
  applyPlaybookEvents,
  validateExperience,
  type ExperienceEntry,
  type PlaybookOp,
} from "../../agent/evolve/playbook";
import { loadEpisodes } from "./episode-store";
import { isEvolveFrozen } from "./governance";
import {
  appendGlobalPlaybookEvents,
  globalPlaybookPath,
  isGlobalEvolveFrozen,
  loadGlobalPlaybook,
} from "./global-playbook-store";
import { loadPlaybook } from "./playbook-store";

export interface GlobalEvidenceRef {
  workspace: string;
  episodeId: string;
}

export interface GlobalEvidenceCheck {
  ok: boolean;
  reason?: string;
  workspaces: number;
  episodes: number;
  normalized: GlobalEvidenceRef[];
}

/** 核验 ≥3 个 workspace 的可测 Episode 证据（只读；坏路径/缺失/unknown 都拒绝）。 */
export async function verifyGlobalEvidence(refs: readonly GlobalEvidenceRef[]): Promise<GlobalEvidenceCheck> {
  const normalized = refs.map((ref) => ({ workspace: resolve(ref.workspace), episodeId: ref.episodeId }));
  const workspaces = new Set(normalized.map((ref) => ref.workspace));
  if (workspaces.size < 3) {
    return {
      ok: false,
      reason: "全局晋升需要 ≥3 个 workspace 的证据（当前 " + String(workspaces.size) + "）",
      workspaces: workspaces.size,
      episodes: 0,
      normalized,
    };
  }
  let measurable = 0;
  for (const ref of normalized) {
    const loaded = await loadEpisodes(ref.workspace);
    const episode = loaded.episodes.find((item) => item.id === ref.episodeId);
    if (episode === undefined) {
      return {
        ok: false,
        reason: "证据 Episode 不存在：" + ref.workspace + " · " + ref.episodeId,
        workspaces: workspaces.size,
        episodes: measurable,
        normalized,
      };
    }
    if (episode.outcome.final === "unknown") {
      return {
        ok: false,
        reason: "证据不可测（final unknown）：" + ref.workspace + " · " + ref.episodeId,
        workspaces: workspaces.size,
        episodes: measurable,
        normalized,
      };
    }
    measurable += 1;
  }
  return { ok: true, workspaces: workspaces.size, episodes: measurable, normalized };
}

export type GlobalizeOutcome =
  | { outcome: "globalized"; entry: ExperienceEntry; path: string }
  | { outcome: "dry-run"; entry: ExperienceEntry; evidence: GlobalEvidenceCheck }
  | { outcome: "refused"; reason: string; evidence: GlobalEvidenceCheck | null }
  | { outcome: "frozen" };

/** owner 撤销一条全局 active 经验（转 dormant；账本保留 tombstone）。 */
export type RevokeOutcome =
  | { outcome: "revoked"; entry: ExperienceEntry; path: string }
  | { outcome: "dry-run"; entry: ExperienceEntry }
  | { outcome: "refused"; reason: string }
  | { outcome: "frozen" };

/** owner 恢复一条 dormant 全局经验（复核原晋升证据；不重跑 ≥3 库以外的门）。 */
export type ReactivateOutcome =
  | { outcome: "reactivated"; entry: ExperienceEntry; path: string }
  | { outcome: "dry-run"; entry: ExperienceEntry; evidence: GlobalEvidenceCheck }
  | { outcome: "refused"; reason: string; evidence: GlobalEvidenceCheck | null }
  | { outcome: "frozen" };

export interface GlobalizeOptions {
  apply?: boolean;
  now?: number;
}

/** owner 显式晋升一行入口：源条目必须 active；证据 ≥3 workspace 且可测；全局 STOP 时拒绝。 */
export async function globalizeExperience(
  sourceWorkspace: string,
  entryId: string,
  refs: readonly GlobalEvidenceRef[],
  options: GlobalizeOptions = {},
): Promise<GlobalizeOutcome> {
  const now = options.now ?? Date.now();
  const playbook = await loadPlaybook(sourceWorkspace);
  const entry = playbook.entries.find((item) => item.id === entryId);
  if (entry === undefined) throw new Error("经验不在 workspace playbook 上：" + entryId);
  if (await isEvolveFrozen(sourceWorkspace)) return { outcome: "frozen" };
  if (entry.status !== "active") {
    return { outcome: "refused", reason: "只有 active 经验可全局晋升（当前 " + entry.status + "）", evidence: null };
  }
  if (entry.scope.workspace === "*") {
    return { outcome: "refused", reason: "该条目已经是全局作用域", evidence: null };
  }
  const evidence = await verifyGlobalEvidence(refs);
  if (!evidence.ok) return { outcome: "refused", reason: evidence.reason ?? "证据不合格", evidence };
  if (await isGlobalEvolveFrozen()) return { outcome: "frozen" };

  const global = await loadGlobalPlaybook();
  if (global.entries.some((item) => item.id === entry.id)) {
    return { outcome: "refused", reason: "全局账已有同 id 条目：" + entry.id, evidence };
  }
  const globalEntry: ExperienceEntry = {
    ...entry,
    scope: { ...entry.scope, workspace: "*" },
    evidence: {
      episodes: [...new Set([...entry.evidence.episodes, ...evidence.normalized.map((ref) => ref.episodeId)])].sort(),
      failures: [...entry.evidence.failures],
    },
    globalEvidence: evidence.normalized.map((ref) => ({ workspace: ref.workspace, episodeId: ref.episodeId })),
    updatedAt: now,
    provenance: { ...entry.provenance, generator: "human", pipeline: "globalize-v1" },
  };
  const issues = validateExperience(globalEntry);
  if (issues.length > 0) {
    return { outcome: "refused", reason: "全局条目校验失败：" + issues.join("；"), evidence };
  }
  if (options.apply !== true) return { outcome: "dry-run", entry: globalEntry, evidence };

  const op: PlaybookOp = {
    v: 1,
    op: "add",
    ts: now,
    entry: globalEntry,
    evidence: globalEntry.evidence.episodes,
    reason: "globalize: owner explicit，" + String(evidence.workspaces) + " 个 workspace 证据",
  };
  const folded = applyPlaybookEvents([...global.events, op]);
  const refusal = folded.refusals.find((item) => item.index === global.events.length);
  if (refusal !== undefined) throw new Error("全局晋升写不进 playbook：" + refusal.reason);
  await appendGlobalPlaybookEvents([op]);
  return { outcome: "globalized", entry: globalEntry, path: globalPlaybookPath() };
}

/** 全局经验列表（含 dormant/retired；owner CLI 用）。 */
export async function listGlobalExperiences(): Promise<ExperienceEntry[]> {
  return (await loadGlobalPlaybook()).entries;
}

/** owner 撤销一条全局 active 经验：append patch → dormant；全局 STOP 时拒绝。 */
export async function revokeGlobalExperience(
  id: string,
  options: GlobalizeOptions = {},
): Promise<RevokeOutcome> {
  const now = options.now ?? Date.now();
  if (await isGlobalEvolveFrozen()) return { outcome: "frozen" };
  const global = await loadGlobalPlaybook();
  const entry = global.entries.find((item) => item.id === id);
  if (entry === undefined) throw new Error("全局经验不存在：" + id);
  if (entry.status !== "active") {
    return { outcome: "refused", reason: "只有 active 全局经验可撤销（当前 " + entry.status + "）" };
  }
  if (options.apply !== true) return { outcome: "dry-run", entry };
  const patch: PlaybookOp = {
    v: 1,
    op: "patch",
    ts: now,
    id,
    fields: { status: "dormant" },
    evidence: [],
    reason: "revoke: owner explicit（全局经验转 dormant；账本保留）",
  };
  const folded = applyPlaybookEvents([...global.events, patch]);
  const refusal = folded.refusals.find((item) => item.index === global.events.length);
  if (refusal !== undefined) throw new Error("全局撤销写不进 playbook：" + refusal.reason);
  await appendGlobalPlaybookEvents([patch]);
  const updated = folded.entries.find((item) => item.id === id);
  if (updated === undefined) throw new Error("全局撤销后条目消失：" + id);
  return { outcome: "revoked", entry: updated, path: globalPlaybookPath() };
}

/** owner 恢复一条 dormant 全局经验：复核存储的晋升证据（≥3 workspace 且仍可测）；全局 STOP 时拒绝。 */
export async function reactivateGlobalExperience(
  id: string,
  options: GlobalizeOptions = {},
): Promise<ReactivateOutcome> {
  const now = options.now ?? Date.now();
  if (await isGlobalEvolveFrozen()) return { outcome: "frozen" };
  const global = await loadGlobalPlaybook();
  const entry = global.entries.find((item) => item.id === id);
  if (entry === undefined) throw new Error("全局经验不存在：" + id);
  if (entry.status === "active") {
    return { outcome: "refused", reason: "该全局经验已经是 active", evidence: null };
  }
  if (entry.status !== "dormant") {
    return { outcome: "refused", reason: "只有 dormant 全局经验可恢复（当前 " + entry.status + "）", evidence: null };
  }
  const refs = entry.globalEvidence ?? [];
  if (refs.length === 0) {
    return { outcome: "refused", reason: "该全局经验没有可复核的晋升证据", evidence: null };
  }
  const evidence = await verifyGlobalEvidence(refs);
  if (!evidence.ok) return { outcome: "refused", reason: evidence.reason ?? "证据不合格", evidence };
  const preview: ExperienceEntry = { ...entry, status: "active", updatedAt: now };
  if (options.apply !== true) return { outcome: "dry-run", entry: preview, evidence };
  const patch: PlaybookOp = {
    v: 1,
    op: "patch",
    ts: now,
    id,
    fields: { status: "active" },
    evidence: [],
    reason: "activate: owner explicit（全局经验恢复；证据复核 " + String(evidence.workspaces) + " 库 / "
      + String(evidence.episodes) + " 条）",
  };
  const folded = applyPlaybookEvents([...global.events, patch]);
  const refusal = folded.refusals.find((item) => item.index === global.events.length);
  if (refusal !== undefined) throw new Error("全局恢复写不进 playbook：" + refusal.reason);
  await appendGlobalPlaybookEvents([patch]);
  const updated = folded.entries.find((item) => item.id === id);
  if (updated === undefined) throw new Error("全局恢复后条目消失：" + id);
  return { outcome: "reactivated", entry: updated, path: globalPlaybookPath() };
}
