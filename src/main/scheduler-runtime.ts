// M4a 定时任务调度器接线（§12.2）——拆分面（同 provider-key-inject 先例）：实现从 agent-runner.ts
// 搬来本轻模块，装配根按原路径继续导出，调用方零改动。
// 触发 = 全新会话走既有 createSession（调度器内）+ 真实 run 代码路径；主时间线落流 = 当前会话
// append（有则落）+ UI 推送；journal 始终留账（双轨之二）。
// 本模块不反向依赖装配根：它需要装配根的四处活状态，由装配根启动时 `setSchedulerRuntimeDeps`
// 注入（同 settings-handlers 的 `setSettingsHostDeps` 形态）。
import { join } from "node:path";
import { projectAgentPath } from "../app-data";
import { createEventLog, type AgentEvent } from "../events";
import { TOOLS, type Tool, type ToolResult } from "../tools";
import type { AskGate } from "./ask-gate";
import { isUnattendedTier, validateAutomation } from "./automations";
import {
  loadAutomationsFile,
  normalizeHistoryFilter,
  Scheduler,
  type ScheduleSnapshot,
  type TriggerExecutor,
  type TriggerExecutorArgs,
} from "./scheduler";
import { getSessionsDir } from "./session-handlers";
import { pathOf } from "./sessions";
import { store } from "./settings-handlers";

export interface SchedulerRuntimeDeps {
  /** initScheduler 未显式给 workspace 时的回退（装配根的工作区常量）。 */
  defaultWorkspace: () => string;
  /** 事件推给壳（`hooks.onEvent` 的活转发：钩子可在首场 run 之后才注册/取消注册）。 */
  onEvent: (e: AgentEvent, logPath?: string) => void;
  /** 触发执行器：真实代码路径（装配根 `handleAgentRun` + unattended 覆盖 + signal 透传）。 */
  runSession: (workspace: string, args: TriggerExecutorArgs) => Promise<{ ok: boolean; error?: string }>;
  /** 会话审批面（每次审批活读；无会话 = null，fail-closed）。只需 `askGate` 一位。 */
  currentSession: () => { askGate: AskGate | null } | null;
}

let deps: SchedulerRuntimeDeps | null = null;
/** 装配根启动时注入（可重入：`vi.resetModules` 重组判卷时按新装配根重注）。 */
export function setSchedulerRuntimeDeps(d: SchedulerRuntimeDeps): void {
  deps = d;
}
function D(): SchedulerRuntimeDeps {
  if (!deps) throw new Error("scheduler-runtime: 装配根未注入依赖（唯一入口 setSchedulerRuntimeDeps）");
  return deps;
}

let scheduler: Scheduler | null = null;
let scheduleCapCache = 2;
/** 本进程**有没有起过**调度器（只置真、永不回退；`stopScheduler` 也不清）。
 *  为什么不直接读 `getScheduler() !== null`：那个槽会随 stop 变 null，而它喂的是执行面
 *  `installAppTools`（只让第一个调用赢）——一场判假、下一场判真就是「模型看得见却调不到」
 *  （或反过来那句），正是本仓点名的失败形状。这里要的是**单调**真值：起过就永远算用得上。 */
let everInitialized = false;
/** 单调真值的读端（喂装配根的 `installTimeAutomationFace` 判据）。 */
export function schedulerEverStarted(): boolean {
  return everInitialized;
}

/** 定时任务的数据目录：调度器装载与挂载判据读**同一个式子**（两份字面量迟早漂）。 */
export function scheduleDataDir(workspace: string): string {
  return projectAgentPath(workspace, "schedules");
}

/** shell / 验收脚本初始化调度器（幂等）。 */
export function initScheduler(opts: {
  dataDir: string;
  sessionsDir: string;
  workspace?: string;
  clock?: () => number;
  jitterMs?: () => number;
  cap?: number;
}): void {
  // 单调真值先置（下面那句 `if (scheduler) return` 的幂等路径也要认）：这一句之后
  // `installTimeAutomationFace` 在本进程余生都判真，五件的说明书就一直在两面挂着。
  everInitialized = true;
  if (scheduler) return;
  if (opts.cap !== undefined) scheduleCapCache = opts.cap;
  const ws = opts.workspace ?? D().defaultWorkspace();
  scheduler = new Scheduler({
    dataDir: opts.dataDir,
    sessionsDir: opts.sessionsDir,
    workspace: ws,
    // M4a 触发执行器（真缺陷修复，schedule-check F 段抓出）：makeScheduledExecutor 已导出但从未接线，
    // 生产路径每次触发都会落「调度器未接线执行器（fail-closed）」——触发 = 全新会话的真实代码路径由此接通。
    runSession: makeScheduledExecutor(ws),
    ...(opts.clock ? { clock: opts.clock } : {}),
    ...(opts.jitterMs ? { jitterMs: opts.jitterMs } : {}),
    getCap: () => scheduleCapCache,
    emitTimeline: async (e: AgentEvent) => {
      const cur = (await store().get()).currentSession;
      const sdir = getSessionsDir();
      const logPath = sdir && cur ? pathOf(sdir, cur) : undefined;
      if (logPath) await createEventLog(logPath).append(e);
      D().onEvent(e, logPath);
    },
  });
}

