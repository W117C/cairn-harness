// 右侧检查器（P3-2 · brief 七）：三 Tab——改动 / 计划 / 时间线；**没有对应数据的 Tab 一律隐藏**
//（不放占位假数据）。「＋」菜单打开既有七种窗格（文件/终端/浏览器/旁路…；组件与数据面不动，
// 只换一个入口）。改动行点击懒加载逐 hunk diff（v4 changeDiff 通道，复用既有 DiffView）；
// 有快照的行提供「撤销此文件改动」（snapshotRestore，v11 通道在渲染层的消费者）。
// 宽度与开合收口在 App 的右 Panel（320–420，默认收起，⌘⌥I 开合）——本组件只管内容。
// 2026-11-03 业主：Token 用量/会话活动统计页与模型档位 chips 不是这个栏该装的东西——整页撤掉，
// Tab 只剩有数据才出现的改动/计划/时间线；默认选中第一个可用的。
import { useEffect, useId, useMemo, useRef, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronRight, Plus, X } from "lucide-react";
import type { AgentEvent } from "../../../../../src/events";
import { timelineItems } from "../projections";
import { diffCount, useLazyChangeDiff } from "../change-diff-state";
import { changedFilesOf, PANE_META, PANE_OPENABLE, projectPlans, type PaneKind } from "./panes";
import { changeLabel } from "../derived/change-labels";
import { DiffView } from "./DiffView";
import { TimelinePane } from "./TimelinePane";
import { STR } from "../strings";

