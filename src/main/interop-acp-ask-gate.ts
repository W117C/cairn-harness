/** ACP 权限桥：把产品的 AskGate 审批流转发到 ACP 客户端的 `session/request_permission`。
 *
 *  为什么走在 AskGate 上：`handleAgentRun` 本来就接受注入的 `askGate`（D-2 之后审批路由统一），
 *  桥不复制执行面——写工具的闸仍在 tool-gates，桥只做「问谁」的替换：从渲染层批准卡换成
 *  ACP 客户端的 JSON-RPC 请求。
 *
 *  映射（fail-closed）：
 *  - `session/request_permission` 只提供 `allow_once` / `reject_once` 两个选项（scope 一律 once，
 *    不授予 session_kind/always——远程客户端不拿持久授权）；
 *  - 选中 `allow_once` → approved；选中 `reject_once` 或 `cancelled` → rejected；
 *  - 传输超时/出错 → rejected（reason=timeout）；桥未接上传输 → rejected（reason=unattended）。
 *  每个请求都带 sessionId（载荷里的 askId 与之配对），客户端答非所问的 optionId 按拒绝处理。 */

import { AskGate } from "./ask-gate";
import type { AskRequest } from "./ask-gate";

export interface AcpAskGateOptions {
  /** 送 ACP 客户端的方法；由 stdio 传输的 `transport.request` 提供。 */
  send: (method: string, params: unknown) => Promise<unknown>;
  /** 客户端响应等待上限；与 AskGate 自身的 60s 默认对齐。 */
  timeoutMs?: number;
}

interface RequestPermissionOutcome {
  outcome: { outcome: string; optionId?: string } | null;
}

export function createAcpAskGate(opts: AcpAskGateOptions): AskGate {
  const timeoutMs = Math.max(1, opts.timeoutMs ?? 60_000);
  // notify 在 gate 构造之后才会被调用；用占位引用闭环。
  let decideRef: ((askId: string, approved: boolean, reason?: "user" | "timeout" | "unattended") => boolean) | null = null;
  const gate = new AskGate({
    timeoutMs,
    notify: (req: AskRequest) => {
      void (async () => {
        const decide = decideRef;
        if (decide === null) return; // 不会发生：notify 只在 request() 里被调，而那时 gate 已构造完
        try {
          const raw = await opts.send("session/request_permission", {
            ...(req.sessionId !== undefined ? { sessionId: req.sessionId } : {}),
            toolCall: {
              toolCallId: req.askId,
              title: String(req.tool),
              kind: "other",
              rawInput: req.args,
            },
            options: [
              { optionId: "allow_once", kind: "allow_once", name: "允许一次" },
              { optionId: "reject_once", kind: "reject_once", name: "拒绝一次" },
            ],
            ...(req.reason !== undefined ? { reason: req.reason } : {}),
          });
          if (typeof raw !== "object" || raw === null) {
            throw new Error("client response is not an object");
          }
          const outcome = (raw as RequestPermissionOutcome).outcome;
          if (typeof outcome !== "object" || outcome === null || typeof outcome.outcome !== "string") {
            throw new Error("client response has no outcome");
          }
          if (outcome.outcome === "selected" && outcome.optionId === "allow_once") {
            decide(req.askId, true);
            return;
          }
          // selected + reject_once、cancelled、以及一切不认识的 optionId：一律拒绝。
          decide(req.askId, false);
        } catch {
          // 传输超时/断开/响应形状不对：按超时拒绝收束，不挂住 run。
          decide(req.askId, false, "timeout");
        }
      })();
    },
  });
  decideRef = (askId, approved, reason) => gate.decide(askId, approved, reason);
  return gate;
}
