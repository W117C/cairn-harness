// Side chat 窗格（§3.3 / §7.1.3）：旁路对话——可读主线程全部上下文、**永不回写主会话**；
// 唯一写主会话的路径是用户显式「提升」(/promote)。
// 与蓝本的两处口径差异（如实标注，不装成蓝本同款）：
//   · 蓝本「不落盘、关掉即失」——Cairn 的旁路会话**有留档**（独立 JSONL，与主会话分开存放），
//     窗格脚注写明；这是能力上多出来的，不是少了。
//   · 模型解析走 core 的 sidechat 面（CAIRN_API_KEY→GLM / 演示脚本 / fail-closed）——不可用时
//     原文展示错误，不假装能答。
import { useCallback, useEffect, useRef, useState } from "react";
import { MessageCirclePlus, Send } from "lucide-react";
import type { SidechatPanelSnapshot } from "../../../../../src/main/ipc-protocol";

export function SidechatPane(props: { sessionId: string | null }): React.JSX.Element {
  const [snap, setSnap] = useState<SidechatPanelSnapshot | null>(null);
  const [stateError, setStateError] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [picked, setPicked] = useState<ReadonlySet<number>>(new Set());
  const [note, setNote] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback(() => {
    void window.agent.sidechatState(props.sessionId ?? undefined).then((s) => {
      setSnap(s);
      setStateError(null);
    }, (err: unknown) => {
      setStateError(err instanceof Error ? err.message : String(err));
    });
  }, [props.sessionId]);
  useEffect(() => {
    setActive(null);
    setPicked(new Set());
    setNote("");
    setNotice(null);
    refresh();
  }, [refresh]);

  const sessions = snap?.sessions ?? [];
  const current = sessions.find((s) => s.id === active) ?? sessions[0] ?? null;
  const currentId = current?.id ?? null;
  useEffect(() => { bottomRef.current?.scrollIntoView({ block: "end" }); }, [current?.messages.length, busy]);

  const create = (): void => {
    if (props.sessionId === null) return;
    setNotice(null);
    void window.agent.sidechatCreate(props.sessionId).then((r) => {
      setActive(r.id);
      refresh();
      setNotice("旁路会话已建（读主线程上下文；不回写主会话）");
    }, (err: unknown) => {
      setNotice(`新建失败：${err instanceof Error ? err.message : String(err)}`);
    });
  };
  const ask = (): void => {
    const text = draft.trim();
    if (text === "" || busy || currentId === null) return;
    setBusy(true);
    setNotice(null);
    void window.agent.sidechatAsk(currentId, text, props.sessionId ?? undefined).then((r) => {
      setBusy(false);
      if (!r.ok) { setNotice(r.error ?? "旁路提问失败"); return; }
      setDraft("");
      refresh();
    }, (err: unknown) => {
      setBusy(false);
      setNotice(`旁路提问失败：${err instanceof Error ? err.message : String(err)}`);
    });
  };
  const promote = (): void => {
    if (currentId === null || props.sessionId === null || picked.size === 0) return;
    setNotice(null);
    void window.agent.sidechatPromote({
      sidechatId: currentId,
      parentSessionId: props.sessionId,
      sourceEventIds: [...picked],
      ...(note.trim() !== "" ? { note: note.trim() } : {}),
    }).then((r) => {
      if (!r.ok) { setNotice(r.error ?? "提升失败"); return; }
      setPicked(new Set());
      setNote("");
      setNotice("已提升进主会话（主会话新增一条带来源的 user 消息，可再派活）");
      refresh();
    }, (err: unknown) => {
      setNotice(`提升失败：${err instanceof Error ? err.message : String(err)}`);
    });
  };
  const togglePick = (eventId: number): void => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) next.delete(eventId); else next.add(eventId);
      return next;
    });
  };

  if (props.sessionId === null) {
    return <div className="pane-empty">先在主会话里打开一扇对话，再开旁路（旁路要读它的上下文）。</div>;
  }
  return (
    <div className="sidechat-pane">
      <div className="sc-bar">
        {sessions.map((s) => (
          <button
            key={s.id}
            className={"sc-chip" + (s.id === currentId ? " on" : "")}
            title={`${s.lines} 行 · 独立于主会话存放`}
            onClick={() => { setActive(s.id); setPicked(new Set()); }}
          >
            {s.id}
          </button>
        ))}
        <span className="spacer" />
        <button className="mini-btn" onClick={create} title="新建旁路会话"><MessageCirclePlus size={12} /> 新建旁路</button>
      </div>
      {stateError !== null && <div className="fp-note err" role="alert">{stateError}</div>}
      {notice !== null && <div className="fp-note" role="status">{notice}</div>}
      {currentId === null ? (
        <div className="pane-empty">还没有旁路会话。<br />点「新建旁路」问点不打扰主线程的问题——读得到主会话上下文，但不回写它。</div>
      ) : (
        <>
          <div className="sc-msgs" aria-label="旁路消息">
            {current !== null && current.messages.length === 0 && <div className="pane-empty">旁路是空的——先把问题投进来。</div>}
            {current?.messages.map((m) => (
              <div key={m.eventId} className={"sc-msg " + m.role}>
                <label className="sc-pick" title="勾选后可提升进主会话">
                  <input type="checkbox" checked={picked.has(m.eventId)} onChange={() => { togglePick(m.eventId); }} />
                </label>
                <div className="sc-body">
                  <span className="sc-role">{m.role === "user" ? "你" : "旁路"}</span>
                  <span className="sc-text">{m.text}</span>
                </div>
              </div>
            ))}
            {busy && <div className="sc-msg assistant pending"><div className="sc-body"><span className="sc-role">旁路</span><span className="sc-text">思考中…（旁路也用真模型；失败会原文报出）</span></div></div>}
            <div ref={bottomRef} />
          </div>
          {picked.size > 0 && (
            <div className="sc-promote">
              <span className="rb-count num">{String(picked.size)} 条将提升</span>
              <input
                className="sc-note"
                aria-label="提升附注"
                placeholder="附注（可选）：为什么值得带进主线"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <button className="mini-btn primary" onClick={promote}>提升进主会话</button>
              <button className="mini-btn" onClick={() => { setPicked(new Set()); setNote(""); }}>清除</button>
            </div>
          )}
          <div className="sc-input">
            <input
              aria-label="旁路提问"
              placeholder={busy ? "旁路思考中…" : "问点旁的（不改主会话；Enter 发送）"}
              value={draft}
              disabled={busy}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(); } }}
            />
            <button className="mini-btn primary" aria-label="发送旁路提问" disabled={busy || draft.trim() === ""} onClick={ask}><Send size={12} /></button>
          </div>
          <div className="sc-foot-note">旁路会话会留档（独立 JSONL，与主会话分开存放）；主会话只在「提升」时被写。</div>
        </>
      )}
    </div>
  );
}
