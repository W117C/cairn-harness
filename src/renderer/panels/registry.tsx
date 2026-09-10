// 面板注册表（§10.2）：panel_id → 组件。M1 三类：approvals / token / git；M2d 增 memory。
// 未知 panel_id 落兜底面板，绝不抛异常（与卡片注册表同构）。
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ApprovalCard } from "../cards/registry";
import type { DiffCardProjection, MemoryWriteProjection, TokenProjection } from "../projections";
import type { MemorySnapshot, StateResponse } from "../../main/ipc-protocol";
import type { PluginPanelSnapshot } from "../../agent/plugins";

/** M1 面板三类（§10.2 清单的 M1 里程碑行）+ M2d memory + M2e plugins；与 main/settings 的 PANEL_IDS 同源字符串。 */
export type PanelId = "approvals" | "token" | "git" | "memory" | "plugins";

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
    /** M2e plugins：插件面板快照（缺省由面板自行 getState 拉取）。 */
    plugins?: PluginPanelSnapshot;
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

/** M2e 插件面板：加载清单（三级作用域）+ 信任卡（pending 出卡，决议走 pluginDecide）+ MCP 状态。
 *  快照来源：payload.plugins（宿主透传）或 getState().plugins 自取——全部是投影，无私有状态。
 *  决议通道 optional：preload 白名单本轮未含（deleteMemory 同款先例），未接线时按钮禁用并注明（BLOCKED 备案）。 */
function PluginsPanel({ payload }: PanelProps): ReactElement {
  const [snap, setSnap] = useState<PluginPanelSnapshot | null>(payload.plugins ?? null);
  const [busy, setBusy] = useState(false);
  const canDecide = typeof window !== "undefined" && typeof window.agent?.pluginDecide === "function";
  const reload = useCallback(async () => {
    try {
      const st: StateResponse = await window.agent.getState();
      setSnap(st.plugins ?? null);
    } catch {
      setSnap(null);
    }
  }, []);
  useEffect(() => {
    if (payload.plugins === undefined) void reload();
  }, [payload.plugins, reload]);
  const decide = async (name: string, trusted: boolean): Promise<void> => {
    if (!window.agent.pluginDecide) return;
    setBusy(true);
    try {
      await window.agent.pluginDecide(name, trusted);
      await reload();
    } finally {
      setBusy(false);
    }
  };
  if (!snap) {
    return (<div className="p-3 text-sm text-muted-foreground">插件快照不可用（会话未装配 PluginRuntime）。</div>);
  }
  const trustBadge = (t: string): ReactElement =>
    t === "trusted" ? <Badge variant="default">已信任</Badge> :
    t === "declined" ? <Badge variant="outline">已拒绝</Badge> : <Badge variant="destructive">待信任</Badge>;
  return (
    <div className="space-y-2 p-3" data-m2e-plugin-panel>
      {snap.plugins.map((pl) => (
        <Card key={pl.root} data-m2e-plugin={pl.name}>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
              🧩 {pl.name}
              <Badge variant="outline">{pl.scope}</Badge>
              {trustBadge(pl.trust)}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-xs">
            <div className="font-mono break-all text-muted-foreground">{pl.root}</div>
            <div className="flex flex-wrap gap-1">
              <Badge variant="secondary">skill × {pl.counts.skills}</Badge>
              <Badge variant="secondary">prompt × {pl.counts.commands}</Badge>
              <Badge variant="secondary">agent × {pl.counts.agents}</Badge>
              <Badge variant="secondary">hook × {pl.counts.hooks}</Badge>
              <Badge variant="secondary">mcp × {pl.counts.mcp}</Badge>
              <Badge variant="secondary">lsp × {pl.counts.lsp}</Badge>
            </div>
            {pl.trust === "pending" && (
              <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-2 py-1.5">
                <span className="text-amber-700 dark:text-amber-400">首次加载：信任后 hook / MCP / LSP 才会激活。</span>
                <Button size="sm" variant="default" disabled={!canDecide || busy}
                  title={canDecide ? "信任该插件" : "决议通道待 preload 接线（BLOCKED 备案）"}
                  onClick={() => void decide(pl.name, true)}>批准</Button>
                <Button size="sm" variant="outline" disabled={!canDecide || busy}
                  title={canDecide ? "拒绝该插件（不激活）" : "决议通道待 preload 接线（BLOCKED 备案）"}
                  onClick={() => void decide(pl.name, false)}>拒绝</Button>
              </div>
            )}
            {pl.errors.length > 0 && <div className="text-red-600">错误：{pl.errors.join("；")}</div>}
            {pl.warnings.length > 0 && <div className="text-amber-600">警告：{pl.warnings.join("；")}</div>}
          </CardContent>
        </Card>
      ))}
      {snap.looseSkills.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm">散装 skill（免包装）</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-xs">
            {snap.looseSkills.map((s) => (<div key={s.invoke} className="font-mono">{s.invoke}</div>))}
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader><CardTitle className="text-sm">MCP server 状态（投影）</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-xs">
          {snap.mcpServers.length === 0 && <div className="text-muted-foreground">（无已连接 server）</div>}
          {snap.mcpServers.map((m) => (
            <div key={m.plugin + "/" + m.server} className="font-mono">
              <Badge variant={m.state === "connected" ? "default" : "destructive"}>{m.state}</Badge> {m.plugin}/{m.server} · tools × {m.tools.length}
              {m.tools.length > 0 && <div className="break-all pl-1 text-[11px] text-muted-foreground">{m.tools.join("、")}</div>}
              {m.error && <span className="text-red-600"> {m.error}</span>}
            </div>
          ))}
        </CardContent>
      </Card>
      {(snap.errors.length > 0 || snap.warnings.length > 0) && (
        <Card>
          <CardHeader><CardTitle className="text-sm">加载清单异常</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-xs">
            {snap.errors.map((e, i) => (<div key={"e" + String(i)} className="text-red-600">[{e.plugin}] {e.message}</div>))}
            {snap.warnings.map((w, i) => (<div key={"w" + String(i)} className="text-amber-600">[{w.plugin}] {w.message}</div>))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

const REGISTRY: Record<string, PanelComponent> = {
  approvals: ApprovalsPanel,
  token: TokenPanel,
  git: GitPanel,
  memory: MemoryPanel,
  plugins: PluginsPanel,
};

export const KNOWN_PANEL_IDS = Object.keys(REGISTRY);

/** panel_id → 面板组件；未知 id 返回兜底面板（不抛异常）。 */
export function resolvePanel(panelId: string): PanelComponent {
  return REGISTRY[panelId] ?? FallbackPanel;
}
