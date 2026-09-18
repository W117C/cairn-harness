import { realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import type { AgentEvent, ClarifyAnswerMap, ImpactReportEvent } from "../events";

/** 工具可预期失败的统一错误类型：loop 捕获后转成 ok:false 的 tool_result。 */
export class ToolError extends Error {}

/** 等人门等待选项（审查 A-2）：挂起等待必须可被取消/超时收束，否则 pending 解析器永久泄漏。 */
export interface GateWaitOptions {
  /** 会话取消信号：abort 时等待立即拒绝（fail-closed），不悬到进程结束。 */
  signal?: AbortSignal;
  /** 等待上限 ms：超时拒绝。缺省不限时（交互等人语义不变）。 */
  timeoutMs?: number;
}

/** 澄清门通道：clarify 工具挂起等表单提交（仿 AskGate；缺省 = fail-closed）。 */
export interface ClarifyChannel {
  wait(callId: string, opts?: GateWaitOptions): Promise<ClarifyAnswerMap>;
}
/** 方案门通道：propose_plan 工具挂起等批准（缺省 = fail-closed）。 */
export interface PlanChannel {
  waitApproval(callId: string, opts?: GateWaitOptions): Promise<"approved" | "rejected">;
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
  /** C12（审查 P2）：会话取消信号——长驻工具（run_shell/LSP）可订阅它提前收束，
   *  不再只能等 60s 超时；缺省 undefined = 行为不变。 */
  signal?: AbortSignal;
  /** M7 影响面：write_file/edit_file 成功落盘后计算跨文件波及。缺省 undefined = 零行为
   *  （门禁/单测路径不注入）。best-effort：钩子自身失败不得影响已成功的写入。 */
  impact?: ImpactHook;
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

// C3（审查 P1-6）：.agent 拒写只在词法 rel 段判定可被软链绕过——`foo -> .agent` 的 rel 里
// 没有 ".agent" 字样，两道既有闸（词法 + containment）都放行，写入落到 .agent/lsp.json
//（任意 command → RCE）或 .agent/permissions.json（跨会话提权）。realpath 解析落点后复查归属。
export async function assertNotAgentAreaReal(workspace: string, abs: string, label: string): Promise<void> {
  const wsReal = await realpath(workspace).catch(() => null);
  if (wsReal === null) return; // workspace 不可解析时由 assertRealContainment 拒绝（职责不在本闸）
  let cur = abs;
  for (;;) {
    try {
      cur = await realpath(cur);
      break;
    } catch {
      const parent = dirname(cur);
      if (parent === cur) return; // 链根都不可解析：同上，交 containment 判
      cur = parent;
    }
  }
  const relReal = relative(wsReal, cur);
  if (relReal.split(/[\\/]/).includes(".agent")) {
    throw new ToolError(`${label}: .agent/ 是系统区——路径经软链解析后写入落点在 .agent/ 内（${relReal}），已拒绝: ${abs}`);
  }
}

/** M7 影响面钩子：write_file/edit_file 成功后由 loop 注入。返回 null = 文件不在影响图内
 *  （非 js/ts、未扫描、不存在）→ 不发事件；返回报告 = 发 impact_report 事件并把可读摘要回注
 *  tool_result（模型据此知道改这一处会波及哪些调用点，是「返工少」的护栏）。
 *  抛错（含 grammar 环境级缺失的 ImpactUnavailableError）由 appendImpact 统一吞掉并记日志。 */
export type ImpactHook = (
  fileRel: string,
) => Promise<{ event: ImpactReportEvent; contextNote: string } | null>;

/** 写工具成功后的影响面富化：事件先于 tool_result 落流（顺序可读），摘要并进输出。
 *  钩子缺省/返回 null/抛错都不改写盘结果——写入已成功，护栏缺位不能把成功回滚成失败。 */
export async function appendImpact(ctx: ToolContext, rel: string, base: string): Promise<string> {
  if (!ctx.impact) return base;
  try {
    const r = await ctx.impact(rel);
    if (r === null) return base;
    if (ctx.emit) await ctx.emit(r.event);
    return base + "\n" + r.contextNote;
  } catch (err) {
    console.warn("[impact] 影响面计算失败，跳过事件（写入已成功，不受影响）:", err instanceof Error ? err.message : String(err));
    return base;
  }
}

/** 统一的截断提示（一行）。 */
export function truncationNotice(limitKB: number): string {
  return `[truncated: 输出超过 ${limitKB}KB 上限，已截断]`;
}