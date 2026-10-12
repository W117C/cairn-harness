// goal 面（M3a/§12.3 的续跑判据与目标写入面）——拆分面（同 provider-key-inject 先例）：实现从
// agent-runner.ts 搬来本轻模块，装配根按原路径继续导出，调用方零改动。
// 本模块不反向依赖装配根：它需要装配根的两处活状态（事件推送、价键派生），由装配根启动时
// `setGoalHandlerDeps` 注入（同 settings-handlers 的 `setSettingsHostDeps` 形态）。
import { createEventLog, replay, type AgentEvent, type GoalTurnOrigin } from "../events";
import { goalReminder, goalStopDecision, goalWindowSpend, parseGoalSpec, projectGoal, type GoalView } from "../agent/goal";
import { scanStreamEvent } from "../agent/worker-projection";
import type { MainModelSelection } from "./provider-runtime";
import { pathOf } from "./sessions";
import { requireSessionsDir } from "./session-handlers";
import { store } from "./settings-handlers";

export interface GoalHandlerDeps {
  /** 事件推给壳（`hooks.onEvent` 的活转发：钩子可在首场 run 之后才注册/取消注册）。 */
  onEvent: (e: AgentEvent) => void;
  /** 价键派生（与拨号同一个数；定义住装配根，避免装配根 ↔ 轻模块成环）。 */
  budgetPriceKeyOf: (selection: MainModelSelection) => string;
}

let deps: GoalHandlerDeps | null = null;
/** 装配根启动时注入（可重入：判卷 `vi.resetModules` 重组时按新装配根重注）。 */
export function setGoalHandlerDeps(d: GoalHandlerDeps): void {
  deps = d;
}
function D(): GoalHandlerDeps {
  if (!deps) throw new Error("goal-handlers: 装配根未注入依赖（唯一入口 setGoalHandlerDeps）");
  return deps;
}

/** goal 事件的唯一出口：落流 + 推事件（带 session_id）。
 *  为什么必须有这个 helper：渲染层按 `e.session_id !== real.id` 把不可归因的事件丢掉，
 *  所以少了这个标记就是「JSONL 里有、live 界面上没有」——用户看不见"为什么不跑了"，
 *  而 replay 又看得见（两路不一致，正是本仓点名的形状）。三处 goal 写入点共用一份。 */
export async function emitGoalEvent(logPath: string, sessionId: string | undefined, ev: AgentEvent): Promise<void> {
  await createEventLog(logPath).append(ev);
  D().onEvent(sessionId !== undefined ? ({ ...ev, session_id: sessionId } as AgentEvent) : ev);
}

/** run 中途抛错时补的那一条 `goal_stopped`（异常收场也是「不跑了」，也得让用户看得见）。
 *  为什么必须有它：续跑判据 `goalNextTurn` 长在 `handleAgentRun` 的圈里、在 `runAgent` **外面**，
 *  异常一冒头就整圈跳过它 ⇒ 盘上一条停止都没有，而芯片读的是 `projectGoal` 投影 ⇒ 界面继续说「续跑中」，
 *  实际那条 run 已经死了（把没发生的事报成在发生，与「不可知不许当免费」同一条纪律）。
 *  停没停一律现读投影（与被量的对象同一个函数），不在这里另算一份「我觉得它停了」。 */
export async function emitGoalStoppedOnThrow(logPath: string, sessionId: string | undefined, err: unknown): Promise<void> {
  // 会话日志一行都没落过 ⇒ replay 会 ENOENT。那是「这一场没有目标」，不是文件错误（同 handleGoalSet 的口径）。
  const events = await replay(logPath).catch((e: unknown) => {
    if ((e as NodeJS.ErrnoException)?.code === "ENOENT") return [] as AgentEvent[];
    throw e;
  });
  const view = projectGoal(events);
  if (view === null || view.stopped !== null) return; // 没设过目标 / 已经停过 ⇒ 逐字零行为
  const reason =
    "run 中途抛错，没走到续跑判据 ⇒ goal 自动续跑已停（这一轮不会再跑，界面上不许再显示「续跑中」）：" +
    (err instanceof Error ? err.message : String(err));
  await emitGoalEvent(logPath, sessionId, scanStreamEvent(
    { type: "goal_stopped", reason, turn: view.turn, evidence: view.evidence },
  ));
}

