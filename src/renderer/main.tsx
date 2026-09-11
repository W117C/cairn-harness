// M1e 三区 shell（§10.1）：左会话列表 / 中对话流（virtuoso 虚拟化）/ 右面板抽屉（单面板制）。
// 面板状态 = 事件流订阅投影（§10.2），布局与档位经 settings IPC 持久化（重启还原）。
import { StrictMode, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { GitBranch, Coins, ShieldCheck, Database, Puzzle, MessageSquarePlus, Settings as SettingsIcon, Plus, Pencil, Trash2, X } from "lucide-react";
import { resolveCard } from "./cards/registry";
import { compactionCardPayload } from "../agent/compaction";
import { securityReportCardPayload } from "../agent/security/scan";
import { Conversation } from "./conversation";
import {
  diffCardsOf,
  memoryWritesOf,
  pendingApprovalsOf,
  planStatusesOf,
  reducer,
  tokenProjectionOf,
  type TimelineItem,
} from "./store";
import { resolvePanel, type PanelId } from "./panels/registry";
import type { AgentEvent, ClarifyAnswerMap } from "../events";
import type {
  AgentApi,
  AskOutcomePayload,
  AskPayload,
  AppSettings,
  PermissionMode,
  RunRequest,
  SessionInfoPayload,
  StateResponse,
} from "../main/ipc-protocol";
import { DARK_QUERY, watchSystemTheme, applyScheme } from "./theme";
import "./styles.css";

declare global {
  interface Window {
    agent: AgentApi;
  }
}

const PANEL_ICONS: Record<PanelId, React.ReactNode> = {
  approvals: <ShieldCheck className="h-4 w-4" />,
  token: <Coins className="h-4 w-4" />,
  git: <GitBranch className="h-4 w-4" />,
  memory: <Database className="h-4 w-4" />,
  plugins: <Puzzle className="h-4 w-4" />,
  sidechat: <MessageSquarePlus className="h-4 w-4" />,
};

function short(v: unknown, max = 260): string {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  if (s === undefined || s === null) return "";
  return s.length > max ? s.slice(0, max) + " …" : s;
}

function UserBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl bg-primary px-3 py-1.5 text-sm whitespace-pre-wrap text-primary-foreground">
        {content}
      </div>
    </div>
  );
}

function AssistantBubble({ content, running }: { content: string; running: boolean }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] rounded-2xl border bg-background px-3 py-1.5 text-sm whitespace-pre-wrap">
        {content}
        {running && <span className="animate-pulse">▍</span>}
      </div>
    </div>
  );
}

function ToolRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex justify-start">
      <div className="flex max-w-[90%] flex-wrap items-center gap-1.5 rounded-lg bg-muted/60 px-2.5 py-1.5 font-mono text-xs">
        {children}
      </div>
    </div>
  );
}

