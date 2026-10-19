// 对话目录面板（v7.2 长对话导航；蓝本未及面，§9 登记）：
//   长对话「跳到某一轮」——列表 = 用户轮（round + 首句摘要，来自 Stream.turnSummaries）。
//   scrollspy：面板开着时随滚动高亮"你正读到第几轮"（currentRound 由 App 计算传入）。
//   键盘：↑↓ 选行、Enter 跳（焦点在面板内即生效）；Esc 由 App 全局浮层链统一处理（一处事实源，不在这里抢）。
//   跳转不关面板（可连着跳着看）；「折叠全部/展开全部」一个钮翻面（有任意折叠即显示展开全部）。
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

export function OutlinePanel(props: {
  turns: readonly { round: number; text: string }[];
  /** 视口当前所在轮（scrollspy）；null = 还没算出来。 */
  currentRound: number | null;
  /** 有任意折叠 ⇒ 动作钮翻面为「展开全部」。 */
  anyFolded: boolean;
  onJump: (round: number) => void;
  onToggleAllFold: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const [kb, setKb] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  // 打开即接管键盘（↑↓/Enter 不必先点一下）。
  useEffect(() => { listRef.current?.focus(); }, []);
  const onKeyDown = (e: React.KeyboardEvent): void => {
    const target = e.target as HTMLElement;
    // 只有面板本身或轮次列表里的按键才归本处理器：旧实现挂在整面板上，
    // 「关闭/折叠全部」按钮上按 Enter 会被 preventDefault 并触发一次非预期跳转。
    const inList = target === e.currentTarget || target.closest(".ol-list") !== null;
    if (!inList) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const last = props.turns.length - 1;
      if (last < 0) return;
      setKb((cur) => {
        const base = cur ?? (e.key === "ArrowDown" ? -1 : props.turns.length);
        return Math.max(0, Math.min(last, e.key === "ArrowDown" ? base + 1 : base - 1));
      });
      return;
    }
    if (e.key === "Enter" && kb !== null) {
      // 焦点本身就在某个轮次按钮上 ⇒ 让原生 click 处理它（不要用 kb 覆盖焦点行）。
      if (target.closest("button.ol-item") !== null) return;
      const t = props.turns[kb];
      if (t !== undefined) { e.preventDefault(); props.onJump(t.round); }
    }
  };
  return (
    <div className="outline-panel" role="dialog" aria-label="对话目录" onKeyDown={onKeyDown}>
      <div className="ol-head">
        <span className="ol-title">对话目录</span>
        <button className="iconbtn sm" aria-label="关闭目录" onClick={props.onClose}><X size={12} /></button>
      </div>
      <button className="ol-fold" onClick={props.onToggleAllFold}>
        {props.anyFolded ? "展开全部" : "折叠全部（保留最后一轮）"}
      </button>
      <div className="ol-list" ref={listRef} tabIndex={0} aria-label="轮次">
        {props.turns.map((t, i) => (
          <button
            key={t.round}
            className={"ol-item" + (props.currentRound === t.round ? " on" : "") + (kb === i ? " kb" : "")}
            aria-current={props.currentRound === t.round ? "true" : undefined}
            onClick={() => props.onJump(t.round)}
          >
            <span className="ol-round">第 {String(t.round)} 轮</span>
            <span className="ol-sum">{t.text}</span>
          </button>
        ))}
      </div>
      <div className="ol-foot">↑↓ 选 · Enter 跳 · Esc 关</div>
    </div>
  );
}