/** goal 模式：一次 run 收束后问判据「还要不要再跑一轮」。返回 null = 不再续（没设目标 / 已停 / 被取消）。
 *  停止理由一律落 `goal_stopped` 上屏——「为什么不跑了」必须是用户看得见的事实。 */
export async function goalNextTurn(args: {
  logPath: string;
  sessionId?: string;
  /** 无人值守（定时 / schedule 触发的 run）。goal 模式在这条路上被显式拒续，理由见下面的规则。 */
  unattended?: boolean;
  aborted: () => boolean;
  /** 本 run 的模型选择：美元闸的价键由它派生（与拨号同一个数，见 `budgetPriceKeyOf`）。 */
  runModel: MainModelSelection;
}): Promise<{ message: string; origin: GoalTurnOrigin } | null> {
  if (args.aborted()) return null; // 用户已经按停止：不再起新轮（取消是最高优先级，不是预算）
  const events = await replay(args.logPath);
  const view = projectGoal(events);
  // 没设目标 / 已停 / 已挂起 ⇒ 逐字零行为。挂起与停止在这里同罚（都不自动续跑），
  // 差别只在别处：停止是终态（用户再发一条也不复活），挂起可经 handleGoalSet 恢复。
  if (view === null || view.stopped !== null || view.paused !== null) return null;
  // #53 的裁决：**无人值守 run 不自动续跑**。这不是保守，是这条路的产出面决定的——
  // unattended 的审批一律 fail-closed 拒（unattendedAskGate）⇒ 写向工具全被拒、verify 必然红，
  // 而判据里「证据 failed」是 **continue** ⇒ 定时任务会一路烧到轮次上限（≤25 轮），
  // 且没有任何一轮可能成功。goal 是「有人在场」的能力：停在这里，并把理由落到流上（芯片与转录都看得见）。
  if (args.unattended) {
    const reason =
      "无人值守 run 不自动续跑：这条路上审批一律 fail-closed 拒 ⇒ 写不了盘、验不出绿，续跑只会白烧钱；" +
      "goal 模式请在有人盯着的会话里用（同一个目标，交互 run 会照常续）";
    await emitGoalEvent(args.logPath, args.sessionId, {
      type: "goal_stopped",
      reason,
      turn: view.turn,
      evidence: view.evidence,
    });
    return null;
  }
  const model = D().budgetPriceKeyOf(args.runModel);
  // 花费读数交给纯函数（`goalWindowSpend`）：闸要的价键是 provider 模型名（glm-5.2）而价表的键是
  // 档位 id（glm-standard），反查只许有一处（orchestrator-join 的 priceForModel）——那一跳以前躺在这行，
  // 写错就恒 null、闸恒惰，而单测全绿（它们直接注入 spentUsd）。**名字本身**要取自本 run 真拨的那一档
  // （`budgetPriceKeyOf`）：读设置盘字段会在「model 留空」与「per-run 指定档位」下和实付分叉。
  // 表里没有 / 不可知 ⇒ 美元闸惰掉并在提醒块里明写，**绝不**按 $0 继续烧（「把不可知记成免费」）。
  // 计量窗口 = view.window（本目标之后那段），与证据/写盘同轴：设 $0.5 之前会话已花多少与这个闸无关。
  // **worker 那一段用回执里已入账的表价**，不再按会话那一档估：会话档与 worker 档在本仓价表里
  // 差到 40 倍，一乘就把闸与同一屏的回执弄成两个数（能力 39 修的是成本闸，这一支是同一族的第二支）。
  const { spentUsd, unbookedWorkers } = goalWindowSpend(view.window, model);
  const decision = goalStopDecision({
    turn: view.turn,
    spec: view.spec,
    spentUsd,
    evidence: view.evidence,
    wrote: view.wrote,
    truncated: view.truncated,
  });
  if (decision.kind === "done") return null;
  if (decision.kind === "stop") {
    const ev: AgentEvent = { type: "goal_stopped", reason: decision.reason, turn: view.turn, evidence: view.evidence };
    await emitGoalEvent(args.logPath, args.sessionId, ev);
    return null;
  }
  const turn = view.turn + 1;
  return {
    // hint 只有「上一轮被收走」那一支会给；默认那一子句（针对红字继续）在本轮没有红字时会指错方向。
    message: goalReminder(view.spec, turn, spentUsd, view.evidence, decision.hint, unbookedWorkers),
    origin: { kind: "goal", turn, max_turns: view.spec.maxTurns },
  };
}

