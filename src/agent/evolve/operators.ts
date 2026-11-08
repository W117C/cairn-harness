// reflect-delta 算子（Cairn Evolve · P3 候选生成）：模型反思只能提出**有证据的增量**，
// 不能凭空改写经验，也不能把候选直接变成 active。
//
// 纯函数：输入目标经验 + 允许的 Episode 证据 + 模型反思 JSON ⇒ 新 candidate entry + 候选档案。
// 门禁：
//  · targetId 必须等于目标条目；
//  · 反思证据必须是允许集合的子集（伪造引用直接拒）；
//  · body 必须是 ≤30% 的增量（整段重写请新建候选）；
//  · 正文不得指向 TCB 路径（权限/门禁/registry/evolve 内核）；
//  · 产出新 id 的 candidate entry，不改原条目；晋升仍走离线 holdout + SEMA。

import { newCandidate, type CandidateRecord } from "./candidates";
import { bodyChangeRatio, newExperience, type ExperienceEntry } from "./playbook";
import { isRecord } from "../../is-record";

export interface ReflectDeltaInput {
  workspace: string;
  entry: ExperienceEntry;
  /** 本工作区允许引用的 Episode id 集合（调用方从 Episode 账取）。 */
  evidenceEpisodes: readonly string[];
  /** 模型/反思位返回的 JSON；形状在边界校验。 */
  reflection: unknown;
  now: number;
  parentId?: string | null;
}

export type ReflectDeltaResult =
  | { ok: true; entry: ExperienceEntry; candidate: CandidateRecord }
  | { ok: false; refusals: string[] };

const MAX_BODY_DELTA_RATIO = 0.3;
const MAX_BODY_CHARS = 800;
const TCB_MARKERS: readonly string[] = [
  "src/permissions",
  "src/main/evolution",
  "src/main/ipc-protocol",
  "modules/registry",
  "modules/grants",
  "gate-manifest",
  ".agent/evolve",
];

/** 纯解析 + 门禁。任何一条红都返回 refusals；不抛、不写入。 */
export function parseReflectDelta(input: ReflectDeltaInput): ReflectDeltaResult {
  const refusals: string[] = [];
  const raw = input.reflection;
  if (!isRecord(raw)) {
    return { ok: false, refusals: ["反思必须是 JSON 对象"] };
  }
  if (raw.targetId !== input.entry.id) {
    refusals.push("target 不一致：期望 " + input.entry.id + "，收到 " + String(raw.targetId));
  }
  const body = typeof raw.body === "string" ? raw.body : "";
  if (body.trim().length === 0) refusals.push("body 不能为空");
  if (body.length > MAX_BODY_CHARS) refusals.push("body 超过 " + String(MAX_BODY_CHARS) + " 字符");
  const reason = typeof raw.reason === "string" ? raw.reason.trim() : "";
  if (reason.length === 0) refusals.push("reason 不能为空（反思必须说明证据与改动理由）");

  const evidence = Array.isArray(raw.evidence)
    ? raw.evidence.filter((item): item is string => typeof item === "string")
    : [];
  if (evidence.length === 0) refusals.push("evidence 不能为空（无出处不产出）");
  const allowed = new Set(input.evidenceEpisodes);
  const unknown = evidence.filter((id) => !allowed.has(id));
  if (unknown.length > 0) refusals.push("证据不在允许的 Episode 集合：" + unknown.join("、"));

  if (body !== input.entry.body && bodyChangeRatio(input.entry.body, body) > MAX_BODY_DELTA_RATIO) {
    refusals.push("body 增量超过 " + String(MAX_BODY_DELTA_RATIO * 100) + "%（整段重写请新建候选）");
  }
  const lower = body.toLowerCase();
  const tcb = TCB_MARKERS.find((marker) => lower.includes(marker));
  if (tcb !== undefined) refusals.push("body 含受信路径标记：" + tcb + "（候选不得改 TCB）");

  if (refusals.length > 0) return { ok: false, refusals };

  const entry = newExperience({
    kind: input.entry.kind,
    scope: input.entry.scope,
    trigger: input.entry.trigger,
    body,
    evidenceEpisodes: [...input.entry.evidence.episodes, ...evidence],
    evidenceFailures: input.entry.evidence.failures,
    generator: "reflect",
    pipeline: "reflect-delta-v1",
    now: input.now,
  });
  const candidate = newCandidate({
    workspace: input.workspace,
    parentId: input.parentId ?? null,
    operator: "reflect-delta",
    target: { kind: "experience", id: entry.id },
    body: entry.body,
    evidence: entry.evidence.episodes,
    status: "draft",
    now: input.now,
  });
  return { ok: true, entry, candidate };
}
