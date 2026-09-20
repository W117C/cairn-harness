// 方案门的状态面（M1b）：从 index.ts 抽出来单立一门，唯一的理由是**权限评估层也要读它**。
// `autonomy.ts` 若从 `./index` 拿这份状态就是循环 import（index 同时 re-export autonomy 的符号），
// 而它上一轮的做法是读调用方**手动刷新的镜像布尔**——镜像只在主会话三处刷新，worker 那一路从不刷，
// 于是「先批后写」对 spawn 出来的 worker 直接失效（better-harness 评审 C6，本人复验成立）。
// 状态在这里、判据在这里，任何执行体读到的都是同一份活事实；漏接线的可能性从结构上消掉。
import { AsyncLocalStorage } from "node:async_hooks";

export interface PlanState {
  /** plan 模式（用户武装）：本轮无论模型是否自愿提交方案，未获批即写禁。
   *  缺省 false = 与武装前的行为逐字相同（只有 proposed 才拦）。 */
  required: boolean;
  /** 已有 plan 提交（尚未批准）。 */
  proposed: boolean;
  /** plan 已获批。 */
  approved: boolean;
}

/** 方案门的**唯一**判据。曾这句被抄在五处（agent-runner 四处 + 本文件一份），任一处漏改
 *  就是「同一轮里两种口径」——未批 plan 期间 remember 能写而 write_file 不能写那种裂口。
 *  新增消费点一律调本函数（或直接调 planGateLive），判卷（tests/plan-required.test.ts J1）
 *  锁 src 内不得再出现该比较式。 */
export function planGateBlocks(state: PlanState): boolean {
  return (state.required || state.proposed) && !state.approved;
}

let planState: PlanState = { required: false, proposed: false, approved: false };
// P1（审查）：plan 门状态挂 run 级 AsyncLocalStorage——并发 run（交互 vs 定时 unattended）各持
// 独立 plan 态：A 会话的未批准 plan 不再拦死 B run 的写工具，A 的批准也不再解锁 B。
// run 外遗留路径（脚本/测试直调）回落模块态，行为不变。
const planScopeALS = new AsyncLocalStorage<{ state: PlanState }>();

/** 进入 run 级 plan 门作用域（agent-runner 在 runAgent 入口与 RunScope 同点接线）。
 *  `required` 由用户侧（RunRequest.planRequired，缺省取 settings）武装，模型无法自行置位。 */
export function enterPlanRunScope(required = false): void {
  planScopeALS.enterWith({ state: { required, proposed: false, approved: false } });
}

/** 在全新隔离 plan 作用域内执行 fn（als.run 语义：不泄漏到调用方上下文；测试/工具用）。 */
export function runWithPlanScope<T>(fn: () => T, required = false): T {
  return planScopeALS.run({ state: { required, proposed: false, approved: false } }, fn);
}

export function currentPlanState(): PlanState {
  return planScopeALS.getStore()?.state ?? planState;
}

function setPlanState(next: PlanState): void {
  const scope = planScopeALS.getStore();
  if (scope) scope.state = next;
  else planState = next;
}

export function getPlanState(): PlanState {
  return { ...currentPlanState() };
}

/** propose_plan 工具落计划时调用：进入「未批准即写禁」状态。 */
export function markPlanProposed(): void {
  // 保留 required：武装态下模型提交方案不该顺手把用户那道闸关掉。
  setPlanState({ ...currentPlanState(), proposed: true, approved: false });
}

/** 批准当前 plan：解锁写工具。propose_plan 工具在收到 approved 决议后于 run 链内调用——
 *  决议处理器（IPC/gate-check）不在本 run 异步链内，plan 态已 run 级隔离，谁的 plan 谁解锁。 */
export function approvePlan(): void {
  setPlanState({ ...currentPlanState(), proposed: true, approved: true });
}

/** 回到无 plan 状态（新会话/测试复位用）。 */
export function resetPlanState(): void {
  setPlanState({ required: false, proposed: false, approved: false });
}

/** 当前异步上下文里的写禁令读数。**权限会话构造时默认挂这一份**（不是快照、不是镜像），
 *  所以 worker / 级联 / 主会话读到的是同一件事，且调用方忘不掉接线——忘不掉才是修法。 */
export function planGateLive(): boolean {
  return planGateBlocks(currentPlanState());
}
