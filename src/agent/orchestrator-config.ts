import { DEFAULT_COMPACTION_CONFIG, withModelBudget, type CompactionConfig } from "./compaction";
import { DEFAULT_STUCK_CONFIG, type StuckConfig } from "./stuck";

/** 并发上限默认 4（§4.4.1；可配 1–8 留 M3c，本轮常量）。 */
export const MAX_CONCURRENT_WORKERS = 4;
/** read mode max_turns 默认 40（§4.4.6）。到限 → failed(reason=max_turns) + partial 报告。 */
export const READ_MODE_MAX_TURNS = 40;
/** agent_result.summary 上限 2000 token（§4.4.4），超限类型化裁剪。 */
export const SUMMARY_TOKEN_CAP = 2_000;
/** spawn_agent 的 mode 白名单：本轮只接入 read（§0 范围）。 */
export const SPAWN_MODES: readonly string[] = ["read", "write", "pipeline", "supervise"];

/** worker 工具表（read mode，§4.4.6）：read/grep/glob/LSP + 只读 bash（shell_ro）。
 *  **构造时即不含 spawn_agent 与任何写工具**（深度恒 1 的机制化，非运行时报错）。 */
export const WORKER_TOOL_TABLE: readonly string[] = ["read_file", "grep", "glob", "lsp", "shell_ro"];
/** worker 工具表禁入名单（验收断言面：深度闸 + 写闸 + M4a automation_*——定时任务里再嵌套定时 = 配置面失控，§12.2.5）。 */
export const WORKER_FORBIDDEN_TOOLS: readonly string[] = [
  "spawn_agent", "write_file", "edit_file", "run_shell", "clarify", "propose_plan", "verify", "remember",
  // P0-1 同源补漏：read 面的实际排除靠 workerToolSpecs 的 allow 列表（本就不含 shell_rw），
  // 但本常量是「验收断言面」——漏了 shell_rw，J7c 就退化成「碰巧为真」而非名单驱动。
  "shell_rw",
  "automation_create", "automation_update", "automation_delete", "automation_run_now", "automation_list",
];

/** M3b write mode worker 工具表（§4.4.5）：worktree 完全可写 + shell_rw（git 拦截层）+
 *  remember（记忆恒指主 checkout，任务书裁决 2）。**无 spawn_agent / 无 run_shell / 无任何 merge/commit
 *  能力**——合并唯一出口 = git 面板（§4.3），agent 无合并权。 */
export const WRITE_WORKER_TOOL_TABLE: readonly string[] = [
  "read_file", "grep", "glob", "lsp", "write_file", "edit_file", "shell_rw", "remember",
];
/** write mode 禁入名单（验收断言面：深度闸 + 合并权闸 + M4a automation_*）。 */
export const WRITE_WORKER_FORBIDDEN_TOOLS: readonly string[] = [
  "spawn_agent", "run_shell", "clarify", "propose_plan", "verify", "merge", "commit",
  "automation_create", "automation_update", "automation_delete", "automation_run_now", "automation_list",
];

/** 影响面读端工具名（运行时注入工具，与 obs_recall / MCP 同族：不进静态 TOOLS 键域）。 */
export const WORKER_IMPACT_TOOL = "impact_query";

/** worker 的 loop 侧白名单（三重硬闸之二）。影响面开启时追加读端工具——
 *  与 `workerToolSpecs` / `buildWorkerToolTable` 三处必须同源，否则会出现
 *  「模型看得见但执行面没有」或反之（本仓反复踩过的两头断）。 */
export function workerToolTable(mode: "read" | "write", impactAnalysis: boolean): readonly string[] {
  const base = mode === "write" ? WRITE_WORKER_TOOL_TABLE : WORKER_TOOL_TABLE;
  return impactAnalysis ? [...base, WORKER_IMPACT_TOOL] : base;
}

// ---- M3c：pipeline sequencer / 卡死检测 / 成本闸 / worker 压缩 参数 ----

/** worker 压缩参数（§7.5：同一压缩器实例化、参数独立配置——worker 触发更晚 ratio 0.95；
 *  max_turns 闸门在先，压缩是第二道防线；keep_first 映射 = task 任务书 + context 交接，
 *  由 worker 上下文组装结构性保障：task/context 在 system 块，压缩只作用于子流事件投影）。 */
export const WORKER_COMPACTION_CONFIG: Partial<CompactionConfig> = { ratio: 0.95 };

/** worker 的压缩/预算配置：inputLimit 认被路由模型的真实窗口（与主会话 budgetConfig 同口径）。
 *  窗口只定基线，调用方显式覆盖仍可提前触发；但**显式值也绝不超出模型窗口**——超窗 provider 必
 *  400，把 fail-closed 让给远端不如本地钳住。
 *  窗口未知（注入模型 modelFor / 未开路由 / 恢复的旧 handle）⇒ 逐字退回旧行为。
 *  同一份 config 同时喂 shouldCompact 与 runCompaction（触发判定与裁切目标不得两副口径）。 */
export function workerBudgetConfig(
  handle: { modelCtxWindow?: number },
  overrides: Partial<CompactionConfig> = {},
): CompactionConfig {
  const window = handle.modelCtxWindow;
  const base: CompactionConfig = { ...DEFAULT_COMPACTION_CONFIG, ...WORKER_COMPACTION_CONFIG };
  // withModelBudget 未采信窗口时按同一性原样返回（退化窗口：非数 / ≤ 输出预留），据此判窗口是否生效
  const budgeted = withModelBudget(base, window);
  const merged: CompactionConfig = { ...budgeted, ...overrides };
  return budgeted !== base ? { ...merged, inputLimit: Math.min(merged.inputLimit, budgeted.inputLimit) } : merged;
}

/** pipeline stages 上限（V1 链长收敛）。 */
export const MAX_PIPELINE_STAGES = 8;

/** 卡死检测缺省阈值（§4.4.8；OrchestratorOptions.stuckConfig 可配短阈值供验收）。 */
export const ORCHESTRATOR_STUCK_CONFIG: StuckConfig = DEFAULT_STUCK_CONFIG;