/** Inspector 是水平 tablist：方向键循环，Home/End 到首尾，其他键留给原生焦点移动。 */
export function inspectorTabIndexForKey(key: string, index: number, count: number): number | null {
  if (count <= 0 || index < 0 || index >= count) return null;
  if (key === "ArrowRight") return (index + 1) % count;
  if (key === "ArrowLeft") return (index - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

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
                <span className={"act " + f.change}>{changeLabel(f.change)}</span>
                <span className="path">{f.path}</span>
              </button>
              {f.snapshotId !== undefined && props.onRestore !== undefined && (
                <button
                  className="isp-undo"
                  aria-label={STR.inspector.undoAria}
                  title={STR.inspector.undoTitle.replace("{path}", f.path)}
                  onClick={() => {
                    const snap = f.snapshotId;
                    if (snap === undefined) return;
                    props.onRestore?.(f.path, snap);
                    close(); // 还原后旧 diff 已无效：收起，下次点开重新拉
                  }}
                >{STR.inspector.undo}</button>
              )}
            </div>
            {open && (
              <div className="isp-diff-zone">
                {diff.loading && <div className="isp-empty">{STR.inspector.diffLoading}</div>}
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
  /** 判卷/深链预留：强制初始 Tab（缺省 = 第一个可用的）。 */
  initialTab?: "changes" | "plan" | "timeline";
  /** 关闭检查器（App 的 toggleInspector：开合 + 跨重启记忆同一出口）。
   *  缺省不摆按钮——判卷/嵌用面没有右 Panel 可关，摆一枚点了没反应的 × 更糟。 */
  onClose?: () => void;
}

export function Inspector(props: InspectorProps): React.JSX.Element {
  const tabsId = useId();
  // 第 1117 页：三块投影按 events 引用记忆；App 因与流无关的状态重渲染时不再重扫整条事件流。
  const changes = useMemo(() => changedFilesOf(props.events), [props.events]);
  const plans = useMemo(() => projectPlans(props.events), [props.events]);
  const items = useMemo(() => timelineItems(props.events), [props.events]);
  // 没有数据的 Tab 一律不出现（不放假占位）；全空会话给一句诚实的引导。默认选中 = 第一个可用的。
  const available = [
    ...(changes.length > 0 ? [{ id: "changes" as const, label: STR.inspector.tabChanges }] : []),
    ...(plans.length > 0 ? [{ id: "plan" as const, label: STR.inspector.tabPlan }] : []),
    ...(items.length > 0 ? [{ id: "timeline" as const, label: STR.inspector.tabTimeline }] : []),
  ];
  const [tab, setTab] = useState<InspectorProps["initialTab"] | null>(
    props.initialTab !== undefined && available.some((t) => t.id === props.initialTab) ? props.initialTab : null,
  );
  // 渲染期回落：数据面变化（切会话/数据消失）致选中项失效时，自动回到第一个可用——不留死选中。
  const selected = tab !== null && available.some((t) => t.id === tab) ? tab : (available[0]?.id ?? null);
  return (
    <div className="isp">
      <div className="isp-head">
        <div className="isp-tabs" role="tablist" aria-label={STR.inspector.aria} aria-orientation="horizontal">
          {available.map((t, index) => (
            <button
              key={t.id}
              id={`${tabsId}-tab-${t.id}`}
              role="tab"
              aria-selected={selected === t.id}
              aria-controls={`${tabsId}-panel`}
              tabIndex={selected === t.id ? 0 : -1}
              className={"isp-tab" + (selected === t.id ? " active" : "")}
              onClick={() => { setTab(t.id); }}
              onKeyDown={(e) => {
                const next = inspectorTabIndexForKey(e.key, index, available.length);
                if (next === null) return;
                e.preventDefault();
                const target = e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next];
                setTab(available[next]?.id ?? null);
                target?.focus();
              }}
            >{t.label}</button>
          ))}
        </div>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button className="isp-add" aria-label={STR.inspector.addPaneAria} title={STR.inspector.addPaneTitle}><Plus size={13} /></button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Content className="pop-rd" side="bottom" align="end" sideOffset={4}>
            {PANE_OPENABLE.map((k) => (
              <DropdownMenu.Item key={k} className="menu-item" onSelect={() => props.onOpenPane?.(k)}>
                {PANE_META[k].label}
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Root>
        {/* 关闭钮（2026-10-20 真机：「右边侧栏打开就没有关闭」）：此前只有 ⌘⌥I 一条路，
            鼠标用户把面板打开了却找不到出口。复用 .isp-add 的图标钮样式——同排同形，不新造一套。 */}
        {props.onClose !== undefined && (
          <button className="isp-add isp-close" aria-label={STR.inspector.closeAria} title={STR.inspector.closeTitle} onClick={() => { props.onClose?.(); }}>
            <X size={13} />
          </button>
        )}
      </div>
      <div
        className="isp-body"
        id={`${tabsId}-panel`}
        role="tabpanel"
        aria-labelledby={`${tabsId}-tab-${selected ?? available[0]?.id ?? "overview"}`}
        tabIndex={0}
      >
        {selected === "changes" && <ChangesTab items={changes} onRestore={props.onRestore} />}
        {selected === "plan" && (
          <div className="isp-plan">
            {plans.map((p) => (
              <div className="isp-plan-item" key={p.callId}>
                <div className="isp-plan-goal">{p.goal}</div>
                <div className="isp-plan-meta">
                  <span className={"chip " + (p.state === "approved" ? "ok" : p.state === "rejected" ? "bad" : "warn")}>
                    {p.state === "approved" ? STR.inspector.planApproved : p.state === "rejected" ? STR.inspector.planRejected : STR.inspector.planPending}
                  </span>
                  <span className="chip num">{STR.inspector.planFiles.replace("{count}", String(p.files.length))}</span>
                </div>
              </div>
            ))}
          </div>
        )}
        {selected === "timeline" && <TimelinePane items={items} onJump={props.onJump} />}
        {selected === null && (
          // 空态只在三个 Tab 全空时出现（available 非空必有选中项）：后面的分支是永不触达的
          // 死路，删——「按缺失 Tab 给具体状态」的落点在 available 的出现规则，不在这里。
          <div className="isp-empty">{STR.design.inspectorNoChanges}</div>
        )}
      </div>
    </div>
  );
}
