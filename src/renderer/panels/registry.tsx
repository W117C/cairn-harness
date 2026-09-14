// 面板注册表（§10.2）：panel_id → 组件。M1 三类：approvals / token / git；M2d memory、M2e plugins、
// M2f sidechat、M3a agents（多 agent 状态）、M3b git 合并控制塔、M4a schedule（定时任务 §12.2.6）。
// 未知 panel_id 落兜底面板，绝不抛异常（与卡片注册表同构）。
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ApprovalCard, DiffCard } from "../cards/registry";
import {
  agentStatusBadge,
  EMPTY_SIDECHAT_USAGE,
  firstPathOfStat,
  HISTORY_STATES,
  mergeTokenProjections,
  skipReasonLabel,
  type AgentColumn,
  type DiffCardProjection,
  type HistoryFilter,
  type MemoryWriteProjection,
  type MergeTowerColumn,
  type TokenByAgentProjection,
  type TokenKindBreakdown,
  type TokenProjection,
} from "../projections";
import type { MemorySnapshot, StateResponse, SidechatPanelSnapshot } from "../../main/ipc-protocol";
import type { ScheduleSnapshot } from "../../main/scheduler";
import type { PluginPanelSnapshot } from "../../agent/plugins";

/** M1 面板三类（§10.2 清单的 M1 里程碑行）+ M2d memory + M2e plugins + M2f sidechat + M3a agents
 *  + M4a schedule。G7（审查）：类型从 main/settings 的 PANEL_IDS 单源派生（type-only 导入，
 *  零运行时 bundle 影响）——新增面板只改 PANEL_IDS 与本注册表，不再手动同步联合类型。 */
import type { PanelId as SettingsPanelId } from "../../main/settings";
export type PanelId = SettingsPanelId;

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
    /** M3b git：合并控制塔列（write worker 合并卡投影）。 */
    mergeTower?: MergeTowerColumn[];
    /** M2d memory：本会话 remember 调用审计投影。 */
    memoryWrites?: MemoryWriteProjection[];
    /** M2e plugins：插件面板快照（缺省由面板自行 getState 拉取；G11：透传时 useEffect 跟随）。 */
    plugins?: PluginPanelSnapshot;
    /** M2f sidechat：辅助对话快照（缺省由面板自行 getState 拉取；G11：透传时 useEffect 跟随）。 */
    sidechat?: SidechatPanelSnapshot;
    /** M3a agents：每 worker 一列（agent 子流事件投影）。 */
    agents?: AgentColumn[];
    /** M3a token：usage 按 agent 分解（§4.4.10，总量 = main + Σworker）。 */
    tokensByAgent?: TokenByAgentProjection;
    /** 全部事件数（面板头展示）。 */
    eventCount?: number;
  };
  /** 面板动作（compact / agent_cancel 等），宿主接线。 */
  onAction?: (action: string, data?: unknown) => void;
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

/** Token 面板：usage 事件累计 + 压缩计数（D11 多次压缩建议开新会话）。
 *  M2g：按会话 kind 分解（§10.8.4 序 4）——主会话 / 辅助对话（sidechat）分开列，总量 = 各分解之和。
 *  分解是**纯投影**：主会话来自 payload.tokens（事件流订阅），sidechat 来自 getState().sidechat（各自 JSONL 的投影）。 */