export function getScheduler(): Scheduler | null {
  return scheduler;
}

export async function startScheduler(): Promise<void> {
  // 并发上限从 settings 预热（getCap 为同步读缓存）
  try {
    const s = await store().get();
    scheduleCapCache = s.scheduleConcurrencyCap;
  } catch {
    /* 缺省 2 */
  }
  return scheduler?.start();
}

export function stopScheduler(): void {
  // 只停计时器：**不**清 `everInitialized`——那是单调挂载判据，清了就会「第一场判真装了执行面、
  // 后一场判假摘掉说明书」= 调得到却看不见（本仓点名的另一半失败形状）。
  scheduler?.stop();
}

export function schedulerRunning(): boolean {
  return scheduler?.running ?? false;
}

/** 设置页并发上限变更 → 调度器即时生效（setSettings 转发）。 */
export function updateScheduleCap(cap: number): void {
  if (Number.isInteger(cap) && cap >= 1 && cap <= 8) scheduleCapCache = cap;
}

/** 调度器触发的在跑 run 数（宿主退出闸/并发读数用）：调度执行器不经过 host.run，
 *  旧实现 `runningCount()` 恒看不见它们 ⇒ ⌘Q 不提示直接退出、runCancel 恒答「不在运行」。 */
let scheduledRunsInFlight = 0;
export function scheduledRunCount(): number {
  return scheduledRunsInFlight;
}

/** 定时触发执行器（真实代码路径）：装配根注入的 run 入口 + unattended 覆盖 + signal 透传。 */
export function makeScheduledExecutor(workspace: string): TriggerExecutor {
  return (args) => {
    scheduledRunsInFlight += 1;
    return D().runSession(workspace, args).finally(() => {
      scheduledRunsInFlight = Math.max(0, scheduledRunsInFlight - 1);
    });
  };
}

export async function handleScheduleSnapshot(rawFilter?: unknown): Promise<ScheduleSnapshot> {
  // 筛选值来自渲染层的下拉框（跨进程输入面）；合法性与归一都在 scheduler 那一处（防第二份谓词）
  if (!scheduler) return { tasks: [], history: [], running: 0, queued: 0, cap: scheduleCapCache, startupDone: false, tzNotes: {} };
  return scheduler.snapshot(normalizeHistoryFilter(rawFilter));
}

export async function handleScheduleUpsert(raw: unknown, form = true): Promise<{ ok: boolean; error?: string }> {
  if (!scheduler) return { ok: false, error: "调度器未初始化（fail-closed）" };
  const r = await scheduler.upsert(raw, { form });
  return r.ok ? { ok: true } : { ok: false, error: r.errors.join("；") };
}

export async function handleScheduleDelete(id: string): Promise<{ ok: boolean; error?: string }> {
  if (!scheduler) return { ok: false, error: "调度器未初始化（fail-closed）" };
  return scheduler.remove(id);
}

export async function handleScheduleRunNow(id: string): Promise<{ ok: boolean; error?: string }> {
  if (!scheduler) return { ok: false, error: "调度器未初始化（fail-closed）" };
  return scheduler.runNow(id);
}

