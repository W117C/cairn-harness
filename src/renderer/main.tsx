// M1e 三区 shell（§10.1）：左会话列表 / 中对话流（virtuoso 虚拟化）/ 右面板抽屉（单面板制）。
// 面板状态 = 事件流订阅投影（§10.2），布局与档位经 settings IPC 持久化（重启还原）。
import { memo, StrictMode, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { GitBranch, Coins, ShieldCheck, Database, Puzzle, MessageSquarePlus, Bot, Clock, Settings as SettingsIcon, Plus, Pencil, Trash2, X } from "lucide-react";
import { resolveCard } from "./cards/registry";
import { compactionCardPayload } from "../agent/compaction";
import { securityReportCardPayload } from "../agent/security/scan";
import { Conversation } from "./conversation";
import {
  diffCardsOf,
  foldsIntoCurrentSession,
  memoryWritesOf,
  pendingApprovalsOf,
  planStatusesOf,
  reducer,
  tokenProjectionOf,
  clarifySubmittedOf,
  type TimelineItem,
} from "./store";
import { projectAgentPanel, projectMergeTower, projectTokenUsageByAgent, skipReasonLabel, type AgentColumn } from "./projections";
import { ErrorBoundary } from "./error-boundary";
import { resolvePanel, type PanelId } from "./panels/registry";
import { OnboardingWizard, licenseStatusLabel, updateResultLabel } from "./onboarding";
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
import type { UpdateCheckResult } from "../main/updater";
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
  agents: <Bot className="h-4 w-4" />,
  schedule: <Clock className="h-4 w-4" />,
};

/** M4a：定时会话徽标/过滤的任务名清单（会话列表 origin 投影）。
 *  F10（审查 P3）：以守卫替代非空断言——字段改名时是类型错误而不是运行时 undefined 串。 */
function scheduledNamesOf(sessions: SessionInfoPayload[]): string[] {
  const out = new Set<string>();
  for (const s of sessions) {
    if (s.origin === "scheduled" && typeof s.automationName === "string") out.add(s.automationName);
  }
  return [...out];
}

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

/** Codex 式思考等待指示：三个渐次点亮的小点 + 终端光标（克制动效，running 态专用）。 */
function ThinkingIndicator() {
  return (
    <span className="ml-1 inline-flex items-center gap-1 align-middle" aria-label="agent 思考中">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="m0-think-dot h-1 w-1 rounded-full bg-primary/70"
          style={{ animationDelay: String(i * 0.18) + "s" }}
        />
      ))}
      <span className="ml-0.5 animate-pulse text-primary">▍</span>
    </span>
  );
}

function AssistantBubble({ content, running }: { content: string; running: boolean }) {
  return (
    <div className="flex justify-start px-1">
      <div className="max-w-[85%] rounded-r-lg rounded-l-sm border-l-2 border-primary/50 bg-muted/45 px-3.5 py-2 text-[13.5px] leading-relaxed whitespace-pre-wrap text-foreground/90">
        {content}
        {running && <ThinkingIndicator />}
      </div>
    </div>
  );
}

function ToolRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex justify-start px-1">
      <div className="flex max-w-[90%] flex-wrap items-center gap-1.5 rounded-md border border-border/60 bg-card/70 px-2.5 py-1.5 font-mono text-[12px] leading-snug text-foreground/85">
        {children}
      </div>
    </div>
  );
}

