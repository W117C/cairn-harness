import { realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
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
  // M2d：name 是展示/查表字符串（注册表键域仍是 ToolName；remember 等运行时注入工具不进静态键域）
  name: ToolName | string;
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

// 内容归属校验（审查 C-2/C-3，根因 3）：词法 resolve/relative 挡不住「工作区内软链指向外部」——
// 把目标沿现存祖先链 realpath 后，校验落点仍在 realpath(workspace) 之内。
// 目标不存在时最深现存祖先即其父目录：新建文件不可能凭空穿透，软链必须先存在于链上。
export async function assertRealContainment(workspace: string, abs: string, label: string): Promise<void> {
  let wsReal: string;
  try {
    wsReal = await realpath(workspace);
  } catch {
    throw new ToolError(`${label}: workspace 不可解析: ${workspace}`);
  }
  let cur = abs;
  for (;;) {
    try {
      cur = await realpath(cur);
      break;
    } catch {
      const parent = dirname(cur);
      if (parent === cur) throw new ToolError(`${label}: 路径不可解析: ${abs}`);
      cur = parent;
    }
  }
  const relBack = relative(wsReal, cur);
  if (relBack !== "" && (relBack.startsWith("..") || isAbsolute(relBack))) {
    throw new ToolError(`${label}: 路径经软链解析后越出 workspace 边界: ${abs}`);
  }
}

// .agent/ 是系统区（审查 C-11：permissions.json 跨会话提权 / lsp.json 任意 command RCE 面 / plugins / memory）。
// 记忆走 remember 专用通道、配置由用户维护——内容工具对整个 .agent/ 子树一律拒写。
export function assertNotAgentArea(rel: string, label: string): void {
  if (typeof rel === "string" && rel.split(/[\\/]/).includes(".agent")) {
    throw new ToolError(`${label}: .agent/ 是系统区（权限/记忆/插件配置），禁止经内容工具写入: ${rel}`);
  }
}

/** 统一的截断提示（一行）。 */
export function truncationNotice(limitKB: number): string {
  return `[truncated: 输出超过 ${limitKB}KB 上限，已截断]`;
}