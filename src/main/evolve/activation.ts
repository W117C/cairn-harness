// 经验激活（Cairn Evolve · P4）：候选/休眠条目 → active 的人工门。
//
// 设计边界（docs/evolve-proposal.md §4.5）：active 是运行时基线注入的唯一入口；
// 相关性读数只能排序，不能晋升——这里只认 `confidence.causal`（对照组实验的 riskDiff/CI）。
// 本层不自动运行：CLI 默认 dry-run，`--apply` 才写；STOP 冻结时一律拒绝。
//
// 与 retirement 同族：只产出/应用 playbook delta，不碰 SEMA 安装、不调模型。

import {
  applyPlaybookEvents,
  detectConflicts,
  isExpired,
  type ExperienceEntry,
  type ExperienceStatus,
  type PlaybookOp,
} from "../../agent/evolve/playbook";
import { appendPlaybookEvents, loadPlaybook, playbookPathFor } from "./playbook-store";
import { isEvolveFrozen } from "./governance";

export type ActivationBlockCode =
  | "status" | "expired" | "no-evidence" | "no-causal" | "no-improvement" | "conflict" | "global-scope";

export interface ActivationBlock {
  code: ActivationBlockCode;
  detail: string;
}

const ACTIVATABLE: ReadonlySet<ExperienceStatus> = new Set(["candidate", "shadow", "dormant"]);

/** 激活门（纯函数）：返回全部阻断理由；空数组 = 可激活。 */
export function activationBlockers(
  entry: ExperienceEntry,
  entries: readonly ExperienceEntry[],
  now: number,
): ActivationBlock[] {
  const out: ActivationBlock[] = [];
  if (!ACTIVATABLE.has(entry.status)) {
    out.push({ code: "status", detail: "status=" + entry.status + "（只有 candidate/shadow/dormant 可激活）" });
  }
  if (isExpired(entry, now)) {
    out.push({ code: "expired", detail: "条目已过期（expiresAt " + String(entry.expiresAt) + "）" });
  }
  if (entry.evidence.episodes.length === 0) {
    out.push({ code: "no-evidence", detail: "没有 Episode 证据：active 条目必须可核验" });
  }
  // 设计 §4.5：`workspace:"*"` 只能由 owner 显式全局晋升，且需 ≥3 个 workspace 的证据。
  // 跨 workspace 证据核验尚未实现 ⇒ fail-closed，不在本 workspace 的账上替全局背书。
  if (entry.scope.workspace === "*") {
    out.push({
      code: "global-scope",
      detail: "全局作用域需要 ≥3 个 workspace 的证据与显式全局晋升；当前门无法跨库核验（fail-closed）",
    });
  }
  const causal = entry.confidence.causal;
  if (causal.trials <= 0 || causal.riskDiff === null) {
    out.push({ code: "no-causal", detail: "没有对照组实验证据（causal.trials=" + String(causal.trials) + "）" });
  } else if (causal.riskDiff <= 0) {
    out.push({ code: "no-improvement", detail: "实验 riskDiff " + String(causal.riskDiff) + " ≤ 0：没有净改进" });
  }
  // 激活后会与现有 active/shadow 冲突（冲突条目两条都不注入）⇒ 先让人裁决，不制造死条目。
  const hypothetical: ExperienceEntry = { ...entry, status: "active" };
  const conflicts = detectConflicts([...entries.filter((item) => item.id !== entry.id), hypothetical])
    .filter((conflict) => conflict.a === entry.id || conflict.b === entry.id);
  if (conflicts.length > 0) {
    out.push({
      code: "conflict",
      detail: "激活后会与 " + conflicts.map((conflict) => (conflict.a === entry.id ? conflict.b : conflict.a)).join("、") + " 冲突",
    });
  }
  return out;
}

export type ActivationOutcome =
  | { outcome: "activated"; entry: ExperienceEntry; path: string }
  | { outcome: "dry-run"; entry: ExperienceEntry }
  | { outcome: "already-active"; entry: ExperienceEntry }
  | { outcome: "refused"; entry: ExperienceEntry; blockers: ActivationBlock[] }
  | { outcome: "frozen"; entry: ExperienceEntry };

