// 一场 run 收束后的三支**观测读数**：目标漂移 / cost-per-progress / 自进化落盘。
//
// 2026-10-17 从 `agent-runner.ts` 的 `runAgent` 收束路径整段搬出（结构债审查报告 #2 的 run 管线缝）。
// 说明为什么只切这一段：那条缝的主体（一个 462 行的 `try`）当时正被另一会话的 delivery-guard 改动
// 占着，而这三支在 `try` **之后**、且与装配根的模块级状态零耦合（只读事件流、只印 stderr）——
// 是这条缝上唯一能安全先切的一段。
//
// 三支共同的纪律（原文随块搬来，未改一字）：**只观测、不驱动任何决策**，所以只印 stderr、不落事件流
// （落流要新增事件类型，而事件流是重放契约）；失败**不许静默**——「没量到」不许被读成「没问题」。
// （闭环 v2 的两处例外都有各自的理由：反思位的 usage 照落流——花掉的 token 必须记账，
// 与沉淀轮同一裁决；反思正文不落流——它的产物是补丁措辞，落在 evolution.json/账本里，不是对话。）
import { assistantTurnsFromEvents, goalDriftCell, goalDriftFindings } from "../agent/goal-drift";
import { costPerProgress } from "../agent/cost-per-progress";
import { eventsForCurrentRun } from "../agent/delivery-guard";
import { runEvolution, type ReflectFn } from "../agent/evolution";
import { tickCanaryFromSignals } from "./evolution/activation-host";
import { distillWorkflows, writeWorkflows } from "../agent/memory/workflow";
import { maybeGraduateWorkflows } from "./evolution/workflow-graduate";
import { runAssess } from "./evolution/assess";
import { replay, type AgentEvent } from "../events";
import type { Provider } from "../providers";

export interface PostRunReadingInput {
  logPath: string;
  workspace: string;
  /** 会话 id（自进化那一支的归属键）；缺席时退回 logPath。 */
  sessionId?: string;
  /** 反思位（闭环 v2 · 批次 A2）：读真实轨迹改写本轮补丁措辞的 provider 构造口。
   *  缺省不传 = 纯规则补丁（既有行为）。由装配根递进来（provider 闭包在那边）。 */
  reflectProviderFor?: (instruction: string) => Provider;
}