/** 读会话当前目标态（ENOENT 容忍：日志一行都没落过 = 没有目标，不是文件错误；其余错误照常抛出可见）。
 *  clear / pause / resume 三个写入面共用这一份口径，避免各写一遍「ENOENT 算不算没有目标」。 */
async function goalViewOf(logPath: string): Promise<GoalView | null> {
  const events = await replay(logPath).catch((err: unknown) => {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return [] as AgentEvent[];
    throw err;
  });
  return projectGoal(events);
}

/** IPC "agent:goal-set"：给某个会话设定/改设目标，或清除它（goal 模式的唯一写入面）。
 *  与在途 run 并发时只做一件事——追加一条 goal_set；续跑判据在 run 结束时才读它，所以中途改设
 *  会自然从下一轮生效（不改写在飞的 run，也不锁住输入框）。
 *  `clear` 不开新事件也不开通道：停 = 追加一条带理由的 `goal_stopped`，而「停过的目标不许被
 *  用户下一条消息复活」这条语义已经有锚点守着，清除于是天然复用终态面。
 *  `pause` / `resume`（v2.16）走各自的新事件：挂起 ≠ 停止（挂起可恢复、窗口与轮次全留），
 *  所以不能复用 `goal_stopped`——那会退化成「清除」，把暂停变成不可逆。 */
export async function handleGoalSet(req: {
  sessionId?: string;
  objective?: unknown;
  maxTurns?: unknown;
  maxUsd?: unknown;
  clear?: unknown;
  pause?: unknown;
  resume?: unknown;
}): Promise<{ ok: boolean; error?: string; clamped?: string[] }> {
  try {
    const dir = requireSessionsDir();
    const sessionId = req.sessionId ?? (await store().get()).currentSession;
    if (typeof sessionId !== "string" || sessionId === "") return { ok: false, error: "没有当前会话，目标无处可挂" };
    const logPath = pathOf(dir, sessionId);
    if (req.clear === true) {
      const view = await goalViewOf(logPath);
      if (view === null) return { ok: false, error: "这个会话没有设过目标 ⇒ 无可清除（不补记空停止）" };
      if (view.stopped !== null) return { ok: true }; // 已停：幂等返回，不再落第二条停止
      const stopped: AgentEvent = {
        type: "goal_stopped",
        reason: "用户清除目标 ⇒ 不再自动续跑（还要接着跑就重新设一个目标）",
        turn: view.turn,
        evidence: view.evidence,
      };
      await emitGoalEvent(logPath, sessionId, stopped);
      return { ok: true };
    }
    if (req.pause === true) {
      const view = await goalViewOf(logPath);
      if (view === null) return { ok: false, error: "这个会话没有设过目标 ⇒ 无可暂停" };
      if (view.stopped !== null) return { ok: false, error: "目标已停止（终态）⇒ 不能暂停；要接着跑请改设目标" };
      if (view.paused !== null) return { ok: true }; // 幂等：已挂起就不再补记第二条
      await emitGoalEvent(logPath, sessionId, {
        type: "goal_paused",
        reason: "用户暂停目标 ⇒ 自动续跑停手（目标仍武装，恢复后从原样接着跑）",
        turn: view.turn,
      });
      return { ok: true };
    }
    if (req.resume === true) {
      const view = await goalViewOf(logPath);
      if (view === null) return { ok: false, error: "这个会话没有设过目标 ⇒ 无可恢复" };
      if (view.stopped !== null) return { ok: false, error: "目标已停止（终态）⇒ 不能恢复；要接着跑请改设目标" };
      if (view.paused === null) return { ok: false, error: "目标没有被暂停 ⇒ 无需恢复（不补记事假事件）" };
      await emitGoalEvent(logPath, sessionId, { type: "goal_resumed", turn: view.turn });
      return { ok: true };
    }
    const parsed = parseGoalSpec({ objective: req.objective, maxTurns: req.maxTurns, maxUsd: req.maxUsd });
    if (parsed.spec === null) return { ok: false, error: parsed.errors.join("；") };
    const ev: AgentEvent = {
      type: "goal_set",
      objective: parsed.spec.objective,
      max_turns: parsed.spec.maxTurns,
      max_usd: parsed.spec.maxUsd,
    };
    await emitGoalEvent(logPath, sessionId, ev);
    return { ok: true, ...(parsed.clamped.length > 0 ? { clamped: parsed.clamped } : {}) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
