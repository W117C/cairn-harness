// 目标芯片（2026-10-18）：桌面此前根本没有 goal 的可视面——/goal 斜杠项只是往输入框塞字，
// 协议里的 setGoal 渲染层一次都没调过。芯片读 core 的 traceGoal（与主进程续跑判据同一份 reduce），
// 展示目标原文/轮次/暂停态，并提供暂停/继续/清除三个动作（都走 setGoal IPC，事件回流后自更新）。
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, Target } from "lucide-react";
import type { GoalTrace } from "../../../../../src/agent/goal-trace";
import { STR } from "../strings";

export function GoalChip(props: {
  trace: GoalTrace;
  onPause: () => void;
  onResume: () => void;
  onClear: () => void;
  /** 已停止的目标：核心的 clear 幂等（不再落事件），所以这里是纯本地隐藏。 */
  onDismiss: () => void;
}): React.JSX.Element {
  const { spec, turn, paused, stopped } = props.trace;
  const usd = spec.maxUsd > 0 ? `$${spec.maxUsd.toFixed(2)}` : STR.goal.noUsd;
  return (
    <span
      className="goal-chip"
      data-paused={paused !== null || stopped !== null}
      title={stopped !== null ? `${STR.goal.stopped}：${stopped}` : spec.objective}
    >
      <Target size={11} aria-hidden="true" />
      <span className="gc-text" title={spec.objective}>{spec.objective}</span>
      <span className="gc-turn num">{STR.goal.turns.replace("{turn}", String(turn)).replace("{max}", String(spec.maxTurns))}</span>
      {stopped !== null && <span className="gc-state">{STR.goal.stopped}</span>}
      {stopped === null && paused !== null && <span className="gc-state">{STR.goal.paused}</span>}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button className="gc-more" aria-label={STR.goal.actions} title={STR.goal.actions}>
            <ChevronDown size={11} />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Content className="pop-rd" side="bottom" align="end" sideOffset={4}>
          {stopped === null && paused === null && (
            <DropdownMenu.Item className="menu-item" onSelect={props.onPause}>{STR.goal.pause}</DropdownMenu.Item>
          )}
          {stopped === null && paused !== null && (
            <DropdownMenu.Item className="menu-item" onSelect={props.onResume}>{STR.goal.resume}</DropdownMenu.Item>
          )}
          {stopped === null ? (
            <DropdownMenu.Item className="menu-item danger-text" onSelect={props.onClear}>{STR.goal.clear}</DropdownMenu.Item>
          ) : (
            <DropdownMenu.Item className="menu-item" onSelect={props.onDismiss}>{STR.goal.dismiss}</DropdownMenu.Item>
          )}
          <DropdownMenu.Item className="menu-item" disabled>
            {STR.goal.budget.replace("{turns}", String(spec.maxTurns)).replace("{usd}", usd)}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </span>
  );
}
