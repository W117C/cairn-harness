// 空屏下半区承接（2026-11-08 第 1048 页）：最近会话，点 = 回到那段对话。
// 纪律：数据必须真实（来自 sessions，不放假数据）；无会话时整块不渲染，不摆空壳；
// 不堆卡片——只一行 caption + 最多 3 条文本按钮（24px 命中区，第 1045 页硬判据）；
// 文案由调用方从 STR 传入，本文件零裸中文。独立成件是为了 SSR 判卷。
import { Clock3 } from "lucide-react";

export interface EmptyContextItem {
  id: string;
  title: string;
  workspace: string;
}

export function EmptyContext(props: {
  items: readonly EmptyContextItem[];
  label: string;
  onOpen: (id: string, workspace: string) => void;
}): React.JSX.Element | null {
  if (props.items.length === 0) return null;
  return (
    <div className="empty-context">
      <span className="empty-context-label">{props.label}</span>
      <div className="empty-context-list">
        {props.items.map((s) => (
          <button
            key={s.id}
            type="button"
            className="empty-context-item"
            onClick={() => { props.onOpen(s.id, s.workspace); }}
          >
            <Clock3 size={13} strokeWidth={1.7} aria-hidden="true" />
            <span>{s.title}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
