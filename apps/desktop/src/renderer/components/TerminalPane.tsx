// 终端窗格（第 1098 页从 PaneDock.tsx 拆出：PaneDock 已 1121 行，且无 props 的终端
// 此前随 PaneDock 的每次事件流重渲染白跑。memo 后父级重渲染直接跳过，PTY/滚动状态仍由内部 state 驱动。
import { memo, useEffect, useRef, useState } from "react";
import "@xterm/xterm/css/xterm.css";

declare const __IPC_PROTOCOL_VERSION__: number;

export const TerminalPane = memo(function TerminalPane(): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [notice, setNotice] = useState<{ message: string; canRetry: boolean } | null>(null);
  // 退出后可就地重启（2026-10-18）：此前只把“已退出”写进终端，唯一出路是关窗格再开。
  // gen 递增触发 effect 重跑：旧 xterm 在 cleanup 里 dispose + kill，新会话接在同一 host 上。
  const [exited, setExited] = useState<string | null>(null);
  const [gen, setGen] = useState(0);
  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    let alive = true;
    const showError = (message: string, canRetry = true): void => { if (alive) setNotice({ message, canRetry }); };
    let term: import("@xterm/xterm").Terminal | null = null;
    let termId: string | null = null;
    let offData: (() => void) | null = null;
    let offExit: (() => void) | null = null;
    let dataSub: { dispose: () => void } | null = null;
    let resizeSub: { dispose: () => void } | null = null;
    let resizeObserver: ResizeObserver | null = null;
    void Promise.all([window.agent.protocolVersion(), import("@xterm/xterm"), import("@xterm/addon-fit")]).then(([version, { Terminal }, { FitAddon }]) => {
      if (!alive) return;
      if (version !== __IPC_PROTOCOL_VERSION__) { showError("桌面协议版本不一致，请关闭并重新打开应用", false); return; }
      const t = new Terminal({
        fontSize: 12,
        cursorBlink: true,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        scrollback: 4000,
      });
      const fit = new FitAddon();
      t.loadAddon(fit);
      // 复制/粘贴/全选（2026-10-18）：xterm 默认不把选区写进系统剪贴板，Ctrl/Cmd+V 也不归它管——
      // 终端里选中的文字复制不出来、粘贴不进去，是“按键功能缺失”最典型的一处。只在“主修饰键”上拦：
      // macOS 用 ⌘；其他平台用 Ctrl+Shift（裸 Ctrl+C 必须留给 SIGINT）。
      t.attachCustomKeyEventHandler((e) => {
        if (e.type !== "keydown") return true;
        const primary = e.metaKey || (e.ctrlKey && e.shiftKey);
        if (!primary) return true;
        const k = e.key.toLowerCase();
        if (k === "a" && !e.shiftKey) { t.selectAll(); return false; }
        if (k === "c") {
          const sel = t.getSelection();
          if (sel !== "") void navigator.clipboard.writeText(sel).catch((err: unknown) => {
            showError(`复制失败：${err instanceof Error ? err.message : String(err)}`);
          });
          return false;
        }
        if (k === "v") {
          void navigator.clipboard.readText().then(
            (text) => { if (text !== "") t.paste(text); },
            (err: unknown) => { showError(`粘贴失败：${err instanceof Error ? err.message : String(err)}`); },
          );
          return false;
        }
        return true;
      });
      term = t;
      t.open(host);
      const syncSize = (): void => {
        const id = termId;
        if (!alive || id === null || host.clientWidth === 0 || host.clientHeight === 0) return;
        void window.agent.terminalResize(id, t.cols, t.rows).then((ok) => {
          if (alive && termId === id && !ok) showError("终端尺寸未能同步，请重新启动终端");
        }, (error: unknown) => {
          if (alive && termId === id) showError(`终端尺寸同步失败：${error instanceof Error ? error.message : String(error)}`);
        });
      };
      resizeSub = t.onResize(syncSize);
      // 列数自适应容器宽（此前固定 80 列在窄格被右缘裁切）；容器尺寸变化跟随。
      try { fit.fit(); } catch { /* 容器尺寸为 0 时忽略 */ }
      resizeObserver = new ResizeObserver(() => { try { fit.fit(); } catch { /* 同上 */ } });
      resizeObserver.observe(host);
      offData = window.agent.onTerminalData((e) => { if (termId !== null && e.id === termId) t.write(e.data); });
      offExit = window.agent.onTerminalExit((e) => {
        if (termId !== null && e.id === termId) {
          const why = e.code === null ? "信号终止" : `code ${String(e.code)}`;
          t.write(`\r\n[terminal] 已退出（${why}）——点上方「重新启动」或重开窗格\r\n`);
          termId = null;
          setExited(why);
        }
      });
      dataSub = t.onData((d) => {
        const id = termId;
        if (id === null) return;
        void window.agent.terminalWrite(id, d).then((ok) => {
          if (alive && termId === id && !ok) showError("终端已不可写，请重新启动终端");
        }, (error: unknown) => {
          if (alive && termId === id) showError(`终端输入失败：${error instanceof Error ? error.message : String(error)}`);
        });
      });
      void window.agent.terminalStart().then((r) => {
        if (r === undefined) { showError("通道无应答（主进程未返回终端）"); return; }
        if (!alive) { if (r.ok) void window.agent.terminalKill(r.id); return; }
        if (!r.ok) { showError(r.error); t.write(`[terminal] ${r.error}\r\n`); return; }
        termId = r.id;
        syncSize(); // fit 可能早于 IPC 返回 id；创建完成后必须补初次同步。
      }).catch((err: unknown) => {
        showError(err instanceof Error ? err.message : String(err));
      });
    }).catch((err: unknown) => {
      if (alive) showError(`终端无法启动：${err instanceof Error ? err.message : String(err)}`);
    });
    return () => {
      alive = false;
      offData?.(); offExit?.(); dataSub?.dispose(); resizeSub?.dispose();
      resizeObserver?.disconnect();
      if (termId !== null) void window.agent.terminalKill(termId);
      term?.dispose();
    };
  }, [gen]);
  return (
    <div className="term-pane">
      {notice !== null && <div className="fp-note err" role="alert">{notice.message}</div>}
      {(exited !== null || notice?.canRetry === true) && (
        <div className="fp-note" role="status">
          {exited !== null && <span>终端已退出（{exited}）</span>}
          <button
            className="mini-btn ghost"
            onClick={() => { setExited(null); setNotice(null); setGen((g) => g + 1); }}
          >重新启动</button>
        </div>
      )}
      <div className="term-host" ref={hostRef} aria-label="终端会话" />
    </div>
  );
});
