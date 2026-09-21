// worker 审批的应答面（§4.4.3 / §10.3）：卡从事件流投影长出来，决议经 card_action 协议回到唯一入口。
// 此前渲染层对 api.cardAction 零调用者，而 worker 审批的唯一应答路径就是它
// （`waitForApproval` 有 approvalTimeoutMs 缺省 120s）⇒ 产品里每条 worker 审批都被自动拒掉。
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { cardActionForApproval, projectAgentPanel, workerApprovalAsks } from "../src/renderer/projections";
import type { AgentEvent } from "../src/events";

const spawn = { type: "agent_spawned", agent_id: "wt-1", parent_event_id: 3, mode: "write", task: "修排序", max_turns: 8, permission_mode: "default" } as unknown as AgentEvent;
const call = { type: "tool_call", id: "t1", name: "run_shell", args: { command: "pnpm test" }, agent_id: "wt-1" } as unknown as AgentEvent;
const req = { type: "approval_requested", id: "apr-1-1", agent_id: "wt-1", tool: "run_shell", args_digest: "pnpm test", risk: "high" } as unknown as AgentEvent;
const resolved = (decision: string) => ({ type: "approval_resolved", id: "apr-1-1", agent_id: "wt-1", decision, scope: "once" }) as unknown as AgentEvent;
const status = (s: string) => ({ type: "agent_status", agent_id: "wt-1", status: s }) as unknown as AgentEvent;

it("停在审批门上的 worker 长出一张卡，且载荷指向这条审批本身", () => {
  const asks = workerApprovalAsks(projectAgentPanel([spawn, call, req]));
  expect(asks.length).toBe(1);
  expect(asks[0]).toEqual({ askId: "apr-1-1", agentId: "wt-1", tool: "run_shell", risk: "high", parentEventId: 3 });
  expect(cardActionForApproval(asks[0]!, true)).toEqual({
    cardId: "approval:apr-1-1", sourceEventId: 3, cardType: "approval", action: "approve",
    payload: { approval_id: "apr-1-1" }, scope: "once", targetAgentId: "wt-1",
  });
  // 拒绝与批准是两条不同的决议（写反 = 用户点拒绝却放行了命令）
  expect(cardActionForApproval(asks[0]!, false).action).toBe("reject");
});

it("已答的、已死的、主会话的，都不许再弹卡", () => {
  expect(workerApprovalAsks(projectAgentPanel([spawn, call, req, resolved("approved")]))).toEqual([]);
  // §4.4.9：崩溃恢复把无终态 worker 扫成 failed——那条未答审批是历史，不是可执行动作
  expect(workerApprovalAsks(projectAgentPanel([spawn, call, req, status("failed")]))).toEqual([]);
  expect(workerApprovalAsks(projectAgentPanel([spawn, status("done")]))).toEqual([]);
  // 主会话审批不落 agent_id（走 IPC ask 通道），这里再弹一张就是重复出卡
  const mainAsk = { type: "approval_requested", id: "m1", tool: "write_file", args_digest: "x", risk: "low" } as unknown as AgentEvent;
  expect(workerApprovalAsks(projectAgentPanel([spawn, mainAsk]))).toEqual([]);
});

it("worker 档不给 always（§11.7.6），且血缘缺失时 sourceEventId 落成合法整数", () => {
  const ask = { askId: "a", agentId: "w", tool: "run_shell", risk: "high", parentEventId: 0 };
  expect(cardActionForApproval(ask, true).scope).toBe("once");
  expect(cardActionForApproval({ ...ask, parentEventId: Number.NaN }, true).sourceEventId).toBe(0);
});

// 生产者/消费端的配对闸：审批卡的唯一驱动是 refreshPanels，而它只在 PANEL_DIRTY 命中的事件上跑。
// 四处 approval_requested 里，「写租约相交」那一处**不伴随** agent_status（orchestrator:804-816），
// 所以脏集少了 approval_requested 时，那张卡要等下一个无关事件才可能出现（最长=整个 120s 超时）。
it("审批事件在面板脏集里（不然卡会晚到，甚至永远晚到超时之后）", () => {
  const src = readFileSync(new URL("../src/renderer/app.js", import.meta.url), "utf8");
  const m = /const PANEL_DIRTY = \{([^}]*)\};/.exec(src);
  expect(m, "PANEL_DIRTY 字面量形状变了：本判据要跟着改，不许静默通过").not.toBeNull();
  for (const t of ["approval_requested", "approval_resolved", "agent_spawned", "agent_status"]) {
    expect(m![1], t + " 必须进脏集").toContain(t + ":");
  }
});
