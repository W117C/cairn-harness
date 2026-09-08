// 批准门状态机：pending → approved / rejected；默认 60 秒无响应按拒绝。
// 纯逻辑、零 electron 依赖；超时用 setTimeout（vitest 假时钟可测，测试不真等 60 秒）。
import type { ToolName } from "../tools/base";

export interface AskRequest {
  askId: string;
  tool: ToolName;
  args: Record<string, unknown>;
}
export type AskOutcome = "approved" | "rejected";
export type AskOutcomeReason = "user" | "timeout";

export interface AskGateOptions {
  /** 询问 UI（渲染批准/拒绝行）。 */
  notify?: (req: AskRequest) => void;
  /** 决议回传 UI（行内显示结果，含超时）。 */
  notifyOutcome?: (askId: string, outcome: AskOutcome, reason: AskOutcomeReason) => void;
  /** 无响应超时，默认 60_000ms。 */
  timeoutMs?: number;
}

export class AskGate {
  private seq = 0;
  private readonly pending = new Map<string, { resolve: (outcome: AskOutcome) => void }>();
  private readonly timeoutMs: number;

  constructor(private readonly opts: AskGateOptions = {}) {
    this.timeoutMs = opts.timeoutMs ?? 60_000;
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  /** 发起一次审批；默认 60 秒无响应按拒绝。 */
  request(tool: ToolName, args: Record<string, unknown>): Promise<AskOutcome> {
    const askId = "ask-" + String(++this.seq);
    return new Promise<AskOutcome>((resolve) => {
      const timer = setTimeout(() => {
        this.decide(askId, false, "timeout");
      }, this.timeoutMs);
      this.pending.set(askId, {
        resolve: (outcome) => {
          clearTimeout(timer);
          resolve(outcome);
        },
      });
      this.opts.notify?.({ askId, tool, args });
    });
  }

  /** 决议一次审批；未知或已决议的 askId 返回 false（幂等，不误伤）。 */
  decide(askId: string, approved: boolean, reason: AskOutcomeReason = "user"): boolean {
    const entry = this.pending.get(askId);
    if (!entry) return false;
    this.pending.delete(askId);
    const outcome: AskOutcome = approved ? "approved" : "rejected";
    entry.resolve(outcome);
    this.opts.notifyOutcome?.(askId, outcome, reason);
    return true;
  }
}
