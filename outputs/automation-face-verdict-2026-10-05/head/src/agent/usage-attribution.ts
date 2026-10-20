// 用量归因：一笔 `usage` 事件属于**哪个模型**。
//
// 为什么单独一层（2026-09-27 读数，outputs/cost-attribution-join-2026-09-27/）：
// 评估面的 `$ / 成功任务` 一直报「不可测」，成因不是价表缺档，是**整条链上没有任何一笔 usage 带模型名**——
// 整份语料 166 条 usage 事件里自带 model 0 条、带 `picked`/`model` 字段的行 0 条（含 `agent_spawned`、`routing_decision`），
// 所以消费端（`run-scorecard.usageOfStream` 早就在读 `e.model`）拿到的是恒零归因。
// 这一层补的就是生产端那一半，且只补一个位置：会话落盘的漏斗（主会话与 worker 子流都过它）。
//
// 三条纪律：
//  ⑴ **只有真拨号才盖章**：剧本 / demo 通道不产生真钱，盖上档位名等于让评估面拿没花过的钱当真钱
//     （与 `isScriptedModel ⇒ price=null` 同一条口径，只是那支防的是"算不出"，这支防的是"算出假数"）。
//  ⑵ **worker 不许拿主会话那一档冒充**：本仓价表 flash 与 strong 差 40 倍，一混就是 2026-09-23 修掉的那个形状。
//     查不到这个 agent 的档 ⇒ 不盖（缺字段＝不可定价，由消费方出声）。
//  ⑶ 盖在**事件本身上**，不另造一份只存在于盘上的副本：live 与盘必须是同一个对象
//     （`createEventLog.append` 盖 `ts` 时同一条理由——副本会让「丢弃内存态→重放等价」那两条老不变量恒红）。
import type { AgentEvent } from "../events";

export interface UsageAttribution {
  /** 就地给 usage 事件补 `model`；非 usage 事件原样放过。返回是否盖了。 */
  stamp(e: AgentEvent): boolean;
}

/** 建一个盖章器。`getMainModel` 是**取值时机在后的闭包**：主会话那一跳的模型要等 run 装配完才解析得出来，
 *  而第一笔 usage 一定在那之后 ⇒ 不给"早值快照"，也不在这里再抄一份解析规则。 */
export function createUsageAttributor(getMainModel: () => string): UsageAttribution {
  /** agent_id → 那次派活真拨的模型名（来自流经这里的 `agent_spawned.usage_model`）。 */
  const byAgent = new Map<string, string>();
  return {
    stamp(e: AgentEvent): boolean {
      if (e.type === "agent_spawned") {
        const model = (e as { usage_model?: unknown }).usage_model;
        const agentId = (e as { agent_id?: unknown }).agent_id;
        if (typeof model === "string" && model !== "" && typeof agentId === "string" && agentId !== "") {
          byAgent.set(agentId, model);
        }
        return false;
      }
      if (e.type !== "usage" || e.model !== undefined) return false;
      const key = e.agent_id === undefined ? getMainModel() : byAgent.get(e.agent_id) ?? "";
      if (key === "") return false;
      e.model = key;
      return true;
    },
  };
}
