// 右侧检查器（P3-2 · brief 七）：三 Tab——改动 / 计划 / 时间线；**没有对应数据的 Tab 一律隐藏**
//（不放占位假数据）。「＋」菜单打开既有七种窗格（文件/终端/浏览器/旁路…；组件与数据面不动，
// 只换一个入口）。改动行点击懒加载逐 hunk diff（v4 changeDiff 通道，复用既有 DiffView）；
// 有快照的行提供「撤销此文件改动」（snapshotRestore，v11 通道在渲染层的消费者）。
// 宽度与开合收口在 App 的右 Panel（320–420，默认收起，⌘⌥B 开合）——本组件只管内容。
import { useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronRight, Plus } from "lucide-react";
import type { AgentEvent } from "../../../../../src/events";
import { timelineItems } from "../projections";
import { diffCount, useLazyChangeDiff } from "../change-diff-state";
import { changedFilesOf, PANE_META, PANE_OPENABLE, projectPlans, type PaneKind } from "./panes";
import { DiffView } from "./DiffView";
import { TimelinePane } from "./TimelinePane";

const CHANGE_WORD: Record<"created" | "modified" | "unknown", string> = {
  created: "新建",
  modified: "修改",
  unknown: "变更",
};

/** 改动 Tab：文件行（点击展开 diff；有快照的行可撤销——撤销后收起旧 diff，下次点开重新拉）。 */
function ChangesTab(props: {
  items: ReturnType<typeof changedFilesOf>;
  onRestore?: (path: string, snapshotId: string) => void;
}): React.JSX.Element {
  // 懒加载与两处共用的请求守卫（2026-10-18）：不再自己写一份 changeDiff。
  const { openKey, diff, toggle, close } = useLazyChangeDiff();
  return (
    <ul className="isp-list">
      {props.items.map((f) => {
        const open = openKey === f.path;
        return (
          <li className="isp-file-wrap" key={f.path}>
            <div className="isp-file">
              <button className={"isp-file-main" + (open ? " open" : "")} aria-expanded={open} title={f.path} onClick={() => toggle(f.path, f.path, f.snapshotId)}>
                <span className="chev" aria-hidden="true"><ChevronRight size={10} /></span>
                <span className={"act " + f.change}>{CHANGE_WORD[f.change]}</span>
                <span className="path">{f.path}</span>
              </button>
              {f.snapshotId !== undefined && props.onRestore !== undefined && (
                <button
                  className="isp-undo"
                  aria-label="撤销此文件改动"
                  title={`把「${f.path}」还原到这次改动前的版本`}
                  onClick={() => {
                    const snap = f.snapshotId;
                    if (snap === undefined) return;
                    props.onRestore?.(f.path, snap);
                    close(); // 还原后旧 diff 已无效：收起，下次点开重新拉
                  }}
                >撤销</button>
              )}
            </div>
            {open && (
              <div className="isp-diff-zone">
                {diff.loading && <div className="isp-empty">正在读快照与当前文件…</div>}
                {!diff.loading && diff.payload !== null && (
                  diff.payload.ok ? (
                    <>
                      <div className="isp-diff-stat num">{`+${String(diffCount(diff.payload.hunks).add)} −${String(diffCount(diff.payload.hunks).del)}`}</div>
                      <DiffView hunks={diff.payload.hunks} truncated={diff.payload.truncated} />
                    </>
                  ) : (
                    <div className="ap-notice err" role="alert">{diff.payload.error}</div>
                  )
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export interface InspectorProps {
  events: readonly AgentEvent[];
  /** 时间线/改动跳转：跳到对话中的对应事件位置（App 经 data-event-id 锚）。 */
  onJump?: (eventId: number) => void;
  /** 「＋」菜单：打开既有七种窗格（App 侧 togglePane/openPane）。 */
  onOpenPane?: (kind: PaneKind) => void;
  /** 「撤销此文件改动」（snapshotRestore；成功/失败面在 App）。 */
  onRestore?: (path: string, snapshotId: string) => void;
  /** 判卷/深链预留：强制初始 Tab（缺省 = 第一个有数据的）。 */
  initialTab?: "changes" | "plan" | "timeline";
}

export function Inspector(props: InspectorProps): React.JSX.Element {
  const changes = changedFilesOf(props.events);
  const plans = projectPlans(props.events);
  const items = timelineItems(props.events);
  const available = [
    ...(changes.length > 0 ? [{ id: "changes" as const, label: "改动" }] : []),
    ...(plans.length > 0 ? [{ id: "plan" as const, label: "计划" }] : []),
    ...(items.length > 0 ? [{ id: "timeline" as const, label: "时间线" }] : []),
  ];
  const [tab, setTab] = useState<InspectorProps["initialTab"] | null>(
    props.initialTab !== undefined && available.some((t) => t.id === props.initialTab) ? props.initialTab : (available[0]?.id ?? null),
  );
  // 渲染期回落：数据面变化（切会话/数据消失）致选中项失效时，自动回到第一个可用——不留死选中。
  const selected = tab !== null && available.some((t) => t.id === tab) ? tab : (available[0]?.id ?? null);
  return (
    <div className="isp">
      <div className="isp-head">
        <div className="isp-tabs" role="tablist" aria-label="检查器">
          {available.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={selected === t.id}
              className={"isp-tab" + (selected === t.id ? " active" : "")}
              onClick={() => setTab(t.id)}
            >{t.label}</button>
          ))}
        </div>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button className="isp-add" aria-label="打开窗格" title="打开窗格（文件 / 终端 / 浏览器 / 旁路…）"><Plus size={13} /></button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Content className="pop-rd" side="bottom" align="end" sideOffset={4}>
            {PANE_OPENABLE.map((k) => (
              <DropdownMenu.Item key={k} className="menu-item" onSelect={() => props.onOpenPane?.(k)}>
                {PANE_META[k].label}
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </div>
      <div className="isp-body">
        {selected === "changes" && <ChangesTab items={changes} onRestore={props.onRestore} />}
        {selected === "plan" && (
          <div className="isp-plan">
            {plans.map((p) => (
              <div className="isp-plan-item" key={p.callId}>
                <div className="isp-plan-goal">{p.goal}</div>
                <div className="isp-plan-meta">
                  <span className={"chip " + (p.state === "approved" ? "ok" : p.state === "rejected" ? "bad" : "warn")}>
                    {p.state === "approved" ? "已批准" : p.state === "rejected" ? "已拒绝" : "待决"}
                  </span>
                  <span className="chip num">{String(p.files.length)} 个文件</span>
                </div>
              </div>
            ))}
          </div>
        )}
        {selected === "timeline" && <TimelinePane items={items} onJump={props.onJump} />}
        {selected === null && (
          <div className="isp-empty">本会话还没有可检查的内容——改动、计划与时间线会随对话在这里长出来。</div>
        )}
      </div>
    </div>
  );
}
