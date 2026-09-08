import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { AgentEvent } from "../events";
import type {
  AgentApi,
  AskOutcomePayload,
  AskPayload,
  PermissionMode,
  RunRequest,
  StateResponse,
} from "../main/ipc-protocol";
import "./styles.css";

declare global {
  interface Window {
    agent: AgentApi;
  }
}

// 会话时间线：事件与审批行按到达顺序混排；审批行原地显示决议结果。
type Item =
  | { kind: "event"; e: AgentEvent }
  | { kind: "ask"; a: AskPayload; resolved?: "approved" | "rejected"; timedOut?: boolean };

function short(v: unknown, max = 260): string {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  if (s === undefined || s === null) return "";
  return s.length > max ? s.slice(0, max) + " …" : s;
}

function EventView({ e }: { e: AgentEvent }) {
  if (e.type === "user_message") return <div className="msg user">{e.content}</div>;
  if (e.type === "assistant_message") return <div className="msg assistant">{e.content}</div>;
  if (e.type === "tool_call") {
    return (
      <div className="tool">
        <span className="tool-name">🔧 {e.name}</span>
        <span className="tool-args">{short(e.args)}</span>
      </div>
    );
  }
  if (e.type === "tool_result") {
    return (
      <div className={"result " + (e.ok ? "ok" : "err")}>
        <span className="mark">{e.ok ? "✓" : "✗"}</span>
        <span className="out">{short(e.output, 400)}</span>
      </div>
    );
  }
  return (
    <div className="usage">
      tokens：{e.inputTokens} in / {e.outputTokens} out
    </div>
  );
}

function AskView({
  it,
  onDecide,
}: {
  it: Extract<Item, { kind: "ask" }>;
  onDecide: (askId: string, approved: boolean) => void;
}) {
  const a = it.a;
  if (it.resolved) {
    const label =
      it.resolved === "approved"
        ? "已批准"
        : it.timedOut
          ? "已拒绝（60 秒无响应，自动拒绝）"
          : "已拒绝";
    return (
      <div className={"ask resolved " + it.resolved}>
        {label}：{a.tool}
      </div>
    );
  }
  return (
    <div className="ask pending">
      <span className="ask-label">
        ⚠️ 请求批准：<b>{a.tool}</b> {short(a.args, 200)}
      </span>
      <span className="ask-actions">
        <button className="approve" onClick={() => onDecide(a.askId, true)}>
          批准
        </button>
        <button className="deny" onClick={() => onDecide(a.askId, false)}>
          拒绝
        </button>
      </span>
      <span className="hint">60 秒无响应自动拒绝</span>
    </div>
  );
}

function App() {
  const [items, setItems] = useState<Item[]>([]);
  const [status, setStatus] = useState<StateResponse | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<PermissionMode>("default");
  const [input, setInput] = useState("");

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

  const decide = (askId: string, approved: boolean): void => {
    void window.agent.decide(askId, approved);
  };

  return (
    <div className="app">
      <header>
        <h1>M0b · 桌面 Agent</h1>
        {status &&
          (status.sandbox.available ? (
            <span className="badge ok">沙箱：Seatbelt 已启用</span>
          ) : (
            <span className="badge warn">
              ⚠️ 沙箱不可用：{status.sandbox.reason ?? "未知"}（写操作将逐条强制审批）
            </span>
          ))}
      </header>
      {error && <div className="banner">运行失败：{error}</div>}
      <main className="stream">
        {items.length === 0 && (
          <div className="empty">在下方给 agent 派活，例如：修复 fixtures/todo-app 中失败的测试</div>
        )}
        {items.map((it, i) =>
          it.kind === "event" ? (
            <EventView key={i} e={it.e} />
          ) : (
            <AskView key={i} it={it} onDecide={decide} />
          ),
        )}
      </main>
      <footer>
        <select
          value={mode}
          disabled={running}
          onChange={(e) => setMode(e.target.value as PermissionMode)}
        >
          <option value="read-only">read-only</option>
          <option value="default">default（写操作需批准）</option>
          <option value="auto">auto</option>
        </select>
        <textarea
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
        <button
          className="send"
          onClick={() => void send()}
          disabled={running || input.trim().length === 0}
        >
          {running ? "运行中…" : "发送"}
        </button>
      </footer>
    </div>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);