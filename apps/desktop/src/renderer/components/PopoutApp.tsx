// 独立窗格窗口（#pane=<kind>[&session=<id>] 路由，蓝本 §3.4 弹出）：
// 只渲染一个窗格 + 主题跟随；数据面自拉（openSession 历史 + onEvent 增量——推送已广播所有窗口）。
// 与主窗口共用同一 preload/AgentApi；不嵌套弹出（onPopout 不传）；关闭钮 = 关窗。
import { useEffect, useState } from "react";
import type { AgentEvent } from "../../../../../src/events";
import { applyTheme, browserThemeEnv, type ThemePref } from "../theme";
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
    if (props.sessionId !== null) {
      void window.agent.openSession(props.sessionId).then((r) => { setEvents(r.events); }).catch(() => undefined);
    }
    const off = window.agent.onEvent((e) => {
      // 第十八遍：命名推送与窗格无关（push-only）——不进本窗口事件面。
      if ((e as { type?: string }).type === "session_titled") return;
      const sid = (e as { session_id?: string }).session_id;
      if (props.sessionId === null || sid === undefined || sid === props.sessionId) {
        setEvents((prev) => [...prev, e]);
      }
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
