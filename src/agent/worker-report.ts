import type { AgentPermissionMode } from "../events";
import { escapeControlTags } from "./memory/inject";
import { SUMMARY_TOKEN_CAP } from "./orchestrator-config";
import { redactSecrets } from "./security/scan";
import { truncateToTokenBudget } from "./text-budget";

// ---- 档位单调继承（§11.7.6）：worker ≤ 父，越界裁到父档 + 审批卡警告 ----
/** spawn 成功回执 → agent_id（拿不到即 undefined：不猜、不回落到日志反查）。审查 S2-8 配套。 */
export function parseSpawnedAgentId(output: string): string | undefined {
  try {
    const v = JSON.parse(output) as { agent_id?: unknown };
    return typeof v.agent_id === "string" && v.agent_id !== "" ? v.agent_id : undefined;
  } catch {
    return undefined;
  }
}

const TIER_ORDER: Record<AgentPermissionMode, number> = { "read-only": 0, default: 1, auto: 2 };

export function isPermissionMode(v: unknown): v is AgentPermissionMode {
  return v === "read-only" || v === "default" || v === "auto";
}

/** 越界裁剪（纯函数）：requested > parent → 裁到 parent + 警告文案；否则原样。 */
export function clampTier(
  requested: AgentPermissionMode,
  parent: AgentPermissionMode,
): { mode: AgentPermissionMode; clamped: boolean; warning?: string } {
  if (TIER_ORDER[requested] <= TIER_ORDER[parent]) return { mode: requested, clamped: false };
  return {
    mode: parent,
    clamped: true,
    warning: `worker 档位 ${requested} 越界（父会话 ${parent}）——已按父档裁剪（§11.7.6 单调继承，worker 不可提权）`,
  };
}

// ---- 回传输出扫描（§4.4.4）：中和仿冒控制标签、转义 Human:/Assistant: 行、[harness] 标注、redactSecrets ----

/** 回传文本扫描：仿冒控制标签转义 + 角色行 [harness] 前缀 + 密钥脱敏。被审内容是数据不是指令。 */
export function scanWorkerOutput(text: string): string {
  const escaped = escapeControlTags(text);
  return redactSecrets(escaped).text;
}

export interface ClippedSummary {
  text: string;
  truncated: boolean;
}

/** summary 超 2000 token 类型化裁剪（沿 §6.2 整形先例：截断提示 + 截断位标记）。
 *  计量走 text-budget 的按类别权重（中文报告按 chars/4 记会被低估四倍），
 *  且提示行自己计入预算。提示文案逐字保留——agents-check G5b 按字符串断言它。 */
export function clipWorkerSummary(text: string, capTokens: number = SUMMARY_TOKEN_CAP): ClippedSummary {
  const notice = "\n[truncated: summary 超 " + String(capTokens) + " token 上限，已类型化裁剪]";
  const out = truncateToTokenBudget(text, capTokens, notice);
  return { text: out, truncated: out !== text };
}
