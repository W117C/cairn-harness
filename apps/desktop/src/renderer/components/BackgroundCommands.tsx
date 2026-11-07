import { useEffect, useState } from "react";
import type { BackgroundTaskStatus } from "../../../../../src/tools/background-tasks";
import "./background-commands.css";

function label(task: BackgroundTaskStatus): string {
  if (!task.done) return "运行中";
  if (task.stopped) return "已停止";
  if (task.timedOut) return "已超时";
  if (task.exitCode === null) return "异常结束";
  return `已退出 (${String(task.exitCode)})`;
}

export function BackgroundCommands({ sessionId, workspace }: { sessionId: string; workspace: string | undefined }): React.JSX.Element | null {
  const [tasks, setTasks] = useState<BackgroundTaskStatus[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [stopping, setStopping] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window.agent.backgroundTaskList !== "function") return;
    let alive = true;
    let reading = false;
    const read = async () => {
      if (reading) return;
      reading = true;
      try {
        const next = await window.agent.backgroundTaskList(sessionId, workspace);
        if (alive) setTasks(next);
      } catch (err) {
        if (alive && tasks.length > 0) setError(err instanceof Error ? err.message : String(err));
      } finally {
        reading = false;
      }
    };
    void read();
    const timer = window.setInterval(() => { void read(); }, 2000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [sessionId, workspace, tasks.length]);

  if (tasks.length === 0) return null;
  const running = tasks.filter((task) => !task.done).length;
  const stop = async (id: string) => {
    setStopping(id);
    setError(null);
    try {
      const result = await window.agent.backgroundTaskStop(sessionId, id, workspace);
      if (result === null) throw new Error("该命令已无法访问");
      setTasks((current) => current.map((task) => task.id === id ? result : task));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStopping(null);
    }
  };
  return (
    <details className="background-commands">
      <summary>后台命令 <span className="sp-dim">{running > 0 ? `${String(running)} 个运行中` : `${String(tasks.length)} 条记录`}</span></summary>
      {error !== null && <p role="alert">{error}</p>}
      <ul>
        {tasks.map((task) => (
          <li key={task.id}>
            <div className="background-command-row">
              <code title={task.command}>{task.command}</code>
              <span className="sp-tag">{label(task)}</span>
              {!task.done && <button className="mini-btn" disabled={stopping !== null} onClick={() => { void stop(task.id); }}>停止</button>}
            </div>
            <details>
              <summary>输出 · {task.id}</summary>
              <pre>{task.output || "暂无输出"}</pre>
            </details>
          </li>
        ))}
      </ul>
    </details>
  );
}