function EventView({
  e,
  onAction,
  planStatuses,
  agentCols,
  clarifySubmitted,
}: {
  e: AgentEvent;
  onAction: (action: string, data: unknown) => void;
  planStatuses: Record<string, "approved" | "rejected">;
  agentCols: Record<string, AgentColumn>;
  clarifySubmitted: Set<string>;
}) {
  if (e.type === "clarify_requested") {
    const Card = resolveCard("clarify_form");
    // H2（G-1）：已提交投影随 payload 下传——表单卡据此冻结（旧链路 submitted 恒 undefined，可反复提交）
    return <Card payload={{ type: "clarify_form", callId: e.callId, questions: e.questions, submitted: clarifySubmitted.has(e.callId) }} onAction={onAction} />;
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
  // ---- M3a：agent 子流 / 审批协议事件的对话流渲染（状态由 agentCols 投影注入，零私有状态）----
  if (e.type === "agent_spawned") {
    const Card = resolveCard("agent_card");
    const col = agentCols[e.agent_id];
    return (
      <Card
        payload={{
          type: "agent_card",
          agent_id: e.agent_id,
          mode: e.mode,
          task: e.task,
          status: col?.status ?? "running",
          reason: col?.reason,
          permission_mode: e.permission_mode,
          ...(e.model ? { model: e.model } : {}), // P0（审查）：worker 用哪个模型上卡——model 已发射无人渲染
          tier_warning: e.tier_warning,
          usage: col ? { inputTokens: col.usage.inputTokens, outputTokens: col.usage.outputTokens } : undefined,
          pendingApproval: col?.pendingApproval !== null && col?.pendingApproval !== undefined ? true : undefined,
          report: col?.report,
        }}
        onAction={onAction}
      />
    );
  }
  if (e.type === "agent_status") {
    return (
      <ToolRow>
        <span className="font-semibold text-foreground">🤖 {e.agent_id}</span>
        <Badge variant={e.status === "done" ? "secondary" : e.status === "running" ? "outline" : "destructive"}>{e.status}</Badge>
        {e.reason !== undefined && <span className="text-muted-foreground">{e.reason}</span>}
      </ToolRow>
    );
  }
  if (e.type === "agent_message") {
    if (e.kind === "report") {
      const Card = resolveCard("report");
      return <Card payload={{ type: "report", title: "worker 报告 · " + e.agent_id, body: e.text }} />;
    }
    return (
      <ToolRow>
        <span className="font-semibold text-foreground">🤖 {e.agent_id}</span>
        <span className="whitespace-pre-wrap text-muted-foreground">{short(e.text, 300)}</span>
      </ToolRow>
    );
  }
  if (e.type === "agent_result") {
    // M3c 崩溃恢复卡（§4.4.9）：failed(reason=interrupted) + respawn 载荷 → 「重派」= 全新 agent_id 再 spawn
    if (e.reason === "interrupted" && e.artifacts.respawn) {
      return (
        <div className="flex justify-start">
          <div className="flex max-w-[90%] flex-col gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/5 px-2.5 py-2 text-sm" data-m3c-recovery-card={e.agent_id}>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge className="border-amber-500/60 bg-amber-500/15 text-amber-700 dark:text-amber-400" variant="outline">恢复卡</Badge>
              <span className="font-mono text-xs">{e.agent_id}</span>
              <Badge variant="destructive">failed · interrupted</Badge>
            </div>
            <div className="text-xs text-muted-foreground">
              上次会话被中断（重启扫描无终态事件）。「重派」= 全新 agent_id 按原 spawn 参数再 spawn（V1 无热恢复）；或忽略。write worker 旧 worktree 走孤儿列表。
            </div>
            <div className="max-w-full truncate font-mono text-xs text-muted-foreground">
              原任务：{e.artifacts.respawn.task}（mode={e.artifacts.respawn.mode}）
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                data-m3c-respawn={e.agent_id}
                onClick={() => onAction("agent_respawn", { agentId: e.agent_id, respawn: e.artifacts.respawn })}
              >
                重派
              </Button>
              <span className="self-center text-[10px] text-muted-foreground">或忽略（不重派）</span>
            </div>
          </div>
        </div>
      );
    }
    const Card = resolveCard("report");
    const body = [
      "status: " + e.status + (e.reason !== undefined ? "（" + e.reason + "）" : ""),
      "usage: " + String(e.usage.inputTokens) + " in / " + String(e.usage.outputTokens) + " out",
      "tool_stats: " + JSON.stringify(e.tool_stats),
      "",
      e.summary,
    ].join("\n");
    return <Card payload={{ type: "report", title: "agent_result · " + e.agent_id + "（父上下文唯一接收物）", body }} />;
  }
  if (e.type === "approval_requested") {
    return (
      <div className="flex justify-start">
        <div className="flex max-w-[90%] flex-col gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/5 px-2.5 py-2 text-sm">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge className="border-amber-500/60 bg-amber-500/15 text-amber-700 dark:text-amber-400" variant="outline">worker 审批</Badge>
            {e.agent_id !== undefined && <span className="font-mono text-xs">{e.agent_id}</span>}
            <span className="font-mono text-xs">{e.tool}</span>
            <Badge variant="outline">risk: {e.risk}</Badge>
          </div>
          <div className="max-w-full truncate font-mono text-xs text-muted-foreground">{e.args_digest}</div>
          {e.tier_warning !== undefined && <div className="text-xs text-amber-700 dark:text-amber-400">⚠ {e.tier_warning}</div>}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => onAction("worker_approval", { approvalId: e.id, approved: true, agentId: e.agent_id })}>批准（本次）</Button>
            <Button size="sm" variant="outline" onClick={() => onAction("worker_approval", { approvalId: e.id, approved: true, agentId: e.agent_id, scope: "session_kind" })}>本会话此类放行</Button>
            <Button size="sm" variant="outline" onClick={() => onAction("worker_approval", { approvalId: e.id, approved: false, agentId: e.agent_id })}>拒绝</Button>
          </div>
        </div>
      </div>
    );
  }
  if (e.type === "approval_resolved") {
    return (
      <ToolRow>
        <Badge variant={e.decision === "approved" ? "secondary" : "destructive"}>{e.decision === "approved" ? "已批准" : "已拒绝"}</Badge>
        <span className="font-mono text-xs">{e.id}</span>
        <span className="text-muted-foreground">scope: {e.scope}{e.reason !== undefined ? " · " + e.reason : ""}</span>
      </ToolRow>
    );
  }
  if (e.type === "automation_triggered") {
    // M4a：定时触发行（主时间线投影；补跑带标签）
    return (
      <ToolRow>
        <span className="font-semibold text-foreground">⏰ 定时触发</span>
        <span>{e.task_name}</span>
        {e.catchup === true && <Badge variant="outline">补跑</Badge>}
        {e.session_id !== undefined && <span className="text-muted-foreground">会话：{e.session_id}</span>}
      </ToolRow>
    );
  }
  if (e.type === "automation_skipped") {
    return (
      <ToolRow>
        <span className="font-semibold text-foreground">⏰ 定时跳过</span>
        <span>{e.task_name}</span>
        <Badge variant="destructive">{e.reason}</Badge>
        <span className="text-muted-foreground" title={skipReasonLabel(e.reason)}>{skipReasonLabel(e.reason)}</span>
      </ToolRow>
    );
  }
  if (e.type === "automation_completed") {
    // M4a 完成回写（§12.2.4）：复用 report 卡类型（不新增卡片类型，§10.3 纪律）
    const Card = resolveCard("report");
    const body = [
      "status: " + e.status + (e.reason !== undefined ? "（" + e.reason + "）" : ""),
      "occurrence: " + e.occurrence_key,
      "usage: " + String(e.usage.inputTokens) + " in / " + String(e.usage.outputTokens) + " out",
      "tool_stats: " + JSON.stringify(e.tool_stats),
      "",
      e.summary,
    ].join("\n");
    return (
      <Card
        payload={{
          type: "report",
          title: "定时任务" + (e.status === "succeeded" ? "完成" : "失败") + " · " + e.task_name,
          body,
        }}
      />
    );
  }
  if (e.type === "card_action") {
    return null; // 回写动作本身不渲染（决议状态由对应卡的 resolved 投影呈现）
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
        {e.agent_id !== undefined && <Badge variant="outline" className="font-mono text-[10px]">🤖 {e.agent_id}</Badge>}
        <span className="font-semibold text-foreground">🔧 {e.name}</span>
        <span className="text-muted-foreground">{short(e.args)}</span>
      </ToolRow>
    );
  }
  if (e.type === "tool_result") {
    return (
      <ToolRow>
        {e.agent_id !== undefined && <Badge variant="outline" className="font-mono text-[10px]">🤖 {e.agent_id}</Badge>}
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
  // G8（审查 P3）：diff_comment 补渲染分支——24 个 KNOWN_TYPES 里唯一无分支的类型，
  // 旧实现落到 return null → 虚拟列表留一条空 padding 行。
  if (e.type === "diff_comment") {
    return (
      <ToolRow>
        <span className="font-semibold text-foreground">💬 评审意见</span>
        <span className="font-mono text-muted-foreground">{e.path}:{String(e.line)}</span>
        <span className="whitespace-pre-wrap text-muted-foreground">{e.body}</span>
      </ToolRow>
    );
  }
  // 审查 S3 / 4.4：routing_decision（M5b 审计事件）走 fold 的兜底分支进时间线，但过去
  // 没有渲染分支 = 一条空 padding 行（G8 同类漏网）。补轻摘要：选了谁、为什么、从哪升上来。
  if (e.type === "routing_decision") {
    return (
      <ToolRow>
        <span className="font-semibold text-foreground">🧭 模型路由</span>
        <span className="font-mono text-muted-foreground">{e.picked}</span>
        <span className="text-muted-foreground">
          {e.reason}
          {e.from !== undefined ? ` ← ${e.from}` : ""}
          {e.stage !== undefined ? ` · ${e.stage}` : ""}
          {e.agent_id !== undefined ? ` · ${e.agent_id}` : " · 主会话"} · 候选 {String(e.candidates.length)}
        </span>
      </ToolRow>
    );
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
        {a.reason !== undefined && (
          a.reason.includes("将无人值守执行") ? (
            <span className="w-full font-medium text-red-600 dark:text-red-400" data-m4a-unattended-red="">{a.reason}</span>
          ) : (
            <span className="text-xs text-muted-foreground">{a.reason}</span>
          )
        )}
        {typeof (a.args as Record<string, unknown> | undefined)?.prompt === "string" && (
          // M4a §12.2.5：prompt 是持久化攻击面——审批卡全文展示（不截断）
          <pre className="mt-1 max-h-40 w-full overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-2 font-mono text-[11px]" data-m4a-automation-prompt="">
            {String((a.args as Record<string, unknown>).prompt)}
          </pre>
        )}
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

// ---- 设置页（模态，§10.1 规则 7）：§13 七组——Provider 管理（BYOK key · 单价表）/ 权限档位（沙箱 + 安全模式）/
// UI（主题）/ 定时任务 / 记忆 / 遥测（默认关）/ 关于·更新（版本 · license · 检查更新 · 重跑引导）。
// M4b：Provider 组从「只读」升级为 key 管理（safeStorage 密文落盘，明文零落盘）。
function SettingsDialog({
  open,
  onOpenChange,
  settings,
  sandbox,
  provider,
  license,
  providerKeys,
  aboutVersion,
  updateResult,
  onSettings,
  onCheckUpdate,
  onOpenDownload,
  onSaveKey,
  onDeleteKey,
  onRerunOnboarding,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  settings: AppSettings | null;
  sandbox: StateResponse["sandbox"] | null;
  provider: { provider: string; model: string } | null;
  license: StateResponse["license"] | null;
  providerKeys: StateResponse["providerKeys"] | null;
  aboutVersion: string;
  updateResult: UpdateCheckResult | null;
  onSettings: (patch: Partial<AppSettings>) => void;
  onCheckUpdate: () => void;
  onOpenDownload: (url: string) => void;
  onSaveKey: (key: string) => Promise<string | null>;
  onDeleteKey: () => Promise<string | null>;
  onRerunOnboarding: () => void;
}) {
  const [keyInput, setKeyInput] = useState("");
  const [keyNote, setKeyNote] = useState<string | null>(null);
  const licenseBadge = (l: NonNullable<StateResponse["license"]>): React.ReactElement => (
    <Badge
      variant={l.state === "valid" ? "secondary" : l.state === "invalid" ? "destructive" : "outline"}
      data-m4b-license-badge=""
    >
      {licenseStatusLabel(l)}
    </Badge>
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto" data-m1e-settings="">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-mono text-base tracking-wide">
            <span className="flex h-5 w-5 items-center justify-center rounded bg-primary/15 font-mono text-[10px] font-semibold text-primary">⚙</span>
            设置
          </DialogTitle>
          <DialogDescription>§13 七组偏好（落主进程 settings，重启还原）。</DialogDescription>
        </DialogHeader>
        {settings && (
          <div className="flex flex-col gap-5 py-1 text-sm">
            <section className="flex flex-col gap-2" data-m4b-provider-section="">
              <div className="font-mono text-[12px] font-medium tracking-wide text-foreground/85">Provider 管理（BYOK）</div>
              <div className="rounded-md border px-3 py-2 text-xs text-muted-foreground" data-m1e-provider-info="">
                {provider ? provider.provider + " · " + provider.model : "检测中…"}
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="password"
                  className="h-8 flex-1"
                  placeholder={providerKeys?.envActive ? "M0_API_KEY env 已在（优先；钥匙串 key 并存）" : "provider key（保存到钥匙串，密文落盘，明文零落盘）"}
                  value={keyInput}
                  data-m4b-provider-key-input=""
                  onChange={(e) => setKeyInput(e.target.value)}
                />
                <Button
                  size="sm"
                  disabled={keyInput.trim() === ""}
                  data-m4b-provider-key-save=""
                  onClick={() => {
                    void onSaveKey(keyInput).then((err) => {
                      setKeyNote(err === null ? "已保存到钥匙串（重启后自动解密生效；env 路径优先）" : err);
                      if (err === null) setKeyInput("");
                    });
                  }}
                >
                  保存到钥匙串
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={(providerKeys?.stored.length ?? 0) === 0}
                  title="删除已存 key（glm）"
                  data-m4b-provider-key-delete=""
                  onClick={() => {
                    void onDeleteKey().then((err) => setKeyNote(err ?? "已删除"));
                  }}
                >
                  删除
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-xs" data-m4b-provider-key-status="">
                {providerKeys?.available ? (
                  <Badge variant="secondary">safeStorage 可用</Badge>
                ) : (
                  <Badge variant="destructive">safeStorage 不可用 → 拒存（fail-closed，不落明文）</Badge>
                )}
                {(providerKeys?.stored.length ?? 0) > 0 && <Badge variant="outline">已存：{providerKeys?.stored.join("、")}</Badge>}
                {providerKeys?.envActive && <Badge variant="outline">M0_API_KEY env 优先</Badge>}
              </div>
              {keyNote !== null && <div className="text-xs text-muted-foreground" data-m4b-provider-key-note="">{keyNote}</div>}
              <div className="text-xs text-muted-foreground">
                单价表：当前单价（USD / 百万 token）= {String(settings.budgetPricePerMTok ?? 0)}（下方成本闸组修改，随成本闸估价使用）。
              </div>
            </section>
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
            <section className="flex flex-col gap-2" data-m4a-settings-schedule="">
              <div className="font-medium">定时任务（M4a §12.2）</div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">同时运行的定时会话上限</span>
                <Input
                  type="number"
                  min={1}
                  max={8}
                  className="w-52"
                  data-m4a-cap-input=""
                  value={String(settings.scheduleConcurrencyCap ?? 2)}
                  onChange={(e) => onSettings({ scheduleConcurrencyCap: Math.min(8, Math.max(1, Number(e.target.value) || 1)) })}
                />
              </div>
              <div className="text-xs text-muted-foreground">
                与 worker 并发上限（4）独立计数（§12.2.3）；任务管理在右栏「schedule」面板：列表 / 创建表单 / 运行历史六态筛选。
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
            <section className="flex flex-col gap-2" data-m3c-budget-section="">
              <div className="font-medium">成本闸（会话级，M3c §4.4.8）</div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">maxBudgetUsd</span>
                <Input
                  type="number"
                  min={0}
                  step="0.5"
                  className="w-52"
                  data-m3c-budget-max=""
                  value={String(settings.maxBudgetUsd ?? 0)}
                  onChange={(e) => onSettings({ maxBudgetUsd: Math.max(0, Number(e.target.value) || 0) })}
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">单价（USD / 百万 token）</span>
                <Input
                  type="number"
                  min={0}
                  step="0.1"
                  className="w-52"
                  data-m3c-budget-price=""
                  value={String(settings.budgetPricePerMTok ?? 0)}
                  onChange={(e) => onSettings({ budgetPricePerMTok: Math.max(0, Number(e.target.value) || 0) })}
                />
              </div>
              <div className="text-xs text-muted-foreground">
                估价 = Σusage tokens × 单价；超限拒绝新 spawn（主 loop 不受闸）。两项均 0 = 关（缺省零行为）。
              </div>
            </section>
            <section className="flex flex-col gap-2" data-m4b-telemetry-section="">
              <div className="font-medium">遥测</div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">遥测开关</span>
                <Checkbox
                  checked={settings.telemetry}
                  onCheckedChange={(v) => onSettings({ telemetry: v === true })}
                  data-m4b-telemetry-switch=""
                />
              </div>
              <div className="text-xs text-muted-foreground">
                默认关（§13：BYOK 用户零数据出门）。V1 无任何上报实现——没有通道 = 最强保证；关于页同样注明。
              </div>
            </section>
            <section className="flex flex-col gap-2" data-m4b-about-section="">
              <div className="font-medium">关于 / 更新</div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Badge variant="outline" data-m4b-about-version="">版本 {aboutVersion || "…"}</Badge>
                {license && licenseBadge(license)}
                <Badge variant="outline">遥测：{settings.telemetry ? "开" : "关（V1 无上报通道）"}</Badge>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">更新 manifest URL</span>
                <Input
                  className="h-8 flex-1"
                  placeholder="https://example.com/updates.json（空 = 未配置更新源）"
                  value={settings.updateManifestUrl}
                  data-m4b-update-url=""
                  onChange={(e) => onSettings({ updateManifestUrl: e.target.value })}
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" data-m4b-update-check="" onClick={onCheckUpdate}>
                  检查更新
                </Button>
                {updateResult && (
                  <span className="text-xs text-muted-foreground" data-m4b-update-result="">{updateResultLabel(updateResult)}</span>
                )}
                {updateResult?.state === "available" && (
                  <Button size="sm" data-m4b-update-open="" onClick={() => onOpenDownload(updateResult.url)}>
                    打开下载页
                  </Button>
                )}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-muted-foreground">新手引导</span>
                <Button size="sm" variant="outline" data-m4b-onboard-rerun="" onClick={onRerunOnboarding}>
                  重新运行引导（覆盖 §13 七组）
                </Button>
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
  const [scheduleFilter, setScheduleFilter] = useState<string>("all");
  // M4b：新手向导（首启 !onboarded 自动弹；完成/重跑经 settings.onboarded 持久化）+ 更新检查显式态
  const [wizardOpen, setWizardOpen] = useState(false);
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null);
  const layoutDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sandbox = status?.sandbox ?? null;
  const license = status?.license ?? null;
  const providerKeys = status?.providerKeys ?? null;
  const aboutVersion = status?.about?.version ?? "";
  const planStatuses = useMemo(() => planStatusesOf(state), [state]);
  const clarifySubmitted = useMemo(() => clarifySubmittedOf(state), [state]);
  const tokens = useMemo(() => tokenProjectionOf(state), [state]);
  const diffs = useMemo(() => diffCardsOf(state), [state]);
  const pending = useMemo(() => pendingApprovalsOf(state), [state]);
  // M3a：agents 面板/agent 卡的投影源（agent 子流事件，零私有状态）+ usage 按 agent 分解
  const agentCols = useMemo(() => projectAgentPanel(state.events), [state]);
  const agentColsById = useMemo(() => Object.fromEntries(agentCols.map((a) => [a.agent_id, a])), [agentCols]);
  const tokensByAgent = useMemo(() => projectTokenUsageByAgent(state.events), [state]);
  const mergeTower = useMemo(() => projectMergeTower(state.events), [state]);
  // M4a：会话列表「定时」徽标 + 按任务过滤（origin 投影）
  const automationNames = useMemo(() => scheduledNamesOf(sessions), [sessions]);
  const visibleSessions = useMemo(
    () => sessions.filter((s) => scheduleFilter === "all" || (s.origin === "scheduled" && s.automationName === scheduleFilter)),
    [sessions, scheduleFilter],
  );

  // F7（审查 P2）：乐观更新——函数式 setState（同 tick 两次 patch 不丢更新）；失败回滚到
  // patch 前快照并显式记录（旧实现静默吞掉，UI 与持久化不一致且用闭包 settings 丢更新）。
  const patchSettings = (patch: Partial<AppSettings>): void => {
    if (!settings) return;
    const before = settings;
    setSettingsState((prev) => (prev ? { ...prev, ...patch } : prev));
    void window.agent.setSettings(patch).catch((err: unknown) => {
      console.error("[settings] 持久化失败（已回滚）:", err instanceof Error ? err.message : String(err));
      setSettingsState(before);
    });
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
  // F12（审查 P3）：防抖定时器卸载时清理（组件卸载后 patchLayout 的 setState 是空转）。
  useEffect(() => {
    return () => {
      if (layoutDebounce.current !== null) {
        clearTimeout(layoutDebounce.current);
        layoutDebounce.current = null;
      }
    };
  }, []);

  // ---- M4b：BYOK key / license / 更新 / 引导 handlers（window.agent 桥接 + state 刷新）----
  const refreshState = async (): Promise<void> => {
    setStatus(await window.agent.getState());
  };
  /** 保存 key 到钥匙串；返回 null = 成功（错误串供 UI 显示）。明文只经 IPC 传给主进程 safeStorage。 */
  const saveProviderKey = async (key: string): Promise<string | null> => {
    try {
      const r = await window.agent.providerKeySet("glm", key);
      await refreshState();
      return r.ok ? null : (r.error ?? "保存失败");
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  };
  const deleteProviderKey = async (): Promise<string | null> => {
    try {
      const r = await window.agent.providerKeyDelete("glm");
      await refreshState();
      return r.ok ? null : (r.error ?? "删除失败");
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  };
  const runUpdateCheck = (): void => {
    void window.agent
      .checkUpdate()
      .then(setUpdateResult)
      .catch((err: unknown) => setUpdateResult({ state: "error", message: err instanceof Error ? err.message : String(err) }));
  };
  const openDownload = (url: string): void => {
    void window.agent.openExternal(url).then((r) => {
      if (!r.ok) setUpdateResult({ state: "error", message: r.error ?? "打开下载页失败" });
    });
  };
  const rerunOnboarding = (): void => {
    patchSettings({ onboarded: false });
    setWizardOpen(true);
  };
  const finishOnboarding = (): void => {
    patchSettings({ onboarded: true });
    setWizardOpen(false);
  };

  const refreshSessions = async (): Promise<void> => {
    setSessions(await window.agent.listSessions());
  };

  // 活事件流 delta 缓冲（H3-P2 / F-4）：定义上移到会话操作之前——F2（审查 P1-15）：
  // 会话 reset 前必须收束缓冲，否则切换前缓冲的旧会话 delta 会在 reset 后 flush，
  // 合并进新会话时间线（"旧会话尾部 delta 落到新会话"）。
  const deltaBufRef = useRef<Extract<AgentEvent, { type: "assistant_delta" }>[]>([]);
  const deltaTimerRef = useRef<number | null>(null);
  const flushDeltaBuf = (): void => {
    if (deltaTimerRef.current !== null) {
      window.clearTimeout(deltaTimerRef.current);
      deltaTimerRef.current = null;
    }
    const buf = deltaBufRef.current;
    if (buf.length === 0) return;
    deltaBufRef.current = [];
    for (const d of buf) dispatch({ type: "event", e: d }); // dispatch 恒等，闭包捕获安全
  };

  // 会话切换：session:open → 重放投影（reset 全量折叠，与活流同一 foldEvent）
  // H3-P3（审查 F-3）：请求序号守卫——A→B 连点时 A 的迟到重放响应不得覆盖 B（reset 竞态）。
  const sessionSeqRef = useRef(0);
  const switchSession = async (id: string): Promise<void> => {
    if (state.running) return;
    const seq = ++sessionSeqRef.current;
    const { events } = await window.agent.openSession(id);
    if (seq !== sessionSeqRef.current) return; // 已有更新的切换请求：丢弃迟到响应
    flushDeltaBuf(); // F2：reset 前收束旧会话的流式尾巴（不冲进新时间线）
    setCurrentSession(id);
    dispatch({ type: "reset", events });
    await refreshSessions();
  };

  const createSession = async (): Promise<void> => {
    if (state.running) return; // F2（审查 P1-15）：三处会话操作统一 running 守卫（4.7 后按钮同已禁用，这里是兜底）
    const seq = ++sessionSeqRef.current;
    const { id } = await window.agent.createSession();
    if (seq !== sessionSeqRef.current) {
      await refreshSessions(); // 迟到的创建请求：只同步列表，不抢当前会话
      return;
    }
    flushDeltaBuf();
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
    if (state.running) return; // F2（审查 P1-15）：三处会话操作统一 running 守卫（4.7 后按钮同已禁用，这里是兜底）
    const seq = ++sessionSeqRef.current;
    const { currentSession: next } = await window.agent.deleteSession(id);
    if (seq !== sessionSeqRef.current) {
      await refreshSessions(); // 迟到的删除响应：只同步列表
      return;
    }
    flushDeltaBuf();
    setCurrentSession(next);
    if (next) {
      const seqOpen = ++sessionSeqRef.current;
      const { events } = await window.agent.openSession(next);
      if (seqOpen !== sessionSeqRef.current) {
        await refreshSessions();
        return;
      }
      dispatch({ type: "reset", events });
    } else {
      dispatch({ type: "reset", events: [] });
    }
    await refreshSessions();
  };

  // 启动：settings（布局/档位/主题/当前会话）+ 会话列表 + 沙箱状态 + 当前会话重放（重启还原）
  // F6（审查 P2）：任一 IPC reject 不再半初始化 + unhandled rejection——allSettled 分路兜底。
  useEffect(() => {
    void (async () => {
      const [s, list, st, info] = await Promise.allSettled([
        window.agent.getSettings(),
        window.agent.listSessions(),
        window.agent.getState(),
        window.agent.getProviderInfo(),
      ]);
      const fail = (label: string, reason: unknown): void =>
        console.error("[startup] " + label + " 失败:", reason instanceof Error ? reason.message : String(reason));
      const sVal = s.status === "fulfilled" ? s.value : null;
      const listVal = list.status === "fulfilled" ? list.value : [];
      if (s.status === "fulfilled") setSettingsState(sVal);
      else fail("getSettings", s.reason);
      if (list.status === "fulfilled") setSessions(listVal);
      else fail("listSessions", list.reason);
      if (st.status === "fulfilled") setStatus(st.value);
      else fail("getState", st.reason);
      if (info.status === "fulfilled") setProvider(info.value);
      else fail("getProviderInfo", info.reason);
      // M4b §2.4：首启（onboarded 缺省 false）弹新手引导；完成后不再弹
      if (sVal && !sVal.onboarded) setWizardOpen(true);
      const cur =
        sVal?.currentSession && listVal.some((x) => x.id === sVal.currentSession) ? sVal.currentSession : (listVal[0]?.id ?? null);
      if (cur) {
        const seq = ++sessionSeqRef.current; // 启动重放参与同一序号守卫（用户先点击则让位）
        const { events } = await window.agent.openSession(cur);
        if (seq !== sessionSeqRef.current) return;
        setCurrentSession(cur);
        dispatch({ type: "reset", events });
      }
    })();
  }, []);

  // 活事件流订阅（与重放同一 reducer 折叠管线）
  // H3-P2（审查 F-4/A-8）：流式 delta 按帧批量 dispatch——旧实现每个 delta 一次 dispatch，
  // 多个 O(n) 投影全量重算 → 整条流 O(n²)；缓冲一帧合并后每帧至多一次重渲染，折叠语义不变
  //（fold 对同 callId delta 是纯文本拼接）。非 delta 事件先冲缓冲再落本事件（保序）。
  // F1（审查 P1-14）：currentSession 的 ref 镜像——本 effect 挂载一次，闭包不能读 state，
  // 过滤逻辑用 ref（与 sessionSeqRef 同一口径）。
  const currentSessionIdRef = useRef<string | null>(null);
  useEffect(() => {
    currentSessionIdRef.current = currentSession;
  }, [currentSession]);
  useEffect(() => {
    // M4a：定时触发 = main 侧后台新建会话 → 活流收到 automation_triggered 即刷新会话列表（定时徽标实时出现）
    const offEvent = window.agent.onEvent((e) => {
      if (e.type === "automation_triggered") void refreshSessions(); // 定时徽标：跨会话事件也要刷新列表
      // F1（审查 P1-14）：agent:event 是全局无会话归因通道——定时/后台 run 的事件会串进
      // 当前时间线。带 session_id 的事件只折叠进匹配的当前会话（迟到路径守卫，与 seq 守卫同族）；
      // 无标记（旧脚本路径）保持全收（行为兼容）。跨会话例外（automation_*）见 store.foldsIntoCurrentSession（S1-5）。
      if (!foldsIntoCurrentSession(e, currentSessionIdRef.current)) return;
      if (e.type === "assistant_delta") {
        deltaBufRef.current.push(e);
        if (deltaTimerRef.current === null) {
          deltaTimerRef.current = window.setTimeout(flushDeltaBuf, 20);
        }
        return;
      }
      flushDeltaBuf();
      dispatch({ type: "event", e });
    });
    const offAsk = (a: AskPayload): void => {
      flushDeltaBuf();
      dispatch({ type: "ask", a });
    };
    const offDone = (d: AskOutcomePayload): void => {
      flushDeltaBuf();
      dispatch({ type: "askDone", d });
    };
    const un1 = window.agent.onAsk(offAsk);
    const un2 = window.agent.onAskDone(offDone);
    return () => {
      offEvent();
      un1();
      un2();
      flushDeltaBuf(); // 卸载前收束缓冲（不丢尾部 delta）
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
    // H2（审查 F-1）：send 全程兜底——IPC invoke 被拒（会话已删/通道抛错）时必须复位
    // running，否则 UI 永久停在「运行中」、输入框禁用且无恢复入口。
    try {
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
    } catch (err) {
      dispatch({ type: "running", running: false, error: "发送失败：" + (err instanceof Error ? err.message : String(err)) });
    }
  };

  // F8（审查 P2）：IPC reject 不再静默成 unhandled rejection——统一落 console.error（fail-visible）。
  const decide = (askId: string, approved: boolean, scope?: "once" | "session_kind" | "always"): void => {
    window.agent.decide(askId, approved, scope).catch((err: unknown) => console.error("[decide] 失败:", err instanceof Error ? err.message : String(err)));
  };

  const onCardAction = (action: string, data: unknown): void => {
    if (action === "form_submit") {
      const d = data as { callId: string; answers: ClarifyAnswerMap };
      window.agent.submitClarify(d.callId, d.answers).catch((err: unknown) => console.error("[clarify] 提交失败:", err instanceof Error ? err.message : String(err)));
    } else if (action === "plan_decide") {
      const d = data as { callId: string; approved: boolean };
      window.agent.decidePlan(d.approved, d.callId).catch((err: unknown) => console.error("[plan] 决议失败:", err instanceof Error ? err.message : String(err)));
    } else if (action === "jump_source") {
      // M2f：promote 卡「跳回源消息」——源定位在 sidechat 面板（origin 四字段即定位凭据）。
      // 这里只做可视化提示（面板打开后按 session/事件号定位），不改变主会话状态。
      const d = data as { sessionId: string; sourceEventIds: number[] };
      if (d && Array.isArray(d.sourceEventIds)) {
        void window.agent.sidechatState?.(d.sessionId).catch(() => {});
      }
    } else if (action === "merge_tower_merge" || action === "merge_tower_reject" || action === "merge_tower_comment") {
      // M3b：合并控制塔（批准合并/拒绝/行级评论）→ card_action 协议（合并唯一出口 = git 面板，§4.3）
      const d = data as { agentId: string; force?: boolean; keepBranch?: boolean; path?: string; line?: number; body?: string; sourceEventId?: number };
      void window.agent
        .cardAction({
          cardId: "diff:" + d.agentId,
          sourceEventId: d.sourceEventId ?? 0,
          cardType: "diff",
          action: action === "merge_tower_merge" ? "merge" : action === "merge_tower_reject" ? "reject" : "comment",
          payload:
            action === "merge_tower_merge"
              ? { force: d.force === true }
              : action === "merge_tower_reject"
                ? { keep_branch: d.keepBranch === true }
                : { path: d.path, line: d.line, body: d.body },
          targetAgentId: d.agentId,
        })
        .catch(() => {});
    } else if (action === "orphan_clean") {
      // M3b：孤儿 worktree 手动清理（§4.4.9 只列不自动删；清理 = 用户显式动作）
      const d = data as { name: string };
      void window.agent
        .cardAction({ cardId: "orphan:" + d.name, sourceEventId: 0, cardType: "orphan", action: "clean", payload: { name: d.name } })
        .catch(() => {});
    } else if (action === "agent_resume") {
      // M3c 卡死出口一（§4.4.8）：resume 清除 stuck 态 → card_action(resume, target_agent_id)
      const d = data as { agentId: string };
      const colR = agentColsById[d.agentId];
      void window.agent
        .cardAction({
          cardId: "agent_card:" + d.agentId,
          sourceEventId: colR?.parent_event_id ?? 0,
          cardType: "agent_card",
          action: "resume",
          targetAgentId: d.agentId,
        })
        .catch(() => {});
    } else if (action === "agent_respawn") {
      // M3c 崩溃恢复出口（§4.4.9）：重派 = card_action(respawn) 携原 spawn 参数
      const d = data as { agentId: string; respawn: Record<string, unknown> };
      void window.agent
        .cardAction({
          cardId: "recovery:" + d.agentId,
          sourceEventId: 0,
          cardType: "agent_result",
          action: "respawn",
          payload: { respawn: d.respawn },
        })
        .catch(() => {});
    } else if (action === "agent_cancel") {
      // M3a：agents 面板/agent 卡取消钮 → card_action(cancel, target_agent_id) → AbortController 树
      const d = data as { agentId: string };
      const col = agentColsById[d.agentId];
      void window.agent
        .cardAction({
          cardId: "agent_card:" + d.agentId,
          sourceEventId: col?.parent_event_id ?? 0,
          cardType: "agent_card",
          action: "cancel",
          targetAgentId: d.agentId,
        })
        .catch(() => {});
    } else if (action === "worker_approval") {
      // M3a：worker 审批卡（approval_requested）决议 → card_action(approval) → 审批协议解耦应答
      const d = data as { approvalId: string; approved: boolean; agentId?: string; scope?: "once" | "session_kind" | "always" };
      void window.agent
        .cardAction({
          cardId: "approval:" + d.approvalId,
          sourceEventId: 0,
          cardType: "approval",
          action: d.approved ? "approve" : "reject",
          payload: { approval_id: d.approvalId },
          scope: d.scope ?? "once",
          targetAgentId: d.agentId,
        })
        .catch(() => {});
    }
  };

  const lastTimeline = state.timeline[state.timeline.length - 1];
  const lastStreamText = lastTimeline?.kind === "stream" ? lastTimeline.text : undefined;

  // 右栏面板载荷：全部来自事件流/审批通道投影（无第二事实源）
  // F4（审查 P2）：memoryWritesOf 补 useMemo（旧实现面板关闭时每次渲染全量扫 events）。
  // F5/G6（审查 P2）：panelPayload 对象 memo 化——底下游投影不变时对象身份稳定，
  // 配合面板 React.memo 使非当前面板/未变化面板跳过重渲染（旧实现每次渲染重建字面量）。
  const memoryWrites = useMemo(() => memoryWritesOf(state), [state]);
  const panelPayload = useMemo(
    () => ({
      asks: pending.map((a) => ({ askId: a.askId, tool: a.tool, args: a.args, reason: a.reason, risk: a.risk })),
      tokens,
      diffs,
      memoryWrites,
      // M2f sidechat 面板自行经 getState 拉取最新快照（不在此透传启动期旧值，避免不刷新）
      eventCount: state.events.length,
      // M3a：多 agent 面板列 + token 按 agent 分解（纯事件流投影）
      agents: agentCols,
      tokensByAgent,
      // M3b：合并控制塔列（write worker 合并卡，纯事件流投影）
      mergeTower,
    }),
    [pending, tokens, diffs, memoryWrites, state.events.length, agentCols, tokensByAgent, mergeTower],
  );
  const activePanelId = settings?.layout.activePanel ?? null;
  const ActivePanel = activePanelId ? resolvePanel(activePanelId) : null;
  // F5：面板组件按类型 memo——payload/回调身份稳定时跳过重渲染（切换面板才重建包装）。
  const MemoActivePanel = useMemo(() => (ActivePanel ? memo(ActivePanel) : null), [ActivePanel]);
  // F5：onAction 经 ref 中转——身份稳定（memo 生效）但始终调用最新实现。
  const onActionImplRef = useRef<(action: string, data?: unknown) => void>(() => {});
  onActionImplRef.current = (action: string, data?: unknown): void => {
    if (action === "compact") void window.agent.compact?.();
    else if (action === "agent_cancel") onCardAction("agent_cancel", data);
    else if (action === "merge" || action === "reject" || action === "comment") onCardAction("merge_tower_" + action, data);
    else if (action === "orphan_clean") onCardAction("orphan_clean", data);
  };
  const stableOnAction = useCallback((action: string, data?: unknown): void => onActionImplRef.current(action, data), []);

  const renderTimelineItem = (it: TimelineItem): React.ReactNode => {
    if (it.kind === "event") return <EventView e={it.e} onAction={onCardAction} planStatuses={planStatuses} agentCols={agentColsById} clarifySubmitted={clarifySubmitted} />;
    if (it.kind === "stream") return <AssistantBubble content={it.text} running={state.running} />;
    return <AskView it={it} onDecide={decide} />;
  };

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <div className="flex items-center gap-2 px-2 py-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/15 font-mono text-[11px] font-semibold text-primary">M0</span>
            <span className="font-mono text-xs tracking-wide text-muted-foreground">agent</span>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel className="flex items-center justify-between px-2 font-mono text-[10px] tracking-wider text-muted-foreground">
              会话
              <Button size="icon-sm" variant="ghost" aria-label="新建会话" title={state.running ? "agent 运行中——先停止再新建会话" : "新建会话"} disabled={state.running} data-m1e-session-new="" onClick={() => void createSession()}>
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </SidebarGroupLabel>
            <SidebarGroupContent className="px-1">
              {automationNames.length > 0 && (
                <div className="flex items-center gap-1 px-1 pb-1" data-m4a-session-filter="">
                  <span className="text-[10px] text-muted-foreground">定时过滤</span>
                  <Select value={scheduleFilter} onValueChange={setScheduleFilter}>
                    <SelectTrigger className="h-6 w-32 text-[10px]" data-m4a-session-filter-select="">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">全部会话</SelectItem>
                      {automationNames.map((n) => (
                        <SelectItem key={n} value={n}>⏰ {n}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="flex max-h-64 flex-col gap-0.5 overflow-y-auto" data-m1e-session-list="">
                {visibleSessions.length === 0 && <div className="px-2 py-1 font-mono text-[11px] text-muted-foreground">（无会话）</div>}
                {visibleSessions.map((s) => (
                  <div
                    key={s.id}
                    className={
                      "group flex items-center gap-1 rounded-md px-2 py-1 font-mono text-[11.5px] " +
                      (s.id === currentSession ? "bg-primary/10 text-primary" : "text-foreground/75 hover:bg-accent hover:text-foreground")
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
                          className="min-w-0 flex-1 truncate text-left disabled:opacity-40"
                          title={(state.running ? "agent 运行中——先停止再切换会话｜" : "") + s.id + " · " + String(s.lines) + " 条事件"}
                          disabled={state.running}
                          onClick={() => void switchSession(s.id)}
                        >
                          {s.id}
                        </button>
                        {s.origin === "scheduled" && (
                          <Badge variant="outline" className="shrink-0 px-1 text-[9px]" data-m4a-scheduled-badge={s.automationName ?? ""}>
                            定时
                          </Badge>
                        )}
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
                            className="rounded p-0.5 hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent"
                            title={state.running ? "agent 运行中——先停止再删除会话" : "删除会话"}
                            disabled={state.running}
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
            <SidebarGroupLabel className="px-2 font-mono text-[10px] tracking-wider text-muted-foreground">运行状态</SidebarGroupLabel>
            <SidebarGroupContent className="px-2 text-[11px]">
              <div className="flex flex-col gap-1.5">
                {sandbox ? (
                  sandbox.available ? (
                    <Badge className="w-fit font-mono" variant="secondary">沙箱：Seatbelt</Badge>
                  ) : (
                    <Badge className="w-fit font-mono" variant="destructive">沙箱不可用：{sandbox.reason ?? "未知"}</Badge>
                  )
                ) : (
                  <Badge className="w-fit font-mono" variant="outline">沙箱检测中…</Badge>
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
          <Button variant="ghost" size="sm" className="w-full justify-start gap-2 font-mono text-xs" data-m1e-settings-open="" onClick={() => setSettingsOpen(true)}>
            <SettingsIcon className="h-3.5 w-3.5" />
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
              <header className="flex items-center gap-2 border-b border-border/70 bg-card/40 px-3 py-2">
                <SidebarTrigger />
                <Separator orientation="vertical" className="data-[orientation=vertical]:h-4" />
                <span className="font-mono text-xs text-muted-foreground">{currentSession ?? "未选择会话"}</span>
                {state.running && (
                  <span className="ml-auto inline-flex items-center gap-1.5 font-mono text-[11px] text-primary">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                    running
                  </span>
                )}
              </header>
              {state.error && (
                <div className="bg-destructive/10 px-4 py-2 text-xs text-destructive">运行失败：{state.error}</div>
              )}
              {sandbox && !sandbox.available && (
                <div className="bg-amber-500/10 px-4 py-2 text-xs text-amber-700 dark:text-amber-400">
                  ⚠️ 沙箱不可用：{sandbox.reason ?? "未知"} —— 已降级为无沙箱 + 写操作逐条强制审批
                </div>
              )}
              {license && license.state === "inactive" && (
                <div className="bg-amber-500/10 px-4 py-2 text-xs text-amber-700 dark:text-amber-400" data-m4b-license-banner="">
                  🔑 license 未激活：桌面 BYOK 版功能不受限（V1 收敛）。购买后把 license.json 放入应用数据目录；
                  状态见 设置 → 关于 / 更新。
                </div>
              )}
              <Conversation items={state.timeline} running={state.running} lastStreamText={lastStreamText} renderItem={renderTimelineItem} />
              <footer className="flex items-end gap-2 border-t border-border/70 bg-card/40 p-3">
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
                <Button size="lg" className="shrink-0" onClick={() => void send()} disabled={state.running || input.trim().length === 0}>
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
            <div className="flex h-full flex-col bg-card/30" data-m1e-right-panel="">
              <header className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
                <span className="font-mono text-[11px] tracking-wider text-muted-foreground">INSPECTOR</span>
                <div className="flex-1" />
                <span className="font-mono text-[11px] text-muted-foreground">{activePanelId ?? "closed"}</span>
                {activePanelId && (
                  <Button size="icon-sm" variant="ghost" aria-label="关闭面板" data-panel-close="" className="h-6 w-6" onClick={() => { if (settings && activePanelId) patchLayout({ activePanel: null, open: { ...settings.layout.open, [activePanelId]: false } }); }}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                )}
              </header>
              <div className="flex min-h-0 flex-1">
                {/* Codex 式 inspector 图标 rail（面板切换；data-* 断言面原样保留） */}
                <nav aria-label="面板切换" className="flex w-10 shrink-0 flex-col items-center gap-0.5 border-r border-border/60 py-2">
                  {(Object.keys(PANEL_ICONS) as PanelId[]).map((id) => {
                    const active = activePanelId === id;
                    const pendingCount = id === "approvals" ? pending.length : 0;
                    return (
                      <button
                        key={id}
                        data-panel-toggle={id}
                        aria-label={"切换到 " + id + " 面板"}
                        aria-pressed={active}
                        title={id}
                        className={
                          "relative flex h-8 w-8 items-center justify-center rounded-md transition-colors " +
                          (active ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground")
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
                </nav>
                <div className="min-h-0 flex-1 overflow-y-auto" data-panel-id={activePanelId ?? undefined}>
                  {MemoActivePanel && (
                    <MemoActivePanel payload={panelPayload} onAction={stableOnAction} />
                  )}
                </div>
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
        license={license}
        providerKeys={providerKeys}
        aboutVersion={aboutVersion}
        updateResult={updateResult}
        onSettings={patchSettings}
        onCheckUpdate={runUpdateCheck}
        onOpenDownload={openDownload}
        onSaveKey={saveProviderKey}
        onDeleteKey={deleteProviderKey}
        onRerunOnboarding={rerunOnboarding}
      />
      <OnboardingWizard
        open={wizardOpen}
        onOpenChange={(open: boolean) => {
          // F12（审查 P3）：X 关闭视同"跳过"——落 onboarded:true，否则下次启动重复弹
          //（与"每步可跳过"语义一致）；完成路径 onFinish 同样落 true，二者幂等。
          if (!open) patchSettings({ onboarded: true });
          setWizardOpen(open);
        }}
        settings={settings}
        sandbox={sandbox}
        license={license}
        providerKeys={providerKeys}
        appVersion={aboutVersion}
        onSettings={patchSettings}
        onFinish={finishOnboarding}
      />
    </SidebarProvider>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
