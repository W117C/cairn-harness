import { useEffect, useRef, useState } from "react";
import type { OrchestrationAddress, OrchestrationResponse, OrchestrationSnapshot } from "../../../../../src/main/orchestration-service";
import type { ControlAction, ControlCommand, OrchPlan, PlanView } from "../../../../../src/orchestration/types";
import "./orchestration-pane.css";

/** The simple editor deliberately grants read-only capability; imported plans retain their own contract. */
export function buildReadPlan(input: { id: string; goal: string; tasks: string; budget: number; sequential: boolean }): OrchPlan {
  const goals = input.tasks.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!input.goal.trim() || goals.length === 0 || goals.length > 64 || !Number.isFinite(input.budget) || input.budget <= 0) throw new Error("请填写目标、1–64 个任务和大于 0 的美元预算。");
  return {
    plan_id: input.id, version: 1, goal: input.goal.trim(), non_goals: [], domain: "generic", created_by: "user",
    policy_ref: "desktop-read-only-v1", budget: { usd: input.budget }, max_concurrency: 1,
    agents: [{ agent_spec_id: "reader", role: "只读分析", max_turns: 8, capability: {
      tools: ["read_file", "grep", "glob"], fs_read: ["."], fs_write: [], network: [], shell: "none", git: "none", external_effects: "none",
    } }],
    tasks: goals.map((goal, i) => ({
      task_id: `task-${String(i + 1)}`, goal, non_goals: [], agent_spec: "reader", lane: "read",
      depends_on: input.sequential && i > 0 ? [`task-${String(i)}`] : [], write_scopes: [], inputs: [],
      contract: { effect: "none", acceptance: [{ kind: "evidence", id: "repository", fields: ["file_count", "revision"] }] },
      budget: { usd: input.budget / goals.length }, max_attempts: 2, priority: 0,
    })),
  };
}

const money = (value: number): string => Number.isFinite(value) ? `$${value.toFixed(4)}` : "未知";
const actions: readonly [ControlAction, string][] = [["approve_plan", "批准"], ["reject_plan", "拒绝"], ["pause_plan", "暂停"], ["resume_plan", "恢复"], ["cancel_plan", "取消计划"]];

