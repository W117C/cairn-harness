// C-09 轮次时间线 rail（v2.12 线条形态）：每条线段 = 一轮；悬停突起 + 弹出信息面板
// （轮数/时间/用户话/回复摘要 + 「回滚本轮文件」入口）；点击平滑滚到该轮 + 整轮 flash。
// 轮数 < 2 不显示；数据来自 roundTimeline 纯投影。
import { useRef, useState } from "react";
import { relativeTime } from "../projections";
import { Ic } from "./icons";

export function TurnRail(props: {
  turns: ReadonlyArray<{ round: number; userText: string; replySummary: string | null; ts?: number }>;
  onJump: (round: number) => void;
  onRevert?: (round: number) => void;
}) {
  const [active, setActive] = useState<number | null>(null);
  const flashTimer = useRef<number | null>(null);
  if (props.turns.length < 2) return null;
  const jump = (round: number) => {
    setActive(round);
    props.onJump(round);
    // 整轮 flash：给目标轮的所有行加类（由 App 侧 DOM 查询落实现——rail 只发意图）。
    const stream = document.getElementById("stream");
    if (stream !== null) {
      const rows = stream.querySelectorAll(".row.user, .row.assistant, .row.error-row, .toolcluster");
      let inTurn = false;
      rows.forEach((el) => {
        const isUser = el.classList.contains("user");
        if (isUser) {
          const btn = el.querySelector<HTMLElement>("[data-round-anchor]");
          inTurn = btn?.getAttribute("data-round-anchor") === String(round);
        }
        if (inTurn) {
          el.classList.add("tl-flash");
          if (flashTimer.current !== null) clearTimeout(flashTimer.current);
          flashTimer.current = window.setTimeout(() => el.classList.remove("tl-flash"), 1300);
        }
      });
    }
  };
  return (
    <div className="tl-rail" aria-label="轮次时间线">
      {props.turns.map((t) => (
        <button
          key={t.round}
          className={"tl-line" + (active === t.round ? " on" : "")}
          aria-label={`跳到第 ${String(t.round)} 轮`}
          onClick={() => jump(t.round)}
        >
          <span className="tl-pop" role="tooltip">
            <span className="h">
              第 {String(t.round)} 轮
              {t.ts !== undefined && ` · ${relativeTime(Date.now(), t.ts)}`}
            </span>
            <span className="u">{t.userText}</span>
            {t.replySummary !== null && <span className="m">{t.replySummary}</span>}
            {props.onRevert !== undefined && (
              <button
                className="tl-revert"
                onClick={(e) => { e.stopPropagation(); props.onRevert?.(t.round); }}
              >
                <Ic.revert size={11} /> 回滚本轮文件
              </button>
            )}
          </span>
        </button>
      ))}
    </div>
  );
}