/** 人工把一条 active 经验转 dormant（负证据的出口；可经激活门再回来）。 */
export type DormantOutcome =
  | { outcome: "dormant"; entry: ExperienceEntry; path: string }
  | { outcome: "dry-run"; entry: ExperienceEntry }
  | { outcome: "refused"; entry: ExperienceEntry; reason: string }
  | { outcome: "frozen"; entry: ExperienceEntry };

export interface ActivateOptions {
  now?: number;
  /** false（缺省）= 只算门、不写；true = 追加 patch 到 playbook。 */
  apply?: boolean;
}

/** 激活一行入口。冻结时拒绝；候选不存在/坏档直接抛。 */
export async function activatePlaybookEntry(
  workspace: string,
  id: string,
  options: ActivateOptions = {},
): Promise<ActivationOutcome> {
  const now = options.now ?? Date.now();
  const playbook = await loadPlaybook(workspace);
  const entry = playbook.entries.find((item) => item.id === id);
  if (entry === undefined) throw new Error("经验不在 playbook 上：" + id);
  if (await isEvolveFrozen(workspace)) return { outcome: "frozen", entry };
  if (entry.status === "active") return { outcome: "already-active", entry };
  const blockers = activationBlockers(entry, playbook.entries, now);
  if (blockers.length > 0) return { outcome: "refused", entry, blockers };
  if (options.apply !== true) return { outcome: "dry-run", entry };
  const patch: PlaybookOp = {
    v: 1,
    op: "patch",
    ts: now,
    id,
    fields: { status: "active" },
    evidence: [],
    reason: "activate: causal riskDiff " + String(entry.confidence.causal.riskDiff)
      + "，trials " + String(entry.confidence.causal.trials),
  };
  // 追加前先过同一 fold：append 不判语义，坏 patch 会静默躺在账上。
  const folded = applyPlaybookEvents([...playbook.events, patch]);
  const refusal = folded.refusals.find((item) => item.index === playbook.events.length);
  if (refusal !== undefined) throw new Error("激活写不进 playbook：" + refusal.reason);
  await appendPlaybookEvents(workspace, [patch]);
  const updated = folded.entries.find((item) => item.id === id);
  if (updated === undefined) throw new Error("激活后条目消失：" + id);
  return { outcome: "activated", entry: updated, path: playbookPathFor(workspace) };
}

/** 人工休眠一条 active 经验（负证据/人工裁决的出口）。默认 dry-run；冻结时拒绝。 */
export async function dormantPlaybookEntry(
  workspace: string,
  id: string,
  options: ActivateOptions = {},
): Promise<DormantOutcome> {
  const now = options.now ?? Date.now();
  const playbook = await loadPlaybook(workspace);
  const entry = playbook.entries.find((item) => item.id === id);
  if (entry === undefined) throw new Error("经验不在 playbook 上：" + id);
  if (await isEvolveFrozen(workspace)) return { outcome: "frozen", entry };
  if (entry.status !== "active") {
    return { outcome: "refused", entry, reason: "只有 active 经验可转 dormant（当前 " + entry.status + "）" };
  }
  if (options.apply !== true) return { outcome: "dry-run", entry };
  const patch: PlaybookOp = {
    v: 1,
    op: "patch",
    ts: now,
    id,
    fields: { status: "dormant" },
    evidence: [],
    reason: "manual dormant（人工裁决；可经激活门重新回到 active）",
  };
  const folded = applyPlaybookEvents([...playbook.events, patch]);
  const refusal = folded.refusals.find((item) => item.index === playbook.events.length);
  if (refusal !== undefined) throw new Error("休眠写不进 playbook：" + refusal.reason);
  await appendPlaybookEvents(workspace, [patch]);
  const updated = folded.entries.find((item) => item.id === id);
  if (updated === undefined) throw new Error("休眠后条目消失：" + id);
  return { outcome: "dormant", entry: updated, path: playbookPathFor(workspace) };
}
