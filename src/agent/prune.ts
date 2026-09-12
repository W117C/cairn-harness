// M2b 任务 6（§7.4 定稿）：prune 类型化裁剪——每轮组装时本地计算、零 LLM（OC prune 实证）。
// 参数照抄 OC：保护区 40k（从最新回退）+ 最小修剪 20k（低于不裁，防无效修剪）+ 最近 2 轮免剪。
// 免剪名单：skill 内容 + 固定回注（user_message / 最新摘要注入）+ 方案/验证卡投影（plan/verify/clarify）。
// 打桩：投影期替换 "[Old tool result content cleared]"；被裁原文写会话附件目录可回取（GEM 同构）。
// 事件流零删改：prune 只产出「事件 id → 替换文本」映射，由组装投影（context.ts）消费。
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentEvent } from "../events";

export const PRUNE_PROTECT_TOKENS = 40_000;
export const PRUNE_MINIMUM_TOKENS = 20_000;
export const RECENT_ROUNDS_EXEMPT = 2;
export const PRUNED_PLACEHOLDER = "[Old tool result content cleared]";

export interface PruneConfig {
  /** 保护区 token（从最新回退，区内不裁）。 */
  protectTokens: number;
  /** 最小修剪 token：预计裁剪量低于此不裁（防无效修剪）。 */
  minimumTokens: number;
  /** 最近 N 轮免剪（一轮 = user_message 起、下一条 user_message 前的事件段）。 */
  recentRounds: number;
  /** 免剪名单（工具名）：skill 内容注入类。 */
  exemptTools: string[];
}

export const DEFAULT_PRUNE_CONFIG: PruneConfig = {
  protectTokens: PRUNE_PROTECT_TOKENS,
  minimumTokens: PRUNE_MINIMUM_TOKENS,
  recentRounds: RECENT_ROUNDS_EXEMPT,
  exemptTools: ["skill", "remember", "memory"],
};

/** 方案/验证卡投影免剪：clarify / plan / verify 家族输出（卡面数据源，裁掉卡片就瞎了）。 */
function isCardProjection(e: AgentEvent): boolean {
  return (
    e.type === "clarify_requested" ||
    e.type === "plan_proposed" ||
    e.type === "plan_approved" ||
    e.type === "verify_result" ||
    (e.type === "tool_result" && /^\[verify\]/.test(e.output))
  );
}

/** 固定回注免剪：全部 user_message（CC/CL 先例，坑二十同口径）。 */
function isFixedReinjection(e: AgentEvent): boolean {
  return e.type === "user_message";
}

/** 最近 N 轮免剪：免剪区 = [第 N 条（从尾数）user_message 位置, end)；不足 N 轮 → 全免剪（返回 0）。 */
function recentRoundBoundaries(events: AgentEvent[], recentRounds: number): number {
  let seen = 0;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === "user_message") {
      seen++;
      if (seen === recentRounds) return i; // 该 user_message = 最老一轮「免剪轮」的起点
    }
  }
  return 0;
}

export interface PruneInput {
  events: AgentEvent[];
  config?: Partial<PruneConfig>;
  /** 附件目录（被裁原文写这里可回取）；缺省不落盘（纯投影测试）。 */
  attachmentsDir?: string;
  /** 会话 id（附件文件名命名空间）。 */
  sessionId?: string;
}

export interface PruneOutcome {
  /** 事件 id（1-based 行号）→ 打桩文本。空 = 没裁。 */
  replacements: Map<number, string>;
  /** 预计节省 token（chars/4）。 */
  savedTokens: number;
  /** 未裁原因（none/too-small/below-protect/exempt-all）。 */
  why: "none" | "too-small" | "saved";
  /** 被裁原文的附件路径（有 attachmentsDir 时）。 */
  attachments: string[];
}

/** prune 判定用的预建索引（一次 O(n) 扫描的产物）。 */
export interface PruneIndex {
  /** 最近 N 轮免剪边界（recentRoundBoundaries 的预计算结果）。 */
  boundary: number;
  /** tool_call id → 工具名。callId 由 provider 生成、每次调用唯一，故「全量建表」与
   *  旧的「每个候选反向扫描取最近一次」同语义，但把 O(n)/次 降到 O(1)/次。 */
  callTool: Map<string, string>;
}

/** 预建索引：computePrune 单遍扫描，供全部候选复用。 */
export function buildPruneIndex(events: AgentEvent[], config: PruneConfig): PruneIndex {
  const callTool = new Map<string, string>();
  for (const e of events) {
    if (e.type === "tool_call") callTool.set(e.id, e.name);
  }
  return { boundary: recentRoundBoundaries(events, config.recentRounds), callTool };
}

/** 免剪判定（单测/检查脚本复用）。传 precomputed 时复用索引（computePrune 的 O(n) 路径）；
 *  不传则就地建索引（单点调用的兼容路径，语义一致）。 */
