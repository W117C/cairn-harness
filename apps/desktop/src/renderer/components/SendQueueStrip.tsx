// v2.17 运行中可沟通：排队条（挂在 ComposerCard 上沿）。
// 只做展示与转发——队列状态在 App（按会话），语义在 send-queue.ts；本组件只有「正在编辑哪条」的局部态。
// 2026-11-04 业主截图形制重排：每行 = 抓手 | 正文（单行省略）+ 附件文件名行 | [↑ 立即] 胶囊 +
// 编辑(铅笔) + 移出(垃圾桶)；上移/下移退到悬停显现（默认观感与截图一致，重排能力不丢）；
// 头部只在「异常 / 等待恢复」时在场——正常排队时输入框那句「继续输入以排队后续修改」就是状态说明。
import { useRef, useState } from "react";
import type { QueuedSend } from "../send-queue";
import { STR } from "../strings";
import { ArrowUp, ChevronDown, ChevronUp, GripVertical, Pencil, Trash2 } from "lucide-react";

const basenameOf = (path: string): string => path.split("/").filter(Boolean).pop() ?? path;

export function SendQueueStrip(props: {
  items: readonly QueuedSend[];
  /** 运行中才有「打断并发送」（不运行时队列自行出队，没有可打断的对象）。 */
  running: boolean;
  /** 「立即」的可用面：运行中恒可；不运行 = 与「继续发送」同一套门（读取完成/无待决卡）。
   *  缺席 = 不可用（旧调用面逐字不变）。 */
  sendNowEnabled?: boolean;
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
  const sendNow = props.sendNowEnabled ?? false;
  // 头部只在异常/等待恢复时在场；正常排队（运行中）不摆——placeholder 已说明状态。
  const showHeader = props.saving === true || props.saveFailed === true || !props.running;
  const stateLabel = props.saving
    ? "正在保存队列…"
    : props.saveFailed
      ? "更改尚未保存"
      : props.disabled
        ? "会话未读取完成，队列暂不可修改"
        : props.running
          ? "本轮结束后自动发送"
          : "等待恢复发送";
  return (
    <div
      className="queue-strip"
      data-cds="ChatComposerQueuedMessages"
      role="list"
      aria-label="待发送队列"
      {...(props.disabled || props.saving === true || props.saveFailed === true ? { title: stateLabel } : {})}
    >
      {showHeader && (
        <span className="queue-head">
          <span className="queue-title">待发送</span>
          <span className="queue-state">{stateLabel}</span>
          {(props.saving || props.saveFailed) && <span className="sr-only" role="status">{stateLabel}</span>}
          {props.saveFailed && props.onRetrySave !== undefined && (
            <button className="btn-ghost queue-retry" disabled={props.disabled} onClick={props.onRetrySave}>重试保存</button>
          )}
          {!props.running && props.onResume !== undefined && (
            <button className="btn-ghost queue-resume" aria-label="继续发送队列" disabled={props.disabled} onClick={props.onResume}>
              继续发送
            </button>
          )}
        </span>
      )}
      <div className="queue-items">
      {props.items.map((item, index) => {
        const names = item.attachments.map((a) => basenameOf(a.path));
        return (
        <div className="queue-item" role="listitem" key={item.id}>
          <span className="q-grip" aria-hidden="true"><GripVertical size={12} /></span>
          <div className="q-main">
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
                title={names.join("\n")}
              >{names.length === 1 ? names[0] : `${names[0]} 等 ${String(names.length)} 个文件`}</span>
            )}
          </div>
          <div className="q-actions">
          {props.onMove !== undefined && (
            <>
              <button
                className="btn-ghost q-order"
                aria-label={`上移排队项：${item.text}`}
                title="上移"
                disabled={props.disabled || index === 0}
                onClick={() => { props.onMove?.(index, -1); }}
              ><ChevronUp size={11} /></button>
              <button
                className="btn-ghost q-order"
                aria-label={`下移排队项：${item.text}`}
                title="下移"
                disabled={props.disabled || index === props.items.length - 1}
                onClick={() => { props.onMove?.(index, 1); }}
              ><ChevronDown size={11} /></button>
            </>
          )}
          {props.onEdit !== undefined && editingId !== item.id && (
            <button
              className="btn-ghost"
              aria-label={`编辑排队项：${item.text}`}
              title="编辑这条排队消息"
              disabled={props.disabled}
              onClick={() => { skipBlurRef.current = false; setDraft(item.text); setEditingId(item.id); }}
            ><Pencil size={12} /></button>
          )}
          <button
            className="q-sendnow"
            disabled={!sendNow || props.disabled === true}
            aria-label={`立即发送：${item.text}`}
            title={props.running ? "打断本轮并立即发送这条" : "立即发送这条"}
            onClick={() => { props.onInterruptSend(index); }}
          ><ArrowUp size={12} aria-hidden="true" /><span>{STR.composer.queueSendNow}</span></button>
          <button
            className="btn-ghost"
            aria-label={`移出队列：${item.text}`}
            disabled={props.disabled}
            onClick={() => { props.onRemove(index); }}
          ><Trash2 size={12} /></button>
          </div>
        </div>
        );
      })}
      </div>
    </div>
  );
}
