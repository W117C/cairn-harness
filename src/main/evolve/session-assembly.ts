// 一场 run 的自进化装配（唯一入口）：起点注入 + run 内快环提醒。
//
// 为什么收成一层：这段曾内联在 agent-runner 的装配缝里——取料（工具面/路径/会话 id）、
// 起点注入、去重集、runner 生命周期各写一遍。组合根已经两千行，再多一条装配路径
// （worker/CLI）就得复制这四件事。现在调用方只递料，失败语义与去重规则只有这一份。
//
// 失败语义：注入/提醒失败都只出声，绝不阻塞主流程（验证回流优先）。

import { extractTaskPaths } from "../../agent/evolve/task-context";
import { createExperienceNudgeRunner, type ExperienceNudge } from "./experience-nudge";
import { prepareEvolutionInjection } from "./runtime";

export interface RunEvolutionAssemblyInput {
  workspace: string;
  sessionId: string;
  taskContent: string;
  /** 本轮模型可见的工具名（真正喂给检索的，不是静态清单）。 */
  toolNames: readonly string[];
  paths?: readonly string[];
}

export interface RunEvolutionAssembly {
  /** 拼进 system prompt 的起点注记（无 active/实验 ⇒ 空串）。 */
  note: string;
  /** verify 红 / 卡死时的快环提醒；run 内共用一个去重集与懒加载 runner。 */
  nudge(signals: readonly string[]): Promise<ExperienceNudge>;
}

export async function assembleRunEvolution(
  input: RunEvolutionAssemblyInput,
): Promise<RunEvolutionAssembly> {
  const paths = [...(input.paths ?? extractTaskPaths(input.taskContent, { workspace: input.workspace }))];
  const toolNames = [...input.toolNames];
  const injected = new Set<string>();
  let note = "";
  try {
    const injection = await prepareEvolutionInjection({
      workspace: input.workspace,
      sessionId: input.sessionId,
      taskContent: input.taskContent,
      toolNames,
      paths,
    });
    note = injection.note;
    for (const id of injection.injectedExperienceIds) injected.add(id);
  } catch (err) {
    console.warn("[evolve] 经验注入失败（不影响主流程）: " + (err instanceof Error ? err.message : String(err)));
  }

  const runner = createExperienceNudgeRunner(input.workspace, {
    taskContent: input.taskContent,
    toolNames,
    paths,
  });
  return {
    note,
    nudge: async (signals) => {
      try {
        const nudge = await runner.nudge(signals, [...injected]);
        for (const id of nudge.ids) injected.add(id);
        return nudge;
      } catch (err) {
        console.warn("[evolve] verify 经验提醒失败（不影响主流程）: "
          + (err instanceof Error ? err.message : String(err)));
        return { note: "", ids: [] };
      }
    },
  };
}
