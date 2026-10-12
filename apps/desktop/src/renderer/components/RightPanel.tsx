// C-30 辅助对话标签（v2.10 形态）：一标签 = 一个独立旁路会话（sidechat 全通道真接线）。
// 消息流 + 追问输入 + 轮次导航（每轮时间戳分隔 + 顶部 sticky chips，点击跳转+flash）+ 提升入口。
// 提升动作双确认（promote 会把结论写进主会话事件流，值得一次显式确认）。
import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentEvent, SidechatPanelSnapshot } from "../../../../../src/main/ipc-protocol";
import { Ic } from "./icons";

interface SidechatTabState {
  id: string;
  name: string;
  events: AgentEvent[];
}

function msgOf(e: AgentEvent): { role: "user" | "assistant"; text: string } | null {
  if (e.type === "user_message") return { role: "user", text: e.content };
  if (e.type === "assistant_message") return { role: "assistant", text: e.content };
  return null;
}

export function SidechatTab(props: {
  tab: SidechatTabState;
  parentSessionId: string | null;
  onOpenParent: () => void;
  onClosed: () => void;
  onError: (message: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [activeTurn, setActiveTurn] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const turnRefs = useRef(new Map<number, HTMLDivElement>());

  // 轮次投影：user 消息起一轮（与主会话同口径）。promoted 事件带 origin（旁路事件同型）。
  const turns: { n: number; startEl: number; label: string }[] = [];
  props.tab.events.forEach((e, i) => {
    const m = msgOf(e);
    if (m?.role === "user") {
      const ts = (e as { ts?: number }).ts;
      turns.push({
        n: turns.length + 1,
        startEl: i,
        label: typeof ts === "number" ? new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : `第 ${String(turns.length + 1)} 轮`,
      });
    }
  });

  const jump = useCallback((startEl: number, n: number) => {
    setActiveTurn(n);
    const el = turnRefs.current.get(startEl);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
    el?.classList.add("flash");
    setTimeout(() => el?.classList.remove("flash"), 1300);
  }, []);

  // 追问后滚到底（新轮实时补入）。
  useEffect(() => {
    if (busy) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [props.tab.events.length, busy]);

  const ask = () => {
    const text = draft.trim();
    if (text === "" || busy) return;
    setBusy(true);
    void window.agent
      .sidechatAsk(props.tab.id, text)
      .then((r) => {
        if (!r.ok) { props.onError(r.error ?? "旁路提问失败"); return; }
        setDraft("");
        if (r.events !== undefined) {
          // ask 返回全量事件面（main 侧投影）；直接替换本标签流。
          props.tab.events = r.events;
        }
      })
      .catch((err: unknown) => {
        props.onError(`旁路提问失败：${err instanceof Error ? err.message : String(err)}`);
      })
      .finally(() => setBusy(false));
  };

  const promote = () => {
    // 提升最近一轮的 user+assistant 消息（sourceEventIds 由行号反推；main 侧写 origin）。
    const lastUser = [...props.tab.events].reverse().find((e) => (msgOf(e)?.role ?? "") === "user");
    const lastAssistant = [...props.tab.events].reverse().find((e) => (msgOf(e)?.role ?? "") === "assistant");
    if (lastAssistant === undefined) { props.onError("还没有可提升的结论"); return; }
    const aIdx = props.tab.events.indexOf(lastAssistant);
    const uIdx = lastUser !== undefined ? props.tab.events.indexOf(lastUser) : aIdx;
    const sourceEventIds = props.tab.events
      .map((e, i) => (i >= Math.min(uIdx, aIdx) && i <= aIdx ? i + 1 : 0))
      .filter((n) => n > 0);
    if (props.parentSessionId === null) { props.onError("主会话未就绪（先在主区派活建会话）"); return; }
    void window.agent
      .sidechatPromote({
        sidechatId: props.tab.id,
        parentSessionId: props.parentSessionId,
        sourceEventIds,
      })
      .then((r) => {
        if (!r.ok) { props.onError(r.error ?? "提升失败"); return; }
        props.onError("已提升到主会话");
        props.onOpenParent();
      })
      .catch((err: unknown) => {
        props.onError(`提升失败：${err instanceof Error ? err.message : String(err)}`);
      });
  };

  return (
    <div className="rp-scroll">
      {turns.length > 1 && (
        <div className="sc-turns">
          {turns.map((t) => (
            <button
              key={t.n}
              className={"sc-turn-btn" + (activeTurn === t.n ? " on" : "")}
              onClick={() => jump(t.startEl, t.n)}
            >
              {t.n} · {t.label}
            </button>
          ))}
        </div>
      )}
      <div className="rc-head">
        <span className="rc-title">{props.tab.name}</span>
        <span className="rc-sub">旁路 · 不进主会话流</span>
        <span className="rc-actions">
          <button className="mini-btn" disabled={promoting} onClick={() => setPromoting(true)}>提升…</button>
        </span>
      </div>
      {promoting && (
        <div className="rc-comment">
          把最近一轮的结论提升进主会话（渲染为主会话一条 user_message + origin）？
          <div style={{ marginTop: 6, display: "flex", gap: 6 }}>
            <button className="mini-btn primary" onClick={promote}>确认提升</button>
            <button className="mini-btn" onClick={() => setPromoting(false)}>取消</button>
          </div>
        </div>
      )}
      <div ref={scrollRef} style={{ overflowY: "auto", flex: 1, minHeight: 0 }}>
        {props.tab.events.length === 0 && <div className="rp-empty">这个旁路会话还没有消息 · 在下面问点什么</div>}
        {props.tab.events.map((e, i) => {
          const m = msgOf(e);
          if (m === null) return null;
          const turnStart = turns.find((t) => t.startEl === i);
          return (
            <div
              key={i}
              ref={(el) => { if (el !== null) turnRefs.current.set(i, el); }}
              className={"sc-turn-block" + (activeTurn !== null && turnStart !== undefined ? " tl-flash" : "")}
            >
              {turnStart !== undefined && turns.length > 1 && (
                <div className="sc-turn-div"><span>第 {String(turnStart.n)} 轮 · {turnStart.label}</span></div>
              )}
              <div className={"sc-msg" + (m.role === "user" ? " user" : "")}>
                <span className="who">{m.role === "user" ? "你" : "旁路"}</span>
                {m.text}
              </div>
            </div>
          );
        })}
      </div>
      <div className="rc-input">
        <input
          value={draft}
          placeholder="问点别的（不影响主会话）…"
          aria-label="旁路追问"
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") ask(); }}
        />
        <button className="mini-btn primary" disabled={busy || draft.trim() === ""} onClick={ask}>
          {busy ? "…" : "发送"}
        </button>
      </div>
    </div>
  );
}

/** 右栏标签容器（v2.2）：0 标签 = 开始页；辅助对话标签多开/关闭；浏览器标签待 WebContentsView 前置。 */
export function RightPanel(props: {
  parentSessionId: string | null;
  onError: (message: string) => void;
  onOpenParent: () => void;
}) {
  const [tabs, setTabs] = useState<SidechatTabState[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<SidechatPanelSnapshot | null>(null);

  // 打开侧对话标签：优先恢复既有旁路（sidechatState 快照），没有才新建。
  const openSidechat = () => {
    const load = (id: string, name: string) => {
      void window.agent.sidechatState(props.parentSessionId ?? undefined).then((snap) => {
        setSnapshot(snap);
        const match = snap.sessions.find((s) => s.id === id);
        void window.agent.openSession(id).then((r) => {
          setTabs((prev) => [...prev, { id, name, events: match !== undefined ? [] : (r.events as AgentEvent[]) }]);
          setActiveTab(id);
        }).catch((err: unknown) => props.onError(`旁路会话打开失败：${err instanceof Error ? err.message : String(err)}`));
      }).catch((err: unknown) => props.onError(`旁路快照读取失败：${err instanceof Error ? err.message : String(err)}`));
    };
    const existing = snapshot?.sessions[0];
    if (existing !== undefined && !tabs.some((t) => t.id === existing.id)) {
      load(existing.id, existing.id);
      return;
    }
    if (props.parentSessionId === null) { props.onError("主会话未就绪（先在主区派活建会话，或直接在旁路提问）"); return; }
    void window.agent.sidechatCreate(props.parentSessionId).then((r) => {
      load(r.id, `旁路 ${String(tabs.length + 1)}`);
    }).catch((err: unknown) => props.onError(`旁路会话创建失败：${err instanceof Error ? err.message : String(err)}`));
  };

  const closeTab = (id: string) => {
    setTabs((prev) => prev.filter((t) => t.id !== id));
    setActiveTab((cur) => (cur === id ? null : cur));
  };

  const active = tabs.find((t) => t.id === activeTab) ?? null;
  return (
    <>
      {tabs.length > 0 && (
        <div className="rp-tabbar">
          <div className="rp-tabs">
            {tabs.map((t) => (
              <button key={t.id} className={"rpt" + (t.id === activeTab ? " on" : "")} onClick={() => setActiveTab(t.id)}>
                <span className="t">{t.name}</span>
                <span className="x" role="button" aria-label={`关闭 ${t.name}`} onClick={(e) => { e.stopPropagation(); closeTab(t.id); }}><Ic.x size={11} /></span>
              </button>
            ))}
          </div>
          <button className="iconbtn sm" title="新标签页" aria-label="新标签页" onClick={openSidechat}>
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M7 2.8v8.4M2.8 7h8.4"/></svg>
          </button>
        </div>
      )}
      <div className="rp-body">
        {active === null ? (
          <div className="rp-start">
            <div className="start-mark" aria-hidden="true">
              <svg width="42" height="42" viewBox="0 0 14 14" fill="currentColor"><path d="M7 1.6 8.3 5.7 12.4 7 8.3 8.3 7 12.4 5.7 8.3 1.6 7 5.7 5.7Z"/></svg>
            </div>
            <div className="start-stack">
              <button className="start-card" onClick={() => props.onError("浏览器标签需要 WebContentsView 前置（§8 #2），尚未接线")}>
                <span className="sc-ico" aria-hidden="true">
                  <svg width="15" height="15" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="7" cy="7" r="5.2"/><path d="M1.8 7h10.4M7 1.8c-3.4 3.4-3.4 7 0 10.4M7 1.8c3.4 3.4 3.4 7 0 10.4"/></svg>
                </span>
                <span className="sc-label">浏览器</span>
                <span className="sc-tag">待接</span>
              </button>
              <button className="start-card" onClick={openSidechat}>
                <span className="sc-ico" aria-hidden="true">
                  <svg width="15" height="15" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"><path d="M2.2 3.6c0-.77.63-1.4 1.4-1.4h6.8c.77 0 1.4.63 1.4 1.4v4.2c0 .77-.63 1.4-1.4 1.4H5.4L3 11.4V9.2h.4c-.77 0-1.2-.63-1.2-1.4Z"/></svg>
                </span>
                <span className="sc-label">辅助对话</span>
                <span className="sc-key">独立旁路 · 可提升结论</span>
              </button>
            </div>
            <div className="start-note">浏览器标签需要主进程 WebContentsView 前置（§8 #2）；辅助对话走 sidechat 全通道（真接线）。</div>
          </div>
        ) : (
          <SidechatTab
            key={active.id}
            tab={active}
            parentSessionId={props.parentSessionId}
            onOpenParent={props.onOpenParent}
            onClosed={() => closeTab(active.id)}
            onError={props.onError}
          />
        )}
      </div>
    </>
  );
}
