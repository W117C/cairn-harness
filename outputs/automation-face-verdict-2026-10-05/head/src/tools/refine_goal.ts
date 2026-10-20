// refine_goal：模型把自己正在追的目标**改个说法**，但改不动自己的钱闸与轮次帽。
//
// 为什么这是「agent 自己安排」的一环：goal 模式的锚点此前只有一个写入口（人经 IPC 设）。
// 长任务里模型每轮读回的仍是人三小时前那句话，而它此刻已经知道自己真正要交付什么——
// 目标措辞与工作内容开始各说一套，续跑块就越读越像噪音（能力 4 的「保持状态、不遗忘目标」）。
//
// 边界怎么落的（两条，缺一不可）：
//  ① 工具面：只吃 `objective`；带 max_turns / max_usd 一律**出声拒**（静默忽略 = 模型以为改成功了）。
//     没武装的会话不武装、已停的目标不复活——轮次帽与美元闸是人手里的闸。
//  ② 投影面兜底：`goal-trace.step` 让 `set_by:"model"` 那条**不移动窗口锚点、不重置轮次、不清停止**。
//     有②才敢说①不是唯一防线：绕过工具直接造事件也拿不到额度（本仓对"权限只写在调用方"的一贯判死）。
import { ToolError, type Tool, type ToolContext, type ToolResult } from "./base.js";
import type { AgentEvent } from "../events";

export const REFINE_GOAL_TOOL = "refine_goal";

/** 会话当前目标态里本工具需要的那几项（结构接口：测不必造完整 GoalView）。 */
export interface GoalViewLike {
  objective: string;
  maxTurns: number;
  maxUsd: number;
  turn: number;
  stopped: string | null;
}

export function createRefineGoalTool(currentGoal: () => Promise<GoalViewLike | null>): Tool {
  return {
    name: REFINE_GOAL_TOOL,
    async run(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
      if (!ctx.emit) return { ok: false, output: "refine_goal: 无落流通道（fail-closed：目标锚点必须可审计）" };
      for (const k of ["max_turns", "max_usd", "budget", "turns"] as const) {
        if (args[k] !== undefined) {
          throw new ToolError(`refine_goal: ${k} 不归模型改——轮次帽与美元闸由人设定（要改请到 goal 面板）；本工具只改目标措辞`);
        }
      }
      const objective = typeof args.objective === "string" ? args.objective.trim() : "";
      if (objective === "") throw new ToolError("refine_goal: objective 必须是非空字符串（空目标等于让 agent 自己猜要干什么）");

      const view = await currentGoal();
      if (view === null) {
        return { ok: false, output: "refine_goal: 这个会话没有已武装的长任务目标 ⇒ 模型不自行武装（续跑与预算闸归人）" };
      }
      if (view.stopped !== null) {
        return { ok: false, output: "refine_goal: 该目标已停（" + view.stopped + "）⇒ 改措辞不是复活它的通道，要接着跑请人重新设一个" };
      }

      // 落流走与人同一条 goal_set（一份事实源），但带上 provenance 并**逐字继承**那两条闸。
      const ev: AgentEvent = {
        type: "goal_set",
        objective,
        max_turns: view.maxTurns,
        max_usd: view.maxUsd,
        set_by: "model",
      };
      await ctx.emit(ev);
      const usd = view.maxUsd > 0 ? "美元上限 $" + view.maxUsd.toFixed(4) : "美元闸关（只按轮次停）";
      return {
        ok: true,
        output: "[goal] 目标措辞已改设：" + objective +
          "；轮次上限 " + String(view.maxTurns) + "、" + usd + " 均照原样（归人，本工具不动）" +
          "；当前是第 " + String(view.turn) + " 轮，下一轮提醒块就按这句继续。",
      };
    },
  };
}
