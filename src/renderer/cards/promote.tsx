// M2f promote 卡：把 sidechat 提升进主会话的 user_message 渲染为可追溯卡片。
// 源消息徽标由 origin 反向投影（kind/session_id/source_event_ids/note 四字段）；「跳回源消息」按钮
// 把源定位交回宿主（onAction("jump_source", ...)）——卡本身零私有状态，全部来自事件 payload。
import type { ReactElement } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CardProps } from "./registry";

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function numArray(v: unknown): number[] {
  return Array.isArray(v) ? v.filter((x): x is number => typeof x === "number") : [];
}

/** 提升卡：内容 + origin 四字段徽标 + 跳回源消息。payload: { content, origin:{kind,session_id,source_event_ids,note?} } */
export function PromoteCard({ payload, onAction }: CardProps): ReactElement {
  const origin = (typeof payload.origin === "object" && payload.origin !== null ? payload.origin : {}) as Record<string, unknown>;
  const sessionId = str(origin.session_id, "?");
  const sourceIds = numArray(origin.source_event_ids);
  const note = str(origin.note);
  return (
    <Card size="sm" data-m2f-promote-card="">
      <CardHeader className="border-b px-3 py-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="outline" data-m2f-promote-badge="">来自 sidechat</Badge>
          <span className="font-mono text-muted-foreground">{sessionId}</span>
          <span className="text-muted-foreground">
            源事件：{sourceIds.length > 0 ? sourceIds.map((n) => "#" + String(n)).join("、") : "（未标注）"}
          </span>
          {note !== "" && <span className="text-muted-foreground">· {note}</span>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 px-3 py-2 text-sm">
        <div className="whitespace-pre-wrap">{str(payload.content)}</div>
        <Button
          size="sm"
          variant="outline"
          disabled={onAction === undefined || sourceIds.length === 0}
          data-m2f-jump-source=""
          onClick={() => onAction?.("jump_source", { sessionId, sourceEventIds: sourceIds })}
        >
          跳回源消息
        </Button>
      </CardContent>
    </Card>
  );
}
