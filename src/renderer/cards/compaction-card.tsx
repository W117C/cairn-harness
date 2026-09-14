// 压缩卡（M1d）：压缩必出卡（§7.7 审计底线）——触发方式 / 被压范围 / 前后 token / 摘要预览。
// payload 由 src/agent/compaction.ts 的 compactionCardPayload 产出（compaction-check 同源断言）。
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CardProps } from "./registry";

export interface CompactionPayload {
  type: string;
  trigger: "auto" | "manual" | "overflow";
  reason: string;
  compressedCount: number;
  compressedRange: { from: number; to: number } | null;
  tokensBefore: number;
  tokensAfter: number;
  savedTokens: number;
  summaryPreview: string;
}

const TRIGGER_LABEL: Record<CompactionPayload["trigger"], string> = {
  auto: "自动压缩",
  manual: "手动 /compact",
  overflow: "紧急截断",
};

const REASON_LABEL: Record<string, string> = {
  threshold: "比例阈值（≥90%）",
  hard_buffer: "硬预算兜底",
  user_request: "用户请求",
};

export function CompactionCard({ payload }: CardProps): React.ReactElement {
  const p = payload as unknown as CompactionPayload;
  // G5（审查 P2）：关键字段防御性归一——损坏事件不再抛 TypeError。
  const trigger = typeof p.trigger === "string" ? p.trigger : "";
  const reason = typeof p.reason === "string" ? p.reason : "";
  const compressedCount = typeof p.compressedCount === "number" ? p.compressedCount : 0;
  const compressedRange = p.compressedRange ?? null;
  const tokensBefore = typeof p.tokensBefore === "number" ? p.tokensBefore : 0;
  const tokensAfter = typeof p.tokensAfter === "number" ? p.tokensAfter : 0;
  const savedTokens = typeof p.savedTokens === "number" ? p.savedTokens : 0;
  const summaryPreview = typeof p.summaryPreview === "string" ? p.summaryPreview : "";
  return (
    <Card size="sm">
      <CardHeader className="border-b px-3 py-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
          🗜 压缩
          <Badge variant={trigger === "overflow" ? "destructive" : "secondary"}>
            {TRIGGER_LABEL[trigger as keyof typeof TRIGGER_LABEL] ?? trigger}
          </Badge>
          <span className="text-xs font-normal text-muted-foreground">
            {REASON_LABEL[reason] ?? reason}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1.5 px-3 py-3 text-xs">
        <div className="flex flex-wrap items-center gap-2 font-mono">
          <span className="text-muted-foreground">范围</span>
          {compressedRange ? (
            <span>
              #{String(compressedRange.from)}–#{String(compressedRange.to)}（{String(compressedCount)} 条）
            </span>
          ) : (
            <span>无</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 font-mono">
          <span className="text-muted-foreground">tokens</span>
          <span>{String(tokensBefore)} → {String(tokensAfter)}</span>
          <span className="text-emerald-600 dark:text-emerald-400">省 {String(savedTokens)}</span>
        </div>
        <pre className="mt-1 max-h-40 overflow-auto rounded bg-muted/50 p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
          {summaryPreview}
        </pre>
      </CardContent>
    </Card>
  );
}
