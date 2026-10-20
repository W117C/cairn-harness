// 批准门状态机：pending → approved / rejected；默认 60 秒无响应按拒绝。
// 纯逻辑、零 electron 依赖；超时用 setTimeout（vitest 假时钟可测，测试不真等 60 秒）。
// M1c：决议携带 scope（once / session_kind / always，§10.4 回写）；请求携带 risk 上下文（审批卡必显）。
import type { AskScope, RiskLevel } from "../permissions";
import type { ToolName } from "../tools/base";

export interface AskRequest {
  askId: string;
  // M2d：remember 等运行时注入工具不进 ToolName 静态键域，审批卡只作展示串
  tool: ToolName | string;
  args: Record<string, unknown>;
  /** 送审原因（如「默认档逐次审批」「critical 任何档位强制审批」）。 */
  reason?: string;
  /** 风险评级与依据（§11.7.4 三通道合成结果）。 */
  risk?: RiskLevel;
  riskReasons?: string[];
  /** 这张卡属于哪个会话（可选：headless/无 sessionId 的 run 本来就没有会话面）。
   *  为什么必须在载荷里：`AskGate` 是模块级共享面（appAskGate），pending 键只有 askId，
   *  而 askId 是进程内自增序号——**不含会话维度** ⇒ 渲染层拿到的卡无从判断自己在问谁，
   *  既不能按会话显示、也不能安全地按会话锁输入框（误锁别的会话）。带上它 ⇒ 卡有归属，
   *  审批/历史/审计才谈得上。缺省 = 未知（老 elder JSON 与 headless 路径同形），不许猜。 */
  sessionId?: string;
  /** 连拦降级提示（§2.2 双向断路器）：本会话「被判危险而连续拒绝」达阈值时，调用方算好一句
   *  人话随卡下发，渲染层据此摆一键降档。**门只管转发、不置一字**——档位词汇属 permissions，
   *  在这里再写一遍就是第二份口径。 */
  tierWarning?: string;
}
export type AskOutcome = "approved" | "rejected";
/** 决议结果：批准时携带用户选择的 scope（缺省 once）；拒绝时携带拒绝原因（unattended/timeout）。 */
export interface AskOutcomeResult {
  outcome: AskOutcome;
  scope: AskScope;
  reason?: AskOutcomeReason;
}
export type AskOutcomeReason = "user" | "timeout" | "unattended";

export interface AskGateOptions {
  /** 询问 UI（渲染批准/拒绝行）。 */
  notify?: (req: AskRequest) => void;
  /** 决议回传 UI（行内显示结果，含超时）。 */
  notifyOutcome?: (askId: string, outcome: AskOutcome, reason: AskOutcomeReason) => void;
  /** 无响应超时，默认 60_000ms。 */
  timeoutMs?: number;
  /** M4a 无人值守（§11.7.6/§12.2.4）：一切审批请求 fail-closed **立即拒绝**，不进 60s 等待；
   *  拒绝原因落流（notifyOutcome reason="unattended"）。自主档任务的自动放行不经过本门，不受影响。 */
  unattended?: boolean;
  /** #96：这张卡**有没有人送得到**。返回 false ⇒ 当场按拒收束，不进 60s 等待。
   *   为什么单独一格：`notify` 是一条可选的注入式钩子（`hooks.onAsk?.()`），没注册就静默丢弃——
   *   于是「等人答」变成「等一个永远不会来的答案」，写向工具的回执挂在卡上，整场 run 停在那一格。
   *   拒绝理由沿用既有的 `unattended`，不新增词汇（`layer × verdict` 的分母不许多一档）。 */
  hasAnswerer?: () => boolean;
}

export class AskGate {
  private seq = 0;
  private readonly pending = new Map<string, { resolve: (r: AskOutcomeResult) => void }>();
  private readonly timeoutMs: number;