export function TokenPanel({ payload, onAction }: PanelProps): ReactElement {
  const base = payload.tokens;
  // G1（审查）：刷新信号改 eventCount——旧实现依赖 payload.tokens 对象身份，而宿主的
  // useMemo 依赖 [state]，state 每 delta 都换新 → 流式期间每批次都触发一次 getState IPC
  //（其余自取快照面板都用 eventCount 防抖）。
  const eventCount = payload.eventCount ?? 0;
  const [side, setSide] = useState<TokenKindBreakdown | null>(null);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const st: StateResponse = await window.agent.getState();
        const ss = st.sidechat?.sessions ?? [];
        const agg = ss.reduce(
          (a, s) => {
            a.inputTokens += s.usage?.inputTokens ?? 0;
            a.outputTokens += s.usage?.outputTokens ?? 0;
            a.usageCount += s.usage?.usageCount ?? 0;
            a.compactionCount += s.usage?.compactionCount ?? 0;
            return a;
          },
          { inputTokens: 0, outputTokens: 0, usageCount: 0, compactionCount: 0 },
        );
        if (alive) {
          setSide({
            kind: "sidechat",
            inputTokens: agg.inputTokens,
            outputTokens: agg.outputTokens,
            totalTokens: agg.inputTokens + agg.outputTokens,
            usageCount: agg.usageCount,
            compactionCount: agg.compactionCount,
          });
        }
      } catch {
        if (alive) setSide(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [eventCount]); // G1：以事件数为刷新信号（不再随 tokens 对象身份逐批触发）
  const t = base ? mergeTokenProjections(base, side ?? EMPTY_SIDECHAT_USAGE) : null;
  const mainKind = t?.byKind.find((k) => k.kind === "main") ?? null;
  const sideKind = t?.byKind.find((k) => k.kind === "sidechat") ?? null;
  return (
    <div className="flex flex-col gap-3 p-3 text-sm" data-m2g-token-panel="">
      {t ? (
        <>
          <div className="flex items-center gap-2">
            <Badge variant="outline">usage × {t.usageCount}</Badge>
            <span className="text-muted-foreground">事件流投影 · 按会话 kind 分解</span>
          </div>
          <div>
            输入 <span className="font-mono">{t.inputTokens}</span> · 输出{" "}
            <span className="font-mono">{t.outputTokens}</span> · 合计{" "}
            <span className="font-mono font-semibold">{t.totalTokens}</span> tokens
          </div>
          <div className="rounded-md border px-3 py-2 text-xs" data-m2g-token-bykind="">
            <div className="mb-1 font-medium text-muted-foreground">按会话分解</div>
            <div className="flex items-center justify-between gap-2" data-m2g-token-kind="main">
              <span>主会话</span>
              <span className="font-mono">
                {mainKind?.inputTokens ?? 0} in / {mainKind?.outputTokens ?? 0} out · 合计{" "}
                <span className="font-semibold">{mainKind?.totalTokens ?? 0}</span>
              </span>
            </div>
            <div className="flex items-center justify-between gap-2" data-m2g-token-kind="sidechat">
              <span>辅助对话（sidechat）</span>
              <span className="font-mono">
                {sideKind?.inputTokens ?? 0} in / {sideKind?.outputTokens ?? 0} out · 合计{" "}
                <span className="font-semibold">{sideKind?.totalTokens ?? 0}</span>
              </span>
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              旁路会话用量单独归因，不并入主会话总量（§4.4.10 会话文件分离天然归因）。
            </div>
          </div>
          <div className="text-xs text-muted-foreground">
            压缩次数：主会话 {mainKind?.compactionCount ?? 0} · 辅助对话 {sideKind?.compactionCount ?? 0}
          </div>
          {payload.tokensByAgent && payload.tokensByAgent.agents.length > 0 && (
            <div className="rounded-md border px-3 py-2 text-xs" data-m3a-token-byagent="">
              <div className="mb-1 font-medium text-muted-foreground">按 agent 分解（§4.4.10）</div>
              {payload.tokensByAgent.agents.map((a) => (
                <div key={a.agent_id} className="flex items-center justify-between gap-2" data-m3a-token-agent={a.agent_id}>
                  <span className="font-mono">{a.agent_id}</span>
                  <span className="font-mono">
                    {a.inputTokens} in / {a.outputTokens} out · 合计 <span className="font-semibold">{a.totalTokens}</span>
                  </span>
                </div>
              ))}
              <div className="mt-1 flex items-center justify-between gap-2 border-t pt-1">
                <span>会话总量（main + Σworker）</span>
                <span className="font-mono font-semibold">{payload.tokensByAgent.totalTokens}</span>
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                worker usage 独立归因，不并入主 loop 分解；总量 = 主 loop + 全部 worker 合计。
              </div>
            </div>
          )}
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

/** M3b 合并控制塔合并卡（§4.3/§4.4.5/§4.5）：分支/基线 + diff 卡（行级评论，复用扩展版 DiffCard）
 *  + 安全 findings（gate 红标 + findings 转评论）+ 批准合并/拒绝（可选留分支）/冲突人工介入。
 *  数据 100% 来自事件流投影（payload.mergeTower）。 */
function MergeTowerCard({ col, onAction }: { col: MergeTowerColumn; onAction?: PanelProps["onAction"] }): ReactElement {
  const canAct = typeof window !== "undefined" && typeof window.agent?.cardAction === "function";
  const latest = col.diffs.length > 0 ? col.diffs[col.diffs.length - 1]! : null;
  const gateRed = col.report !== null && col.report.mode === "gate" && (col.report.summary.critical > 0 || col.report.summary.high > 0);
  const decided = col.outcome === "merged" || col.outcome === "rejected" || col.outcome === "cleaned";
  return (
    <Card size="sm" data-m3b-merge-card={col.agent_id} className={gateRed && !decided ? "border-red-500/60" : undefined}>
      <CardHeader className="border-b px-3 py-2">
        <CardTitle className="flex flex-wrap items-center gap-1.5 font-mono text-xs">
          🌿 {col.branch}
          <Badge variant="outline" className="font-mono text-[10px]">{col.agent_id}</Badge>
          <Badge variant="secondary" className="font-mono text-[10px]">{col.status}</Badge>
          {col.outcome === "merged" && <Badge variant="default">已合并</Badge>}
          {col.outcome === "rejected" && <Badge variant="outline">已拒绝</Badge>}
          {col.outcome === "cleaned" && <Badge variant="outline">已清理</Badge>}
          {col.outcome === "conflict" && <Badge variant="destructive">冲突·人工介入</Badge>}
          {gateRed && !decided && <Badge variant="destructive" data-m3b-gate-red="">gate：critical|high</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 px-3 pb-3 pt-2 text-xs">
        <div className="font-mono text-[11px] text-muted-foreground">
          base {col.base_commit.slice(0, 12)} · worktree {col.worktree}
          {col.task !== "" && <span className="block truncate">task：{col.task}</span>}
        </div>
        {col.outcomeText !== "" && (
          <div
            className={
              "whitespace-pre-wrap rounded px-2 py-1 font-mono text-[11px] " +
              (col.outcome === "conflict" || col.outcome === "gate-confirm"
                ? "border border-red-500/40 bg-red-500/5 text-red-700 dark:text-red-400"
                : "bg-muted/40 text-muted-foreground")
            }
            data-m3b-outcome={col.agent_id}
          >
            {col.outcomeText}
          </div>
        )}
        {latest && (
          <div data-m3b-diff={col.agent_id}>
            <div className="mb-1 flex items-center gap-2 text-muted-foreground">
              <Badge variant="outline">diff v{String(latest.version)}</Badge>
              <span className="font-mono text-[10px]">{latest.stat === "" ? "（无改动）" : latest.stat.split("\n").slice(-1)[0]}</span>
            </div>
            <DiffCard
              payload={{
                type: "diff",
                path: firstPathOfStat(latest.stat) ?? col.worktree,
                stat: latest.stat,
                patch: latest.patch,
                agent_id: col.agent_id,
                ...(decided ? {} : { commentable: true }),
                comments: col.comments,
              }}
              onAction={(action, data) => {
                if (action === "diff_line_comment") {
                  const d = data as { agent_id: string; path: string; line: number; body: string };
                  onAction?.("comment", { agentId: d.agent_id, path: d.path, line: d.line, body: d.body });
                }
              }}
            />
          </div>
        )}
        {col.report && (
          <div className="rounded border px-2 py-1" data-m3b-findings={col.agent_id}>
            <div className="mb-1 flex flex-wrap items-center gap-1.5">
              <Badge variant={col.report.summary.total > 0 ? "destructive" : "secondary"}>
                安全快筛 {String(col.report.summary.total)} 条
              </Badge>
              <Badge variant="outline">{col.report.mode}</Badge>
              {col.report.llmReviewed && <Badge variant="outline">LLM 已审</Badge>}
            </div>
            {col.report.findings.slice(0, 6).map((f, i) => (
              <div key={String(i)} className="flex items-start justify-between gap-2 py-0.5 font-mono text-[11px]" data-m3b-finding={String(i)}>
                <span className="min-w-0 flex-1">
                  <Badge variant={f.severity === "critical" || f.severity === "high" ? "destructive" : "secondary"}>{f.severity}</Badge>{" "}
                  {f.path}:{String(f.line)} {f.title}
                </span>
                {!decided && onAction && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-5 px-1 text-[10px]"
                    title="转评论回传修复（diff_comment → worker 子流）"
                    data-m3b-finding-comment={String(i)}
                    onClick={() =>
                      onAction("comment", {
                        agentId: col.agent_id,
                        path: f.path,
                        line: f.line,
                        body: "[安全] " + f.title + "：" + f.description + (f.suggestion !== undefined ? "（建议：" + f.suggestion + "）" : ""),
                      })
                    }
                  >
                    转评论
                  </Button>
                )}
              </div>
            ))}
            {col.report.summary.total === 0 && <div className="text-muted-foreground">未发现可疑项。</div>}
          </div>
        )}
        {col.comments.length > 0 && (
          <div className="rounded bg-muted/40 px-2 py-1 font-mono text-[11px]" data-m3b-comments={col.agent_id}>
            {col.comments.map((c, i) => (
              <div key={String(i)} className="truncate" data-m3b-comment={String(i)}>
                💬 {c.path}:{String(c.line)} {c.body}
              </div>
            ))}
          </div>
        )}
        {!decided && onAction && (
          <div className="flex flex-wrap items-center gap-2">
            {gateRed ? (
              <>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={!canAct}
                  title="gate 模式：存在 critical|high findings，第一次点击仅记录红标确认请求"
                  data-m3b-merge-confirm={col.agent_id}
                  onClick={() => onAction("merge", { agentId: col.agent_id })}
                >
                  请求合并（红标）
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={!canAct}
                  title="仍要合并（二次确认：跳过 gate 红标，合并权永远在人）"
                  data-m3b-merge-force={col.agent_id}
                  onClick={() => onAction("merge", { agentId: col.agent_id, force: true })}
                >
                  仍要合并
                </Button>
              </>
            ) : (
              <Button size="sm" disabled={!canAct} data-m3b-merge-approve={col.agent_id} onClick={() => onAction("merge", { agentId: col.agent_id })}>
                批准合并（--no-ff）
              </Button>
            )}
            <Button size="sm" variant="outline" disabled={!canAct} data-m3b-reject={col.agent_id} onClick={() => onAction("reject", { agentId: col.agent_id })}>
              拒绝并清理
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!canAct}
              data-m3b-reject-keep={col.agent_id}
              onClick={() => onAction("reject", { agentId: col.agent_id, keepBranch: true })}
            >
              拒绝（留分支）
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// G10（审查 P3）：firstPathOfStat 抽到 projections.ts（cards 侧同款实现共用一份）。

/** M3b 孤儿 worktree 列表（§4.4.9：只列不自动删；清理 = 用户显式动作）。快照经 getState 现算（FS 态，
 *  与 memory/plugins 同族——非事件流数据，不落第二事实源）。 */
function OrphanWorktrees({ eventCount, onAction }: { eventCount?: number; onAction?: PanelProps["onAction"] }): ReactElement {
  const [orphans, setOrphans] = useState<string[]>([]);
  const reload = useCallback(async () => {
    try {
      const st: StateResponse = await window.agent.getState();
      setOrphans(st.worktree?.orphans ?? []);
    } catch {
      setOrphans([]);
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(() => { void reload(); }, 500);
    return () => clearTimeout(t);
  }, [reload, eventCount]);
  if (orphans.length === 0) return (<></>);
  return (
    <Card size="sm" data-m3b-orphans="">
      <CardHeader className="px-3 py-2">
        <CardTitle className="text-sm">孤儿 worktree（可清理 · 不自动删）</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 px-3 pb-2 text-xs">
        {orphans.map((n) => (
          <div key={n} className="flex items-center justify-between gap-2 font-mono" data-m3b-orphan={n}>
            <span>.agents/wt-{n}</span>
            <Button size="sm" variant="outline" className="h-6" data-m3b-orphan-clean={n} onClick={() => onAction?.("orphan_clean", { name: n })}>
              清理
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/** Git 面板：diff 卡列表（主会话写动作聚合）+ M3b 合并控制塔（write worker 合并卡）+ 孤儿列表。 */
export function GitPanel({ payload, onAction }: PanelProps): ReactElement {
  const diffs = payload.diffs ?? [];
  const tower = payload.mergeTower ?? [];
  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-center gap-2">
        <Badge variant="outline">diff × {diffs.length}</Badge>
        {tower.length > 0 && <Badge variant="outline">合并塔 × {tower.length}</Badge>}
        <span className="text-xs text-muted-foreground">写动作聚合 · 合并唯一出口（§4.3）</span>
      </div>
      {diffs.length === 0 && tower.length === 0 && <div className="text-sm text-muted-foreground">本会话还没有写动作。</div>}
      {tower.map((col) => (
        <MergeTowerCard key={col.agent_id} col={col} onAction={onAction} />
      ))}
      <OrphanWorktrees eventCount={payload.eventCount} onAction={onAction} />
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

/** M2f 辅助对话面板：只读旁路会话（独立 JSONL）+ 消息投影 + 提升记录 + 提升入口。
 *  两个入口：①每会话的「提升到主会话」按钮 ②输入 `/promote #<事件号>`。
 *  M2g：preload 已接线（六条通道全部桥接），按钮常态可用；can* 守卫仅用于 headless SSR 兜底。 */
function SidechatPanel({ payload }: PanelProps): ReactElement {
  const [snap, setSnap] = useState<SidechatPanelSnapshot | null>(payload.sidechat ?? null);
  const [loadFailed, setLoadFailed] = useState(false); // G3（审查）：请求失败 ≠ 数据为空
  const [active, setActive] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const canAsk = typeof window !== "undefined" && typeof window.agent?.sidechatAsk === "function";
  const canCreate = typeof window !== "undefined" && typeof window.agent?.sidechatCreate === "function";
  const canPromote = typeof window !== "undefined" && typeof window.agent?.sidechatPromote === "function";
  const reload = useCallback(async () => {
    try {
      const st: StateResponse = await window.agent.getState();
      setSnap(st.sidechat ?? null);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
      setSnap(null);
    }
  }, []);
  // M2g 收口修复：面板在挂载期也可能落后于外部变化（run 新建旁路会话 / promote 等）——
  // 以事件数为刷新信号、防抖自取 getState 快照（纯投影，零私有状态，不逐事件放大请求）。
  useEffect(() => {
    const t = setTimeout(() => { void reload(); }, 500);
    return () => clearTimeout(t);
  }, [reload, payload.eventCount]);
  // G11（审查）：props→state 初始化不随宿主更新——透传时经 useEffect 跟随。
  useEffect(() => {
    if (payload.sidechat !== undefined) setSnap(payload.sidechat);
  }, [payload.sidechat]);
  useEffect(() => {
    if (active === null && snap && snap.sessions.length > 0) setActive(snap.sessions[0]?.id ?? null);
  }, [snap, active]);

  const cur = snap?.sessions.find((s) => s.id === active) ?? null;

  const promote = async (sourceEventIds: number[]): Promise<void> => {
    if (!canPromote || !snap?.parentSessionId || !active || sourceEventIds.length === 0) return;
    setBusy(true);
    setNote(null);
    try {
      const r = await window.agent.sidechatPromote?.({
        sidechatId: active,
        parentSessionId: snap.parentSessionId,
        sourceEventIds,
      });
      setNote(r?.ok ? "已提升进主会话（+1 user_message，带 origin）" : "提升失败：" + (r?.error ?? "未知"));
      await reload();
    } catch (err) {
      // G2（审查）：IPC reject 不再静默（busy 只复位，用户看不到错误）
      setNote("提升调用失败：" + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  };

  const send = async (): Promise<void> => {
    const text = input.trim();
    if (text === "" || busy || !active) return;
    setInput("");
    setBusy(true);
    setNote(null);
    try {
      if (text.startsWith("/promote")) {
        const ids = [...text.matchAll(/#(\d+)/g)].map((m) => Number(m[1]));
        if (ids.length === 0) {
          // 缺省 = 提升该会话最后一条助手消息
          const last = [...(cur?.messages ?? [])].reverse().find((m) => m.role === "assistant");
          if (last) await promote([last.eventId]);
          else setNote("/promote 需要 #事件号，或该会话至少有一条助手消息");
        } else {
          await promote(ids);
        }
      } else {
        const r = await window.agent.sidechatAsk?.(active, text, snap?.parentSessionId ?? undefined);
        setNote(r?.ok ? null : "提问失败：" + (r?.error ?? "未知"));
        await reload();
      }
    } catch (err) {
      // G2（审查）：IPC reject 不再静默
      setNote("发送失败：" + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 p-3" data-m2f-sidechat-panel="">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge variant="outline">辅助对话（只读旁路）</Badge>
        <span className="text-muted-foreground">独立会话 · 写向工具已摘除 · 不打扰主会话</span>
        <Button
          size="sm"
          variant="outline"
          disabled={!canCreate || !snap?.parentSessionId || busy}
          title={snap?.parentSessionId ? "新建旁路会话（独立 JSONL，不打扰主会话）" : "未打开主会话"}
          data-m2g-sidechat-new=""
          onClick={() => {
            void (async () => {
              if (!snap?.parentSessionId) return;
              const r = await window.agent.sidechatCreate?.(snap.parentSessionId);
              if (r) setActive(r.id);
              await reload();
            })();
          }}
        >
          新建旁路会话
        </Button>
      </div>
      {(snap?.sessions.length ?? 0) === 0 && !loadFailed && <div className="text-sm text-muted-foreground">（暂无旁路会话）</div>}
      {loadFailed && <div className="text-sm text-red-500">快照获取失败（主进程不可达）——不是“暂无会话”</div>}
      <div className="flex flex-wrap gap-1">
        {snap?.sessions.map((s) => (
          <Button
            key={s.id}
            size="sm"
            variant={s.id === active ? "default" : "outline"}
            data-m2f-sidechat-tab={s.id}
            onClick={() => setActive(s.id)}
          >
            {s.id}
            <span className="ml-1 text-[10px] opacity-70">{s.lines}</span>
          </Button>
        ))}
      </div>
      {cur && (
        <Card data-m2f-sidechat-session={cur.id}>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
              {cur.id}
              <Badge variant="secondary">事件 × {cur.lines}</Badge>
              <span className="font-mono text-[11px] text-muted-foreground">parent: {cur.parentId ?? "?"}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-xs">
            {cur.messages.map((m) => (
              <div key={String(m.eventId)} className="flex gap-2" data-m2f-sidechat-msg={String(m.eventId)}>
                <Badge variant={m.role === "user" ? "default" : "outline"}>#{m.eventId} {m.role}</Badge>
                <span className="min-w-0 flex-1 whitespace-pre-wrap">{m.text}</span>
                {m.role === "assistant" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!canPromote || busy}
                    title="把该条提升进主会话（主流 +1 user_message + origin，可跳回源消息）"
                    data-m2g-sidechat-promote-btn=""
                    onClick={() => void promote([m.eventId])}
                  >
                    提升
                  </Button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
      <div className="flex items-end gap-2">
        <input
          className="min-w-0 flex-1 rounded border bg-background px-2 py-1 text-xs"
          value={input}
          disabled={!canAsk || !active || busy}
          placeholder={active ? "旁路提问…（/promote #12 提升结论）" : "先在上方新建一个旁路会话"}
          data-m2g-sidechat-input=""
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <Button size="sm" disabled={!canAsk || !active || busy || input.trim() === ""} data-m2f-sidechat-send="" onClick={() => void send()}>
          发送
        </Button>
      </div>
      {note !== null && <div className="text-xs text-muted-foreground" data-m2f-sidechat-note="">{note}</div>}
      {(snap?.promoted.length ?? 0) > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">已提升进主会话（origin 反向投影）</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-xs">
            {snap?.promoted.map((p) => (
              <div key={String(p.eventId)} className="font-mono" data-m2f-promoted={String(p.eventId)}>
                <Badge variant="outline">#{p.eventId}</Badge> ← {p.sessionId} 源事件{" "}
                {p.sourceEventIds.map((n) => "#" + String(n)).join("、")}
                {p.note !== undefined ? " · " + p.note : ""}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
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
  const [loadFailed, setLoadFailed] = useState(false); // G3（审查）：请求失败 ≠ 数据为空
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // SSR 安全：headless 渲染无 window（面板注册表规约——渲染绝不抛）
  const canDelete = typeof window !== "undefined" && typeof window.agent?.deleteMemory === "function";
  const reloadMemory = useCallback(async () => {
    try {
      const st = await window.agent.getState();
      setSnap(st.memory ?? null);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true); // G3（审查）：失败 ≠ 空
      setSnap(null);
    }
  }, []);
  // M2g 收口修复：同 SidechatPanel——挂载期外部变化（agent 沉淀新记忆 / 用户他面删除）也须可见。
  useEffect(() => {
    const t = setTimeout(() => { void reloadMemory(); }, 500);
    return () => clearTimeout(t);
  }, [reloadMemory, payload.eventCount]);
  // G2（审查）：IPC reject 不再静默（try/finally 只复位 busy，用户看不到错误）
  const del = async (scope: "project" | "global", topic: string): Promise<void> => {
    if (!window.agent.deleteMemory) return;
    setBusy(true);
    setNote(null);
    try {
      await window.agent.deleteMemory(scope, topic);
      await reloadMemory();
    } catch (err) {
      setNote("删除失败：" + (err instanceof Error ? err.message : String(err)));
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
                title="删除该记忆（仅用户可删，模型无删除权）"
                data-m2g-memory-delete-btn=""
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
      {loadFailed && <div className="text-sm text-red-500">快照获取失败（主进程不可达）——不是“无记忆”</div>}
      {note && <div className="text-sm text-red-500">{note}</div>}
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
  const [loadFailed, setLoadFailed] = useState(false); // G3（审查）：请求失败 ≠ 数据为空
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const canDecide = typeof window !== "undefined" && typeof window.agent?.pluginDecide === "function";
  const reload = useCallback(async () => {
    try {
      const st: StateResponse = await window.agent.getState();
      setSnap(st.plugins ?? null);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true); // G3（审查）：失败 ≠ 空
      setSnap(null);
    }
  }, []);
  // M2g 收口修复：同 SidechatPanel——挂载期外部变化（agent 沉淀新记忆 / 用户他面删除）也须可见。
  useEffect(() => {
    const t = setTimeout(() => { void reload(); }, 500);
    return () => clearTimeout(t);
  }, [reload, payload.eventCount]);
  // G11（审查）：props→state 初始化不随宿主更新——透传时经 useEffect 跟随。
  useEffect(() => {
    if (payload.plugins !== undefined) setSnap(payload.plugins);
  }, [payload.plugins]);
  // G2（审查）：IPC reject 不再静默
  const decide = async (name: string, trusted: boolean): Promise<void> => {
    if (!window.agent.pluginDecide) return;
    setBusy(true);
    setNote(null);
    try {
      await window.agent.pluginDecide(name, trusted);
      await reload();
    } catch (err) {
      setNote("决议失败：" + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  };
  if (!snap) {
    if (loadFailed) return (<div className="p-3 text-sm text-red-500">插件快照获取失败（主进程不可达）——不是“未装配 PluginRuntime”。</div>);
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
                  title="信任该插件（hook / MCP / LSP 随即激活）"
                  data-m2g-plugin-trust-btn=""
                  onClick={() => void decide(pl.name, true)}>批准</Button>
                <Button size="sm" variant="outline" disabled={!canDecide || busy}
                  title="拒绝该插件（不激活，只列出）"
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
            {snap.looseSkills.map((s) => (
              <div key={s.name} className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono">{s.invoke}</span>
                  {trustBadge(s.trust)}
                </div>
                {/* 审查 S2-12（任务 4.6）：pending 的散装 skill 过去只列出、无出口（trustDecide
                    认不到名字）=> 与插件同款批准/拒绝按钮，复用同一 decide 闭包与既有禁用态。 */}
                {s.trust === "pending" && (
                  <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-2 py-1.5">
                    <span className="text-amber-700 dark:text-amber-400">首次加载：信任后才进路由清单（description 直进 system prompt）。</span>
                    <Button size="sm" variant="default" disabled={!canDecide || busy} title="信任该 skill（进路由清单）"
                      data-m2g-loose-trust-btn="" onClick={() => void decide(s.name, true)}>批准</Button>
                    <Button size="sm" variant="outline" disabled={!canDecide || busy} title="拒绝该 skill（不进路由清单）"
                      onClick={() => void decide(s.name, false)}>拒绝</Button>
                  </div>
                )}
                {s.description !== "" && <div className="text-muted-foreground">{s.description}</div>}
              </div>
            ))}
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

/** M3a agents 面板（§10.2 / §4.4.8）：每 worker 一列 = 状态徽标 + 当前动作/子流最近事件 +
 *  cost_so_far（usage 投影）+ 时长 + 血缘分组（spawn@#事件号）+ 待批徽标 + 取消/查看报告动作。
 *  数据 100% 来自 agent 子流事件投影（payload.agents），零事件流外私有状态（§3.1 判据）。 */
function statusBadge(status: AgentColumn["status"]): ReactElement {
  // G10（审查）：状态→徽标映射来自 projections 的唯一实现（agent-card 同源，防两份漂移）。
  const b = agentStatusBadge(status);
  return <Badge variant={b.variant}>{b.label}</Badge>;
}

export function AgentsPanel({ payload, onAction }: PanelProps): ReactElement {
  const agents = payload.agents ?? [];
  const active = agents.filter((a) => a.status === "running" || a.status === "waiting_approval" || a.status === "waiting_input").length;
  const pending = agents.filter((a) => a.pendingApproval !== null).length;
  const canCancel = typeof window !== "undefined" && typeof window.agent?.cardAction === "function";
  // 血缘分组树（parent_event_id → 组）：同一次派生的兄弟 worker 折进同组（M3a 深度恒 1，组 = 单父）
  const groups = new Map<number, AgentColumn[]>();
  for (const a of agents) {
    const list = groups.get(a.parent_event_id) ?? [];
    list.push(a);
    groups.set(a.parent_event_id, list);
  }
  return (
    <div className="space-y-2 p-3" data-m3a-agents-panel="">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge variant={active > 0 ? "default" : "outline"}>活跃 {active}</Badge>
        {pending > 0 && <Badge variant="destructive">待批 {pending}</Badge>}
        <span className="text-muted-foreground">agent 子流事件投影 · 零私有状态</span>
      </div>
      {agents.length === 0 && <div className="text-sm text-muted-foreground">（本会话还没有 worker）</div>}
      {[...groups.entries()].map(([parentEventId, cols]) => (
        <div key={String(parentEventId)} className="space-y-2 border-l-2 pl-2" data-m3a-agent-group={String(parentEventId)}>
          <div className="font-mono text-[11px] text-muted-foreground">spawn@#{String(parentEventId)}</div>
          {cols.map((a) => (
            <Card key={a.agent_id} size="sm" data-m3a-agent={a.agent_id}>
              <CardHeader className="px-3 py-2">
                <CardTitle className="flex flex-wrap items-center gap-1.5 text-sm">
                  <span className="font-mono">{a.agent_id}</span>
                  <Badge variant="outline">{a.mode}</Badge>
                  {statusBadge(a.status)}
                  <Badge variant="outline" className="font-mono text-[10px]">{a.permission_mode}</Badge>
                  {a.durationMs !== null && (
                    <span className="font-mono text-[10px] text-muted-foreground">{(a.durationMs / 1000).toFixed(1)}s</span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 px-3 pb-2 text-xs">
                {a.task !== "" && <div className="line-clamp-2 text-muted-foreground">{a.task}</div>}
                {a.tier_warning && (
                  <div className="rounded border border-amber-500/40 bg-amber-500/5 px-2 py-1 text-amber-700 dark:text-amber-400" data-m3a-tier-warning="">
                    ⚠ {a.tier_warning}
                  </div>
                )}
                {a.pendingApproval && (
                  <div className="flex items-center gap-1.5 rounded border border-amber-500/40 bg-amber-500/5 px-2 py-1" data-m3a-agent-pending={a.pendingApproval.id}>
                    <Badge variant="destructive">待批</Badge>
                    <span className="font-mono">{a.pendingApproval.tool}</span>
                    <span className="text-muted-foreground">risk: {a.pendingApproval.risk}</span>
                  </div>
                )}
                {a.reason && <div className="text-muted-foreground">原因：{a.reason}</div>}
                {a.recent.length > 0 && (
                  <div className="space-y-0.5 font-mono text-[11px] text-muted-foreground" data-m3a-agent-recent={a.agent_id}>
                    {a.recent.map((r, i) => (
                      <div key={String(i)} className="truncate">{r}</div>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  <span data-m3a-agent-cost={a.agent_id}>
                    cost_so_far: {a.usage.inputTokens} in / {a.usage.outputTokens} out
                  </span>
                  {Object.keys(a.toolStats).length > 0 && (
                    <span className="font-mono">
                      {Object.entries(a.toolStats).map(([k, v]) => k + "×" + String(v)).join(" ")}
                    </span>
                  )}
                </div>
                {a.report && (
                  <details data-m3a-agent-report={a.agent_id}>
                    <summary className="cursor-pointer text-muted-foreground">查看报告</summary>
                    <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-2 font-mono text-[11px]">{a.report}</pre>
                  </details>
                )}
                {(a.status === "running" || a.status === "waiting_approval" || a.status === "waiting_input") && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!canCancel}
                    title="取消该 worker（AbortController 树：单 worker abort 只中止该 worker）"
                    data-m3a-agent-cancel={a.agent_id}
                    onClick={() => onAction?.("agent_cancel", { agentId: a.agent_id })}
                  >
                    取消
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      ))}
    </div>
  );
}

/** M4a 定时任务面板（§12.2.6）：任务列表（名称/kind/下次触发/上次状态/enabled 开关）
 *  + 创建表单（kind 联动字段、时区带偏移预览、权限档、catchUp）+ 运行历史（六态筛选；skipped hover 原因）。
 *  数据 = getState().schedule 快照（journal/会话/内存 inflight 纯投影，零私有状态）。 */
type FormKind = "once" | "interval" | "daily" | "weekly";
const FORM_KINDS: FormKind[] = ["once", "interval", "daily", "weekly"];
const TIERS = ["read-only", "workspace-write", "danger-full-access"] as const;

function SchedulePanel({ payload }: PanelProps): ReactElement {
  const [snap, setSnap] = useState<ScheduleSnapshot | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [kind, setKind] = useState<FormKind>("daily");
  const [at, setAt] = useState("");
  const [everyMinutes, setEveryMinutes] = useState("30");
  const [time, setTime] = useState("09:00");
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [tier, setTier] = useState<(typeof TIERS)[number]>("read-only");
  const [catchUp, setCatchUp] = useState<"latest" | "skip">("latest");
  const [tz, setTz] = useState<string>(() => {
    if (typeof window === "undefined") return "UTC";
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return "UTC"; }
  });
  const canSchedule = typeof window !== "undefined" && typeof window.agent?.scheduleUpsert === "function";
  const reload = useCallback(async () => {
    try {
      const st: StateResponse = await window.agent.getState();
      setSnap(st.schedule ?? null);
    } catch {
      setSnap(null);
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(() => { void reload(); }, 300);
    return () => clearTimeout(t);
  }, [reload, payload.eventCount]);

  const tzOffset = (() => {
    try {
      const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" }).formatToParts(new Date());
      const n = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
      return n === "" || n === "GMT" ? "UTC+00:00" : n.replace("GMT", "UTC");
    } catch {
      return "（IANA 非法，保存会被拒绝）";
    }
  })();

  const buildDef = (): Record<string, unknown> => {
    const schedule: Record<string, unknown> =
      kind === "once" ? { kind, at } :
      kind === "interval" ? { kind, everyMinutes: Number(everyMinutes) } :
      kind === "weekly" ? { kind, weekdays, time } :
      { kind, time };
    return {
      name: name.trim(),
      prompt,
      schedule,
      timeZone: tz.trim(),
      permissionTier: tier,
      catchUp,
      enabled: true,
    };
  };
  const submit = async (): Promise<void> => {
    setNote(null);
    try {
      const r = await window.agent.scheduleUpsert(buildDef());
      setNote(r.ok ? "已创建任务（下次触发见列表）" : "创建失败：" + (r.error ?? "未知"));
      if (r.ok) {
        setFormOpen(false);
        setName(""); setPrompt(""); setAt(""); setEveryMinutes("30"); setTime("09:00"); setWeekdays([1, 2, 3, 4, 5]);
        await reload();
      }
    } catch (err) {
      setNote("创建失败：" + (err instanceof Error ? err.message : String(err)));
    }
  };
  const toggleEnabled = async (t: ScheduleSnapshot["tasks"][number]): Promise<void> => {
    // 已存在任务的 enabled 开关走数据模型校验（form 白名单只限新建表单/agent 工具面）
    const r = await window.agent.scheduleUpsert({ ...t, enabled: !t.enabled, updatedAt: undefined, nextRunAt: undefined }, false);
    setNote(r.ok ? null : "开关失败：" + (r.error ?? "未知"));
    await reload();
  };
  const runNow = async (t: ScheduleSnapshot["tasks"][number]): Promise<void> => {
    const r = await window.agent.scheduleRunNow(t.id);
    setNote(r.ok ? "已手动触发（走准入管线）" : "触发被拒：" + (r.error ?? "未知"));
    await reload();
  };
  const del = async (t: ScheduleSnapshot["tasks"][number]): Promise<void> => {
    const r = await window.agent.scheduleDelete(t.id);
    setNote(r.ok ? "已删除" : "删除失败：" + (r.error ?? "未知"));
    await reload();
  };
  const history = (snap?.history ?? []).filter((h) => filter === "all" || h.state === filter);
  const lastStateOf = (taskId: string): string | null => {
    const h = (snap?.history ?? []).find((x) => x.task_id === taskId);
    return h ? h.state + (h.decision === "skipped" && h.reason ? "（" + skipReasonLabel(h.reason) + "）" : "") : null;
  };
  return (
    <div className="space-y-2 p-3" data-m4a-schedule-panel="">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge variant="outline">定时任务 × {snap?.tasks.length ?? 0}</Badge>
        <Badge variant={(snap?.running ?? 0) > 0 ? "default" : "secondary"} data-m4a-running-count="">
          运行中 {snap?.running ?? 0} / 上限 {snap?.cap ?? 2}（排队 {snap?.queued ?? 0}）
        </Badge>
        {!snap?.startupDone && <Badge variant="outline">启动抖动中（补跑判定未开始）</Badge>}
        <Button size="sm" variant="outline" disabled={!canSchedule} data-m4a-form-toggle="" onClick={() => setFormOpen(!formOpen)}>
          {formOpen ? "收起表单" : "新建任务"}
        </Button>
      </div>
      {note !== null && <div className="rounded bg-muted/40 px-2 py-1 text-xs" data-m4a-note="">{note}</div>}
      {formOpen && (
        <Card size="sm" data-m4a-form="">
          <CardHeader className="px-3 py-2"><CardTitle className="text-sm">新建定时任务（V1 表单：once / interval / daily / weekly）</CardTitle></CardHeader>
          <CardContent className="space-y-2 px-3 pb-3 text-xs" data-m4a-form-body="">
            <div className="flex items-center gap-2">
              <span className="w-16 shrink-0 text-muted-foreground">名称</span>
              <Input className="h-7 flex-1" value={name} data-m4a-f-name="" onChange={(e) => setName(e.target.value)} placeholder="如：每日报表" />
            </div>
            <div className="flex items-start gap-2">
              <span className="w-16 shrink-0 text-muted-foreground">prompt</span>
              <Textarea className="min-h-16 flex-1" value={prompt} data-m4a-f-prompt="" onChange={(e) => setPrompt(e.target.value)} placeholder="自包含任务说明（触发时原样成为新会话首条消息，≤4000 字符）" />
            </div>
            <div className="flex items-center gap-2">
              <span className="w-16 shrink-0 text-muted-foreground">kind</span>
              <Select value={kind} onValueChange={(v) => setKind(v as FormKind)}>
                <SelectTrigger className="h-7 w-36" data-m4a-f-kind=""><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FORM_KINDS.map((k) => (<SelectItem key={k} value={k}>{k}</SelectItem>))}
                </SelectContent>
              </Select>
              {kind === "once" && <Input className="h-7 flex-1" value={at} data-m4a-f-at="" onChange={(e) => setAt(e.target.value)} placeholder="ISO 时刻，如 2026-09-20T09:30:00+08:00" />}
              {kind === "interval" && <Input className="h-7 flex-1" type="number" min={5} value={everyMinutes} data-m4a-f-every="" onChange={(e) => setEveryMinutes(e.target.value)} placeholder="每 N 分钟（≥5）" />}
              {(kind === "daily" || kind === "weekly") && <Input className="h-7 w-28" value={time} data-m4a-f-time="" onChange={(e) => setTime(e.target.value)} placeholder="HH:mm" />}
            </div>
            {kind === "weekly" && (
              <div className="flex flex-wrap items-center gap-2" data-m4a-f-weekdays="">
                <span className="text-muted-foreground">周几</span>
                {["日", "一", "二", "三", "四", "五", "六"].map((label, d) => (
                  <label key={d} className="flex items-center gap-1">
                    <Checkbox
                      checked={weekdays.includes(d)}
                      data-m4a-f-wd={String(d)}
                      onCheckedChange={(v) => setWeekdays(v === true ? [...weekdays, d].sort((a, b) => a - b) : weekdays.filter((x) => x !== d))}
                    />
                    {label}
                  </label>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2">
              <span className="w-16 shrink-0 text-muted-foreground">时区</span>
              <Input className="h-7 flex-1" value={tz} data-m4a-f-tz="" onChange={(e) => setTz(e.target.value)} />
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground" data-m4a-tz-offset="">{tzOffset}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-16 shrink-0 text-muted-foreground">权限档</span>
              <Select value={tier} onValueChange={(v) => setTier(v as (typeof TIERS)[number])}>
                <SelectTrigger className="h-7 w-44" data-m4a-f-tier=""><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TIERS.map((t) => (<SelectItem key={t} value={t}>{t}</SelectItem>))}
                </SelectContent>
              </Select>
              <span className="w-12 shrink-0 text-muted-foreground">catchUp</span>
              <Select value={catchUp} onValueChange={(v) => setCatchUp(v as "latest" | "skip")}>
                <SelectTrigger className="h-7 w-28" data-m4a-f-catchup=""><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="latest">latest（补最近一次）</SelectItem>
                  <SelectItem value="skip">skip（不补跑）</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {tier !== "read-only" && (
              <div className="rounded border border-red-500/40 bg-red-500/5 px-2 py-1 text-red-700 dark:text-red-400" data-m4a-unattended-red="">
                ⚠ 将无人值守执行：触发时一切审批请求自动拒绝（fail-closed）；写向操作需自主档允许路径。
              </div>
            )}
            <Button size="sm" disabled={!canSchedule || name.trim() === "" || prompt.trim() === ""} data-m4a-form-submit="" onClick={() => void submit()}>
              创建（name 唯一，保存后立即生效）
            </Button>
          </CardContent>
        </Card>
      )}
      {(snap?.tasks.length ?? 0) === 0 && <div className="text-sm text-muted-foreground">（暂无定时任务）</div>}
      {snap?.tasks.map((t) => {
        const last = lastStateOf(t.id);
        return (
          <Card key={t.id} size="sm" data-m4a-task={t.name}>
            <CardHeader className="px-3 py-2">
              <CardTitle className="flex flex-wrap items-center gap-1.5 text-sm">
                ⏰ {t.name}
                <Badge variant="outline" className="font-mono text-[10px]">{t.schedule.kind}</Badge>
                <Badge variant={t.permissionTier === "read-only" ? "secondary" : "destructive"} className="font-mono text-[10px]">{t.permissionTier}</Badge>
                {!t.enabled && <Badge variant="outline">已停用</Badge>}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 px-3 pb-2 text-xs" data-m4a-task-body={t.id}>
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-muted-foreground">下次触发：<span className="font-mono">{t.nextRunAt ?? "无（once 已过 / 停用）"}</span></span>
                {last !== null && <span className="text-muted-foreground">上次状态：<span className="font-mono" data-m4a-last-state={t.id}>{last}</span></span>}
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <label className="flex items-center gap-1">
                  <Checkbox checked={t.enabled} data-m4a-enabled={t.id} onCheckedChange={() => void toggleEnabled(t)} />
                  <span className="text-muted-foreground">enabled</span>
                </label>
                <Button size="sm" variant="outline" className="h-6" disabled={!canSchedule} data-m4a-run-now={t.id} onClick={() => void runNow(t)}>立即触发</Button>
                <Button size="sm" variant="ghost" className="h-6 text-red-600" disabled={!canSchedule} data-m4a-delete={t.id} onClick={() => void del(t)}>删除</Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
      <Card size="sm" data-m4a-history="">
        <CardHeader className="px-3 py-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            运行历史（journal 投影）
            <Select value={filter} onValueChange={(v) => setFilter(v as HistoryFilter)}>
              <SelectTrigger className="h-6 w-28 text-[11px]" data-m4a-history-filter=""><SelectValue /></SelectTrigger>
              <SelectContent>
                {HISTORY_STATES.map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}
              </SelectContent>
            </Select>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-0.5 px-3 pb-2 text-xs">
          {history.length === 0 && <div className="text-muted-foreground">（暂无调度记录）</div>}
          {history.map((h) => (
            <div
              key={h.occurrence_key}
              className="flex flex-wrap items-center gap-2 font-mono text-[11px]"
              data-m4a-history-row={h.occurrence_key}
              title={h.decision === "skipped" && h.reason ? skipReasonLabel(h.reason) : h.state}
            >
              <Badge
                variant={h.state === "succeeded" ? "default" : h.state === "failed" || h.state === "skipped" ? "destructive" : "secondary"}
                className="font-mono text-[10px]"
              >
                {h.state}
              </Badge>
              <span>{h.task_name}</span>
              <span className="text-muted-foreground">{h.due_at}</span>
              {h.decision === "catchup" && <Badge variant="outline" className="text-[10px]">补跑</Badge>}
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
  plugins: PluginsPanel,
  sidechat: SidechatPanel, // M2f：辅助对话（只读旁路）
  agents: AgentsPanel, // M3a：多 agent 状态（每 worker 一列）
  schedule: SchedulePanel, // M4a：定时任务（列表/表单/历史，§12.2.6）
};

export const KNOWN_PANEL_IDS = Object.keys(REGISTRY);

/** panel_id → 面板组件；未知 id 返回兜底面板（不抛异常）。 */
export function resolvePanel(panelId: string): PanelComponent {
  return REGISTRY[panelId] ?? FallbackPanel;
}
