// 验证器选择与执行：不同任务类型走不同外部信号，选不到就 fail-closed，不用模型自述顶替证据。
//
// 依据（交付说明里的证据映射第 1 条）：LangChain 固定模型只改 harness，最大单项收益来自
// 「build → test → 对照 spec 复核 → 修」闭环（+13.7 点）；而自反思没有外部信号时经常不涨反跌。
// 所以这里的第一原则是：**先选一个能判真假的命令，再谈让模型修**。
import { loadVerifyConfig, runVerifyOutcome, verifyCommands, type ExecFn, type VerifyConfig, type VerifyOutcome } from "../verify";

export type VerifierKind = "task" | "static+test" | "static" | "test" | "none";

export interface VerificationPlan {
  kind: VerifierKind;
  /** 要跑的命令（空 = 选不到可信判据）。 */
  commands: string[];
  timeoutMs: number;
  source: "task" | "config" | "probed" | "none";
  /** 为什么选它 / 为什么选不到——会原样写进报告，审计面不猜。 */
  reason: string;
}

export interface PlanInput {
  workspace: string;
  /** 人手声明的验收命令（优先级最高）。 */
  declared?: { commands: readonly string[]; timeoutMs?: number };
}

const DEFAULT_TIMEOUT_MS = 300_000;

/** 任务类型 → 验证器。顺序即优先级：任务声明 > 仓库配置 > 语言探测 > 无面（fail-closed）。 */
export async function planVerification(input: PlanInput): Promise<VerificationPlan> {
  if (input.declared !== undefined && input.declared.commands.length > 0) {
    return {
      kind: "task",
      commands: [...input.declared.commands],
      timeoutMs: input.declared.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      source: "task",
      reason: "task-declared verifier",
    };
  }

  const loaded = await loadVerifyConfig(input.workspace);
  const commands = verifyCommands(loaded.config);
  if (commands.length > 0) {
    const hasStatic = (loaded.config.typecheck?.length ?? 0) > 0 || (loaded.config.lint?.length ?? 0) > 0;
    const hasTest = (loaded.config.test?.length ?? 0) > 0;
    return {
      kind: hasStatic && hasTest ? "static+test" : hasStatic ? "static" : "test",
      commands,
      timeoutMs: loaded.config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      source: loaded.source,
      reason: loaded.source === "config" ? "repository .agent/config.json" : "probed from repository tooling",
    };
  }

  return {
    kind: "none",
    commands: [],
    timeoutMs: DEFAULT_TIMEOUT_MS,
    source: "none",
    reason: "no verifier: repository has no runnable typecheck/lint/test surface; declare one with --verify <command>",
  };
}

/** 执行一份计划；统一走生产同一条 `runVerifyOutcome`（超时、输出环、归因都不另写一份）。 */
export async function runVerificationPlan(
  plan: VerificationPlan,
  workspace: string,
  exec?: ExecFn,
  signal?: AbortSignal,
): Promise<VerifyOutcome> {
  if (plan.kind === "none") {
    return {
      ok: false,
      skipped: plan.reason,
      results: [{ command: "(none)", ok: false, output: plan.reason, cause: "no-surface", exitCode: null }],
    };
  }
  const config: VerifyConfig = { test: [...plan.commands], timeoutMs: plan.timeoutMs };
  return runVerifyOutcome(workspace, exec, signal, { config, source: plan.source === "task" ? "task" : plan.source });
}

/** 报告用的一行摘要；不回显命令全文里的密钥形态（命令来自仓库，审计面只留名字）。 */
export function describePlan(plan: VerificationPlan): string {
  const commands = plan.commands.length === 0 ? "(none)" : plan.commands.join(" ; ");
  return `${plan.kind} [${plan.source}] ${commands}`;
}