function EventView({
  e,
  onAction,
  planStatuses,
}: {
  e: AgentEvent;
  onAction: (action: string, data: unknown) => void;
  planStatuses: Record<string, "approved" | "rejected">;
}) {
  if (e.type === "clarify_requested") {
    const Card = resolveCard("clarify_form");
    return <Card payload={{ type: "clarify_form", callId: e.callId, questions: e.questions }} onAction={onAction} />;
  }
  if (e.type === "plan_proposed") {
    const Card = resolveCard("plan");
    return (
      <Card
        payload={{ type: "plan", callId: e.callId, plan: e.plan, status: planStatuses[e.callId] ?? "pending" }}
        onAction={onAction}
      />
    );
  }
  if (e.type === "plan_approved") {
    return (
      <Card className="py-3">
        <CardContent className="flex items-center gap-2 px-3 text-sm">
          <Badge variant={e.approved ? "secondary" : "destructive"}>{e.approved ? "方案已批准，写工具解锁" : "方案已拒绝"}</Badge>
        </CardContent>
      </Card>
    );
  }
  if (e.type === "compaction") {
    const CompactionCard = resolveCard("compaction");
    return <CompactionCard payload={compactionCardPayload(e)} />;
  }
  if (e.type === "verify_result") {
    const Card = resolveCard("verify_result");
    return (
      <Card
        payload={{
          type: "verify_result",
          callId: e.callId,
          ok: e.ok,
          attempt: e.attempt,
          maxAttempts: e.maxAttempts,
          results: e.results,
        }}
      />
    );
  }
  if (e.type === "security_report") {
    // M2f：安全报告复用现有 report 卡片类型（不新增卡片类型），不阻断主流程
    const Card = resolveCard("report");
    return <Card payload={securityReportCardPayload(e)} />;
  }
  if (e.type === "user_message") {
    // M2f：带 origin 的 user_message = sidechat 提升结论 → promote 卡（源消息徽标由 origin 反向投影）
    if (e.origin) {
      const PromoteCard = resolveCard("promote");
      return <PromoteCard payload={{ type: "promote", content: e.content, origin: e.origin }} onAction={onAction} />;
    }
    return <UserBubble content={e.content} />;
  }
  if (e.type === "assistant_message") {
    return <AssistantBubble content={e.content} running={false} />;
  }
  if (e.type === "tool_call") {
    return (
      <ToolRow>
        <span className="font-semibold text-foreground">🔧 {e.name}</span>
        <span className="text-muted-foreground">{short(e.args)}</span>
      </ToolRow>
    );
  }
  if (e.type === "tool_result") {
    return (
      <ToolRow>
        <span className={e.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>
          {e.ok ? "✓" : "✗"}
        </span>
        <span className="whitespace-pre-wrap text-muted-foreground">{short(e.output, 400)}</span>
      </ToolRow>
    );
  }
  if (e.type === "usage") {
    const UsageCard = resolveCard("usage_summary");
    return <UsageCard payload={{ type: "usage_summary", inputTokens: e.inputTokens, outputTokens: e.outputTokens }} />;
  }
  return null; // assistant_delta 折叠进流式项；session_meta 不渲染
}

function AskView({
  it,
  onDecide,
}: {
  it: Extract<TimelineItem, { kind: "ask" }>;
  onDecide: (askId: string, approved: boolean, scope?: "once" | "session_kind" | "always") => void;
}) {
  const a = it.a;
  if (it.resolved) {
    const label = it.resolved === "approved" ? "已批准" : it.timedOut ? "已拒绝（60 秒无响应，自动拒绝）" : "已拒绝";
    return (
      <div className="flex justify-start">
        <div className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm">
          <Badge variant={it.resolved === "approved" ? "secondary" : "destructive"}>{label}</Badge>
          <span className="font-mono text-xs text-muted-foreground">{a.tool}</span>
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge className="border-amber-500/60 bg-amber-500/15 text-amber-700 dark:text-amber-400" variant="outline">
          待审批
        </Badge>
        {a.risk !== undefined && a.risk !== "none" && <Badge variant="outline">risk: {a.risk}</Badge>}
        <span className="font-mono text-xs">{a.tool}</span>
        <span className="max-w-full truncate font-mono text-xs text-muted-foreground">{short(a.args, 200)}</span>
        {a.reason !== undefined && <span className="text-xs text-muted-foreground">{a.reason}</span>}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" onClick={() => onDecide(a.askId, true)}>批准（本次）</Button>
        <Button size="sm" variant="outline" onClick={() => onDecide(a.askId, true, "session_kind")}>本会话此类放行</Button>
        <Button size="sm" variant="outline" onClick={() => onDecide(a.askId, true, "always")}>永久放行</Button>
        <Button size="sm" variant="outline" onClick={() => onDecide(a.askId, false)}>拒绝</Button>
      </div>
    </div>
  );
}

// ---- 设置页（模态，§10.1 规则 7）：权限档位（沙箱状态 + 安全模式）+ UI（主题）+ Provider 只读 ----
function SettingsDialog({
  open,
  onOpenChange,
  settings,
  sandbox,
  provider,
  onSettings,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  settings: AppSettings | null;
  sandbox: StateResponse["sandbox"] | null;
  provider: { provider: string; model: string } | null;
  onSettings: (patch: Partial<AppSettings>) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-m1e-settings="">
        <DialogHeader>
          <DialogTitle>设置</DialogTitle>
          <DialogDescription>权限档位与 UI 偏好（落主进程 settings，重启还原）。</DialogDescription>
        </DialogHeader>
        {settings && (
          <div className="flex flex-col gap-5 py-1 text-sm">
            <section className="flex flex-col gap-2">
              <div className="font-medium">权限档位</div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">档位</span>
                <Select value={settings.mode} onValueChange={(v) => onSettings({ mode: v as PermissionMode })}>
                  <SelectTrigger className="w-52" data-m1e-mode-select="">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="read-only">read-only（只读）</SelectItem>
                    <SelectItem value="default">default（写操作需批准）</SelectItem>
                    <SelectItem value="auto">auto（自主）</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">沙箱状态</span>
                {sandbox?.available ? (
                  <Badge variant="secondary">Seatbelt 已启用</Badge>
                ) : (
                  <Badge variant="destructive">不可用：{sandbox?.reason ?? "检测中"}</Badge>
                )}
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">产出代码安全模式</span>
                <Select value={settings.safeMode} onValueChange={(v) => onSettings({ safeMode: v as AppSettings["safeMode"] })}>
                  <SelectTrigger className="w-52" data-m1e-safe-select="">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="off">off（关闭）</SelectItem>
                    <SelectItem value="gate">gate（写工具强制审批，已生效）</SelectItem>
                    <SelectItem value="report">report（验证门收敛后静态快筛，默认）</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </section>
            <section className="flex flex-col gap-2" data-m2d-memory-section="">
              <div className="font-medium">记忆</div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">会话结束自动沉淀</span>
                <Checkbox
                  checked={settings.autoMemory}
                  onCheckedChange={(v) => onSettings({ autoMemory: v === true })}
                  data-m2d-auto-memory=""
                />
              </div>
              <div className="text-xs text-muted-foreground">
                开启时会话结束引导模型检查可沉淀项（合并为一次审批，拒绝则全部不写）；面板可在右栏「记忆」查看。
              </div>
            </section>
            <section className="flex flex-col gap-2">
              <div className="font-medium">UI</div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">主题</span>
                <Select value={settings.theme} onValueChange={(v) => onSettings({ theme: v as AppSettings["theme"] })}>
                  <SelectTrigger className="w-52" data-m1e-theme-select="">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="system">跟随系统</SelectItem>
                    <SelectItem value="light">浅色</SelectItem>
                    <SelectItem value="dark">深色</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="text-xs text-muted-foreground">
                面板布局：右栏切换器开/关/调宽自动保存，重启还原。
              </div>
            </section>
            <section className="flex flex-col gap-2">
              <div className="font-medium">Provider（只读）</div>
              <div className="rounded-md border px-3 py-2 text-xs text-muted-foreground" data-m1e-provider-info="">
                {provider ? provider.provider + " · " + provider.model : "检测中…"}
              </div>
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function App() {
  const [state, dispatch] = useReducer(reducer, {
    events: [],
    asks: [],
    timeline: [] as TimelineItem[],
    pos: new Map<string, number>(),
    running: false,
    error: null as string | null,
  });
  const [settings, setSettingsState] = useState<AppSettings | null>(null);
  const [sessions, setSessions] = useState<SessionInfoPayload[]>([]);
  const [currentSession, setCurrentSession] = useState<string | null>(null);
  const [status, setStatus] = useState<StateResponse | null>(null);
  const [provider, setProvider] = useState<{ provider: string; model: string } | null>(null);
  const [input, setInput] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const layoutDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sandbox = status?.sandbox ?? null;
  const planStatuses = useMemo(() => planStatusesOf(state), [state]);
  const tokens = useMemo(() => tokenProjectionOf(state), [state]);
  const diffs = useMemo(() => diffCardsOf(state), [state]);
  const pending = useMemo(() => pendingApprovalsOf(state), [state]);

  const patchSettings = (patch: Partial<AppSettings>): void => {
    if (!settings) return;
    setSettingsState({ ...settings, ...patch });
    void window.agent.setSettings(patch).catch(() => {});
  };

  // 布局（右栏开/关/调宽/当前面板）持久化：切换立即写，调宽防抖写（onLayoutChange 高频）。
  const patchLayout = (patch: Partial<AppSettings["layout"]>): void => {
    if (!settings) return;
    const next = { ...settings, layout: { ...settings.layout, ...patch } };
    setSettingsState(next);
    void window.agent.setSettings({ layout: next.layout }).catch(() => {});
  };
  const patchLayoutDebounced = (patch: Partial<AppSettings["layout"]>): void => {
    if (layoutDebounce.current) clearTimeout(layoutDebounce.current);
    layoutDebounce.current = setTimeout(() => patchLayout(patch), 300);
  };

  const refreshSessions = async (): Promise<void> => {
    setSessions(await window.agent.listSessions());
  };

  // 会话切换：session:open → 重放投影（reset 全量折叠，与活流同一 foldEvent）
  const switchSession = async (id: string): Promise<void> => {
    if (state.running) return;
    const { events } = await window.agent.openSession(id);
    setCurrentSession(id);
    dispatch({ type: "reset", events });
    await refreshSessions();
  };

  const createSession = async (): Promise<void> => {
    const { id } = await window.agent.createSession();
    setCurrentSession(id);
    dispatch({ type: "reset", events: [] });
    await refreshSessions();
  };

  const renameSession = async (oldId: string, newName: string): Promise<void> => {
    const { id } = await window.agent.renameSession(oldId, newName);
    if (currentSession === oldId) setCurrentSession(id);
    setRenaming(null);
    await refreshSessions();
  };

  const deleteSession = async (id: string): Promise<void> => {
    const { currentSession: next } = await window.agent.deleteSession(id);
    setCurrentSession(next);
    if (next) {
      const { events } = await window.agent.openSession(next);
      dispatch({ type: "reset", events });
    } else {
      dispatch({ type: "reset", events: [] });
    }
    await refreshSessions();
  };

  // 启动：settings（布局/档位/主题/当前会话）+ 会话列表 + 沙箱状态 + 当前会话重放（重启还原）
  useEffect(() => {
    void (async () => {
      const [s, list, st, info] = await Promise.all([
        window.agent.getSettings(),
        window.agent.listSessions(),
        window.agent.getState(),
        window.agent.getProviderInfo(),
      ]);
      setSettingsState(s);
      setSessions(list);
      setStatus(st);
      setProvider(info);
      const cur =
        s.currentSession && list.some((x) => x.id === s.currentSession) ? s.currentSession : (list[0]?.id ?? null);
      if (cur) {
        const { events } = await window.agent.openSession(cur);
        setCurrentSession(cur);
        dispatch({ type: "reset", events });
      }
    })();
  }, []);

  // 活事件流订阅（与重放同一 reducer 折叠管线）
  useEffect(() => {
    const offEvent = window.agent.onEvent((e) => dispatch({ type: "event", e }));
    const offAsk = (a: AskPayload): void => dispatch({ type: "ask", a });
    const offDone = (d: AskOutcomePayload): void => dispatch({ type: "askDone", d });
    const un1 = window.agent.onAsk(offAsk);
    const un2 = window.agent.onAskDone(offDone);
    return () => {
      offEvent();
      un1();
      un2();
    };
  }, []);

  // 主题：system 跟随系统；light/dark 直接落（theme.ts 复用 applyScheme）
  const theme = settings?.theme;
  useEffect(() => {
    const root = document.documentElement;
    if (!theme || theme === "system") {
      return watchSystemTheme(window.matchMedia(DARK_QUERY), root);
    }
    applyScheme(root, theme === "dark" ? "dark" : "light");
    return () => {};
  }, [theme]);

  const send = async (): Promise<void> => {
    const message = input.trim();
    if (!message || state.running) return;
    setInput("");
    dispatch({ type: "clearError" });
    let sessionId = currentSession;
    if (!sessionId) {
      const { id } = await window.agent.createSession();
      sessionId = id;
      setCurrentSession(id);
      await refreshSessions();
    }
    dispatch({ type: "running", running: true, error: null });
    const res = await window.agent.run({
      message,
      mode: settings?.mode ?? "default",
      sessionId,
    } satisfies RunRequest & { sessionId?: string });
    if (res.ok) dispatch({ type: "running", running: false });
    else dispatch({ type: "running", running: false, error: res.error ?? "未知错误" });
  };

  const decide = (askId: string, approved: boolean, scope?: "once" | "session_kind" | "always"): void => {
    void window.agent.decide(askId, approved, scope);
  };

  const onCardAction = (action: string, data: unknown): void => {
    if (action === "form_submit") {
      const d = data as { callId: string; answers: ClarifyAnswerMap };
      void window.agent.submitClarify(d.callId, d.answers);
    } else if (action === "plan_decide") {
      const d = data as { callId: string; approved: boolean };
      void window.agent.decidePlan(d.approved, d.callId);
    } else if (action === "jump_source") {
      // M2f：promote 卡「跳回源消息」——源定位在 sidechat 面板（origin 四字段即定位凭据）。
      // 这里只做可视化提示（面板打开后按 session/事件号定位），不改变主会话状态。
      const d = data as { sessionId: string; sourceEventIds: number[] };
      if (d && Array.isArray(d.sourceEventIds)) {
        void window.agent.sidechatState?.(d.sessionId).catch(() => {});
      }
    }
  };

  const lastTimeline = state.timeline[state.timeline.length - 1];
  const lastStreamText = lastTimeline?.kind === "stream" ? lastTimeline.text : undefined;

  // 右栏面板载荷：全部来自事件流/审批通道投影（无第二事实源）
  const panelPayload = {
    asks: pending.map((a) => ({ askId: a.askId, tool: a.tool, args: a.args, reason: a.reason, risk: a.risk })),
    tokens,
    diffs,
    memoryWrites: memoryWritesOf(state),
    // M2f sidechat 面板自行经 getState 拉取最新快照（不在此透传启动期旧值，避免不刷新）
    eventCount: state.events.length,
  };
  const activePanelId = settings?.layout.activePanel ?? null;
  const ActivePanel = activePanelId ? resolvePanel(activePanelId) : null;

  const renderTimelineItem = (it: TimelineItem): React.ReactNode => {
    if (it.kind === "event") return <EventView e={it.e} onAction={onCardAction} planStatuses={planStatuses} />;
    if (it.kind === "stream") return <AssistantBubble content={it.text} running={state.running} />;
    return <AskView it={it} onDecide={decide} />;
  };

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <div className="flex items-center gap-2 px-2 py-1.5">
            <span className="text-sm font-semibold">M1e · 桌面 Agent</span>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel className="flex items-center justify-between">
              会话
              <Button size="icon-sm" variant="ghost" aria-label="新建会话" title="新建会话" data-m1e-session-new="" onClick={() => void createSession()}>
                <Plus className="h-4 w-4" />
              </Button>
            </SidebarGroupLabel>
            <SidebarGroupContent className="px-1">
              <div className="flex max-h-64 flex-col gap-0.5 overflow-y-auto" data-m1e-session-list="">
                {sessions.length === 0 && <div className="px-2 py-1 text-xs text-muted-foreground">（无会话）</div>}
                {sessions.map((s) => (
                  <div
                    key={s.id}
                    className={
                      "group flex items-center gap-1 rounded-md px-2 py-1 text-xs " +
                      (s.id === currentSession ? "bg-accent text-accent-foreground" : "hover:bg-accent/50")
                    }
                  >
                    {renaming?.id === s.id ? (
                      <input
                        className="w-full rounded border bg-background px-1 py-0.5 text-xs"
                        value={renaming.value}
                        autoFocus
                        data-m1e-session-rename-input=""
                        onChange={(e) => setRenaming({ id: s.id, value: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && renaming.value.trim()) void renameSession(s.id, renaming.value.trim());
                          if (e.key === "Escape") setRenaming(null);
                        }}
                        onBlur={() => setRenaming(null)}
                      />
                    ) : (
                      <>
                        <button
                          className="min-w-0 flex-1 truncate text-left"
                          title={s.id + " · " + String(s.lines) + " 条事件"}
                          onClick={() => void switchSession(s.id)}
                        >
                          {s.id}
                        </button>
                        <span className="hidden shrink-0 gap-0.5 group-hover:flex">
                          <button
                            aria-label={"重命名 " + s.id}
                            className="rounded p-0.5 hover:bg-muted"
                            onClick={() => setRenaming({ id: s.id, value: s.id })}
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                          <button
                            aria-label={"删除 " + s.id}
                            className="rounded p-0.5 hover:bg-muted"
                            onClick={() => void deleteSession(s.id)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </span>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>运行状态</SidebarGroupLabel>
            <SidebarGroupContent className="px-2 text-xs">
              <div className="flex flex-col gap-2">
                {sandbox ? (
                  sandbox.available ? (
                    <Badge className="w-fit" variant="secondary">沙箱：Seatbelt 已启用</Badge>
                  ) : (
                    <Badge className="w-fit" variant="destructive">沙箱不可用：{sandbox.reason ?? "未知"}</Badge>
                  )
                ) : (
                  <Badge className="w-fit" variant="outline">沙箱检测中…</Badge>
                )}
                <div className="text-muted-foreground" data-m1e-event-count="">
                  事件：{state.events.length} 条
                </div>
                <div className="text-muted-foreground">
                  tokens：{tokens.inputTokens} in / {tokens.outputTokens} out
                </div>
              </div>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <Button variant="ghost" size="sm" className="w-full justify-start" data-m1e-settings-open="" onClick={() => setSettingsOpen(true)}>
            <SettingsIcon className="h-4 w-4" />
            设置
          </Button>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <ResizablePanelGroup
          orientation="horizontal"
          className="h-screen"
          onLayoutChanged={(layout: Record<string, number>) => {
            const w = layout["chat-right"];
            if (typeof w === "number" && Number.isFinite(w)) patchLayoutDebounced({ width: Math.round(w * 10) / 10 });
          }}
        >
          <ResizablePanel id="chat-left" defaultSize="68%" minSize="40%">
            <div className="flex h-full flex-col">
              <header className="flex items-center gap-2 border-b px-3 py-2">
                <SidebarTrigger />
                <Separator orientation="vertical" className="data-[orientation=vertical]:h-4" />
                <span className="text-sm font-medium">{currentSession ?? "未选择会话"}</span>
              </header>
              {state.error && (
                <div className="bg-destructive/10 px-4 py-2 text-xs text-destructive">运行失败：{state.error}</div>
              )}
              {sandbox && !sandbox.available && (
                <div className="bg-amber-500/10 px-4 py-2 text-xs text-amber-700 dark:text-amber-400">
                  ⚠️ 沙箱不可用：{sandbox.reason ?? "未知"} —— 已降级为无沙箱 + 写操作逐条强制审批
                </div>
              )}
              <Conversation items={state.timeline} running={state.running} lastStreamText={lastStreamText} renderItem={renderTimelineItem} />
              <footer className="flex items-end gap-2 border-t p-3">
                <Textarea
                  value={input}
                  rows={2}
                  disabled={state.running}
                  placeholder={state.running ? "agent 运行中…" : "给 agent 派活…"}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                />
                <Button size="lg" onClick={() => void send()} disabled={state.running || input.trim().length === 0}>
                  {state.running ? "运行中…" : "发送"}
                </Button>
              </footer>
            </div>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel
            id="chat-right"
            // react-resizable-panels v4：数字=像素，字符串=百分比（M1e 遗留坑：裸数字曾把右栏钳到 70px）
            defaultSize={String(settings?.layout.width ?? 32) + "%"}
            minSize="10%"
            maxSize="70%"
            className={activePanelId ? "" : "hidden"}
          >
            <div className="flex h-full flex-col" data-m1e-right-panel="">
              <header className="flex items-center gap-1 border-b px-2 py-1.5">
                {(Object.keys(PANEL_ICONS) as PanelId[]).map((id) => {
                  const active = activePanelId === id;
                  const pendingCount = id === "approvals" ? pending.length : 0;
                  return (
                    <button
                      key={id}
                      data-panel-toggle={id}
                      aria-label={"切换到 " + id + " 面板"}
                      aria-pressed={active}
                      className={
                        "relative flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent " +
                        (active ? "bg-accent text-accent-foreground" : "text-muted-foreground")
                      }
                      onClick={() => {
                        // 开关面板 = 打开该面板（幂等）；关闭走右侧 X（面板注册表语义，重启还原 open+activePanel）
                        if (settings) patchLayout({ activePanel: id, open: { ...settings.layout.open, [id]: true } });
                      }}
                    >
                      {PANEL_ICONS[id]}
                      {pendingCount > 0 && (
                        <span
                          data-approval-badge=""
                          className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white animate-pulse"
                        >
                          {pendingCount}
                        </span>
                      )}
                    </button>
                  );
                })}
                <div className="flex-1" />
                <span className="text-xs text-muted-foreground">{activePanelId ?? "未打开面板"}</span>
                {activePanelId && (
                  <Button size="icon-sm" variant="ghost" aria-label="关闭面板" data-panel-close="" onClick={() => { if (settings && activePanelId) patchLayout({ activePanel: null, open: { ...settings.layout.open, [activePanelId]: false } }); }}>
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </header>
              <div className="min-h-0 flex-1 overflow-y-auto" data-panel-id={activePanelId ?? undefined}>
                {ActivePanel && (
                  <ActivePanel
                    payload={panelPayload}
                    onAction={(action) => {
                      if (action === "compact") void window.agent.compact?.();
                    }}
                  />
                )}
              </div>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </SidebarInset>
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={settings}
        sandbox={sandbox}
        provider={provider}
        onSettings={patchSettings}
      />
    </SidebarProvider>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
