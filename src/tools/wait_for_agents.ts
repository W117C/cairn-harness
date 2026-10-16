// W1a 收队工具：把「派了 worker 却收不回来」这一条结构性缺陷闭合在产品路径上。
// 前车之见：join 原语（Orchestrator.waitForAgentTerminal / waitAll）一直存在，但调用者全在验收
// 脚本里 ⇒ 主 agent 派完 worker、说完这轮就结束，永远不被叫回来读团队的产出。
// 注入纪律同 spawn_agent：常驻原语走静态规格表（session-provider）+ 运行期实例（installAppTools），
// 不混 obs_recall / impact_query 那套「按开关注入」——没有开关可关它，关掉就等于没有收队。
import { clampWaitTimeout, renderJoinPayload, type JoinPayloadBody } from "../agent/orchestrator-join";
import { ToolError, type Tool, type ToolContext, type ToolResult } from "./base.js";

export const WAIT_FOR_AGENTS_TOOL = "wait_for_agents";

/** 工具体对编排器的全部依赖（结构接口而非 import 类：否则 tools ←→ agent 成环，
 *  且测必须起一个真 Orchestrator 才能跑一条参数校验）。 */
export interface WaitForAgentsHost {
  waitForAgents(ids: readonly string[], timeoutMs: number, signal?: AbortSignal): Promise<JoinPayloadBody>;
  /** 零 worker 时给一句话就返，不建任何等待项。 */
  hasWorkers(): boolean;
}

export function createWaitForAgentsTool(host: () => WaitForAgentsHost | null): Tool {
  return {
    name: WAIT_FOR_AGENTS_TOOL,
    async run(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
      const orch = host();
      if (!orch) return { ok: false, output: "wait_for_agents: 编排器未接线（fail-closed）" };
      if (!orch.hasWorkers()) return { ok: true, output: "[join] 本会话没有 worker——无需收队，直接继续。" };

      const rawIds = args.agent_ids;
      if (rawIds !== undefined && rawIds !== null && !Array.isArray(rawIds)) {
        throw new ToolError("wait_for_agents: agent_ids 必须是字符串数组");
      }
      const ids = rawIds === undefined || rawIds === null
        ? []
        : (rawIds as unknown[]).map((x, i) => {
            if (typeof x !== "string" || x.trim() === "") throw new ToolError(`wait_for_agents: agent_ids[${String(i)}] 必须是非空字符串`);
            return x;
          });
      const timeout = clampWaitTimeout(args.timeout_ms);
      if (timeout.rejected !== undefined) throw new ToolError("wait_for_agents: " + timeout.rejected);

      const body = await orch.waitForAgents(ids, timeout.ms, ctx.signal);
      const text = renderJoinPayload(body);
      return { ok: true, output: timeout.clamped ? text + "\n[clamp] timeout_ms 超上限，已钳到 " + String(timeout.ms) + "ms" : text };
    },
  };
}

// 模型可见规格**不在这里**：常驻原语按本文件的注入纪律走静态规格表（session-provider 的 gateToolSpecs），
// 这里再写一份就是第二个来源——两份的描述/参数会长出差异（曾漂移过），而 tests/tool-surface-parity 只比名字。
