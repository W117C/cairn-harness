// M3c 卡死检测（agent-plan §4.4.8；OpenHands StuckDetector 取最廉两条 + 超时）。
// 检测器是纯函数（事件窗口 → verdict），可单测；心跳 = 子流 tool_call/tool_result 天然时间戳，
// 不造独立心跳事件。触发 → agent_status=waiting_input(reason=stuck) + agent_message 提醒，
// 人决定继续（resume 清除 stuck 态）/ 取消（既有取消链）；阈值可配（验收用短阈值）。

/** 卡死检测参数（缺省 = §4.4.8 定稿值；验收/演示可配短阈值）。 */
export interface StuckConfig {
  /** 规则一：同 action + 同 observation 连续出现次数上限（×4 触发）。 */
  maxActionObsRepeats: number;
  /** 规则二：同 action + error 连续出现次数上限（×3 触发）。 */
  maxActionErrorRepeats: number;
  /** 规则三：静默超时（子流无新事件；缺省 10 分钟）。 */
  silenceMs: number;
  /** 检测窗口内保留的最大轮数（内存帽）。 */
  windowSize: number;
}

export const DEFAULT_STUCK_CONFIG: StuckConfig = Object.freeze({
  maxActionObsRepeats: 4,
  maxActionErrorRepeats: 3,
  silenceMs: 10 * 60_000,
  windowSize: 16,
});

/** 一轮「动作 → 观察」：action = 工具名+参数摘要；observation = 结果摘要；ok = 是否成功。 */
export interface StuckTurn {
  action: string;
  observation: string;
  ok: boolean;
}

export type StuckVerdict =
  | { stuck: false }
  | { stuck: true; rule: "same_action_obs_x4" | "same_action_error_x3"; repeats: number; sameObservation: boolean };

/** 卡死判定（纯函数，规则一优先于规则二——OpenHands 同序）：
 *  - 规则一：最近 N 轮（maxActionObsRepeats）action 与 observation 全同 → stuck；
 *  - 规则二：最近 N 轮（maxActionErrorRepeats）action 全同且全部 error → stuck。
 *  轮数不足或配置非法（<2）→ 不判卡死（fail-open 于正常长任务，不会误伤单轮重复读）。
 *
 *  `sameObservation` 交的是**这一趟真比了什么**，不是推测：规则一按定义为 true；规则二从前只看
 *  `action` 相同＋全失败，却在对模型那句提示里断言「原样重试不会改变结果」——连败三次而每次错误不同
 *  （flaky 测试、超时、竞态）时那句话为假，而它恰好会把"该再看一次"的那次重试劝掉。
 *  比较用的是截断后的摘要（见 `stuckObservationOf`），所以这里也只声称"比对窗口内相同"。
 *  **窗口归调用方定，不归本模块**：`loop.ts` 喂的是前 200 字，而 `no-progress.ts#judgeNoProgressEvents`
 *  喂的是全串（那边注释明说截断前缀比会漏掉一条真实红）⇒ 「比对取前 200 字」这句措辞的出处在调用方，
 *  谁复用本模块都得按自己那根串重新说一次（第 313 页那条不变量：只声称真比过的那件事）。 */
export function detectStuck(turns: readonly StuckTurn[], config: StuckConfig = DEFAULT_STUCK_CONFIG): StuckVerdict {
  const nObs = Math.max(2, Math.floor(config.maxActionObsRepeats));
  const nErr = Math.max(2, Math.floor(config.maxActionErrorRepeats));
  if (turns.length >= nObs) {
    const window = turns.slice(-nObs);
    const first = window[0]!;
    if (window.every((t) => t.action === first.action && t.observation === first.observation && t.ok === first.ok)) {
      return { stuck: true, rule: "same_action_obs_x4", repeats: nObs, sameObservation: true };
    }
  }
  if (turns.length >= nErr) {
    const window = turns.slice(-nErr);
    const first = window[0]!;
    if (!first.ok && window.every((t) => t.action === first.action && t.ok === false)) {
      // 这一支的判据里**没有** observation ⇒ 它自己得说清"这几次错误是不是一样"，
      // 否则下游那句提示就只能靠猜（旧版就是这么把"每次错误不同"也说成"原样重试不会改变结果"的）。
      const sameObservation = window.every((t) => t.observation === first.observation);
      return { stuck: true, rule: "same_action_error_x3", repeats: nErr, sameObservation };
    }
  }
  return { stuck: false };
}

/** 动作摘要（tool_call → 稳定可比的 action 串；参数截断防长参数抖动）。 */
export function stuckActionOf(name: string, args: Record<string, unknown>): string {
  return name + " " + JSON.stringify(args).slice(0, 200);
}

/** 观察摘要（tool_result → 稳定可比的 observation 串；截断防长输出抖动）。 */
export function stuckObservationOf(output: string): string {
  return output.slice(0, 200);
}
