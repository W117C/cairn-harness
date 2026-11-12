import { useEffect, useMemo, useState } from "react";
import type { IdleTask, IdleTaskAction, IdleTaskInput, IdleTaskSnapshot, IdleTaskStatus } from "../../../../../src/main/idle-tasks";
import { fullTime } from "../memory-view";
import { PAGE_CONTEXT_ITEMS } from "../navigation";
import { PageFrame } from "./PageFrame";

const statusLabels: Record<IdleTaskStatus, string> = {
  queued: "等待空闲", paused: "已暂停", running: "运行中", succeeded: "已完成", failed: "失败", cancelled: "已取消",
};

function IdleTaskRow(props: { task: IdleTask; busy: boolean; update: (id: string, action: IdleTaskAction) => void }): React.JSX.Element {
  const { task, busy, update } = props;
  return (
    <li className="idle-task-row">
      <details>
        <summary><strong>{task.name}</strong> <span className="sp-tag">{statusLabels[task.status]}</span></summary>
        <p className="ap-prompt">{task.prompt}</p>
        {task.error !== undefined && <p className="sp-dim">{task.error === "interrupted" ? "上次运行中断，未自动重试。" : task.error}</p>}
        <p className="sp-dim">更新于 {fullTime(task.updatedAt)}{task.sessionId === undefined ? "" : ` · 会话 ${task.sessionId}`}</p>
      </details>
      <div className="idle-task-actions">
        {task.status === "queued" && <button className="mini-btn" disabled={busy} onClick={() => update(task.id, "pause")}>暂停</button>}
        {task.status === "paused" && <button className="mini-btn" disabled={busy} onClick={() => update(task.id, "resume")}>继续</button>}
        {(task.status === "queued" || task.status === "paused" || task.status === "running")
          && <button className="mini-btn" disabled={busy} onClick={() => update(task.id, "cancel")}>取消任务</button>}
      </div>
    </li>
  );
}

export function IdleTaskPane({ tabs, filter, onFilter }: { tabs: React.ReactNode; filter: string; onFilter: (filter: string) => void }): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<IdleTaskSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [tier, setTier] = useState<IdleTaskInput["permissionTier"]>("read-only");
  const [revision, setRevision] = useState(0);
  const refresh = () => setRevision((value) => value + 1);

  useEffect(() => {
    let alive = true;
    let reading = false;
    const read = async () => {
      if (reading) return;
      reading = true;
      try {
        const next = await window.agent.idleTaskList();
        if (alive) {
          setSnapshot(next);
          setLoadError(null);
        }
      } catch (err) {
        if (alive) setLoadError(err instanceof Error ? err.message : String(err));
      } finally {
        reading = false;
      }
    };
    void read();
    const timer = window.setInterval(() => { void read(); }, 3000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [revision]);

  const submit = async (action: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) => {
    setBusy(true);
    setActionError(null);
    try {
      const result = await action();
      if (!result.ok) throw new Error(result.error ?? "闲时任务操作失败");
      after?.();
      refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  // 第 1123 页：轮询快照/筛选项不变时，列表筛选与历史排序不随表单输入重跑。
  const tasks = useMemo(() => snapshot?.tasks ?? [], [snapshot]);
  const active = useMemo(() => tasks.filter((task) => task.status === "queued" || task.status === "paused" || task.status === "running")
    .filter((task) => filter === "off" ? task.status === "paused" : filter === "on" ? task.status !== "paused" : true), [tasks, filter]);
  const history = useMemo(() => tasks.filter((task) => task.status === "succeeded" || task.status === "failed" || task.status === "cancelled")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [tasks]);
  const update = (id: string, action: IdleTaskAction) => { void submit(() => window.agent.idleTaskUpdate(id, action)); };

  return (
    <PageFrame title="自动化" titleAccent="工作流" actions={tabs} onRefresh={refresh}
      filters={PAGE_CONTEXT_ITEMS.automation} activeFilter={filter} onFilter={onFilter}
      subtitle="电脑保持唤醒、Cairn 空闲时执行；模型调用按服务商规则计费。">
      <section className="idle-task-section" aria-label="本地闲时队列">
        <div className="idle-task-heading">
          <div>
            <h2>本地闲时队列</h2>
            {snapshot !== null && <p className="sp-dim" title={snapshot.workspace}>工作区 {snapshot.workspace}</p>}
          </div>
          <button className="mini-btn primary" disabled={snapshot === null || loadError !== null || busy} aria-expanded={creating}
            onClick={() => setCreating(!creating)}>{creating ? "收起表单" : "加入队列"}</button>
        </div>
        {loadError !== null && <p role="alert">{loadError}</p>}
        {actionError !== null && <p role="alert">{actionError}</p>}
        {creating && (
          <form className="ap-form" onSubmit={(event) => {
            event.preventDefault();
            void submit(() => window.agent.idleTaskEnqueue({ name: name.trim(), prompt, permissionTier: tier }), () => {
              setName(""); setPrompt(""); setTier("read-only"); setCreating(false);
            });
          }}>
            <h3 className="ap-form-title">新建闲时任务</h3>
            <label className="ap-form-row"><span className="ap-k">名称</span><input required maxLength={40} value={name} onChange={(e) => setName(e.target.value)} /></label>
            <label className="ap-form-row"><span className="ap-k">任务说明</span><textarea required maxLength={4000} rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} /></label>
            <label className="ap-form-row"><span className="ap-k">权限档</span><select value={tier} onChange={(e) => setTier(e.target.value as IdleTaskInput["permissionTier"])}>
              <option value="read-only">只读</option>
              <option value="workspace-write">可修改工作区</option>
              <option value="danger-full-access">完全访问（慎用）</option>
            </select></label>
            <p className="sp-dim">任务在新会话运行，需要人工审批的操作会被拒绝。</p>
            <div className="ap-form-actions">
              <button className="mini-btn" type="button" onClick={() => setCreating(false)}>返回</button>
              <button className="mini-btn primary" disabled={busy || loadError !== null || !name.trim() || !prompt.trim()} type="submit">加入闲时队列</button>
            </div>
          </form>
        )}
        {snapshot === null && loadError === null && <p className="sp-dim" role="status">正在读取闲时队列…</p>}
        {snapshot !== null && active.length === 0 && <p className="ap-empty">
          {filter === "all" ? "暂无等待或运行中的闲时任务。" : "暂无符合筛选的闲时任务。"}
        </p>}
        {active.length > 0 && <ul className="idle-task-list">{active.map((task) => <IdleTaskRow key={task.id} task={task} busy={busy || loadError !== null} update={update} />)}</ul>}
        {history.length > 0 && (
          <section aria-label="闲时任务历史">
            <h3 className="ap-gtitle">闲时任务历史</h3>
            <ul className="idle-task-list">{history.map((task) => <IdleTaskRow key={task.id} task={task} busy={busy} update={update} />)}</ul>
          </section>
        )}
      </section>
    </PageFrame>
  );
}
