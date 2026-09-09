import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Message, MessageContent } from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
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
import { ScrollArea } from "@/components/ui/scroll-area";
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
import { resolveCard } from "./cards/registry";
import type { AgentEvent, ClarifyAnswerMap } from "../events";
import type {
  AgentApi,
  AskOutcomePayload,
  AskPayload,
  PermissionMode,
  RunRequest,
  StateResponse,
} from "../main/ipc-protocol";
import { DARK_QUERY, watchSystemTheme } from "./theme";
import "./styles.css";

declare global {
  interface Window {
    agent: AgentApi;
  }
}

const DEMO_HINT = "修复 fixtures/todo-app 中失败的测试";

function short(v: unknown, max = 260): string {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  if (s === undefined || s === null) return "";
  return s.length > max ? s.slice(0, max) + " …" : s;
}

// 会话时间线：事件与审批行按到达顺序混排；审批行原地显示决议结果。
type Item =
  | { kind: "event"; e: AgentEvent }
  | { kind: "ask"; a: AskPayload; resolved?: "approved" | "rejected"; timedOut?: boolean };

// 投影时间线：assistant_delta 按 callId 折叠为一条「流式中」气泡（逐字增长），
// 其余事件与审批行原样透传。纯函数：右栏原始 JSONL 面板仍显示逐条 delta。
type TimelineItem =
  | { kind: "event"; e: AgentEvent }
  | { kind: "stream"; callId: string; text: string }
  | { kind: "ask"; a: AskPayload; resolved?: "approved" | "rejected"; timedOut?: boolean };

function toTimeline(items: Item[]): TimelineItem[] {
  const out: TimelineItem[] = [];
  const pos = new Map<string, number>();
  for (const it of items) {
    if (it.kind === "event" && it.e.type === "assistant_delta") {
      const i = pos.get(it.e.callId);
      if (i === undefined) {
        pos.set(it.e.callId, out.length);
        out.push({ kind: "stream", callId: it.e.callId, text: it.e.text });
      } else {
        const s = out[i];
        if (s.kind === "stream") out[i] = { ...s, text: s.text + it.e.text };
      }
    } else {
      out.push(it);
    }
  }
  return out;
}

/** plan 决议状态表：callId → approved/rejected（由 plan_approved 事件归纳）。 */
type PlanStatuses = Record<string, "approved" | "rejected">;

