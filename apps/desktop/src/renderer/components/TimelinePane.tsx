// 时间线窗格（P3-2 检查器「时间线」Tab = Cairn 核心卖点的可见面）：事件日志 → 步骤序列，
// 点击一步跳到对话中的对应位置（App 经 data-event-id 锚 scrollIntoView；折叠轮先展开）。
// 数据面 = projections.timelineItems（纯函数：只取在场字段——不编时间、不摆占位步）。
// 布局 = 竖轴 + 节点圆点；kind 词在窄列（320–420）里最省位：你 / 回复 / 工具 / 用量。
import { relativeTime, type TimelineItem } from "../projections";
import { useNow } from "../useNow";

/** kind 词（窄列可读性）。 */
const KIND_WORD: Record<TimelineItem["kind"], string> = {
  user: "你",
  assistant: "回复",
  tool: "工具",
  usage: "用量",
};

export function TimelinePane(props: { items: readonly TimelineItem[]; onJump?: (eventId: number) => void }): React.JSX.Element {
  const now = useNow();
  if (props.items.length === 0) {
    return <div className="isp-empty">本会话还没有可列的事件。<br />对话开始后，每一步会按事件日志在这里排队。</div>;
  }
  return (
    <ol className="tl-list">
      {props.items.map((it) => (
        <li className="tl-row" key={it.eventId}>
          <button className="tl-item" title="跳到对话中的对应位置" onClick={() => props.onJump?.(it.eventId)}>
            <span className={`tl-kind ${it.kind}`}>{KIND_WORD[it.kind]}</span>
            <span className="tl-label">{it.label}</span>
            {it.at !== undefined && <span className="tl-at">{relativeTime(now, it.at)}</span>}
          </button>
        </li>
      ))}
    </ol>
  );
}