/** agent 工具五件的实现（§12.2.5）：validate 先行 → 审批卡（全文展示 + 红字判定）→ 落库。 */
export function installAutomationTools(): void {
  const table = TOOLS as unknown as Record<string, Tool>;
  const approval = async (tool: string, args: Record<string, unknown>, redNote: boolean, signal?: AbortSignal): Promise<ToolResult | null> => {
    const s = D().currentSession();
    if (!s) return { ok: false, output: "[permission denied] " + tool + "（工具门未接线，fail-closed）" };
    if (!s.askGate) return { ok: false, output: "[permission denied] " + tool + "（非交互模式，fail-closed）" };
    const reason =
      "定时任务变更（审批卡全文展示）" +
      (redNote ? " ⚠ 将无人值守执行：触发时一切审批请求自动拒绝（fail-closed）" : "");
    // 审查 4.3 同口径：定时任务审批卡也接运行信号（取消即按拒绝收束，不留 60s 僵尸卡）
    const r = await s.askGate.request(tool, args, { reason, risk: "medium", signal });
    if (r.outcome !== "approved") {
      const why = r.reason === "unattended" ? "无人值守 fail-closed：审批请求自动拒绝" : "未获批准";
      return { ok: false, output: "[permission denied] " + tool + "（" + why + "）" };
    }
    return null;
  };
  const needScheduler = (): ToolResult | null =>
    scheduler ? null : { ok: false, output: "调度器未初始化（fail-closed）" };
  table["automation_create"] = {
    name: "automation_create",
    async run(args, ctx) { // 审查 4.3：接运行信号（审批卡随取消收束）
      const v = validateAutomation(args, { form: true });
      if (!v.ok) return { ok: false, output: "automation_create 参数无效：" + v.errors.join("；") };
      const denial = await approval("automation_create", args, isUnattendedTier(v.value.permissionTier), ctx.signal);
      if (denial) return denial;
      const ns = needScheduler();
      if (ns) return ns;
      const r = await scheduler!.upsert(args, { form: true });
      return r.ok
        ? { ok: true, output: "已创建定时任务 " + r.value.name + "（id=" + r.value.id + "，permissionTier=" + r.value.permissionTier + "，下次触发 " + (r.value.nextRunAt ?? "无") + "）" }
        : { ok: false, output: "automation_create 失败：" + r.errors.join("；") };
    },
  };
  table["automation_update"] = {
    name: "automation_update",
    async run(args, ctx) { // 审查 4.3：接运行信号（审批卡随取消收束）
      const ns0 = needScheduler();
      if (ns0) return ns0;
      const sch = scheduler!;
      const id = typeof args.id === "string" ? args.id : "";
      if (id === "") return { ok: false, output: "automation_update: id 必填" };
      const cur = sch.list().find((t) => t.id === id);
      if (!cur) return { ok: false, output: "automation_update: 任务不存在 " + id };
      const merged = { ...cur, ...args, id, createdAt: cur.createdAt, updatedAt: cur.updatedAt };
      const v = validateAutomation(merged, { form: true });
      if (!v.ok) return { ok: false, output: "automation_update 合并后无效：" + v.errors.join("；") };
      const denial = await approval("automation_update", { ...v.value }, isUnattendedTier(v.value.permissionTier), ctx.signal);
      if (denial) return denial;
      const r = await sch.upsert(v.value, { form: true });
      return r.ok
        ? { ok: true, output: "已更新定时任务 " + r.value.name + "（id=" + r.value.id + "）" }
        : { ok: false, output: "automation_update 失败：" + r.errors.join("；") };
    },
  };
  table["automation_delete"] = {
    name: "automation_delete",
    async run(args, ctx) { // 审查 4.3：接运行信号（审批卡随取消收束）
      const ns0 = needScheduler();
      if (ns0) return ns0;
      const sch = scheduler!;
      const id = typeof args.id === "string" ? args.id : "";
      if (id === "") return { ok: false, output: "automation_delete: id 必填" };
      const cur = sch.list().find((t) => t.id === id);
      const denial = await approval("automation_delete", { id, ...(cur ? { name: cur.name } : {}) }, false, ctx.signal);
      if (denial) return denial;
      const r = await sch.remove(id);
      return r.ok ? { ok: true, output: "已删除定时任务 " + id } : { ok: false, output: "automation_delete 失败：" + (r.error ?? "未知") };
    },
  };
  table["automation_run_now"] = {
    name: "automation_run_now",
    async run(args, ctx) { // 审查 4.3：接运行信号（审批卡随取消收束）
      const ns0 = needScheduler();
      if (ns0) return ns0;
      const id = typeof args.id === "string" ? args.id : "";
      if (id === "") return { ok: false, output: "automation_run_now: id 必填" };
      const denial = await approval("automation_run_now", { id }, false, ctx.signal);
      if (denial) return denial;
      const r = await scheduler!.runNow(id);
      return r.ok ? { ok: true, output: "已手动触发 " + id + "（走准入管线：去重/并发/重叠闸生效）" } : { ok: false, output: "automation_run_now：" + (r.error ?? "未知") };
    },
  };
  table["automation_list"] = {
    name: "automation_list",
    async run() {
      const ns0 = needScheduler();
      if (ns0) return ns0;
      const tasks = scheduler!.list().map((t) => ({
        id: t.id, name: t.name, kind: t.schedule.kind, timeZone: t.timeZone,
        permissionTier: t.permissionTier, catchUp: t.catchUp, enabled: t.enabled, nextRunAt: t.nextRunAt,
      }));
      return { ok: true, output: JSON.stringify(tasks, null, 2) };
    },
  };
}

/** 该工作区盘上有没有**已落盘的定时任务**（`<workspace>/.agent/schedules/automations.json`）。
 *  口径与 `searchConfigured` 同形：判据复用被度量方自己的装载器（`loadAutomationsFile`），
 *  不再抄第二份谓词——文件不存在 / 空 / 坏 JSON / 条目全无效，装载器给的就是空清单 ⇒ 判假。
 *  为什么读盘而不是读设置：五件要 `initScheduler` 才有意义（tick 60s / 补跑 7 天 / 并发闸 ≤2），
 *  而"这个工作区排过任务"是这件事唯一能在盘上核对的事实；它也让摘除**自动可逆**——
 *  一旦有人（UI 或 `--serve`）落下第一条任务，下一场 run 就自己挂回来，不需要新发明一个设置项。 */
export async function automationsScheduled(workspace: string): Promise<boolean> {
  const { tasks } = await loadAutomationsFile(join(scheduleDataDir(workspace), "automations.json"))
    .catch(() => ({ tasks: [], warnings: [] })); // 装载器自己已 fail-closed，这里只兜路径异常
  return tasks.length > 0;
}
