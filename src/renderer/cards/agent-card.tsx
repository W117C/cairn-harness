// M3a agent 卡（§10.3 agent_card）：agent_spawned + agent_status 子流的一等投影，
// 可回写动作 steer / cancel / open_report（本轮 steer 留 M3b；cancel 走 card_action 事件）。
// 零事件流外私有状态：status/current_action/cost 全部来自投影载荷（§3.1 判据）。
import type { ReactElement } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface AgentCardPayload {
  type: "agent_card";
  agent_id: string;
  mode: string;
  task: string;
  status?: string;
  reason?: string;
  permission_mode?: string;
  tier_warning?: string;
  usage?: { inputTokens: number; outputTokens: number };
  pendingApproval?: boolean;
  report?: string;
}

export function AgentCard({ payload, onAction }: { payload: AgentCardPayload; onAction?: (action: string, data: unknown) => void }): ReactElement {
  const status = payload.status ?? "running";
  const badge =
    status === "done" ? <Badge variant="default">done</Badge> :
    status === "failed" ? <Badge variant="destructive">failed</Badge> :
    status === "cancelled" ? <Badge variant="outline">cancelled</Badge> :
    status === "waiting_approval" ? <Badge variant="destructive">waiting_approval</Badge> :
    <Badge variant="secondary">{status}</Badge>;
  const running = status === "running" || status === "waiting_approval" || status === "waiting_input";
  return (
    <Card size="sm" data-m3a-agent-card={payload.agent_id}>
      <CardHeader className="px-3 py-2">
        <CardTitle className="flex flex-wrap items-center gap-1.5 text-sm">
          <Badge variant="outline">{payload.mode}</Badge>
          <span className="font-mono">{payload.agent_id}</span>
          {badge}
          {payload.permission_mode && <Badge variant="outline" className="font-mono text-[10px]">{payload.permission_mode}</Badge>}
          {payload.usage && (
            <span className="font-mono text-[10px] text-muted-foreground">
              {payload.usage.inputTokens}/{payload.usage.outputTokens} tok
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5 px-3 pb-2 text-xs">
        <div className="line-clamp-2 text-muted-foreground">{payload.task}</div>
        {payload.tier_warning && (
          <div className="rounded border border-amber-500/40 bg-amber-500/5 px-2 py-1 text-amber-700 dark:text-amber-400">⚠ {payload.tier_warning}</div>
        )}
        {payload.pendingApproval && <div className="text-amber-700 dark:text-amber-400">⏳ 有待批审批（审批队列/agents 面板可决议）</div>}
        {payload.reason && <div className="text-muted-foreground">原因：{payload.reason}</div>}
        {payload.report && (
          <details data-m3a-agent-card-report={payload.agent_id}>
            <summary className="cursor-pointer text-muted-foreground">open_report</summary>
            <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-2 font-mono text-[11px]">{payload.report}</pre>
          </details>
        )}
        {running && onAction && (
          <Button
            size="sm"
            variant="outline"
            data-m3a-agent-card-cancel={payload.agent_id}
            onClick={() => onAction("agent_cancel", { agentId: payload.agent_id })}
          >
            cancel
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