  constructor(private readonly opts: AskGateOptions = {}) {
    this.timeoutMs = opts.timeoutMs ?? 60_000;
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  /** 发起一次审批；默认 60 秒无响应按拒绝；unattended 门 = 立即拒绝（fail-closed，不等待）。
   *  D12（审查 P3）：ctx.signal 可选接 run 取消信号——run 中止时 pending 立即按拒绝收束
   *  （不再驻留至 60s 超时）；timer unref，不拽住进程退出。 */
  request(
    tool: ToolName | string,
    args: Record<string, unknown>,
    ctx: { reason?: string; risk?: RiskLevel; riskReasons?: string[]; signal?: AbortSignal; sessionId?: string; tierWarning?: string } = {},
  ): Promise<AskOutcomeResult> {
    const askId = "ask-" + String(++this.seq);
    if (this.opts.unattended || (this.opts.hasAnswerer && !this.opts.hasAnswerer())) {
      // 无人值守：**以及卡压根送不出去**（#96）——两种都不进 pending、不挂 timer，审批请求即刻拒绝并落流
      // （§12.2.4 fail-closed）。为什么合在一条分支里：两处都是「不新增词汇」的同一条收束（reason=unattended），
      // 而分开两条会让 `notifyOutcome` 那句在文件里出现两次——既有锚点 `ask-gate-unattended-notify` 的针脚
      // 当场从"唯一命中"退成"两处待复认"（本笔实测：待复认 2→3，我把别人的尺弄钝了）。
      this.opts.notifyOutcome?.(askId, "rejected", "unattended");
      return Promise.resolve({ outcome: "rejected", scope: "once", reason: "unattended" });
    }
    const signal = ctx.signal;
    return new Promise<AskOutcomeResult>((resolve) => {
      let settled = false;
      const finish = (r: AskOutcomeResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (signal) signal.removeEventListener("abort", onAbort);
        resolve(r);
      };
      const timer = setTimeout(() => {
        this.pending.delete(askId);
        const outcome: AskOutcome = "rejected";
        this.opts.notifyOutcome?.(askId, outcome, "timeout");
        finish({ outcome, scope: "once", reason: "timeout" });
      }, this.timeoutMs);
      // D12 的 unref 建议实测不采：本门是**进程内**等待（panels-check 顶层 await 直挂门），
      // unref 后门等待不再维持事件循环 → 进程以"unsettled top-level await"提前退出（exit 13）。
      // 收束能力由 signal 提供（run 中止时 pending 立即拒绝），超时定时器保持 ref。
      const onAbort = (): void => {
        this.pending.delete(askId);
        const outcome: AskOutcome = "rejected";
        this.opts.notifyOutcome?.(askId, outcome, "user");
        finish({ outcome, scope: "once", reason: "user" });
      };
      this.pending.set(askId, { resolve: finish });
      if (signal) {
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
      }
      // signal 是控制面，不进 UI 载荷。其余 ctx 字段（含 sessionId）整体摊进载荷；
      // sessionId 缺席键（不是 undefined 属性）⇒ 渲染层分得清「归属未知」与「归属是当前会话」。
      const { signal: _signal, ...notifyCtx } = ctx;
      this.opts.notify?.({ askId, tool, args, ...notifyCtx });
    });
  }

  /** 决议一次审批；未知或已决议的 askId 返回 false（幂等，不误伤）。
   * scope 仅在批准时有意义（once / session_kind / always，§11.7.5）。 */
  decide(
    askId: string,
    approved: boolean,
    reason: AskOutcomeReason = "user",
    scope: AskScope = "once",
  ): boolean {
    const entry = this.pending.get(askId);
    if (!entry) return false;
    this.pending.delete(askId);
    const outcome: AskOutcome = approved ? "approved" : "rejected";
    entry.resolve({ outcome, scope: approved ? scope : "once", reason });
    this.opts.notifyOutcome?.(askId, outcome, reason);
    return true;
  }
}
