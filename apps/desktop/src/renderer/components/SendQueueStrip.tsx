// v2.17 运行中可沟通：排队条（挂在 ComposerCard 上沿）。
// 只做展示与转发——队列状态在 App（按会话），语义在 send-queue.ts；本组件只有「正在编辑哪条」的局部态。
import { useRef, useState } from "react";
import type { QueuedSend } from "../send-queue";
import { ChevronDown, ChevronUp, Clock, Pencil, X } from "lucide-react";

export function SendQueueStrip(props: {
  items: readonly QueuedSend[];
  /** 运行中才有「打断并发送」（不运行时队列自行出队，没有可打断的对象）。 */
  running: boolean;
  /** 缓存可查看，但读取未完成前不能改写或派发。 */
  disabled?: boolean;
  saving?: boolean;
  saveFailed?: boolean;
  onRetrySave?: () => void;
  onInterruptSend: (index: number) => void;
  onRemove: (index: number) => void;
  /** 改一条排队消息的正文；缺席 = 不提供编辑入口（旧用法字节不变）。 */
  onEdit?: (index: number, text: string) => void;
  /** 上/下移一条；缺席 = 不提供排序入口。 */
  onMove?: (index: number, delta: -1 | 1) => void;
  /** 重启恢复入口：不运行时显式继续发送队列头；缺省 = 不显示入口。 */
  onResume?: () => void;
}) {
  // 按 id 记正在编辑的那条（队列可能在编辑期间被移出/重排；index 会漂）。
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  // 键盘收尾后主动 blur 会在真实窗口里再补一个 blur 事件；跳过它，避免同一次编辑提交两遍。
  const skipBlurRef = useRef(false);
  if (props.items.length === 0 && !props.saving && !props.saveFailed) return null;
  const commit = (id: number): void => {
    if (props.disabled) return;
    const index = props.items.findIndex((item) => item.id === id);
    const text = draft.trim();
    if (index >= 0 && text !== "") props.onEdit?.(index, text);
  };
  // Enter/Esc 直接收尾，不把「能不能关掉」押在 blur 上：窗口未获焦时 blur 不派发
  // focusout（离屏实例实测），只靠 onBlur 会让编辑框关不掉。
  const finish = (id: number, apply: boolean): void => {
    skipBlurRef.current = true;
    setEditingId(null);
    if (apply) commit(id);
  };
  return (
    <div className="queue-strip" data-cds="ChatComposerQueuedMessages" role="list" aria-label="待发送队列">
      <span className="queue-head">
        <Clock size={11} />
        {props.saving && <span role="status">正在保存队列…</span>}
        {!props.saving && props.saveFailed && <span role="status">更改尚未保存</span>}
        {!props.saving && !props.saveFailed && props.disabled && "会话未读取完成，队列暂不可修改"}
        {!props.saving && !props.saveFailed && !props.disabled && (props.running ? "排队中 · 本轮结束后自动发送" : "排队中 · 等待恢复发送")}
        {props.saveFailed && props.onRetrySave !== undefined && (
          <button className="btn-ghost queue-retry" disabled={props.disabled} onClick={props.onRetrySave}>重试保存</button>
        )}
        {!props.running && props.onResume !== undefined && (
          <button className="btn-ghost queue-resume" aria-label="继续发送队列" disabled={props.disabled} onClick={props.onResume}>
            继续发送
          </button>
        )}
      </span>
      {props.items.map((item, index) => (
        <div className="queue-item" role="listitem" key={item.id}>
          {editingId === item.id ? (
            <input
              className="q-edit"
              data-esc-owns="true"
              aria-label={`编辑排队消息：${item.text}`}
              value={draft}
              disabled={props.disabled}
              autoFocus
              onFocus={(e) => { e.currentTarget.select(); }}
              onChange={(e) => { setDraft(e.target.value); }}
              onKeyDown={(e) => {
                // 全局 Esc 是「智慧停止本轮」：编辑排队项时它只该取消这次编辑，不许停跑。
                if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); finish(item.id, true); e.currentTarget.blur(); }
                else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(item.id, false); e.currentTarget.blur(); }
              }}
              onBlur={() => {
                if (skipBlurRef.current) { skipBlurRef.current = false; return; }
                if (editingId !== null) { setEditingId(null); commit(editingId); }
              }}
            />
          ) : (
            <span className="q-text" title={item.text}>{item.text}</span>
          )}
          {item.attachments.length > 0 && (
            <span
              className="q-sub"
              title={item.attachments.map((a) => a.path.split("/").filter(Boolean).pop() ?? a.path).join("\n")}
            >{String(item.attachments.length)} 引用</span>
          )}
          {props.onMove !== undefined && (
            <>
              <button
                className="btn-ghost"
                aria-label={`上移排队项：${item.text}`}
                title="上移"
                disabled={props.disabled || index === 0}
                onClick={() => { props.onMove?.(index, -1); }}
              ><ChevronUp size={10} /></button>
              <button
                className="btn-ghost"
                aria-label={`下移排队项：${item.text}`}
                title="下移"
                disabled={props.disabled || index === props.items.length - 1}
                onClick={() => { props.onMove?.(index, 1); }}
              ><ChevronDown size={10} /></button>
            </>
          )}
          {props.onEdit !== undefined && editingId !== item.id && (
            <button
              className="btn-ghost"
              aria-label={`编辑排队项：${item.text}`}
              title="编辑这条排队消息"
              disabled={props.disabled}
              onClick={() => { skipBlurRef.current = false; setDraft(item.text); setEditingId(item.id); }}
            ><Pencil size={10} /></button>
          )}
          {props.running && (
            <button className="btn-ghost" disabled={props.disabled} onClick={() => { props.onInterruptSend(index); }}>打断并发送</button>
          )}
          <button
            className="btn-ghost"
            aria-label={`移出队列：${item.text}`}
            disabled={props.disabled}
            onClick={() => { props.onRemove(index); }}
          ><X size={10} /></button>
        </div>
      ))}
    </div>
  );
}