export function isPruneExempt(
  events: AgentEvent[],
  index: number,
  config: PruneConfig,
  precomputed?: PruneIndex,
): boolean {
  const e = events[index];
  if (e.type !== "tool_result") return true; // 只动 tool_result
  if (isCardProjection(e) || isFixedReinjection(e)) return true;
  const idx = precomputed ?? buildPruneIndex(events, config);
  // 免剪名单：同 callId 的 tool_call 名字在名单里 = skill 内容注入
  const callName = idx.callTool.get((e as { callId: string }).callId);
  if (callName !== undefined && config.exemptTools.includes(callName)) return true;
  // grep/glob 命中已经是整形产物（§6.2 上限内），裁掉信息损失大于收益——只裁大块 read/shell 类
  if (callName === "grep" || callName === "glob" || callName === "lsp") return true;
  // 最近 N 轮免剪
  if (index >= idx.boundary) return true;
  // 权限拒绝/错误结果通常很短且高价值，不裁
  if (!(e as { ok?: boolean }).ok) return true;
  return false;
}

/** 附件名安全化：sessionId/callId 都可能来自模型侧输入，直接拼路径会被 `../` 越出
 *  attachmentsDir（目录穿越）。清洗到安全字符集，再用原值 sha1 前 8 位防碰撞
 *  （清洗会把不同原值映射到同一串，如 "a/b" 与 "a:b"）。 */
function safeSegment(raw: string, maxLen: number): string {
  return raw.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, maxLen);
}

/** 原文回取：附件文件名（sha1 前缀防碰撞 + 清洗后的 sessionId/callId）。 */
function attachmentName(sessionId: string, callId: string): string {
  const digest = createHash("sha1").update(callId).digest("hex").slice(0, 8);
  return `${safeSegment(sessionId, 32)}-${digest}-${safeSegment(callId, 64)}.txt`;
}

/**
 * 计算 prune 投影：从最新回退累计 token 直到保护区边界，对区外的免剪外 tool_result
 * 生成打桩映射。零 LLM、纯本地、确定性。
 */
export function computePrune(input: PruneInput): PruneOutcome {
  const config: PruneConfig = { ...DEFAULT_PRUNE_CONFIG, ...input.config };
  const { events } = input;
  const out: PruneOutcome = { replacements: new Map(), savedTokens: 0, why: "none", attachments: [] };
  if (events.length === 0) return out;

  // 索引只建一次：boundary 与 callId→工具名 都是全量不变量，循环内复用。
  // （原实现对每个候选都重算 recentRoundBoundaries 并反向扫描定位 tool_call → O(n²)；
  //  长会话下这是组装路径上最大的一处平方开销。）
  const idx = buildPruneIndex(events, config);
  const boundary = idx.boundary;
  // 从最新回退累计到 protectTokens 为止是保护区；区外候选按从旧到新裁
  let acc = 0;
  let protectStart = events.length; // [protectStart, end) = 保护区
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    const chars =
      e.type === "tool_result" ? e.output.length :
      e.type === "assistant_message" ? e.content.length :
      e.type === "user_message" ? e.content.length :
      e.type === "assistant_delta" ? e.text.length :
      e.type === "tool_call" ? JSON.stringify(e.args).length : 0;
    acc += Math.ceil(chars / 4);
    if (acc >= config.protectTokens) {
      protectStart = i;
      break;
    }
    protectStart = i;
  }

  const candidates: number[] = [];
  for (let i = 0; i < protectStart && i < boundary; i++) {
    if (!isPruneExempt(events, i, config, idx)) candidates.push(i);
  }
  if (candidates.length === 0) {
    out.why = "none";
    return out;
  }
  // 最小修剪闸：预计裁剪 < minimumTokens → 不裁（防无效修剪）
  let wouldSave = 0;
  for (const i of candidates) wouldSave += Math.ceil((events[i] as { output: string }).output.length / 4);
  if (wouldSave < config.minimumTokens) {
    out.why = "too-small";
    return out;
  }

  for (const i of candidates) {
    const e = events[i] as { output: string; callId: string };
    out.replacements.set(i + 1, PRUNED_PLACEHOLDER); // 事件 id = 1-based 行号
    out.savedTokens += Math.ceil(e.output.length / 4) - Math.ceil(PRUNED_PLACEHOLDER.length / 4);
    if (input.attachmentsDir) {
      const file = join(input.attachmentsDir, attachmentName(input.sessionId ?? "s", e.callId));
      out.attachments.push(file);
    }
  }
  out.why = "saved";
  return out;
}

/** 被裁原文写附件目录（computePrune 之后调用；写失败不抛——回取是尽力而为）。 */
export async function writePruneAttachments(
  events: AgentEvent[],
  outcome: PruneOutcome,
  attachmentsDir: string,
  sessionId: string,
): Promise<void> {
  try {
    await mkdir(attachmentsDir, { recursive: true });
    for (const id of outcome.replacements.keys()) {
      const e = events[id - 1];
      if (e.type !== "tool_result") continue;
      const file = join(attachmentsDir, attachmentName(sessionId, e.callId));
      await writeFile(file, e.output, "utf8");
    }
  } catch (err) {
    console.debug("[prune] 附件写失败（回取不可用，不阻断）:", err instanceof Error ? err.message : String(err));
  }
}

/** 附件回取路径（prune-check ④「读回且逐字一致」用）。 */
export function attachmentPathFor(attachmentsDir: string, sessionId: string, callId: string): string {
  return join(attachmentsDir, attachmentName(sessionId, callId));
}
