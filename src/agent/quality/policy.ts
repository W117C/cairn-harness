// 质量档：把「验证闭环 / 上下文策展 / 推理预算 / 工具面收敛」四件事收成一组可执行的常量与判据。
//
// 这里只放**策略**，不放执行：执行落在 loop（强制绿验）、session-provider（分阶段档位）、
// quality/runner（阶段编排）与本目录其余纯模块。任何一处需要阈值时从这里取，别在调用点再抄一份。
import type { ActiveReasoningEffort } from "../../providers/reasoning";
import type { ThinkingEffort } from "../../providers/capabilities";
import type { AgentEvent } from "../../events";
import { DEFAULT_COMPACTION_CONFIG, type CompactionConfig } from "../compaction";
import type { ToolName } from "../../tools/base";

/** 一次质量 run 的阶段。`verify` 不调模型（外部信号）；`accept` 只在红字回收后需要模型复核。 */
export type QualityPhase = "plan" | "execute" | "verify" | "repair" | "accept";

export interface PhaseBudget {
  /** 该阶段每次请求的思考档；`off` = 不展开 reasoning 参数。 */
  effort: ThinkingEffort;
  /** 该阶段墙钟上限（毫秒）。超时按取消处理，由 runner 记为该阶段失败。 */
  timeoutMs: number;
  /** 该阶段最多允许的模型步数。 */
  maxSteps: number;
}

/** 分阶段预算。依据（见交付说明的「证据映射」）：
 *  - 规划与验收是**高杠杆、短**的两端 ⇒ high / xhigh，配额小、超时短；
 *  - 执行是**长尾、低杠杆**的中段 ⇒ low，配额大、超时长；
 *  - 返修只在外部信号变红时发生 ⇒ high，最多两轮。
 *  Terminal-Bench 上「全程 max」因超时反而低于 high（53.9% vs 63.6%，LangChain 2026-02），
 *  所以这里刻意不提供「全程拉满」的档。 */
export const QUALITY_PHASE_BUDGET: Readonly<Record<QualityPhase, PhaseBudget>> = {
  plan: { effort: "high", timeoutMs: 180_000, maxSteps: 6 },
  execute: { effort: "low", timeoutMs: 1_200_000, maxSteps: 40 },
  verify: { effort: "off", timeoutMs: 300_000, maxSteps: 0 },
  repair: { effort: "high", timeoutMs: 600_000, maxSteps: 12 },
  accept: { effort: "xhigh", timeoutMs: 240_000, maxSteps: 4 },
};

/** 一次 run 允许的返修轮数：两轮之后仍红 ⇒ 判失败，不再烧钱。
 *  与 loop 里既有的 `autoVerifyRepair`（至多一次、两拍）同族，但质量档把上限抬到 2，
 *  因为每次返修都必须带来一次**外部信号变化**（红→绿或红→另一条红），不是盲重试。 */
export const QUALITY_REPAIR_BUDGET = 2;

/** 质量档的最小工具面。
 *
 *  保留：读、写、改、shell、检索、目录总览、结构化笔记。
 *  删除及理由：
 *   - `apply_patch`：与 edit_file 功能重叠，多一套补丁语法 = 多一个选错工具的面；
 *   - `read_image` / `render_image`：本档面向代码与终端任务，图像通道与验证闭环无关；
 *   - `lsp`：verify 的 typecheck 已经给同一类信号，且更可信（编译器 vs 语言服务器摘要）；
 *   - `clarify` / `propose_plan`：质量档是非交互批处理，等人门没有应答者，fail-closed 只会空转；
 *   - `task_output` / `task_stop`：后台任务是交互会话的便利，质量档由阶段超时统一收束；
 *   - `git_read`：读 git 状态已由环境事实在开工前注入，运行中再查一次是重复付费；
 *   - `calc`：没有外部验证价值，模型自身算术足够，且错误会被测试抓到；
 *   - `read_doc`：文档解析对代码任务无直接作用，需要时用 run_shell 调系统工具。
 *  `verify` 不在工具表里：它是系统门，不是模型可自选的动作。 */
export const QUALITY_MINIMAL_TOOLS: readonly ToolName[] = [
  "read_file",
  "write_file",
  "edit_file",
  "run_shell",
  "grep",
  "glob",
  "list_dir",
  "todo_write",
];

/** 质量档的压缩配置：比产品缺省更早触发（0.8 → 0.7），给「验证输出 + 返修」留出上下文余量。
 *  保留内容沿用 `compaction.ts` 的六段模板（决策、未解问题、实现细节、证据），不改模板本身：
 *  这里只调触发线、工具结果截断与摘要上限，避免两套摘要纪律。 */
export function qualityCompactionConfig(base: CompactionConfig = DEFAULT_COMPACTION_CONFIG): CompactionConfig {
  return {
    ...base,
    ratio: 0.7,
    toolResultTruncateChars: 1_500,
    summaryCapTokens: 4_096,
    tailRatio: 0.25,
    tailMinTokens: 2_000,
    tailMaxTokens: 12_000,
  };
}

/** 阶段 → 思考档。`off` 表示该阶段不请求模型（verify）。 */
export function effortOfPhase(phase: QualityPhase): ThinkingEffort {
  return QUALITY_PHASE_BUDGET[phase].effort;
}

/** 供 session-provider 逐请求使用的档位策略。
 *
 *  判据只看**当前 run 的事件**（最后一条 user_message 之后）：
 *   1. 最近一拍 verify 是红 ⇒ 正在返修/验收，给 high；
 *   2. 还没有任何工具调用，或 round 小于 planRounds ⇒ 规划段，给 high；
 *   3. 其余执行段 ⇒ low。
 *  这样「规划/验收高、执行低」不依赖 runner 额外传相位，也不会因为换入口而失效。 */
export function qualityThinkingPolicy(input: {
  round: number;
  events: readonly AgentEvent[];
  planRounds?: number;
}): ActiveReasoningEffort {
  const planRounds = input.planRounds ?? 2;
  let start = 0;
  for (let i = input.events.length - 1; i >= 0; i -= 1) {
    if (input.events[i]?.type === "user_message") {
      start = i;
      break;
    }
  }
  const current = input.events.slice(start);
  const lastVerify = [...current].reverse().find((e) => e.type === "verify_result");
  if (lastVerify !== undefined && lastVerify.type === "verify_result" && !lastVerify.ok) return "high";
  const hasToolCall = current.some((e) => e.type === "tool_call");
  if (!hasToolCall || input.round < planRounds) return "high";
  return "low";
}