function EventView({
  e,
  onAction,
  planStatuses,
  clarifySubmitted,
}: {
  e: AgentEvent;
  onAction: (action: string, data: unknown) => void;
  planStatuses: PlanStatuses;
  clarifySubmitted: Set<string>;
}) {
  if (e.type === "clarify_requested") {
    const Card = resolveCard("clarify_form");
    return (
      <Card
        payload={{ type: "clarify_form", callId: e.callId, questions: e.questions, submitted: clarifySubmitted.has(e.callId) }}
        onAction={onAction}
      />
    );
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
  if (e.type === "user_message") {
    return (
      <Message align="end">
        <MessageContent>
          <Bubble align="end" variant="default">
            <BubbleContent className="whitespace-pre-wrap">{e.content}</BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    );
  }
  if (e.type === "assistant_message") {
    return (
      <Message align="start">
        <MessageContent>
          <Bubble align="start" variant="outline">
            <BubbleContent className="whitespace-pre-wrap">{e.content}</BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    );
  }
  if (e.type === "tool_call") {
    return (
      <Message align="start">
        <MessageContent>
          <Bubble align="start" variant="muted">
            <BubbleContent className="font-mono text-xs">
              <span className="font-semibold text-foreground">🔧 {e.name}</span>
              <span className="text-muted-foreground">{short(e.args)}</span>
            </BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    );
  }
  if (e.type === "tool_result") {
    return (
      <Message align="start">
        <MessageContent>
          <Bubble align="start" variant="ghost">
            <BubbleContent className="font-mono text-xs">
              <span className={e.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>
                {e.ok ? "✓" : "✗"}
              </span>
              <span className="whitespace-pre-wrap text-muted-foreground">{short(e.output, 400)}</span>
            </BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    );
  }
  if (e.type === "usage") {
    // usage 事件走卡片注册表投影（M1a 注册表的首个真实接线点）
    const UsageCard = resolveCard("usage_summary");
    return <UsageCard payload={{ type: "usage_summary", inputTokens: e.inputTokens, outputTokens: e.outputTokens }} />;
  }
  return null; // assistant_delta 由 toTimeline 折叠，不单独成泡
}

function StreamView({
  s,
  running,
}: {
  s: Extract<TimelineItem, { kind: "stream" }>;
  running: boolean;
}) {
  return (
    <Message align="start">
      <MessageContent>
        <Bubble align="start" variant="outline">
          <BubbleContent className="whitespace-pre-wrap">
            {s.text}
            {running && <span className="animate-pulse">▍</span>}
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  );
}

function AskView({
  it,
  onDecide,
}: {
  it: Extract<Item, { kind: "ask" }>;
  onDecide: (askId: string, approved: boolean, scope?: "once" | "session_kind" | "always") => void;
}) {
  const a = it.a;
  const riskBadge =
    a.risk === undefined || a.risk === "none"
      ? null
      : (
          <Badge
            className={
              a.risk === "critical" || a.risk === "high"
                ? "border-red-500/60 bg-red-500/15 text-red-700 dark:text-red-400"
                : "border-amber-500/60 bg-amber-500/15 text-amber-700 dark:text-amber-400"
            }
            variant="outline"
          >
            risk: {a.risk}
          </Badge>
        );
  if (it.resolved) {
    const label =
      it.resolved === "approved"
        ? "已批准"
        : it.timedOut
          ? "已拒绝（60 秒无响应，自动拒绝）"
          : "已拒绝";
    return (
      <Card className="py-3">
        <CardContent className="flex items-center gap-2 px-3 text-sm">
          <Badge variant={it.resolved === "approved" ? "secondary" : "destructive"}>{label}</Badge>
          <span className="font-mono text-xs text-muted-foreground">{a.tool}</span>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card className="border-amber-500/40 bg-amber-500/5 py-3">
      <CardContent className="flex flex-wrap items-center gap-2 px-3 text-sm">
        <Badge className="border-amber-500/60 bg-amber-500/15 text-amber-700 dark:text-amber-400" variant="outline">
          待审批
        </Badge>
        {riskBadge}
        <span className="font-mono text-xs">{a.tool}</span>
        <span className="max-w-full truncate font-mono text-xs text-muted-foreground">{short(a.args, 200)}</span>
        {a.reason !== undefined && <span className="text-xs text-muted-foreground">{a.reason}</span>}
        <span className="flex flex-wrap gap-2">
          <Button size="sm" variant="default" onClick={() => onDecide(a.askId, true)}>
            批准（本次）
          </Button>
          <Button size="sm" variant="outline" onClick={() => onDecide(a.askId, true, "session_kind")}>
            本会话此类放行
          </Button>
          <Button size="sm" variant="outline" onClick={() => onDecide(a.askId, true, "always")}>
            永久放行
          </Button>
          <Button size="sm" variant="outline" onClick={() => onDecide(a.askId, false)}>
            拒绝
          </Button>
        </span>
        <span className="text-xs text-muted-foreground">60 秒无响应自动拒绝</span>
      </CardContent>
    </Card>
  );
}

function App() {
  const [items, setItems] = useState<Item[]>([]);
  const [status, setStatus] = useState<StateResponse | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<PermissionMode>("default");
  const [input, setInput] = useState("");
  const [clarifySubmitted, setClarifySubmitted] = useState<Set<string>>(new Set());

  // plan 决议状态：plan_approved 事件归纳（同 callId 后到者优先）
  const planStatuses: PlanStatuses = {};
  for (const it of items) {
    if (it.kind === "event" && it.e.type === "plan_approved") {
      planStatuses[it.e.callId] = it.e.approved ? "approved" : "rejected";
    }
  }

  // 卡片动作回传：表单提交 → 澄清门；批准/拒绝 → 方案门（IPC，与 turn 解耦）
  const onCardAction = (action: string, data: unknown): void => {
    if (action === "form_submit") {
      const d = data as { callId: string; answers: ClarifyAnswerMap };
      setClarifySubmitted((v) => new Set(v).add(d.callId));
      void window.agent.submitClarify(d.callId, d.answers);
    } else if (action === "plan_decide") {
      const d = data as { callId: string; approved: boolean };
      void window.agent.decidePlan(d.approved, d.callId);
    }
  };

  useEffect(() => watchSystemTheme(window.matchMedia(DARK_QUERY), document.documentElement), []);

  useEffect(() => {
    const offEvent = window.agent.onEvent((e) => setItems((v) => [...v, { kind: "event", e }]));
    const offAsk = window.agent.onAsk((a) => setItems((v) => [...v, { kind: "ask", a }]));
    const offDone = window.agent.onAskDone((d: AskOutcomePayload) =>
      setItems((v) =>
        v.map((it) =>
          it.kind === "ask" && it.a.askId === d.askId
            ? { ...it, resolved: d.outcome, timedOut: d.reason === "timeout" }
            : it,
        ),
      ),
    );
    void window.agent.getState().then(setStatus);
    return () => {
      offEvent();
      offAsk();
      offDone();
    };
  }, []);

  const send = async (): Promise<void> => {
    const message = input.trim();
    if (!message || running) return;
    setInput("");
    setItems([]);
    setError(null);
    setRunning(true);
    const res = await window.agent.run({ message, mode } satisfies RunRequest);
    setRunning(false);
    if (!res.ok) setError(res.error ?? "未知错误");
  };

  const decide = (askId: string, approved: boolean, scope?: "once" | "session_kind" | "always"): void => {
    void window.agent.decide(askId, approved, scope);
  };

  const sandbox = status?.sandbox;
  const tokens = items.reduce(
    (acc, it) =>
      it.kind === "event" && it.e.type === "usage"
        ? { in: acc.in + it.e.inputTokens, out: acc.out + it.e.outputTokens }
        : acc,
    { in: 0, out: 0 },
  );

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <div className="flex items-center gap-2 px-2 py-1.5">
            <span className="text-sm font-semibold">M0c · 桌面 Agent</span>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>运行状态</SidebarGroupLabel>
            <SidebarGroupContent className="px-2 text-xs">
              <div className="flex flex-col gap-2">
                {sandbox ? (
                  sandbox.available ? (
                    <Badge className="w-fit" variant="secondary">
                      沙箱：Seatbelt 已启用
                    </Badge>
                  ) : (
                    <Badge className="w-fit" variant="destructive">
                      沙箱不可用：{sandbox.reason ?? "未知"}
                    </Badge>
                  )
                ) : (
                  <Badge className="w-fit" variant="outline">
                    沙箱检测中…
                  </Badge>
                )}
                <div className="text-muted-foreground">事件：{items.length} 条</div>
                <div className="text-muted-foreground">
                  tokens：{tokens.in} in / {tokens.out} out
                </div>
              </div>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>权限档</SidebarGroupLabel>
            <SidebarGroupContent className="px-2">
              <Select value={mode} onValueChange={(v) => setMode(v as PermissionMode)}>
                <SelectTrigger className="w-full" disabled={running}>
                  <SelectValue placeholder="选择权限档" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="read-only">read-only</SelectItem>
                  <SelectItem value="default">default（写操作需批准）</SelectItem>
                  <SelectItem value="auto">auto</SelectItem>
                </SelectContent>
              </Select>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <div className="px-2 text-xs text-muted-foreground">macOS Seatbelt · mock 模型</div>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <ResizablePanelGroup orientation="horizontal" className="h-screen">
          <ResizablePanel defaultSize={68} minSize={40}>
            <div className="flex h-full flex-col">
              <header className="flex items-center gap-2 border-b px-3 py-2">
                <SidebarTrigger />
                <Separator orientation="vertical" className="data-[orientation=vertical]:h-4" />
                <span className="text-sm font-medium">会话</span>
              </header>
              {error && (
                <div className="bg-destructive/10 px-4 py-2 text-xs text-destructive">运行失败：{error}</div>
              )}
              {sandbox && !sandbox.available && (
                <div className="bg-amber-500/10 px-4 py-2 text-xs text-amber-700 dark:text-amber-400">
                  ⚠️ 沙箱不可用：{sandbox.reason ?? "未知"} —— 已降级为无沙箱 + 写操作逐条强制审批
                </div>
              )}
              <MessageScrollerProvider>
                <MessageScroller className="min-h-0 flex-1">
                  <MessageScrollerViewport>
                    <MessageScrollerContent className="p-4">
                      {items.length === 0 && (
                        <Empty>
                          <EmptyHeader>
                            <EmptyMedia variant="icon">💬</EmptyMedia>
                            <EmptyTitle>还没有会话</EmptyTitle>
                            <EmptyDescription>在下方给 agent 派活，例如：{DEMO_HINT}</EmptyDescription>
                          </EmptyHeader>
                        </Empty>
                      )}
                      {toTimeline(items).map((it, i) => (
                        <MessageScrollerItem key={i}>
                          {it.kind === "event" ? (
                            <EventView e={it.e} onAction={onCardAction} planStatuses={planStatuses} clarifySubmitted={clarifySubmitted} />
                          ) : it.kind === "stream" ? (
                            <StreamView s={it} running={running} />
                          ) : (
                            <AskView it={it} onDecide={decide} />
                          )}
                        </MessageScrollerItem>
                      ))}
                    </MessageScrollerContent>
                  </MessageScrollerViewport>
                  <MessageScrollerButton />
                </MessageScroller>
              </MessageScrollerProvider>
              <footer className="flex items-end gap-2 border-t p-3">
                <Textarea
                  value={input}
                  rows={2}
                  disabled={running}
                  placeholder={running ? "agent 运行中…" : "给 agent 派活…"}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                />
                <Button
                  size="lg"
                  onClick={() => void send()}
                  disabled={running || input.trim().length === 0}
                >
                  {running ? "运行中…" : "发送"}
                </Button>
              </footer>
            </div>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={32} minSize={20}>
            <div className="flex h-full flex-col">
              <header className="border-b px-3 py-2 text-sm font-medium">事件流（原始 JSONL）</header>
              <ScrollArea className="min-h-0 flex-1">
                <pre className="p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all text-muted-foreground">
                  {items
                    .map((it) => {
                      if (it.kind === "ask") {
                        if (it.resolved) {
                          return JSON.stringify({ type: "ask-done", askId: it.a.askId, outcome: it.resolved });
                        }
                        return JSON.stringify({ type: "ask", tool: it.a.tool, args: it.a.args });
                      }
                      return JSON.stringify(it.e);
                    })
                    .join("\n") || "（空）"}
                </pre>
              </ScrollArea>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </SidebarInset>
    </SidebarProvider>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);