export function OrchestrationSnapshotView(props: {
  snapshot: OrchestrationSnapshot;
  pending: boolean;
  onControl: (plan: PlanView, action: ControlAction, taskId?: string, execute?: boolean) => void;
}): React.JSX.Element {
  const { snapshot } = props;
  return <>
    <div className="orch-mode"><strong>{snapshot.mode === "execute" ? "执行模式" : "预览模式（shadow）"}</strong><span>后端：{snapshot.backend ?? "未连接"}</span></div>
    {snapshot.execution_unavailable && <p className="orch-notice">{snapshot.execution_unavailable}</p>}
    {snapshot.error && <p className="orch-error" role="alert">运行异常：{snapshot.error}</p>}
    {snapshot.view.anomalies.length > 0 && <div className="orch-error" role="alert"><strong>事件异常</strong><ul>{snapshot.view.anomalies.map((item, i) => <li key={i}>{item}</li>)}</ul></div>}
    {Object.values(snapshot.view.plans).length === 0 && <p className="orch-notice">本会话没有编排计划。填写目标与任务，或导入已有计划。</p>}
    {Object.values(snapshot.view.plans).map(plan => <section className="orch-plan" key={`${plan.plan.plan_id}:${String(plan.plan.version)}`} aria-label={`计划 ${plan.plan.goal}`}>
      <div className="orch-plan-title"><strong>{plan.plan.goal}</strong><span>{plan.phase}</span></div>
      <p className="orch-meta">{plan.plan.plan_id} · v{String(plan.plan.version)} · 预算 {money(plan.plan.budget.usd)} · 已用 {money(plan.spent_usd)} · 预留 {money(plan.reserved_usd)}</p>
      <div className="orch-actions">
        {actions.map(([action, label]) => <button type="button" className="mini-btn" key={action} disabled={props.pending} onClick={() => props.onControl(plan, action)}>{label}</button>)}
        {snapshot.mode === "shadow" && <button type="button" className="mini-btn" disabled={props.pending || snapshot.backend === null || plan.phase !== "approved" || Boolean(snapshot.execution_unavailable)} onClick={() => props.onControl(plan, "resume_plan", undefined, true)}>启用执行</button>}
      </div>
      <ul className="orch-tasks">{Object.values(plan.tasks).map(item => <li key={item.task.task_id}>
        <div className="orch-plan-title"><span>{item.task.goal}</span><code>{item.phase}</code></div>
        <p className="orch-meta">{item.task.task_id} · 尝试 {String(item.attempt)}/{String(item.task.max_attempts)} · 证据 {item.evidence} · 裁决 {item.verdict ?? "未知"}</p>
        <p className="orch-meta">依赖：{item.task.depends_on.join("、") || "无"} · 预算 {money(item.task.budget.usd)} · 已用 {money(item.spent_usd)} · 预留 {money(item.reserved_usd)}</p>
        {item.reason && <p className="orch-error">{item.reason}</p>}
        {item.summary && <details><summary>产出摘要</summary><p className="orch-summary">{item.summary}</p></details>}
        {item.artifacts && item.artifacts.length > 0 && <details><summary>产物引用 · {String(item.artifacts.length)}</summary><ul>{item.artifacts.map((artifact, i) => <li key={i}><code>{artifact.id}</code> · {artifact.kind}{artifact.hash ? ` · ${artifact.hash}` : ""}</li>)}</ul></details>}
        <details><summary>能力与验收</summary><div className="orch-detail">
          <p>权限：{item.task.lane} · 写入范围：{item.task.write_scopes.join("、") || "无"} · 外部效果：{item.task.contract.effect}</p>
          <ul>{item.task.contract.acceptance.map(check => <li key={check.id}>{check.id} · {check.kind}{check.kind === "human" ? ` · ${check.instruction}` : check.kind === "command" ? ` · ${check.run}` : check.kind === "evidence" ? ` · ${check.fields.join("、")}` : ` · ${check.artifact_id}`}</li>)}</ul>
          <p>修订：{item.revision ?? "未知"} · 验证者：{item.verifier_id ?? "未知"}</p>
        </div></details>
        <div className="orch-actions">{([["retry_task", "重试"], ["takeover_task", "接管"], ["pause_task", "暂停任务"], ["resume_task", "恢复任务"], ["cancel_task", "取消任务"], ["merge_task", "合并交付"], ["reject_merge", "拒绝交付"]] as const).map(([action, label]) => <button type="button" className="mini-btn" key={action} disabled={props.pending} aria-label={`${label}任务 ${item.task.task_id}`} onClick={() => props.onControl(plan, action, item.task.task_id)}>{label}</button>)}</div>
      </li>)}</ul>
    </section>)}
    {snapshot.next_actions.length > 0 && <details className="orch-next"><summary>调度建议 · {String(snapshot.next_actions.length)}</summary><ul>{snapshot.next_actions.map((action, i) => <li key={i}>{action.task_id} · {action.kind}{action.reason ? ` · ${action.reason}` : ""}</li>)}</ul></details>}
  </>;
}

