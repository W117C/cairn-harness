// 独立窗格窗口（#pane=<kind>[&session=<id>] 路由，蓝本 §3.4 弹出）：
// 只渲染一个窗格 + 主题跟随；数据面自拉（openSession 历史 + onEvent 增量——推送已广播所有窗口）。
// 与主窗口共用同一 preload/AgentApi；不嵌套弹出（onPopout 不传）；关闭钮 = 关窗。
import { useEffect, useState } from "react";
import type { AgentEvent } from "../../../../../src/events";
import { applyTheme, browserThemeEnv, type ThemePref } from "../theme";
import { mergeSessionSnapshot, popoutEventBelongsTo } from "../projections";
import { PaneDock, type PaneKind } from "./PaneDock";
import { PANE_META } from "./panes";

export function PopoutApp(props: { kind: PaneKind; sessionId: string | null }): React.JSX.Element {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [themePref, setThemePref] = useState<ThemePref>("system");
  useEffect(() => {
    void window.agent.getSettings().then((s) => { setThemePref(s.theme); }).catch(() => undefined);
  }, []);
  useEffect(() => applyTheme(themePref, browserThemeEnv()), [themePref]);
  // 独立窗口的标题（2026-10-18）：此前和主窗口一样叫「Cairn」，多开时在窗口列表里分不清谁是谁；
  // 再把会话名带上（同一窗格类型开两个会话时也能分）。
  useEffect(() => {
    const sid = props.sessionId === null ? ""
      : ` · ${props.sessionId.length > 24 ? `${props.sessionId.slice(0, 24)}…` : props.sessionId}`;
    document.title = `Cairn · ${PANE_META[props.kind].label}${sid}`;
  }, [props.kind, props.sessionId]);
  useEffect(() => {
    // 没有 sessionId 的弹出窗**不收任何事件**：旧实现 `props.sessionId === null || …` 让第一个
    // 析取项把后面两项都变成废话 ⇒ 弹出窗会把**所有会话**的事件都吸进来（⌘N 回首页时 paneTabs
    // 不清、⧉ 传的是 undefined）。用户在这个只有「变更」两个字、空态还写着"本会话还没有文件改动"
    // 的窗格里，看到的是**另一个会话**的轮次、文件与验证状态。没有归属就不显示，不是全都显示。
    if (props.sessionId === null) return;
    void window.agent.openSession(props.sessionId).then((r) => {
      // 读盘期间到达的增量不能丢：openSession 回的是**读之前**的快照，直接 setEvents 会把
      // 这窗口注册 onEvent 之后收到的那些事件盖掉（主窗口同款缺陷，那边用 openPending +
      // mergeSessionSnapshot 修过，见 App.tsx 与 projections.ts；弹出窗漏了这一手）。
      setEvents((prev) => mergeSessionSnapshot(r.events, prev));
    }).catch(() => undefined);
    const off = window.agent.onEvent((e) => {
      if (popoutEventBelongsTo(e, props.sessionId)) setEvents((prev) => [...prev, e]);
    });
    return off;
  }, [props.sessionId]);
  return (
    <div className="popout-app">
      <PaneDock
        tabs={[props.kind]}
        events={events}
        sessionId={props.sessionId}
        onClose={() => { window.close(); }}
      />
    </div>
  );
}
