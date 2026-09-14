// 卡片注册表：card_type → 组件。M1a 落 approval / diff / report / usage_summary 四类，
// M1b 增 clarify_form / plan / verify_result 三类（三门），M2f compaction/promote，
// M3a agent_card（多 agent 指挥卡：steer/cancel/open_report）；外壳用现有 shadcn 组件；
// 未知 card_type 落兜底卡，绝不抛异常。
// （文件用 .tsx 后缀：卡片组件含 JSX，.ts 无法编译。）
// M3b（§4.5 评审闭环 / 任务书裁决 8）：diff 卡扩行级评论动作——payload.commentable=true 时补丁逐行
// 可点击评论（hunk 行号推导 → diff_comment 事件），卡片注册表不加新类型。
import { useMemo, useState, type ReactElement } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AgentCard } from "./agent-card";
import { ClarifyFormCard } from "./clarify-form";
import { CompactionCard } from "./compaction-card";
import { PlanCard } from "./plan";
import { PromoteCard } from "./promote";
import { VerifyResultCard } from "./verify-result";
import { firstPathOfStat, parsePatchLines } from "../projections";

export interface CardProps {
  payload: Record<string, unknown>;
  /** 卡片动作回传（表单提交 / 方案批准），由宿主（main.tsx → IPC）接线；缺省 = 纯展示。 */
  onAction?: (action: string, data: unknown) => void;
}
export type CardComponent = (props: CardProps) => ReactElement;

// G5（审查 P2）：导出给各卡片做防御性字段归一（损坏/旧版 JSONL 事件不许让卡片抛 TypeError）。
export function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}
export function num(v: unknown, fallback = 0): number {
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

/** diff 卡：文件路径 + 补丁内容。payload: { path, patch }
 *  M3b 扩展（裁决 8，不加新卡片类型）：payload.commentable=true（携 agent_id）→ 补丁逐行可点击
 *  行级评论（新文件侧行号由 hunk 头推导），提交经 onAction("diff_line_comment", {agent_id, path, line, body})。 */
export function DiffCard({ payload, onAction }: CardProps): ReactElement {
  const patch = str(payload.patch);
  const agentId = str(payload.agent_id);
  const commentable = payload.commentable === true && agentId !== "" && onAction !== undefined && patch !== "";
  const comments = Array.isArray(payload.comments)
    ? (payload.comments as { path: string; line: number; body: string }[])
    : [];
  const [pendingLine, setPendingLine] = useState<number | null>(null);
  const [body, setBody] = useState("");
  const lines = useMemo(() => (commentable ? parsePatchLines(patch) : null), [commentable, patch]);
  const path = commentPath(payload, patch);
  const submit = (): void => {
    if (pendingLine === null || body.trim() === "" || !onAction) return;
    onAction("diff_line_comment", { agent_id: agentId, path, line: pendingLine, body: body.trim() });
    setBody("");
    setPendingLine(null);
  };
  return (
    <Card size="sm">
      <CardHeader className="border-b px-3 py-2">
        <CardTitle className="font-mono text-xs">📝 {str(payload.path, path)}</CardTitle>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        {lines !== null ? (
          <>
            <pre className="max-h-64 overflow-auto px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all">
              {lines.map((l, i) => (
                <div
                  key={String(i)}
                  role="button"
                  tabIndex={l.newLine !== null ? 0 : -1}
                  aria-label={l.newLine !== null ? "第 " + String(l.newLine) + " 行，行级评论" : undefined}
                  className={pendingLine === l.newLine && l.newLine !== null ? "cursor-pointer bg-amber-500/10" : "cursor-pointer hover:bg-muted/60"}
                  data-m3b-diff-line={l.newLine ?? undefined}
                  title={l.newLine !== null ? "第 " + String(l.newLine) + " 行 · 点击行级评论" : undefined}
                  onClick={() => {
                    if (l.newLine !== null) setPendingLine(l.newLine);
                  }}
                  onKeyDown={(ev: { key: string; preventDefault: () => void }) => {
                    // G9（审查 P3）：键盘用户也能选行评论（Enter/Space 触发，同点击语义）
                    if (l.newLine !== null && (ev.key === "Enter" || ev.key === " ")) {
                      ev.preventDefault();
                      setPendingLine(l.newLine);
                    }
                  }}
                >
                  {l.text}
                </div>
              ))}
            </pre>
            {pendingLine !== null && (
              <div className="flex items-end gap-2 px-3 pb-2" data-m3b-comment-box="">
                <span className="whitespace-nowrap font-mono text-[11px] text-muted-foreground">评论 {path}:{String(pendingLine)}</span>
                <input
                  className="min-w-0 flex-1 rounded border bg-background px-2 py-1 text-xs"
                  value={body}
                  autoFocus
                  data-m3b-comment-input=""
                  placeholder="评审意见（将注入该 worker 子流）"
                  onChange={(e) => setBody(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      submit();
                    }
                  }}
                />
                <Button size="sm" data-m3b-comment-send="" onClick={submit}>发送</Button>
              </div>
            )}
          </>
        ) : (
          <pre className="max-h-64 overflow-auto px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all">
            {patch}
          </pre>
        )}
        {comments.length > 0 && (
          <div className="space-y-0.5 px-3 pb-2 font-mono text-[11px] text-muted-foreground" data-m3b-comments="">
            {comments.map((c, i) => (
              <div key={String(i)}>💬 {c.path}:{String(c.line)} {c.body}</div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** 行级评论落点文件：patch 的 +++ b/<path> 头 → stat 首路径 → payload.path（三级回退）。
 *  G10（审查）：stat 首路径解析用 projections 的共享实现（panels 侧同源）。 */
function commentPath(payload: Record<string, unknown>, patch: string): string {
  for (const line of patch.split("\n")) {
    if (line.startsWith("+++ b/")) return line.slice("+++ b/".length).replace(/\t.*$/, "");
    if (line.startsWith("+++ /dev/null")) break;
  }
  const stat = typeof payload.stat === "string" ? payload.stat : "";
  return firstPathOfStat(stat) ?? str(payload.path);
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
  agent_card: AgentCard as unknown as CardComponent, // M3a：多 agent 指挥卡（steer/cancel/open_report）
};

export const KNOWN_CARD_TYPES = Object.keys(REGISTRY);

/** card_type → 组件；未知类型返回兜底卡（不抛异常）。 */
export function resolveCard(cardType: string): CardComponent {
  return REGISTRY[cardType] ?? FallbackCard;
}
