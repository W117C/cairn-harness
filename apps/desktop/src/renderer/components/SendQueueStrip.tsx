// v2.17 运行中可沟通：排队条（挂在 ComposerCard 上沿）。
// 只做展示与转发——队列状态在 App（按会话），语义在 send-queue.ts；本组件零逻辑。
import type { QueuedSend } from "../send-queue";
import { Clock, X } from "lucide-react";

export function SendQueueStrip(props: {
  items: readonly QueuedSend[];
  /** 运行中才有「打断并发送」（不运行时队列自行出队，没有可打断的对象）。 */
  running: boolean;
  onInterruptSend: (index: number) => void;
  onRemove: (index: number) => void;
  /** 重启恢复入口：不运行时显式继续发送队列头；缺省 = 不显示入口。 */
  onResume?: () => void;
}) {
  if (props.items.length === 0) return null;
  return (
    <div className="queue-strip" role="list" aria-label="待发送队列">
      <span className="queue-head">
        <Clock size={11} />
        {props.running ? "排队中 · 本轮结束后自动发送" : "排队中 · 等待恢复发送"}
        {!props.running && props.onResume !== undefined && (
          <button className="btn-ghost queue-resume" aria-label="继续发送队列" onClick={props.onResume}>
            继续发送
          </button>
        )}
      </span>
      {props.items.map((item, index) => (
        <div className="queue-item" role="listitem" key={item.id}>
          <span className="q-text" title={item.text}>{item.text}</span>
          {item.attachments.length > 0 && (
            <span
              className="q-sub"
              title={item.attachments.map((a) => a.path.split("/").filter(Boolean).pop() ?? a.path).join("\n")}
            >{String(item.attachments.length)} 引用</span>
          )}
          {props.running && (
            <button className="btn-ghost" onClick={() => { props.onInterruptSend(index); }}>打断并发送</button>
          )}
          <button
            className="btn-ghost"
            aria-label={`移出队列：${item.text}`}
            onClick={() => { props.onRemove(index); }}
          ><X size={10} /></button>
        </div>
      ))}
    </div>
  );
}
