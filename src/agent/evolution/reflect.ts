// 反思位（闭环 v2 · 批次 A2）：GEPA 式「读轨迹 → 改措辞」的那一格，接进自进化闭环。
//
// 定界（刻意的窄）：**kind 集合是封闭的**（verify-escalate / goal-reconfirm / cost-throttle 三种，
// 与 strategy-patch 的类型同源）——反思 LLM 不许发明新类补丁，只许对**本轮已生成的补丁**改写
// note（把规则模板句换成读过真实失败轨迹的针对性句子）。结构化字段（cause / times / driftCount /
// tokensPerBoundary）仍由信号纯函数派生，反思碰不到——这样 patch-effect 的跨轮判定与 store 的
// 验形状都不用改一个字。
//
// 纪律：
//  · **无证据不收**：反思产出必须带 evidenceCallIds，且每个 id 都要在本轮事件流里真的存在
//    （tool_call 的 id / tool_result 与 verify_result 的 callId）。指不出处的措辞再好也拒收
//    ——与 lessons「无出处不写盘」、signal「无出处不产出」同一道门。
//  · **规则兜底**：反思失败 / 产出全被拒 / 一个 kind 没有合法产出 ⇒ 该 kind 用规则 note 原样。
//    反思是增益不是依赖（fail-open 到规则层——规则层本来就是既有行为，方向安全）。
//  · **有界**：note ≤ NOTE_MAX_CHARS；控制字符剥掉（prompt 注入面收窄）。
//  · 反思本体（ReflectFn）由调用方注入（post-run-readings 侧用真 provider 构造）；
//    本模块只有纯函数，测得到、判得动。

import type { AgentEvent } from "../../events";
import type { EvolutionSignals } from "./signal";
import type { StrategyPatch } from "./strategy-patch";
import type { PatchEffect } from "./patch-effect";

/** 反思产出的合法形状（note 覆盖 + 证据指针）。kind 与既有补丁同集。 */
export interface ReflectProposal {
  kind: StrategyPatch["kind"];
  note: string;
  evidenceCallIds: string[];
}

export const NOTE_MAX_CHARS = 280;

/** 一次反思的输入（instruction 由 reflectInstruction 现算；ReflectFn 由调用方注入）。 */
export interface ReflectInput {
  instruction: string;
  /** 本轮规则补丁（含接续的），反思要改写的就是它们。 */
  patches: readonly StrategyPatch[];
  /** 上一轮补丁在本轮读数下的评估（让反思知道「老方子吃到第几副了」）。 */
  effects: readonly PatchEffect[];
}

export type ReflectFn = (input: ReflectInput) => Promise<unknown>;

/** 反思指令（进 ephemeralUserTurn，不落日志）。三段：读数摘要、要改写的补丁、输出契约。 */
export function reflectInstruction(patches: readonly StrategyPatch[], effects: readonly PatchEffect[], signals: EvolutionSignals): string {
  const patchLines = patches.map((p) => "- " + p.kind + "（现行措辞）：" + p.note).join("\n");
  const effectLines = effects.length > 0
    ? effects.map((e) => "- " + e.key + "：" + e.status + "（" + e.observed + "）").join("\n")
    : "（无旧账）";
  const failures = Object.entries(signals.verifyFailuresByCause)
    .map(([cause, n]) => cause + "×" + String(n))
    .join("、") || "无";
  return [
    "[系统操作·自进化反思] 以下策略补丁将在下一轮写进系统提示词。你刚经历这场会话的真实轨迹，请把每条补丁的措辞改得更有针对性：点名真实失败处，给下一步的具体做法。",
    "本轮读数：verify 失败按 cause（" + failures + "）；最后一拍 " + signals.verifyOutcome + "；目标漂移 " + String(signals.goalDriftCount) + " 处；tokensPerBoundary=" + (signals.tokensPerBoundary === null ? "不可测" : String(signals.tokensPerBoundary)) + "。",
    "上一轮补丁的跨轮评估：",
    effectLines,
    "要改写的补丁：",
    patchLines,
    "输出契约（只输出 JSON，不要多余文字）：{\"proposals\":[{\"kind\":\"verify-escalate|goal-reconfirm|cost-throttle\",\"note\":\"≤200字的具体措辞\",\"evidenceCallIds\":[\"事件流里真实存在的 callId\"]}]}。",
    "硬规矩：kind 只能取上面出现过的；evidenceCallIds 至少一个且必须是本会话事件流里真实存在的 callId，指不出来就别提那条；note 用陈述句，不要写「下一轮」这种随时间读歪的代词，写「这一轮」。",
  ].join("\n");
}

