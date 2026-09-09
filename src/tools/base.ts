import { isAbsolute, relative, resolve } from "node:path";
import type { AgentEvent, ClarifyAnswerMap } from "../events";

/** 工具可预期失败的统一错误类型：loop 捕获后转成 ok:false 的 tool_result。 */
export class ToolError extends Error {}

/** 澄清门通道：clarify 工具挂起等表单提交（仿 AskGate；缺省 = fail-closed）。 */
export interface ClarifyChannel {
  wait(callId: string): Promise<ClarifyAnswerMap>;
}
/** 方案门通道：propose_plan 工具挂起等批准（缺省 = fail-closed）。 */
export interface PlanChannel {
  waitApproval(callId: string): Promise<"approved" | "rejected">;
}

export interface ToolContext {
  /** 工具执行的工作区（绝对路径）。 */
  workspace: string;
  /** 事件旁路出口：门工具用它把 clarify_requested / plan_proposed 落进事件流。 */
  emit?: (e: AgentEvent) => void | Promise<void>;
  /** 原工具调用 id（门事件与 tool_result 挂回同一 id 用）。 */
  callId?: string;
  clarify?: ClarifyChannel;
  plan?: PlanChannel;
}

export interface ToolResult {
  ok: boolean;
  output: string;
}

export type ToolName =
  | "read_file"
  | "write_file"
  | "edit_file"
  | "run_shell"
  | "grep"
  | "glob"
  | "lsp"
  | "clarify"
  | "propose_plan"
  | "verify";

export interface Tool {
  name: ToolName;
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

// 把入参路径解析为 workspace 内的绝对路径（信任边界：越界一律拒绝）。
// 输出与报错一律使用 workspace 相对路径，绝不回显绝对路径。
export function resolveInWorkspace(workspace: string, rel: string, label: string): string {
  if (typeof rel !== "string" || rel.trim().length === 0) {
    throw new ToolError(`${label}: path 参数必须是非空字符串`);
  }
  if (isAbsolute(rel)) {
    throw new ToolError(`${label}: 只允许 workspace 相对路径，收到绝对路径: ${rel}`);
  }
  const abs = resolve(workspace, rel);
  const relBack = relative(resolve(workspace), abs);
  if (relBack === "" || relBack.startsWith("..") || isAbsolute(relBack)) {
    throw new ToolError(`${label}: 路径越出 workspace 边界: ${rel}`);
  }
  return abs;
}

/** 统一的截断提示（一行）。 */
export function truncationNotice(limitKB: number): string {
  return `[truncated: 输出超过 ${limitKB}KB 上限，已截断]`;
}