// 面板注册表（§10.2）：panel_id → 组件。M1 三类：approvals / token / git；M2d 增 memory。
// 未知 panel_id 落兜底面板，绝不抛异常（与卡片注册表同构）。
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ApprovalCard } from "../cards/registry";
import type { DiffCardProjection, MemoryWriteProjection, TokenProjection } from "../projections";
import type { MemorySnapshot } from "../../main/ipc-protocol";

/** M1 面板三类（§10.2 清单的 M1 里程碑行）+ M2d memory；与 main/settings 的 PANEL_IDS 同源字符串。 */
export type PanelId = "approvals" | "token" | "git" | "memory";

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
    /** M2d memory：本会话 remember 调用审计投影。 */
    memoryWrites?: MemoryWriteProjection[];
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

/** M2d 记忆面板：两层快照（getState 透传）+ 会话内 remember 审计投影 + 用户删除权。
 *  删除走 window.agent.deleteMemory（optional——preload 白名单本轮未含，M1d compact 同款先例；
 *  未接线时按钮禁用并注明，主进程通道已就绪）。 */
function MemoryPanel({ payload }: PanelProps): ReactElement {
  const [snap, setSnap] = useState<MemorySnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  // SSR 安全：headless 渲染无 window（面板注册表规约——渲染绝不抛）
  const canDelete = typeof window !== "undefined" && typeof window.agent?.deleteMemory === "function";
  const reload = useCallback(async () => {
    try {
      const st = await window.agent.getState();
      setSnap(st.memory ?? null);
    } catch {
      setSnap(null);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  const del = async (scope: "project" | "global", topic: string): Promise<void> => {
    if (!window.agent.deleteMemory) return;
    setBusy(true);
    try {
      await window.agent.deleteMemory(scope, topic);
      await reload();
    } finally {
      setBusy(false);
    }
  };
  const writes: MemoryWriteProjection[] = payload.memoryWrites ?? [];
  const layer = (title: string, scope: "project" | "global") => {
    const l = snap ? (scope === "project" ? snap.project : snap.global) : null;
    const deletable = canDelete && l !== null && l.topics.length > 0;
    return (
      <Card data-m2d-layer={scope}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            {title}
            <Badge variant="secondary">{l ? String(l.topics.length) + " 条" : "…"}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-xs">
          {l && <div className="break-all font-mono text-muted-foreground">{l.path}</div>}
          {l?.topics.map((t) => (
            <div key={t.topic} className="flex min-w-0 items-center justify-between gap-2" data-m2d-topic={t.topic}>
              <span className="min-w-0 truncate">
                <Badge variant="outline" className="mr-1">{t.type}</Badge>
                {t.topic}
                <span className="ml-1 text-muted-foreground">{t.modified.slice(0, 10)}</span>
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={!deletable || busy}
                title={canDelete ? "删除该记忆（仅用户可删）" : "删除通道待 preload 接线（BLOCKED 备案）"}
                onClick={() => void del(scope, t.topic)}
              >
                删除
              </Button>
            </div>
          ))}
          {l !== null && l.topics.length === 0 && <div className="text-muted-foreground">（本层暂无记忆）</div>}
          {l && l.pendingExternalRefs.length > 0 && (
            <div className="text-amber-600">待批准外部引用：{l.pendingExternalRefs.join("、")}</div>
          )}
        </CardContent>
      </Card>
    );
  };
  return (
    <div className="space-y-2 p-3" data-m2d-memory-panel>
      {layer("项目层（.agent/，随仓库）", "project")}
      {layer("全局层（本机）", "global")}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">本会话 remember 写入（事件流审计）</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-xs">
          {writes.length === 0 && <div className="text-muted-foreground">（本会话无 remember 调用）</div>}
          {writes.map((w) => (
            <div key={w.callId} className="font-mono">
              <Badge variant={w.ok === null ? "secondary" : w.ok ? "default" : "destructive"}>{w.ok === null ? "…" : w.ok ? "ok" : "fail"}</Badge>{" "}
              {w.scope}/{w.kind}/{w.topic}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

const REGISTRY: Record<string, PanelComponent> = {
  approvals: ApprovalsPanel,
  token: TokenPanel,
  git: GitPanel,
  memory: MemoryPanel,
};

export const KNOWN_PANEL_IDS = Object.keys(REGISTRY);

/** panel_id → 面板组件；未知 id 返回兜底面板（不抛异常）。 */
export function resolvePanel(panelId: string): PanelComponent {
  return REGISTRY[panelId] ?? FallbackPanel;
}
