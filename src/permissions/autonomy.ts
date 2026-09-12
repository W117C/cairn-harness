// M1c 评估管线（§11.7.1）：纯函数 evaluate(tool, args, session)，四层固定序、先命中先短路：
//   L0 硬边界（只读档摘除 + M1b 方案门，deny 位次最前——摘除的工具规则库不能复活）
//   → L1 deny 规则 → L2 ask 规则（任何档位含自主档都绕不过）
//   → L3 档位层（规则库 allow 命中放行 / session_kind 记忆 / 逐次审批）
//   → L4 风险层（三通道，critical 任何档强制审批——allow 规则也批不掉 critical）。
// 零私有状态：规则库与放行集是仅有的两个输入源；断路器计数在 session 入参里，evaluate 只读不写
// （调用方经 note* helper 更新）——同一输入两次调用结果一致。
import type { ToolName } from "../tools/base";
import type { PermissionMode } from "./index";
import { judgeChain, normalizeCommand, type PermissionRule } from "./rules";
import {
  isNetworkCommand,
  isShellFamily,
  maxRisk,
  modelRisk,
  RISK_ORDER,
  sandboxRisk,
  staticRisk,
  type RiskFinding,
  type RiskLevel,
} from "./risk";

/** 自动放行来源审计（§11.7.5）：记进 tool_result.auto，零新事件类型。 */
export interface AutoMeta {
  source: "rule" | "session_scope";
  ruleId?: string;
}

/** 带审计元数据的工具结果：gatedTool 在自动放行时附带，loop 透传进 tool_result 事件。
 * ToolResult 本体在 src/tools（只读白名单外），故此处做结构扩展而非改动它。 */
export interface ToolResultWithAudit {
  ok: boolean;
  output: string;
  auto?: AutoMeta;
}

export type EvaluateDecision =
  | { verdict: "approve"; risk: RiskLevel; auto?: AutoMeta }
  | { verdict: "ask"; reason: string; risk: RiskLevel; riskReasons: string[] }
  | { verdict: "deny"; reason: string };

/** 审批 scope 三档（§10.4 回写 / §11.7.5）。 */
export type AskScope = "once" | "session_kind" | "always";

/** 会话内断路器阈值（§11.7.6）：连续自动放行上限 50。 */
export const MAX_AUTO_APPROVALS = 50;
/** critical 连续被拒 N 次 → 提示降档回默认。 */
export const CRITICAL_DENIAL_LIMIT = 3;

export interface AutonomySession {
  mode: PermissionMode;
  /** 两层规则库加载结果（deny/ask/allow 并集）。 */
  rules: PermissionRule[];
  /** session_kind 放行集：会话内存放行，不落盘。key = scopeKey()。 */
  sessionScopes: ReadonlySet<string>;
  /** 沙箱可用性：null = 未接线（不触发装不下通道）；false = 自检过但降级。 */
  sandboxAvailable: boolean | null;
  /** 方案门（M1b）：调用方每次 evaluate 前刷新；evaluate 只读。 */
  planBlocked: boolean;
  /** 断路器：会话内连续 scope 自动放行计数（调用方维护）。 */
  consecutiveAutoApprovals: number;
  breakerTripped: boolean;
  consecutiveCriticalDenials: number;
}

export function newAutonomySession(
  mode: PermissionMode,
  init: {
    rules?: PermissionRule[];
    sessionScopes?: Set<string>;
    sandboxAvailable?: boolean | null;
  } = {},
): AutonomySession {
  return {
    mode,
    rules: init.rules ?? [],
    sessionScopes: init.sessionScopes ?? new Set<string>(),
    sandboxAvailable: init.sandboxAvailable ?? null,
    planBlocked: false,
    consecutiveAutoApprovals: 0,
    breakerTripped: false,
    consecutiveCriticalDenials: 0,
  };
}

/** 写向工具（含 shell 写面）：只读档摘除、方案门、沙箱通道按此判定。
 *  注：shell_ro 是静态白名单只读面，**不算**写向——否则只读档会把 worker 的只读 shell 一并摘掉；
 *  shell_rw 可执行任意非 git 命令，必须计入写向（否则沙箱降级通道对它整体失效）。 */
const SIDE_EFFECT_TOOLS: ReadonlySet<string> = new Set([
  "write_file",
  "edit_file",
  "run_shell",
  "shell_rw",
]);

export function isSideEffectTool(tool: string): boolean {
  return SIDE_EFFECT_TOOLS.has(tool);
}

/** scope 记忆键：shell 类按归一化命令全串（出网审计粒度），其余按工具级（「此类」语义）。
 *  键里保留字面工具名——主会话 run_shell 与 worker shell_rw/shell_ro 的放行集不互相串门。 */
export function scopeKey(tool: ToolName, args: Record<string, unknown>): string {
  if (isShellFamily(tool) && typeof args.command === "string") {
    return tool + "\u241F" + normalizeCommand(args.command);
  }
  return tool + "\u241F*";
}

export function isNetworkCommandCall(tool: ToolName, args: Record<string, unknown>): boolean {
  if (!isShellFamily(tool)) return false;
  return isNetworkCommand(typeof args.command === "string" ? args.command : undefined);
}

interface RiskChannels {
  risk: RiskLevel;
  reasons: string[];
}

function collectRisk(
  tool: ToolName,
  args: Record<string, unknown>,
  s: AutonomySession,
): RiskChannels {
  const findings: RiskFinding[] = [
    staticRisk(tool, args),
    modelRisk(args),
    sandboxRisk(s.sandboxAvailable, tool, isSideEffectTool(tool)),
  ];
  let risk: RiskLevel = "none";
  const reasons: string[] = [];
  for (const f of findings) {
    if (f.level === "none") continue;
    risk = maxRisk(risk, f.level);
    reasons.push(f.reason);
  }
  return { risk, reasons };
}

