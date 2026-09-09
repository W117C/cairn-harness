// 面板注册表（§10.2）：panel_id → 组件。M1 三类：approvals / token / git；
// 未知 panel_id 落兜底面板，绝不抛异常（与卡片注册表同构）。
import type { ReactElement } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ApprovalCard } from "../cards/registry";
import type { DiffCardProjection, TokenProjection } from "../projections";

/** M1 面板三类（§10.2 清单的 M1 里程碑行）；与 main/settings 的 PANEL_IDS 同源字符串。 */
export type PanelId = "approvals" | "token" | "git";

export interface PanelProps {
  /** 当前会话事件流投影载荷（各面板字段可选）。 */
  payload: {
    /** approvals：待批卡聚合。 */
    asks?: {
      askId: string;
      tool: string;
      args: Record<string, unknown>;
      reason?: string;
      risk?: string;
    }[];
    /** token：usage 投影。 */
    tokens?: TokenProjection;
    /** git：diff 卡列表。 */
    diffs?: DiffCardProjection[];
    /** 全部事件数（面板头展示）。 */
    eventCount?: number;
  };
  /** 面板动作（compact 等），宿主接线。 */
  onAction?: (action: string) => void;
}
export type PanelComponent = (props: PanelProps) => ReactElement;

/** 审批队列面板：待批卡聚合 + 单口路由（批准/拒绝动作由对话流审批卡承担，此处跳转提示）。 */
export function ApprovalsPanel({ payload }: PanelProps): ReactElement {
  const asks = payload.asks ?? [];
  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-center gap-2">
        <Badge variant={asks.length > 0 ? "destructive" : "secondary"}>待批 {asks.length}</Badge>
        <span className="text-xs text-muted-foreground">事件流投影 · 无私有状态</span>
      </div>
      {asks.length === 0 && <div className="text-sm text-muted-foreground">没有待审批的操作。</div>}
      {asks.map((a) => (
        <ApprovalCard key={a.askId} payload={{ type: "approval", tool: a.tool, args: a.args, status: "pending" }} />
      ))}
    </div>
  );
}

/** Token 面板：usage 事件累计 + 压缩计数（D11 多次压缩建议开新会话）。 */
export function TokenPanel({ payload, onAction }: PanelProps): ReactElement {
  const t = payload.tokens;
  return (
    <div className="flex flex-col gap-3 p-3 text-sm">
      {t ? (
        <>
          <div className="flex items-center gap-2">
            <Badge variant="outline">usage × {t.usageCount}</Badge>
            <span className="text-muted-foreground">事件流投影</span>
          </div>
          <div>
            输入 <span className="font-mono">{t.inputTokens}</span> · 输出{" "}
            <span className="font-mono">{t.outputTokens}</span> · 合计{" "}
            <span className="font-mono font-semibold">{t.totalTokens}</span> tokens
          </div>
          <div className="text-xs text-muted-foreground">压缩次数：{t.compactionCount}</div>
          {t.suggestNewSession && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              已压缩 {t.compactionCount} 次，建议开新会话（上下文准确性衰减）。
            </div>
          )}
          {onAction && (
            <Button size="sm" variant="outline" className="w-fit" onClick={() => onAction("compact")}>
              手动 /compact
            </Button>
          )}
        </>
      ) : (
        <div className="text-muted-foreground">暂无 usage 事件。</div>
      )}
    </div>
  );
}

/** Git 面板：diff 卡列表（agent 写动作聚合；合并控制塔留 M3）。 */
export function GitPanel({ payload }: PanelProps): ReactElement {
  const diffs = payload.diffs ?? [];
  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-center gap-2">
        <Badge variant="outline">diff × {diffs.length}</Badge>
        <span className="text-xs text-muted-foreground">写动作聚合 · 合并控制塔 M3</span>
      </div>
      {diffs.length === 0 && <div className="text-sm text-muted-foreground">本会话还没有写动作。</div>}
      {diffs.map((d) => (
        <Card key={d.id} size="sm">
          <CardHeader className="border-b px-3 py-2">
            <CardTitle className="flex items-center gap-2 font-mono text-xs">
              📝 {d.path}
              {d.ok !== null && (
                <Badge variant={d.ok ? "secondary" : "destructive"}>{d.ok ? "已写入" : "写入失败"}</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <pre className="max-h-48 overflow-auto px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all">
              {d.content}
            </pre>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/** 兜底面板：未知 panel_id 静默降级，不抛异常。 */
export function FallbackPanel({ payload }: PanelProps): ReactElement {
  return (
    <div className="p-3 text-xs text-muted-foreground">
      未知面板（无内容）。
      {payload.eventCount !== undefined && <div className="mt-1">事件数：{payload.eventCount}</div>}
    </div>
  );
}

const REGISTRY: Record<string, PanelComponent> = {
  approvals: ApprovalsPanel,
  token: TokenPanel,
  git: GitPanel,
};

export const KNOWN_PANEL_IDS = Object.keys(REGISTRY);

/** panel_id → 面板组件；未知 id 返回兜底面板（不抛异常）。 */
export function resolvePanel(panelId: string): PanelComponent {
  return REGISTRY[panelId] ?? FallbackPanel;
}
