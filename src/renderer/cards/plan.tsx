// 方案卡：渲染 plan_proposed（目标 / 文件清单 / 草图 / verify 命令），
// 批准/拒绝经 card_action("plan_decide") 交回驱动方（权限层解锁写禁）。
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PlanProposal } from "../../events";
import type { CardProps } from "./registry";

export interface PlanCardPayload {
  callId: string;
  plan: PlanProposal;
  status?: "pending" | "approved" | "rejected";
}

const ACTION_LABEL: Record<string, string> = { create: "新建", edit: "修改", delete: "删除" };

export function PlanCard({ payload, onAction }: CardProps): React.ReactElement {
  const p = payload as unknown as PlanCardPayload;
  const plan = p.plan;
  const decided = p.status === "approved" || p.status === "rejected";
  return (
    <Card size="sm">
      <CardHeader className="border-b px-3 py-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          📋 方案
          <Badge
            variant={p.status === "approved" ? "secondary" : p.status === "rejected" ? "destructive" : "outline"}
          >
            {p.status === "approved" ? "已批准" : p.status === "rejected" ? "已拒绝" : "待批准"}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-3 py-3 text-sm">
        <div>
          <div className="text-xs text-muted-foreground">目标</div>
          <div>{plan.goal}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">文件清单（{String(plan.files.length)}）</div>
          <div className="mt-1 flex flex-col gap-1">
            {plan.files.map((f) => (
              <div key={f.path} className="flex items-center gap-2">
                <Badge variant="outline">{ACTION_LABEL[f.action] ?? f.action}</Badge>
                <span className="font-mono text-xs">{f.path}</span>
                <span className="truncate text-xs text-muted-foreground">{f.summary}</span>
              </div>
            ))}
          </div>
        </div>
        {plan.approach ? (
          <div>
            <div className="text-xs text-muted-foreground">草图 / 思路</div>
            <pre className="font-mono text-xs whitespace-pre-wrap">{plan.approach}</pre>
          </div>
        ) : null}
        {plan.verify ? (
          <div>
            <div className="text-xs text-muted-foreground">verify 命令</div>
            <div className="font-mono text-xs">
              {(plan.verify.lint ?? []).map((c) => (
                <div key={c}>lint: {c}</div>
              ))}
              {(plan.verify.test ?? []).map((c) => (
                <div key={c}>test: {c}</div>
              ))}
            </div>
          </div>
        ) : null}
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={decided}
            onClick={() => onAction?.("plan_decide", { callId: p.callId, approved: true })}
          >
            批准
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={decided}
            onClick={() => onAction?.("plan_decide", { callId: p.callId, approved: false })}
          >
            拒绝
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}