export function OrchestrationPane(props: { workspace: string | null; sessionId: string | null; active?: boolean }): React.JSX.Element {
  const key = props.workspace && props.sessionId ? JSON.stringify([props.workspace, props.sessionId]) : null;
  const keyRef = useRef(key); keyRef.current = key;
  const [result, setResult] = useState<{ key: string; snapshot: OrchestrationSnapshot } | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const [pending, setPending] = useState<{ key: string; id: string } | null>(null);
  const pendingRef = useRef<string | null>(null);
  const [goal, setGoal] = useState("");
  const [tasks, setTasks] = useState("");
  const [budget, setBudget] = useState("1");
  const [sequential, setSequential] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const requestSeq = useRef(0);
  const address: OrchestrationAddress | null = props.workspace && props.sessionId ? { workspace: props.workspace, sessionId: props.sessionId } : null;
  const snapshot = result?.key === key ? result.snapshot : null;
  const busy = pending?.key === key && key !== null;
  const accept = (response: OrchestrationResponse, target: string): void => {
    if (keyRef.current !== target) return;
    if (!response.ok) { setError({ key: target, message: response.error }); return; }
    setResult({ key: target, snapshot: response.snapshot });
  };
  useEffect(() => {
    if (!key || !address || props.active === false) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async (): Promise<void> => {
      if (pendingRef.current === key) { timer = setTimeout(() => { void load(); }, 2000); return; }
      const seq = ++requestSeq.current;
      try {
        const response = await window.agent.orchestrationView(address);
        if (!disposed && seq === requestSeq.current) accept(response, key);
      } catch (err) {
        if (!disposed && keyRef.current === key) setError({ key, message: err instanceof Error ? err.message : String(err) });
      }
      if (!disposed) timer = setTimeout(() => { void load(); }, 2000);
    };
    void load();
    return () => { disposed = true; if (timer) clearTimeout(timer); };
  }, [key, props.active, refresh]);

  const mutate = async (operation: (target: OrchestrationAddress) => Promise<OrchestrationResponse>): Promise<void> => {
    if (!key || !address || busy) return;
    const target = key;
    const id = crypto.randomUUID();
    requestSeq.current += 1;
    pendingRef.current = target; setPending({ key: target, id }); setError(null);
    try { accept(await operation(address), target); }
    catch (err) { if (keyRef.current === target) setError({ key: target, message: err instanceof Error ? err.message : String(err) }); }
    finally { if (pendingRef.current === target) pendingRef.current = null; setPending(previous => previous?.id === id ? null : previous); if (keyRef.current === target) setRefresh(n => n + 1); }
  };
  const control = (plan: PlanView, action: ControlAction, taskId?: string, execute?: boolean): void => {
    const command: ControlCommand = { request_id: crypto.randomUUID(), plan_id: plan.plan.plan_id, version: plan.plan.version, action, ...(taskId ? { task_id: taskId } : {}) };
    void mutate(async target => {
      if (execute && action === "resume_plan" && plan.phase === "approved") {
        const paused = await window.agent.orchestrationControl({ address: target, command: { ...command, action: "pause_plan", request_id: crypto.randomUUID() } });
        if (!paused.ok) return paused;
      }
      return window.agent.orchestrationControl({ address: target, command, ...(execute ? { execute: true } : {}) });
    });
  };
  const submit = (): void => {
    try {
      const plan = buildReadPlan({ id: `plan-${crypto.randomUUID()}`, goal, tasks, budget: Number(budget), sequential });
      void mutate(target => window.agent.orchestrationSubmit({ address: target, request_id: crypto.randomUUID(), plan }));
    } catch (err) { if (key) setError({ key, message: err instanceof Error ? err.message : String(err) }); }
  };
  const importPlan = async (file: File): Promise<void> => {
    const target = key;
    try {
      if (file.size > 1024 * 1024) throw new Error("计划文件不能超过 1 MB。");
      const plan: unknown = JSON.parse(await file.text());
      if (keyRef.current === target) void mutate(address => window.agent.orchestrationSubmit({ address, request_id: crypto.randomUUID(), plan }));
    } catch (err) { if (target && keyRef.current === target) setError({ key: target, message: err instanceof Error ? err.message : String(err) }); }
  };
  return <section className="orchestration-pane" aria-label="任务编排">
    <div className="orch-plan-title"><h3>任务编排</h3><button type="button" className="mini-btn" disabled={!key || busy} onClick={() => { setError(null); setRefresh(n => n + 1); }}>刷新</button></div>
    {!key ? <p className="orch-notice">先选择工作区并打开一个会话，再创建编排计划。</p> : <>
      <p className="orch-address" title={props.workspace ?? undefined}>{props.sessionId} · {props.workspace}</p>
      {error?.key === key && <p role="alert" className="orch-error">操作失败：{error.message}</p>}
      {snapshot ? <OrchestrationSnapshotView snapshot={snapshot} pending={busy} onControl={control} /> : error?.key === key ? <p className="orch-notice">读取未完成，请刷新重试。</p> : <p role="status">正在读取编排状态…</p>}
      <details className="orch-editor"><summary>新建 / 导入计划</summary><form onSubmit={event => { event.preventDefault(); submit(); }}>
        <p className="orch-notice">表单创建只读任务。先预览并批准，再单独启用执行；写入任务请导入带能力与验收约束的计划。</p>
        <label>目标<input value={goal} required maxLength={2000} onChange={event => setGoal(event.target.value)} /></label>
        <label>任务（每行一个）<textarea value={tasks} required rows={4} maxLength={32000} onChange={event => setTasks(event.target.value)} /></label>
        <label>总预算（美元）<input type="number" min="0.01" step="0.01" required value={budget} onChange={event => setBudget(event.target.value)} /></label>
        <label className="orch-check"><input type="checkbox" checked={sequential} onChange={event => setSequential(event.target.checked)} />按顺序执行（后项依赖前项）</label>
        <div className="orch-actions"><button type="submit" className="mini-btn" disabled={busy}>提交预览</button><label className="orch-import">导入计划文件<input type="file" accept="application/json,.json" disabled={busy} onChange={event => { const file = event.target.files?.[0]; if (file) void importPlan(file); event.target.value = ""; }} /></label></div>
      </form></details>
    </>}
  </section>;
}
