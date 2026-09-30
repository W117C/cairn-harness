import { lstat, readlink, realpath } from "node:fs/promises";
import type { Stats } from "node:fs";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import type { AgentEvent, ClarifyAnswerMap, HarnessHoldReason, ImpactReportEvent } from "../events";

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
  /** D7 覆盖前快照：**缺省开**（主会话直写用户真实工作区，覆盖必须留得回原件，§10.4）。
   *  worker 写侧显式传 false —— 它的 worktree 天然可回滚（§10.10），再抄一份原件只会把
   *  合并那一刻的脏文件面撑大（实测：不给 false 时 write worker 的 mergeWorker 直接判红）。 */
  snapshot?: boolean;
}

export interface ToolResult {
  ok: boolean;
  output: string;
  /** D7 覆盖前快照落成的路径（workspace 相对）。缺席 = 没落快照（新建 / 空文件 / 快照自身失败）。
   *  同一个事实有两个读者：正文里那句给模型看（它得知道去哪儿找回原件），这个字段给事件流与界面看。 */
  snapshotId?: string;
  /** 写工具的结构化变更类型；缺席时事件消费者必须显示 unknown，不能从工具名猜。 */
  change?: "created" | "modified";
  /** 进程退出码；被超时强杀 / 根本没起来 = null。此前只有 `ok` 与拼进 output 的那句
   *  `[exit code: N]` 活到收束处，**结构化信号在 settle 时被丢掉** ⇒ 任何想区分"工具链没装（127）"
   *  与"你的测试挂了"的读者只能去匹配文案。verify 归因需要它，所以在这里补回来。 */
  exitCode?: number | null;
  /** 是否因墙钟上限被强杀（与退出码分开：超时后 code 往往是 null）。 */
  timedOut?: boolean;
  /** 编排侧按住了这一次扩张（`spawn_agent` 的四条拒绝出口之一：钱／并发帽／已取消）。
   *  为什么放在返回体上而不是只写在 output 里：这一句 output 会既给模型看、又被 `triggerDeferredSpawn`
   *  拿去 `includes("并发")` 反推原因——生产端用自己的文案当判据，是同一族的老形状。
   *  缺席 = 这次失败不是「被按住」（例如候选没有 judge 命中）。 */
  hold?: HarnessHoldReason;
}

/** 本仓静态工具名的唯一事实源：联合类型与名字表同源（加一个工具只改这一行）。 */
export const TOOL_NAMES = [
  "read_file", "write_file", "edit_file", "run_shell", "grep", "glob", "lsp",
  "clarify", "propose_plan", "verify",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

/** CC 工具名 → 本仓工具名（§9.3/§9.5 的「CC 名作解析别名」同一条纪律）。
 *  单表同源：hook 的 `if` 匹配与 skill/command 的 allowed-tools、disallowed-tools 共用它，
 *  两处各抄一份就会出现「同一个别名在一处认、另一处不认」。 */
export const CC_TOOL_ALIAS: Record<string, ToolName> = {
  bash: "run_shell", write: "write_file", edit: "edit_file", read: "read_file",
};

/** 申报里的工具名 → 规范名；认不出 = null（调用方负责出声，不静默丢）。 */
export function resolveToolName(raw: string): ToolName | null {
  const t = raw.trim().toLowerCase();
  if ((TOOL_NAMES as readonly string[]).includes(t)) return t as ToolName;
  return CC_TOOL_ALIAS[t] ?? null;
}

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
// 把落点沿软链逐段解析后，校验它仍在 realpath(workspace) 之内。
// 落点不存在时解析到「最深一段存在为止」：新建文件不可能凭空穿透，软链必须先存在于链上。

/** 手动软链解析的层数上限。realpath 遇环抛 ELOOP 收束，readlink 不会——只能自己掐。
 *  取 40：真实路径远够不到，成环转 40 圈也该判失败了（沿 command-shape 的深度上限惯例）。 */
const SYMLINK_DEPTH_CAP = 40;

/** 单段 lstat，失败一律当「不存在」——EACCES 之类在本闸的语义下同样是不予放行。 */
async function lstatOrNull(p: string): Promise<Stats | null> {
  try {
    return await lstat(p);
  } catch {
    return null;
  }
}

/**
 * 逐段解析软链，返回落点解析后最深的那段真实位置（其后若还有段则原样接上）。
 *
 * 不用 realpath 的原因：realpath 要求**整条路径存在**。末段是悬空软链（指向不存在的目标）
 * 时它抛 ENOENT，于是「末段是软链」这个事实被一并丢掉，祖先回溯退到词法父目录——
 * 父目录在界内，真实落点却在界外，门就这么放行了。lstat 对软链本身成功且不跟随，
 * 正好分得开「不存在」（退回接余段）与「是软链」（readlink 后从落点重走）。
 */
async function resolveDeepest(abs: string, label: string): Promise<string> {
  const root = parse(abs).root;
  const pending = abs.slice(root.length).split(sep).filter((s) => s.length > 0);
  let cur = root;
  let links = 0;
  while (pending.length > 0) {
    const next = join(cur, pending.shift()!);
    const st = await lstatOrNull(next);
    if (st === null) return join(next, ...pending); // 这一段起不存在，余段是字面名，原样接上
    if (!st.isSymbolicLink()) {
      cur = next;
      continue;
    }
    if (++links > SYMLINK_DEPTH_CAP) throw new ToolError(`${label}: 软链层数超过 ${SYMLINK_DEPTH_CAP}，疑似成环: ${abs}`);
    // 相对目标按软链自身所在目录解析（与内核同规则）
    const target = await readlink(next);
    const landed = isAbsolute(target) ? resolve(target) : resolve(dirname(next), target);
    const lRoot = parse(landed).root;
    pending.unshift(...landed.slice(lRoot.length).split(sep).filter((s) => s.length > 0));
    cur = lRoot;
  }
  return cur;
}

export async function assertRealContainment(workspace: string, abs: string, label: string): Promise<void> {
  let wsReal: string;
  try {
    wsReal = await realpath(workspace);
  } catch {
    throw new ToolError(`${label}: workspace 不可解析: ${workspace}`);
  }
  const relBack = relative(wsReal, await resolveDeepest(abs, label));
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
//（任意 command → RCE）或 .agent/permissions.json（跨会话提权）。逐段解析软链后复查归属。
export async function assertNotAgentAreaReal(workspace: string, abs: string, label: string): Promise<void> {
  const wsReal = await realpath(workspace).catch(() => null);
  if (wsReal === null) return; // workspace 不可解析时由 assertRealContainment 拒绝（职责不在本闸）
  const relReal = relative(wsReal, await resolveDeepest(abs, label));
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

/** 超上限输出「掐中间」的提示：省略了多少字节要如实报出（不是"输出被裁了"四个字）。
 *  与 truncationNotice 分两个函数而不是加参数：两者的语义相反——一个是"只留了头部"，
 *  一个是"头尾都留、中间丢了"，混成一个名字会让读提示的模型猜错留了哪一段。 */
export function middleTruncationNotice(omittedBytes: number): string {
  return `[truncated: 输出超上限已截断——省略中间 ${String(omittedBytes)} 字节，已保留开头与结尾（测试汇总与报错结论通常在尾部）]`;
}