/** 四层评估管线（纯函数，先命中先短路）。 */
export function evaluate(
  tool: ToolName,
  args: Record<string, unknown>,
  s: AutonomySession,
): EvaluateDecision {
  const cmd = isShellFamily(tool) && typeof args.command === "string" ? args.command : undefined;
  const channels = collectRisk(tool, args, s);
  const risk = channels.risk;

  // ---- L0 硬边界：只读档摘除（规则库不能复活被摘除的工具）+ 方案门（M1b 写禁）----
  if (s.mode === "read-only" && isSideEffectTool(tool)) {
    return { verdict: "deny", reason: "只读档摘除写向工具" };
  }
  if (s.planBlocked && isSideEffectTool(tool)) {
    return { verdict: "deny", reason: "存在未批准 plan（方案门：先批后写）" };
  }

  // ---- L1 deny 规则：命中即拦 ----
  const chain = judgeChain(s.rules, tool, cmd);
  if (chain.verdict === "deny") {
    return { verdict: "deny", reason: `deny 规则命中（${chain.ruleId}）` };
  }

  // ---- L2 ask 规则：命中即强制审批，任何档位含自主档都绕不过 ----
  if (chain.verdict === "ask") {
    return {
      verdict: "ask",
      reason: `ask 规则命中（${chain.ruleId}）`,
      risk,
      riskReasons: channels.reasons,
    };
  }

  // ---- L3 档位层 ----
  // 规则库 allow 命中放行（§11.7.2 矩阵）；但 critical 任何档位强制审批，allow 规则也批不掉
  if (chain.verdict === "allow") {
    if (risk === "critical") {
      return {
        verdict: "ask",
        reason: "critical 任何档位强制审批（allow 规则不豁免）",
        risk,
        riskReasons: channels.reasons,
      };
    }
    return { verdict: "approve", risk, auto: { source: "rule", ruleId: chain.ruleId } };
  }
  if (s.mode === "default" && isSideEffectTool(tool)) {
    // 逐次审批；session_kind 记忆可跳过（网络类命令强制 once 除外；断路器触发后记忆失效）
    const key = scopeKey(tool, args);
    const scopeAllowed =
      !s.breakerTripped && !isNetworkCommandCall(tool, args) && s.sessionScopes.has(key);
    if (scopeAllowed) {
      return { verdict: "approve", risk, auto: { source: "session_scope", ruleId: key } };
    }
    return {
      verdict: "ask",
      reason: s.breakerTripped
        ? `断路器触发：连续自动放行达 ${String(MAX_AUTO_APPROVALS)}，降级为逐次审批（直至会话重开）`
        : "默认档逐次审批",
      risk,
      riskReasons: channels.reasons,
    };
  }

  // ---- L4 风险层：三通道任一命中即产生审批；critical 任何档位强制审批（自主档不是 bypass）----
  if (risk === "critical") {
    return { verdict: "ask", reason: "critical 任何档位强制审批", risk, riskReasons: channels.reasons };
  }
  if (s.mode === "auto") {
    const network = isNetworkCommandCall(tool, args);
    if (RISK_ORDER[risk] >= RISK_ORDER.high) {
      return { verdict: "ask", reason: "风险≥high 送审（自主档）", risk, riskReasons: channels.reasons };
    }
    if (network && RISK_ORDER[risk] >= RISK_ORDER.medium) {
      return {
        verdict: "ask",
        reason: "网络类命令 risk≥medium 送审（自主档，出网审计）",
        risk,
        riskReasons: channels.reasons,
      };
    }
  } else if (RISK_ORDER[risk] >= RISK_ORDER.high) {
    // 只读/默认档的读类工具：风险通道仍生效（三通道任一命中即审批）
    return { verdict: "ask", reason: "风险≥high 送审", risk, riskReasons: channels.reasons };
  }

  return { verdict: "approve", risk };
}

// ---- 断路器 helper（调用方维护计数，evaluate 保持纯函数）----

/** scope 自动放行生效一次：计数 +1；达到上限即触发断路器（此后逐次审批，直至会话重开）。 */
export function noteScopeApproval(s: AutonomySession): void {
  s.consecutiveAutoApprovals += 1;
  if (s.consecutiveAutoApprovals >= MAX_AUTO_APPROVALS) s.breakerTripped = true;
}

/** 手工决议打断「连续」链（断路器计的是连续自动放行）。 */
export function noteManualDecision(s: AutonomySession): void {
  s.consecutiveAutoApprovals = 0;
}

export function noteCriticalDenial(s: AutonomySession): void {
  s.consecutiveCriticalDenials += 1;
}

export function noteCriticalResolved(s: AutonomySession): void {
  s.consecutiveCriticalDenials = 0;
}

/** critical 连续被拒达上限 → 降档提示（§11.7.6）。 */
export function downgradeSuggestion(s: AutonomySession): string | null {
  if (s.consecutiveCriticalDenials < CRITICAL_DENIAL_LIMIT) return null;
  return `critical 连续 ${String(s.consecutiveCriticalDenials)} 次被拒——建议降档回默认档`;
}

/** 模型可见工具表：只读档把写向工具摘除（§11.7.2，Claude bare-name deny 同构）。
 * 与 gateToolSpecs 的工具集同源（含 verify 系统门）。 */
export function toolTableFor(mode: PermissionMode): ToolName[] {
  const all: ToolName[] = [
    "read_file", "write_file", "edit_file", "run_shell", "grep", "glob", "lsp",
    "clarify", "propose_plan", "verify",
  ];
  if (mode === "read-only") {
    return all.filter((t) => !isSideEffectTool(t));
  }
  return all;
}