/** 剥控制字符 + 封顶（按码点截，不交半个字符出去——retrieval.ts 同款纪律）。 */
function sanitizeNote(text: string): string {
  // 控制字符（含零宽）一律剥掉：note 要进 system prompt，这一面不留给注入。
  const stripped = text.replace(/[\u0000-\u0008\u000B-\u001F\u007F\u200B-\u200D\uFEFF]/gu, "");
  const chars = Array.from(stripped);
  if (chars.length <= NOTE_MAX_CHARS) return stripped;
  return chars.slice(0, NOTE_MAX_CHARS).join("") + "…";
}

function evidenceIdSet(events: readonly AgentEvent[]): Set<string> {
  const ids = new Set<string>();
  for (const e of events) {
    if (e.type === "tool_call" && typeof e.id === "string") ids.add(e.id);
    else if ((e.type === "tool_result" || e.type === "verify_result") && typeof e.callId === "string") ids.add(e.callId);
  }
  return ids;
}

/** 反思产出面：合法的 + 被拒的（拒因出声——「反思说了但没采纳」不许静默）。 */
export interface ReflectOutcome {
  proposals: ReflectProposal[];
  refusals: string[];
}

/** 校验反思产出（纯函数）：形状不对 / kind 不在集合 / 无证据 / 证据指不到事件 ⇒ 拒那条。
 *  raw 不是对象、没有 proposals 字段 ⇒ 全拒（调用方回落规则 note）。 */
export function parseReflectProposals(raw: unknown, events: readonly AgentEvent[]): ReflectOutcome {
  const refusals: string[] = [];
  const out: ReflectProposal[] = [];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { proposals: out, refusals: ["反思产出不是对象"] };
  }
  const arr = (raw as { proposals?: unknown }).proposals;
  if (!Array.isArray(arr)) return { proposals: out, refusals: ["反思产出缺 proposals 数组"] };
  const known = evidenceIdSet(events);
  for (const item of arr) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      refusals.push("一条产出不是对象");
      continue;
    }
    const r = item as { kind?: unknown; note?: unknown; evidenceCallIds?: unknown };
    if (r.kind !== "verify-escalate" && r.kind !== "goal-reconfirm" && r.kind !== "cost-throttle") {
      refusals.push("kind 不在封闭集合：" + JSON.stringify(r.kind));
      continue;
    }
    if (typeof r.note !== "string" || r.note.trim().length === 0) {
      refusals.push(r.kind + " 的 note 为空");
      continue;
    }
    if (!Array.isArray(r.evidenceCallIds) || r.evidenceCallIds.length === 0) {
      refusals.push(r.kind + " 无证据 callId——无出处不收");
      continue;
    }
    const ids: string[] = [];
    let bad = false;
    for (const id of r.evidenceCallIds) {
      if (typeof id !== "string" || !known.has(id)) {
        refusals.push(r.kind + " 的证据 callId 指不到事件流：" + JSON.stringify(id));
        bad = true;
        break;
      }
      ids.push(id);
    }
    if (bad) continue;
    out.push({ kind: r.kind, note: sanitizeNote(r.note.trim()), evidenceCallIds: ids });
  }
  return { proposals: out, refusals };
}

/** 应用反思（纯函数）：合法产出按 kind 覆盖 note（每 kind 至多采纳一条——先到先得，反思侧
 *  重复提同一 kind 只会有一条生效）；没有合法产出的 kind 用原 note。结构化字段一律不动。 */
export function applyReflection(patches: readonly StrategyPatch[], proposals: readonly ReflectProposal[]): StrategyPatch[] {
  const byKind = new Map<StrategyPatch["kind"], string>();
  for (const p of proposals) {
    if (!byKind.has(p.kind)) byKind.set(p.kind, p.note);
  }
  return patches.map((p) => (byKind.has(p.kind) ? { ...p, note: byKind.get(p.kind)! } : p));
}
