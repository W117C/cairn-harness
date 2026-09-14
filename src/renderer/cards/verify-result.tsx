// 验证结果卡：渲染 verify_result（通过/未通过、第 N 次、逐条命令输出）。
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { str, type CardProps } from "./registry";

export interface VerifyResultPayload {
  callId: string;
  ok: boolean;
  attempt: number;
  maxAttempts: number;
  results: { command: string; ok: boolean; output: string }[];
}

export function VerifyResultCard({ payload }: CardProps): React.ReactElement {
  const p = payload as unknown as VerifyResultPayload;
  // G5（审查 P2）：关键字段防御性归一——损坏事件不再抛 TypeError。
  const ok = p.ok === true;
  const attempt = typeof p.attempt === "number" ? p.attempt : 0;
  const maxAttempts = typeof p.maxAttempts === "number" ? p.maxAttempts : 0;
  const results = Array.isArray(p.results) ? p.results : [];
  return (
    <Card size="sm">
      <CardHeader className="border-b px-3 py-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          ✅ 验证门
          <Badge variant={ok ? "secondary" : "destructive"}>{ok ? "通过" : "未通过"}</Badge>
          <span className="text-xs font-normal text-muted-foreground">
            第 {String(attempt)}/{String(maxAttempts)} 次
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 px-3 py-3">
        {results.map((r, i) => {
          const okR = r !== null && typeof r === "object" && r.ok === true;
          const command = r && typeof r === "object" ? str(r.command) : "";
          const output = r && typeof r === "object" && typeof r.output === "string" ? r.output : "";
          return (
          <div key={i} className="font-mono text-xs">
            <div className="flex items-center gap-2">
              <span className={okR ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>
                {okR ? "✓" : "✗"}
              </span>
              <span>{command}</span>
            </div>
            {output ? (
              <pre className="mt-1 max-h-32 overflow-auto rounded bg-muted/50 p-2 text-[11px] leading-relaxed whitespace-pre-wrap">
                {output.slice(0, 800)}
              </pre>
            ) : null}
          </div>
          );
        })}
      </CardContent>
    </Card>
  );
}