// 能力 4「动态调整」的机器面：派出去的活要能自己撤。
//
// 起因（2026-09-24 实测两处）：
//  ① `orchestrator-join.ts` 的超时提示写着「可再 wait 或 cancelAgent」，而 `cancelAgent` 是编排器的
//     TS 方法名，模型面上没有这个工具 ⇒ 文案在给一扇不存在的门。取消此前只有人（面板 IPC）能按，
//     于是"派错了/方向变了"只能干等它跑完 —— 这正是"普通 agent 会派活、顶尖 agent 会改派"的分界。
//  ② spawn 回执只报"派成功了"，不报在途几个、上限几个 ⇒ 「还要不要再拆一个」只能凭感觉，
//     撞上 MAX_CONCURRENT_WORKERS 才知道有闸。
// 注入纪律同 wait_for_agents / spawn_agent：常驻原语走静态规格表（glm-session）+ 运行期实例
// （installAppTools），不按开关注入——没有开关可关它，关掉就等于「派了收不回」。
import { ToolError, type Tool, type ToolContext, type ToolResult } from "./base.js";

export const CANCEL_AGENTS_TOOL = "cancel_agents";

/** 一次撤销的分类结果。三支互斥且必须都报：把"已结束的"混进"撤掉了"会让模型以为省下了额度。 */
export interface CancelAgentsOutcome {
  cancelled: string[];
  terminal: string[];
  unknown: string[];
}

/** 工具体对编排器的全部依赖（结构接口而非 import 类：与 wait_for_agents 同理由——否则
 *  tools ←→ agent 成环，且测必须起真 Orchestrator 才能跑一条参数校验）。 */
export interface CancelAgentsHost {
  /** 仍在途的 agent_id（回执与拒绝语都要它：模型据此知道自己手上有什么）。 */
  inFlightAgents(): string[];
  /** 按 id 撤：只 abort 点名的那几个（绝不"顺手全停"，那是另一种越权）。 */
  cancelAgents(ids: readonly string[]): CancelAgentsOutcome;
}

export function createCancelAgentsTool(host: () => CancelAgentsHost | null): Tool {
  return {
    name: CANCEL_AGENTS_TOOL,
    async run(args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
      const orch = host();
      if (!orch) return { ok: false, output: "cancel_agents: 编排器未接线（fail-closed）" };

      const raw = args.agent_ids;
      if (!Array.isArray(raw) || raw.length === 0) {
        throw new ToolError("cancel_agents: agent_ids 必须是非空字符串数组（要停哪一个请点名，不给\"全停\"的隐含语义）");
      }
      const ids = (raw as unknown[]).map((x, i) => {
        if (typeof x !== "string" || x.trim() === "") {
          throw new ToolError(`cancel_agents: agent_ids[${String(i)}] 必须是非空字符串`);
        }
        return x;
      });

      // 有未知 id ⇒ 整批不动手：撤一半是最难复现的错法，而模型拿到的是"哪些还在跑"这份真话。
      const inFlight = orch.inFlightAgents();
      const unknown = ids.filter((id) => !inFlight.includes(id));
      if (unknown.length > 0) {
        return {
          ok: false,
          output: "cancel_agents: 未知 agent_id：" + unknown.join("、") + "（不存在或已终态）" +
            "；本会话仍在途的是 " + (inFlight.length > 0 ? inFlight.join("、") : "（无）"),
        };
      }

      const outcome = orch.cancelAgents(ids);
      const parts = ["已撤：" + outcome.cancelled.join("、")];
      if (outcome.terminal.length > 0) parts.push("已是终态（未动）：" + outcome.terminal.join("、"));
      parts.push(inFlight.length > outcome.cancelled.length
        ? "仍在途：" + inFlight.filter((id) => !outcome.cancelled.includes(id)).join("、")
        : "已无在途 worker");
      return { ok: true, output: "[cancel] " + parts.join("；") };
    },
  };
}
