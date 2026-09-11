// 卡片注册表：card_type → 组件。M1a 落 approval / diff / report / usage_summary 四类，
// M1b 增 clarify_form / plan / verify_result 三类（三门），外壳用现有 shadcn 组件；
// 未知 card_type 落兜底卡，绝不抛异常。
// （文件用 .tsx 后缀：卡片组件含 JSX，.ts 无法编译。）
import type { ReactElement } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClarifyFormCard } from "./clarify-form";
import { CompactionCard } from "./compaction-card";
import { PlanCard } from "./plan";
import { PromoteCard } from "./promote";
import { VerifyResultCard } from "./verify-result";

export interface CardProps {
  payload: Record<string, unknown>;
  /** 卡片动作回传（表单提交 / 方案批准），由宿主（main.tsx → IPC）接线；缺省 = 纯展示。 */
  onAction?: (action: string, data: unknown) => void;
}
export type CardComponent = (props: CardProps) => ReactElement;

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}
function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** 审批卡：工具名 + 参数摘要 + 决议状态。payload: { tool, args?, status? } */
export function ApprovalCard({ payload }: CardProps): ReactElement {
  const status = str(payload.status, "pending");
  return (
    <Card size="sm" className="py-3">
      <CardContent className="flex flex-wrap items-center gap-2 px-3 text-sm">
        <Badge
          variant={status === "approved" ? "secondary" : status === "rejected" ? "destructive" : "outline"}
        >
          {status === "approved" ? "已批准" : status === "rejected" ? "已拒绝" : "待审批"}
        </Badge>
        <span className="font-mono text-xs">{str(payload.tool)}</span>
        <span className="max-w-full truncate font-mono text-xs text-muted-foreground">
          {JSON.stringify(payload.args ?? {})}
        </span>
      </CardContent>
    </Card>
  );
}

/** diff 卡：文件路径 + 补丁内容。payload: { path, patch } */
export function DiffCard({ payload }: CardProps): ReactElement {
  return (
    <Card size="sm">
      <CardHeader className="border-b px-3 py-2">
        <CardTitle className="font-mono text-xs">📝 {str(payload.path)}</CardTitle>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        <pre className="max-h-64 overflow-auto px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all">
          {str(payload.patch)}
        </pre>
      </CardContent>
    </Card>
  );
}

/** 报告卡：标题 + 正文。payload: { title, body } */
export function ReportCard({ payload }: CardProps): ReactElement {
  return (
    <Card size="sm">
      <CardHeader className="px-3 py-2">
        <CardTitle className="text-sm">{str(payload.title)}</CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-3 text-sm whitespace-pre-wrap text-muted-foreground">
        {str(payload.body)}
      </CardContent>
    </Card>
  );
}

/** 用量摘要卡：每轮 API 的 token 用量。payload: { inputTokens, outputTokens } */
export function UsageSummaryCard({ payload }: CardProps): ReactElement {
  const input = num(payload.inputTokens);
  const output = num(payload.outputTokens);
  return (
    <Card size="sm" className="py-2">
      <CardContent className="flex items-center gap-2 px-3 text-xs text-muted-foreground">
        <Badge variant="outline">usage</Badge>
        <span>
          tokens：{String(input)} in / {String(output)} out（共 {String(input + output)}）
        </span>
      </CardContent>
    </Card>
  );
}

/** 兜底卡：未知类型的静默降级，不抛异常。 */
export function FallbackCard({ payload }: CardProps): ReactElement {
  return (
    <Card size="sm" className="py-2">
      <CardContent className="px-3 text-xs text-muted-foreground">
        <span>未知卡片类型：{str(payload.type, "(未声明)")}</span>
        <pre className="mt-1 overflow-hidden font-mono text-[11px] whitespace-pre-wrap break-all opacity-70">
          {JSON.stringify(payload).slice(0, 200)}
        </pre>
      </CardContent>
    </Card>
  );
}

const REGISTRY: Record<string, CardComponent> = {
  approval: ApprovalCard,
  diff: DiffCard,
  report: ReportCard,
  usage_summary: UsageSummaryCard,
  clarify_form: ClarifyFormCard,
  plan: PlanCard,
  verify_result: VerifyResultCard,
  compaction: CompactionCard,
  promote: PromoteCard, // M2f：sidechat 结论提升卡（可跳回源消息）
};

export const KNOWN_CARD_TYPES = Object.keys(REGISTRY);

/** card_type → 组件；未知类型返回兜底卡（不抛异常）。 */
export function resolveCard(cardType: string): CardComponent {
  return REGISTRY[cardType] ?? FallbackCard;
}