/** 收束时调一次。**任何一支失败都不抛**——它不参与这一场的结果。 */
export async function emitPostRunReadings(input: PostRunReadingInput): Promise<void> {
  let events: AgentEvent[];
  try {
    events = eventsForCurrentRun(await replay(input.logPath), { includeWorkers: true });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn("[goal-drift] 读数失败（这一格未检，不等于没有漂移）: " + reason);
    console.warn("[cost-per-progress] 读数失败（这一格未检）: " + reason);
    console.warn("[evolution] 读数/落盘失败（不影响主流程）: " + reason);
    return;
  }
  // 目标漂移读数（能力 4「长任务不遗忘」的真读数，此前这个模块**零生产消费者**：
  // 只有 tests/goal-drift.test.ts 引用它，于是「长任务会不会改口」永远只有单测证据、没有运行证据）。
  //
  // 为什么印 stderr 而**不落事件流**：落流就得新增一种事件类型，而事件流是重放契约
  // （每条都要能 replay 往返，新增类型会让旧日志重放多一个分支）；而这条读数是
  // **事后观测**，不驱动任何决策、不影响这一轮的行为。真要让它可回放，正确做法是下一波
  // 把它并进既有的 `goal_stopped` 那类事件，而不是现在偷加一个类型。
  //
  // 取料口径与被判对象**同一份**（`assistantTurnsFromEvents` 从事件流重组），不另拼一套
  // ——「同一条判据各抄一份」是本仓最忌的一种腐坏。
  try {
    const drift = goalDriftFindings(assistantTurnsFromEvents(eventsForCurrentRun(events)));
    if (drift.length > 0) console.warn("[goal-drift] " + goalDriftCell(drift));
  } catch (err) {
    // 读数失败不许影响主流程（它只是观测），但也不许静默：这一格取不到就是「没量到」，
    // 静默会把「没量到」读成「没漂移」——本仓反复点名的同一族坑。
    console.warn("[goal-drift] 读数失败（这一格未检，不等于没有漂移）: " + (err instanceof Error ? err.message : String(err)));
  }
  // cost-per-progress：同 goal-drift 的纪律——观测读数，不落事件流，不影响主流程。
  try {
    const cpp = costPerProgress(events);
    if (cpp.measurable && cpp.tokensPerBoundary !== null) {
      console.warn(
        "[cost-per-progress] 每 verified 边界约 " + cpp.tokensPerBoundary + " token" +
          "｜主面 " + cpp.mainTokens + " token" +
          "｜边界后死跑 " + cpp.spendAfterLastBoundary + " token" +
          (cpp.excludedWorkerTokens > 0 ? "（worker 开销 " + cpp.excludedWorkerTokens + " 已单列不入比值）" : ""),
      );
    } else {
      console.warn("[cost-per-progress] 本跑不可测（" + String(cpp.reason) + "）——不许折成 0 或 Infinity");
    }
  } catch (err) {
    console.warn("[cost-per-progress] 读数失败（这一格未检）: " + (err instanceof Error ? err.message : String(err)));
  }
  // 自进化闭环：抽信号 → 评旧账 → 生补丁（反思位可选改写）→ 过门 → 落盘。失败不阻塞主流程。
  try {
    const reflect: ReflectFn | undefined = input.reflectProviderFor === undefined
      ? undefined
      : async (req) => consumeReflectOutput(input.reflectProviderFor!(req.instruction));
    const evo = await runEvolution(events, input.workspace, input.sessionId ?? input.logPath, reflect === undefined ? undefined : { reflect });
    if (evo.persistedTo !== null && evo.patches.length > 0) {
      console.warn("[evolution] 本跑产出 " + evo.patches.length + " 条策略补丁，已落 " + String(evo.persistedTo));
    }
    // 观察期收束：工作区没有还开着的 canary 档 ⇒ 零行为；有档 ⇒ 用本轮同一份读数续档，
    // 命中退化规则会在 CanaryController 内自动回退。失败只出声，不影响这一场的结果。
    try {
      const ticks = await tickCanaryFromSignals(input.workspace, evo.signals, input.sessionId ?? input.logPath);
      for (const tick of ticks) {
        if (tick.observation !== null) {
          console.warn("[canary] " + tick.id + " · " + tick.outcome + " · state=" + tick.observation.state
            + " · samples=" + String(tick.observation.samples));
        }
      }
    } catch (err) {
      console.warn("[canary] 观察期读数失败（不影响主流程）: " + (err instanceof Error ? err.message : String(err)));
    }
    // 正向打法蒸馏（批次 B1）：成功复现的工具组合 → project 记忆（落 .agent/memory/，
    // 经 M7 索引/检索/强度账回注）。复现 < 2 次 ⇒ 零条目零写入。
    try {
      const workflows = distillWorkflows(events, input.logPath);
      if (workflows.length > 0) {
        const written = await writeWorkflows(input.workspace, workflows, new Date().toISOString());
        console.warn("[workflow] 本跑蒸馏 " + String(written) + " 条打法（复现≥2 且收尾绿 verify）");
      }
    } catch (err) {
      console.warn("[workflow] 打法蒸馏失败（不影响主流程）: " + (err instanceof Error ? err.message : String(err)));
    }
    // 打法毕业（批次 B2）+ 周期 Assess（批次 C2）：modules/ 缺席 ⇒ 各自零行为。
    try {
      for (const g of await maybeGraduateWorkflows(input.workspace)) {
        if (g.outcome === "submitted") console.warn("[workflow-graduate] " + g.topic + " 已提为 content-pack 提案（staging 待门）");
        else if (g.outcome === "refused") console.warn("[workflow-graduate] " + g.topic + " 提案被拒: " + String(g.detail));
      }
    } catch (err) {
      console.warn("[workflow-graduate] 毕业检查失败（不影响主流程）: " + (err instanceof Error ? err.message : String(err)));
    }
    try {
      const assess = await runAssess(input.workspace);
      if (assess !== null && assess.report.findings.length > 0) {
        const counts: Record<string, number> = {};
        for (const f of assess.report.findings) counts[f.kind] = (counts[f.kind] ?? 0) + 1;
        console.warn("[assess] 体检报告 " + String(assess.reportPath) + "：" + Object.entries(counts).map(([k, n]) => k + "×" + String(n)).join("、"));
      }
    } catch (err) {
      console.warn("[assess] 体检失败（不影响主流程）: " + (err instanceof Error ? err.message : String(err)));
    }
  } catch (err) {
    console.warn("[evolution] 读数/落盘失败（不影响主流程）: " + (err instanceof Error ? err.message : String(err)));
  }
}

/** 反思位的流消费：只收正文（usage 已由 provider 内部记账面处理或随 provider 配置走；
 *  工具调用一律忽略——反思轮不给工具面，模型若仍发起调用按无产出处理）。
 *  有的 provider 会**同时**发 delta 流与合并后的 assistant_message——两边都收正文会翻倍
 *  （parse 必炸 ⇒ 全拒 ⇒ 白花一次反思），所以有 delta 用 delta、没有才落 message。
 *  正文剥 ```json 围栏后 parse；parse 不动 ⇒ 原文返回（parseReflectProposals 会全拒 → 规则兜底）。 */
async function consumeReflectOutput(provider: Provider): Promise<unknown> {
  let deltas = "";
  let message: string | null = null;
  for await (const out of provider.stream([], [])) {
    if (out.type === "assistant_delta" && typeof out.text === "string") deltas += out.text;
    else if (out.type === "assistant_message" && typeof out.content === "string") message = out.content;
  }
  const text = deltas.length > 0 ? deltas : message ?? "";
  const trimmed = text.trim().replace(/^```(?:json)?\s*/u, "").replace(/\s*```$/u, "").trim();
  if (trimmed.length === 0) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return trimmed;
  }
}
