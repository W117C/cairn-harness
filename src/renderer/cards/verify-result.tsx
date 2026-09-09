// 验证结果卡：渲染 verify_result（通过/未通过、第 N 次、逐条命令输出）。
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CardProps } from "./registry";

export interface VerifyResultPayload {
  callId: string;
  ok: boolean;
  attempt: number;
  maxAttempts: number;
  results: { command: string; ok: boolean; output: string }[];
}

export function VerifyResultCard({ payload }: CardProps): React.ReactElement {
  const p = payload as unknown as VerifyResultPayload;
  return (
    <Card size="sm">
      <CardHeader className="border-b px-3 py-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          ✅ 验证门
          <Badge variant={p.ok ? "secondary" : "destructive"}>{p.ok ? "通过" : "未通过"}</Badge>
          <span className="text-xs font-normal text-muted-foreground">
            第 {String(p.attempt)}/{String(p.maxAttempts)} 次
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 px-3 py-3">
        {p.results.map((r, i) => (
          <div key={i} className="font-mono text-xs">
            <div className="flex items-center gap-2">
              <span className={r.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>
                {r.ok ? "✓" : "✗"}
              </span>
              <span>{r.command}</span>
            </div>
            {r.output ? (
              <pre className="mt-1 max-h-32 overflow-auto rounded bg-muted/50 p-2 text-[11px] leading-relaxed whitespace-pre-wrap">
                {r.output.slice(0, 800)}
              </pre>
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}